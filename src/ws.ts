import type { GameRepository, GameSessionSummary, ParticipantSummary } from "./types.ts";

// 部屋ごとのWebSocket接続を管理し、リアルタイム配信を担当するモジュール。
// 認証はGameRepository.authenticateParticipantに委譲する(DB層の詳細はここでは知らない)。

export type WsEvent =
  | {
    type: "player_joined";
    participantId: string;
    displayName: string;
    role: ParticipantSummary["role"];
  }
  | { type: "player_left"; participantId: string }
  | { type: "field_selected"; genre: string }
  | { type: "host_started"; session: GameSessionSummary }
  | {
    type: "question_started";
    sessionId: string;
    questionIndex: number;
    timeLimitSeconds: number;
    questionStartedAt: string | null;
  }
  | { type: "question_ended"; questionIndex: number }
  | { type: "all_questions_done" }
  | { type: "launch_ready"; categoryScores: Record<string, number> };

// 接続はroomId(内部ID)で管理する。REST API側(app.ts)もGameSessionSummary.roomIdなどを
// 使って同じ部屋を指すので、roomCode(見た目の部屋コード)ではなくroomIdで揃えている。
const roomConnections = new Map<string, Set<WebSocket>>();
const participantConnections = new Map<string, Set<WebSocket>>();

interface ConnectionInfo {
  roomId: string;
  participantId: string;
  lastSeenAt: number;
}

// ハートビート(離脱検知)用に、接続ごとの「最後に何か受信した時刻」を覚えておく。
const connectionInfo = new Map<WebSocket, ConnectionInfo>();

interface PendingDisconnect {
  timeoutId: ReturnType<typeof setTimeout>;
  repository: GameRepository;
  info: ConnectionInfo;
}

const pendingDisconnects = new Map<string, PendingDisconnect>();

function roomSet(roomId: string): Set<WebSocket> {
  let set = roomConnections.get(roomId);
  if (!set) {
    set = new Set();
    roomConnections.set(roomId, set);
  }
  return set;
}

function participantSet(participantId: string): Set<WebSocket> {
  let set = participantConnections.get(participantId);
  if (!set) {
    set = new Set();
    participantConnections.set(participantId, set);
  }
  return set;
}

/** 指定した部屋(roomId)につながっている全員にイベントを配信する。REST側のアクションから呼び出される。 */
export function broadcast(roomId: string, event: WsEvent): void {
  const payload = JSON.stringify(event);
  for (const socket of roomSet(roomId)) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
}

/**
 * 切断(正常なWebSocketクローズ、またはハートビート切れ)を処理する共通処理。
 * 画面遷移による短い切断を許容し、猶予内に再接続されなかった場合だけDB上でも離脱済みにする。
 */
function cancelPendingDisconnect(participantId: string): void {
  const pending = pendingDisconnects.get(participantId);
  if (!pending) return;
  clearTimeout(pending.timeoutId);
  pendingDisconnects.delete(participantId);
}

async function finalizeDisconnect(participantId: string): Promise<void> {
  const pending = pendingDisconnects.get(participantId);
  if (!pending) return;
  pendingDisconnects.delete(participantId);
  if (participantConnections.get(participantId)?.size) return;

  const result = await pending.repository.markParticipantDisconnected(participantId);
  if (result) {
    broadcast(pending.info.roomId, { type: "player_left", participantId });
  }
}

function handleSocketClosed(
  repository: GameRepository,
  socket: WebSocket,
  info: ConnectionInfo,
): void {
  roomConnections.get(info.roomId)?.delete(socket);
  connectionInfo.delete(socket);
  const connections = participantConnections.get(info.participantId);
  connections?.delete(socket);
  if (connections?.size) return;
  participantConnections.delete(info.participantId);

  cancelPendingDisconnect(info.participantId);
  const timeoutId = setTimeout(
    () => void finalizeDisconnect(info.participantId),
    disconnectGraceMs,
  );
  pendingDisconnects.set(info.participantId, { timeoutId, repository, info });
}

/**
 * /ws への接続を処理する。main.tsのHTTPハンドラから呼び出す。
 * 認証に失敗した場合はnullを返す(呼び出し側で401レスポンスにする)。
 */
export async function handleWsUpgrade(
  req: Request,
  url: URL,
  repository: GameRepository,
): Promise<Response | null> {
  const roomCode = url.searchParams.get("roomCode");
  const token = url.searchParams.get("token");
  if (!roomCode || !token) {
    return null;
  }

  // 参加者として正しいか(部屋コード+トークンの組み合わせ)を先に確認してからアップグレードする。
  // player_joined自体はREST側のjoinRoom/createRoomが正式なタイミングで配信するので、
  // ここでは単に接続を部屋(roomId)に登録するだけにする。
  const { roomId, participant } = await repository.authenticateParticipant(roomCode, token);

  const { socket, response } = Deno.upgradeWebSocket(req);
  const connections = roomSet(roomId);

  socket.onopen = () => {
    cancelPendingDisconnect(participant.id);
    connections.add(socket);
    participantSet(participant.id).add(socket);
    connectionInfo.set(socket, { roomId, participantId: participant.id, lastSeenAt: Date.now() });
  };

  // 何か受信すること自体を生存確認として扱う(専用のハートビートメッセージでなくてもよい)。
  socket.onmessage = () => {
    const info = connectionInfo.get(socket);
    if (info) info.lastSeenAt = Date.now();
  };

  socket.onclose = () => {
    // ハートビート検知側が先に処理済み(connectionInfoから削除済み)なら、ここでは何もしない。
    const info = connectionInfo.get(socket);
    if (!info) return;
    handleSocketClosed(repository, socket, info);
  };

  return response;
}

// ---- ハートビート(離脱検知)の定期チェック ----
// 10〜15秒程度の猶予、という方針の中間値として12秒を採用している。

const DEFAULT_HEARTBEAT_CHECK_INTERVAL_MS = 5_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 12_000;
const DEFAULT_DISCONNECT_GRACE_MS = 8_000;

let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let disconnectGraceMs = DEFAULT_DISCONNECT_GRACE_MS;

/**
 * 一定時間(デフォルト12秒)何も受信していない接続を切断とみなすチェックを開始する。
 * サーバー起動時に1回呼ぶ想定。各時間はテストから短い値を渡せるようにしている。
 */
export function startHeartbeatMonitor(
  repository: GameRepository,
  intervalMs: number = DEFAULT_HEARTBEAT_CHECK_INTERVAL_MS,
  timeoutMs: number = DEFAULT_HEARTBEAT_TIMEOUT_MS,
  graceMs: number = DEFAULT_DISCONNECT_GRACE_MS,
): void {
  stopHeartbeatMonitor();
  disconnectGraceMs = graceMs;
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const [socket, info] of connectionInfo) {
      if (now - info.lastSeenAt > timeoutMs) {
        handleSocketClosed(repository, socket, info);
        try {
          socket.close();
        } catch {
          // すでに閉じかけている場合は無視してよい。
        }
      }
    }
  }, intervalMs);
}

/** テストやサーバー終了時にタイマーを止める。 */
export function stopHeartbeatMonitor(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
}

import type { GameRepository, ParticipantSummary } from "./types.ts";

// 部屋ごとのWebSocket接続を管理し、リアルタイム配信を担当するモジュール。
// 認証はGameRepository.authenticateParticipantに委譲する(DB層の詳細はここでは知らない)。

export type WsEvent =
  | { type: "player_joined"; participantId: string; displayName: string; role: ParticipantSummary["role"] }
  | { type: "player_left"; participantId: string }
  | { type: "field_selected"; genre: string }
  | { type: "host_started" }
  | { type: "question_started"; questionIndex: number; timeLimitSeconds: number }
  | { type: "question_ended"; questionIndex: number }
  | { type: "all_questions_done" }
  | { type: "launch_ready"; categoryScores: Record<string, number> };

// 接続はroomId(内部ID)で管理する。REST API側(app.ts)もGameSessionSummary.roomIdなどを
// 使って同じ部屋を指すので、roomCode(見た目の部屋コード)ではなくroomIdで揃えている。
const roomConnections = new Map<string, Set<WebSocket>>();

function roomSet(roomId: string): Set<WebSocket> {
  let set = roomConnections.get(roomId);
  if (!set) {
    set = new Set();
    roomConnections.set(roomId, set);
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
    connections.add(socket);
  };

  socket.onclose = () => {
    connections.delete(socket);
    broadcast(roomId, { type: "player_left", participantId: participant.id });
  };

  return response;
}

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

const roomConnections = new Map<string, Set<WebSocket>>();

function roomSet(roomCode: string): Set<WebSocket> {
  let set = roomConnections.get(roomCode);
  if (!set) {
    set = new Set();
    roomConnections.set(roomCode, set);
  }
  return set;
}

/** 指定した部屋につながっている全員にイベントを配信する。Step4以降、REST側のアクションから呼び出す想定。 */
export function broadcast(roomCode: string, event: WsEvent): void {
  const payload = JSON.stringify(event);
  for (const socket of roomSet(roomCode)) {
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
  const participant = await repository.authenticateParticipant(roomCode, token);

  const { socket, response } = Deno.upgradeWebSocket(req);
  const connections = roomSet(roomCode);

  socket.onopen = () => {
    connections.add(socket);
    broadcast(roomCode, {
      type: "player_joined",
      participantId: participant.id,
      displayName: participant.displayName,
      role: participant.role,
    });
  };

  socket.onclose = () => {
    connections.delete(socket);
    broadcast(roomCode, { type: "player_left", participantId: participant.id });
  };

  return response;
}

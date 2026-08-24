import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { startHeartbeatMonitor, stopHeartbeatMonitor } from "../src/ws.ts";
import type {
  AnswerSummary,
  AuthenticatedParticipant,
  GameRepository,
  GameSessionSummary,
  MembershipResult,
  RoomDetail,
  RoomSummary,
} from "../src/types.ts";

const TOKEN = "test_access_token_that_is_long_enough";
const NOW = "2026-08-24T00:00:00.000Z";

const membership: MembershipResult = {
  room: { id: "room-1", code: "ABC234", status: "lobby", genre: "web", createdAt: NOW },
  participant: { id: "participant-1", displayName: "テストユーザー", role: "host", joinedAt: NOW },
  accessToken: TOKEN,
};

class FakeRepository implements GameRepository {
  disconnectedParticipantIds: string[] = [];

  healthCheck(): Promise<void> {
    return Promise.resolve();
  }
  createRoom(): Promise<MembershipResult> {
    return Promise.reject(new Error("not used"));
  }
  joinRoom(): Promise<MembershipResult> {
    return Promise.reject(new Error("not used"));
  }
  getRoom(): Promise<RoomDetail> {
    return Promise.reject(new Error("not used"));
  }
  authenticateParticipant(_roomCode: string, accessToken: string): Promise<AuthenticatedParticipant> {
    if (accessToken !== TOKEN) throw new Error("invalid token");
    return Promise.resolve({ roomId: membership.room.id, participant: membership.participant });
  }
  selectGenre(): Promise<RoomSummary> {
    return Promise.reject(new Error("not used"));
  }
  startSession(): Promise<GameSessionSummary> {
    return Promise.reject(new Error("not used"));
  }
  startQuestion(): Promise<GameSessionSummary> {
    return Promise.reject(new Error("not used"));
  }
  submitAnswer(): Promise<AnswerSummary> {
    return Promise.reject(new Error("not used"));
  }
  completeSession(): Promise<GameSessionSummary> {
    return Promise.reject(new Error("not used"));
  }
  advanceQuestionAutomatically(): Promise<GameSessionSummary | null> {
    return Promise.reject(new Error("not used"));
  }
  completeSessionAutomatically(): Promise<GameSessionSummary | null> {
    return Promise.reject(new Error("not used"));
  }
  haveAllParticipantsAnswered(): Promise<boolean> {
    return Promise.reject(new Error("not used"));
  }

  private alreadyDisconnected = new Set<string>();

  markParticipantDisconnected(participantId: string): Promise<{ roomId: string } | null> {
    // 本物のDB実装(left_at IS NULLでの絞り込み)と同じく、2回目以降はnullを返す。
    if (this.alreadyDisconnected.has(participantId)) {
      return Promise.resolve(null);
    }
    this.alreadyDisconnected.add(participantId);
    this.disconnectedParticipantIds.push(participantId);
    return Promise.resolve({ roomId: membership.room.id });
  }
}

Deno.test("ハートビートが切れると離脱扱いになりplayer_leftが配信される", async () => {
  const repository = new FakeRepository();
  const server = Deno.serve({ port: 8197 }, createApp(repository));
  startHeartbeatMonitor(repository, 20, 50);

  try {
    // 見届け役: 定期的に何か送って自分は生存させ続け、player_left通知を受け取れるようにする。
    const watcher = new WebSocket(`ws://localhost:8197/ws?roomCode=ABC234&token=${TOKEN}`);
    const received: { type: string }[] = [];
    watcher.onmessage = (e) => received.push(JSON.parse(e.data));
    await new Promise((resolve) => {
      watcher.onopen = resolve;
    });
    const keepAlive = setInterval(() => watcher.send("keep-alive"), 15);

    // 離脱させる側: 何も送らないので、ハートビートのタイムアウト(50ms)で切断される。
    const victim = new WebSocket(`ws://localhost:8197/ws?roomCode=ABC234&token=${TOKEN}`);
    await new Promise((resolve) => {
      victim.onopen = resolve;
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    clearInterval(keepAlive);

    assert.deepEqual(repository.disconnectedParticipantIds, [membership.participant.id]);
    assert.ok(received.some((event) => event.type === "player_left"));

    watcher.close();
  } finally {
    stopHeartbeatMonitor();
    await server.shutdown();
  }
});

Deno.test("正常にWebSocketを閉じた場合もDB上の離脱処理が呼ばれる", async () => {
  const repository = new FakeRepository();
  const server = Deno.serve({ port: 8196 }, createApp(repository));

  try {
    const ws = new WebSocket(`ws://localhost:8196/ws?roomCode=ABC234&token=${TOKEN}`);
    await new Promise((resolve) => {
      ws.onopen = resolve;
    });

    ws.close();
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.deepEqual(repository.disconnectedParticipantIds, [membership.participant.id]);
  } finally {
    await server.shutdown();
  }
});

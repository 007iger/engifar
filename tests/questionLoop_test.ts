import assert from "node:assert/strict";
import { scheduleQuestionAdvance, triggerEarlyQuestionEnd } from "../src/questionLoop.ts";
import type { GameRepository, GameSessionSummary } from "../src/types.ts";

const NOW = "2026-08-24T00:00:00.000Z";
const ROOM_ID = "room-1";
const SESSION_ID = "session-1";

function makeSession(overrides: Partial<GameSessionSummary> = {}): GameSessionSummary {
  return {
    id: SESSION_ID,
    roomId: ROOM_ID,
    sessionNumber: 1,
    status: "active",
    questionCount: 2,
    answerTimeSeconds: 0, // テストなので実質待ち時間なし
    currentQuestionIndex: 0,
    questionStartedAt: NOW,
    startedAt: NOW,
    finishedAt: null,
    ...overrides,
  };
}

class RecordingRepository implements Partial<GameRepository> {
  advancedFrom: number[] = [];
  completedSessionIds: string[] = [];

  advanceQuestionAutomatically(
    _sessionId: string,
    fromIndex: number,
  ): Promise<GameSessionSummary | null> {
    this.advancedFrom.push(fromIndex);
    return Promise.resolve(makeSession({ currentQuestionIndex: fromIndex + 1 }));
  }

  completeSessionAutomatically(sessionId: string): Promise<GameSessionSummary | null> {
    this.completedSessionIds.push(sessionId);
    return Promise.resolve(makeSession({ status: "completed", finishedAt: NOW }));
  }
}

Deno.test("最後の問題でなければ自動で次の問題に進む", async () => {
  const repository = new RecordingRepository() as unknown as GameRepository;
  scheduleQuestionAdvance(repository, makeSession({ currentQuestionIndex: 0 }), 5);

  // answerTimeSeconds=0 + reviewTimeMs=5 の合計より少し長く待つ
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual((repository as unknown as RecordingRepository).advancedFrom, [0]);
});

Deno.test("最後の問題が終わったら自動でセッションを完了する", async () => {
  const repository = new RecordingRepository() as unknown as GameRepository;
  scheduleQuestionAdvance(
    repository,
    makeSession({ currentQuestionIndex: 1, questionCount: 2 }),
    5,
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual((repository as unknown as RecordingRepository).completedSessionIds, [
    SESSION_ID,
  ]);
});

Deno.test("全員回答済みなら制限時間を待たずに次へ進む", async () => {
  const repository = new RecordingRepository() as unknown as GameRepository;
  // answerTimeSecondsを長くして、自然にタイムアウトしたのではないことを確認する。
  scheduleQuestionAdvance(
    repository,
    makeSession({ currentQuestionIndex: 0, answerTimeSeconds: 10 }),
    5,
  );

  const triggered = triggerEarlyQuestionEnd(SESSION_ID, 0);
  assert.equal(triggered, true);

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual((repository as unknown as RecordingRepository).advancedFrom, [0]);
});

Deno.test("対象の問題がすでに終わっていれば早期終了は何もしない", () => {
  const triggered = triggerEarlyQuestionEnd("no-such-session", 0);
  assert.equal(triggered, false);
});

import assert from "node:assert/strict";
import { scheduleQuestionAdvance, triggerEarlyQuestionEnd } from "../src/questionLoop.ts";
import { handleWsUpgrade } from "../src/ws.ts";
import type { AuthenticatedParticipant, GameRepository, GameSessionSummary } from "../src/types.ts";

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
    choiceOrderVersion: 2,
    answerTimeSeconds: 0, // テストなので実質待ち時間なし
    questionAnswerTimeSeconds: [0, 0],
    currentQuestionIndex: 0,
    questionStartedAt: new Date().toISOString(),
    questionReviewStartedAt: null,
    reviewEndsAt: null,
    startedAt: NOW,
    finishedAt: null,
    ...overrides,
  };
}

class RecordingRepository implements Partial<GameRepository> {
  advancedFrom: number[] = [];
  completedSessionIds: string[] = [];
  reviewStartedFor: number[] = [];

  beginQuestionReview(
    _sessionId: string,
    questionIndex: number,
    reviewTimeMs: number,
  ): Promise<GameSessionSummary | null> {
    this.reviewStartedFor.push(questionIndex);
    const reviewStartedAt = new Date().toISOString();
    return Promise.resolve(makeSession({
      currentQuestionIndex: questionIndex,
      questionReviewStartedAt: reviewStartedAt,
      reviewEndsAt: new Date(Date.parse(reviewStartedAt) + reviewTimeMs).toISOString(),
    }));
  }

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

Deno.test("回答の有無にかかわらず設定された回答時間を確保する", async () => {
  const repository = new RecordingRepository() as unknown as GameRepository;
  scheduleQuestionAdvance(
    repository,
    makeSession({ currentQuestionIndex: 0, answerTimeSeconds: 0.05 }),
    5,
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual((repository as unknown as RecordingRepository).advancedFrom, []);

  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.deepEqual((repository as unknown as RecordingRepository).advancedFrom, [0]);
});
Deno.test("対象の問題がすでに終わっていれば早期終了は何もしない", async () => {
  const repository = {
    beginQuestionReview: () => Promise.resolve(null),
  } as unknown as GameRepository;
  const triggered = await triggerEarlyQuestionEnd(repository, "no-such-session", 0);
  assert.equal(triggered, false);
});

Deno.test("全員回答時は残り時間を待たずに答え合わせへ進む", async () => {
  const repository = new RecordingRepository() as unknown as GameRepository;
  scheduleQuestionAdvance(
    repository,
    makeSession({ currentQuestionIndex: 0, answerTimeSeconds: 10 }),
    5,
  );

  const triggered = await triggerEarlyQuestionEnd(repository, SESSION_ID, 0, 5);
  assert.equal(triggered, true);
  assert.deepEqual((repository as unknown as RecordingRepository).reviewStartedFor, [0]);

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual((repository as unknown as RecordingRepository).advancedFrom, [0]);
});

const WS_ROOM_ID = "ws-room-1";
const WS_TOKEN = "ws_test_token_that_is_long_enough";

class WsRecordingRepository implements Partial<GameRepository> {
  advancedFrom: number[] = [];

  beginQuestionReview(
    _sessionId: string,
    questionIndex: number,
    reviewTimeMs: number,
  ): Promise<GameSessionSummary | null> {
    const reviewStartedAt = new Date().toISOString();
    return Promise.resolve(makeSession({
      currentQuestionIndex: questionIndex,
      roomId: WS_ROOM_ID,
      questionReviewStartedAt: reviewStartedAt,
      reviewEndsAt: new Date(Date.parse(reviewStartedAt) + reviewTimeMs).toISOString(),
    }));
  }

  authenticateParticipant(): Promise<AuthenticatedParticipant> {
    return Promise.resolve({
      roomId: WS_ROOM_ID,
      participant: {
        id: "participant-1",
        displayName: "tester",
        crewColor: "#54d37c",
        role: "host",
        joinedAt: NOW,
      },
    });
  }

  advanceQuestionAutomatically(
    _sessionId: string,
    fromIndex: number,
  ): Promise<GameSessionSummary | null> {
    this.advancedFrom.push(fromIndex);
    return Promise.resolve(
      makeSession({ currentQuestionIndex: fromIndex + 1, roomId: WS_ROOM_ID }),
    );
  }

  completeSessionAutomatically(): Promise<GameSessionSummary | null> {
    return Promise.resolve(null);
  }
}

Deno.test(
  "question_endedにreviewEndsAtが含まれ、次のquestion_startedまでreviewTimeMs以上空く",
  async () => {
    const repository = new WsRecordingRepository() as unknown as GameRepository;
    const server = Deno.serve({ port: 8199 }, (req) => {
      const url = new URL(req.url);
      return handleWsUpgrade(req, url, repository).then(
        (res) => res ?? new Response("not found", { status: 404 }),
      );
    });

    try {
      const socket = new WebSocket(
        "ws://localhost:8199/ws?roomCode=ABC234",
        ["engifar-v1", WS_TOKEN],
      );
      const received: Array<Record<string, unknown> & { receivedAt: number }> = [];
      socket.onmessage = (event) => {
        received.push({ ...JSON.parse(event.data), receivedAt: Date.now() });
      };
      await new Promise((resolve) => {
        socket.onopen = resolve;
      });

      const reviewTimeMs = 80;
      const beforeSchedule = Date.now();
      scheduleQuestionAdvance(
        repository,
        makeSession({ currentQuestionIndex: 0, answerTimeSeconds: 0, roomId: WS_ROOM_ID }),
        reviewTimeMs,
      );

      const deadline = Date.now() + 2_000;
      while (
        !received.some((event) => event.type === "question_started") &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const ended = received.find((event) => event.type === "question_ended");
      const started = received.find((event) => event.type === "question_started");
      assert.ok(ended, "question_endedが配信されていない");
      assert.ok(started, "次のquestion_startedが配信されていない");

      assert.equal(typeof ended.reviewEndsAt, "number");
      const reviewEndsAt = ended.reviewEndsAt as number;
      assert.ok(
        reviewEndsAt >= beforeSchedule + reviewTimeMs - 20,
        "reviewEndsAtがreviewTimeMs未満で計算されている",
      );

      const gapMs = started.receivedAt - ended.receivedAt;
      assert.ok(
        gapMs >= reviewTimeMs - 20,
        `question_ended直後に次のquestion_startedが配信されている(gap=${gapMs}ms)`,
      );

      socket.close();
    } finally {
      await server.shutdown();
    }
  },
);

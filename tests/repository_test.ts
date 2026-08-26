import assert from "node:assert/strict";
import type { Pool } from "pg";
import { PostgresGameRepository } from "../src/db/postgres_game_repository.ts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const ROOM_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "test_access_token_that_is_long_enough";

function sessionRow(
  questionStartedAt: Date,
  currentQuestionIndex = 0,
  reviewStartedAt: Date | null = null,
  reviewEndsAt: Date | null = null,
) {
  return {
    id: SESSION_ID,
    room_id: ROOM_ID,
    session_number: 1,
    status: "active",
    question_count: 24,
    choice_order_version: 2,
    answer_time_seconds: 10,
    question_answer_time_seconds: Array(24).fill(10),
    current_question_index: currentQuestionIndex,
    question_started_at: questionStartedAt,
    question_review_started_at: reviewStartedAt,
    review_ends_at: reviewEndsAt,
    started_at: questionStartedAt,
    finished_at: null,
  };
}

Deno.test("session reads use the DB timeline to recover an overdue answer phase", async () => {
  const queries: { text: string; values?: unknown[] }[] = [];
  const startedAt = new Date(Date.now() - 20_000);
  const pool = {
    query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (queries.length === 1) return Promise.resolve({ rows: [sessionRow(startedAt)] });
      const reviewStartedAt = new Date();
      return Promise.resolve({
        rows: [
          sessionRow(startedAt, 0, reviewStartedAt, new Date(reviewStartedAt.getTime() + 5_000)),
        ],
      });
    },
  } as unknown as Pool;
  const result = await new PostgresGameRepository(pool).getSessionForParticipant(
    SESSION_ID,
    TOKEN,
    5,
  );

  assert.equal(queries.length, 2);
  assert.match(queries[1].text, /clock_timestamp/);
  assert.deepEqual(queries[1].values, [SESSION_ID, 0, 5_000]);
  assert.equal(result.currentQuestionIndex, 0);
  assert.ok(result.reviewEndsAt);
});

Deno.test("on-time session reads do not issue a recovery update", async () => {
  let queryCount = 0;
  const pool = {
    query() {
      queryCount += 1;
      return Promise.resolve({ rows: [sessionRow(new Date())] });
    },
  } as unknown as Pool;
  await new PostgresGameRepository(pool).getSessionForParticipant(SESSION_ID, TOKEN, 5);

  assert.equal(queryCount, 1);
});

Deno.test("an overdue review advances with the next JSON timing snapshot", async () => {
  const queries: { text: string; values?: unknown[] }[] = [];
  const startedAt = new Date(Date.now() - 20_000);
  const reviewStartedAt = new Date(Date.now() - 8_000);
  const reviewEndsAt = new Date(Date.now() - 3_000);
  const next = {
    ...sessionRow(new Date(), 1),
    answer_time_seconds: 20,
    question_answer_time_seconds: [10, 20, ...Array(22).fill(10)],
  };
  const pool = {
    query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (queries.length === 1) {
        return Promise.resolve({
          rows: [sessionRow(startedAt, 0, reviewStartedAt, reviewEndsAt)],
        });
      }
      return Promise.resolve({ rows: [next] });
    },
  } as unknown as Pool;

  const result = await new PostgresGameRepository(pool).getSessionForParticipant(
    SESSION_ID,
    TOKEN,
    5,
  );

  assert.equal(result.currentQuestionIndex, 1);
  assert.equal(result.answerTimeSeconds, 20);
  assert.match(queries[1].text, /question_answer_time_seconds\[current_question_index \+ 2\]/);
});

Deno.test("answer SQL counts the just-saved participant when checking all answered", async () => {
  let answerSql = "";
  let authorizationSql = "";
  const client = {
    query(text: string) {
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes("AS answer_window_open")) {
        authorizationSql = text;
        return Promise.resolve({
          rows: [{
            ...sessionRow(new Date()),
            participant_id: "33333333-3333-4333-8333-333333333333",
            answer_window_open: true,
          }],
        });
      }
      answerSql = text;
      return Promise.resolve({
        rows: [{
          id: "44444444-4444-4444-8444-444444444444",
          game_session_id: SESSION_ID,
          participant_id: "33333333-3333-4333-8333-333333333333",
          question_index: 0,
          selected_option: 1,
          response_time_ms: 500,
          answered_at: new Date(),
          all_participants_answered: true,
        }],
      });
    },
    release() {},
  };
  const pool = {
    connect: () => Promise.resolve(client),
  } as unknown as Pool;

  const result = await new PostgresGameRepository(pool).submitAnswer(SESSION_ID, TOKEN, 0, 1);

  assert.equal(result.allParticipantsAnswered, true);
  assert.match(authorizationSql, /FOR UPDATE OF gs/);
  assert.match(answerSql, /answered_participant\.participant_id = \$2/);
  assert.match(answerSql, /active_participant\.left_at IS NULL/);
  assert.match(answerSql, /AS all_participants_answered/);
});

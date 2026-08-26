import assert from "node:assert/strict";
import type { Pool } from "pg";
import { PostgresGameRepository } from "../src/db/postgres_game_repository.ts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const ROOM_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "test_access_token_that_is_long_enough";

function sessionRow(questionStartedAt: Date, currentQuestionIndex = 0) {
  return {
    id: SESSION_ID,
    room_id: ROOM_ID,
    session_number: 1,
    status: "active",
    question_count: 24,
    choice_order_version: 2,
    answer_time_seconds: 10,
    current_question_index: currentQuestionIndex,
    question_started_at: questionStartedAt,
    started_at: questionStartedAt,
    finished_at: null,
  };
}

Deno.test("session reads use the DB timeline to recover an overdue question loop", async () => {
  const queries: { text: string; values?: unknown[] }[] = [];
  const startedAt = new Date(Date.now() - 20_000);
  const pool = {
    query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (queries.length === 1) return Promise.resolve({ rows: [sessionRow(startedAt)] });
      return Promise.resolve({ rows: [sessionRow(new Date(startedAt.getTime() + 15_000), 1)] });
    },
  } as unknown as Pool;
  const result = await new PostgresGameRepository(pool).getSessionForParticipant(
    SESSION_ID,
    TOKEN,
    5,
  );

  assert.equal(queries.length, 2);
  assert.match(queries[1].text, /clock_timestamp/);
  assert.deepEqual(queries[1].values, [SESSION_ID, 15]);
  assert.equal(result.currentQuestionIndex, 1);
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

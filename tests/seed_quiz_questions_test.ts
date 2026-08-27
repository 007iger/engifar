import assert from "node:assert/strict";
import type { Pool } from "pg";
import { seedQuizQuestions } from "../src/db/seed_quiz_questions.ts";

Deno.test("question seeding creates immutable revisions and only switches the active revision", async () => {
  const queries: string[] = [];
  const client = {
    query(text: string) {
      queries.push(text);
      return Promise.resolve({ rows: [] });
    },
    release() {},
  };
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;

  await seedQuizQuestions(pool);

  const revisionInsert = queries.find((query) =>
    query.includes("INSERT INTO quiz_question_revision")
  );
  assert.ok(revisionInsert);
  assert.match(revisionInsert, /ON CONFLICT \(question_id, content_hash\)/);
  assert.match(revisionInsert, /DO UPDATE SET active = true/);
  assert.doesNotMatch(revisionInsert, /question = EXCLUDED\.question/);
  assert.ok(
    queries.findIndex((query) => query.includes("SET active = false")) <
      queries.findIndex((query) => query.includes("INSERT INTO quiz_question_revision")),
  );
});

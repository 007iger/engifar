import assert from "node:assert/strict";

Deno.test("initial migration creates exactly the five domain tables", async () => {
  const migration = await Deno.readTextFile(
    new URL("../migrations/001_initial_schema.sql", import.meta.url),
  );
  const tables = Array.from(
    migration.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/g),
    (match) => match[1],
  );

  assert.deepEqual(tables, [
    "room",
    "participant",
    "game_session",
    "session_participant",
    "answer",
  ]);
  assert.match(migration, /UNIQUE \(game_session_id, participant_id, question_index\)/);
  assert.match(migration, /selected_option BETWEEN 0 AND 3/);
});

Deno.test("integrity migration strengthens deletion and answer range rules", async () => {
  const migration = await Deno.readTextFile(
    new URL("../migrations/002_strengthen_integrity.sql", import.meta.url),
  );

  assert.match(migration, /ON DELETE NO ACTION\s+DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /CREATE TRIGGER answer_question_index_within_session/);
  assert.match(migration, /NEW\.question_index >= session_question_count/);
  assert.match(migration, /CREATE TRIGGER game_session_question_count_covers_answers/);
});

Deno.test("choice order migration preserves old sessions and versions new sessions", async () => {
  const migration = await Deno.readTextFile(
    new URL("../migrations/003_quiz_choice_order_version.sql", import.meta.url),
  );

  assert.match(migration, /ADD COLUMN choice_order_version smallint NOT NULL DEFAULT 1/);
  assert.match(migration, /ALTER COLUMN choice_order_version SET DEFAULT 2/);
  assert.match(migration, /CHECK \(choice_order_version IN \(1, 2\)\)/);
});

Deno.test("result publication migration keeps personal results private by default", async () => {
  const migration = await Deno.readTextFile(
    new URL("../migrations/004_result_publication.sql", import.meta.url),
  );

  assert.match(migration, /ADD COLUMN result_published boolean NOT NULL DEFAULT false/);
});

Deno.test("quiz timing migration snapshots per-question times and review state", async () => {
  const migration = await Deno.readTextFile(
    new URL("../migrations/005_quiz_timing.sql", import.meta.url),
  );

  assert.match(migration, /ADD COLUMN question_answer_time_seconds smallint\[\]/);
  assert.match(migration, /array_length\(question_answer_time_seconds, 1\) = question_count/);
  assert.match(migration, /ADD COLUMN question_review_started_at timestamptz/);
  assert.match(migration, /ADD COLUMN review_ends_at timestamptz/);
});

Deno.test("question set migration preserves old sessions and versions new sessions", async () => {
  const migration = await Deno.readTextFile(
    new URL("../migrations/006_quiz_question_set_version.sql", import.meta.url),
  );

  assert.match(migration, /ALTER COLUMN choice_order_version SET DEFAULT 3/);
  assert.match(migration, /CHECK \(choice_order_version IN \(1, 2, 3\)\)/);
});

Deno.test("question bank migration stores per-user question selections", async () => {
  const migration = await Deno.readTextFile(
    new URL("../migrations/007_quiz_question_bank.sql", import.meta.url),
  );

  assert.match(migration, /CREATE TABLE quiz_question/);
  assert.match(migration, /CREATE TABLE session_participant_question/);
  assert.match(migration, /UNIQUE \(game_session_id, participant_id, question_id\)/);
  assert.match(migration, /ALTER COLUMN choice_order_version SET DEFAULT 4/);
});

Deno.test("question metadata and crew colors are persisted and snapshotted", async () => {
  const migration = await Deno.readTextFile(
    new URL("../migrations/008_question_technology_and_crew_color.sql", import.meta.url),
  );

  assert.match(migration, /ADD COLUMN technology varchar\(64\) NOT NULL/);
  assert.match(migration, /ADD COLUMN crew_color varchar\(7\) NOT NULL/);
  assert.match(migration, /ADD COLUMN crew_color_snapshot varchar\(7\) NOT NULL/);
  assert.match(migration, /crew_color ~ '\^#\[0-9a-f\]\{6\}\$'/);
});

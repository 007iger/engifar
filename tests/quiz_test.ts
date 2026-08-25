import assert from "node:assert/strict";
import { ApiError } from "../src/errors.ts";
import { createQuizService } from "../src/quiz.ts";

const SECRET = "test-secret-that-is-at-least-32-bytes-long";

function assertApiError(error: unknown, code: string): boolean {
  assert.ok(error instanceof ApiError);
  assert.equal(error.code, code);
  return true;
}

Deno.test("quiz questions hide answers until the answer period ends", async () => {
  let now = 1_000;
  const quiz = createQuizService({ secret: SECRET, now: () => now });
  const { progressToken } = await quiz.createAttempt();
  const started = await quiz.startQuestion(0, progressToken);

  assert.equal(quiz.config.questionCount, 24);
  assert.equal(Object.hasOwn(started.question, "answer"), false);
  assert.equal(Object.hasOwn(started.question, "correctOption"), false);
  assert.equal(Object.hasOwn(started.question, "explanation"), false);

  await assert.rejects(
    () => quiz.gradeQuestion(0, started.questionToken, 0),
    (error) => assertApiError(error, "QUIZ_REVIEW_NOT_READY"),
  );

  now += 10_000;
  const result = await quiz.gradeQuestion(0, started.questionToken, 0);
  assert.equal(result.correct, true);
  assert.equal(result.correctOption, 0);
  assert.ok(result.nextProgressToken);
});

Deno.test("quiz progress tokens enforce question order and signatures", async () => {
  let now = 1_000;
  const quiz = createQuizService({ secret: SECRET, now: () => now });
  const attempt = await quiz.createAttempt();
  const first = await quiz.startQuestion(0, attempt.progressToken);
  now += 10_000;
  const firstResult = await quiz.gradeQuestion(0, first.questionToken, null);
  assert.ok(firstResult.nextProgressToken);

  await assert.rejects(
    () => quiz.startQuestion(2, firstResult.nextProgressToken!),
    (error) => assertApiError(error, "QUIZ_SEQUENCE_MISMATCH"),
  );

  const second = await quiz.startQuestion(1, firstResult.nextProgressToken);
  now += 10_000;
  const secondResult = await quiz.gradeQuestion(1, second.questionToken, 3);
  assert.equal(secondResult.correct, true);
  assert.equal(secondResult.correctOption, 3);

  const replacement = attempt.progressToken.endsWith("x") ? "y" : "x";
  const tampered = `${attempt.progressToken.slice(0, -1)}${replacement}`;
  await assert.rejects(
    () => quiz.startQuestion(0, tampered),
    (error) => assertApiError(error, "INVALID_QUIZ_TOKEN"),
  );
});

Deno.test("shared result scoring includes unanswered questions", () => {
  const quiz = createQuizService({ secret: SECRET });
  const perfect = quiz.scoreAnswers(2, [0, 3]);
  const partial = quiz.scoreAnswers(2, [0, null]);

  assert.equal(perfect.correctCount, 2);
  assert.equal(perfect.power, 100);
  assert.equal(partial.answeredCount, 1);
  assert.equal(partial.correctCount, 1);
  assert.equal(partial.power, 50);
});

import assert from "node:assert/strict";
import { ApiError } from "../src/errors.ts";
import {
  createQuizService,
  LEGACY_CHOICE_ORDER_VARIANT,
  safetyFromCategoryScores,
  validateQuizQuestions,
} from "../src/quiz.ts";

const SECRET = "test-secret-that-is-at-least-32-bytes-long";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function legacyQuestionToken(questionIndex: number): Promise<string> {
  const encoder = new TextEncoder();
  const payload = base64Url(encoder.encode(JSON.stringify({
    type: "question",
    attemptId: "pre-migration-attempt",
    questionIndex,
    revealAt: 0,
    expiresAt: 2_000,
  })));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${base64Url(new Uint8Array(signature))}`;
}

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
  const correctOption = started.question.choices.indexOf("h1");
  const result = await quiz.gradeQuestion(0, started.questionToken, correctOption);
  assert.equal(result.correct, true);
  assert.equal(result.correctOption, correctOption);
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
  const secondResult = await quiz.gradeQuestion(
    1,
    second.questionToken,
    second.question.choices.indexOf("href"),
  );
  assert.equal(secondResult.correct, true);
  assert.equal(second.question.choices[secondResult.correctOption], "href");

  const replacement = attempt.progressToken.endsWith("x") ? "y" : "x";
  const tampered = `${attempt.progressToken.slice(0, -1)}${replacement}`;
  await assert.rejects(
    () => quiz.startQuestion(0, tampered),
    (error) => assertApiError(error, "INVALID_QUIZ_TOKEN"),
  );
});

Deno.test("choice order is stable per room but not a question-number pattern", async () => {
  const quiz = createQuizService({ secret: SECRET });
  const { progressToken } = await quiz.createAttempt();
  const orders = await Promise.all(
    Array.from(
      { length: 16 },
      (_, index) => quiz.startQuestion(0, progressToken, undefined, `room-${index}`),
    ),
  );
  const repeated = await quiz.startQuestion(0, progressToken, undefined, "room-0");

  assert.deepEqual(repeated.question.choices, orders[0].question.choices);
  assert.ok(new Set(orders.map((item) => item.question.choices.join("\u0000"))).size > 1);
});

Deno.test("legacy room answers keep their original choice order", async () => {
  const quiz = createQuizService({ secret: SECRET, now: () => 1_000 });
  const score = await quiz.scoreAnswers(2, [0, 3], LEGACY_CHOICE_ORDER_VARIANT);
  const grade = await quiz.gradeQuestion(1, await legacyQuestionToken(1), 3);

  assert.equal(score.correctCount, 2);
  assert.equal(score.power, 100);
  assert.equal(grade.correct, true);
  assert.equal(grade.correctOption, 3);
});

Deno.test("shared result scoring includes unanswered questions", async () => {
  let now = 1_000;
  const variantId = "score-test-room";
  const quiz = createQuizService({ secret: SECRET, now: () => now });
  let { progressToken } = await quiz.createAttempt();
  const selectedOptions: number[] = [];

  for (let index = 0; index < 2; index += 1) {
    const started = await quiz.startQuestion(index, progressToken, undefined, variantId);
    now += 10_000;
    const grade = await quiz.gradeQuestion(index, started.questionToken, null);
    selectedOptions.push(grade.correctOption);
    progressToken = grade.nextProgressToken!;
  }

  const perfect = await quiz.scoreAnswers(2, selectedOptions, variantId);
  const partial = await quiz.scoreAnswers(2, [selectedOptions[0], null], variantId);

  assert.equal(perfect.correctCount, 2);
  assert.equal(perfect.power, 100);
  assert.equal(partial.answeredCount, 1);
  assert.equal(partial.correctCount, 1);
  assert.equal(partial.power, 50);
});

Deno.test("safety score penalizes large differences between categories", () => {
  assert.equal(safetyFromCategoryScores([100, 100, 100, 100, 100, 100]), 100);
  assert.equal(safetyFromCategoryScores([100, 100, 100, 100, 100, 0]), 65);
});

Deno.test("quiz JSON validation rejects duplicate ids and malformed choices", () => {
  const validQuestion = {
    id: "sample-question",
    category: "API",
    weight: 1,
    instruction: "Choose one",
    question: "Question",
    choices: ["A", "B", "C", "D"],
    answer: 0,
    explanation: "A is correct",
  };
  assert.equal(validateQuizQuestions([validQuestion]).length, 1);
  assert.throws(() => validateQuizQuestions([validQuestion, validQuestion]), /duplicate id/);
  assert.throws(
    () => validateQuizQuestions([{ ...validQuestion, choices: ["A", "B"] }]),
    /four unique/,
  );
});

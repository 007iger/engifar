import assert from "node:assert/strict";
import apiQuestionData from "../data/quiz_questions/api.json" with { type: "json" };
import backendQuestionData from "../data/quiz_questions/backend.json" with { type: "json" };
import databaseQuestionData from "../data/quiz_questions/database.json" with { type: "json" };
import frontendQuestionData from "../data/quiz_questions/frontend.json" with { type: "json" };
import infrastructureQuestionData from "../data/quiz_questions/infrastructure.json" with {
  type: "json",
};
import securityQuestionData from "../data/quiz_questions/security.json" with { type: "json" };
import questionData from "../data/quiz_questions.json" with { type: "json" };
import { QUIZ_QUESTION_BANK } from "../data/quiz_question_bank.ts";
import { ApiError } from "../src/errors.ts";
import {
  createQuizService,
  CURRENT_QUESTION_SET_VERSION,
  DATABASE_QUESTION_SET_VERSION,
  LEGACY_CHOICE_ORDER_VARIANT,
  LEGACY_QUESTION_SET_VERSION,
  questionSetVersionForChoiceOrder,
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

Deno.test("current static quiz data keeps four fifteen-second questions in every category", () => {
  const questions = validateQuizQuestions(questionData);
  const categoryCounts = questions.reduce<Record<string, number>>((counts, question) => {
    counts[question.category] = (counts[question.category] ?? 0) + 1;
    return counts;
  }, {});

  assert.deepEqual(categoryCounts, {
    "フロントエンド": 4,
    "バックエンド": 4,
    "データベース": 4,
    "API": 4,
    "インフラ": 4,
    "セキュリティ": 4,
  });
  assert.ok(questions.every((question) => question.answerTimeSeconds === 15));
});

Deno.test("quiz questions hide answers until the answer period ends", async () => {
  let now = 1_000;
  const quiz = createQuizService({ secret: SECRET, now: () => now });
  const { progressToken } = await quiz.createAttempt();
  const started = await quiz.startQuestion(0, progressToken);

  assert.equal(quiz.config.questionCount, 24);
  assert.deepEqual(quiz.config.answerTimeSecondsByQuestion, Array(24).fill(15));
  assert.equal(started.answerTimeSeconds, 15);
  assert.equal(Object.hasOwn(started.question, "answer"), false);
  assert.equal(Object.hasOwn(started.question, "correctOption"), false);
  assert.equal(Object.hasOwn(started.question, "explanation"), false);

  await assert.rejects(
    () => quiz.gradeQuestion(0, started.questionToken, 0),
    (error) => assertApiError(error, "QUIZ_REVIEW_NOT_READY"),
  );

  now += 15_000;
  const correctOption = started.question.choices.indexOf("flex");
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
  now += 15_000;
  const firstResult = await quiz.gradeQuestion(0, first.questionToken, null);
  assert.ok(firstResult.nextProgressToken);

  await assert.rejects(
    () => quiz.startQuestion(2, firstResult.nextProgressToken!),
    (error) => assertApiError(error, "QUIZ_SEQUENCE_MISMATCH"),
  );

  const second = await quiz.startQuestion(1, firstResult.nextProgressToken);
  now += 15_000;
  const secondResult = await quiz.gradeQuestion(
    1,
    second.questionToken,
    second.question.choices.indexOf("preventDefault"),
  );
  assert.equal(secondResult.correct, true);
  assert.equal(second.question.choices[secondResult.correctOption], "preventDefault");

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
  const score = await quiz.scoreAnswers(
    2,
    [0, 3],
    LEGACY_CHOICE_ORDER_VARIANT,
    LEGACY_QUESTION_SET_VERSION,
  );
  const grade = await quiz.gradeQuestion(1, await legacyQuestionToken(1), 3);

  assert.equal(score.correctCount, 2);
  assert.equal(score.power, 100);
  assert.equal(grade.correct, true);
  assert.equal(grade.correctOption, 3);
});

Deno.test("existing sessions use old questions while new sessions use the replacement set", async () => {
  let now = 1_000;
  const quiz = createQuizService({ secret: SECRET, now: () => now });
  const attempt = await quiz.createAttempt();
  const current = await quiz.startQuestion(0, attempt.progressToken);
  const legacy = await quiz.startQuestion(
    0,
    attempt.progressToken,
    undefined,
    "existing-room",
    10,
    questionSetVersionForChoiceOrder(2),
  );

  assert.equal(current.question.id, "frontend-flex-space-between");
  assert.equal(legacy.question.id, "frontend-html-heading");
  assert.equal(questionSetVersionForChoiceOrder(3), CURRENT_QUESTION_SET_VERSION);
  assert.equal(questionSetVersionForChoiceOrder(4), DATABASE_QUESTION_SET_VERSION);

  now += 10_000;
  const legacyAnswer = legacy.question.choices.indexOf("h1");
  const grade = await quiz.gradeQuestion(0, legacy.questionToken, legacyAnswer);
  assert.equal(grade.correct, true);
});

Deno.test("shared result scoring includes unanswered questions", async () => {
  let now = 1_000;
  const variantId = "score-test-room";
  const quiz = createQuizService({ secret: SECRET, now: () => now });
  let { progressToken } = await quiz.createAttempt();
  const selectedOptions: number[] = [];

  for (let index = 0; index < 2; index += 1) {
    const started = await quiz.startQuestion(index, progressToken, undefined, variantId);
    now += 15_000;
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
    answerTimeSeconds: 10,
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
  assert.throws(
    () => validateQuizQuestions([{ ...validQuestion, answerTimeSeconds: 0 }]),
    /invalid answerTimeSeconds/,
  );
});

Deno.test("database question bank has 10 beginner, 5 intermediate, and 3 advanced questions per category", () => {
  const counts = new Map<string, number>();
  for (const question of QUIZ_QUESTION_BANK) {
    const key = `${question.category}:${question.difficulty}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    assert.equal(question.answerTimeSeconds, 15);
  }

  for (
    const category of [
      "フロントエンド",
      "バックエンド",
      "データベース",
      "API",
      "インフラ",
      "セキュリティ",
    ]
  ) {
    assert.equal(counts.get(`${category}:1`), 10);
    assert.equal(counts.get(`${category}:2`), 5);
    assert.equal(counts.get(`${category}:3`), 3);
  }
  assert.equal(QUIZ_QUESTION_BANK.length, 108);
});

for (
  const [testName, category, authoredQuestionData] of [
    ["frontend", "フロントエンド", frontendQuestionData],
    ["backend", "バックエンド", backendQuestionData],
    ["database", "データベース", databaseQuestionData],
    ["API", "API", apiQuestionData],
    ["infrastructure", "インフラ", infrastructureQuestionData],
    ["security", "セキュリティ", securityQuestionData],
  ] as const
) {
  Deno.test(`${testName} question bank uses the reviewed code fill-in questions`, () => {
    const authoredQuestions = QUIZ_QUESTION_BANK.filter((question) =>
      question.category === category
    );

    assert.deepEqual(
      authoredQuestions.map((question) => question.id),
      authoredQuestionData.map((question) => question.id),
    );
    assert.deepEqual(
      authoredQuestions.map((question) => question.difficulty),
      [...Array(10).fill(1), ...Array(5).fill(2), ...Array(3).fill(3)],
    );
    for (const question of authoredQuestions) {
      assert.equal(question.weight, question.difficulty);
      assert.equal(question.answerTimeSeconds, 15);
      assert.equal(question.question.match(/＿＿＿/g)?.length, 1);
      assert.equal(question.choices.length, 4);
      assert.equal(new Set(question.choices).size, 4);
      assert.ok(question.answer >= 0 && question.answer < question.choices.length);
    }
  });
}

Deno.test("database-selected questions are used for display, grading, and category scoring", async () => {
  let now = 1_000;
  const quiz = createQuizService({ secret: SECRET, now: () => now });
  const { progressToken } = await quiz.createAttempt();
  const selected = QUIZ_QUESTION_BANK.filter((_question, index) =>
    index % 18 === 0 || index % 18 === 10 || index % 18 === 11 || index % 18 === 15
  );

  const started = await quiz.startQuestion(
    0,
    progressToken,
    undefined,
    "session:participant",
    15,
    DATABASE_QUESTION_SET_VERSION,
    selected[0],
  );
  assert.equal(started.question.id, selected[0].id);
  now += 15_000;
  const grade = await quiz.gradeQuestion(0, started.questionToken, null, undefined, selected[0]);
  assert.equal(grade.category, selected[0].category);

  const score = await quiz.scoreAnswers(
    24,
    Array(24).fill(null),
    "session:participant",
    DATABASE_QUESTION_SET_VERSION,
    selected,
  );
  assert.deepEqual(Object.keys(score.categoryScores), [
    "フロントエンド",
    "バックエンド",
    "データベース",
    "API",
    "インフラ",
    "セキュリティ",
  ]);
});

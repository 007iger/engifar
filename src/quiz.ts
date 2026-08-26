import questionData from "../data/quiz_questions.json" with { type: "json" };
import { ApiError } from "./errors.ts";

const DEFAULT_ANSWER_TIME_SECONDS = 10;
const DEFAULT_REVIEW_TIME_SECONDS = 5;
const TOKEN_LIFETIME_MS = 60 * 60 * 1000;
export const LEGACY_CHOICE_ORDER_VARIANT = "legacy-v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface RawQuizQuestion {
  id: string;
  category: string;
  weight: number;
  answerTimeSeconds: number;
  instruction: string;
  question: string;
  choices: readonly string[];
  answer: number;
  explanation: string;
}

export interface PublicQuizQuestion {
  id: string;
  index: number;
  category: string;
  weight: number;
  instruction: string;
  question: string;
  choices: readonly string[];
}

export interface QuizConfig {
  questionCount: number;
  answerTimeSeconds: number;
  answerTimeSecondsByQuestion: readonly number[];
  reviewTimeSeconds: number;
}

export interface QuizQuestionStart {
  question: PublicQuizQuestion;
  questionToken: string;
  answerTimeSeconds: number;
}

export interface QuizGradeResult {
  correct: boolean;
  correctOption: number;
  explanation: string;
  category: string;
  weight: number;
  nextProgressToken: string | null;
}

export interface QuizScore {
  answeredCount: number;
  correctCount: number;
  power: number;
  safety: number;
  categoryScores: Record<string, number>;
}

export function safetyFromCategoryScores(values: readonly number[]): number {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.round(Math.min(100, Math.max(0, mean - 0.5 * Math.sqrt(variance))));
}

interface TokenPayload {
  type: "progress" | "question";
  attemptId: string;
  questionIndex: number;
  expiresAt: number;
  revealAt?: number;
  variantId?: string;
}

export interface QuizServiceOptions {
  secret?: string;
  now?: () => number;
  answerTimeSeconds?: number;
  reviewTimeSeconds?: number;
}

const EXPECTED_CHOICE_COUNT = 4;

export function validateQuizQuestions(value: unknown): readonly Readonly<RawQuizQuestion>[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Quiz question data must be a non-empty array");
  }

  const ids = new Set<string>();
  return Object.freeze(value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Quiz question ${index} must be an object`);
    }
    const item = entry as Record<string, unknown>;
    const requiredText = (key: string): string => {
      const text = item[key];
      if (typeof text !== "string" || text.trim().length === 0) {
        throw new Error(`Quiz question ${index} has an invalid ${key}`);
      }
      return text;
    };

    const id = requiredText("id");
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id) || ids.has(id)) {
      throw new Error(`Quiz question ${index} has an invalid or duplicate id`);
    }
    ids.add(id);

    if (
      !Array.isArray(item.choices) ||
      item.choices.length !== EXPECTED_CHOICE_COUNT ||
      !item.choices.every((choice) => typeof choice === "string" && choice.trim().length > 0) ||
      new Set(item.choices).size !== item.choices.length
    ) {
      throw new Error(`Quiz question ${id} must have four unique non-empty choices`);
    }
    if (
      typeof item.answer !== "number" ||
      !Number.isInteger(item.answer) ||
      item.answer < 0 ||
      item.answer >= item.choices.length
    ) {
      throw new Error(`Quiz question ${id} has an invalid answer index`);
    }
    if (typeof item.weight !== "number" || !Number.isFinite(item.weight) || item.weight <= 0) {
      throw new Error(`Quiz question ${id} has an invalid weight`);
    }
    if (
      typeof item.answerTimeSeconds !== "number" ||
      !Number.isSafeInteger(item.answerTimeSeconds) ||
      item.answerTimeSeconds < 1 ||
      item.answerTimeSeconds > 300
    ) {
      throw new Error(`Quiz question ${id} has an invalid answerTimeSeconds`);
    }

    return Object.freeze({
      id,
      category: requiredText("category"),
      weight: item.weight,
      answerTimeSeconds: item.answerTimeSeconds,
      instruction: requiredText("instruction"),
      question: requiredText("question"),
      choices: Object.freeze([...item.choices]),
      answer: item.answer,
      explanation: requiredText("explanation"),
    });
  }));
}

const questions = validateQuizQuestions(questionData);

function questionAt(index: number): Readonly<RawQuizQuestion> {
  const question = questions[index];
  if (!question) {
    throw new ApiError(404, "QUIZ_QUESTION_NOT_FOUND", "Quiz question not found");
  }
  return question;
}

function publicQuestion(
  index: number,
  shuffled: Readonly<RawQuizQuestion>,
): PublicQuizQuestion {
  const { id, category, weight, instruction, question, choices } = shuffled;
  return { id, index, category, weight, instruction, question, choices };
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (encodeBase64Url(bytes) !== value) throw new Error("non-canonical base64url");
  return bytes;
}

function randomSecret(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function isTokenPayload(value: unknown): value is TokenPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (payload.type === "progress" || payload.type === "question") &&
    typeof payload.attemptId === "string" &&
    Number.isSafeInteger(payload.questionIndex) &&
    typeof payload.questionIndex === "number" &&
    typeof payload.expiresAt === "number" &&
    Number.isFinite(payload.expiresAt) &&
    (payload.revealAt === undefined ||
      (typeof payload.revealAt === "number" && Number.isFinite(payload.revealAt))) &&
    (payload.variantId === undefined ||
      (typeof payload.variantId === "string" && payload.variantId.length > 0 &&
        payload.variantId.length <= 128));
}

export class QuizService {
  readonly config: Readonly<QuizConfig>;
  #key: Promise<CryptoKey>;
  #now: () => number;

  constructor(options: QuizServiceOptions = {}) {
    const secret = options.secret ?? randomSecret();
    if (encoder.encode(secret).byteLength < 32) {
      throw new Error("Quiz token secret must contain at least 32 bytes");
    }
    this.#key = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    this.#now = options.now ?? Date.now;
    const answerTimeSecondsByQuestion = Object.freeze(
      questions.map((question) => options.answerTimeSeconds ?? question.answerTimeSeconds),
    );
    this.config = Object.freeze({
      questionCount: questions.length,
      answerTimeSeconds: answerTimeSecondsByQuestion[0] ?? DEFAULT_ANSWER_TIME_SECONDS,
      answerTimeSecondsByQuestion,
      reviewTimeSeconds: options.reviewTimeSeconds ?? DEFAULT_REVIEW_TIME_SECONDS,
    });
  }

  answerTimeSecondsAt(index: number): number {
    questionAt(index);
    return this.config.answerTimeSecondsByQuestion[index];
  }

  async createAttempt(): Promise<{ progressToken: string }> {
    const now = this.#now();
    return {
      progressToken: await this.#sign({
        type: "progress",
        attemptId: crypto.randomUUID(),
        questionIndex: 0,
        expiresAt: now + TOKEN_LIFETIME_MS,
      }),
    };
  }

  async startQuestion(
    index: number,
    progressToken: string,
    revealAt?: number,
    variantId?: string,
    answerTimeSecondsOverride?: number,
  ): Promise<QuizQuestionStart> {
    questionAt(index);
    const progress = await this.#verify(progressToken, "progress");
    if (progress.questionIndex !== index) {
      throw new ApiError(
        409,
        "QUIZ_SEQUENCE_MISMATCH",
        "Quiz questions must be answered in order",
      );
    }

    const now = this.#now();
    const answerTimeSeconds = answerTimeSecondsOverride ?? this.answerTimeSecondsAt(index);
    if (!Number.isFinite(answerTimeSeconds) || answerTimeSeconds < 0) {
      throw new ApiError(500, "QUIZ_CONFIG_MISMATCH", "Quiz answer time is invalid");
    }
    const answerRevealAt = revealAt ?? now + answerTimeSeconds * 1000;
    if (!Number.isFinite(answerRevealAt)) {
      throw new ApiError(400, "INVALID_REVEAL_TIME", "Quiz reveal time is invalid");
    }
    const questionVariantId = variantId ?? progress.attemptId;
    const question = await this.#shuffledQuestion(index, questionVariantId);
    return {
      question: publicQuestion(index, question),
      questionToken: await this.#sign({
        type: "question",
        attemptId: progress.attemptId,
        questionIndex: index,
        revealAt: answerRevealAt,
        expiresAt: progress.expiresAt,
        variantId: questionVariantId,
      }),
      answerTimeSeconds,
    };
  }

  async gradeQuestion(
    index: number,
    questionToken: string,
    selectedOption: number | null,
    trustedRevealAt?: number,
  ): Promise<QuizGradeResult> {
    const token = await this.#verify(questionToken, "question");
    if (token.questionIndex !== index) {
      throw new ApiError(409, "QUIZ_TOKEN_MISMATCH", "Quiz token does not match the question");
    }
    const revealAt = trustedRevealAt === undefined
      ? token.revealAt
      : Math.min(token.revealAt ?? Number.POSITIVE_INFINITY, trustedRevealAt);
    if (revealAt === undefined || this.#now() < revealAt) {
      throw new ApiError(
        409,
        "QUIZ_REVIEW_NOT_READY",
        "The correct answer is not available until the answer time ends",
      );
    }

    const question = await this.#shuffledQuestion(
      index,
      token.variantId ?? LEGACY_CHOICE_ORDER_VARIANT,
    );
    const nextIndex = index + 1;
    const nextProgressToken = nextIndex < questions.length
      ? await this.#sign({
        type: "progress",
        attemptId: token.attemptId,
        questionIndex: nextIndex,
        expiresAt: token.expiresAt,
      })
      : null;

    return {
      correct: selectedOption === question.answer,
      correctOption: question.answer,
      explanation: question.explanation,
      category: question.category,
      weight: question.weight,
      nextProgressToken,
    };
  }

  async scoreAnswers(
    questionCount: number,
    selectedOptions: readonly (number | null)[],
    variantId = "shared-default",
  ): Promise<QuizScore> {
    if (
      !Number.isSafeInteger(questionCount) || questionCount < 1 || questionCount > questions.length
    ) {
      throw new ApiError(500, "QUIZ_CONFIG_MISMATCH", "Session question count is invalid");
    }

    const categoryTotals = new Map<string, { correct: number; total: number }>();
    let answeredCount = 0;
    let correctCount = 0;
    let correctWeight = 0;
    let totalWeight = 0;

    for (let index = 0; index < questionCount; index += 1) {
      const question = await this.#shuffledQuestion(index, variantId);
      const selectedOption = Number.isInteger(selectedOptions[index])
        ? selectedOptions[index]
        : null;
      const correct = selectedOption === question.answer;
      if (selectedOption !== null) answeredCount += 1;
      if (correct) {
        correctCount += 1;
        correctWeight += question.weight;
      }
      totalWeight += question.weight;

      const category = categoryTotals.get(question.category) ?? { correct: 0, total: 0 };
      category.total += question.weight;
      if (correct) category.correct += question.weight;
      categoryTotals.set(question.category, category);
    }

    const categoryScores: Record<string, number> = {};
    for (const [category, score] of categoryTotals) {
      categoryScores[category] = score.total ? Math.round((score.correct / score.total) * 100) : 0;
    }
    const values = Object.values(categoryScores);
    return {
      answeredCount,
      correctCount,
      power: totalWeight ? Math.round((correctWeight / totalWeight) * 100) : 0,
      safety: safetyFromCategoryScores(values),
      categoryScores,
    };
  }

  async #shuffledQuestion(index: number, variantId: string): Promise<Readonly<RawQuizQuestion>> {
    if (!variantId || variantId.length > 128) {
      throw new ApiError(400, "INVALID_QUIZ_VARIANT", "Quiz variant is invalid");
    }

    const question = questionAt(index);
    if (variantId === LEGACY_CHOICE_ORDER_VARIANT) {
      const shift = index % question.choices.length;
      return Object.freeze({
        ...question,
        choices: Object.freeze(
          question.choices.slice(shift).concat(question.choices.slice(0, shift)),
        ),
        answer: (question.answer - shift + question.choices.length) % question.choices.length,
      });
    }

    const signature = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await this.#key,
        encoder.encode(`choice-order:${variantId}:${index}`),
      ),
    );
    const order = question.choices.map((_, choiceIndex) => choiceIndex);
    for (let cursor = order.length - 1, byteIndex = 0; cursor > 0; cursor--, byteIndex++) {
      const swapIndex = signature[byteIndex] % (cursor + 1);
      [order[cursor], order[swapIndex]] = [order[swapIndex], order[cursor]];
    }
    const choices = Object.freeze(order.map((choiceIndex) => question.choices[choiceIndex]));
    return Object.freeze({
      ...question,
      choices,
      answer: order.indexOf(question.answer),
    });
  }

  async #sign(payload: TokenPayload): Promise<string> {
    const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
    const signature = await crypto.subtle.sign(
      "HMAC",
      await this.#key,
      encoder.encode(encodedPayload),
    );
    return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
  }

  async #verify(token: string, expectedType: TokenPayload["type"]): Promise<TokenPayload> {
    try {
      const [encodedPayload, encodedSignature, extra] = token.split(".");
      if (!encodedPayload || !encodedSignature || extra !== undefined) throw new Error("format");
      const valid = await crypto.subtle.verify(
        "HMAC",
        await this.#key,
        decodeBase64Url(encodedSignature),
        encoder.encode(encodedPayload),
      );
      if (!valid) throw new Error("signature");

      const payload: unknown = JSON.parse(decoder.decode(decodeBase64Url(encodedPayload)));
      if (!isTokenPayload(payload) || payload.type !== expectedType) throw new Error("payload");
      if (this.#now() > payload.expiresAt) {
        throw new ApiError(401, "QUIZ_TOKEN_EXPIRED", "Quiz token has expired");
      }
      return payload;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(401, "INVALID_QUIZ_TOKEN", "Quiz token is invalid");
    }
  }
}

export function createQuizService(options: QuizServiceOptions = {}): QuizService {
  return new QuizService(options);
}

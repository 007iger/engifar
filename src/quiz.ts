import legacyQuestionData from "../data/quiz_questions.v1.json" with { type: "json" };
import questionData from "../data/quiz_questions.json" with { type: "json" };
import { QUIZ_QUESTION_BANK } from "../data/quiz_question_bank.ts";
import { ApiError } from "./errors.ts";

const DEFAULT_ANSWER_TIME_SECONDS = 15;
const DEFAULT_REVIEW_TIME_SECONDS = 5;
const QUESTIONS_PER_ATTEMPT = 24;
const TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const SESSION_AUTH_TOKEN_LIFETIME_MS = 60_000;
export const LEGACY_CHOICE_ORDER_VARIANT = "legacy-v1";
export const LEGACY_QUESTION_SET_VERSION = 1;
export const CURRENT_QUESTION_SET_VERSION = 2;
export const DATABASE_QUESTION_SET_VERSION = 3;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface RawQuizQuestion {
  id: string;
  category: string;
  technology: string;
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
  technology: string;
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

interface QuestionFlowTokenPayload<Type extends "progress" | "question"> {
  type: Type;
  attemptId: string;
  questionIndex: number;
  expiresAt: number;
  revealAt?: number;
  variantId?: string;
  questionSetVersion?: number;
  questionId?: string;
}

interface SessionAuthTokenPayload {
  type: "session";
  sessionId: string;
  accessTokenHash: string;
  expiresAt: number;
}

type TokenPayload =
  | QuestionFlowTokenPayload<"progress">
  | QuestionFlowTokenPayload<"question">
  | SessionAuthTokenPayload;

export interface QuizServiceOptions {
  secret?: string;
  now?: () => number;
  answerTimeSeconds?: number;
  reviewTimeSeconds?: number;
  /** デモ等で問題数を短縮したい場合に指定する(1〜QUESTIONS_PER_ATTEMPT)。省略時は通常の24問。 */
  questionCount?: number;
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
      technology: requiredText("technology"),
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

const legacyQuestions = validateQuizQuestions(legacyQuestionData);
const questions = validateQuizQuestions(questionData);
const databaseQuestions = validateQuizQuestions(QUIZ_QUESTION_BANK);
const databaseQuestionsById = new Map(databaseQuestions.map((question) => [question.id, question]));
const questionSets = new Map<number, readonly Readonly<RawQuizQuestion>[]>([
  [LEGACY_QUESTION_SET_VERSION, legacyQuestions],
  [CURRENT_QUESTION_SET_VERSION, questions],
]);

function questionsForVersion(version: number): readonly Readonly<RawQuizQuestion>[] {
  const selected = questionSets.get(version);
  if (!selected) {
    throw new ApiError(500, "QUIZ_CONFIG_MISMATCH", "Quiz question set version is unsupported");
  }
  return selected;
}

function questionAt(
  index: number,
  questionSetVersion = CURRENT_QUESTION_SET_VERSION,
): Readonly<RawQuizQuestion> {
  const question = questionsForVersion(questionSetVersion)[index];
  if (!question) {
    throw new ApiError(404, "QUIZ_QUESTION_NOT_FOUND", "Quiz question not found");
  }
  return question;
}

export function questionSetVersionForChoiceOrder(choiceOrderVersion: number): number {
  if (choiceOrderVersion >= 4) return DATABASE_QUESTION_SET_VERSION;
  return choiceOrderVersion >= 3 ? CURRENT_QUESTION_SET_VERSION : LEGACY_QUESTION_SET_VERSION;
}

function databaseQuestion(questionId: string): Readonly<RawQuizQuestion> {
  const question = databaseQuestionsById.get(questionId);
  if (!question) {
    throw new ApiError(500, "QUIZ_CONFIG_MISMATCH", "Stored quiz question is unsupported");
  }
  return question;
}

function publicQuestion(
  index: number,
  shuffled: Readonly<RawQuizQuestion>,
): PublicQuizQuestion {
  const { id, category, technology, weight, instruction, question, choices } = shuffled;
  return { id, index, category, technology, weight, instruction, question, choices };
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
  if (payload.type === "session") {
    return typeof payload.sessionId === "string" && payload.sessionId.length > 0 &&
      payload.sessionId.length <= 64 &&
      typeof payload.accessTokenHash === "string" &&
      /^[0-9a-f]{64}$/.test(payload.accessTokenHash) &&
      typeof payload.expiresAt === "number" && Number.isFinite(payload.expiresAt);
  }
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
        payload.variantId.length <= 128)) &&
    (payload.questionSetVersion === undefined ||
      payload.questionSetVersion === LEGACY_QUESTION_SET_VERSION ||
      payload.questionSetVersion === CURRENT_QUESTION_SET_VERSION ||
      payload.questionSetVersion === DATABASE_QUESTION_SET_VERSION) &&
    (payload.questionId === undefined ||
      (typeof payload.questionId === "string" && payload.questionId.length > 0 &&
        payload.questionId.length <= 64));
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
    const questionCount = options.questionCount ?? QUESTIONS_PER_ATTEMPT;
    if (
      !Number.isInteger(questionCount) || questionCount < 1 || questionCount > QUESTIONS_PER_ATTEMPT
    ) {
      throw new Error(`questionCount must be an integer between 1 and ${QUESTIONS_PER_ATTEMPT}`);
    }
    const answerTimeSecondsByQuestion = Object.freeze(Array.from(
      { length: questionCount },
      () => options.answerTimeSeconds ?? DEFAULT_ANSWER_TIME_SECONDS,
    ));
    const reviewTimeSeconds = options.reviewTimeSeconds ?? DEFAULT_REVIEW_TIME_SECONDS;
    // 0は「答え合わせを待たず即座に次へ進む」という意味で使われるため許可する。
    if (!Number.isInteger(reviewTimeSeconds) || reviewTimeSeconds < 0 || reviewTimeSeconds > 60) {
      throw new Error("reviewTimeSeconds must be an integer between 0 and 60");
    }
    this.config = Object.freeze({
      questionCount,
      answerTimeSeconds: answerTimeSecondsByQuestion[0] ?? DEFAULT_ANSWER_TIME_SECONDS,
      answerTimeSecondsByQuestion,
      reviewTimeSeconds,
    });
  }

  answerTimeSecondsAt(index: number): number {
    questionAt(index);
    return this.config.answerTimeSecondsByQuestion[index];
  }

  async createSessionAuthToken(sessionId: string, accessToken: string): Promise<string> {
    return await this.#sign({
      type: "session",
      sessionId,
      accessTokenHash: await this.#accessTokenHash(accessToken),
      expiresAt: this.#now() + SESSION_AUTH_TOKEN_LIFETIME_MS,
    });
  }

  async isSessionAuthTokenValid(
    token: string | null,
    sessionId: string,
    accessToken: string,
  ): Promise<boolean> {
    if (!token) return false;
    try {
      const payload = await this.#verify(token, "session");
      return payload.sessionId === sessionId &&
        payload.accessTokenHash === await this.#accessTokenHash(accessToken);
    } catch {
      return false;
    }
  }

  async createAttempt(): Promise<{ progressToken: string }> {
    const now = this.#now();
    return {
      progressToken: await this.#sign({
        type: "progress",
        attemptId: crypto.randomUUID(),
        questionIndex: 0,
        questionSetVersion: CURRENT_QUESTION_SET_VERSION,
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
    questionSetVersionOverride?: number,
    questionOverride?: Readonly<RawQuizQuestion>,
  ): Promise<QuizQuestionStart> {
    const progress = await this.#verify(progressToken, "progress");
    if (progress.questionIndex !== index) {
      throw new ApiError(
        409,
        "QUIZ_SEQUENCE_MISMATCH",
        "Quiz questions must be answered in order",
      );
    }

    const now = this.#now();
    const questionSetVersion = questionSetVersionOverride ?? progress.questionSetVersion ??
      LEGACY_QUESTION_SET_VERSION;
    const selectedQuestion = questionSetVersion === DATABASE_QUESTION_SET_VERSION
      ? questionOverride ?? databaseQuestion("")
      : questionAt(index, questionSetVersion);
    const answerTimeSeconds = answerTimeSecondsOverride ??
      (questionSetVersion === CURRENT_QUESTION_SET_VERSION
        ? this.answerTimeSecondsAt(index)
        : selectedQuestion.answerTimeSeconds);
    if (!Number.isFinite(answerTimeSeconds) || answerTimeSeconds < 0) {
      throw new ApiError(500, "QUIZ_CONFIG_MISMATCH", "Quiz answer time is invalid");
    }
    const answerRevealAt = revealAt ?? now + answerTimeSeconds * 1000;
    if (!Number.isFinite(answerRevealAt)) {
      throw new ApiError(400, "INVALID_REVEAL_TIME", "Quiz reveal time is invalid");
    }
    const questionVariantId = variantId ?? progress.attemptId;
    const question = await this.#shuffledQuestion(
      index,
      questionVariantId,
      questionSetVersion,
      selectedQuestion.id,
      questionOverride,
    );
    return {
      question: publicQuestion(index, question),
      questionToken: await this.#sign({
        type: "question",
        attemptId: progress.attemptId,
        questionIndex: index,
        revealAt: answerRevealAt,
        expiresAt: progress.expiresAt,
        variantId: questionVariantId,
        questionSetVersion,
        questionId: question.id,
      }),
      answerTimeSeconds,
    };
  }

  async gradeQuestion(
    index: number,
    questionToken: string,
    selectedOption: number | null,
    trustedRevealAt?: number,
    questionOverride?: Readonly<RawQuizQuestion>,
  ): Promise<QuizGradeResult> {
    const token = await this.#verify(questionToken, "question");
    if (token.questionIndex !== index) {
      throw new ApiError(409, "QUIZ_TOKEN_MISMATCH", "Quiz token does not match the question");
    }
    if (questionOverride && token.questionId !== questionOverride.id) {
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
      token.questionSetVersion ?? LEGACY_QUESTION_SET_VERSION,
      token.questionId,
      questionOverride,
    );
    const questionSetVersion = token.questionSetVersion ?? LEGACY_QUESTION_SET_VERSION;
    const nextIndex = index + 1;
    const questionCount = questionSetVersion === DATABASE_QUESTION_SET_VERSION
      ? this.config.questionCount
      : questionsForVersion(questionSetVersion).length;
    const nextProgressToken = nextIndex < questionCount
      ? await this.#sign({
        type: "progress",
        attemptId: token.attemptId,
        questionIndex: nextIndex,
        expiresAt: token.expiresAt,
        questionSetVersion,
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
    questionSetVersion = CURRENT_QUESTION_SET_VERSION,
    questionOverrides?: readonly Readonly<RawQuizQuestion>[],
  ): Promise<QuizScore> {
    const selectedQuestions = questionSetVersion === DATABASE_QUESTION_SET_VERSION
      ? questionOverrides
      : questionsForVersion(questionSetVersion);
    if (
      !selectedQuestions ||
      !Number.isSafeInteger(questionCount) || questionCount < 1 ||
      questionCount > selectedQuestions.length
    ) {
      throw new ApiError(500, "QUIZ_CONFIG_MISMATCH", "Session question count is invalid");
    }

    const categoryTotals = new Map<string, { correct: number; total: number }>();
    let answeredCount = 0;
    let correctCount = 0;
    let correctWeight = 0;
    let totalWeight = 0;

    for (let index = 0; index < questionCount; index += 1) {
      const question = await this.#shuffledQuestion(
        index,
        variantId,
        questionSetVersion,
        questionOverrides?.[index]?.id,
        questionOverrides?.[index],
      );
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

  async #shuffledQuestion(
    index: number,
    variantId: string,
    questionSetVersion = CURRENT_QUESTION_SET_VERSION,
    questionId?: string,
    questionOverride?: Readonly<RawQuizQuestion>,
  ): Promise<Readonly<RawQuizQuestion>> {
    if (!variantId || variantId.length > 128) {
      throw new ApiError(400, "INVALID_QUIZ_VARIANT", "Quiz variant is invalid");
    }

    const question = questionSetVersion === DATABASE_QUESTION_SET_VERSION
      ? questionOverride ?? databaseQuestion(questionId ?? "")
      : questionAt(index, questionSetVersion);
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

  async #accessTokenHash(accessToken: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(accessToken));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }

  async #verify<Type extends TokenPayload["type"]>(
    token: string,
    expectedType: Type,
  ): Promise<Extract<TokenPayload, { type: Type }>> {
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
      return payload as Extract<TokenPayload, { type: Type }>;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(401, "INVALID_QUIZ_TOKEN", "Quiz token is invalid");
    }
  }
}

export function createQuizService(options: QuizServiceOptions = {}): QuizService {
  return new QuizService(options);
}

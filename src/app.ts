import { serveDir } from "@std/http/file-server";
import { ApiError } from "./errors.ts";
import type { DatabaseMetricsSnapshot } from "./db/metrics.ts";
import type {
  GameGenre,
  GameRepository,
  ParticipantQuestionPlan,
  SessionResults,
} from "./types.ts";
import { broadcast, handleWsUpgrade } from "./ws.ts";
import { scheduleQuestionAdvance, triggerEarlyQuestionEnd } from "./questionLoop.ts";
import {
  createQuizService,
  LEGACY_CHOICE_ORDER_VARIANT,
  questionSetVersionForChoiceOrder,
  type QuizService,
  safetyFromCategoryScores,
} from "./quiz.ts";

const MAX_JSON_BODY_BYTES = 16 * 1024;
const FIRST_QUESTION_START_DELAY_MS = 3_000;
const QUESTION_PLAN_CACHE_TTL_MS = 15 * 60 * 1_000;
const QUESTION_PLAN_CACHE_MAX_ENTRIES = 1_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECURITY_HEADERS = Object.freeze({
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; " +
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

interface AppOptions {
  staticRoot?: string;
  assetRoot?: string;
  quizService?: QuizService;
  databaseMetrics?: () => DatabaseMetricsSnapshot;
}

interface JsonRecord {
  [key: string]: unknown;
}

class ParticipantQuestionPlanCache {
  readonly #entries = new Map<
    string,
    { expiresAt: number; value: Promise<ParticipantQuestionPlan> }
  >();
  #hits = 0;
  #misses = 0;

  constructor(private readonly repository: GameRepository) {}

  async get(sessionId: string, accessToken: string): Promise<ParticipantQuestionPlan> {
    const tokenDigest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(accessToken),
    );
    const key = `${sessionId}:${
      Array.from(new Uint8Array(tokenDigest), (byte) => byte.toString(16).padStart(2, "0")).join("")
    }`;
    const now = Date.now();
    const cached = this.#entries.get(key);
    if (cached && cached.expiresAt > now) {
      this.#hits += 1;
      return await cached.value;
    }
    if (cached) this.#entries.delete(key);

    this.#misses += 1;
    const value = this.repository.getParticipantQuestionPlan(sessionId, accessToken);
    const entry = { expiresAt: now + QUESTION_PLAN_CACHE_TTL_MS, value };
    this.#entries.set(key, entry);
    if (this.#entries.size > QUESTION_PLAN_CACHE_MAX_ENTRIES) {
      this.#entries.delete(this.#entries.keys().next().value!);
    }
    try {
      return await value;
    } catch (error) {
      if (this.#entries.get(key) === entry) this.#entries.delete(key);
      throw error;
    }
  }

  snapshot(): { hits: number; misses: number; entries: number; hitRate: number } {
    const lookups = this.#hits + this.#misses;
    return {
      hits: this.#hits,
      misses: this.#misses,
      entries: this.#entries.size,
      hitRate: lookups ? Math.round((this.#hits / lookups) * 1_000) / 1_000 : 0,
    };
  }
}

class SessionAuthMetrics {
  #signedTokenHits = 0;
  #databaseFallbacks = 0;

  recordSignedTokenHit(): void {
    this.#signedTokenHits += 1;
  }

  recordDatabaseFallback(): void {
    this.#databaseFallbacks += 1;
  }

  snapshot(): { signedTokenHits: number; databaseFallbacks: number; hitRate: number } {
    const checks = this.#signedTokenHits + this.#databaseFallbacks;
    return {
      signedTokenHits: this.#signedTokenHits,
      databaseFallbacks: this.#databaseFallbacks,
      hitRate: checks ? Math.round((this.#signedTokenHits / checks) * 1_000) / 1_000 : 0,
    };
  }
}

function json(payload: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

function secureStaticResponse(response: Response): Response {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

function apiErrorResponse(error: ApiError): Response {
  return json(
    { error: { code: error.code, message: error.message } },
    error.status,
  );
}

async function readJsonObject(request: Request): Promise<JsonRecord> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_JSON_BODY_BYTES) {
    throw new ApiError(413, "BODY_TOO_LARGE", "JSON body is too large");
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
  if (contentType !== "application/json") {
    throw new ApiError(415, "JSON_REQUIRED", "Content-Type must be application/json");
  }

  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          totalBytes += value.byteLength;
          if (totalBytes > MAX_JSON_BODY_BYTES) {
            await reader.cancel();
            throw new ApiError(413, "BODY_TOO_LARGE", "JSON body is too large");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ApiError(400, "INVALID_JSON", "JSON body must be an object");
    }
    return value as JsonRecord;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "INVALID_JSON", "Request body is not valid JSON");
  }
}

function displayNameFrom(body: JsonRecord): string {
  if (typeof body.displayName !== "string") {
    throw new ApiError(400, "INVALID_DISPLAY_NAME", "displayName is required");
  }

  const displayName = body.displayName.trim();
  const length = Array.from(displayName).length;
  if (length < 1 || length > 50) {
    throw new ApiError(
      400,
      "INVALID_DISPLAY_NAME",
      "displayName must contain between 1 and 50 characters",
    );
  }
  return displayName;
}

function crewColorFrom(body: JsonRecord): string {
  if (typeof body.crewColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(body.crewColor)) {
    throw new ApiError(400, "INVALID_CREW_COLOR", "crewColor must be a six-digit hex color");
  }
  return body.crewColor.toLowerCase();
}

function selectedOptionFrom(body: JsonRecord): number {
  const option = body.selectedOption;
  if (!Number.isInteger(option) || typeof option !== "number" || option < 0 || option > 3) {
    throw new ApiError(400, "INVALID_SELECTED_OPTION", "selectedOption must be 0, 1, 2, or 3");
  }
  return option;
}

function publishedFrom(body: JsonRecord): boolean {
  if (typeof body.published !== "boolean") {
    throw new ApiError(400, "INVALID_PUBLICATION", "published must be a boolean");
  }
  return body.published;
}

function quizTokenFrom(body: JsonRecord, key: "progressToken" | "questionToken"): string {
  const token = body[key];
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) {
    throw new ApiError(400, "INVALID_QUIZ_TOKEN", `${key} is required`);
  }
  return token;
}

function sessionAuthTokenFrom(body: JsonRecord): string | null {
  const token = body.sessionAuthToken;
  if (token === undefined || token === null) return null;
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) {
    throw new ApiError(400, "INVALID_SESSION_AUTH_TOKEN", "sessionAuthToken is invalid");
  }
  return token;
}

function quizSelectedOptionFrom(body: JsonRecord): number | null {
  if (body.selectedOption === null) return null;
  return selectedOptionFrom(body);
}

const GAME_GENRES: readonly GameGenre[] = ["web", "linebot", "modeling", "game"];

function genreFrom(body: JsonRecord): GameGenre {
  const genre = body.genre;
  if (typeof genre !== "string" || !GAME_GENRES.includes(genre as GameGenre)) {
    throw new ApiError(
      400,
      "INVALID_GENRE",
      `genre must be one of: ${GAME_GENRES.join(", ")}`,
    );
  }
  return genre as GameGenre;
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,})$/);
  if (!match) {
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "A bearer token is required");
  }
  return match[1];
}

function roomCode(rawCode: string): string {
  const code = rawCode.toUpperCase();
  if (!/^[A-Z0-9]{6,8}$/.test(code)) {
    throw new ApiError(400, "INVALID_ROOM_CODE", "Room code must be 6 to 8 letters or digits");
  }
  return code;
}

function sessionId(rawId: string): string {
  if (!UUID_PATTERN.test(rawId)) {
    throw new ApiError(400, "INVALID_SESSION_ID", "sessionId must be a UUID");
  }
  return rawId;
}

function questionIndex(rawIndex: string): number {
  if (!/^\d+$/.test(rawIndex)) {
    throw new ApiError(
      400,
      "INVALID_QUESTION_INDEX",
      "questionIndex must be a non-negative integer",
    );
  }
  const index = Number(rawIndex);
  if (!Number.isSafeInteger(index) || index > 32_767) {
    throw new ApiError(400, "INVALID_QUESTION_INDEX", "questionIndex is outside the valid range");
  }
  return index;
}

function choiceOrderVariant(session: { id: string; choiceOrderVersion: number }): string {
  return session.choiceOrderVersion >= 2 ? session.id : LEGACY_CHOICE_ORDER_VARIANT;
}

function participantChoiceOrderVariant(
  session: { id: string; choiceOrderVersion: number },
  participantId: string,
): string {
  return session.choiceOrderVersion >= 4
    ? `${session.id}:${participantId}`
    : choiceOrderVariant(session);
}

function needsQuestionTimer(session: {
  status: string;
  questionStartedAt: string | null;
  reviewEndsAt: string | null;
}): boolean {
  if (session.status !== "active") return false;
  if (session.reviewEndsAt) return Date.parse(session.reviewEndsAt) > Date.now();
  return Boolean(
    session.questionStartedAt && Date.parse(session.questionStartedAt) >= Date.now() - 1_000,
  );
}

async function loadAuthorizedSession(
  repository: GameRepository,
  quizService: QuizService,
  requestedSessionId: string,
  accessToken: string,
  sessionAuthToken: string | null,
  metrics: SessionAuthMetrics,
): Promise<{ session: Awaited<ReturnType<GameRepository["getSessionSnapshot"]>>; token: string }> {
  if (
    sessionAuthToken &&
    await quizService.isSessionAuthTokenValid(
      sessionAuthToken,
      requestedSessionId,
      accessToken,
    )
  ) {
    metrics.recordSignedTokenHit();
    return {
      session: await repository.getSessionSnapshot(
        requestedSessionId,
        quizService.config.reviewTimeSeconds,
      ),
      token: sessionAuthToken,
    };
  }

  metrics.recordDatabaseFallback();
  const session = await repository.getSessionForParticipant(
    requestedSessionId,
    accessToken,
    quizService.config.reviewTimeSeconds,
  );
  return {
    session,
    token: await quizService.createSessionAuthToken(session.id, accessToken),
  };
}

async function handleApi(
  request: Request,
  repository: GameRepository,
  quizService: QuizService,
  questionPlanCache: ParticipantQuestionPlanCache,
  sessionAuthMetrics: SessionAuthMetrics,
  databaseMetrics?: () => DatabaseMetricsSnapshot,
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (request.method === "GET" && pathname === "/api/health") {
    try {
      await repository.healthCheck();
      return json({
        status: "ok",
        database: "up",
        ...(databaseMetrics
          ? {
            metrics: {
              database: databaseMetrics(),
              questionPlanCache: questionPlanCache.snapshot(),
              sessionAuth: sessionAuthMetrics.snapshot(),
            },
          }
          : {}),
      });
    } catch (error) {
      console.error("Database health check failed", error);
      return json(
        { error: { code: "DATABASE_UNAVAILABLE", message: "Database is unavailable" } },
        503,
      );
    }
  }

  if (request.method === "GET" && pathname === "/api/quiz/config") {
    return json({ data: quizService.config });
  }

  if (request.method === "POST" && pathname === "/api/quiz/attempts") {
    return json({ data: await quizService.createAttempt() }, 201);
  }

  const quizStartMatch = pathname.match(/^\/api\/quiz\/questions\/([^/]+)\/start$/);
  if (request.method === "POST" && quizStartMatch) {
    const body = await readJsonObject(request);
    return json({
      data: await quizService.startQuestion(
        questionIndex(quizStartMatch[1]),
        quizTokenFrom(body, "progressToken"),
      ),
    });
  }

  const quizGradeMatch = pathname.match(/^\/api\/quiz\/questions\/([^/]+)\/grade$/);
  if (request.method === "POST" && quizGradeMatch) {
    const body = await readJsonObject(request);
    return json({
      data: await quizService.gradeQuestion(
        questionIndex(quizGradeMatch[1]),
        quizTokenFrom(body, "questionToken"),
        quizSelectedOptionFrom(body),
      ),
    });
  }

  if (request.method === "POST" && pathname === "/api/rooms") {
    const body = await readJsonObject(request);
    return json({
      data: await repository.createRoom(displayNameFrom(body), crewColorFrom(body)),
    }, 201);
  }

  const roomParticipantsMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/participants$/);
  if (request.method === "POST" && roomParticipantsMatch) {
    const body = await readJsonObject(request);
    const result = await repository.joinRoom(
      roomCode(decodeURIComponent(roomParticipantsMatch[1])),
      displayNameFrom(body),
      crewColorFrom(body),
    );
    broadcast(result.room.id, {
      type: "player_joined",
      participantId: result.participant.id,
      displayName: result.participant.displayName,
      crewColor: result.participant.crewColor,
      role: result.participant.role,
    });
    return json({ data: result }, 201);
  }

  const roomGenreMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/genre$/);
  if (request.method === "PUT" && roomGenreMatch) {
    const body = await readJsonObject(request);
    const result = await repository.selectGenre(
      roomCode(decodeURIComponent(roomGenreMatch[1])),
      bearerToken(request),
      genreFrom(body),
    );
    broadcast(result.id, { type: "field_selected", genre: result.genre });
    return json({ data: result });
  }

  const roomSessionsMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/sessions$/);
  if (request.method === "POST" && roomSessionsMatch) {
    const result = await repository.startSession(
      roomCode(decodeURIComponent(roomSessionsMatch[1])),
      bearerToken(request),
      quizService.config.questionCount,
      quizService.config.answerTimeSecondsByQuestion,
      FIRST_QUESTION_START_DELAY_MS,
    );
    broadcast(result.roomId, { type: "host_started", session: result });
    // startSessionの時点で1問目(index 0)がすでに開始されているので、
    // question_startedの配信とタイマー予約もここで行う。
    if (result.currentQuestionIndex !== null) {
      broadcast(result.roomId, {
        type: "question_started",
        sessionId: result.id,
        questionIndex: result.currentQuestionIndex,
        timeLimitSeconds: result.answerTimeSeconds,
        questionStartedAt: result.questionStartedAt,
      });
      scheduleQuestionAdvance(repository, result, quizService.config.reviewTimeSeconds * 1000);
    }
    return json({ data: result }, 201);
  }

  const roomMatch = pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (request.method === "GET" && roomMatch) {
    const code = roomCode(decodeURIComponent(roomMatch[1]));
    await repository.authenticateParticipant(code, bearerToken(request));
    return json({ data: await repository.getRoom(code) });
  }

  const sessionResultsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/results$/);
  if (request.method === "GET" && sessionResultsMatch) {
    const source = await repository.getSessionResultSource(
      sessionId(decodeURIComponent(sessionResultsMatch[1])),
      bearerToken(request),
    );
    const participants = await Promise.all(source.participants.map(async (participant) => {
      const selectedOptions: (number | null)[] = Array(source.session.questionCount).fill(null);
      for (const answer of participant.answers) {
        if (answer.questionIndex >= 0 && answer.questionIndex < selectedOptions.length) {
          selectedOptions[answer.questionIndex] = answer.selectedOption;
        }
      }
      const score = await quizService.scoreAnswers(
        source.session.questionCount,
        selectedOptions,
        participantChoiceOrderVariant(source.session, participant.participantId),
        questionSetVersionForChoiceOrder(source.session.choiceOrderVersion),
        participant.questions,
      );
      const responseTimes = participant.answers.map((answer) => answer.responseTimeMs);
      return {
        participantId: participant.participantId,
        displayName: participant.displayName,
        crewColor: participant.crewColor,
        role: participant.role,
        ...score,
        averageResponseTimeMs: responseTimes.length
          ? Math.round(
            responseTimes.reduce((sum, responseTime) => sum + responseTime, 0) /
              responseTimes.length,
          )
          : null,
      };
    }));
    participants.sort((left, right) =>
      right.power - left.power || right.safety - left.safety ||
      (left.averageResponseTimeMs ?? Number.MAX_SAFE_INTEGER) -
        (right.averageResponseTimeMs ?? Number.MAX_SAFE_INTEGER)
    );
    const personal = participants.find((participant) =>
      participant.participantId === source.requesterParticipantId
    );
    if (!personal) {
      throw new ApiError(500, "RESULT_PARTICIPANT_MISSING", "Participant result is missing");
    }
    const categoryNames = [
      ...new Set(participants.flatMap((participant) => Object.keys(participant.categoryScores))),
    ];
    const teamCategoryScores = Object.fromEntries(categoryNames.map((category) => [
      category,
      participants.length
        ? Math.round(
          participants.reduce(
            (sum, participant) => sum + (participant.categoryScores[category] ?? 0),
            0,
          ) / participants.length,
        )
        : 0,
    ]));
    const answeredCount = participants.reduce(
      (sum, participant) => sum + participant.answeredCount,
      0,
    );
    const possibleAnswerCount = participants.length * source.session.questionCount;
    const teamPower = participants.length
      ? Math.round(
        participants.reduce((sum, participant) => sum + participant.power, 0) /
          participants.length,
      )
      : 0;
    const teamSafety = safetyFromCategoryScores(Object.values(teamCategoryScores));
    const sharedParticipants = source.participants.map((sourceParticipant) => {
      const participant = participants.find((candidate) =>
        candidate.participantId === sourceParticipant.participantId
      );
      if (!participant) {
        throw new ApiError(500, "RESULT_PARTICIPANT_MISSING", "Participant result is missing");
      }
      const isRequester = participant.participantId === source.requesterParticipantId;
      const published = sourceParticipant.resultPublished;
      const identity = {
        participantId: participant.participantId,
        displayName: participant.displayName,
        crewColor: participant.crewColor,
        role: participant.role,
        isRequester,
        published,
      };
      return isRequester || published ? { ...identity, ...participant } : identity;
    });
    const results: SessionResults = {
      sessionId: source.session.id,
      questionCount: source.session.questionCount,
      personal,
      team: {
        participantCount: participants.length,
        answeredCount,
        possibleAnswerCount,
        completionRate: possibleAnswerCount
          ? Math.round((answeredCount / possibleAnswerCount) * 100)
          : 0,
        detailsAvailable: true,
        power: teamPower,
        safety: teamSafety,
        categoryScores: teamCategoryScores,
      },
      participants: sharedParticipants,
    };
    return json({ data: results });
  }

  const resultPublicationMatch = pathname.match(
    /^\/api\/sessions\/([^/]+)\/results\/publication$/,
  );
  if (request.method === "PUT" && resultPublicationMatch) {
    const body = await readJsonObject(request);
    const result = await repository.setResultPublication(
      sessionId(decodeURIComponent(resultPublicationMatch[1])),
      bearerToken(request),
      publishedFrom(body),
    );
    broadcast(result.roomId, {
      type: "result_publication_changed",
      published: result.published,
    });
    return json({ data: { published: result.published } });
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (request.method === "GET" && sessionMatch) {
    const accessToken = bearerToken(request);
    const result = await repository.getSessionForParticipant(
      sessionId(decodeURIComponent(sessionMatch[1])),
      accessToken,
      quizService.config.reviewTimeSeconds,
    );
    if (needsQuestionTimer(result)) {
      scheduleQuestionAdvance(repository, result, quizService.config.reviewTimeSeconds * 1000);
    }
    return json({
      data: {
        ...result,
        sessionAuthToken: await quizService.createSessionAuthToken(result.id, accessToken),
      },
    });
  }

  const multiplayerQuizStartMatch = pathname.match(
    /^\/api\/sessions\/([^/]+)\/quiz\/questions\/([^/]+)\/start$/,
  );
  if (request.method === "POST" && multiplayerQuizStartMatch) {
    const requestedIndex = questionIndex(multiplayerQuizStartMatch[2]);
    const requestedSessionId = sessionId(multiplayerQuizStartMatch[1]);
    const accessToken = bearerToken(request);
    const body = await readJsonObject(request);
    const authorization = await loadAuthorizedSession(
      repository,
      quizService,
      requestedSessionId,
      accessToken,
      sessionAuthTokenFrom(body),
      sessionAuthMetrics,
    );
    const session = authorization.session;
    if (
      session.status === "cancelled" || session.currentQuestionIndex === null ||
      requestedIndex > session.currentQuestionIndex || requestedIndex >= session.questionCount
    ) {
      throw new ApiError(
        409,
        "QUESTION_NOT_AVAILABLE",
        "This question is not available in the room session",
      );
    }

    const plan = session.choiceOrderVersion >= 4
      ? await questionPlanCache.get(session.id, accessToken)
      : null;
    const selectedQuestion = plan?.questions[requestedIndex];
    if (plan && !selectedQuestion) {
      throw new ApiError(404, "QUIZ_QUESTION_NOT_FOUND", "Stored quiz question not found");
    }
    const revealAt = session.status === "active" &&
        requestedIndex === session.currentQuestionIndex && session.questionStartedAt
      ? Date.parse(session.questionStartedAt) + session.answerTimeSeconds * 1000
      : Date.now();
    return json({
      data: {
        ...await quizService.startQuestion(
          requestedIndex,
          quizTokenFrom(body, "progressToken"),
          revealAt,
          plan
            ? participantChoiceOrderVariant(session, plan.participantId)
            : choiceOrderVariant(session),
          session.answerTimeSeconds,
          questionSetVersionForChoiceOrder(session.choiceOrderVersion),
          selectedQuestion,
        ),
        sessionAuthToken: authorization.token,
      },
    });
  }

  const startQuestionMatch = pathname.match(
    /^\/api\/sessions\/([^/]+)\/questions\/([^/]+)\/start$/,
  );
  if (request.method === "POST" && startQuestionMatch) {
    const requestedIndex = questionIndex(startQuestionMatch[2]);
    const result = await repository.startQuestion(
      sessionId(startQuestionMatch[1]),
      bearerToken(request),
      requestedIndex,
    );
    broadcast(result.roomId, {
      type: "question_started",
      sessionId: result.id,
      questionIndex: result.currentQuestionIndex ?? requestedIndex,
      timeLimitSeconds: result.answerTimeSeconds,
      questionStartedAt: result.questionStartedAt,
    });
    scheduleQuestionAdvance(repository, result, quizService.config.reviewTimeSeconds * 1000);
    return json({ data: result });
  }

  const multiplayerQuizGradeMatch = pathname.match(
    /^\/api\/sessions\/([^/]+)\/quiz\/questions\/([^/]+)\/grade$/,
  );
  if (request.method === "POST" && multiplayerQuizGradeMatch) {
    const requestedIndex = questionIndex(multiplayerQuizGradeMatch[2]);
    const requestedSessionId = sessionId(multiplayerQuizGradeMatch[1]);
    const accessToken = bearerToken(request);
    const body = await readJsonObject(request);
    const authorization = await loadAuthorizedSession(
      repository,
      quizService,
      requestedSessionId,
      accessToken,
      sessionAuthTokenFrom(body),
      sessionAuthMetrics,
    );
    const session = authorization.session;
    if (session.currentQuestionIndex === null || requestedIndex > session.currentQuestionIndex) {
      throw new ApiError(
        409,
        "QUESTION_NOT_AVAILABLE",
        "This question is not available in the room session",
      );
    }
    const trustedRevealAt = requestedIndex < session.currentQuestionIndex ||
        session.status === "completed"
      ? Date.now()
      : session.questionReviewStartedAt
      ? Date.parse(session.questionReviewStartedAt)
      : undefined;
    const plan = session.choiceOrderVersion >= 4
      ? await questionPlanCache.get(session.id, accessToken)
      : null;
    const selectedQuestion = plan?.questions[requestedIndex];
    if (plan && !selectedQuestion) {
      throw new ApiError(404, "QUIZ_QUESTION_NOT_FOUND", "Stored quiz question not found");
    }
    return json({
      data: {
        ...await quizService.gradeQuestion(
          requestedIndex,
          quizTokenFrom(body, "questionToken"),
          quizSelectedOptionFrom(body),
          trustedRevealAt,
          selectedQuestion,
        ),
        sessionAuthToken: authorization.token,
      },
    });
  }

  const answerMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/answers\/([^/]+)$/);
  if (request.method === "PUT" && answerMatch) {
    const body = await readJsonObject(request);
    const requestedSessionId = sessionId(answerMatch[1]);
    const requestedQuestionIndex = questionIndex(answerMatch[2]);
    const result = await repository.submitAnswer(
      requestedSessionId,
      bearerToken(request),
      requestedQuestionIndex,
      selectedOptionFrom(body),
    );
    if (result.allParticipantsAnswered) {
      await triggerEarlyQuestionEnd(
        repository,
        requestedSessionId,
        requestedQuestionIndex,
        quizService.config.reviewTimeSeconds * 1000,
      );
    }
    return json({ data: result });
  }

  const completeSessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/complete$/);
  if (request.method === "POST" && completeSessionMatch) {
    const result = await repository.completeSession(
      sessionId(completeSessionMatch[1]),
      bearerToken(request),
    );
    broadcast(result.roomId, { type: "all_questions_done" });
    return json({ data: result });
  }

  throw new ApiError(404, "API_NOT_FOUND", "API endpoint not found");
}

export function createApp(
  repository: GameRepository,
  options: AppOptions = {},
): (request: Request) => Promise<Response> {
  const staticRoot = options.staticRoot ?? "public";
  const assetRoot = options.assetRoot ?? "assets";
  const quizService = options.quizService ?? createQuizService();
  const questionPlanCache = new ParticipantQuestionPlanCache(repository);
  const sessionAuthMetrics = new SessionAuthMetrics();

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/ws") {
      try {
        const upgraded = await handleWsUpgrade(request, url, repository);
        if (upgraded) return upgraded;
        return apiErrorResponse(
          new ApiError(400, "WS_AUTH_REQUIRED", "WebSocket room and authentication are required"),
        );
      } catch (error) {
        if (error instanceof ApiError) return apiErrorResponse(error);
        throw error;
      }
    }

    if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
      return new Response(null, {
        status: 204,
        headers: { allow: "GET, POST, PUT, OPTIONS" },
      });
    }

    if (pathname.startsWith("/api/")) {
      try {
        return await handleApi(
          request,
          repository,
          quizService,
          questionPlanCache,
          sessionAuthMetrics,
          options.databaseMetrics,
        );
      } catch (error) {
        if (error instanceof ApiError) return apiErrorResponse(error);
        if (error instanceof URIError) {
          return apiErrorResponse(new ApiError(400, "INVALID_PATH", "Path is malformed"));
        }
        console.error("Unhandled API error", error);
        return json(
          { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
          500,
        );
      }
    }

    if (request.method === "GET" && pathname === "/welcome-message") {
      return new Response("jigインターンへようこそ！");
    }

    if (pathname.startsWith("/assets/")) {
      const assetResponse = await serveDir(request, {
        fsRoot: assetRoot,
        urlRoot: "assets",
        showDirListing: false,
        quiet: true,
      });
      if (assetResponse.status !== 404) return secureStaticResponse(assetResponse);

      // Some deploy targets keep browser assets under public/assets instead.
      await assetResponse.body?.cancel();
      return secureStaticResponse(
        await serveDir(request, {
          fsRoot: staticRoot,
          urlRoot: "",
          showDirListing: false,
          quiet: true,
        }),
      );
    }

    return secureStaticResponse(
      await serveDir(request, {
        fsRoot: staticRoot,
        urlRoot: "",
        showDirListing: false,
        quiet: true,
      }),
    );
  };
}

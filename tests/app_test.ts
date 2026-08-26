import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { ApiError } from "../src/errors.ts";
import { createQuizService } from "../src/quiz.ts";
import type {
  AnswerSummary,
  AuthenticatedParticipant,
  GameGenre,
  GameRepository,
  GameSessionSummary,
  MembershipResult,
  RoomDetail,
  RoomSummary,
  SessionResultSource,
} from "../src/types.ts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "test_access_token_that_is_long_enough";
const NOW = "2026-08-21T00:00:00.000Z";

const membership: MembershipResult = {
  room: {
    id: "22222222-2222-4222-8222-222222222222",
    code: "ABC234",
    status: "lobby",
    genre: "web",
    createdAt: NOW,
  },
  participant: {
    id: "33333333-3333-4333-8333-333333333333",
    displayName: "テストユーザー",
    role: "host",
    joinedAt: NOW,
  },
  accessToken: TOKEN,
};

const session: GameSessionSummary = {
  id: SESSION_ID,
  roomId: membership.room.id,
  sessionNumber: 1,
  status: "active",
  questionCount: 12,
  choiceOrderVersion: 2,
  answerTimeSeconds: 15,
  questionAnswerTimeSeconds: Array(12).fill(15),
  currentQuestionIndex: 0,
  questionStartedAt: NOW,
  questionReviewStartedAt: null,
  reviewEndsAt: null,
  startedAt: NOW,
  finishedAt: null,
};

class FakeRepository implements GameRepository {
  createdDisplayName: string | null = null;
  joinedRoomCode: string | null = null;
  submittedOption: number | null = null;
  startedQuestionCount: number | null = null;
  startedAnswerTimeSeconds: readonly number[] | null = null;
  startedDelayMs: number | null = null;
  sessionToStart: GameSessionSummary = session;
  sessionForParticipant: GameSessionSummary = session;
  sessionResultChoiceOrderVersion = 2;
  resultRequesterParticipantId = membership.participant.id;
  resultParticipants: SessionResultSource["participants"] = [{
    participantId: membership.participant.id,
    displayName: membership.participant.displayName,
    role: membership.participant.role,
    resultPublished: false,
    answers: [
      { questionIndex: 0, selectedOption: 0, responseTimeMs: 500 },
      { questionIndex: 1, selectedOption: 3, responseTimeMs: 700 },
    ],
  }];

  healthCheck(): Promise<void> {
    return Promise.resolve();
  }

  createRoom(displayName: string): Promise<MembershipResult> {
    this.createdDisplayName = displayName;
    return Promise.resolve(membership);
  }

  joinRoom(code: string, _displayName: string): Promise<MembershipResult> {
    this.joinedRoomCode = code;
    return Promise.resolve(membership);
  }

  getRoom(_code: string): Promise<RoomDetail> {
    return Promise.resolve({
      ...membership.room,
      participants: [membership.participant],
      activeSession: null,
    });
  }

  authenticateParticipant(
    _roomCode: string,
    accessToken: string,
  ): Promise<AuthenticatedParticipant> {
    if (accessToken !== TOKEN) {
      throw new ApiError(401, "AUTHENTICATION_FAILED", "Invalid room code or access token");
    }
    return Promise.resolve({ roomId: membership.room.id, participant: membership.participant });
  }

  selectedGenre: GameGenre | null = null;

  selectGenre(_code: string, accessToken: string, genre: GameGenre): Promise<RoomSummary> {
    if (accessToken !== TOKEN) {
      throw new ApiError(403, "HOST_REQUIRED", "A valid host token is required");
    }
    this.selectedGenre = genre;
    return Promise.resolve({ ...membership.room, genre });
  }

  startSession(
    _code: string,
    _accessToken: string,
    questionCount: number,
    answerTimeSeconds: readonly number[],
    startDelayMs: number,
  ): Promise<GameSessionSummary> {
    this.startedQuestionCount = questionCount;
    this.startedAnswerTimeSeconds = answerTimeSeconds;
    this.startedDelayMs = startDelayMs;
    return Promise.resolve(this.sessionToStart);
  }

  getSessionForParticipant(
    _sessionId: string,
    accessToken: string,
  ): Promise<GameSessionSummary> {
    if (accessToken !== TOKEN) {
      throw new ApiError(403, "PARTICIPANT_REQUIRED", "A valid participant token is required");
    }
    return Promise.resolve(this.sessionForParticipant);
  }

  getSessionResultSource(
    _sessionId: string,
    accessToken: string,
  ): Promise<SessionResultSource> {
    if (accessToken !== TOKEN) {
      throw new ApiError(403, "PARTICIPANT_REQUIRED", "A valid participant token is required");
    }
    return Promise.resolve({
      session: {
        ...session,
        status: "completed",
        choiceOrderVersion: this.sessionResultChoiceOrderVersion,
        finishedAt: NOW,
      },
      requesterParticipantId: this.resultRequesterParticipantId,
      participants: this.resultParticipants,
    });
  }

  publishedResult: boolean | null = null;

  setResultPublication(
    _sessionId: string,
    accessToken: string,
    published: boolean,
  ): Promise<{ roomId: string; published: boolean }> {
    if (accessToken !== TOKEN) {
      throw new ApiError(403, "RESULT_PUBLICATION_FORBIDDEN", "Invalid participant token");
    }
    this.publishedResult = published;
    return Promise.resolve({ roomId: membership.room.id, published });
  }

  startQuestion(
    _sessionId: string,
    _accessToken: string,
    questionIndex: number,
  ): Promise<GameSessionSummary> {
    return Promise.resolve({ ...session, currentQuestionIndex: questionIndex });
  }

  submitAnswer(
    _sessionId: string,
    _accessToken: string,
    questionIndex: number,
    selectedOption: number,
  ): Promise<AnswerSummary> {
    this.submittedOption = selectedOption;
    return Promise.resolve({
      id: "44444444-4444-4444-8444-444444444444",
      gameSessionId: SESSION_ID,
      participantId: membership.participant.id,
      questionIndex,
      selectedOption,
      responseTimeMs: 500,
      answeredAt: NOW,
      allParticipantsAnswered: this.allParticipantsAnsweredOnSubmit,
    });
  }

  allParticipantsAnsweredOnSubmit = false;
  reviewedQuestionIndexes: number[] = [];

  beginQuestionReview(
    _sessionId: string,
    questionIndex: number,
    reviewTimeMs: number,
  ): Promise<GameSessionSummary | null> {
    this.reviewedQuestionIndexes.push(questionIndex);
    const reviewStartedAt = new Date().toISOString();
    return Promise.resolve({
      ...session,
      currentQuestionIndex: questionIndex,
      questionReviewStartedAt: reviewStartedAt,
      reviewEndsAt: new Date(Date.parse(reviewStartedAt) + reviewTimeMs).toISOString(),
    });
  }

  completeSession(_sessionId: string, _accessToken: string): Promise<GameSessionSummary> {
    return Promise.resolve({ ...session, status: "completed", finishedAt: NOW });
  }

  advanceQuestionAutomatically(
    _sessionId: string,
    fromIndex: number,
  ): Promise<GameSessionSummary | null> {
    return Promise.resolve({ ...session, currentQuestionIndex: fromIndex + 1 });
  }

  completeSessionAutomatically(_sessionId: string): Promise<GameSessionSummary | null> {
    return Promise.resolve({ ...session, status: "completed", finishedAt: NOW });
  }

  disconnectedParticipantIds: string[] = [];

  markParticipantDisconnected(participantId: string): Promise<{ roomId: string } | null> {
    this.disconnectedParticipantIds.push(participantId);
    return Promise.resolve({ roomId: membership.room.id });
  }

  deleteExpiredEmptyRooms(_olderThanMs: number): Promise<string[]> {
    return Promise.resolve([]);
  }
}

function jsonRequest(path: string, method: string, body: unknown, token?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

Deno.test("GET /api/health reports a healthy database", async () => {
  const response = await createApp(new FakeRepository())(
    new Request("http://localhost/api/health"),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", database: "up" });
});

Deno.test("POST /api/rooms trims the display name", async () => {
  const repository = new FakeRepository();
  const response = await createApp(repository)(
    jsonRequest("/api/rooms", "POST", { displayName: "  テストユーザー  " }),
  );

  assert.equal(response.status, 201);
  assert.equal(repository.createdDisplayName, "テストユーザー");
  assert.equal((await response.json()).data.room.code, "ABC234");
});

Deno.test("POST /api/rooms requires JSON", async () => {
  const response = await createApp(new FakeRepository())(
    new Request("http://localhost/api/rooms", { method: "POST", body: "name=test" }),
  );

  assert.equal(response.status, 415);
  assert.equal((await response.json()).error.code, "JSON_REQUIRED");
});

Deno.test("POST /api/rooms limits streamed JSON without Content-Length", async () => {
  const oversizedJson = JSON.stringify({ displayName: "a".repeat(17 * 1024) });
  const response = await createApp(new FakeRepository())(
    new Request("http://localhost/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(oversizedJson));
          controller.close();
        },
      }),
    }),
  );

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "BODY_TOO_LARGE");
});

Deno.test("joining a room normalizes its code", async () => {
  const repository = new FakeRepository();
  const response = await createApp(repository)(
    jsonRequest("/api/rooms/abc234/participants", "POST", { displayName: "player" }),
  );

  assert.equal(response.status, 201);
  assert.equal(repository.joinedRoomCode, "ABC234");
});

Deno.test("host can select the room genre", async () => {
  const repository = new FakeRepository();
  const response = await createApp(repository)(
    jsonRequest("/api/rooms/ABC234/genre", "PUT", { genre: "linebot" }, TOKEN),
  );

  assert.equal(response.status, 200);
  assert.equal(repository.selectedGenre, "linebot");
  assert.equal((await response.json()).data.genre, "linebot");
});

Deno.test("selecting an unknown genre is rejected", async () => {
  const response = await createApp(new FakeRepository())(
    jsonRequest("/api/rooms/ABC234/genre", "PUT", { genre: "sports" }, TOKEN),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_GENRE");
});

Deno.test("starting a session requires a bearer token", async () => {
  const response = await createApp(new FakeRepository())(
    new Request("http://localhost/api/rooms/ABC234/sessions", { method: "POST" }),
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "AUTHENTICATION_REQUIRED");
});

Deno.test("retrieving room participants requires membership", async () => {
  const app = createApp(new FakeRepository());
  const unauthenticated = await app(new Request("http://localhost/api/rooms/ABC234"));
  const authenticated = await app(
    new Request("http://localhost/api/rooms/ABC234", {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  );

  assert.equal(unauthenticated.status, 401);
  assert.equal(authenticated.status, 200);
  assert.equal((await authenticated.json()).data.code, membership.room.code);
});

Deno.test("starting a room uses the quiz question count and answer time", async () => {
  const repository = new FakeRepository();
  repository.sessionToStart = { ...session, currentQuestionIndex: null, questionStartedAt: null };
  const quizService = createQuizService({
    secret: "room-config-test-secret-that-is-at-least-32-bytes",
    answerTimeSeconds: 7,
  });
  const response = await createApp(repository, { quizService })(
    new Request("http://localhost/api/rooms/ABC234/sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  );

  assert.equal(response.status, 201);
  assert.equal(repository.startedQuestionCount, quizService.config.questionCount);
  assert.deepEqual(
    repository.startedAnswerTimeSeconds,
    Array(quizService.config.questionCount).fill(7),
  );
  assert.equal(repository.startedDelayMs, 3_000);
});

Deno.test("a participant can retrieve the shared room session", async () => {
  const response = await createApp(new FakeRepository())(
    new Request(`http://localhost/api/sessions/${SESSION_ID}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.id, SESSION_ID);
});

Deno.test("participants can retrieve ranked shared results", async () => {
  const quizService = createQuizService({
    secret: "room-results-test-secret-that-is-at-least-32-bytes",
  });
  const response = await createApp(new FakeRepository(), { quizService })(
    new Request(`http://localhost/api/sessions/${SESSION_ID}/results`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  );
  const results = (await response.json()).data;
  const selectedOptions = Array(session.questionCount).fill(null);
  selectedOptions[0] = 0;
  selectedOptions[1] = 3;
  const expected = await quizService.scoreAnswers(
    session.questionCount,
    selectedOptions,
    SESSION_ID,
  );

  assert.equal(response.status, 200);
  assert.equal(results.sessionId, SESSION_ID);
  assert.equal(results.participants[0].displayName, membership.participant.displayName);
  assert.equal(results.participants[0].answeredCount, 2);
  assert.equal(results.participants[0].correctCount, expected.correctCount);
  assert.equal(results.participants[0].power, expected.power);
  assert.equal(results.participants[0].averageResponseTimeMs, 600);
  assert.equal(results.participants[0].isRequester, true);
  assert.equal(results.participants[0].published, false);
  assert.equal(results.personal.participantId, membership.participant.id);
  assert.equal(results.team.participantCount, 1);
  assert.equal(results.team.answeredCount, 2);
  assert.equal(results.team.possibleAnswerCount, session.questionCount);
});

Deno.test("shared results preserve the choice order used by existing sessions", async () => {
  const repository = new FakeRepository();
  repository.sessionResultChoiceOrderVersion = 1;
  const quizService = createQuizService({
    secret: "legacy-results-test-secret-that-is-at-least-32-bytes",
  });
  const response = await createApp(repository, { quizService })(
    new Request(`http://localhost/api/sessions/${SESSION_ID}/results`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  );
  const results = (await response.json()).data;

  assert.equal(response.status, 200);
  assert.equal(results.participants[0].correctCount, 2);
});

Deno.test("personal and team results are derived from all stored participant answers", async () => {
  const repository = new FakeRepository();
  const secondParticipantId = "55555555-5555-4555-8555-555555555555";
  repository.resultRequesterParticipantId = secondParticipantId;
  repository.resultParticipants = [
    ...repository.resultParticipants,
    {
      participantId: secondParticipantId,
      displayName: "未回答ユーザー",
      role: "player",
      resultPublished: false,
      answers: [],
    },
  ];
  const response = await createApp(repository, {
    quizService: createQuizService({ secret: "team-result-secret-that-is-at-least-32-bytes" }),
  })(
    new Request(`http://localhost/api/sessions/${SESSION_ID}/results`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  );
  const results = (await response.json()).data;

  assert.equal(response.status, 200);
  assert.equal(results.personal.participantId, secondParticipantId);
  assert.equal(results.personal.power, 0);
  assert.equal(results.team.participantCount, 2);
  assert.equal(results.team.answeredCount, 2);
  assert.equal(results.team.possibleAnswerCount, session.questionCount * 2);
  assert.equal(results.team.completionRate, 8);
  assert.equal(results.team.detailsAvailable, true);
  assert.equal(typeof results.team.power, "number");
  assert.equal(typeof results.team.safety, "number");
  assert.ok(Object.keys(results.team.categoryScores).length > 0);
});

Deno.test("the shared team result is identical for every requester", async () => {
  const repository = new FakeRepository();
  const firstParticipantId = repository.resultParticipants[0].participantId;
  const secondParticipantId = "55555555-5555-4555-8555-555555555555";
  repository.resultParticipants.push({
    participantId: secondParticipantId,
    displayName: "別の回答者",
    role: "player",
    resultPublished: false,
    answers: [{ questionIndex: 0, selectedOption: 1, responseTimeMs: 400 }],
  });
  const app = createApp(repository, {
    quizService: createQuizService({ secret: "shared-team-flight-secret-that-is-32-bytes" }),
  });

  repository.resultRequesterParticipantId = firstParticipantId;
  const firstResponse = await app(
    new Request(`http://localhost/api/sessions/${SESSION_ID}/results`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  );
  const firstResults = (await firstResponse.json()).data;

  repository.resultRequesterParticipantId = secondParticipantId;
  const secondResponse = await app(
    new Request(`http://localhost/api/sessions/${SESSION_ID}/results`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  );
  const secondResults = (await secondResponse.json()).data;

  assert.equal(firstResults.personal.participantId, firstParticipantId);
  assert.equal(secondResults.personal.participantId, secondParticipantId);
  assert.deepEqual(firstResults.team, secondResults.team);
});

Deno.test("other participants' results are private until they publish them", async () => {
  const repository = new FakeRepository();
  const secondParticipantId = "55555555-5555-4555-8555-555555555555";
  repository.resultParticipants.push({
    participantId: secondParticipantId,
    displayName: "非公開ユーザー",
    role: "player",
    resultPublished: false,
    answers: [{ questionIndex: 0, selectedOption: 0, responseTimeMs: 400 }],
  });
  const response = await createApp(repository)(
    new Request(`http://localhost/api/sessions/${SESSION_ID}/results`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  );
  const results = (await response.json()).data;
  const privateResult = results.participants.find((entry: { participantId: string }) =>
    entry.participantId === secondParticipantId
  );

  assert.deepEqual(privateResult, {
    participantId: secondParticipantId,
    displayName: "非公開ユーザー",
    role: "player",
    isRequester: false,
    published: false,
  });
});

Deno.test("two-person team aggregates include every participant", async () => {
  const repository = new FakeRepository();
  repository.resultParticipants[0].resultPublished = true;
  repository.resultParticipants.push({
    participantId: "55555555-5555-4555-8555-555555555555",
    displayName: "公開ユーザー",
    role: "player",
    resultPublished: true,
    answers: [{ questionIndex: 0, selectedOption: 0, responseTimeMs: 400 }],
  });
  const response = await createApp(repository)(
    new Request(`http://localhost/api/sessions/${SESSION_ID}/results`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  );
  const results = (await response.json()).data;
  const publishedResult = results.participants.find((entry: { displayName: string }) =>
    entry.displayName === "公開ユーザー"
  );

  assert.equal(results.team.detailsAvailable, true);
  assert.equal(typeof results.team.power, "number");
  assert.equal(typeof publishedResult.power, "number");
});

Deno.test("team aggregates stay available while individual results remain private", async () => {
  const repository = new FakeRepository();
  repository.resultParticipants[0].resultPublished = true;
  repository.resultParticipants.push(
    {
      participantId: "55555555-5555-4555-8555-555555555555",
      displayName: "公開ユーザー",
      role: "player",
      resultPublished: true,
      answers: [{ questionIndex: 0, selectedOption: 0, responseTimeMs: 400 }],
    },
    {
      participantId: "66666666-6666-4666-8666-666666666666",
      displayName: "非公開ユーザー",
      role: "player",
      resultPublished: false,
      answers: [{ questionIndex: 0, selectedOption: 0, responseTimeMs: 500 }],
    },
  );
  const response = await createApp(repository)(
    new Request(`http://localhost/api/sessions/${SESSION_ID}/results`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  );
  const results = (await response.json()).data;
  const privateResult = results.participants.find((entry: { displayName: string }) =>
    entry.displayName === "非公開ユーザー"
  );

  assert.equal(results.team.participantCount, 3);
  assert.equal(results.team.detailsAvailable, true);
  assert.equal(typeof results.team.power, "number");
  assert.equal(typeof results.team.safety, "number");
  assert.ok(Object.keys(results.team.categoryScores).length > 0);
  assert.equal(privateResult.power, undefined);
});

Deno.test("participants can publish their own completed result", async () => {
  const repository = new FakeRepository();
  const response = await createApp(repository)(jsonRequest(
    `/api/sessions/${SESSION_ID}/results/publication`,
    "PUT",
    { published: true },
    TOKEN,
  ));

  assert.equal(response.status, 200);
  assert.equal(repository.publishedResult, true);
  assert.deepEqual((await response.json()).data, { published: true });
});

Deno.test("room quiz reveal time follows the shared session clock", async () => {
  let now = Date.parse(NOW);
  const quizService = createQuizService({
    secret: "room-clock-test-secret-that-is-at-least-32-bytes",
    now: () => now,
  });
  const app = createApp(new FakeRepository(), { quizService });
  const attemptResponse = await app(
    new Request("http://localhost/api/quiz/attempts", { method: "POST" }),
  );
  const { progressToken } = (await attemptResponse.json()).data;
  const startResponse = await app(
    jsonRequest(
      `/api/sessions/${SESSION_ID}/quiz/questions/0/start`,
      "POST",
      { progressToken },
      TOKEN,
    ),
  );
  const start = (await startResponse.json()).data;

  now += 10_000;
  const earlyGrade = await app(
    jsonRequest("/api/quiz/questions/0/grade", "POST", {
      questionToken: start.questionToken,
      selectedOption: 0,
    }),
  );
  assert.equal(earlyGrade.status, 409);

  now += 5_000;
  const grade = await app(
    jsonRequest("/api/quiz/questions/0/grade", "POST", {
      questionToken: start.questionToken,
      selectedOption: 0,
    }),
  );
  assert.equal(grade.status, 200);
});

Deno.test("answer option must be one of four zero-based indexes", async () => {
  const response = await createApp(new FakeRepository())(
    jsonRequest(
      `/api/sessions/${SESSION_ID}/answers/0`,
      "PUT",
      { selectedOption: 4 },
      TOKEN,
    ),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_SELECTED_OPTION");
});

Deno.test("an answer is passed to the repository", async () => {
  const repository = new FakeRepository();
  const response = await createApp(repository)(
    jsonRequest(
      `/api/sessions/${SESSION_ID}/answers/0`,
      "PUT",
      { selectedOption: 2 },
      TOKEN,
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(repository.submittedOption, 2);
  assert.equal((await response.json()).data.responseTimeMs, 500);
});

Deno.test("the last participant answer starts review immediately", async () => {
  const repository = new FakeRepository();
  repository.allParticipantsAnsweredOnSubmit = true;
  const quizService = createQuizService({
    secret: "early-review-test-secret-that-is-at-least-32-bytes",
    reviewTimeSeconds: 0,
  });
  const response = await createApp(repository, { quizService })(
    jsonRequest(
      `/api/sessions/${SESSION_ID}/answers/0`,
      "PUT",
      { selectedOption: 2 },
      TOKEN,
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(repository.reviewedQuestionIndexes, [0]);
});

Deno.test("room grading allows an early reveal after DB review starts", async () => {
  let now = 1_000;
  const quizService = createQuizService({
    secret: "early-grade-test-secret-that-is-at-least-32-bytes",
    now: () => now,
  });
  const repository = new FakeRepository();
  repository.sessionForParticipant = {
    ...session,
    answerTimeSeconds: 10,
    questionStartedAt: new Date(now).toISOString(),
  };
  const app = createApp(repository, { quizService });
  const attempt = (await (await app(
    new Request("http://localhost/api/quiz/attempts", { method: "POST" }),
  )).json()).data;
  const start = (await (await app(jsonRequest(
    `/api/sessions/${SESSION_ID}/quiz/questions/0/start`,
    "POST",
    { progressToken: attempt.progressToken },
    TOKEN,
  ))).json()).data;

  now = 2_000;
  repository.sessionForParticipant = {
    ...repository.sessionForParticipant,
    questionReviewStartedAt: new Date(now).toISOString(),
    reviewEndsAt: new Date(now + 5_000).toISOString(),
  };
  const gradeResponse = await app(jsonRequest(
    `/api/sessions/${SESSION_ID}/quiz/questions/0/grade`,
    "POST",
    { questionToken: start.questionToken, selectedOption: 0 },
    TOKEN,
  ));

  assert.equal(gradeResponse.status, 200);
  assert.equal(typeof (await gradeResponse.json()).data.correct, "boolean");
});

Deno.test("quiz API keeps the answer out of question responses", async () => {
  let now = 1_000;
  const quizService = createQuizService({
    secret: "app-test-secret-that-is-at-least-32-bytes",
    now: () => now,
  });
  const app = createApp(new FakeRepository(), { quizService });

  const configResponse = await app(new Request("http://localhost/api/quiz/config"));
  assert.equal(configResponse.status, 200);
  assert.equal((await configResponse.json()).data.questionCount, 24);

  const attemptResponse = await app(
    new Request("http://localhost/api/quiz/attempts", { method: "POST" }),
  );
  assert.equal(attemptResponse.status, 201);
  const { progressToken } = (await attemptResponse.json()).data;

  const startResponse = await app(
    jsonRequest("/api/quiz/questions/0/start", "POST", { progressToken }),
  );
  assert.equal(startResponse.status, 200);
  const start = (await startResponse.json()).data;
  assert.equal(Object.hasOwn(start.question, "answer"), false);
  assert.equal(Object.hasOwn(start.question, "explanation"), false);

  const earlyGrade = await app(
    jsonRequest("/api/quiz/questions/0/grade", "POST", {
      questionToken: start.questionToken,
      selectedOption: 0,
    }),
  );
  assert.equal(earlyGrade.status, 409);
  assert.equal((await earlyGrade.json()).error.code, "QUIZ_REVIEW_NOT_READY");

  now += 10_000;
  const gradeResponse = await app(
    jsonRequest("/api/quiz/questions/0/grade", "POST", {
      questionToken: start.questionToken,
      selectedOption: 0,
    }),
  );
  assert.equal(gradeResponse.status, 200);
  const grade = (await gradeResponse.json()).data;
  assert.equal(typeof grade.correct, "boolean");
  assert.ok(Number.isInteger(grade.correctOption));
  assert.ok(grade.correctOption >= 0 && grade.correctOption <= 3);
  assert.equal(typeof grade.explanation, "string");
});

import type { Pool, PoolClient, QueryResultRow } from "pg";
import { ApiError } from "../errors.ts";
import type {
  AnswerSummary,
  AuthenticatedParticipant,
  GameGenre,
  GameRepository,
  GameSessionSummary,
  MembershipResult,
  ParticipantQuestionPlan,
  ParticipantRole,
  ParticipantSummary,
  RoomDetail,
  RoomStatus,
  RoomSummary,
  SessionResultSource,
  SessionStatus,
} from "../types.ts";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_ATTEMPTS = 5;
const SESSION_RECOVERY_GRACE_MS = 2_000;

interface RoomRow extends QueryResultRow {
  id: string;
  code: string;
  status: RoomStatus;
  genre: string;
  created_at: Date | string;
}

interface ParticipantRow extends QueryResultRow {
  id: string;
  display_name: string;
  crew_color: string;
  role: ParticipantRole;
  joined_at: Date | string;
}

interface SessionRow extends QueryResultRow {
  id: string;
  room_id: string;
  session_number: number;
  status: SessionStatus;
  question_count: number;
  choice_order_version: number;
  answer_time_seconds: number;
  question_answer_time_seconds: number[];
  current_question_index: number | null;
  question_started_at: Date | string | null;
  question_review_started_at: Date | string | null;
  review_ends_at: Date | string | null;
  started_at: Date | string;
  finished_at: Date | string | null;
}

interface AnswerRow extends QueryResultRow {
  id: string;
  game_session_id: string;
  participant_id: string;
  question_index: number;
  selected_option: number;
  response_time_ms: number;
  answered_at: Date | string;
  all_participants_answered?: boolean;
}

interface SessionResultRow extends QueryResultRow {
  participant_id: string;
  display_name_snapshot: string;
  crew_color_snapshot: string;
  role_snapshot: ParticipantRole;
  result_published: boolean;
  question_index: number | null;
  selected_option: number | null;
  response_time_ms: number | null;
}

interface ParticipantQuestionRow extends QueryResultRow {
  participant_id: string;
  question_index: number;
  id: string;
  category: string;
  technology: string;
  weight: number;
  answer_time_seconds: number;
  instruction: string;
  question: string;
  choices: string[];
  correct_option: number;
  explanation: string;
}

interface AuthorizedResultSessionRow extends SessionRow {
  requester_participant_id: string;
}

interface TimedSessionRow extends SessionRow {
  answer_window_open: boolean | null;
}

interface AuthorizedSessionRow extends TimedSessionRow {
  participant_id: string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapQuestion(row: ParticipantQuestionRow) {
  return {
    id: row.id,
    category: row.category,
    technology: row.technology,
    weight: row.weight,
    answerTimeSeconds: row.answer_time_seconds,
    instruction: row.instruction,
    question: row.question,
    choices: row.choices,
    answer: row.correct_option,
    explanation: row.explanation,
  };
}

function mapRoom(row: RoomRow): RoomSummary {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    genre: row.genre,
    createdAt: toIso(row.created_at),
  };
}

function mapParticipant(row: ParticipantRow): ParticipantSummary {
  return {
    id: row.id,
    displayName: row.display_name,
    crewColor: row.crew_color,
    role: row.role,
    joinedAt: toIso(row.joined_at),
  };
}

function mapSession(row: SessionRow): GameSessionSummary {
  return {
    id: row.id,
    roomId: row.room_id,
    sessionNumber: row.session_number,
    status: row.status,
    questionCount: row.question_count,
    choiceOrderVersion: row.choice_order_version,
    answerTimeSeconds: row.answer_time_seconds,
    questionAnswerTimeSeconds: row.question_answer_time_seconds,
    currentQuestionIndex: row.current_question_index,
    questionStartedAt: row.question_started_at ? toIso(row.question_started_at) : null,
    questionReviewStartedAt: row.question_review_started_at
      ? toIso(row.question_review_started_at)
      : null,
    reviewEndsAt: row.review_ends_at ? toIso(row.review_ends_at) : null,
    startedAt: toIso(row.started_at),
    finishedAt: row.finished_at ? toIso(row.finished_at) : null,
  };
}

function mapAnswer(row: AnswerRow): AnswerSummary {
  return {
    id: row.id,
    gameSessionId: row.game_session_id,
    participantId: row.participant_id,
    questionIndex: row.question_index,
    selectedOption: row.selected_option,
    responseTimeMs: row.response_time_ms,
    answeredAt: toIso(row.answered_at),
    allParticipantsAnswered: Boolean(row.all_participants_answered),
  };
}

function randomRoomCode(): string {
  const values = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  return Array.from(values, (value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join(
    "",
  );
}

function createAccessToken(): string {
  const values = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...values))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function hashAccessToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRoomCodeCollision(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "23505" &&
    "constraint" in error && error.constraint === "room_code_key";
}

export class PostgresGameRepository implements GameRepository {
  constructor(private readonly pool: Pool) {}

  async healthCheck(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async createRoom(displayName: string, crewColor: string): Promise<MembershipResult> {
    const accessToken = createAccessToken();
    const accessTokenHash = await hashAccessToken(accessToken);

    for (let attempt = 0; attempt < ROOM_CODE_ATTEMPTS; attempt += 1) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const roomResult = await client.query<RoomRow>(
          `INSERT INTO room (code)
           VALUES ($1)
           RETURNING id, code, status, genre, created_at`,
          [randomRoomCode()],
        );
        const room = roomResult.rows[0];
        const participantResult = await client.query<ParticipantRow>(
          `INSERT INTO participant (room_id, display_name, crew_color, role, access_token_hash)
           VALUES ($1, $2, $3, 'host', $4)
           RETURNING id, display_name, crew_color, role, joined_at`,
          [room.id, displayName, crewColor, accessTokenHash],
        );
        await client.query("COMMIT");

        return {
          room: mapRoom(room),
          participant: mapParticipant(participantResult.rows[0]),
          accessToken,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        if (!isRoomCodeCollision(error) || attempt === ROOM_CODE_ATTEMPTS - 1) {
          throw error;
        }
      } finally {
        client.release();
      }
    }

    throw new Error("Failed to generate a unique room code");
  }

  async joinRoom(code: string, displayName: string, crewColor: string): Promise<MembershipResult> {
    const client = await this.pool.connect();
    const accessToken = createAccessToken();
    const accessTokenHash = await hashAccessToken(accessToken);

    try {
      await client.query("BEGIN");
      const roomResult = await client.query<RoomRow>(
        `SELECT id, code, status, genre, created_at
         FROM room
         WHERE code = $1
         FOR UPDATE`,
        [code],
      );
      const room = roomResult.rows[0];
      if (!room) {
        throw new ApiError(404, "ROOM_NOT_FOUND", "Room not found");
      }
      if (room.status !== "lobby") {
        throw new ApiError(409, "ROOM_NOT_JOINABLE", "The game has already started");
      }

      const participantResult = await client.query<ParticipantRow>(
        `INSERT INTO participant (room_id, display_name, crew_color, role, access_token_hash)
         VALUES ($1, $2, $3, 'player', $4)
         RETURNING id, display_name, crew_color, role, joined_at`,
        [room.id, displayName, crewColor, accessTokenHash],
      );
      await client.query("COMMIT");

      return {
        room: mapRoom(room),
        participant: mapParticipant(participantResult.rows[0]),
        accessToken,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getRoom(code: string): Promise<RoomDetail> {
    const roomResult = await this.pool.query<RoomRow>(
      `SELECT id, code, status, genre, created_at
       FROM room
       WHERE code = $1`,
      [code],
    );
    const room = roomResult.rows[0];
    if (!room) {
      throw new ApiError(404, "ROOM_NOT_FOUND", "Room not found");
    }

    const participants = await this.pool.query<ParticipantRow>(
      `SELECT id, display_name, crew_color, role, joined_at
       FROM participant
       WHERE room_id = $1 AND left_at IS NULL
       ORDER BY joined_at, id`,
      [room.id],
    );

    const sessionResult = await this.pool.query<SessionRow>(
      `SELECT id, room_id, session_number, status, question_count, choice_order_version,
         answer_time_seconds, question_answer_time_seconds, current_question_index, question_started_at,
           question_review_started_at, review_ends_at,
         started_at, finished_at
       FROM game_session
       WHERE room_id = $1
       ORDER BY session_number DESC
       LIMIT 1`,
      [room.id],
    );

    return {
      ...mapRoom(room),
      participants: participants.rows.map(mapParticipant),
      activeSession: sessionResult.rows[0] ? mapSession(sessionResult.rows[0]) : null,
    };
  }

  async authenticateParticipant(
    roomCode: string,
    accessToken: string,
  ): Promise<AuthenticatedParticipant> {
    const tokenHash = await hashAccessToken(accessToken);
    const result = await this.pool.query<ParticipantRow & { room_id: string }>(
      `SELECT p.id, p.display_name, p.crew_color, p.role, p.joined_at, p.room_id
       FROM participant p
       JOIN room r ON r.id = p.room_id
       WHERE r.code = $1
         AND p.access_token_hash = $2
         AND p.left_at IS NULL`,
      [roomCode, tokenHash],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(401, "AUTHENTICATION_FAILED", "Invalid room code or access token");
    }
    return { roomId: row.room_id, participant: mapParticipant(row) };
  }

  async selectGenre(code: string, accessToken: string, genre: GameGenre): Promise<RoomSummary> {
    const tokenHash = await hashAccessToken(accessToken);
    const roomResult = await this.pool.query<RoomRow>(
      `UPDATE room
       SET genre = $3, updated_at = now()
       WHERE code = $1
         AND status = 'lobby'
         AND EXISTS (
           SELECT 1 FROM participant p
           WHERE p.room_id = room.id
             AND p.access_token_hash = $2
             AND p.role = 'host'
             AND p.left_at IS NULL
         )
       RETURNING id, code, status, genre, created_at`,
      [code, tokenHash, genre],
    );
    const room = roomResult.rows[0];
    if (!room) {
      const existing = await this.pool.query<RoomRow>(
        `SELECT id, code, status, genre, created_at FROM room WHERE code = $1`,
        [code],
      );
      if (!existing.rows[0]) {
        throw new ApiError(404, "ROOM_NOT_FOUND", "Room not found");
      }
      if (existing.rows[0].status !== "lobby") {
        throw new ApiError(
          409,
          "ROOM_NOT_IN_LOBBY",
          "The genre can only be set before the game starts",
        );
      }
      throw new ApiError(403, "HOST_REQUIRED", "A valid host token is required");
    }
    return mapRoom(room);
  }

  async startSession(
    code: string,
    accessToken: string,
    questionCount: number,
    questionAnswerTimeSeconds: readonly number[],
    startDelayMs: number,
  ): Promise<GameSessionSummary> {
    const client = await this.pool.connect();
    const tokenHash = await hashAccessToken(accessToken);

    try {
      await client.query("BEGIN");
      const roomResult = await client.query<RoomRow>(
        `SELECT r.id, r.code, r.status, r.genre, r.created_at
         FROM room r
         JOIN participant p ON p.room_id = r.id
         WHERE r.code = $1
           AND p.access_token_hash = $2
           AND p.role = 'host'
           AND p.left_at IS NULL
         FOR UPDATE OF r`,
        [code, tokenHash],
      );
      const room = roomResult.rows[0];
      if (!room) {
        throw new ApiError(403, "HOST_REQUIRED", "A valid host token is required");
      }
      if (room.status !== "lobby") {
        throw new ApiError(409, "SESSION_ALREADY_STARTED", "This room is not in the lobby");
      }

      const sessionResult = await client.query<SessionRow>(
        `INSERT INTO game_session (
           room_id,
           session_number,
           question_count,
           answer_time_seconds,
           question_answer_time_seconds,
           current_question_index,
           question_started_at
         )
         SELECT $1, COALESCE(MAX(session_number), 0) + 1, $2,
           ($3::smallint[])[1], $3::smallint[], 0,
           clock_timestamp() + make_interval(secs => $4::double precision / 1000)
         FROM game_session
         WHERE room_id = $1
         RETURNING id, room_id, session_number, status, question_count, choice_order_version,
           answer_time_seconds, question_answer_time_seconds, current_question_index, question_started_at,
           question_review_started_at, review_ends_at,
           started_at, finished_at`,
        [room.id, questionCount, questionAnswerTimeSeconds, startDelayMs],
      );
      const session = sessionResult.rows[0];

      const participantSnapshot = await client.query(
        `INSERT INTO session_participant (
           game_session_id,
           participant_id,
           room_id,
           display_name_snapshot,
           crew_color_snapshot,
           role_snapshot
         )
         SELECT $1, id, room_id, display_name, crew_color, role
         FROM participant
         WHERE room_id = $2 AND left_at IS NULL
         RETURNING participant_id`,
        [session.id, room.id],
      );
      const selectedQuestions = await client.query(
        `WITH categories(category, category_order) AS (
           VALUES
             ('フロントエンド', 1), ('バックエンド', 2), ('データベース', 3),
             ('API', 4), ('インフラ', 5), ('セキュリティ', 6)
         ), ranked AS (
           SELECT sp.game_session_id, sp.participant_id, category.category_order,
             question.id AS question_id, question.difficulty,
             row_number() OVER (
               PARTITION BY sp.participant_id, question.category, question.difficulty
               ORDER BY random()
             ) AS difficulty_rank
           FROM session_participant sp
           CROSS JOIN categories category
           JOIN quiz_question question
             ON question.category = category.category
            AND question.active
           WHERE sp.game_session_id = $1
         ), selected AS (
           SELECT *, (row_number() OVER (
             PARTITION BY participant_id
             ORDER BY category_order, difficulty, difficulty_rank
           ) - 1)::smallint AS question_index
           FROM ranked
           WHERE difficulty_rank <= CASE difficulty WHEN 1 THEN 1 WHEN 2 THEN 2 ELSE 1 END
         )
         INSERT INTO session_participant_question (
           game_session_id, participant_id, question_index, question_id
         )
         SELECT game_session_id, participant_id, question_index, question_id
         FROM selected
         RETURNING question_id`,
        [session.id],
      );
      const expectedSelectionCount = (participantSnapshot.rowCount ?? 0) * questionCount;
      if (selectedQuestions.rowCount !== expectedSelectionCount) {
        throw new Error(
          `Quiz question bank is incomplete: selected ${selectedQuestions.rowCount} of ${expectedSelectionCount}`,
        );
      }
      await client.query(
        `UPDATE room SET status = 'playing', updated_at = now() WHERE id = $1`,
        [room.id],
      );
      await client.query("COMMIT");
      return mapSession(session);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getSessionForParticipant(
    sessionId: string,
    accessToken: string,
    reviewTimeSeconds = 5,
  ): Promise<GameSessionSummary> {
    const tokenHash = await hashAccessToken(accessToken);
    const result = await this.pool.query<SessionRow>(
      `SELECT gs.id, gs.room_id, gs.session_number, gs.status, gs.question_count,
         gs.choice_order_version,
         gs.answer_time_seconds, gs.question_answer_time_seconds, gs.current_question_index,
         gs.question_started_at, gs.question_review_started_at, gs.review_ends_at,
         gs.started_at, gs.finished_at
       FROM game_session gs
       JOIN session_participant sp ON sp.game_session_id = gs.id
       JOIN participant p ON p.id = sp.participant_id
       WHERE gs.id = $1
         AND p.access_token_hash = $2
         AND p.left_at IS NULL`,
      [sessionId, tokenHash],
    );
    const session = result.rows[0];
    if (!session) {
      throw new ApiError(403, "PARTICIPANT_REQUIRED", "A valid participant token is required");
    }
    if (session.status === "active" && session.question_started_at !== null) {
      return await this.reconcileOverdueSession(session, reviewTimeSeconds);
    }
    return mapSession(session);
  }

  async getParticipantQuestionPlan(
    sessionId: string,
    accessToken: string,
  ): Promise<ParticipantQuestionPlan> {
    const tokenHash = await hashAccessToken(accessToken);
    const result = await this.pool.query<ParticipantQuestionRow>(
      `SELECT selection.participant_id, selection.question_index,
         question.id, question.category, question.technology, question.weight,
         question.answer_time_seconds, question.instruction, question.question,
         question.choices, question.correct_option, question.explanation
       FROM session_participant_question selection
       JOIN participant participant ON participant.id = selection.participant_id
       JOIN quiz_question question ON question.id = selection.question_id
       WHERE selection.game_session_id = $1
         AND participant.access_token_hash = $2
         AND participant.left_at IS NULL
       ORDER BY selection.question_index`,
      [sessionId, tokenHash],
    );
    if (!result.rows.length) {
      throw new ApiError(404, "QUIZ_QUESTION_NOT_FOUND", "Stored quiz question not found");
    }
    const participantId = result.rows[0].participant_id;
    if (
      result.rows.some((row, index) =>
        row.participant_id !== participantId || row.question_index !== index
      )
    ) {
      throw new ApiError(500, "QUIZ_CONFIG_MISMATCH", "Stored quiz question plan is invalid");
    }
    return { participantId, questions: result.rows.map(mapQuestion) };
  }

  async getSessionResultSource(
    sessionId: string,
    accessToken: string,
  ): Promise<SessionResultSource> {
    const tokenHash = await hashAccessToken(accessToken);
    const sessionResult = await this.pool.query<AuthorizedResultSessionRow>(
      `SELECT gs.id, gs.room_id, gs.session_number, gs.status, gs.question_count,
         gs.choice_order_version,
         gs.answer_time_seconds, gs.question_answer_time_seconds, gs.current_question_index,
         gs.question_started_at, gs.question_review_started_at, gs.review_ends_at,
         gs.started_at, gs.finished_at, p.id AS requester_participant_id
       FROM game_session gs
       JOIN session_participant requester ON requester.game_session_id = gs.id
       JOIN participant p ON p.id = requester.participant_id
       WHERE gs.id = $1 AND p.access_token_hash = $2`,
      [sessionId, tokenHash],
    );
    const session = sessionResult.rows[0];
    if (!session) {
      throw new ApiError(403, "PARTICIPANT_REQUIRED", "A valid participant token is required");
    }
    if (session.status !== "completed") {
      throw new ApiError(409, "RESULTS_NOT_READY", "Results are available after the quiz ends");
    }

    const result = await this.pool.query<SessionResultRow>(
      `SELECT sp.participant_id, sp.display_name_snapshot, sp.crew_color_snapshot, sp.role_snapshot,
         sp.result_published, a.question_index, a.selected_option, a.response_time_ms
       FROM session_participant sp
       LEFT JOIN answer a
         ON a.game_session_id = sp.game_session_id
        AND a.participant_id = sp.participant_id
       WHERE sp.game_session_id = $1
       ORDER BY sp.joined_at, sp.participant_id, a.question_index`,
      [sessionId],
    );

    const participants = new Map<string, SessionResultSource["participants"][number]>();
    for (const row of result.rows) {
      let participant = participants.get(row.participant_id);
      if (!participant) {
        participant = {
          participantId: row.participant_id,
          displayName: row.display_name_snapshot,
          crewColor: row.crew_color_snapshot,
          role: row.role_snapshot,
          resultPublished: row.result_published,
          questions: [],
          answers: [],
        };
        participants.set(row.participant_id, participant);
      }
      if (row.question_index !== null && row.selected_option !== null) {
        participant.answers.push({
          questionIndex: row.question_index,
          selectedOption: row.selected_option,
          responseTimeMs: row.response_time_ms ?? 0,
        });
      }
    }

    const questionResult = await this.pool.query<
      ParticipantQuestionRow & {
        question_index: number;
      }
    >(
      `SELECT selection.participant_id, selection.question_index,
         question.id, question.category, question.technology, question.weight, question.answer_time_seconds,
         question.instruction, question.question, question.choices,
         question.correct_option, question.explanation
       FROM session_participant_question selection
       JOIN quiz_question question ON question.id = selection.question_id
       WHERE selection.game_session_id = $1
       ORDER BY selection.participant_id, selection.question_index`,
      [sessionId],
    );
    for (const question of questionResult.rows) {
      participants.get(question.participant_id)?.questions?.push(
        mapQuestion(question),
      );
    }

    return {
      session: mapSession(session),
      requesterParticipantId: session.requester_participant_id,
      participants: [...participants.values()],
    };
  }

  async setResultPublication(
    sessionId: string,
    accessToken: string,
    published: boolean,
  ): Promise<{ roomId: string; published: boolean }> {
    const tokenHash = await hashAccessToken(accessToken);
    const result = await this.pool.query<{ room_id: string; result_published: boolean }>(
      `UPDATE session_participant sp
       SET result_published = $3
       FROM participant p, game_session gs
       WHERE sp.game_session_id = $1
         AND p.id = sp.participant_id
         AND p.access_token_hash = $2
         AND gs.id = sp.game_session_id
         AND gs.status = 'completed'
       RETURNING gs.room_id, sp.result_published`,
      [sessionId, tokenHash, published],
    );
    const updated = result.rows[0];
    if (!updated) {
      throw new ApiError(
        403,
        "RESULT_PUBLICATION_FORBIDDEN",
        "A completed result and valid participant token are required",
      );
    }
    return { roomId: updated.room_id, published: updated.result_published };
  }

  async startQuestion(
    sessionId: string,
    accessToken: string,
    questionIndex: number,
  ): Promise<GameSessionSummary> {
    const client = await this.pool.connect();
    const tokenHash = await hashAccessToken(accessToken);

    try {
      await client.query("BEGIN");
      const session = await this.authorizedHostSession(client, sessionId, tokenHash);
      if (session.status !== "active") {
        throw new ApiError(409, "SESSION_NOT_ACTIVE", "The session is not active");
      }
      if (session.answer_window_open) {
        throw new ApiError(
          409,
          "ANSWER_WINDOW_OPEN",
          "The current question is still accepting answers",
        );
      }
      if (
        session.review_ends_at === null ||
        Date.now() < Date.parse(toIso(session.review_ends_at))
      ) {
        throw new ApiError(
          409,
          "QUESTION_REVIEW_NOT_FINISHED",
          "The current question review has not finished",
        );
      }
      const expectedQuestion = (session.current_question_index ?? -1) + 1;
      if (questionIndex !== expectedQuestion || questionIndex >= session.question_count) {
        throw new ApiError(
          409,
          "INVALID_QUESTION_TRANSITION",
          `The next question index must be ${expectedQuestion}`,
        );
      }

      const result = await client.query<SessionRow>(
        `UPDATE game_session
         SET current_question_index = $2,
             answer_time_seconds = question_answer_time_seconds[$2 + 1],
             question_started_at = clock_timestamp(),
             question_review_started_at = NULL,
             review_ends_at = NULL
         WHERE id = $1
         RETURNING id, room_id, session_number, status, question_count, choice_order_version,
           answer_time_seconds, question_answer_time_seconds, current_question_index, question_started_at,
           question_review_started_at, review_ends_at,
           started_at, finished_at`,
        [sessionId, questionIndex],
      );
      await client.query("COMMIT");
      return mapSession(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async submitAnswer(
    sessionId: string,
    accessToken: string,
    questionIndex: number,
    selectedOption: number,
  ): Promise<AnswerSummary> {
    const client = await this.pool.connect();
    const tokenHash = await hashAccessToken(accessToken);

    try {
      await client.query("BEGIN");
      const result = await client.query<AuthorizedSessionRow>(
        `SELECT gs.id, gs.room_id, gs.session_number, gs.status, gs.question_count,
           gs.choice_order_version,
           gs.answer_time_seconds, gs.question_answer_time_seconds, gs.current_question_index,
         gs.question_started_at, gs.question_review_started_at, gs.review_ends_at,
           gs.started_at, gs.finished_at, p.id AS participant_id,
           gs.question_review_started_at IS NULL
             AND clock_timestamp() >= gs.question_started_at
             AND clock_timestamp() <= gs.question_started_at
               + make_interval(secs => gs.answer_time_seconds) AS answer_window_open
         FROM game_session gs
         JOIN session_participant sp ON sp.game_session_id = gs.id
         JOIN participant p ON p.id = sp.participant_id
         WHERE gs.id = $1
           AND p.access_token_hash = $2
           AND p.left_at IS NULL
         FOR UPDATE OF gs`,
        [sessionId, tokenHash],
      );
      const session = result.rows[0];
      if (!session) {
        throw new ApiError(403, "PARTICIPANT_REQUIRED", "A valid participant token is required");
      }
      if (session.status !== "active" || session.question_started_at === null) {
        throw new ApiError(409, "SESSION_NOT_ACTIVE", "The session is not accepting answers");
      }
      if (session.current_question_index !== questionIndex) {
        throw new ApiError(409, "QUESTION_NOT_ACTIVE", "This question is not active");
      }

      if (!session.answer_window_open) {
        throw new ApiError(409, "ANSWER_TIME_EXPIRED", "The answer time has expired");
      }

      const answerResult = await client.query<AnswerRow>(
        `WITH saved_answer AS (
         INSERT INTO answer (
           game_session_id,
           participant_id,
           question_index,
           selected_option,
           response_time_ms
         )
         SELECT $1, $2, $3, $4,
           GREATEST(
             0,
             floor(EXTRACT(epoch FROM (clock_timestamp() - gs.question_started_at)) * 1000)
           )::integer
         FROM game_session gs
         WHERE gs.id = $1
           AND gs.status = 'active'
           AND gs.current_question_index = $3
           AND gs.question_review_started_at IS NULL
           AND clock_timestamp() >= gs.question_started_at
           AND clock_timestamp() <= gs.question_started_at
             + make_interval(secs => gs.answer_time_seconds)
         ON CONFLICT (game_session_id, participant_id, question_index)
         DO UPDATE SET
           selected_option = EXCLUDED.selected_option,
           response_time_ms = EXCLUDED.response_time_ms,
           answered_at = now()
         RETURNING id, game_session_id, participant_id, question_index,
           selected_option, response_time_ms, answered_at
         ), touched_participant AS (
           UPDATE participant
           SET last_seen_at = now()
           WHERE id = $2
             AND EXISTS (SELECT 1 FROM saved_answer)
           RETURNING id
         )
         SELECT saved_answer.*,
           (
             SELECT count(*)
             FROM session_participant answered_participant
             WHERE answered_participant.game_session_id = $1
               AND answered_participant.left_at IS NULL
               AND (
                 answered_participant.participant_id = $2
                 OR EXISTS (
                   SELECT 1
                   FROM answer counted_answer
                   WHERE counted_answer.game_session_id = $1
                     AND counted_answer.question_index = $3
                     AND counted_answer.participant_id = answered_participant.participant_id
                 )
               )
           ) = (
             SELECT count(*)
             FROM session_participant active_participant
             WHERE active_participant.game_session_id = $1
               AND active_participant.left_at IS NULL
           ) AS all_participants_answered
         FROM saved_answer
         JOIN touched_participant ON true`,
        [sessionId, session.participant_id, questionIndex, selectedOption],
      );
      if (!answerResult.rows[0]) {
        throw new ApiError(409, "ANSWER_NOT_ACCEPTED", "The answer window has closed");
      }
      await client.query("COMMIT");
      return mapAnswer(answerResult.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async beginQuestionReview(
    sessionId: string,
    questionIndex: number,
    reviewTimeMs: number,
  ): Promise<GameSessionSummary | null> {
    const result = await this.pool.query<SessionRow>(
      `UPDATE game_session
       SET question_review_started_at = clock_timestamp(),
           review_ends_at = clock_timestamp()
             + make_interval(secs => $3::double precision / 1000)
       WHERE id = $1
         AND status = 'active'
         AND current_question_index = $2
         AND question_review_started_at IS NULL
         AND clock_timestamp() >= question_started_at
       RETURNING id, room_id, session_number, status, question_count, choice_order_version,
         answer_time_seconds, question_answer_time_seconds, current_question_index,
         question_started_at, question_review_started_at, review_ends_at,
         started_at, finished_at`,
      [sessionId, questionIndex, reviewTimeMs],
    );
    const row = result.rows[0];
    return row ? mapSession(row) : null;
  }

  async completeSession(sessionId: string, accessToken: string): Promise<GameSessionSummary> {
    const client = await this.pool.connect();
    const tokenHash = await hashAccessToken(accessToken);

    try {
      await client.query("BEGIN");
      const session = await this.authorizedHostSession(client, sessionId, tokenHash);
      if (session.status !== "active") {
        throw new ApiError(409, "SESSION_NOT_ACTIVE", "The session is not active");
      }
      if (session.current_question_index !== session.question_count - 1) {
        throw new ApiError(409, "QUESTIONS_REMAINING", "Not all questions have started");
      }
      if (session.answer_window_open) {
        throw new ApiError(
          409,
          "ANSWER_WINDOW_OPEN",
          "The final question is still accepting answers",
        );
      }
      if (
        session.review_ends_at === null ||
        Date.now() < Date.parse(toIso(session.review_ends_at))
      ) {
        throw new ApiError(
          409,
          "QUESTION_REVIEW_NOT_FINISHED",
          "The final question review has not finished",
        );
      }

      const result = await client.query<SessionRow>(
        `UPDATE game_session
         SET status = 'completed', finished_at = now()
         WHERE id = $1
         RETURNING id, room_id, session_number, status, question_count, choice_order_version,
           answer_time_seconds, question_answer_time_seconds, current_question_index, question_started_at,
           question_review_started_at, review_ends_at,
           started_at, finished_at`,
        [sessionId],
      );
      await client.query(
        `UPDATE room SET status = 'results', updated_at = now() WHERE id = $1`,
        [session.room_id],
      );
      await client.query("COMMIT");
      return mapSession(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async advanceQuestionAutomatically(
    sessionId: string,
    fromIndex: number,
  ): Promise<GameSessionSummary | null> {
    const result = await this.pool.query<SessionRow>(
      `UPDATE game_session
       SET current_question_index = current_question_index + 1,
           answer_time_seconds = question_answer_time_seconds[current_question_index + 2],
           question_started_at = clock_timestamp(),
           question_review_started_at = NULL,
           review_ends_at = NULL
       WHERE id = $1
         AND status = 'active'
         AND current_question_index = $2
         AND review_ends_at IS NOT NULL
         AND current_question_index + 1 < question_count
       RETURNING id, room_id, session_number, status, question_count, choice_order_version,
         answer_time_seconds, question_answer_time_seconds, current_question_index, question_started_at,
           question_review_started_at, review_ends_at,
         started_at, finished_at`,
      [sessionId, fromIndex],
    );
    const row = result.rows[0];
    return row ? mapSession(row) : null;
  }

  async completeSessionAutomatically(sessionId: string): Promise<GameSessionSummary | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<SessionRow>(
        `UPDATE game_session
         SET status = 'completed', finished_at = now()
         WHERE id = $1
           AND status = 'active'
           AND current_question_index = question_count - 1
           AND review_ends_at IS NOT NULL
         RETURNING id, room_id, session_number, status, question_count, choice_order_version,
           answer_time_seconds, question_answer_time_seconds, current_question_index, question_started_at,
           question_review_started_at, review_ends_at,
           started_at, finished_at`,
        [sessionId],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `UPDATE room SET status = 'results', updated_at = now() WHERE id = $1`,
        [row.room_id],
      );
      await client.query("COMMIT");
      return mapSession(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markParticipantDisconnected(participantId: string): Promise<{ roomId: string } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ room_id: string }>(
        `UPDATE participant
         SET left_at = now()
         WHERE id = $1 AND left_at IS NULL
         RETURNING room_id`,
        [participantId],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `UPDATE session_participant SET left_at = now() WHERE participant_id = $1 AND left_at IS NULL`,
        [participantId],
      );
      await client.query("COMMIT");
      return { roomId: row.room_id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteExpiredEmptyRooms(olderThanMs: number): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // まず安価な絞り込みで候補を探す(ロックなし。この時点の結果はまだ信用しない)。
      const candidateResult = await client.query<{ id: string }>(
        `SELECT r.id
         FROM room r
         WHERE EXISTS (SELECT 1 FROM participant p WHERE p.room_id = r.id)
           AND NOT EXISTS (
             SELECT 1 FROM participant p WHERE p.room_id = r.id AND p.left_at IS NULL
           )
           AND (SELECT MAX(p.left_at) FROM participant p WHERE p.room_id = r.id)
             < now() - make_interval(secs => $1)`,
        [olderThanMs / 1000],
      );
      const candidateIds = candidateResult.rows.map((row) => row.id);

      let roomIds: string[] = [];
      if (candidateIds.length > 0) {
        // 候補の部屋行をFOR UPDATEでロックしてから、条件を再確認する。
        // joinRoomも部屋行取得時にFOR UPDATEを取るため、ロック中に新規参加が割り込むことはない。
        // (ロック取得を待っている間に参加された場合は、ここでの再確認で対象から外れる。)
        const recheckResult = await client.query<{ id: string }>(
          `SELECT r.id
           FROM room r
           WHERE r.id = ANY($1::uuid[])
             AND NOT EXISTS (
               SELECT 1 FROM participant p WHERE p.room_id = r.id AND p.left_at IS NULL
             )
             AND (SELECT MAX(p.left_at) FROM participant p WHERE p.room_id = r.id)
               < now() - make_interval(secs => $2)
           FOR UPDATE OF r`,
          [candidateIds, olderThanMs / 1000],
        );
        roomIds = recheckResult.rows.map((row) => row.id);
      }

      if (roomIds.length > 0) {
        // ON DELETE CASCADE/RESTRICTの解決順に依存しないよう、依存関係の深い順に明示的に削除する。
        await client.query(
          `DELETE FROM answer
           WHERE game_session_id IN (SELECT id FROM game_session WHERE room_id = ANY($1::uuid[]))`,
          [roomIds],
        );
        await client.query(
          `DELETE FROM session_participant WHERE room_id = ANY($1::uuid[])`,
          [roomIds],
        );
        await client.query(
          `DELETE FROM game_session WHERE room_id = ANY($1::uuid[])`,
          [roomIds],
        );
        await client.query(
          `DELETE FROM participant WHERE room_id = ANY($1::uuid[])`,
          [roomIds],
        );
        await client.query(`DELETE FROM room WHERE id = ANY($1::uuid[])`, [roomIds]);
      }

      await client.query("COMMIT");
      return roomIds;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async authorizedHostSession(
    client: PoolClient,
    sessionId: string,
    tokenHash: string,
  ): Promise<TimedSessionRow> {
    const result = await client.query<TimedSessionRow>(
      `SELECT gs.id, gs.room_id, gs.session_number, gs.status, gs.question_count,
         gs.choice_order_version,
         gs.answer_time_seconds, gs.question_answer_time_seconds, gs.current_question_index,
         gs.question_started_at, gs.question_review_started_at, gs.review_ends_at,
         gs.started_at, gs.finished_at,
         gs.question_review_started_at IS NULL
           AND clock_timestamp() >= gs.question_started_at
           AND clock_timestamp() <= gs.question_started_at
             + make_interval(secs => gs.answer_time_seconds) AS answer_window_open
       FROM game_session gs
       JOIN participant p ON p.room_id = gs.room_id
       WHERE gs.id = $1
         AND p.access_token_hash = $2
         AND p.role = 'host'
         AND p.left_at IS NULL
       FOR UPDATE OF gs`,
      [sessionId, tokenHash],
    );
    const session = result.rows[0];
    if (!session) {
      throw new ApiError(403, "HOST_REQUIRED", "A valid host token is required");
    }
    return session;
  }

  private async reconcileOverdueSession(
    session: SessionRow,
    reviewTimeSeconds: number,
  ): Promise<GameSessionSummary> {
    const questionIndex = session.current_question_index;
    if (questionIndex === null || session.question_started_at === null) return mapSession(session);

    const now = Date.now();
    if (session.review_ends_at !== null) {
      if (now < Date.parse(toIso(session.review_ends_at)) + SESSION_RECOVERY_GRACE_MS) {
        return mapSession(session);
      }
      const recovered = questionIndex + 1 >= session.question_count
        ? await this.completeSessionAutomatically(session.id)
        : await this.advanceQuestionAutomatically(session.id, questionIndex);
      return recovered ?? mapSession(session);
    }

    const answerEndsAt = Date.parse(toIso(session.question_started_at)) +
      session.answer_time_seconds * 1000;
    if (now < answerEndsAt + SESSION_RECOVERY_GRACE_MS) return mapSession(session);
    const review = await this.beginQuestionReview(
      session.id,
      questionIndex,
      reviewTimeSeconds * 1000,
    );
    return review ?? mapSession(session);
  }
}

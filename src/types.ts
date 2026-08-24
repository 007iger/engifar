export type RoomStatus = "lobby" | "playing" | "results" | "closed";
export type ParticipantRole = "host" | "player";
export type SessionStatus = "active" | "completed" | "cancelled";
export type GameGenre = "web" | "linebot" | "modeling" | "game";

export interface RoomSummary {
  id: string;
  code: string;
  status: RoomStatus;
  genre: string;
  createdAt: string;
}

export interface ParticipantSummary {
  id: string;
  displayName: string;
  role: ParticipantRole;
  joinedAt: string;
}

export interface RoomDetail extends RoomSummary {
  participants: ParticipantSummary[];
}

export interface MembershipResult {
  room: RoomSummary;
  participant: ParticipantSummary;
  accessToken: string;
}

export interface GameSessionSummary {
  id: string;
  roomId: string;
  sessionNumber: number;
  status: SessionStatus;
  questionCount: number;
  answerTimeSeconds: number;
  currentQuestionIndex: number | null;
  questionStartedAt: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AnswerSummary {
  id: string;
  gameSessionId: string;
  participantId: string;
  questionIndex: number;
  selectedOption: number;
  responseTimeMs: number;
  answeredAt: string;
}

export interface AuthenticatedParticipant {
  roomId: string;
  participant: ParticipantSummary;
}

export interface GameRepository {
  healthCheck(): Promise<void>;
  createRoom(displayName: string): Promise<MembershipResult>;
  joinRoom(code: string, displayName: string): Promise<MembershipResult>;
  getRoom(code: string): Promise<RoomDetail>;
  /** WebSocket接続時に (roomCode, accessToken) から参加者と部屋(roomId)を特定するための認証。 */
  authenticateParticipant(roomCode: string, accessToken: string): Promise<AuthenticatedParticipant>;
  /** ホストが分野を選ぶ。部屋がlobby状態の間だけ許可される。 */
  selectGenre(code: string, accessToken: string, genre: GameGenre): Promise<RoomSummary>;
  startSession(code: string, accessToken: string): Promise<GameSessionSummary>;
  startQuestion(
    sessionId: string,
    accessToken: string,
    questionIndex: number,
  ): Promise<GameSessionSummary>;
  submitAnswer(
    sessionId: string,
    accessToken: string,
    questionIndex: number,
    selectedOption: number,
  ): Promise<AnswerSummary>;
  completeSession(sessionId: string, accessToken: string): Promise<GameSessionSummary>;

  /**
   * サーバー主導の進行ループ専用(トークン不要)。ホストではなくサーバー自身が
   * 制限時間経過を検知して次の問題に進めるために使う。
   * fromIndexの時点からすでに状態が変わっていた場合(ホストが手動操作した等)はnullを返し、何もしない。
   */
  advanceQuestionAutomatically(
    sessionId: string,
    fromIndex: number,
  ): Promise<GameSessionSummary | null>;
  /** サーバー主導の進行ループ専用(トークン不要)。最後の問題が終わった時にセッションを完了させる。 */
  completeSessionAutomatically(sessionId: string): Promise<GameSessionSummary | null>;
}

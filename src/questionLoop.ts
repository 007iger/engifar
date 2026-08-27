import type { GameRepository, GameSessionSummary } from "./types.ts";
import { broadcast } from "./ws.ts";

// DBの絶対時刻を正として「回答→答え合わせ→次の問題」を進める。
// 同じ処理が複数インスタンスで走っても、DB更新の条件に合った1つだけが遷移を確定する。

const REVIEW_TIME_MS = 5_000;

interface PendingQuestion {
  timeoutId: ReturnType<typeof setTimeout>;
  questionIndex: number;
  phase: "answer" | "review";
}

const pendingQuestions = new Map<string, PendingQuestion>();

function replacePending(
  sessionId: string,
  questionIndex: number,
  phase: PendingQuestion["phase"],
  delayMs: number,
  callback: () => Promise<void>,
): void {
  const current = pendingQuestions.get(sessionId);
  if (current) clearTimeout(current.timeoutId);
  const timeoutId = setTimeout(() => {
    const pending = pendingQuestions.get(sessionId);
    if (pending?.timeoutId === timeoutId) pendingQuestions.delete(sessionId);
    void callback().catch((error) => console.error("Question transition failed", error));
  }, Math.max(0, delayMs));
  pendingQuestions.set(sessionId, { timeoutId, questionIndex, phase });
}

function scheduleReviewAdvance(
  repository: GameRepository,
  session: GameSessionSummary,
  reviewTimeMs: number,
  broadcastReview: boolean,
): void {
  const questionIndex = session.currentQuestionIndex;
  if (questionIndex === null || !session.reviewEndsAt) return;
  const reviewEndsAt = Date.parse(session.reviewEndsAt);
  if (broadcastReview) {
    broadcast(session.roomId, { type: "question_ended", questionIndex, reviewEndsAt });
  }

  replacePending(
    session.id,
    questionIndex,
    "review",
    reviewEndsAt - Date.now(),
    async () => {
      const isLastQuestion = questionIndex + 1 >= session.questionCount;
      if (isLastQuestion) {
        const completed = await repository.completeSessionAutomatically(session.id);
        if (completed) broadcast(session.roomId, { type: "all_questions_done" });
        return;
      }

      const advanced = await repository.advanceQuestionAutomatically(session.id, questionIndex);
      if (!advanced || advanced.currentQuestionIndex === null) return;
      broadcast(session.roomId, {
        type: "question_started",
        sessionId: advanced.id,
        questionIndex: advanced.currentQuestionIndex,
        timeLimitSeconds: advanced.answerTimeSeconds,
        questionStartedAt: advanced.questionStartedAt,
      });
      scheduleQuestionAdvance(repository, advanced, reviewTimeMs);
    },
  );
}

export function scheduleQuestionAdvance(
  repository: GameRepository,
  session: GameSessionSummary,
  reviewTimeMs: number = REVIEW_TIME_MS,
): void {
  const questionIndex = session.currentQuestionIndex;
  if (questionIndex === null || !session.questionStartedAt || session.status !== "active") return;
  if (session.reviewEndsAt) {
    scheduleReviewAdvance(repository, session, reviewTimeMs, false);
    return;
  }

  const answerEndsAt = Date.parse(session.questionStartedAt) + session.answerTimeSeconds * 1000;
  replacePending(
    session.id,
    questionIndex,
    "answer",
    answerEndsAt - Date.now(),
    async () => {
      const review = await repository.beginQuestionReview(
        session.id,
        questionIndex,
        reviewTimeMs,
      );
      if (review) scheduleReviewAdvance(repository, review, reviewTimeMs, true);
    },
  );
}

export async function triggerEarlyQuestionEnd(
  repository: GameRepository,
  sessionId: string,
  questionIndex: number,
  reviewTimeMs: number = REVIEW_TIME_MS,
): Promise<boolean> {
  const pending = pendingQuestions.get(sessionId);
  if (pending?.questionIndex === questionIndex && pending.phase === "answer") {
    clearTimeout(pending.timeoutId);
    pendingQuestions.delete(sessionId);
  }
  const review = await repository.beginQuestionReview(sessionId, questionIndex, reviewTimeMs);
  if (!review) return false;
  scheduleReviewAdvance(repository, review, reviewTimeMs, true);
  return true;
}

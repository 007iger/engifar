import type { GameRepository, GameSessionSummary } from "./types.ts";
import { broadcast } from "./ws.ts";

// ホストが出題を開始したら、以降は制限時間の経過をサーバーが検知して、
// 「回答→答え合わせ→次の問題」を自動で繰り返す。ホストが毎回APIを呼ぶ必要はない。

const REVIEW_TIME_MS = 5_000;

interface PendingQuestion {
  timeoutId: ReturnType<typeof setTimeout>;
  questionIndex: number;
  onAnswerWindowEnded: () => void;
}

const pendingQuestions = new Map<string, PendingQuestion>();

export function scheduleQuestionAdvance(
  repository: GameRepository,
  session: GameSessionSummary,
  reviewTimeMs: number = REVIEW_TIME_MS,
): void {
  const questionIndex = session.currentQuestionIndex;
  if (questionIndex === null) return;

  const onAnswerWindowEnded = () => {
    pendingQuestions.delete(session.id);
    const reviewEndsAt = Date.now() + reviewTimeMs;
    broadcast(session.roomId, { type: "question_ended", questionIndex, reviewEndsAt });

    setTimeout(async () => {
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
    }, reviewTimeMs);
  };

  const timeoutId = setTimeout(onAnswerWindowEnded, session.answerTimeSeconds * 1000);
  pendingQuestions.set(session.id, { timeoutId, questionIndex, onAnswerWindowEnded });
}

export function triggerEarlyQuestionEnd(sessionId: string, questionIndex: number): boolean {
  const pending = pendingQuestions.get(sessionId);
  if (!pending || pending.questionIndex !== questionIndex) return false;

  clearTimeout(pending.timeoutId);
  pending.onAnswerWindowEnded();
  return true;
}

import type { GameRepository, GameSessionSummary } from "./types.ts";
import { broadcast } from "./ws.ts";

// ホストが出題を開始したら、以降は制限時間の経過をサーバーが検知して、
// 「回答→答え合わせ→次の問題」を自動で繰り返す。ホストが毎回APIを呼ぶ必要はない。
// 全員が回答し終えた場合は、triggerEarlyQuestionEndで制限時間を待たずに進められる。

const REVIEW_TIME_MS = 5_000;

interface PendingQuestion {
  timeoutId: ReturnType<typeof setTimeout>;
  questionIndex: number;
  onAnswerWindowEnded: () => void;
}

// sessionIdごとに「今どの問題の回答時間タイマーが動いているか」を覚えておく。
const pendingQuestions = new Map<string, PendingQuestion>();

/**
 * 出題開始(question_started配信)の直後に呼び出す。
 * answerTimeSeconds経過後にquestion_endedを配信し、さらにreviewTimeMs後に
 * 次の問題を自動開始する(最後の問題ならセッションを自動終了する)。
 *
 * reviewTimeMsは通常省略してデフォルト(5秒)を使う。テストから短い時間を渡せるように引数化している。
 */
export function scheduleQuestionAdvance(
  repository: GameRepository,
  session: GameSessionSummary,
  reviewTimeMs: number = REVIEW_TIME_MS,
): void {
  const questionIndex = session.currentQuestionIndex;
  if (questionIndex === null) return;

  const onAnswerWindowEnded = () => {
    pendingQuestions.delete(session.id);
    broadcast(session.roomId, { type: "question_ended", questionIndex });

    setTimeout(async () => {
      const isLastQuestion = questionIndex + 1 >= session.questionCount;

      if (isLastQuestion) {
        const completed = await repository.completeSessionAutomatically(session.id);
        if (completed) {
          broadcast(session.roomId, { type: "all_questions_done" });
        }
        return;
      }

      // fromIndexが一致しない場合はホストがすでに手動操作しているので、何もしない。
      const advanced = await repository.advanceQuestionAutomatically(session.id, questionIndex);
      if (!advanced || advanced.currentQuestionIndex === null) return;

      broadcast(session.roomId, {
        type: "question_started",
        questionIndex: advanced.currentQuestionIndex,
        timeLimitSeconds: advanced.answerTimeSeconds,
      });

      scheduleQuestionAdvance(repository, advanced, reviewTimeMs);
    }, reviewTimeMs);
  };

  const timeoutId = setTimeout(onAnswerWindowEnded, session.answerTimeSeconds * 1000);
  pendingQuestions.set(session.id, { timeoutId, questionIndex, onAnswerWindowEnded });
}

/**
 * 全員が回答し終えた時などに、制限時間を待たずに即座に答え合わせ(question_ended)へ進める。
 * 指定した問題がすでに終わっている/対象が見つからない場合はfalseを返し、何もしない。
 */
export function triggerEarlyQuestionEnd(sessionId: string, questionIndex: number): boolean {
  const pending = pendingQuestions.get(sessionId);
  if (!pending || pending.questionIndex !== questionIndex) return false;

  clearTimeout(pending.timeoutId);
  pending.onAnswerWindowEnded();
  return true;
}

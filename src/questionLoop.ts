import type { GameRepository, GameSessionSummary } from "./types.ts";
import { broadcast } from "./ws.ts";

// ホストが出題を開始したら、以降は制限時間の経過をサーバーが検知して、
// 「回答→答え合わせ→次の問題」を自動で繰り返す。ホストが毎回APIを呼ぶ必要はない。

const REVIEW_TIME_MS = 5_000;

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

  const answerWindowMs = session.answerTimeSeconds * 1000;

  setTimeout(() => {
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
  }, answerWindowMs);
}

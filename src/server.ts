import { createApp } from "./app.ts";
import { applyMigrations } from "./db/migrate.ts";
import { createPool } from "./db/pool.ts";
import { databaseMetricsSnapshot, startDatabaseMetricsLogger } from "./db/metrics.ts";
import { PostgresGameRepository } from "./db/postgres_game_repository.ts";
import { seedQuizQuestions } from "./db/seed_quiz_questions.ts";
import { createQuizService } from "./quiz.ts";
import { startRoomCleanupMonitor } from "./roomCleanup.ts";
import { startBroadcastChannel, startHeartbeatMonitor } from "./ws.ts";

export async function startServer(): Promise<Deno.HttpServer> {
  const pool = createPool();
  try {
    await applyMigrations(pool);
    await seedQuizQuestions(pool);
    console.log("Database migrations applied");

    const repository = new PostgresGameRepository(pool);
    const quizTokenSecret = Deno.env.get("QUIZ_TOKEN_SECRET");
    if (!quizTokenSecret) {
      throw new Error(
        "QUIZ_TOKEN_SECRET is required so quiz tokens and choice order remain stable",
      );
    }
    // デモ発表などで問題数を短縮したい場合、QUIZ_QUESTION_COUNTを設定する(未設定なら通常の24問)。
    const rawQuestionCount = Deno.env.get("QUIZ_QUESTION_COUNT");
    // 同様に、答え合わせの表示時間を短くしたい場合はQUIZ_REVIEW_TIME_SECONDSを設定する(未設定なら5秒)。
    const rawReviewTimeSeconds = Deno.env.get("QUIZ_REVIEW_TIME_SECONDS");
    const quizService = createQuizService({
      secret: quizTokenSecret,
      questionCount: rawQuestionCount === undefined ? undefined : Number(rawQuestionCount),
      reviewTimeSeconds: rawReviewTimeSeconds === undefined
        ? undefined
        : Number(rawReviewTimeSeconds),
    });
    startBroadcastChannel();
    startHeartbeatMonitor(repository);
    startRoomCleanupMonitor(repository);
    startDatabaseMetricsLogger(pool);
    return Deno.serve(createApp(repository, {
      quizService,
      databaseMetrics: () => databaseMetricsSnapshot(pool),
    }));
  } catch (error) {
    await pool.end();
    throw error;
  }
}

if (import.meta.main) {
  await startServer();
}

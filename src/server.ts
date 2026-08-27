import { createApp } from "./app.ts";
import { applyMigrations } from "./db/migrate.ts";
import { createPool } from "./db/pool.ts";
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
    const quizService = createQuizService({ secret: quizTokenSecret });
    startBroadcastChannel();
    startHeartbeatMonitor(repository);
    startRoomCleanupMonitor(repository);
    return Deno.serve(createApp(repository, { quizService }));
  } catch (error) {
    await pool.end();
    throw error;
  }
}

if (import.meta.main) {
  await startServer();
}

import { createApp } from "./app.ts";
import { applyMigrations } from "./db/migrate.ts";
import { createPool } from "./db/pool.ts";
import { PostgresGameRepository } from "./db/postgres_game_repository.ts";
import { createQuizService } from "./quiz.ts";
import { startHeartbeatMonitor } from "./ws.ts";

export async function startServer(): Promise<Deno.HttpServer> {
  const pool = createPool();
  try {
    await applyMigrations(pool);
    console.log("Database migrations applied");

    const repository = new PostgresGameRepository(pool);
    const quizTokenSecret = Deno.env.get("QUIZ_TOKEN_SECRET");
    if (!quizTokenSecret) {
      console.warn(
        "QUIZ_TOKEN_SECRET is not set; quiz tokens will become invalid after a server restart",
      );
    }
    const quizService = createQuizService(
      quizTokenSecret ? { secret: quizTokenSecret } : undefined,
    );
    startHeartbeatMonitor(repository);
    return Deno.serve(createApp(repository, { quizService }));
  } catch (error) {
    await pool.end();
    throw error;
  }
}

if (import.meta.main) {
  await startServer();
}

import { createApp } from "./app.ts";
import { applyMigrations } from "./db/migrate.ts";
import { createPool } from "./db/pool.ts";
import { PostgresGameRepository } from "./db/postgres_game_repository.ts";
import { startHeartbeatMonitor } from "./ws.ts";

export async function startServer(): Promise<Deno.HttpServer> {
  const pool = createPool();
  try {
    await applyMigrations(pool);
    console.log("Database migrations applied");

    const repository = new PostgresGameRepository(pool);
    startHeartbeatMonitor(repository);
    return Deno.serve(createApp(repository));
  } catch (error) {
    await pool.end();
    throw error;
  }
}

if (import.meta.main) {
  await startServer();
}

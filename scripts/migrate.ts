import { createPool } from "../src/db/pool.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { seedQuizQuestions } from "../src/db/seed_quiz_questions.ts";

const pool = createPool();

try {
  const applied = await applyMigrations(pool);
  await seedQuizQuestions(pool);
  console.log(
    applied.length > 0 ? `Applied migrations: ${applied.join(", ")}` : "Database is up to date",
  );
} finally {
  await pool.end();
}

import type { Pool } from "pg";
import { QUIZ_QUESTION_BANK } from "../../data/quiz_question_bank.ts";

export async function seedQuizQuestions(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('engifar_quiz_question_seed'))");
    await client.query(
      `INSERT INTO quiz_question (
         id, category, difficulty, weight, answer_time_seconds, instruction,
         question, choices, correct_option, explanation, active, updated_at
       )
       SELECT question.id, question.category, question.difficulty, question.weight,
         question.answer_time_seconds, question.instruction, question.question,
         question.choices, question.correct_option, question.explanation, true, now()
       FROM jsonb_to_recordset($1::jsonb) AS question(
         id varchar(64), category varchar(32), difficulty smallint, weight smallint,
         answer_time_seconds smallint, instruction text, question text, choices text[],
         correct_option smallint, explanation text
       )
       ON CONFLICT (id) DO UPDATE SET
         category = EXCLUDED.category,
         difficulty = EXCLUDED.difficulty,
         weight = EXCLUDED.weight,
         answer_time_seconds = EXCLUDED.answer_time_seconds,
         instruction = EXCLUDED.instruction,
         question = EXCLUDED.question,
         choices = EXCLUDED.choices,
         correct_option = EXCLUDED.correct_option,
         explanation = EXCLUDED.explanation,
         active = true,
         updated_at = now()`,
      [JSON.stringify(QUIZ_QUESTION_BANK.map((question) => ({
        id: question.id,
        category: question.category,
        difficulty: question.difficulty,
        weight: question.weight,
        answer_time_seconds: question.answerTimeSeconds,
        instruction: question.instruction,
        question: question.question,
        choices: question.choices,
        correct_option: question.answer,
        explanation: question.explanation,
      })))],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

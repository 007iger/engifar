import assert from "node:assert/strict";
import {
  calculateOutcome,
  computeMetrics,
  FLIGHT_RANKS,
  getFlightRank,
} from "../public/game-rules.js";
import { createQuizService } from "../src/quiz.ts";

const SECRET = "game-rules-test-secret-that-is-at-least-32-bytes";

Deno.test("every flight rank is reachable by a possible quiz result", async () => {
  let now = 1_000;
  const quiz = createQuizService({ secret: SECRET, now: () => now, answerTimeSeconds: 0 });
  let { progressToken } = await quiz.createAttempt();
  const questionRecords: { category: string; weight: number }[] = [];

  for (let index = 0; index < quiz.config.questionCount; index += 1) {
    const started = await quiz.startQuestion(index, progressToken);
    questionRecords.push({
      category: started.question.category,
      weight: started.question.weight,
    });
    const grade = await quiz.gradeQuestion(index, started.questionToken, null);
    if (grade.nextProgressToken) progressToken = grade.nextProgressToken;
    now += 1;
  }

  const groups = Map.groupBy(questionRecords, (record) => record.category);
  let states = new Map<string, { category: string; weight: number; correct: boolean }[]>([
    ["0:0", []],
  ]);

  for (const [category, questions] of groups) {
    const totalWeight = questions.reduce((sum, question) => sum + question.weight, 0);
    const options = Array.from({ length: 2 ** questions.length }, (_, mask) => {
      const records = questions.map((question, index) => ({
        ...question,
        correct: Boolean(mask & (1 << index)),
      }));
      const correctWeight = records.reduce(
        (sum, record) => sum + (record.correct ? record.weight : 0),
        0,
      );
      return {
        records,
        correctWeightTenths: Math.round(correctWeight * 10),
        categoryScore: Math.round((correctWeight / totalWeight) * 100),
      };
    });

    const next = new Map<string, { category: string; weight: number; correct: boolean }[]>();
    for (const [key, records] of states) {
      const [correctWeightTenths, categoryScoreSum] = key.split(":").map(Number);
      for (const option of options) {
        const nextKey = `${correctWeightTenths + option.correctWeightTenths}:` +
          `${categoryScoreSum + option.categoryScore}`;
        if (!next.has(nextKey)) next.set(nextKey, [...records, ...option.records]);
      }
    }
    states = next;
    assert.ok(category.length > 0);
  }

  const reachedRanks = new Set<string>();
  for (const records of states.values()) {
    const outcome = calculateOutcome(computeMetrics(records));
    reachedRanks.add(getFlightRank(outcome.altitude).key);
  }

  assert.deepEqual(reachedRanks, new Set(FLIGHT_RANKS.map((rank) => rank.key)));
  assert.equal(calculateOutcome({ power: 0, safety: 0 }).altitude, 0);
  assert.equal(calculateOutcome({ power: 100, safety: 100 }).altitude, 14_000);
});

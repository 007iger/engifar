import assert from "node:assert/strict";
import {
  calculateOutcome,
  computeMetrics,
  FLIGHT_RANKS,
  FLIGHT_SCORE_MAX,
  formatFlightDistance,
  getFlightProgress,
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
  type AnswerRecord = { category: string; weight: number; correct: boolean };
  type MetricState = { records: AnswerRecord[]; patternCount: number };
  let states = new Map<string, MetricState>([
    ["0:0:0", { records: [], patternCount: 1 }],
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

    const next = new Map<string, MetricState>();
    for (const [key, state] of states) {
      const [correctWeightTenths, categoryScoreSum, categoryScoreSquareSum] = key.split(":")
        .map(Number);
      for (const option of options) {
        const nextKey = `${correctWeightTenths + option.correctWeightTenths}:` +
          `${categoryScoreSum + option.categoryScore}:` +
          `${categoryScoreSquareSum + option.categoryScore ** 2}`;
        const existing = next.get(nextKey);
        if (existing) existing.patternCount += state.patternCount;
        else {
          next.set(nextKey, {
            records: [...state.records, ...option.records],
            patternCount: state.patternCount,
          });
        }
      }
    }
    states = next;
    assert.ok(category.length > 0);
  }

  const rankCounts = new Map(FLIGHT_RANKS.map((rank) => [rank.key, 0]));
  for (const state of states.values()) {
    const outcome = calculateOutcome(computeMetrics(state.records));
    const rank = getFlightRank(outcome.flightScore);
    rankCounts.set(rank.key, (rankCounts.get(rank.key) || 0) + state.patternCount);
  }

  assert.equal([...rankCounts.values()].reduce((sum, count) => sum + count, 0), 2 ** 24);
  FLIGHT_RANKS.forEach((rank) => {
    assert.ok((rankCounts.get(rank.key) || 0) > 0, `${rank.name} must be reachable`);
  });
  assert.equal(calculateOutcome({ power: 0, safety: 0 }).flightScore, 0);
  assert.equal(calculateOutcome({ power: 0, safety: 0 }).distanceKm, 0);
  assert.equal(calculateOutcome({ power: 100, safety: 100 }).flightScore, FLIGHT_SCORE_MAX);
  assert.equal(calculateOutcome({ power: 100, safety: 0 }).flightScore, 9_100);
});

Deno.test("flight ranks display astronomical distance scales separately from scoring", () => {
  const expectedDistance = new Map([
    ["crash", "0 km"],
    ["space_entry", "100 km"],
    ["moon", "38.4 万 km"],
    ["mars", "5,460 万 km"],
    ["uranus", "25 億 km"],
    ["neptune", "43 億 km"],
    ["galaxy", "5 万光年"],
    ["unknown", "250 万光年"],
  ]);

  FLIGHT_RANKS.forEach((rank) => {
    assert.equal(formatFlightDistance(rank.distanceKm).text, expectedDistance.get(rank.key));
  });

  const marsStart = getFlightProgress(5_600);
  assert.equal(marsStart.rank.key, "mars");
  assert.equal(marsStart.nextRank?.key, "uranus");
  assert.equal(marsStart.progressPercent, 0);
  assert.equal(marsStart.remainingScore, 2_800);

  const maximum = getFlightProgress(FLIGHT_SCORE_MAX);
  assert.equal(maximum.rank.key, "unknown");
  assert.equal(maximum.nextRank, null);
  assert.equal(maximum.progressPercent, 100);
});

Deno.test("crash rank covers the bottom ten percent of the flight score", () => {
  assert.equal(getFlightRank(0).key, "crash");
  assert.equal(getFlightRank(1_399).key, "crash");
  assert.equal(getFlightRank(1_400).key, "space_entry");

  const lastCrashScore = getFlightProgress(1_399);
  assert.equal(lastCrashScore.nextRank?.key, "space_entry");
  assert.equal(lastCrashScore.remainingScore, 1);
});

Deno.test("flight rank boundaries use the configured percentage bands", () => {
  const boundaries = [
    ["crash", 0],
    ["space_entry", 1_400],
    ["moon", 3_500],
    ["mars", 5_600],
    ["uranus", 8_400],
    ["neptune", 10_500],
    ["galaxy", 11_900],
    ["unknown", 13_300],
  ] as const;

  boundaries.forEach(([rankKey, minimum], index) => {
    assert.equal(getFlightRank(minimum).key, rankKey);
    if (index > 0) assert.notEqual(getFlightRank(minimum - 1).key, rankKey);
  });
});

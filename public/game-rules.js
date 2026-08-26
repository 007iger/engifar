export const OUTPUT_THRESHOLD = 60;
export const SAFETY_THRESHOLD = 75;

export const FLIGHT_RANKS = Object.freeze([
  {
    key: "crash",
    min: 0,
    name: "不時着級",
    destination: "海（不時着）",
    color: "#62e4ec",
    legs: ["sky", "atmosphere-edge"],
    crashLanding: true,
  },
  {
    key: "space_entry",
    min: 2800,
    name: "宇宙突入級",
    destination: "宇宙空間",
    color: "#8fe8ff",
    legs: ["sky", "atmosphere-edge", "space"],
  },
  {
    key: "moon",
    min: 4200,
    name: "月面着陸級",
    destination: "月",
    color: "#e7e4d7",
    legs: ["sky", "atmosphere-edge", "space", "space"],
    approachColor: "oklch(0.88 0.02 90)",
  },
  {
    key: "mars",
    min: 6500,
    name: "火星着陸級",
    destination: "火星",
    color: "#ff855f",
    legs: ["sky", "atmosphere-edge", "space", "space"],
    approachColor: "oklch(0.62 0.19 32)",
  },
  {
    key: "uranus",
    min: 8500,
    name: "天王星着陸級",
    destination: "天王星",
    color: "#72e3e6",
    legs: ["sky", "atmosphere-edge", "space", "space"],
    approachColor: "oklch(0.82 0.09 200)",
  },
  {
    key: "neptune",
    min: 10500,
    name: "海王星着陸級",
    destination: "海王星",
    color: "#678eff",
    legs: ["sky", "atmosphere-edge", "space", "space"],
    approachColor: "oklch(0.5 0.16 262)",
  },
  {
    key: "galaxy",
    min: 12000,
    name: "銀河超越級",
    destination: "新しい銀河",
    color: "#d58cff",
    legs: ["sky", "atmosphere-edge", "space", "space", "space"],
    approachColor: "oklch(0.7 0.16 300)",
  },
  {
    key: "unknown",
    min: 13500,
    name: "未知の惑星到達級",
    destination: "未知の惑星",
    color: "#ffd36a",
    legs: ["sky", "atmosphere-edge", "space", "space", "space"],
    approachColor: "oklch(0.85 0.18 40)",
  },
]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function safetyFromCategoryScores(values) {
  const scores = values.map((value) => clamp(safeNumber(value), 0, 100));
  if (!scores.length) return 0;
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const variance = scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / scores.length;
  return Math.round(clamp(mean - 0.5 * Math.sqrt(variance), 0, 100));
}

export function computeMetrics(records) {
  const completedRecords = records.filter((record) =>
    record && typeof record.category === "string" && Number.isFinite(Number(record.weight))
  );
  const categories = [...new Set(completedRecords.map((record) => record.category))];
  let correctWeight = 0;
  let totalWeight = 0;
  const categoryScores = {};

  completedRecords.forEach((record) => {
    const weight = Math.max(0, safeNumber(record.weight));
    totalWeight += weight;
    if (record.correct) correctWeight += weight;
  });

  categories.forEach((category) => {
    let categoryCorrect = 0;
    let categoryTotal = 0;
    completedRecords.forEach((record) => {
      if (record.category !== category) return;
      const weight = Math.max(0, safeNumber(record.weight));
      categoryTotal += weight;
      if (record.correct) categoryCorrect += weight;
    });
    categoryScores[category] = categoryTotal
      ? Math.round((categoryCorrect / categoryTotal) * 100)
      : 0;
  });

  const power = totalWeight ? Math.round((correctWeight / totalWeight) * 100) : 0;
  const safety = safetyFromCategoryScores(Object.values(categoryScores));
  return { power, safety, categoryScores };
}

export function getFlightRank(altitude) {
  const height = Math.max(0, safeNumber(altitude));
  return [...FLIGHT_RANKS].reverse().find((rank) => height >= rank.min) || FLIGHT_RANKS[0];
}

export function calculateOutcome(metrics) {
  const power = clamp(safeNumber(metrics.power), 0, 100);
  const safety = clamp(safeNumber(metrics.safety), 0, 100);
  const reachedOrbit = power >= OUTPUT_THRESHOLD && safety >= SAFETY_THRESHOLD;

  // 出力と安全性を同じ比重で0〜14,000へ写像し、ランク間に到達不能な空白を作らない。
  const altitude = Math.round((power + safety) * 70);
  const average = (power + safety) / 2;

  let title = "空へ一歩、ナイスフライト！";
  if (reachedOrbit) title = "軌道到達！";
  else if (average >= 72) title = "星空手前で大きなきらめき！";
  else if (average >= 48) title = "雲の上までフライト！";

  const rank = getFlightRank(altitude);
  return {
    reachedOrbit,
    kind: reachedOrbit ? "orbit" : "spark",
    altitude,
    title,
    rankKey: rank.key,
    rankName: rank.name,
    destination: rank.destination,
  };
}

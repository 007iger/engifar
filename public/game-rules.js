export const OUTPUT_THRESHOLD = 60;
export const SAFETY_THRESHOLD = 75;
export const FLIGHT_SCORE_MAX = 14_000;

const POWER_SCORE_WEIGHT = 0.65;
const SAFETY_SCORE_WEIGHT = 0.35;
const LIGHT_YEAR_KM = 9_460_730_472_580.8;

export const FLIGHT_RANKS = Object.freeze([
  {
    key: "crash",
    min: 0,
    name: "不時着級",
    destination: "海（不時着）",
    distanceKm: 0,
    distanceNote: "海上で安全停止",
    measure: "distance",
    approximateDistance: false,
    color: "#62e4ec",
    legs: ["sky", "atmosphere-edge"],
    crashLanding: true,
  },
  {
    key: "space_entry",
    min: 1400,
    name: "宇宙突入級",
    destination: "宇宙空間",
    distanceKm: 100,
    distanceNote: "宇宙との境界・カーマンライン",
    measure: "altitude",
    approximateDistance: false,
    color: "#8fe8ff",
    legs: ["sky", "atmosphere-edge", "space"],
  },
  {
    key: "moon",
    min: 3500,
    name: "月面着陸級",
    destination: "月",
    distanceKm: 384_400,
    distanceNote: "地球から月までの平均距離",
    measure: "distance",
    approximateDistance: true,
    color: "#e7e4d7",
    legs: ["sky", "atmosphere-edge", "space", "space"],
    approachColor: "oklch(0.88 0.02 90)",
  },
  {
    key: "mars",
    min: 5600,
    name: "火星着陸級",
    destination: "火星",
    distanceKm: 54_600_000,
    distanceNote: "地球から火星までの最接近距離",
    measure: "distance",
    approximateDistance: true,
    color: "#ff855f",
    legs: ["sky", "atmosphere-edge", "space", "space"],
    approachColor: "oklch(0.62 0.19 32)",
  },
  {
    key: "uranus",
    min: 8400,
    name: "天王星着陸級",
    destination: "天王星",
    distanceKm: 2_500_000_000,
    distanceNote: "地球から天王星までの概算距離",
    measure: "distance",
    approximateDistance: true,
    color: "#72e3e6",
    legs: ["sky", "atmosphere-edge", "space", "space"],
    approachColor: "oklch(0.82 0.09 200)",
  },
  {
    key: "neptune",
    min: 10500,
    name: "海王星着陸級",
    destination: "海王星",
    distanceKm: 4_300_000_000,
    distanceNote: "地球から海王星までの概算距離",
    measure: "distance",
    approximateDistance: true,
    color: "#678eff",
    legs: ["sky", "atmosphere-edge", "space", "space"],
    approachColor: "oklch(0.5 0.16 262)",
  },
  {
    key: "galaxy",
    min: 11900,
    name: "銀河超越級",
    destination: "銀河の彼方",
    distanceKm: 50_000 * LIGHT_YEAR_KM,
    distanceNote: "天の川銀河の外縁までの目安",
    measure: "distance",
    approximateDistance: true,
    color: "#d58cff",
    legs: ["sky", "atmosphere-edge", "space", "space", "space"],
    approachColor: "oklch(0.7 0.16 300)",
  },
  {
    key: "unknown",
    min: 13300,
    name: "未知の惑星到達級",
    destination: "未知の惑星",
    distanceKm: 2_500_000 * LIGHT_YEAR_KM,
    distanceNote: "アンドロメダ銀河級の航行距離",
    measure: "distance",
    approximateDistance: true,
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

export function getFlightRank(score) {
  const flightScore = Math.max(0, safeNumber(score));
  return [...FLIGHT_RANKS].reverse().find((rank) => flightScore >= rank.min) || FLIGHT_RANKS[0];
}

function roundTo(value, fractionDigits) {
  const scale = 10 ** fractionDigits;
  return Math.round(value * scale) / scale;
}

export function formatFlightDistance(distanceKm) {
  const kilometers = Math.max(0, safeNumber(distanceKm));
  let value = kilometers;
  let unit = "km";
  let fractionDigits = 0;

  if (kilometers >= LIGHT_YEAR_KM * 10_000) {
    value = kilometers / LIGHT_YEAR_KM / 10_000;
    unit = "万光年";
    fractionDigits = value < 10 && !Number.isInteger(value) ? 1 : 0;
  } else if (kilometers >= LIGHT_YEAR_KM) {
    value = kilometers / LIGHT_YEAR_KM;
    unit = "光年";
    fractionDigits = value < 10 ? 1 : 0;
  } else if (kilometers >= 100_000_000) {
    value = kilometers / 100_000_000;
    unit = "億 km";
    fractionDigits = value < 10 && !Number.isInteger(value) ? 1 : 0;
  } else if (kilometers >= 10_000) {
    value = kilometers / 10_000;
    unit = "万 km";
    fractionDigits = value < 100 && !Number.isInteger(value) ? 1 : 0;
  }

  value = roundTo(value, fractionDigits);
  const formattedValue = value.toLocaleString("ja-JP", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return {
    value,
    unit,
    fractionDigits,
    formattedValue,
    text: `${formattedValue} ${unit}`,
  };
}

export function getFlightProgress(score) {
  const flightScore = Math.round(clamp(safeNumber(score), 0, FLIGHT_SCORE_MAX));
  const rank = getFlightRank(flightScore);
  const rankIndex = FLIGHT_RANKS.indexOf(rank);
  const nextRank = FLIGHT_RANKS[rankIndex + 1] || null;
  if (!nextRank) {
    return { rank, nextRank: null, progressPercent: 100, remainingScore: 0 };
  }
  const interval = nextRank.min - rank.min;
  const progressPercent = interval
    ? Math.round(clamp(((flightScore - rank.min) / interval) * 100, 0, 100))
    : 100;
  return {
    rank,
    nextRank,
    progressPercent,
    remainingScore: Math.max(0, nextRank.min - flightScore),
  };
}

export function calculateOutcome(metrics) {
  const power = clamp(safeNumber(metrics.power), 0, 100);
  const safety = clamp(safeNumber(metrics.safety), 0, 100);
  const reachedOrbit = power >= OUTPUT_THRESHOLD && safety >= SAFETY_THRESHOLD;

  // 正答による出力を主軸に、分野バランスを安全性として加え、0〜14,000へ連続写像する。
  // 分岐定数を足さないため、途中のランクにも到達可能なスコアが必ず残る。
  const flightScore = Math.round(
    (power * POWER_SCORE_WEIGHT + safety * SAFETY_SCORE_WEIGHT) *
      (FLIGHT_SCORE_MAX / 100),
  );
  const average = (power + safety) / 2;

  let title = "空へ一歩、ナイスフライト！";
  if (reachedOrbit) title = "軌道到達！";
  else if (average >= 72) title = "星空手前で大きなきらめき！";
  else if (average >= 48) title = "雲の上までフライト！";

  const progress = getFlightProgress(flightScore);
  const rank = progress.rank;
  return {
    reachedOrbit,
    kind: reachedOrbit ? "orbit" : "spark",
    flightScore,
    // 保存済みデータとの互換用。値は距離ではなく内部フライトスコア。
    altitude: flightScore,
    distanceKm: rank.distanceKm,
    title,
    rankKey: rank.key,
    rankName: rank.name,
    destination: rank.destination,
    nextRankKey: progress.nextRank?.key || null,
    nextRankName: progress.nextRank?.name || null,
    rankProgress: progress.progressPercent,
    scoreToNextRank: progress.remainingScore,
  };
}

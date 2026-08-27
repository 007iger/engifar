import type { Pool, PoolClient } from "pg";

type QueryOperation = "select" | "insert" | "update" | "delete" | "transaction" | "other";

export interface DatabaseMetricsSnapshot {
  queries: {
    total: number;
    failed: number;
    inFlight: number;
    totalDurationMs: number;
    maxDurationMs: number;
    byOperation: Record<QueryOperation, number>;
  };
  pool: {
    totalConnections: number;
    idleConnections: number;
    waitingRequests: number;
  };
}

const EMPTY_OPERATION_COUNTS = Object.freeze({
  select: 0,
  insert: 0,
  update: 0,
  delete: 0,
  transaction: 0,
  other: 0,
});

function operationFrom(sql: string): QueryOperation {
  const operation = sql.trimStart().match(/^[a-z]+/i)?.[0]?.toLowerCase();
  if (operation === "select") return "select";
  if (operation === "insert") return "insert";
  if (operation === "update") return "update";
  if (operation === "delete") return "delete";
  if (operation === "begin" || operation === "commit" || operation === "rollback") {
    return "transaction";
  }
  return "other";
}

function queryText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) {
    const text = (value as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

export class DatabaseMetrics {
  #total = 0;
  #failed = 0;
  #inFlight = 0;
  #totalDurationMs = 0;
  #maxDurationMs = 0;
  readonly #byOperation: Record<QueryOperation, number> = { ...EMPTY_OPERATION_COUNTS };

  begin(sql: string): (error?: unknown) => void {
    const startedAt = performance.now();
    const operation = operationFrom(sql);
    this.#total += 1;
    this.#inFlight += 1;
    this.#byOperation[operation] += 1;
    let finished = false;
    return (error?: unknown) => {
      if (finished) return;
      finished = true;
      if (error) this.#failed += 1;
      const durationMs = performance.now() - startedAt;
      this.#inFlight -= 1;
      this.#totalDurationMs += durationMs;
      this.#maxDurationMs = Math.max(this.#maxDurationMs, durationMs);
    };
  }

  async measure<T>(sql: string, query: () => Promise<T>): Promise<T> {
    const finish = this.begin(sql);
    try {
      const result = await query();
      finish();
      return result;
    } catch (error) {
      finish(error);
      throw error;
    }
  }

  snapshot(pool: Pool): DatabaseMetricsSnapshot {
    return {
      queries: {
        total: this.#total,
        failed: this.#failed,
        inFlight: this.#inFlight,
        totalDurationMs: Math.round(this.#totalDurationMs * 10) / 10,
        maxDurationMs: Math.round(this.#maxDurationMs * 10) / 10,
        byOperation: { ...this.#byOperation },
      },
      pool: {
        totalConnections: pool.totalCount,
        idleConnections: pool.idleCount,
        waitingRequests: pool.waitingCount,
      },
    };
  }
}

type QueryMethod = (...args: unknown[]) => unknown;
const instrumentedClients = new WeakSet<PoolClient>();
const metricsByPool = new WeakMap<Pool, DatabaseMetrics>();

function instrumentClient(client: PoolClient, metrics: DatabaseMetrics): void {
  if (instrumentedClients.has(client)) return;
  instrumentedClients.add(client);
  const originalQuery = client.query.bind(client) as unknown as QueryMethod;
  (client as unknown as { query: QueryMethod }).query = (...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === "function") {
      const finish = metrics.begin(queryText(args[0]));
      const wrappedCallback = (...callbackArgs: unknown[]) => {
        finish(callbackArgs[0]);
        return callback(...callbackArgs);
      };
      return originalQuery(...args.slice(0, -1), wrappedCallback);
    }
    return metrics.measure(queryText(args[0]), async () => await originalQuery(...args));
  };
}

export function instrumentDatabasePool(pool: Pool): Pool {
  const metrics = new DatabaseMetrics();
  metricsByPool.set(pool, metrics);
  pool.on("connect", (client) => instrumentClient(client, metrics));
  return pool;
}

export function databaseMetricsSnapshot(pool: Pool): DatabaseMetricsSnapshot {
  const metrics = metricsByPool.get(pool);
  if (!metrics) throw new Error("Database pool metrics are not initialized");
  return metrics.snapshot(pool);
}

export function startDatabaseMetricsLogger(
  pool: Pool,
  intervalMs = 60_000,
): () => void {
  const timer = setInterval(() => {
    console.info(JSON.stringify({ type: "database_metrics", ...databaseMetricsSnapshot(pool) }));
  }, intervalMs);
  return () => clearInterval(timer);
}

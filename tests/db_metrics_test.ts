import assert from "node:assert/strict";
import type { Pool } from "pg";
import { DatabaseMetrics } from "../src/db/metrics.ts";

Deno.test("database metrics count operations, failures, latency, and pool pressure", async () => {
  const metrics = new DatabaseMetrics();
  await metrics.measure("SELECT 1", () => Promise.resolve({ rows: [] }));
  await assert.rejects(
    () => metrics.measure("INSERT INTO example VALUES (1)", () => Promise.reject(new Error("db"))),
    /db/,
  );

  const pool = {
    totalCount: 3,
    idleCount: 1,
    waitingCount: 2,
  } as Pool;
  const snapshot = metrics.snapshot(pool);

  assert.equal(snapshot.queries.total, 2);
  assert.equal(snapshot.queries.failed, 1);
  assert.equal(snapshot.queries.inFlight, 0);
  assert.equal(snapshot.queries.byOperation.select, 1);
  assert.equal(snapshot.queries.byOperation.insert, 1);
  assert.deepEqual(snapshot.pool, {
    totalConnections: 3,
    idleConnections: 1,
    waitingRequests: 2,
  });
});

import assert from "node:assert/strict";
import { startRoomCleanupMonitor, stopRoomCleanupMonitor } from "../src/roomCleanup.ts";
import type { GameRepository } from "../src/types.ts";

class RecordingRepository implements Partial<GameRepository> {
  calls: number[] = [];
  result: string[] = [];

  deleteExpiredEmptyRooms(olderThanMs: number): Promise<string[]> {
    this.calls.push(olderThanMs);
    return Promise.resolve(this.result);
  }
}

Deno.test("定期的にdeleteExpiredEmptyRoomsが呼ばれる", async () => {
  const repository = new RecordingRepository() as unknown as GameRepository;
  const ttlMs = 3 * 24 * 60 * 60 * 1000;

  try {
    startRoomCleanupMonitor(repository, 10, ttlMs);
    // 完了後に次回を予約する方式なので、setIntervalより多少間隔が空くことを見込んで長めに待つ。
    await new Promise((resolve) => setTimeout(resolve, 80));

    const recorded = repository as unknown as RecordingRepository;
    assert.ok(recorded.calls.length >= 2, `期待より呼び出しが少ない: ${recorded.calls.length}`);
    assert.equal(recorded.calls[0], ttlMs);
  } finally {
    stopRoomCleanupMonitor();
  }
});

Deno.test("stopRoomCleanupMonitorを呼ぶとそれ以上実行されない", async () => {
  const repository = new RecordingRepository() as unknown as GameRepository;

  startRoomCleanupMonitor(repository, 10, 1000);
  await new Promise((resolve) => setTimeout(resolve, 15));
  stopRoomCleanupMonitor();

  const countAfterStop = (repository as unknown as RecordingRepository).calls.length;
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal((repository as unknown as RecordingRepository).calls.length, countAfterStop);
});

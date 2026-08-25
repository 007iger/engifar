import type { GameRepository } from "./types.ts";

// 全員が離脱した部屋を、一定時間経過後に自動で削除するための定期チェック。
// 「3日後に削除」という方針を採用している。

const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1時間ごとにチェック
const DEFAULT_EMPTY_ROOM_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 全員離脱後3日

let cleanupTimer: ReturnType<typeof setInterval> | undefined;

/**
 * 全参加者が離脱済みで、最後の離脱からemptyRoomTtlMs以上経過した部屋を定期的に削除する。
 * サーバー起動時に1回呼ぶ想定。intervalMs/emptyRoomTtlMsはテストから短い値を渡せるようにしている。
 */
export function startRoomCleanupMonitor(
  repository: GameRepository,
  intervalMs: number = DEFAULT_CHECK_INTERVAL_MS,
  emptyRoomTtlMs: number = DEFAULT_EMPTY_ROOM_TTL_MS,
): void {
  stopRoomCleanupMonitor();
  cleanupTimer = setInterval(async () => {
    try {
      const deletedRoomIds = await repository.deleteExpiredEmptyRooms(emptyRoomTtlMs);
      if (deletedRoomIds.length > 0) {
        console.log(`部屋を自動削除しました: ${deletedRoomIds.length}件`, deletedRoomIds);
      }
    } catch (error) {
      console.error("部屋の自動削除に失敗しました", error);
    }
  }, intervalMs);
}

/** テストやサーバー終了時にタイマーを止める。 */
export function stopRoomCleanupMonitor(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
}

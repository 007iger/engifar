-- 既存セッションは従来の問題番号ベースの並び順を維持し、
-- このマイグレーション後に作るセッションだけ秘密鍵ベースの並び順へ切り替える。
ALTER TABLE game_session
  ADD COLUMN choice_order_version smallint NOT NULL DEFAULT 1;

ALTER TABLE game_session
  ALTER COLUMN choice_order_version SET DEFAULT 2;

ALTER TABLE game_session
  ADD CONSTRAINT game_session_choice_order_version_supported
  CHECK (choice_order_version IN (1, 2));

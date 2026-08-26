-- v1/v2の既存セッションは旧問題セットを維持する。
-- v3以降に作るセッションは新問題セットと秘密鍵ベースの選択肢順を使う。
ALTER TABLE game_session
  DROP CONSTRAINT game_session_choice_order_version_supported;

ALTER TABLE game_session
  ALTER COLUMN choice_order_version SET DEFAULT 3;

ALTER TABLE game_session
  ADD CONSTRAINT game_session_choice_order_version_supported
  CHECK (choice_order_version IN (1, 2, 3));

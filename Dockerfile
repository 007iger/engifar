FROM denoland/deno:latest

WORKDIR /app

# 依存関係の解決に必要なファイルを先にコピーしてキャッシュを効かせる
COPY deno.json deno.lock ./

# アプリ本体
COPY src/ ./src/
COPY public/ ./public/
COPY assets/ ./assets/
COPY migrations/ ./migrations/
COPY data/ ./data/

# npm:指定のパッケージ(pg等)を含め、依存関係をビルド時にキャッシュしておく
RUN deno cache src/server.ts

# Renderが割り当てるPORT環境変数はコンテナ起動時に注入されるため、ここでは固定しない
CMD ["deno", "task", "start"]

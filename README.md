# EngiFar

初対面のチームメンバーが同じクイズにリアルタイムで挑戦し、正答率に応じてロケットが宇宙へ飛び立つ、アイスブレイク用のマルチプレイクイズWebアプリです。

## 概要

出題される問題自体がHTML/CSS/JavaScript・バックエンドAPI・データベース・セキュリティなどWeb開発の基礎知識で構成されており、「学んだ内容を、初対面のチームメンバー同士で楽しみながら確認し合う」ことを目的としたアプリです。個人の正答率だけでなく、チーム全体の平均スコアに応じてロケットの到達距離が変わる演出になっており、個人戦ではなくチームで取り組む体験を重視しています。

## 開発背景

ハッカソン形式のチーム開発（4〜5人）として企画・実装しました。私は **Backend B（リアルタイム・API担当）** として、バックエンド全体の中でも特にリアルタイム同期・進行制御まわりを担当しています。

## 開発環境

- 言語: TypeScript
- ランタイム: [Deno 2](https://deno.com/)（ビルドステップ・フレームワーク不使用）
- データベース: PostgreSQL（node-postgres経由）
- リアルタイム通信: WebSocket（Denoネイティブ実装）
- インフラ: Deno Deploy / Render（Docker）
- CI: GitHub Actions（型チェック・lint・fmt・テスト自動化）

## 主な機能

- 部屋の作成・招待コードによる参加
- ホストによるジャンル選択・クイズ開始
- 全参加者が同時に同じ問題へ挑戦するリアルタイム出題
- 全員回答後、制限時間を待たずに自動で答え合わせへ進行
- 個人・チームスコアのサーバー集計とロケット発射演出
- 部屋の自動クリーンアップ（全員離脱後3日で削除）

## 担当・実装内容

本プロジェクトはチーム開発です。以下は、私（Backend B）が設計・実装した内容です。

- **WebSocket接続管理とハートビートによる離脱検知**: 画面遷移などの一瞬の切断を誤検知しないよう、再接続の猶予期間を設けて実装
- **サーバー主導の出題進行ループ**: ホストがAPIを毎回叩かなくても、サーバー側のタイマーで「出題→回答受付→答え合わせ→次の問題」を自動的に繰り返す仕組みを設計。全員が回答し終えたら制限時間を待たずに早期終了する機能も実装
- **答え合わせフェーズの同期不具合の調査・修正**: クライアント側が壁時計ベースの固定スケジュールに依存していたことが原因で、早期終了時にタイミングがずれる不具合を特定し、サーバーが計算した絶対時刻を配信する設計に修正
- **部屋の自動削除機能**: 全員離脱から3日後に部屋を自動削除。削除処理と参加処理が競合しないよう、PostgreSQLの行ロック（`FOR UPDATE`）を使った安全な実装
- **チーム開発中のマージ事故の調査・復元**: マージコンフリクトの解消ミスで実装済みの機能が丸ごと消える事故が発生した際、`git diff`で正常な時点との差分を機械的に洗い出して原因を特定し、他の変更に影響を与えない形で復元
- **デモ発表用の設定機能**: 環境変数で問題数・答え合わせ表示時間を短縮できる機能を追加し、発表時間に合わせた短縮版デモを実現
- **デプロイ対応**: Deno Deploy・Render（Docker）の両方で動作するよう、ポートバインディングなど環境差異を吸収する実装を追加し、個人検証環境を構築

## 工夫した点

- **サーバーとクライアントの進行タイミングを一致させる設計**: 答え合わせの終了予定を相対時間ではなく絶対時刻（UNIXタイムスタンプ）としてサーバーから配信することで、複数クライアント間の受信タイミングのズレによる表示崩れを防止
- **競合状態(race condition)への対策**: 部屋の削除・参加、答え合わせフェーズへの遷移など、複数の操作が同時に発生しうる箇所でPostgreSQLの行ロックや条件付きUPDATEを使い、データの整合性を保証
- **サーバー再起動に強い設計**: 進行状態はサーバーのメモリ上のタイマーで管理しているが、万が一サーバーが再起動してもDB上のタイムラインと突き合わせて自動的に進行状況を復旧する仕組みを整備
- **複数サーバーインスタンスへの対応**: Deno DeployのBroadcastChannelを使い、WebSocket配信が単一インスタンスのメモリに限定されないよう設計

## データベース設計

`room` / `participant` / `game_session` / `session_participant` / `answer` / `quiz_question` / `quiz_question_revision` / `session_participant_question` の8テーブル構成です。詳細は[データベースER図](docs/er-diagram.md)を参照してください。

## セットアップ方法

必要なものはDeno 2とPostgreSQLです。

```powershell
# 1. PostgreSQLにアプリ専用DBを作成
psql -U postgres -c "CREATE DATABASE engifar;"

# 2. 環境変数を設定(.env.exampleをコピーして編集)
Copy-Item .env.example .env

# 3. マイグレーション適用と開発サーバー起動
deno task --env-file=.env db:migrate
deno task --env-file=.env dev
```

確認用URL: `http://localhost:8000/api/health`

### 開発コマンド

```shell
deno task check   # 型チェック
deno task test    # テスト
deno task lint    # lint
deno task fmt:check  # フォーマットチェック
```

---

## 技術詳細（API・DB設計の補足）

<details>
<summary>クリックして展開</summary>

### API

JSONレスポンスは成功時に `{ "data": ... }`、失敗時に
`{ "error": { "code": "...", "message": "..." } }` の形で返します。

| Method | Path | 用途 | 認証 |
| --- | --- | --- | --- |
| `GET` | `/api/health` | サーバー・DB確認とDBメトリクス | なし |
| `GET` | `/api/quiz/config` | 問題数・制限時間を取得 | なし |
| `POST` | `/api/quiz/attempts` | 受験用の署名付きトークンを発行 | なし |
| `POST` | `/api/quiz/questions/:index/start` | 問題を取得（正解・解説は含まない） | 受験トークン |
| `POST` | `/api/quiz/questions/:index/grade` | 制限時間後に採点・解説を取得 | 問題トークン |
| `POST` | `/api/rooms` | 部屋とホストを作成 | なし |
| `POST` | `/api/rooms/:code/participants` | 部屋へ参加 | なし |
| `GET` | `/api/rooms/:code` | 部屋と参加者一覧を取得 | 参加者 |
| `POST` | `/api/rooms/:code/sessions` | クイズ設定に沿ったゲームを開始 | ホスト |
| `GET` | `/api/sessions/:id` | 参加中セッションの進行状況を取得 | 参加者 |
| `GET` | `/api/sessions/:id/results` | 完了した個人・チーム・ランキング結果を取得 | 参加者 |
| `PUT` | `/api/sessions/:id/results/publication` | 自分の個人結果の公開・非公開を変更 | 参加者 |
| `POST` | `/api/sessions/:id/quiz/questions/:index/start` | ルームの進行時刻に同期して問題を取得 | 参加者 |
| `POST` | `/api/sessions/:id/questions/:index/start` | 次の問題を開始 | ホスト |
| `PUT` | `/api/sessions/:id/answers/:index` | 回答を登録・変更 | 参加者 |
| `POST` | `/api/sessions/:id/complete` | ゲームを終了 | ホスト |

`/ws?roomCode=<code>`へ`["engifar-v1", "<accessToken>"]`をWebSocketサブプロトコルとして
指定して接続すると、参加・退出・問題開始・終了をリアルタイムで受信できます。画面遷移中の短い切断は
再接続猶予内なら退出扱いになりません。

部屋作成・参加レスポンスの `accessToken` を、以降のリクエストで
`Authorization: Bearer <accessToken>` として送ります。DBにはトークン本体ではなくSHA-256ハッシュだけを保存します。

### クイズ問題管理

新規セッションのクイズ問題と正解はDBの`quiz_question`で管理します。起動時に
`data/quiz_question_bank.ts`から問題マスタを同期します。6カテゴリーごとに初級10問・中級5問・
上級3問（合計108問）を保存し、各問題には画面表示用の技術・言語名（`technology`）を持たせています。
問題開始時のレスポンスには正解を含めず、HMAC署名された問題トークンを使って、回答時間が終了した
後にだけ採点結果と解説を返します。

問題マスタを修正した場合は`quiz_question_revision`へ新しい変更不能な版を追加し、
`session_participant_question.question_revision_id`はセッション開始時の版を参照し続けるため、
進行中・完了済みセッションの採点は変わりません。

### 答え合わせの早期終了と同期

各回答はDBへ保存する同じトランザクション内で、現在の参加者数と回答済み人数を比較します。全員が
回答済みになった時点でDBの状態を答え合わせへ一度だけ更新し、`question_ended`をWebSocketで配信して、
残りの回答時間を待たず全員を答え合わせ画面へ移します。通常の時間切れと同時に発生しても、DBの条件付き
更新によって二重進行を防ぎます。

通常の問題進行はWebSocketで通知し、同じイベントをDeno `BroadcastChannel`で別のDeno Deploy
インスタンスへ中継します。Deno Deployのインスタンス終了で進行タイマーが失われても、セッション取得時に
DBの問題開始時刻から2秒を超える遅延を検出し、進行状態を自己修復します。

### 観測性

各Denoインスタンスは SQL実行数・失敗数・実行時間・操作種別と、Poolの総接続数・アイドル数・
待機要求数を計測します。`/api/health`の`metrics.database`で現在値を確認でき、60秒ごとに
`type: "database_metrics"`のJSONログも出力します。

### デプロイ

デプロイのエントリポイントは `src/server.ts` です。サーバー起動時に `migrations/` の連番SQLが
バージョン順に自動適用されます。適用履歴とチェックサムは `schema_migrations` へ保存され、
同時起動時はPostgreSQLのアドバイザリーロックで直列化されます。

`QUIZ_TOKEN_SECRET`は32バイト以上の固定値を環境変数へ設定してください。デモ発表用に
`QUIZ_QUESTION_COUNT` / `QUIZ_REVIEW_TIME_SECONDS` を設定すると、問題数・答え合わせ表示時間を
短縮できます（未設定時は通常通り24問・5秒）。

</details>

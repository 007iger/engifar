export interface QuizQuestionSeed {
  id: string;
  category: string;
  difficulty: 1 | 2 | 3;
  weight: number;
  answerTimeSeconds: number;
  instruction: string;
  question: string;
  choices: readonly string[];
  answer: number;
  explanation: string;
}

type Concept = readonly [id: string, term: string, definition: string];

const CATEGORY_CONCEPTS: readonly [category: string, concepts: readonly Concept[]][] = [
  ["フロントエンド", [
    ["html", "HTML", "Webページの文書構造と意味を表すマークアップ言語"],
    ["css", "CSS", "Webページの見た目やレイアウトを指定する言語"],
    ["javascript", "JavaScript", "ブラウザ上の動きや対話処理を実装できる言語"],
    ["heading", "h1要素", "ページ内で最上位の見出しを表すHTML要素"],
    ["button", "button要素", "ユーザーが操作できるボタンを表すHTML要素"],
    ["alt", "img要素のalt属性", "画像を表示できない場合に代替テキストを伝える属性"],
    ["flex", "Flexbox", "要素を一方向に並べて配置を調整するCSSレイアウト"],
    ["grid", "CSS Grid", "行と列の二次元で要素を配置するCSSレイアウト"],
    ["media-query", "メディアクエリ", "画面幅などの条件に応じてCSSを切り替える仕組み"],
    ["event-listener", "addEventListener", "指定したイベントの発生時に処理を実行するメソッド"],
    ["dom", "DOM", "HTML文書をJavaScriptから操作できるツリーとして表したもの"],
    ["event-bubbling", "イベントバブリング", "子要素で起きたイベントが祖先要素へ順に伝わる仕組み"],
    ["async-await", "async/await", "非同期処理を同期処理に近い形で記述する構文"],
    ["local-storage", "localStorage", "同一オリジンで文字列データをブラウザへ永続保存するAPI"],
    [
      "semantic-html",
      "セマンティックHTML",
      "内容の役割に合う要素を使って文書の意味を明確にする考え方",
    ],
    ["layout-shift", "Cumulative Layout Shift", "表示中に要素が予期せず移動する視覚的安定性の指標"],
    ["event-loop", "イベントループ", "タスクとマイクロタスクを順番に実行するJavaScriptの仕組み"],
    ["hydration", "ハイドレーション", "サーバー生成HTMLにクライアント側の対話処理を結び付ける処理"],
  ]],
  ["バックエンド", [
    ["server", "Webサーバー", "HTTPリクエストを受け取りレスポンスを返すソフトウェア"],
    ["env", "環境変数", "設定値や秘密情報を実行環境からアプリへ渡す仕組み"],
    ["json", "JSON", "オブジェクトや配列を文字列で表現するデータ形式"],
    ["status-code", "HTTPステータスコード", "リクエストの処理結果を3桁の数値で示すもの"],
    ["logging", "ログ", "動作状況やエラーを後から確認できるよう記録した情報"],
    ["validation", "入力バリデーション", "受け取った値が期待する形式や範囲か確認する処理"],
    ["exception", "例外処理", "実行中に起きた異常を捕捉して適切に扱う仕組み"],
    ["module", "モジュール", "関連する処理を再利用可能な単位へ分割したもの"],
    ["dependency", "依存関係", "あるコードが別のライブラリや機能を必要とする関係"],
    ["runtime", "ランタイム", "プログラムを実行するための環境"],
    ["middleware", "ミドルウェア", "リクエストと本処理の間で共通処理を行う仕組み"],
    ["connection-pool", "コネクションプール", "DB接続を再利用して接続コストを抑える仕組み"],
    ["idempotency", "冪等性", "同じ操作を複数回行っても結果が変わらない性質"],
    ["rate-limit", "レート制限", "一定時間内に受け付けるリクエスト数を制限する仕組み"],
    [
      "graceful-shutdown",
      "グレースフルシャットダウン",
      "処理中の要求を終えてから安全に停止する手順",
    ],
    ["backpressure", "バックプレッシャー", "処理能力を超える入力を上流へ伝えて流量を抑える仕組み"],
    ["saga", "Sagaパターン", "分散処理を複数の局所トランザクションと補償処理で管理する方法"],
    [
      "event-sourcing",
      "イベントソーシング",
      "状態の変更イベントを履歴として保存し現在状態を再構築する設計",
    ],
  ]],
  ["データベース", [
    ["table", "テーブル", "行と列で関連するデータを保存する構造"],
    ["primary-key", "主キー", "テーブル内の各行を一意に識別する列または列の組"],
    ["foreign-key", "外部キー", "別テーブルの行との参照整合性を保つ制約"],
    ["select", "SELECT", "データベースから条件に合う行を取得するSQL文"],
    ["insert", "INSERT", "テーブルへ新しい行を追加するSQL文"],
    ["update", "UPDATE", "既存行の値を変更するSQL文"],
    ["delete", "DELETE", "条件に合う行をテーブルから削除するSQL文"],
    ["where", "WHERE句", "操作対象の行を条件で絞り込むSQLの句"],
    ["order-by", "ORDER BY句", "取得結果を指定した列で並べ替えるSQLの句"],
    ["null", "NULL", "値が存在しない、または不明であることを表す特別な値"],
    ["index", "インデックス", "検索対象の行を素早く見つけるための補助データ構造"],
    ["transaction", "トランザクション", "複数のDB操作を一つの処理単位として扱う仕組み"],
    ["join", "JOIN", "関連する列を使って複数テーブルの行を組み合わせる操作"],
    ["normalization", "正規化", "重複や更新時の矛盾を減らすためテーブルを整理する設計"],
    ["unique", "UNIQUE制約", "指定した列の値の重複を禁止する制約"],
    ["mvcc", "MVCC", "複数バージョンの行を使って読み書きの競合を減らす方式"],
    [
      "isolation",
      "トランザクション分離レベル",
      "並行トランザクションが互いの変更を見られる範囲の設定",
    ],
    ["execution-plan", "実行計画", "DBがSQLをどの順序と方法で処理するかを示す計画"],
  ]],
  ["API", [
    ["api", "API", "ソフトウェア同士が機能やデータをやり取りするための接点"],
    ["request", "リクエスト", "クライアントからサーバーへ送る処理要求"],
    ["response", "レスポンス", "サーバーがリクエストに対して返す結果"],
    ["get", "GET", "主にリソースの取得に使うHTTPメソッド"],
    ["post", "POST", "主に新しいリソースの作成に使うHTTPメソッド"],
    ["put", "PUT", "主にリソース全体の作成または置換に使うHTTPメソッド"],
    ["delete-method", "DELETEメソッド", "主にリソースの削除に使うHTTPメソッド"],
    ["header", "HTTPヘッダー", "本文とは別にリクエストやレスポンスの付加情報を伝える領域"],
    ["content-type", "Content-Type", "送信する本文のメディアタイプを示すHTTPヘッダー"],
    ["endpoint", "エンドポイント", "APIが処理を受け付けるURLとメソッドの組み合わせ"],
    ["rest", "REST", "リソースを中心にHTTPの標準的な操作でAPIを設計する考え方"],
    ["pagination", "ページネーション", "大量の結果を複数ページに分けて取得する仕組み"],
    ["bearer", "Bearer認証", "Authorizationヘッダーでアクセストークンを送る認証方式"],
    ["cors", "CORS", "異なるオリジン間のブラウザ通信をサーバーが許可する仕組み"],
    ["webhook", "Webhook", "イベント発生時に指定先へHTTP通知を送る仕組み"],
    ["etag", "ETag", "リソースの版を識別して条件付きリクエストやキャッシュに使う値"],
    ["oauth", "OAuth 2.0", "パスワードを共有せず限定的なアクセス権を委譲する枠組み"],
    [
      "content-negotiation",
      "コンテントネゴシエーション",
      "要求ヘッダーに応じて返す表現形式を選ぶ仕組み",
    ],
  ]],
  ["インフラ", [
    ["server-machine", "サーバー", "ネットワーク経由で他のコンピューターへ機能を提供する環境"],
    ["dns", "DNS", "ドメイン名をIPアドレスなどへ変換する仕組み"],
    ["ip", "IPアドレス", "ネットワーク上の機器や接続先を識別する番号"],
    ["port", "ポート番号", "同じ機器上で通信先のサービスを識別する番号"],
    ["https", "HTTPS", "HTTP通信をTLSで暗号化したプロトコル"],
    ["deploy", "デプロイ", "アプリを利用できる実行環境へ配置する作業"],
    ["container", "コンテナ", "アプリと依存物を隔離された単位で実行する仕組み"],
    ["backup", "バックアップ", "障害や誤操作から復旧するためにデータの複製を保存すること"],
    ["monitoring", "監視", "システムの状態や異常を継続的に観測すること"],
    ["latency", "レイテンシ", "要求してから応答が得られるまでの遅延時間"],
    ["load-balancer", "ロードバランサー", "複数サーバーへリクエストを分散する仕組み"],
    ["autoscaling", "オートスケーリング", "負荷に応じて実行リソース数を自動で増減する仕組み"],
    ["cdn", "CDN", "地理的に分散した拠点からコンテンツを配信する仕組み"],
    ["health-check", "ヘルスチェック", "サービスが要求を処理できる状態か定期的に確認する仕組み"],
    ["iac", "Infrastructure as Code", "インフラ構成をコードで宣言し再現可能に管理する方法"],
    ["blue-green", "Blue-Greenデプロイ", "新旧2環境を切り替えて停止時間と切戻しリスクを減らす方式"],
    ["service-mesh", "サービスメッシュ", "サービス間通信を専用プロキシ層で制御・観測する仕組み"],
    ["eventual-consistency", "結果整合性", "一時的な差異を許し最終的に同じ状態へ収束する性質"],
  ]],
  ["セキュリティ", [
    ["password", "パスワード", "本人だけが知る文字列などを使って認証するための秘密情報"],
    ["authentication", "認証", "アクセスしている主体が誰かを確認する処理"],
    ["authorization", "認可", "認証済みの主体が操作を許されているか確認する処理"],
    ["encryption", "暗号化", "鍵を使って第三者が内容を読めない形に変換する処理"],
    ["hash", "ハッシュ化", "入力から固定長の値を一方向に計算する処理"],
    ["mfa", "多要素認証", "異なる種類の要素を二つ以上使って本人確認する方式"],
    ["least-privilege", "最小権限の原則", "必要最小限の権限だけを付与する考え方"],
    ["secret", "シークレット", "APIキーなど公開せず安全に管理すべき機密情報"],
    ["update", "セキュリティ更新", "既知の脆弱性を修正するためソフトウェアを更新すること"],
    ["logout", "ログアウト", "認証済みセッションを終了して利用できなくする操作"],
    ["xss", "XSS", "不正なスクリプトをWebページ上で実行させる攻撃"],
    ["csrf", "CSRF", "ログイン中の利用者に意図しないリクエストを送らせる攻撃"],
    ["sql-injection", "SQLインジェクション", "入力を通じて意図しないSQLを実行させる攻撃"],
    ["csp", "Content Security Policy", "読み込めるスクリプト等を制限して注入攻撃を軽減する仕組み"],
    ["session-cookie", "Secure属性付きCookie", "HTTPS通信時だけCookieを送るよう制限する設定"],
    ["threat-model", "脅威モデリング", "守る対象・攻撃者・攻撃経路を整理して対策を設計する活動"],
    ["forward-secrecy", "前方秘匿性", "長期鍵の漏えい後も過去の通信内容を復号されにくくする性質"],
    ["zero-trust", "ゼロトラスト", "接続元を暗黙に信頼せず継続的に検証する考え方"],
  ]],
];

function difficultyAt(index: number): 1 | 2 | 3 {
  if (index < 10) return 1;
  if (index < 15) return 2;
  return 3;
}

export const QUIZ_QUESTION_BANK: readonly Readonly<QuizQuestionSeed>[] = Object.freeze(
  CATEGORY_CONCEPTS.flatMap(([category, concepts], categoryIndex) =>
    concepts.map(([id, term, definition], index) => {
      const difficulty = difficultyAt(index);
      const choices = [0, 1, 2, 3].map((offset) => concepts[(index + offset) % concepts.length][2]);
      return Object.freeze({
        id: `bank-${categoryIndex + 1}-${id}`,
        category,
        difficulty,
        weight: difficulty,
        answerTimeSeconds: 15,
        instruction: "用語の意味を確認します。最も適切な説明を1つ選んでください。",
        question: `「${term}」の説明として最も適切なものはどれですか？`,
        choices: Object.freeze(choices),
        answer: 0,
        explanation: `${term}は、${definition}です。`,
      });
    })
  ),
);

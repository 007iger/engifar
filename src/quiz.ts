import { ApiError } from "./errors.ts";

const DEFAULT_ANSWER_TIME_SECONDS = 10;
const DEFAULT_REVIEW_TIME_SECONDS = 5;
const TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface RawQuizQuestion {
  category: string;
  weight: number;
  instruction: string;
  question: string;
  choices: readonly string[];
  answer: number;
  explanation: string;
}

export interface PublicQuizQuestion {
  index: number;
  category: string;
  weight: number;
  instruction: string;
  question: string;
  choices: readonly string[];
}

export interface QuizConfig {
  questionCount: number;
  answerTimeSeconds: number;
  reviewTimeSeconds: number;
}

export interface QuizQuestionStart {
  question: PublicQuizQuestion;
  questionToken: string;
  answerTimeSeconds: number;
}

export interface QuizGradeResult {
  correct: boolean;
  correctOption: number;
  explanation: string;
  category: string;
  weight: number;
  nextProgressToken: string | null;
}

interface TokenPayload {
  type: "progress" | "question";
  attemptId: string;
  questionIndex: number;
  expiresAt: number;
  revealAt?: number;
}

export interface QuizServiceOptions {
  secret?: string;
  now?: () => number;
  answerTimeSeconds?: number;
  reviewTimeSeconds?: number;
}

const rawQuestions: readonly RawQuizQuestion[] = [
  {
    category: "フロントエンド",
    weight: 1,
    instruction:
      "「EngiFar」をページで最も重要な見出しとして表示します。空欄に入るHTMLタグ名を選んでください。",
    question: "<＿＿＿>EngiFar</＿＿＿>",
    choices: ["h1", "p", "span", "div"],
    answer: 0,
    explanation: "h1は、ページの中心となる見出しを表すHTMLタグです。",
  },
  {
    category: "フロントエンド",
    weight: 1,
    instruction:
      "「プロフィール」から /profile ページへ移動できるリンクを作ります。URLを指定する属性を選んでください。",
    question: '<a ＿＿＿="/profile">プロフィール</a>',
    choices: ["href", "src", "action", "to"],
    answer: 0,
    explanation: "aタグのhref属性に移動先のURLを指定します。",
  },
  {
    category: "フロントエンド",
    weight: 1,
    instruction:
      "タイトルの文字色を緑色にします。CSSで文字色を指定するプロパティを選んでください。",
    question: ".title {\n  ＿＿＿: #c9f765;\n}",
    choices: ["color", "background-color", "font-color", "text-color"],
    answer: 0,
    explanation: "colorプロパティは文字の色を指定します。",
  },
  {
    category: "フロントエンド",
    weight: 1.2,
    instruction:
      "ボタンをクリックしたときにstart関数が動くようにします。空欄に入るイベント名を選んでください。",
    question: 'button.addEventListener("＿＿＿", start);',
    choices: ["click", "press", "tap", "onClick"],
    answer: 0,
    explanation: "clickイベントは、ボタンなどがクリックされたときに発生します。",
  },
  {
    category: "バックエンド",
    weight: 1,
    instruction:
      "DenoでWebサーバーを起動して「Hello」と返します。サーバーを開始するメソッド名を選んでください。",
    question: 'Deno.＿＿＿(() => new Response("Hello"));',
    choices: ["serve", "start", "listenWeb", "runServer"],
    answer: 0,
    explanation: "Deno.serve()を使うと、HTTPリクエストを受け取るサーバーを起動できます。",
  },
  {
    category: "バックエンド",
    weight: 1,
    instruction:
      "非同期のfetchUser関数が完了するまで待ち、結果をuserへ入れます。空欄に入るキーワードを選んでください。",
    question: "const user = ＿＿＿ fetchUser();",
    choices: ["await", "wait", "async", "then"],
    answer: 0,
    explanation: "awaitはPromiseの完了を待って、その結果を受け取ります。",
  },
  {
    category: "バックエンド",
    weight: 1.1,
    instruction:
      "JavaScriptのオブジェクトをAPIで送れるJSON文字列へ変換します。使うメソッド名を選んでください。",
    question: "const body = JSON.＿＿＿({ ok: true });",
    choices: ["stringify", "parse", "encode", "toJSON"],
    answer: 0,
    explanation: "JSON.stringify()は、オブジェクトをJSON形式の文字列へ変換します。",
  },
  {
    category: "バックエンド",
    weight: 1.2,
    instruction:
      "config.txtの内容を文字列として読み込みます。Denoのファイル読み込みメソッドを選んでください。",
    question: 'const text = await Deno.＿＿＿("config.txt");',
    choices: ["readTextFile", "readFileText", "openText", "load"],
    answer: 0,
    explanation: "Deno.readTextFile()は、ファイルの内容を文字列として読み取ります。",
  },
  {
    category: "データベース",
    weight: 1,
    instruction: "usersテーブルにあるすべての列を取得します。空欄に入るSQLの命令を選んでください。",
    question: "＿＿＿ * FROM users;",
    choices: ["SELECT", "GET", "READ", "FIND"],
    answer: 0,
    explanation: "SELECTは、データベースからデータを取得するSQLの命令です。",
  },
  {
    category: "データベース",
    weight: 1,
    instruction:
      "usersテーブルからidが3の行だけを取得します。条件を指定するキーワードを選んでください。",
    question: "SELECT * FROM users\n＿＿＿ id = 3;",
    choices: ["WHERE", "WHEN", "IF", "FILTER"],
    answer: 0,
    explanation: "WHEREを使うと、取得する行の条件を指定できます。",
  },
  {
    category: "データベース",
    weight: 1.1,
    instruction:
      "usersテーブルへ名前がAoiのデータを1件追加します。空欄に入るSQLの命令を選んでください。",
    question: '＿＿＿ INTO users (name)\nVALUES ("Aoi");',
    choices: ["INSERT", "ADD", "CREATE", "PUSH"],
    answer: 0,
    explanation: "INSERT INTOは、テーブルへ新しい行を追加するSQLの命令です。",
  },
  {
    category: "データベース",
    weight: 1.2,
    instruction:
      "ordersテーブルをuser_idごとにまとめ、ユーザー別の注文数を数えます。空欄を選んでください。",
    question: "SELECT user_id, COUNT(*)\nFROM orders\n＿＿＿ user_id;",
    choices: ["GROUP BY", "ORDER BY", "COLLECT BY", "PARTITION WITH"],
    answer: 0,
    explanation: "GROUP BYは、同じuser_idの行をグループにまとめて集計します。",
  },
  {
    category: "API",
    weight: 1,
    instruction: "APIからユーザー一覧を取得します。データ取得に使うHTTPメソッドを選んでください。",
    question: 'fetch("/api/users", {\n  method: "＿＿＿"\n});',
    choices: ["GET", "POST", "PUT", "DELETE"],
    answer: 0,
    explanation: "GETは、サーバーからデータを取得するときに使うHTTPメソッドです。",
  },
  {
    category: "API",
    weight: 1,
    instruction:
      "APIへ新しいユーザー情報を送って登録します。新規作成に使うHTTPメソッドを選んでください。",
    question: 'fetch("/api/users", {\n  method: "＿＿＿",\n  body: JSON.stringify(user)\n});',
    choices: ["POST", "GET", "HEAD", "TRACE"],
    answer: 0,
    explanation: "POSTは、サーバーへデータを送り、新しいデータを作るときに使います。",
  },
  {
    category: "API",
    weight: 1,
    instruction: "APIの処理が正常に完了したことを表す、基本的なHTTPステータスを選んでください。",
    question: "HTTP/1.1 ＿＿＿ OK",
    choices: ["200", "404", "500", "301"],
    answer: 0,
    explanation: "200 OKは、リクエストが正常に処理されたことを表します。",
  },
  {
    category: "API",
    weight: 1.2,
    instruction:
      "fetchで受け取ったレスポンス本文をJSONとして読み取ります。空欄に入るメソッド名を選んでください。",
    question: 'const response = await fetch("/api/users");\nconst data = await response.＿＿＿();',
    choices: ["json", "parseJSON", "toObject", "bodyJSON"],
    answer: 0,
    explanation: "Responseのjson()は、レスポンス本文をJSONとして読み取ります。",
  },
  {
    category: "インフラ",
    weight: 1,
    instruction: "Gitで現在の変更状況を確認します。空欄に入るコマンドを選んでください。",
    question: "git ＿＿＿",
    choices: ["status", "check", "state", "show-all"],
    answer: 0,
    explanation: "git statusは、変更されたファイルや現在のブランチ状態を表示します。",
  },
  {
    category: "インフラ",
    weight: 1,
    instruction:
      "package.jsonに書かれた依存パッケージをインストールします。空欄に入るnpmコマンドを選んでください。",
    question: "npm ＿＿＿",
    choices: ["install", "download", "setup", "packages"],
    answer: 0,
    explanation: "npm installは、package.jsonを読み、必要なパッケージをインストールします。",
  },
  {
    category: "インフラ",
    weight: 1.1,
    instruction: "package.jsonのscriptsに登録されたdevコマンドを実行します。空欄を選んでください。",
    question: "npm run ＿＿＿",
    choices: ["dev", "install", "package", "node"],
    answer: 0,
    explanation: "npm run devは、scriptsに登録されたdevコマンドを実行します。",
  },
  {
    category: "インフラ",
    weight: 1.2,
    instruction:
      "Docker Composeのコンテナをバックグラウンドで起動します。空欄に入るオプションを選んでください。",
    question: "docker compose up ＿＿＿",
    choices: ["-d", "-b", "--hide", "--later"],
    answer: 0,
    explanation: "-dを付けると、コンテナをバックグラウンドで起動できます。",
  },
  {
    category: "セキュリティ",
    weight: 1,
    instruction:
      "入力したパスワードの文字が画面上で隠れて表示される入力欄を作ります。typeの値を選んでください。",
    question: '<input type="＿＿＿" name="password">',
    choices: ["password", "secret", "hidden-text", "secure"],
    answer: 0,
    explanation: 'type="password"にすると、入力文字が伏せて表示されます。',
  },
  {
    category: "セキュリティ",
    weight: 1,
    instruction:
      "ユーザー入力をHTMLとして解釈せず、文字列のまま画面へ表示します。使うプロパティを選んでください。",
    question: "message.＿＿＿ = userInput;",
    choices: ["textContent", "innerHTML", "outerHTML", "htmlValue"],
    answer: 0,
    explanation: "textContentは内容を文字列として扱い、安心できる画面表示につながります。",
  },
  {
    category: "セキュリティ",
    weight: 1.1,
    instruction:
      "保存前のパスワードからbcryptのハッシュ値を作ります。空欄に入るメソッド名を選んでください。",
    question: "const hash = await bcrypt.＿＿＿(password, 10);",
    choices: ["hash", "encrypt", "protect", "secure"],
    answer: 0,
    explanation: "bcrypt.hash()は、パスワードから保存用のハッシュ値を生成します。",
  },
  {
    category: "セキュリティ",
    weight: 1.2,
    instruction:
      "userIdをSQL文字列へ直接つなげず、パラメータとして渡します。空欄に入るプレースホルダーを選んでください。",
    question:
      'const result = await db.query(\n  "SELECT * FROM users WHERE id = ＿＿＿",\n  [userId]\n);',
    choices: ["$1", "userId", "input", "raw"],
    answer: 0,
    explanation: "$1と値の配列を使うと、入力値をパラメータとして安全に渡せます。",
  },
];

const questions = rawQuestions.map((item, index) => {
  const shift = index % item.choices.length;
  return Object.freeze({
    ...item,
    choices: Object.freeze(item.choices.slice(shift).concat(item.choices.slice(0, shift))),
    answer: (item.answer - shift + item.choices.length) % item.choices.length,
  });
});

function questionAt(index: number): Readonly<RawQuizQuestion> {
  const question = questions[index];
  if (!question) {
    throw new ApiError(404, "QUIZ_QUESTION_NOT_FOUND", "Quiz question not found");
  }
  return question;
}

function publicQuestion(index: number): PublicQuizQuestion {
  const { category, weight, instruction, question, choices } = questionAt(index);
  return { index, category, weight, instruction, question, choices };
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function randomSecret(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function isTokenPayload(value: unknown): value is TokenPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (payload.type === "progress" || payload.type === "question") &&
    typeof payload.attemptId === "string" &&
    Number.isSafeInteger(payload.questionIndex) &&
    typeof payload.questionIndex === "number" &&
    typeof payload.expiresAt === "number" &&
    Number.isFinite(payload.expiresAt) &&
    (payload.revealAt === undefined ||
      (typeof payload.revealAt === "number" && Number.isFinite(payload.revealAt)));
}

export class QuizService {
  readonly config: Readonly<QuizConfig>;
  #key: Promise<CryptoKey>;
  #now: () => number;

  constructor(options: QuizServiceOptions = {}) {
    const secret = options.secret ?? randomSecret();
    if (encoder.encode(secret).byteLength < 32) {
      throw new Error("Quiz token secret must contain at least 32 bytes");
    }
    this.#key = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    this.#now = options.now ?? Date.now;
    this.config = Object.freeze({
      questionCount: questions.length,
      answerTimeSeconds: options.answerTimeSeconds ?? DEFAULT_ANSWER_TIME_SECONDS,
      reviewTimeSeconds: options.reviewTimeSeconds ?? DEFAULT_REVIEW_TIME_SECONDS,
    });
  }

  async createAttempt(): Promise<{ progressToken: string }> {
    const now = this.#now();
    return {
      progressToken: await this.#sign({
        type: "progress",
        attemptId: crypto.randomUUID(),
        questionIndex: 0,
        expiresAt: now + TOKEN_LIFETIME_MS,
      }),
    };
  }

  async startQuestion(index: number, progressToken: string): Promise<QuizQuestionStart> {
    questionAt(index);
    const progress = await this.#verify(progressToken, "progress");
    if (progress.questionIndex !== index) {
      throw new ApiError(
        409,
        "QUIZ_SEQUENCE_MISMATCH",
        "Quiz questions must be answered in order",
      );
    }

    const now = this.#now();
    return {
      question: publicQuestion(index),
      questionToken: await this.#sign({
        type: "question",
        attemptId: progress.attemptId,
        questionIndex: index,
        revealAt: now + this.config.answerTimeSeconds * 1000,
        expiresAt: progress.expiresAt,
      }),
      answerTimeSeconds: this.config.answerTimeSeconds,
    };
  }

  async gradeQuestion(
    index: number,
    questionToken: string,
    selectedOption: number | null,
  ): Promise<QuizGradeResult> {
    const token = await this.#verify(questionToken, "question");
    if (token.questionIndex !== index) {
      throw new ApiError(409, "QUIZ_TOKEN_MISMATCH", "Quiz token does not match the question");
    }
    if (token.revealAt === undefined || this.#now() < token.revealAt) {
      throw new ApiError(
        409,
        "QUIZ_REVIEW_NOT_READY",
        "The correct answer is not available until the answer time ends",
      );
    }

    const question = questionAt(index);
    const nextIndex = index + 1;
    const nextProgressToken = nextIndex < questions.length
      ? await this.#sign({
        type: "progress",
        attemptId: token.attemptId,
        questionIndex: nextIndex,
        expiresAt: token.expiresAt,
      })
      : null;

    return {
      correct: selectedOption === question.answer,
      correctOption: question.answer,
      explanation: question.explanation,
      category: question.category,
      weight: question.weight,
      nextProgressToken,
    };
  }

  async #sign(payload: TokenPayload): Promise<string> {
    const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
    const signature = await crypto.subtle.sign(
      "HMAC",
      await this.#key,
      encoder.encode(encodedPayload),
    );
    return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
  }

  async #verify(token: string, expectedType: TokenPayload["type"]): Promise<TokenPayload> {
    try {
      const [encodedPayload, encodedSignature, extra] = token.split(".");
      if (!encodedPayload || !encodedSignature || extra !== undefined) throw new Error("format");
      const valid = await crypto.subtle.verify(
        "HMAC",
        await this.#key,
        decodeBase64Url(encodedSignature),
        encoder.encode(encodedPayload),
      );
      if (!valid) throw new Error("signature");

      const payload: unknown = JSON.parse(decoder.decode(decodeBase64Url(encodedPayload)));
      if (!isTokenPayload(payload) || payload.type !== expectedType) throw new Error("payload");
      if (this.#now() > payload.expiresAt) {
        throw new ApiError(401, "QUIZ_TOKEN_EXPIRED", "Quiz token has expired");
      }
      return payload;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(401, "INVALID_QUIZ_TOKEN", "Quiz token is invalid");
    }
  }
}

export function createQuizService(options: QuizServiceOptions = {}): QuizService {
  return new QuizService(options);
}

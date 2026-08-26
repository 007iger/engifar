const TOKEN_PATTERN =
  /(＿＿＿|＿{3,}|_{3,})|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\/\*[\s\S]*?\*\/|\/\/[^\n]*|--[^\n]*|#[ \t]+[^\n]*)|(\b\d+(?:\.\d+)?\b)|(@?[A-Za-z_$][\w$-]*)|([{}\[\]();,.=:<>+\-*\/!])/g;
const BLANK_SPLIT_PATTERN = /(＿＿＿|＿{3,}|_{3,})/;
const BLANK_ONLY_PATTERN = /^(?:＿＿＿|＿{3,}|_{3,})$/;

const KEYWORDS = new Set([
  "async",
  "await",
  "begin",
  "catch",
  "commit",
  "const",
  "copy",
  "create",
  "delete",
  "desc",
  "docker",
  "else",
  "finally",
  "for",
  "from",
  "function",
  "headers",
  "if",
  "in",
  "inner",
  "insert",
  "join",
  "key",
  "let",
  "limit",
  "location",
  "new",
  "not",
  "null",
  "on",
  "order",
  "primary",
  "return",
  "run",
  "select",
  "set",
  "table",
  "throw",
  "true",
  "try",
  "update",
  "var",
  "where",
]);

function identifierType(identifier, source, start, end) {
  const normalized = identifier.toLowerCase();
  if (identifier.startsWith("@") || KEYWORDS.has(normalized)) return "keyword";
  if (/^\s*\(/.test(source.slice(end))) return "function";
  if (/^\s*:/.test(source.slice(end))) return "property";
  if (/^[A-Z]/.test(identifier)) return "type";

  const lineBefore = source.slice(0, start).split("\n").at(-1) || "";
  if (lineBefore.includes("<") && !lineBefore.includes(">") && /^\s*=/.test(source.slice(end))) {
    return "property";
  }
  return "identifier";
}

function appendToken(tokens, text, type) {
  text.split(BLANK_SPLIT_PATTERN).forEach((part) => {
    if (!part) return;
    tokens.push({ text: part, type: BLANK_ONLY_PATTERN.test(part) ? "blank" : type });
  });
}

export function tokenizeQuizCode(value) {
  const source = String(value ?? "");
  const tokens = [];
  let cursor = 0;

  for (const match of source.matchAll(TOKEN_PATTERN)) {
    const start = match.index;
    if (start > cursor) tokens.push({ text: source.slice(cursor, start), type: null });

    let type = "punctuation";
    if (match[1]) type = "blank";
    else if (match[2]) type = "string";
    else if (match[3]) type = "comment";
    else if (match[4]) type = "number";
    else if (match[5]) {
      type = identifierType(match[5], source, start, start + match[0].length);
    }

    appendToken(tokens, match[0], type);
    cursor = start + match[0].length;
  }

  if (cursor < source.length) tokens.push({ text: source.slice(cursor), type: null });
  return tokens;
}

export function renderHighlightedQuizCode(element, source) {
  if (!element) return false;

  const fragment = document.createDocumentFragment();
  tokenizeQuizCode(source).forEach((token) => {
    if (!token.type) {
      fragment.append(document.createTextNode(token.text));
      return;
    }

    const span = document.createElement("span");
    span.className = `quiz-syntax-token quiz-syntax-token--${token.type}`;
    span.textContent = token.text;
    if (token.type === "blank") {
      span.setAttribute("aria-label", "空欄");
      span.title = "空欄";
    }
    fragment.append(span);
  });
  element.replaceChildren(fragment);
  return true;
}

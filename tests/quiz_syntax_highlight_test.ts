import assert from "node:assert/strict";
import questions from "../data/quiz_questions.json" with { type: "json" };
import { tokenizeQuizCode } from "../public/quiz-syntax-highlight.js";

Deno.test("quiz syntax highlighting preserves source and emphasizes every blank", () => {
  for (const question of questions) {
    const tokens = tokenizeQuizCode(question.question);
    assert.equal(tokens.map((token) => token.text).join(""), question.question);
    assert.equal(
      tokens.filter((token) => token.type === "blank").length,
      1,
      `${question.id} must expose exactly one highlighted blank`,
    );
  }
});

Deno.test("quiz syntax highlighting distinguishes important code elements", () => {
  const tokens = tokenizeQuizCode(
    'const response = await fetch("/api/users", { status: ＿＿＿, retry: 3 });',
  );
  const typeFor = (text: string) => tokens.find((token) => token.text === text)?.type;

  assert.equal(typeFor("const"), "keyword");
  assert.equal(typeFor("await"), "keyword");
  assert.equal(typeFor("fetch"), "function");
  assert.equal(typeFor('"/api/users"'), "string");
  assert.equal(typeFor("status"), "property");
  assert.equal(typeFor("＿＿＿"), "blank");
  assert.equal(typeFor("3"), "number");
});

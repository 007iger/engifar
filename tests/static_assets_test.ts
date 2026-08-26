import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import type { GameRepository } from "../src/types.ts";

const ORIGIN = new URL("http://localhost/");
const app = createApp({} as GameRepository);
const CONFLICT_MARKER = /^(?:<{7}|={7}|>{7})(?: .*)?\r?$/m;

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];

  for await (const entry of Deno.readDir(directory)) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory) files.push(...await walk(path));
    else if (entry.isFile) files.push(path);
  }

  return files;
}

async function responseFor(path: string | URL): Promise<Response> {
  const url = path instanceof URL ? path : new URL(path, ORIGIN);
  return await app(new Request(url));
}

Deno.test("public files contain no unresolved merge conflicts", async () => {
  const textFiles = (await walk("public")).filter((path) => /\.(?:html|css|m?js)$/.test(path));

  for (const path of textFiles) {
    const source = await Deno.readTextFile(path);
    assert.equal(
      CONFLICT_MARKER.test(source),
      false,
      `${path} contains an unresolved merge conflict`,
    );
  }

  const response = await responseFor("/index.html");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /\bid="app"/);
  assert.match(html, /\bid="start-button"/);
  assert.doesNotMatch(html, /\bid="welcomeMessage"/);
});

Deno.test("public JavaScript does not bundle quiz questions or answers", async () => {
  const source = await Deno.readTextFile("public/script.js");
  assert.doesNotMatch(source, /rawQuestions|questionBank/);
  assert.doesNotMatch(source, /<＿＿＿>EngiFar|h1は、ページの中心/);
});

Deno.test("room controls call the shared room and session APIs", async () => {
  const source = await Deno.readTextFile("public/script.js");

  assert.match(source, /["']\/api\/rooms["']/);
  assert.match(source, /\/participants`/);
  assert.match(source, /\/sessions`/);
  assert.match(source, /\/answers\/\$\{index\}`/);
  assert.match(source, /new WebSocket\(url, \["engifar-v1", auth\.accessToken\]\)/);
  assert.match(source, /\/results`/);
  assert.match(source, /engifar-room-auth-v1/);
  assert.doesNotMatch(source, /searchParams\.set\("token"/);
});

Deno.test("quiz progress stays out of URLs and completed quizzes replace browser history", async () => {
  const source = await Deno.readTextFile("public/script.js");

  assert.doesNotMatch(source, /location\.hash|#mission=|URLSearchParams/);
  assert.match(source, /event\.persisted/);
  assert.match(source, /goTo\("\.\/rocket\.html", state, true\)/);
  assert.match(source, /state\.status !== "quiz"/);
});

Deno.test("static pages include baseline browser security headers", async () => {
  const response = await responseFor("/index.html");

  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
});

Deno.test("all local HTML references are served successfully", async () => {
  const htmlFiles = (await walk("public")).filter((path) => path.endsWith(".html"));

  for (const file of htmlFiles) {
    const route = `/${file.slice("public/".length).replaceAll("\\", "/")}`;
    const pageUrl = new URL(route, ORIGIN);
    const pageResponse = await responseFor(pageUrl);

    assert.equal(pageResponse.status, 200, `${route} was not served`);
    const html = await pageResponse.text();

    for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
      const reference = match[1];
      if (reference.startsWith("#")) continue;

      const referenceUrl = new URL(reference, pageUrl);
      if (referenceUrl.origin !== ORIGIN.origin) continue;

      const response = await responseFor(referenceUrl);
      assert.equal(
        response.status,
        200,
        `${route} references missing ${referenceUrl.pathname}`,
      );
      await response.body?.cancel();
    }
  }
});

Deno.test("tutorial assets are available from the public assets route", async () => {
  const names = ["home-mobile", "home", "room", "quiz", "rocket", "result", "card"];

  for (const name of names) {
    const route = `/assets/tutorial/${name}.png`;
    const response = await responseFor(route);

    assert.equal(response.status, 200, `${route} was not served`);
    assert.match(response.headers.get("content-type") ?? "", /^image\/png\b/);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
});

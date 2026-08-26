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
  assert.match(source, /goTo\("\.\/quiz-ready\.html", next\)/);
  assert.match(source, /goTo\("\.\/rocket-build\.html", state, true\)/);
  assert.match(source, /goTo\("\.\/rocket\.html", state, true\)/);
  assert.match(source, /state\.status !== "quiz"/);
});

Deno.test("ported PR visuals use real room data and server-backed private results", async () => {
  const source = await Deno.readTextFile("public/script.js");
  const avatarSource = await Deno.readTextFile("public/crew-avatars.js");
  const resultHtml = await Deno.readTextFile("public/result.html");

  assert.match(source, /renderRoomAvatarField\(avatarField, fieldParticipants\)/);
  assert.match(source, /\/results\/publication`/);
  assert.match(source, /if \(!document\.hidden\) void refreshRoom\(\)/);
  assert.match(source, /if \(!document\.hidden\) void syncSession\(\)/);
  assert.match(source, /HIDDEN_SOCKET_DISCONNECT_MS = 60_000/);
  assert.match(source, /document\.addEventListener\("visibilitychange"/);
  assert.match(source, /socket\?\.close\(1000, "hidden-timeout"\)/);
  assert.match(source, /全員共通の開始時刻を待っています/);
  assert.match(source, /answer\.allParticipantsAnswered/);
  assert.match(source, /\/quiz\/questions\/\$\{index\}\/grade/);
  assert.match(source, /ACTIVE_QUIZ_SYNC_INTERVAL_MS = 1_000/);
  assert.match(source, /syncRequested = true;\s+if \(syncing\) return;/);
  assert.match(source, /while \(syncRequested && !finished\)/);
  assert.match(source, /}, ACTIVE_QUIZ_SYNC_INTERVAL_MS\);/);
  assert.doesNotMatch(source, /syncTimer = globalThis\.setInterval\([\s\S]{0,200}, 15_000\);/);
  assert.doesNotMatch(source, /engifar-leaderboard|RESULT_DATA|localStorage/);
  assert.match(avatarSource, /participant\.name/);
  assert.doesNotMatch(avatarSource, /クルーA|クルーB|クルーC|クルーD/);
  assert.match(resultHtml, /id="result-publish-button"/);
  assert.match(resultHtml, /id="team-result-radar"/);
});

Deno.test("profile cards overlay the complete team radar with a dotted legend", async () => {
  const source = await Deno.readTextFile("public/script.js");

  assert.match(source, /const team = authoritativeResults\?\.team/);
  assert.match(source, /Object\.hasOwn\(team\.categoryScores, entry\.label\)/);
  assert.match(source, /context\.setLineDash\(\[6, 8\]\)/);
  assert.match(source, /context\.fillText\("TEAM AVG"/);
  assert.match(source, /drawCanvasRadar\([^;]+teamEntries\);/s);
});

Deno.test("multiplayer flight results use the shared team metrics", async () => {
  const source = await Deno.readTextFile("public/script.js");

  assert.match(source, /state\.metrics = metricsFromResult\(results\.personal\)/);
  assert.match(source, /state\.teamMetrics = metricsFromResult\(results\.team\)/);
  assert.match(source, /calculateOutcome\(state\.teamMetrics \|\| state\.metrics\)/);
  assert.match(source, /resultCopy\(state\.outcome, state\.teamMetrics \|\| state\.metrics\)/);
});

Deno.test("result views are split and code questions preserve readable indentation", async () => {
  const source = await Deno.readTextFile("public/script.js");
  const style = await Deno.readTextFile("public/style.css");
  const resultHtml = await Deno.readTextFile("public/result.html");

  assert.match(resultHtml, /id="result-view-tabs"[^>]+role="tablist"/);
  assert.match(resultHtml, /data-result-view="flight"/);
  assert.match(resultHtml, /data-result-view="team"/);
  assert.match(resultHtml, /id="result-flight-pane"[^>]+role="tabpanel"/);
  assert.match(resultHtml, /id="crew-results"[^>]+role="tabpanel"/);
  assert.match(source, /function activateResultView\(view, moveFocus = false\)/);
  assert.match(source, /flightPane\.hidden = showTeam;/);
  assert.match(source, /crewResults\.hidden = !showTeam;/);
  assert.match(
    style,
    /\.question-copy pre\s*\{[\s\S]*?text-align: left;[\s\S]*?white-space: pre-wrap;[\s\S]*?tab-size: 2;/,
  );

  for (const page of ["index", "room", "quiz", "rocket", "result", "card"]) {
    const html = await Deno.readTextFile(`public/${page}.html`);
    assert.match(html, /script\.js\?v=20260826-flight-score/);
  }
  for (const page of ["index", "room", "quiz", "result", "card"]) {
    const html = await Deno.readTextFile(`public/${page}.html`);
    assert.match(html, /style\.css\?v=20260826-flight-score/);
  }
});

Deno.test("quiz crew reacts to waiting and answer results without taking layout space", async () => {
  const source = await Deno.readTextFile("public/script.js");
  const reactionSource = await Deno.readTextFile("public/quiz-crew-reaction.js");
  const reactionStyle = await Deno.readTextFile("public/quiz-crew-reaction.css");
  const quizHtml = await Deno.readTextFile("public/quiz.html");

  assert.match(quizHtml, /id="quiz-crew-reaction"/);
  assert.match(quizHtml, /quiz-crew-reaction\.css\?v=20260826-flight-score/);
  assert.match(source, /createQuizCrewReaction/);
  assert.match(source, /crewReaction\.setState\("waiting"\)/);
  assert.match(source, /crewReaction\.setState\(result\.correct \? "correct" : "incorrect"\)/);
  assert.match(source, /crewReaction\.setState\(isCorrect \? "correct" : "incorrect"\)/);
  assert.match(reactionSource, /svg\.removeAttribute\("data-state"\)/);
  assert.match(reactionStyle, /\.quiz-crew-reaction\s*\{[\s\S]*?position: absolute;/);
  assert.match(reactionStyle, /\.quiz-crew\[data-state="correct"\]/);
  assert.match(reactionStyle, /\.quiz-crew\[data-state="incorrect"\]/);
  assert.match(reactionStyle, /@media \(prefers-reduced-motion: reduce\)/);
});

Deno.test("quiz code highlights syntax and strongly marks the blank", async () => {
  const source = await Deno.readTextFile("public/script.js");
  const highlighter = await Deno.readTextFile("public/quiz-syntax-highlight.js");
  const style = await Deno.readTextFile("public/style.css");

  assert.match(source, /renderHighlightedQuizCode\(elements\.question, question\.question\)/);
  assert.match(highlighter, /document\.createTextNode\(token\.text\)/);
  assert.doesNotMatch(highlighter, /innerHTML/);
  assert.match(highlighter, /span\.setAttribute\("aria-label", "空欄"\)/);
  assert.match(
    style,
    /\.quiz-syntax-token--blank\s*\{[\s\S]*?border-bottom: 2px solid var\(--lime\);[\s\S]*?box-shadow:/,
  );
});

Deno.test("flight score and astronomical distance are displayed as separate values", async () => {
  const rules = await Deno.readTextFile("public/game-rules.js");
  const source = await Deno.readTextFile("public/script.js");
  const resultHtml = await Deno.readTextFile("public/result.html");

  assert.match(rules, /POWER_SCORE_WEIGHT = 0\.65/);
  assert.match(rules, /SAFETY_SCORE_WEIGHT = 0\.35/);
  assert.match(rules, /distanceKm: 384_400/);
  assert.match(rules, /distanceKm: 54_600_000/);
  assert.match(rules, /distanceKm: 2_500_000_000/);
  assert.match(rules, /distanceKm: 4_300_000_000/);
  assert.match(source, /formatFlightDistance\(rank\.distanceKm\)/);
  assert.match(source, /flightProgressText\(state\.outcome\)/);
  assert.doesNotMatch(source, /outcome\.altitude \* 1000/);
  assert.match(resultHtml, /id="result-flight-score"/);
  assert.match(resultHtml, /id="result-rank-progress"/);
  assert.match(resultHtml, /id="result-distance-unit"/);
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

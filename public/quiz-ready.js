const STORAGE_KEY = "engifar-mission-v4";
const AUTH_KEY = "engifar-room-auth-v1";

function canEnterQuiz() {
  try {
    const state = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    const auth = JSON.parse(sessionStorage.getItem(AUTH_KEY) || "null");
    return Boolean(
      state && state.playerConfigured && state.status === "quiz" && state.room?.sessionId &&
        auth && auth.roomCode === state.room.code && typeof auth.accessToken === "string",
    );
  } catch {
    return false;
  }
}

function proceed() {
  globalThis.location.replace("./quiz.html");
}

if (!canEnterQuiz()) {
  globalThis.location.replace("./index.html");
} else {
  const reducedMotion = globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
  globalThis.setTimeout(proceed, reducedMotion ? 50 : 550);
}

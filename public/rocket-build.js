const STORAGE_KEY = "engifar-mission-v4";
const destination = "./rocket.html";

function hasValidMissionState() {
  try {
    const state = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    return Boolean(
      state && state.playerConfigured && state.status === "rocket" && state.metrics &&
        Number.isFinite(Number(state.metrics.power)),
    );
  } catch {
    return false;
  }
}

function proceed() {
  globalThis.location.replace(destination);
}

if (!hasValidMissionState()) {
  globalThis.location.replace("./index.html");
} else {
  document.querySelector("#build-skip")?.addEventListener("click", proceed);
  const reducedMotion = globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
  globalThis.setTimeout(() => {
    const status = document.querySelector("#build-status");
    if (status) status.textContent = "ロケット完成！発射台へ移動します";
    document.body.dataset.complete = "true";
    globalThis.setTimeout(proceed, reducedMotion ? 100 : 650);
  }, reducedMotion ? 150 : 2_200);
}

const MOTOR_IGNITION_SRC = "./assets/music/motor-ignition.mp3";
const ROCKET_LAUNCH_SRC = "./assets/music/rocket-launch.mp3";
const MOTOR_FADE_OUT_MS = 180;
const FADE_STEPS = 9;

export function createRocketSfx() {
  let motor = null;
  let launch = null;
  let fadeTimer = null;

  function play(audio) {
    void audio.play().catch(() => {});
  }

  function stopImmediately(audio) {
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }

  function fadeOutAndStop(audio) {
    if (!audio || audio.paused) return;
    globalThis.clearInterval(fadeTimer);
    const startVolume = audio.volume;
    let step = 0;
    fadeTimer = globalThis.setInterval(() => {
      step += 1;
      if (step >= FADE_STEPS) {
        globalThis.clearInterval(fadeTimer);
        stopImmediately(audio);
        audio.volume = startVolume;
        return;
      }
      audio.volume = Math.max(0, startVolume * (1 - step / FADE_STEPS));
    }, MOTOR_FADE_OUT_MS / FADE_STEPS);
  }

  function startMotor() {
    motor = new Audio(MOTOR_IGNITION_SRC);
    motor.loop = true;
    play(motor);
  }

  function switchToLaunch() {
    fadeOutAndStop(motor);
    launch = new Audio(ROCKET_LAUNCH_SRC);
    play(launch);
  }

  function stopLaunch() {
    stopImmediately(launch);
  }

  return Object.freeze({ startMotor, switchToLaunch, stopLaunch });
}

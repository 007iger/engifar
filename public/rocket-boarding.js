import { decorateCrewAvatar } from "./crew-avatars.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const STAIRS_MAX_CREW = 4;
const STEP_COUNT = 6;
const STRIDE_MS = 460;

function svgEl(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function wait(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function buildWalkerSvg(color) {
  const svg = svgEl("svg", { class: "rl-walker-svg", viewBox: "0 0 100 130", "aria-hidden": "true", focusable: "false" });
  svg.append(
    svgEl("ellipse", { cx: 50, cy: 124, rx: 22, ry: 5, fill: color, opacity: 0.3 }),
    svgEl("rect", { class: "rl-walker-leg rl-walker-leg--left", x: 33, y: 84, width: 13, height: 42, rx: 6.5, fill: color }),
    svgEl("rect", { class: "rl-walker-leg rl-walker-leg--right", x: 54, y: 84, width: 13, height: 42, rx: 6.5, fill: color }),
    svgEl("line", { x1: 50, y1: 6, x2: 50, y2: 20, stroke: color, "stroke-width": 4, "stroke-linecap": "round" }),
    svgEl("circle", { cx: 50, cy: 5, r: 5.5, fill: "#62e4ec" }),
    svgEl("rect", { x: 20, y: 18, width: 60, height: 74, rx: 29, fill: color, stroke: "rgba(255,255,255,.18)", "stroke-width": 2 }),
  );
  return svg;
}

function makeBoardingAvatar(participant, { walking }) {
  const wrap = document.createElement("div");
  wrap.className = "rl-boarding-avatar";
  wrap.style.setProperty("--crew-color", participant.color);
  wrap.setAttribute("aria-hidden", "true");
  wrap.title = participant.name || "";

  const motion = document.createElement("div");
  motion.className = "rl-boarding-avatar-motion";
  if (walking) motion.append(buildWalkerSvg(participant.color));
  else decorateCrewAvatar(motion);
  wrap.append(motion);
  return wrap;
}

function moveTo(avatar, point) {
  avatar.style.left = `${point.x}px`;
  avatar.style.top = `${point.y}px`;
}

async function boardViaStairs({ container, doorEl, groundEl, participants }) {
  const containerRect = container.getBoundingClientRect();
  const doorRect = doorEl.getBoundingClientRect();
  const groundRect = groundEl.getBoundingClientRect();

  const doorPoint = {
    x: doorRect.left + doorRect.width / 2 - containerRect.left,
    y: doorRect.top + doorRect.height * 0.62 - containerRect.top,
  };
  const groundY = groundRect.top - containerRect.top - 2;
  const baseX = doorPoint.x - Math.max(64, containerRect.width * 0.1);
  const basePoint = { x: baseX, y: groundY };

  const dx = doorPoint.x - basePoint.x;
  const dy = doorPoint.y - basePoint.y;
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

  const stair = document.createElement("div");
  stair.className = "rl-stairway";
  stair.style.left = `${basePoint.x}px`;
  stair.style.top = `${basePoint.y}px`;
  stair.style.width = `${length}px`;
  stair.style.transform = `rotate(${angle}deg)`;
  container.append(stair);
  void stair.offsetWidth;
  stair.classList.add("is-visible");

  doorEl.classList.add("is-open");
  await wait(280);

  const stepPoints = Array.from({ length: STEP_COUNT + 1 }, (_, index) => ({
    x: basePoint.x + dx * (index / STEP_COUNT),
    y: basePoint.y + dy * (index / STEP_COUNT),
  })).slice(1);

  async function boardOne(participant, index) {
    const avatar = makeBoardingAvatar(participant, { walking: true });
    avatar.style.left = `${basePoint.x - 110 - index * 26}px`;
    avatar.style.top = `${groundY}px`;
    container.append(avatar);
    avatar.classList.add("is-walking");
    await wait(40);

    moveTo(avatar, basePoint);
    await wait(STRIDE_MS + 40);

    for (const point of stepPoints) {
      moveTo(avatar, point);
      await wait(STRIDE_MS);
    }

    avatar.classList.remove("is-walking");
    avatar.classList.add("is-entering");
    await wait(300);
    avatar.remove();
  }

  await Promise.all(participants.map((participant, index) => wait(index * 620).then(() => boardOne(participant, index))));

  await wait(200);
  doorEl.classList.remove("is-open");
  stair.classList.remove("is-visible");
  await wait(320);
  stair.remove();
}

async function boardViaHatch({ container, rocketSvg, topHatchLid, groundEl, participants }) {
  const containerRect = container.getBoundingClientRect();
  const rocketRect = rocketSvg.getBoundingClientRect();
  const groundRect = groundEl.getBoundingClientRect();

  const rocketCenterX = rocketRect.left + rocketRect.width / 2 - containerRect.left;
  const groundY = groundRect.top - containerRect.top - 2;

  const count = participants.length;
  const spreadHalf = Math.min(Math.max(containerRect.width * 0.34, 90), 60 + count * 15);
  const marginX = containerRect.width * 0.04;

  const gatherPoints = participants.map((_, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const x = rocketCenterX - spreadHalf + spreadHalf * 2 * t;
    return {
      x: Math.min(containerRect.width - marginX, Math.max(marginX, x)),
      y: groundY - 6 - (index % 3) * 9,
    };
  });

  const avatars = participants.map((participant, index) => {
    const avatar = makeBoardingAvatar(participant, { walking: false });
    const spawn = gatherPoints[index];
    avatar.style.left = `${spawn.x + (index % 2 === 0 ? -1 : 1) * 46}px`;
    avatar.style.top = `${spawn.y - 26}px`;
    avatar.style.opacity = "0";
    container.append(avatar);
    return avatar;
  });

  await wait(60);
  avatars.forEach((avatar, index) => {
    avatar.style.transition = "left .5s ease-out, top .5s ease-out, opacity .3s ease";
    avatar.style.opacity = "1";
    moveTo(avatar, gatherPoints[index]);
  });
  await wait(700);

  topHatchLid.classList.add("is-open");
  await wait(550);

  function hatchPointFor() {
    const lidRect = topHatchLid.getBoundingClientRect();
    return {
      x: lidRect.left + lidRect.width / 2 - containerRect.left,
      y: lidRect.top + lidRect.height / 2 - containerRect.top,
    };
  }
  const hatchPoint = hatchPointFor();

  const staggerMs = count <= 10 ? 150 : count <= 20 ? 100 : 60;

  async function jumpIn(avatar) {
    avatar.classList.add("is-jumping");
    avatar.style.transition = "left .42s cubic-bezier(.32,-0.3,.7,.32), top .42s cubic-bezier(.32,-0.5,.6,.18), opacity .28s ease .2s";
    moveTo(avatar, hatchPoint);
    avatar.style.opacity = "0";
    await wait(440);
    avatar.remove();
  }

  await Promise.all(avatars.map((avatar, index) => wait(index * staggerMs).then(() => jumpIn(avatar))));

  await wait(180);
  topHatchLid.classList.remove("is-open");
  await wait(300);
}

export async function boardRocket({ container, rocketSvg, doorEl, topHatchLid, groundEl, participants }) {
  if (!container || !participants || participants.length === 0) return;
  container.replaceChildren();

  if (participants.length <= STAIRS_MAX_CREW) {
    await boardViaStairs({ container, doorEl, groundEl, participants });
  } else {
    await boardViaHatch({ container, rocketSvg, topHatchLid, groundEl, participants });
  }

  container.replaceChildren();
}

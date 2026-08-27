const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

export function decorateCrewAvatar(element) {
  if (!element || element.dataset.avatarReady === "true") return element;
  element.dataset.avatarReady = "true";
  element.classList.add("crew-avatar--svg");
  element.querySelectorAll(":scope > i").forEach((child) => child.remove());

  const svg = svgElement("svg", {
    class: "crew-avatar-svg",
    viewBox: "0 0 100 130",
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.append(
    svgElement("ellipse", {
      cx: 50,
      cy: 118,
      rx: 24,
      ry: 7,
      fill: "var(--crew-color, #54d37c)",
      opacity: 0.3,
    }),
    svgElement("line", {
      x1: 50,
      y1: 10,
      x2: 50,
      y2: 24,
      stroke: "var(--crew-color, #54d37c)",
      "stroke-width": 4,
      "stroke-linecap": "round",
    }),
    svgElement("circle", { cx: 50, cy: 8, r: 6, fill: "#62e4ec" }),
    svgElement("rect", {
      x: 20,
      y: 22,
      width: 60,
      height: 76,
      rx: 30,
      fill: "var(--crew-color, #54d37c)",
      stroke: "rgba(255,255,255,.18)",
      "stroke-width": 2,
    }),
    svgElement("rect", { x: 32, y: 42, width: 36, height: 26, rx: 12, fill: "#f0f7f5" }),
    svgElement("circle", { cx: 43, cy: 55, r: 4, fill: "#122232" }),
    svgElement("circle", { cx: 57, cy: 55, r: 4, fill: "#122232" }),
  );
  element.prepend(svg);
  return element;
}

export function decorateCrewAvatars(root = document) {
  root.querySelectorAll(".crew-avatar").forEach(decorateCrewAvatar);
}

function slotsFor(count) {
  if (count === 1) return [{ left: 50, top: 78 }];
  const slots = [];
  const centerX = 50;
  const centerY = 52;
  const radiusX = Math.min(41, 22 + count * 3.2);
  const radiusY = Math.min(38, 20 + count * 2.5);
  for (let index = 0; index < count; index += 1) {
    const angle = (-90 + (360 / count) * index) * Math.PI / 180;
    slots.push({
      left: centerX + Math.cos(angle) * radiusX,
      top: centerY + Math.sin(angle) * radiusY,
    });
  }
  return slots;
}

const REACTION_CLASSES = ["is-reacting-shy", "is-reacting-spin"];
const OVERLAP_MIN_DIST = 58;
const OVERLAP_KICK = 1.15;
const TRANSIENT_CLASS_FALLBACK_MS = {
  "is-reacting-shy": 580 + 150,
  "is-reacting-spin": 620 + 150,
  "is-bounce": 320 + 150,
};

function resolveOverlap(avatar, field) {
  const others = Array.from(field.querySelectorAll(".room-field-avatar")).filter((el) => el !== avatar);
  if (!others.length) return false;
  const bounds = field.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const cx = (parseFloat(avatar.style.left) / 100) * width;
  const cy = (parseFloat(avatar.style.top) / 100) * height;
  let pushX = 0;
  let pushY = 0;
  let overlapped = false;

  others.forEach((other) => {
    const ox = (parseFloat(other.style.left) / 100) * width;
    const oy = (parseFloat(other.style.top) / 100) * height;
    let dx = cx - ox;
    let dy = cy - oy;
    let dist = Math.hypot(dx, dy);
    if (dist >= OVERLAP_MIN_DIST) return;
    overlapped = true;
    if (dist < 1) {
      const angle = Math.random() * Math.PI * 2;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      dist = 1;
    }
    const overlap = OVERLAP_MIN_DIST - dist;
    pushX += (dx / dist) * overlap;
    pushY += (dy / dist) * overlap;
  });

  if (!overlapped) return false;

  const nx = Math.min(width * 0.94, Math.max(width * 0.06, cx + pushX * OVERLAP_KICK));
  const ny = Math.min(height * 0.92, Math.max(height * 0.08, cy + pushY * OVERLAP_KICK));
  avatar.style.left = `${(nx / width) * 100}%`;
  avatar.style.top = `${(ny / height) * 100}%`;
  return true;
}

function playTransientClass(avatar, className, onDone) {
  avatar.dataset.busy = "true";
  avatar.classList.remove(...REACTION_CLASSES, "is-bounce");
  void avatar.offsetWidth;
  avatar.classList.add(className);

  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    avatar.classList.remove(className);
    avatar.dataset.busy = "false";
    avatar.removeEventListener("animationend", onEnd);
    globalThis.clearTimeout(fallbackTimer);
    if (onDone) onDone();
  };
  const onEnd = (event) => {
    if (event.target !== avatar) return;
    settle();
  };
  avatar.addEventListener("animationend", onEnd);
  const fallbackTimer = globalThis.setTimeout(settle, TRANSIENT_CLASS_FALLBACK_MS[className] ?? 700);
}

function enableAvatarInteraction(avatar, field) {
  let pointerId = null;
  let dragged = false;
  let startX = 0;
  let startY = 0;
  const DRAG_THRESHOLD = 4;

  avatar.addEventListener("pointerdown", (event) => {
    if (avatar.dataset.busy === "true") return;
    pointerId = event.pointerId;
    dragged = false;
    startX = event.clientX;
    startY = event.clientY;
    avatar.setPointerCapture(pointerId);
    avatar.classList.add("is-dragging");
  });
  avatar.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    if (!dragged && Math.hypot(event.clientX - startX, event.clientY - startY) > DRAG_THRESHOLD) {
      dragged = true;
    }
    const bounds = field.getBoundingClientRect();
    const left = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 100;
    const top = ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 100;
    avatar.style.left = `${Math.min(94, Math.max(6, left))}%`;
    avatar.style.top = `${Math.min(92, Math.max(8, top))}%`;
  });
  const finish = (event) => {
    if (pointerId !== event.pointerId) return;
    if (avatar.hasPointerCapture(pointerId)) avatar.releasePointerCapture(pointerId);
    pointerId = null;
    avatar.classList.remove("is-dragging");
    const wasDragged = dragged;
    dragged = false;

    if (wasDragged) {
      if (resolveOverlap(avatar, field)) playTransientClass(avatar, "is-bounce");
      return;
    }
    if (event.type !== "pointerup") return;
    const reactionClass = REACTION_CLASSES[Math.floor(Math.random() * REACTION_CLASSES.length)];
    playTransientClass(avatar, reactionClass);
  };
  avatar.addEventListener("pointerup", finish);
  avatar.addEventListener("pointercancel", finish);
}

function addPlayfulDetails(avatar) {
  const sweat = document.createElement("span");
  sweat.className = "room-field-avatar-sweat";
  sweat.setAttribute("aria-hidden", "true");
  avatar.append(sweat);
}

export function renderRoomAvatarField(field, participants) {
  if (!field) return;
  field.replaceChildren();
  const slots = slotsFor(participants.length);
  participants.forEach((participant, index) => {
    const avatar = document.createElement("button");
    avatar.type = "button";
    avatar.className = "crew-avatar room-field-avatar";
    avatar.style.setProperty("--crew-color", participant.color);
    avatar.style.left = `${slots[index].left}%`;
    avatar.style.top = `${slots[index].top}%`;
    avatar.title = `${participant.name}（ドラッグで移動）`;
    avatar.setAttribute("aria-label", `${participant.name}。タップするとリアクションします`);
    decorateCrewAvatar(avatar);
    addPlayfulDetails(avatar);
    if (participant.isYou) {
      avatar.classList.add("is-you");
      const label = document.createElement("b");
      label.className = "room-field-avatar-label";
      label.textContent = "YOU";
      avatar.append(label);
    }
    enableAvatarInteraction(avatar, field);
    field.append(avatar);
  });
}

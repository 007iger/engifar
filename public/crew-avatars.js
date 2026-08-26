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

function enableAvatarInteraction(avatar, field) {
  let pointerId = null;
  let dragged = false;

  avatar.addEventListener("pointerdown", (event) => {
    pointerId = event.pointerId;
    dragged = false;
    avatar.setPointerCapture(pointerId);
    avatar.classList.add("is-dragging");
  });
  avatar.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    const bounds = field.getBoundingClientRect();
    const left = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 100;
    const top = ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 100;
    avatar.style.left = `${Math.min(94, Math.max(6, left))}%`;
    avatar.style.top = `${Math.min(92, Math.max(8, top))}%`;
    dragged = true;
  });
  const finish = (event) => {
    if (pointerId !== event.pointerId) return;
    if (avatar.hasPointerCapture(pointerId)) avatar.releasePointerCapture(pointerId);
    pointerId = null;
    avatar.classList.remove("is-dragging");
    if (!dragged) {
      avatar.classList.remove("is-reacting");
      void avatar.offsetWidth;
      avatar.classList.add("is-reacting");
      globalThis.setTimeout(() => avatar.classList.remove("is-reacting"), 600);
    }
  };
  avatar.addEventListener("pointerup", finish);
  avatar.addEventListener("pointercancel", finish);
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

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const REACTIONS = Object.freeze({
  waiting: {
    label: "考え中…",
    title: "問題を考えているクルー",
    description: "首を傾げて周囲を見回しながら、ときどき瞬きをします。",
  },
  correct: {
    label: "やった！",
    title: "正解を喜ぶクルー",
    description: "目を細め、二度ぴょこぴょこと跳ねて喜びます。",
  },
  incorrect: {
    label: "次もいこう",
    title: "次の問題へ気持ちを切り替えるクルー",
    description: "少ししょんぼりしたあと、次の挑戦に備えます。",
  },
});

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function append(parent, ...children) {
  parent.append(...children);
  return parent;
}

function createCrewSvg(titleId, descriptionId) {
  const svg = svgElement("svg", {
    class: "quiz-crew",
    viewBox: "0 0 96 96",
    role: "img",
    "aria-labelledby": `${titleId} ${descriptionId}`,
    focusable: "false",
  });
  const title = svgElement("title", { id: titleId });
  const description = svgElement("desc", { id: descriptionId });

  const celebration = svgElement("g", {
    class: "quiz-crew__celebration",
    "aria-hidden": "true",
  });
  append(
    celebration,
    svgElement("path", {
      class: "quiz-crew__spark quiz-crew__spark--one",
      d: "M16 34v9m-4.5-4.5h9",
    }),
    svgElement("path", {
      class: "quiz-crew__spark quiz-crew__spark--two",
      d: "M77 27v7m-3.5-3.5h7",
    }),
    svgElement("path", {
      class: "quiz-crew__spark quiz-crew__spark--three",
      d: "M79 61v8m-4-4h8",
    }),
    svgElement("circle", {
      class: "quiz-crew__confetti quiz-crew__confetti--one",
      cx: 24,
      cy: 25,
      r: 1.8,
    }),
    svgElement("circle", {
      class: "quiz-crew__confetti quiz-crew__confetti--two",
      cx: 73,
      cy: 45,
      r: 1.5,
    }),
  );

  const antenna = svgElement("g", { class: "quiz-crew__antenna" });
  append(
    antenna,
    svgElement("path", {
      d: "M48 26V16",
      fill: "none",
      stroke: "#92f0ed",
      "stroke-width": 4,
      "stroke-linecap": "round",
    }),
    svgElement("circle", { cx: 48, cy: 12, r: 5, fill: "#92f0ed" }),
  );

  const eyes = svgElement("g", { class: "quiz-crew__eyes" });
  append(
    eyes,
    svgElement("circle", { class: "quiz-crew__eye", cx: 40, cy: 53.5, r: 3.5 }),
    svgElement("circle", { class: "quiz-crew__eye", cx: 56, cy: 53.5, r: 3.5 }),
  );

  const happyEyes = svgElement("g", {
    class: "quiz-crew__happy-eyes",
    "aria-hidden": "true",
  });
  append(
    happyEyes,
    svgElement("path", { d: "M36.5 55Q40 51 43.5 55" }),
    svgElement("path", { d: "M52.5 55Q56 51 59.5 55" }),
  );

  const worriedBrows = svgElement("g", {
    class: "quiz-crew__worried-brows",
    "aria-hidden": "true",
  });
  append(
    worriedBrows,
    svgElement("path", { d: "M36.5 50.5 43 48.5" }),
    svgElement("path", { d: "M53 48.5 59.5 50.5" }),
  );

  const cheeks = svgElement("g", {
    class: "quiz-crew__cheeks",
    "aria-hidden": "true",
  });
  append(
    cheeks,
    svgElement("circle", { cx: 34.5, cy: 59, r: 1.8 }),
    svgElement("circle", { cx: 61.5, cy: 59, r: 1.8 }),
  );

  const face = svgElement("g", { class: "quiz-crew__face" });
  append(
    face,
    svgElement("rect", {
      class: "quiz-crew__visor",
      x: 29,
      y: 43,
      width: 38,
      height: 21,
      rx: 10.5,
    }),
    svgElement("path", {
      class: "quiz-crew__visor-shade",
      d: "M31 59c8 3 27 3 34 0",
    }),
    eyes,
    happyEyes,
    worriedBrows,
    cheeks,
    svgElement("path", {
      class: "quiz-crew__tear",
      d: "M60 57.5s-2.2 2.9-2.2 4.5a2.2 2.2 0 0 0 4.4 0c0-1.6-2.2-4.5-2.2-4.5Z",
      "aria-hidden": "true",
    }),
  );

  const pose = svgElement("g", { class: "quiz-crew__pose" });
  append(
    pose,
    antenna,
    svgElement("path", {
      class: "quiz-crew__body",
      d: "M48 25C30 25 20 38 20 57c0 20 10 30 28 30s28-10 28-30c0-19-10-32-28-32Z",
    }),
    svgElement("path", {
      class: "quiz-crew__body-highlight",
      d: "M31 36c5-7 12-9 19-9",
    }),
    face,
  );

  append(
    svg,
    title,
    description,
    svgElement("ellipse", {
      class: "quiz-crew__shadow",
      cx: 48,
      cy: 88,
      rx: 20,
      ry: 4,
    }),
    celebration,
    pose,
  );

  return { svg, title, description };
}

export function createQuizCrewReaction(container, options = {}) {
  const noReaction = Object.freeze({ setState: () => false });
  if (!container) return noReaction;

  const playerName = typeof options.name === "string" && options.name.trim()
    ? options.name.trim()
    : "クルー";
  const titleId = "quiz-crew-reaction-title";
  const descriptionId = "quiz-crew-reaction-description";
  const label = document.createElement("span");
  label.className = "quiz-crew-reaction__label";
  label.setAttribute("aria-hidden", "true");

  const { svg, title, description } = createCrewSvg(titleId, descriptionId);
  container.style.setProperty("--crew-color", options.color || "#54d37c");
  container.replaceChildren(label, svg);

  function setState(nextState) {
    const reaction = REACTIONS[nextState];
    if (!reaction) return false;

    // 状態属性を外してレイアウトを確定し、同じリアクションも先頭から再生する。
    svg.removeAttribute("data-state");
    void svg.getBoundingClientRect();
    svg.dataset.state = nextState;
    container.dataset.state = nextState;
    label.textContent = reaction.label;
    title.textContent = `${playerName}：${reaction.title}`;
    description.textContent = reaction.description;
    return true;
  }

  setState("waiting");
  return Object.freeze({ setState });
}

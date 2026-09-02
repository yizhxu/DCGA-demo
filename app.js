(() => {
  "use strict";

  const data = window.DCGA_CASE_DATA;
  if (!data || !Array.isArray(data.cases) || data.cases.length === 0) {
    throw new Error("DCGA case data could not be loaded.");
  }

  const jointIndex = Object.fromEntries(data.jointNames.map((name, index) => [name, index]));
  const bones = [
    ["nose", "l_ear", "left"],
    ["nose", "r_ear", "right"],
    ["nose", "neck", "center"],
    ["neck", "l_shoulder", "left"],
    ["neck", "r_shoulder", "right"],
    ["neck", "l_ear", "left"],
    ["neck", "r_ear", "right"],
    ["l_shoulder", "l_elbow", "left"],
    ["l_elbow", "l_wrist", "left"],
    ["r_shoulder", "r_elbow", "right"],
    ["r_elbow", "r_wrist", "right"],
    ["l_shoulder", "l_hip", "left"],
    ["r_shoulder", "r_hip", "right"],
    ["pelvis", "l_hip", "left"],
    ["pelvis", "r_hip", "right"],
    ["l_hip", "l_knee", "left"],
    ["l_knee", "l_ankle", "left"],
    ["l_ankle", "l_heel", "left"],
    ["l_heel", "l_toe", "left"],
    ["r_hip", "r_knee", "right"],
    ["r_knee", "r_ankle", "right"],
    ["r_ankle", "r_heel", "right"],
    ["r_heel", "r_toe", "right"],
  ].map(([from, to, side]) => ({
    from: jointIndex[from],
    to: jointIndex[to],
    side,
  }));

  const palette = {
    left: "#ff956b",
    right: "#69c3ff",
    center: "#edf7ef",
    ghost: "#b9cbc5",
    mint: "#86e0bd",
    lime: "#c8f06d",
    amber: "#ffbd5a",
    forest: "#09251f",
  };

  const elements = {
    caseTabs: document.querySelector("#case-tabs"),
    previousCase: document.querySelector("#previous-case"),
    nextCase: document.querySelector("#next-case"),
    casePanel: document.querySelector("#case-panel"),
    caseTitle: document.querySelector("#case-title"),
    groundTruth: document.querySelector("#ground-truth"),
    baselinePredictions: document.querySelector("#baseline-predictions"),
    dcgaPredictions: document.querySelector("#dcga-predictions"),
    poseCanvas: document.querySelector("#pose-canvas"),
    contextCanvas: document.querySelector("#context-canvas"),
    playButton: document.querySelector("#play-button"),
    replayButton: document.querySelector("#replay-button"),
    timeline: document.querySelector("#timeline"),
    frameCounter: document.querySelector("#frame-counter"),
    speedButtons: [...document.querySelectorAll("[data-speed]")],
  };

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = {
    caseIndex: 0,
    frame: 0,
    playing: true,
    speed: 1,
    lastTimestamp: performance.now(),
    needsDraw: true,
  };
  const geometryCache = new Map();
  const tabButtons = [];

  function normalizeLabel(label) {
    return label.trim().toLocaleLowerCase();
  }

  function isGroundTruth(label, groundTruth) {
    return normalizeLabel(label) === normalizeLabel(groundTruth);
  }

  function formatProbability(value) {
    return `${Number(value).toFixed(1)}%`;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function currentCase() {
    return data.cases[state.caseIndex];
  }

  function createTabs() {
    data.cases.forEach((caseData, index) => {
      const button = document.createElement("button");
      button.id = `case-tab-${caseData.id}`;
      button.className = "case-tab";
      button.type = "button";
      button.role = "tab";
      button.setAttribute("aria-controls", "case-panel");
      button.setAttribute("aria-selected", index === 0 ? "true" : "false");
      button.tabIndex = index === 0 ? 0 : -1;

      const label = document.createElement("span");
      label.textContent = `Player ${index + 1}`;
      const action = document.createElement("strong");
      action.textContent = caseData.groundTruth;
      button.append(label, action);

      button.addEventListener("click", () => selectCase(index));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === "ArrowLeft") nextIndex = (index - 1 + data.cases.length) % data.cases.length;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % data.cases.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = data.cases.length - 1;
        selectCase(nextIndex, true);
      });

      tabButtons.push(button);
      elements.caseTabs.append(button);
    });
  }

  function renderPredictionList(container, predictions, groundTruth) {
    const fragment = document.createDocumentFragment();

    predictions.forEach((prediction, index) => {
      const truth = isGroundTruth(prediction.label, groundTruth);
      const row = document.createElement("div");
      row.className = "prediction-row";
      if (truth) row.classList.add("is-truth");
      row.setAttribute(
        "aria-label",
        `Rank ${index + 1}: ${prediction.label}, ${formatProbability(prediction.probability)}` +
          `${truth ? ", ground truth" : ""}`,
      );

      const identity = document.createElement("div");
      identity.className = "prediction-identity";

      const rank = document.createElement("span");
      rank.className = "prediction-rank";
      rank.textContent = String(index + 1);

      const name = document.createElement("span");
      name.className = "prediction-name";
      name.textContent = prediction.label;
      identity.append(rank, name);

      const probability = document.createElement("strong");
      probability.className = "prediction-probability";
      probability.textContent = formatProbability(prediction.probability);

      const track = document.createElement("div");
      track.className = "prediction-track";
      track.setAttribute("aria-hidden", "true");
      const fill = document.createElement("span");
      fill.style.setProperty("--probability", `${Math.max(prediction.probability, 0.8)}%`);
      track.append(fill);

      row.append(identity, probability, track);
      fragment.append(row);
    });

    container.replaceChildren(fragment);
  }

  function updateCaseContent() {
    const caseData = currentCase();
    const playerNumber = state.caseIndex + 1;

    elements.caseTitle.textContent = `Player ${playerNumber}`;
    elements.groundTruth.textContent = `Ground truth · ${caseData.groundTruth}`;

    renderPredictionList(
      elements.baselinePredictions,
      caseData.predictions.baseline,
      caseData.groundTruth,
    );
    renderPredictionList(elements.dcgaPredictions, caseData.predictions.dcga, caseData.groundTruth);

    elements.poseCanvas.setAttribute(
      "aria-label",
      `Player ${playerNumber}: animated player-centered skeleton for ${caseData.groundTruth}, without ball or pitch context`,
    );
    elements.contextCanvas.setAttribute(
      "aria-label",
      `Player ${playerNumber}: animated skeleton with global pitch position and the ball for ${caseData.groundTruth}`,
    );
    elements.timeline.max = String(caseData.frames.length - 1);
    elements.casePanel.setAttribute("aria-labelledby", tabButtons[state.caseIndex].id);

    tabButtons.forEach((button, index) => {
      const selected = index === state.caseIndex;
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
    });
  }

  function selectCase(index, focusTab = false) {
    state.caseIndex = (index + data.cases.length) % data.cases.length;
    state.frame = 0;
    state.lastTimestamp = performance.now();
    state.needsDraw = true;
    updateCaseContent();
    updatePlaybackUi();

    const activeTab = tabButtons[state.caseIndex];
    activeTab.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest", inline: "nearest" });
    if (focusTab) activeTab.focus();
  }

  function updatePlayButton() {
    const glyph = elements.playButton.querySelector("span");
    glyph.textContent = state.playing ? "Ⅱ" : "▶";
    glyph.style.letterSpacing = state.playing ? "-0.16em" : "0";
    glyph.style.transform = state.playing ? "translateX(-1px)" : "translateX(1px)";
    elements.playButton.setAttribute("aria-label", state.playing ? "Pause animation" : "Play animation");
  }

  function togglePlayback() {
    state.playing = !state.playing;
    state.lastTimestamp = performance.now();
    state.needsDraw = true;
    updatePlayButton();
  }

  function updatePlaybackUi() {
    const caseData = currentCase();
    const maximum = caseData.frames.length - 1;
    const frameNumber = clamp(Math.floor(state.frame) + 1, 1, caseData.frames.length);
    const progress = maximum > 0 ? (state.frame / maximum) * 100 : 0;
    elements.timeline.value = String(state.frame);
    elements.timeline.style.setProperty("--progress", `${progress}%`);
    elements.frameCounter.innerHTML =
      `Frame ${String(frameNumber).padStart(2, "0")} / ${String(caseData.frames.length).padStart(2, "0")}` +
      ` <span>${(state.frame / data.fps).toFixed(2)} s</span>`;
  }

  function interpolatePoint(first, second, amount) {
    return [
      first[0] + (second[0] - first[0]) * amount,
      first[1] + (second[1] - first[1]) * amount,
      first[2] + (second[2] - first[2]) * amount,
    ];
  }

  function sampleFrame(caseData, framePosition) {
    const firstIndex = clamp(Math.floor(framePosition), 0, caseData.frames.length - 1);
    const secondIndex = Math.min(firstIndex + 1, caseData.frames.length - 1);
    const amount = secondIndex === firstIndex ? 0 : framePosition - firstIndex;
    const first = caseData.frames[firstIndex];
    const second = caseData.frames[secondIndex];

    return {
      joints: first.joints.map((joint, index) =>
        interpolatePoint(joint, second.joints[index], amount),
      ),
      ball:
        first.ball && second.ball
          ? interpolatePoint(first.ball, second.ball, amount)
          : first.ball || second.ball,
    };
  }

  function prepareCanvas(canvas) {
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const density = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * density);
    const pixelHeight = Math.round(height * density);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const context = canvas.getContext("2d");
    context.setTransform(density, 0, 0, density, 0, 0);
    context.clearRect(0, 0, width, height);
    return { context, width, height };
  }

  function roundedRectangle(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  function jointSide(name) {
    if (name.startsWith("l_")) return "left";
    if (name.startsWith("r_")) return "right";
    return "center";
  }

  function drawSkeleton(context, joints, project, options = {}) {
    const {
      alpha = 1,
      lineWidth = 3,
      jointRadius = 3,
      monochrome = null,
      glow = 0,
    } = options;

    context.save();
    context.globalAlpha = alpha;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.shadowBlur = glow;
    context.shadowColor = monochrome || palette.mint;

    bones.forEach((bone) => {
      const from = project(joints[bone.from]);
      const to = project(joints[bone.to]);
      context.beginPath();
      context.moveTo(from[0], from[1]);
      context.lineTo(to[0], to[1]);
      context.lineWidth = lineWidth;
      context.strokeStyle = monochrome || palette[bone.side];
      context.stroke();
    });

    joints.forEach((joint, index) => {
      const point = project(joint);
      const color = monochrome || palette[jointSide(data.jointNames[index])];
      context.beginPath();
      context.arc(point[0], point[1], jointRadius, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
      if (!monochrome && alpha > 0.8) {
        context.lineWidth = Math.max(1, jointRadius * 0.3);
        context.strokeStyle = "rgba(5, 28, 23, 0.7)";
        context.stroke();
      }
    });

    context.restore();
  }

  function createFixedPoseProjector(width, height, caseData) {
    const pelvis0 = caseData.frames[0].joints[jointIndex.pelvis];
    const yaw = 0.68;
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);
    const depthTilt = 0.23;

    // Coordinate frame is anchored at the first-frame pelvis and never re-centred,
    // so the skeleton visibly translates across a static view.
    const axes = (point) => {
      const x = point[0] - pelvis0[0];
      const y = point[1] - pelvis0[1];
      return [x * cosine - y * sine, (x * sine + y * cosine) * depthTilt - point[2]];
    };

    let uMin = Infinity;
    let uMax = -Infinity;
    let wMin = Infinity;
    let wMax = -Infinity;
    caseData.frames.forEach((frame) => {
      frame.joints.forEach((joint) => {
        const [u, w] = axes(joint);
        if (u < uMin) uMin = u;
        if (u > uMax) uMax = u;
        if (w < wMin) wMin = w;
        if (w > wMax) wMax = w;
      });
    });

    const spanU = Math.max(uMax - uMin, 0.001);
    const spanW = Math.max(wMax - wMin, 0.001);
    const originalScale = Math.min(width / 3.8, height / 2.25);
    const scale = Math.min((width * 0.82) / spanU, (height * 0.72) / spanW, originalScale);
    const offsetX = width * 0.5 - ((uMin + uMax) / 2) * scale;
    const offsetY = height * 0.86 - wMax * scale;

    const project = (point) => {
      const [u, w] = axes(point);
      return [offsetX + u * scale, offsetY + w * scale];
    };
    project.scale = scale;
    return project;
  }

  function drawPoseBackdrop(context, width, height) {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#071d1d");
    gradient.addColorStop(0.55, "#0a2926");
    gradient.addColorStop(1, "#0d3430");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    const glow = context.createRadialGradient(
      width * 0.52,
      height * 0.46,
      0,
      width * 0.52,
      height * 0.46,
      Math.max(width, height) * 0.55,
    );
    glow.addColorStop(0, "rgba(134, 224, 189, 0.13)");
    glow.addColorStop(0.6, "rgba(134, 224, 189, 0.025)");
    glow.addColorStop(1, "rgba(134, 224, 189, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    context.save();
    context.strokeStyle = "rgba(212, 233, 225, 0.055)";
    context.lineWidth = 1;
    const gap = Math.max(34, width / 13);
    for (let x = gap; x < width; x += gap) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = gap; y < height; y += gap) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    context.restore();
  }

  function drawPoseCanvas(caseData, framePosition) {
    const { context, width, height } = prepareCanvas(elements.poseCanvas);
    drawPoseBackdrop(context, width, height);

    const current = sampleFrame(caseData, framePosition);
    const currentProject = createFixedPoseProjector(width, height, caseData);
    const groundPoint = currentProject([
      current.joints[jointIndex.pelvis][0],
      current.joints[jointIndex.pelvis][1],
      0,
    ]);

    context.save();
    const shadowRadius = clamp(currentProject.scale * 0.5, 18, width * 0.14);
    const shadow = context.createRadialGradient(
      groundPoint[0],
      groundPoint[1],
      0,
      groundPoint[0],
      groundPoint[1],
      shadowRadius,
    );
    shadow.addColorStop(0, "rgba(0, 0, 0, 0.26)");
    shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.scale(1, 0.22);
    context.fillStyle = shadow;
    context.beginPath();
    context.arc(groundPoint[0], groundPoint[1] / 0.22, shadowRadius, 0, Math.PI * 2);
    context.fill();
    context.restore();

    drawSkeleton(context, current.joints, currentProject, {
      lineWidth: clamp(currentProject.scale * 0.028, 1.8, 4.5),
      jointRadius: clamp(currentProject.scale * 0.035, 2, 5.2),
      glow: 8,
    });
  }

  function buildContextGeometry(caseData) {
    if (geometryCache.has(caseData.id)) return geometryCache.get(caseData.id);

    const pelvis = jointIndex.pelvis;
    const points = [];
    let maximumZ = 0;

    caseData.frames.forEach((frame) => {
      points.push(frame.joints[pelvis]);
      if (frame.ball) points.push(frame.ball);
      frame.joints.forEach((joint) => {
        maximumZ = Math.max(maximumZ, joint[2]);
      });
      if (frame.ball) maximumZ = Math.max(maximumZ, frame.ball[2]);
    });

    let minimumX = Math.min(...points.map((point) => point[0]));
    let maximumX = Math.max(...points.map((point) => point[0]));
    let minimumY = Math.min(...points.map((point) => point[1]));
    let maximumY = Math.max(...points.map((point) => point[1]));
    const centerX = (minimumX + maximumX) / 2;
    const centerY = (minimumY + maximumY) / 2;
    const spanX = Math.max(maximumX - minimumX + 1.5, 7.5);
    const spanY = Math.max(maximumY - minimumY + 1.5, 6);

    minimumX = centerX - spanX / 2;
    maximumX = centerX + spanX / 2;
    minimumY = centerY - spanY / 2;
    maximumY = centerY + spanY / 2;

    const geometry = {
      minimumX,
      maximumX,
      minimumY,
      maximumY,
      centerX,
      centerY,
      maximumZ,
    };
    geometryCache.set(caseData.id, geometry);
    return geometry;
  }

  function createWorldProjector(width, height, geometry) {
    const yaw = -0.34;
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);
    const groundCompression = 0.56;
    const verticalScale = 1.12;

    const rawProject = (point) => {
      const x = point[0] - geometry.centerX;
      const y = point[1] - geometry.centerY;
      return [
        x * cosine - y * sine,
        (x * sine + y * cosine) * groundCompression - point[2] * verticalScale,
      ];
    };

    const corners = [
      [geometry.minimumX, geometry.minimumY, 0],
      [geometry.minimumX, geometry.maximumY, 0],
      [geometry.maximumX, geometry.minimumY, 0],
      [geometry.maximumX, geometry.maximumY, 0],
      [geometry.minimumX, geometry.minimumY, geometry.maximumZ + 0.8],
      [geometry.minimumX, geometry.maximumY, geometry.maximumZ + 0.8],
      [geometry.maximumX, geometry.minimumY, geometry.maximumZ + 0.8],
      [geometry.maximumX, geometry.maximumY, geometry.maximumZ + 0.8],
    ].map(rawProject);

    const minimumU = Math.min(...corners.map((point) => point[0]));
    const maximumU = Math.max(...corners.map((point) => point[0]));
    const minimumV = Math.min(...corners.map((point) => point[1]));
    const maximumV = Math.max(...corners.map((point) => point[1]));
    const scale = Math.min(
      (width - 18) / Math.max(maximumU - minimumU, 1),
      (height - 18) / Math.max(maximumV - minimumV, 1),
    );
    const offsetX = width / 2 - ((minimumU + maximumU) / 2) * scale;
    const offsetY = height / 2 - ((minimumV + maximumV) / 2) * scale + 4;

    const project = (point) => {
      const raw = rawProject(point);
      return [offsetX + raw[0] * scale, offsetY + raw[1] * scale];
    };
    project.scale = scale;
    return project;
  }

  function projectedPolygon(context, project, points, fillStyle, strokeStyle = null, width = 1) {
    const projected = points.map(project);
    context.beginPath();
    context.moveTo(projected[0][0], projected[0][1]);
    projected.slice(1).forEach((point) => context.lineTo(point[0], point[1]));
    context.closePath();
    if (fillStyle) {
      context.fillStyle = fillStyle;
      context.fill();
    }
    if (strokeStyle) {
      context.lineWidth = width;
      context.strokeStyle = strokeStyle;
      context.stroke();
    }
  }

  function projectedPath(context, project, points, options = {}) {
    if (points.length < 2) return;
    const { strokeStyle = "#fff", lineWidth = 1, dash = [], alpha = 1 } = options;
    const projected = points.map(project);
    context.save();
    context.globalAlpha = alpha;
    context.beginPath();
    context.moveTo(projected[0][0], projected[0][1]);
    projected.slice(1).forEach((point) => context.lineTo(point[0], point[1]));
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.setLineDash(dash);
    context.stroke();
    context.restore();
  }

  function projectedGroundCircle(context, project, center, radius, options = {}) {
    const points = [];
    for (let index = 0; index <= 64; index += 1) {
      const angle = (index / 64) * Math.PI * 2;
      points.push([
        center[0] + Math.cos(angle) * radius,
        center[1] + Math.sin(angle) * radius,
        center[2] || 0,
      ]);
    }
    projectedPath(context, project, points, options);
  }

  function drawPitch(context, width, height, project, caseData) {
    const pitch = (caseData && caseData.pitch) || data.pitch;
    const halfLength = pitch.length / 2;
    const halfWidth = pitch.width / 2;
    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#102f2a");
    background.addColorStop(1, "#071e1a");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    const stripes = 18;
    for (let index = 0; index < stripes; index += 1) {
      const x1 = -halfLength + (index / stripes) * pitch.length;
      const x2 = -halfLength + ((index + 1) / stripes) * pitch.length;
      projectedPolygon(
        context,
        project,
        [
          [x1, -halfWidth, 0],
          [x2, -halfWidth, 0],
          [x2, halfWidth, 0],
          [x1, halfWidth, 0],
        ],
        index % 2 === 0 ? "#236f4c" : "#1f6847",
      );
    }

    const lineColor = "rgba(240, 247, 225, 0.72)";
    const lineWidth = clamp(project.scale * 0.08, 1, 1.7);
    projectedPath(
      context,
      project,
      [
        [-halfLength, -halfWidth, 0.02],
        [halfLength, -halfWidth, 0.02],
        [halfLength, halfWidth, 0.02],
        [-halfLength, halfWidth, 0.02],
        [-halfLength, -halfWidth, 0.02],
      ],
      { strokeStyle: lineColor, lineWidth },
    );
    projectedPath(
      context,
      project,
      [
        [0, -halfWidth, 0.02],
        [0, halfWidth, 0.02],
      ],
      { strokeStyle: lineColor, lineWidth },
    );
    projectedGroundCircle(context, project, [0, 0, 0.02], 9.15, {
      strokeStyle: lineColor,
      lineWidth,
    });
    projectedGroundCircle(context, project, [0, 0, 0.02], 0.18, {
      strokeStyle: lineColor,
      lineWidth: 2,
    });

    [
      {
        outer: [
          [-halfLength, -20.16, 0.02],
          [-halfLength + 16.5, -20.16, 0.02],
          [-halfLength + 16.5, 20.16, 0.02],
          [-halfLength, 20.16, 0.02],
        ],
        inner: [
          [-halfLength, -9.16, 0.02],
          [-halfLength + 5.5, -9.16, 0.02],
          [-halfLength + 5.5, 9.16, 0.02],
          [-halfLength, 9.16, 0.02],
        ],
        spot: [-halfLength + 11, 0, 0.02],
      },
      {
        outer: [
          [halfLength, -20.16, 0.02],
          [halfLength - 16.5, -20.16, 0.02],
          [halfLength - 16.5, 20.16, 0.02],
          [halfLength, 20.16, 0.02],
        ],
        inner: [
          [halfLength, -9.16, 0.02],
          [halfLength - 5.5, -9.16, 0.02],
          [halfLength - 5.5, 9.16, 0.02],
          [halfLength, 9.16, 0.02],
        ],
        spot: [halfLength - 11, 0, 0.02],
      },
    ].forEach((area) => {
      projectedPath(context, project, area.outer, { strokeStyle: lineColor, lineWidth });
      projectedPath(context, project, area.inner, { strokeStyle: lineColor, lineWidth });
      projectedGroundCircle(context, project, area.spot, 0.16, {
        strokeStyle: lineColor,
        lineWidth: 2,
      });
    });

    drawGoal(context, project, -halfLength, -1);
    drawGoal(context, project, halfLength, 1);
  }

  function drawGoal(context, project, goalX, dir) {
    const gw = 7.32 / 2; // half goal width (along y)
    const gh = 2.44; // goal height (along z)
    const backX = goalX + 2 * dir; // net depth, extending off the pitch

    const frontBar = {
      strokeStyle: "rgba(248, 251, 242, 0.94)",
      lineWidth: clamp(project.scale * 0.05, 1.4, 3),
    };
    const backBar = {
      strokeStyle: "rgba(238, 245, 230, 0.6)",
      lineWidth: clamp(project.scale * 0.033, 1, 2),
    };
    const net = { strokeStyle: "rgba(236, 244, 228, 0.18)", lineWidth: 0.7 };
    const seg = (a, b, style) => projectedPath(context, project, [a, b], style);

    // Net grid on the back plane.
    const cols = 6;
    const rows = 4;
    for (let i = 0; i <= cols; i += 1) {
      const y = -gw + (2 * gw * i) / cols;
      seg([backX, y, 0], [backX, y, gh], net);
    }
    for (let j = 0; j <= rows; j += 1) {
      const z = (gh * j) / rows;
      seg([backX, -gw, z], [backX, gw, z], net);
    }
    // Net on the roof and the two sides.
    for (let i = 1; i < cols; i += 1) {
      const y = -gw + (2 * gw * i) / cols;
      seg([goalX, y, gh], [backX, y, gh], net);
    }
    [-gw, gw].forEach((y) => {
      for (let j = 1; j < rows; j += 1) {
        const z = (gh * j) / rows;
        seg([goalX, y, z], [backX, y, z], net);
      }
    });

    // Back frame + connectors.
    seg([backX, -gw, 0], [backX, -gw, gh], backBar);
    seg([backX, gw, 0], [backX, gw, gh], backBar);
    seg([backX, -gw, gh], [backX, gw, gh], backBar);
    seg([backX, -gw, 0], [backX, gw, 0], backBar);
    seg([goalX, -gw, gh], [backX, -gw, gh], backBar);
    seg([goalX, gw, gh], [backX, gw, gh], backBar);
    seg([goalX, -gw, 0], [backX, -gw, 0], backBar);
    seg([goalX, gw, 0], [backX, gw, 0], backBar);

    // Front frame: two posts + crossbar (crisp, drawn last).
    seg([goalX, -gw, 0], [goalX, -gw, gh], frontBar);
    seg([goalX, gw, 0], [goalX, gw, gh], frontBar);
    seg([goalX, -gw, gh], [goalX, gw, gh], frontBar);
  }

  function drawBall(context, project, ball) {
    if (!ball) return;
    const point = project(ball);
    const radius = clamp(project.scale * 0.13, 3.5, 6.5);

    context.save();
    context.translate(point[0], point[1]);

    // Base sphere in the muted (tinted) football tones from the 3D visualizer.
    const base = context.createRadialGradient(
      -radius * 0.3,
      -radius * 0.38,
      radius * 0.12,
      0,
      0,
      radius,
    );
    base.addColorStop(0, "#f2e7ad");
    base.addColorStop(0.6, "#cdb44c");
    base.addColorStop(1, "#87721f");
    context.fillStyle = base;
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fill();

    // Classic soccer-ball pentagon pattern, clipped to the sphere.
    context.save();
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.clip();

    const pentagon = (px, py, r, rotation) => {
      context.beginPath();
      for (let k = 0; k < 5; k += 1) {
        const angle = rotation + (k * Math.PI * 2) / 5;
        const x = px + Math.cos(angle) * r;
        const y = py + Math.sin(angle) * r;
        if (k === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.fill();
    };

    context.fillStyle = "#241f0f";
    pentagon(0, 0, radius * 0.4, -Math.PI / 2);
    for (let k = 0; k < 5; k += 1) {
      const angle = -Math.PI / 2 + Math.PI / 5 + (k * Math.PI * 2) / 5;
      const distance = radius * 0.94;
      pentagon(
        Math.cos(angle) * distance,
        Math.sin(angle) * distance,
        radius * 0.34,
        angle + Math.PI / 2,
      );
    }
    context.restore();

    // Spherical shading: highlight upper-left, shadow lower-right.
    const shade = context.createRadialGradient(
      -radius * 0.32,
      -radius * 0.36,
      radius * 0.1,
      0,
      0,
      radius * 1.05,
    );
    shade.addColorStop(0, "rgba(255, 255, 255, 0.32)");
    shade.addColorStop(0.5, "rgba(255, 255, 255, 0)");
    shade.addColorStop(1, "rgba(18, 13, 0, 0.42)");
    context.fillStyle = shade;
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fill();

    context.lineWidth = 1;
    context.strokeStyle = "rgba(45, 36, 10, 0.85)";
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  function drawPlayerLabel(context, point, playerNumber) {
    const text = `Player ${playerNumber}`;
    context.save();
    context.font = "700 9px Inter, ui-sans-serif, sans-serif";
    const width = context.measureText(text).width + 14;
    const x = point[0] - width / 2;
    const y = point[1] - 29;
    roundedRectangle(context, x, y, width, 19, 8);
    context.fillStyle = "rgba(4, 26, 21, 0.82)";
    context.fill();
    context.fillStyle = "rgba(235, 248, 236, 0.92)";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, point[0], y + 10);
    context.restore();
  }

  function drawMiniMap(context, width, caseData, frameIndex, geometry) {
    const pitch = caseData.pitch || data.pitch;
    const mapWidth = Math.min(142, width * 0.4);
    const innerWidth = mapWidth - 16;
    const innerHeight = innerWidth * (pitch.width / pitch.length);
    const mapHeight = innerHeight + 16;
    const x = width - mapWidth - 12;
    const y = 12;
    const fieldX = x + 8;
    const fieldY = y + 8;
    const halfLength = pitch.length / 2;
    const halfWidth = pitch.width / 2;
    const pelvis = jointIndex.pelvis;

    const mapPoint = (point) => [
      fieldX + ((point[0] + halfLength) / pitch.length) * innerWidth,
      fieldY + ((point[1] + halfWidth) / pitch.width) * innerHeight,
    ];

    context.save();
    roundedRectangle(context, x, y, mapWidth, mapHeight, 10);
    context.fillStyle = "rgba(3, 24, 19, 0.78)";
    context.fill();
    context.strokeStyle = "rgba(255, 255, 255, 0.12)";
    context.lineWidth = 1;
    context.stroke();

    context.fillStyle = "rgba(44, 124, 79, 0.86)";
    context.fillRect(fieldX, fieldY, innerWidth, innerHeight);
    context.strokeStyle = "rgba(240, 247, 225, 0.65)";
    context.lineWidth = 0.8;
    context.strokeRect(fieldX, fieldY, innerWidth, innerHeight);
    // Full pitch markings (halfway line, center circle/spot, penalty & goal areas,
    // penalty spots and arcs) mirroring a regulation pitch.
    const mx = (v) => fieldX + ((v + halfLength) / pitch.length) * innerWidth;
    const my = (v) => fieldY + ((v + halfWidth) / pitch.width) * innerHeight;
    const metreToPixel = innerWidth / pitch.length;

    context.beginPath();
    context.moveTo(mx(0), my(-halfWidth));
    context.lineTo(mx(0), my(halfWidth));
    context.stroke();

    context.beginPath();
    context.ellipse(mx(0), my(0), 9.15 * metreToPixel, 9.15 * metreToPixel, 0, 0, Math.PI * 2);
    context.stroke();

    const spotFill = "rgba(240, 247, 225, 0.8)";
    const dot = (worldX) => {
      context.beginPath();
      context.arc(mx(worldX), my(0), 0.9, 0, Math.PI * 2);
      context.fillStyle = spotFill;
      context.fill();
    };
    dot(0);

    const penaltyArc = Math.acos((16.5 - 11) / 9.15);
    [-1, 1].forEach((side) => {
      const goalLine = side * halfLength;
      const rect = (depth, halfSpan) => {
        const inner = goalLine - side * depth;
        context.strokeRect(
          Math.min(mx(goalLine), mx(inner)),
          my(-halfSpan),
          Math.abs(mx(inner) - mx(goalLine)),
          my(halfSpan) - my(-halfSpan),
        );
      };
      rect(16.5, 20.16); // penalty area
      rect(5.5, 9.16); // goal area

      const spotX = goalLine - side * 11;
      dot(spotX);
      context.beginPath();
      if (side < 0) {
        context.arc(mx(spotX), my(0), 9.15 * metreToPixel, -penaltyArc, penaltyArc);
      } else {
        context.arc(mx(spotX), my(0), 9.15 * metreToPixel, Math.PI - penaltyArc, Math.PI + penaltyArc);
      }
      context.stroke();
    });

    const viewportA = mapPoint([
      clamp(geometry.minimumX, -halfLength, halfLength),
      clamp(geometry.minimumY, -halfWidth, halfWidth),
    ]);
    const viewportB = mapPoint([
      clamp(geometry.maximumX, -halfLength, halfLength),
      clamp(geometry.maximumY, -halfWidth, halfWidth),
    ]);
    context.save();
    context.setLineDash([3, 2]);
    context.strokeStyle = "rgba(200, 240, 109, 0.65)";
    context.lineWidth = 1;
    context.strokeRect(
      Math.min(viewportA[0], viewportB[0]),
      Math.min(viewportA[1], viewportB[1]),
      Math.max(2, Math.abs(viewportB[0] - viewportA[0])),
      Math.max(2, Math.abs(viewportB[1] - viewportA[1])),
    );
    context.restore();

    const playerPoint = mapPoint(caseData.frames[frameIndex].joints[pelvis]);
    const ballPoint = caseData.frames[frameIndex].ball
      ? mapPoint(caseData.frames[frameIndex].ball)
      : null;
    context.fillStyle = palette.mint;
    context.beginPath();
    context.arc(playerPoint[0], playerPoint[1], 3, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(4, 25, 20, 0.9)";
    context.lineWidth = 1;
    context.stroke();

    if (ballPoint) {
      context.fillStyle = palette.amber;
      context.beginPath();
      context.arc(ballPoint[0], ballPoint[1], 2.5, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawContextCanvas(caseData, framePosition) {
    const { context, width, height } = prepareCanvas(elements.contextCanvas);
    const geometry = buildContextGeometry(caseData);
    const project = createWorldProjector(width, height, geometry);
    const current = sampleFrame(caseData, framePosition);
    const frameIndex = clamp(Math.floor(framePosition), 0, caseData.frames.length - 1);
    const pelvis = jointIndex.pelvis;

    drawPitch(context, width, height, project, caseData);

    const pelvisGround = current.joints[pelvis];
    projectedGroundCircle(context, project, [pelvisGround[0], pelvisGround[1], 0.03], 0.72, {
      strokeStyle: "rgba(200, 240, 109, 0.78)",
      lineWidth: 1.5,
    });

    drawSkeleton(context, current.joints, project, {
      lineWidth: clamp(project.scale * 0.14, 1.6, 3),
      jointRadius: clamp(project.scale * 0.07, 1.1, 2.1),
      glow: 4,
    });
    drawBall(context, project, current.ball);

    const nose = project(current.joints[jointIndex.nose]);
    drawPlayerLabel(context, nose, state.caseIndex + 1);
    drawMiniMap(context, width, caseData, frameIndex, geometry);
  }

  function draw() {
    const caseData = currentCase();
    drawPoseCanvas(caseData, state.frame);
    drawContextCanvas(caseData, state.frame);
    updatePlaybackUi();
    state.needsDraw = false;
  }

  function animate(timestamp) {
    const elapsed = Math.min((timestamp - state.lastTimestamp) / 1000, 0.1);
    state.lastTimestamp = timestamp;

    if (state.playing) {
      const frameCount = currentCase().frames.length;
      state.frame += elapsed * data.fps * state.speed;
      if (state.frame >= frameCount) state.frame %= frameCount;
      state.needsDraw = true;
    }

    if (state.needsDraw) draw();
    requestAnimationFrame(animate);
  }

  elements.previousCase.addEventListener("click", () => selectCase(state.caseIndex - 1));
  elements.nextCase.addEventListener("click", () => selectCase(state.caseIndex + 1));
  elements.playButton.addEventListener("click", togglePlayback);
  elements.replayButton.addEventListener("click", () => {
    state.frame = 0;
    state.playing = true;
    state.lastTimestamp = performance.now();
    state.needsDraw = true;
    updatePlayButton();
  });
  elements.timeline.addEventListener("input", (event) => {
    state.frame = Number(event.target.value);
    state.lastTimestamp = performance.now();
    state.needsDraw = true;
    updatePlaybackUi();
  });
  elements.speedButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.speed = Number(button.dataset.speed);
      elements.speedButtons.forEach((candidate) => {
        candidate.classList.toggle("is-active", candidate === button);
      });
    });
  });

  document.addEventListener("visibilitychange", () => {
    state.lastTimestamp = performance.now();
  });

  const resizeObserver = new ResizeObserver(() => {
    state.needsDraw = true;
  });
  resizeObserver.observe(elements.poseCanvas);
  resizeObserver.observe(elements.contextCanvas);

  createTabs();
  updateCaseContent();
  updatePlayButton();
  updatePlaybackUi();
  requestAnimationFrame(animate);
})();

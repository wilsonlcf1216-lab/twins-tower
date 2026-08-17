const SOURCE_HTML_PATH = "../index.html";

const SOURCE_BUILDINGS = [
  { index: 1, code: "CSB", label: "CSB", fullName: "Clinical Sciences Building", theme: "#4f46e5" },
  { index: 2, code: "HKLM", label: "HKLM", fullName: "Old Block - HKLM Wing", theme: "#0f766e" },
  { index: 3, code: "EF", label: "EF", fullName: "Old Block - EF Wing", theme: "#ea580c" },
];

const TARGET_BUILDING = {
  code: "IPEB",
  label: "IPEB",
  fullName: "In-patient Extension Block",
  theme: "#2563eb",
};

const FLOOR_ALIASES = {
  "B02": -2,
  "B01": -1,
  "G/F": 0,
  "0": 0,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  "11": 11,
  "12": 12,
  "13": 13,
  "14": 14,
  "15": 15,
  "16": 16,
  "17": 17,
  "18": 18,
  "19": 19,
};

const DOM = {
  sourceBuilding: document.getElementById("sourceBuilding"),
  sourceFloor: document.getElementById("sourceFloor"),
  sourceSpace: document.getElementById("sourceSpace"),
  targetFloor: document.getElementById("targetFloor"),
  targetSpace: document.getElementById("targetSpace"),
  routeSteps: document.getElementById("routeSteps"),
  sourceFloorPlan: document.getElementById("sourceFloorPlan"),
  sourceElevation: document.getElementById("sourceElevation"),
  bridgePlan: document.getElementById("bridgePlan"),
  targetElevation: document.getElementById("targetElevation"),
  targetFloorPlan: document.getElementById("targetFloorPlan"),
  summaryStart: document.getElementById("summaryStart"),
  summaryStartMeta: document.getElementById("summaryStartMeta"),
  summaryEnd: document.getElementById("summaryEnd"),
  summaryEndMeta: document.getElementById("summaryEndMeta"),
  dataStatus: document.getElementById("dataStatus"),
};

const state = {
  data: null,
  selection: {
    sourceBuildingIndex: 1,
    sourceFloor: "",
    sourceSpaceKey: "",
    targetFloor: "",
    targetSpaceKey: "",
  },
};

boot().catch((error) => {
  console.error(error);
  DOM.dataStatus.textContent = `Failed to load source data: ${error.message}`;
  [
    DOM.sourceFloorPlan,
    DOM.sourceElevation,
    DOM.bridgePlan,
    DOM.targetElevation,
    DOM.targetFloorPlan,
  ].forEach((panel) => {
    panel.innerHTML = `<div class="error-state">未能讀取現有 GitHub prototype 內的 source data。<br>${escapeHtml(error.message)}</div>`;
  });
});

async function boot() {
  const raw = await loadSourceHtml();
  const leftBuildings = extractConst(raw, "leftBuildingsData");
  const rightTower = extractConst(raw, "rightTowerData");

  state.data = buildDataset(leftBuildings, rightTower);
  initializeSelectors();
  bindEvents();
  applyDefaults();
  render();
  DOM.dataStatus.textContent = "Source data loaded from existing `/workspace/index.html` without modifying original content.";
}

async function loadSourceHtml() {
  const response = await fetch(SOURCE_HTML_PATH, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while loading ${SOURCE_HTML_PATH}`);
  }
  return response.text();
}

function extractConst(content, constName) {
  const marker = `const ${constName} =`;
  const start = content.indexOf(marker);
  if (start === -1) {
    throw new Error(`Cannot find ${constName} in source html`);
  }

  let index = start + marker.length;
  while (index < content.length && /\s/.test(content[index])) index += 1;

  const opening = content[index];
  const closing = opening === "[" ? "]" : opening === "{" ? "}" : null;
  if (!closing) {
    throw new Error(`Unsupported constant format for ${constName}`);
  }

  let depth = 0;
  let inString = false;
  let stringQuote = "";
  let escaped = false;
  let end = -1;

  for (let i = index; i < content.length; i += 1) {
    const ch = content[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === stringQuote) {
        inString = false;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      inString = true;
      stringQuote = ch;
      continue;
    }

    if (ch === opening) depth += 1;
    if (ch === closing) {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end === -1) {
    throw new Error(`Cannot parse ${constName}`);
  }

  const expression = content.slice(index, end);
  return Function(`"use strict"; return (${expression});`)();
}

function buildDataset(leftBuildings, rightTower) {
  const sourceBuildings = SOURCE_BUILDINGS.map((item) => {
    const source = leftBuildings[item.index];
    if (!source) {
      throw new Error(`Missing building index ${item.index}`);
    }
    return {
      ...item,
      rawName: source.name,
      floors: normalizeFloors(source.floors),
    };
  });

  const targetBuilding = {
    ...TARGET_BUILDING,
    floors: normalizeFloors(rightTower, { isRightTower: true }),
  };

  return { sourceBuildings, targetBuilding };
}

function normalizeFloors(floors, options = {}) {
  const entries = Object.entries(floors || {})
    .filter(([, value]) => value && ((Array.isArray(value) && value.length) || typeof value === "object"))
    .map(([floorKey, value]) => ({
      floorKey: String(floorKey),
      floorSort: getFloorSortValue(floorKey),
      spaces: normalizeSpaces(value, String(floorKey), options),
    }))
    .filter((entry) => entry.spaces.length > 0)
    .sort((a, b) => b.floorSort - a.floorSort);

  return entries;
}

function normalizeSpaces(value, floorKey, options = {}) {
  if (Array.isArray(value)) {
    return value.map((space, index) => normalizeSpace(space, floorKey, index, { wing: "", options }));
  }

  const orderedWings = ["upper", "lower", "nwing", "sewing", "swwing"];
  const keys = Object.keys(value).sort((a, b) => orderedWings.indexOf(a) - orderedWings.indexOf(b));
  const spaces = [];
  let sequence = 0;

  keys.forEach((wing) => {
    const wingSpaces = Array.isArray(value[wing]) ? value[wing] : [];
    wingSpaces.forEach((space, index) => {
      spaces.push(normalizeSpace(space, floorKey, sequence, { wing, localIndex: index, options }));
      sequence += 1;
    });
  });

  return spaces;
}

function normalizeSpace(space, floorKey, index, context) {
  const wing = context.wing || "";
  const localIndex = Number.isFinite(context.localIndex) ? context.localIndex : index;
  const name = (space && space.name ? String(space.name) : `Space ${index + 1}`).trim();
  const label = normalizeLabel(name);
  const width = parseWidthClass(space && space.widthClass);
  return {
    key: `${floorKey}-${wing}-${localIndex}-${slugify(name)}`,
    name,
    label,
    width,
    wing,
    floorKey,
    index,
    localIndex,
    multiline: Boolean(space && space.multiline),
  };
}

function parseWidthClass(widthClass) {
  const match = String(widthClass || "").match(/(\d+)/);
  return match ? Number(match[1]) : 80;
}

function getFloorSortValue(floorKey) {
  return FLOOR_ALIASES[floorKey] ?? Number.parseInt(floorKey, 10) ?? 0;
}

function normalizeLabel(name) {
  return name
    .replace(/\s+/g, " ")
    .replace(/\(\/F\)/g, "")
    .trim();
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function initializeSelectors() {
  DOM.sourceBuilding.innerHTML = state.data.sourceBuildings
    .map((building) => `<option value="${building.index}">${building.label} - ${escapeHtml(building.fullName)}</option>`)
    .join("");
}

function bindEvents() {
  DOM.sourceBuilding.addEventListener("change", () => {
    state.selection.sourceBuildingIndex = Number(DOM.sourceBuilding.value);
    repopulateSourceFloors();
    render();
  });

  DOM.sourceFloor.addEventListener("change", () => {
    state.selection.sourceFloor = DOM.sourceFloor.value;
    repopulateSourceSpaces();
    render();
  });

  DOM.sourceSpace.addEventListener("change", () => {
    state.selection.sourceSpaceKey = DOM.sourceSpace.value;
    render();
  });

  DOM.targetFloor.addEventListener("change", () => {
    state.selection.targetFloor = DOM.targetFloor.value;
    repopulateTargetSpaces();
    render();
  });

  DOM.targetSpace.addEventListener("change", () => {
    state.selection.targetSpaceKey = DOM.targetSpace.value;
    render();
  });
}

function applyDefaults() {
  DOM.sourceBuilding.value = String(state.selection.sourceBuildingIndex);
  repopulateSourceFloors();

  const targetDefaultFloor = state.data.targetBuilding.floors.find((floor) => floor.floorKey === "8") || state.data.targetBuilding.floors[0];
  state.selection.targetFloor = targetDefaultFloor.floorKey;
  repopulateTargetFloors();
  repopulateTargetSpaces();
}

function repopulateSourceFloors() {
  const building = getCurrentSourceBuilding();
  DOM.sourceFloor.innerHTML = building.floors
    .map((floor) => `<option value="${floor.floorKey}">${formatFloorLabel(floor.floorKey)}</option>`)
    .join("");

  const hasCurrent = building.floors.some((floor) => floor.floorKey === state.selection.sourceFloor);
  state.selection.sourceFloor = hasCurrent ? state.selection.sourceFloor : building.floors[0]?.floorKey || "";
  DOM.sourceFloor.value = state.selection.sourceFloor;
  repopulateSourceSpaces();
}

function repopulateSourceSpaces() {
  const floor = getCurrentSourceFloor();
  DOM.sourceSpace.innerHTML = (floor?.spaces || [])
    .map((space) => `<option value="${space.key}">${escapeHtml(space.label)}</option>`)
    .join("");

  const hasCurrent = floor?.spaces.some((space) => space.key === state.selection.sourceSpaceKey);
  state.selection.sourceSpaceKey = hasCurrent ? state.selection.sourceSpaceKey : floor?.spaces[0]?.key || "";
  DOM.sourceSpace.value = state.selection.sourceSpaceKey;
}

function repopulateTargetFloors() {
  DOM.targetFloor.innerHTML = state.data.targetBuilding.floors
    .map((floor) => `<option value="${floor.floorKey}">${formatFloorLabel(floor.floorKey)}</option>`)
    .join("");
  DOM.targetFloor.value = state.selection.targetFloor;
}

function repopulateTargetSpaces() {
  repopulateTargetFloors();
  const floor = getCurrentTargetFloor();
  DOM.targetSpace.innerHTML = (floor?.spaces || [])
    .map((space) => `<option value="${space.key}">${escapeHtml(space.label)}</option>`)
    .join("");

  const hasCurrent = floor?.spaces.some((space) => space.key === state.selection.targetSpaceKey);
  state.selection.targetSpaceKey = hasCurrent ? state.selection.targetSpaceKey : floor?.spaces[0]?.key || "";
  DOM.targetSpace.value = state.selection.targetSpaceKey;
}

function getCurrentSourceBuilding() {
  return state.data.sourceBuildings.find((building) => building.index === state.selection.sourceBuildingIndex) || state.data.sourceBuildings[0];
}

function getCurrentSourceFloor() {
  return getCurrentSourceBuilding().floors.find((floor) => floor.floorKey === state.selection.sourceFloor) || getCurrentSourceBuilding().floors[0];
}

function getCurrentSourceSpace() {
  return getCurrentSourceFloor()?.spaces.find((space) => space.key === state.selection.sourceSpaceKey) || getCurrentSourceFloor()?.spaces[0];
}

function getCurrentTargetFloor() {
  return state.data.targetBuilding.floors.find((floor) => floor.floorKey === state.selection.targetFloor) || state.data.targetBuilding.floors[0];
}

function getCurrentTargetSpace() {
  return getCurrentTargetFloor()?.spaces.find((space) => space.key === state.selection.targetSpaceKey) || getCurrentTargetFloor()?.spaces[0];
}

function render() {
  const sourceBuilding = getCurrentSourceBuilding();
  const sourceFloor = getCurrentSourceFloor();
  const sourceSpace = getCurrentSourceSpace();
  const targetFloor = getCurrentTargetFloor();
  const targetSpace = getCurrentTargetSpace();

  if (!sourceBuilding || !sourceFloor || !sourceSpace || !targetFloor || !targetSpace) {
    return;
  }

  DOM.summaryStart.textContent = `${sourceBuilding.label} ${formatFloorLabel(sourceFloor.floorKey)}`;
  DOM.summaryStartMeta.textContent = `${sourceSpace.label} -> Lift Lobby`;
  DOM.summaryEnd.textContent = `${TARGET_BUILDING.label} ${formatFloorLabel(targetFloor.floorKey)}`;
  DOM.summaryEndMeta.textContent = `Lift Lobby -> ${targetSpace.label}`;

  renderRouteSteps(sourceBuilding, sourceFloor, sourceSpace, targetFloor, targetSpace);
  renderFloorPlan({
    mount: DOM.sourceFloorPlan,
    title: `${sourceBuilding.label} ${formatFloorLabel(sourceFloor.floorKey)}`,
    subtitle: `${sourceSpace.label} 行去 Lift Lobby`,
    floor: sourceFloor,
    selectedKey: sourceSpace.key,
    lobbies: [{ id: "lift", label: "Lift Lobby", side: "end" }],
    routeMode: "to-lift",
    accent: sourceBuilding.theme,
  });

  renderElevation({
    mount: DOM.sourceElevation,
    title: sourceBuilding.fullName,
    subtitle: `由 ${formatFloorLabel(sourceFloor.floorKey)} 去 2/F`,
    floors: sourceBuilding.floors,
    activeFloor: sourceFloor.floorKey,
    transferFloor: "2",
    accent: sourceBuilding.theme,
    direction: "down",
  });

  renderBridge({
    mount: DOM.bridgePlan,
    sourceBuilding,
    sourceFloor,
    targetFloor,
  });

  renderElevation({
    mount: DOM.targetElevation,
    title: TARGET_BUILDING.fullName,
    subtitle: "由 2/F 去目的樓層",
    floors: state.data.targetBuilding.floors,
    activeFloor: targetFloor.floorKey,
    transferFloor: "2",
    accent: TARGET_BUILDING.theme,
    direction: "up",
  });

  renderFloorPlan({
    mount: DOM.targetFloorPlan,
    title: `${TARGET_BUILDING.label} ${formatFloorLabel(targetFloor.floorKey)}`,
    subtitle: `Lift Lobby 行去 ${targetSpace.label}`,
    floor: targetFloor,
    selectedKey: targetSpace.key,
    lobbies: [{ id: "lift", label: "Lift Lobby", side: "start" }],
    routeMode: "from-lift",
    accent: TARGET_BUILDING.theme,
  });
}

function renderRouteSteps(sourceBuilding, sourceFloor, sourceSpace, targetFloor, targetSpace) {
  const steps = [
    `於 ${sourceBuilding.label} ${formatFloorLabel(sourceFloor.floorKey)} 進入 ${sourceSpace.label} 所在 floor plan。`,
    `跟住路徑由 ${sourceSpace.label} 行去同層 Lift Lobby。`,
    `喺 ${sourceBuilding.label} 乘 lift 去 2/F transfer level。`,
    `經 2/F link bridge 由 ${sourceBuilding.label} 過橋進入 IPEB。`,
    `喺 IPEB Lift Lobby 乘 lift 到 ${formatFloorLabel(targetFloor.floorKey)}，再行去 ${targetSpace.label}。`,
  ];

  DOM.routeSteps.innerHTML = steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");
}

function renderFloorPlan({ mount, title, subtitle, floor, selectedKey, lobbies, routeMode, accent }) {
  const width = 920;
  const height = 300;
  const margin = 30;
  const top = 76;
  const planHeight = 150;
  const routeY = top + planHeight / 2;
  const spaces = floor.spaces;
  const totalUnits = spaces.reduce((sum, space) => sum + Math.max(space.width, 36), 0);
  const usableWidth = width - margin * 2;

  let cursor = margin;
  const segments = spaces.map((space) => {
    const w = (Math.max(space.width, 36) / totalUnits) * usableWidth;
    const segment = { ...space, x: cursor, y: top, w, h: planHeight };
    cursor += w;
    return segment;
  });

  const selected = segments.find((space) => space.key === selectedKey) || segments[0];
  const lobbyX = routeMode === "to-lift" ? width - margin - 40 : margin + 40;
  const routeStartX = routeMode === "to-lift" ? selected.x + selected.w / 2 : lobbyX;
  const routeEndX = routeMode === "to-lift" ? lobbyX : selected.x + selected.w / 2;

  const lobbyMarkup = lobbies.map((lobby) => {
    const x = lobby.side === "start" ? margin : width - margin - 80;
    return `
      <rect x="${x}" y="${top + 20}" width="80" height="${planHeight - 40}" rx="18" fill="rgba(37,99,235,0.12)" stroke="${TARGET_BUILDING.theme}" stroke-width="2" stroke-dasharray="6 6"></rect>
      <text x="${x + 40}" y="${routeY - 8}" text-anchor="middle" font-size="13" font-weight="700" fill="#1d4ed8">${escapeHtml(lobby.label)}</text>
      <text x="${x + 40}" y="${routeY + 12}" text-anchor="middle" font-size="12" fill="#475569">${routeMode === "to-lift" ? "vertical transfer" : "arrival point"}</text>
    `;
  }).join("");

  const spacesMarkup = segments.map((space) => {
    const isSelected = space.key === selected.key;
    const fill = isSelected ? hexToRgba(accent, 0.18) : "rgba(255,255,255,0.9)";
    const stroke = isSelected ? accent : "rgba(148,163,184,0.55)";
    return `
      <rect x="${space.x}" y="${space.y}" width="${space.w}" height="${space.h}" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="${isSelected ? 3 : 1.5}"></rect>
      <text x="${space.x + space.w / 2}" y="${space.y + 48}" text-anchor="middle" font-size="14" font-weight="${isSelected ? 800 : 700}" fill="#0f172a">${escapeHtml(trimLabel(space.label, Math.max(14, Math.floor(space.w / 8))))}</text>
      <text x="${space.x + space.w / 2}" y="${space.y + 72}" text-anchor="middle" font-size="12" fill="#64748b">${space.wing ? escapeHtml(formatWingLabel(space.wing)) : "space"}</text>
    `;
  }).join("");

  mount.innerHTML = `
    <div class="svg-caption">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(subtitle)}</span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
      <rect x="0" y="0" width="${width}" height="${height}" rx="26" fill="url(#plan-bg)"></rect>
      <defs>
        <linearGradient id="plan-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffffff"></stop>
          <stop offset="100%" stop-color="#eff6ff"></stop>
        </linearGradient>
        <marker id="route-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="${accent}"></path>
        </marker>
      </defs>
      <text x="${margin}" y="38" font-size="14" font-weight="700" fill="#334155">Floor plan abstraction from existing GitHub content</text>
      ${lobbyMarkup}
      ${spacesMarkup}
      <path d="M ${routeStartX} ${routeY} C ${(routeStartX + routeEndX) / 2} ${routeY - 36}, ${(routeStartX + routeEndX) / 2} ${routeY + 36}, ${routeEndX} ${routeY}" fill="none" stroke="${accent}" stroke-width="6" stroke-linecap="round" marker-end="url(#route-arrow)"></path>
      <circle cx="${routeStartX}" cy="${routeY}" r="8" fill="${accent}"></circle>
      <circle cx="${routeEndX}" cy="${routeY}" r="8" fill="${accent}"></circle>
    </svg>
  `;
}

function renderElevation({ mount, title, subtitle, floors, activeFloor, transferFloor, accent, direction }) {
  const width = 500;
  const height = 560;
  const frameX = 120;
  const frameY = 30;
  const frameW = 240;
  const rowH = Math.max(24, Math.min(42, Math.floor((height - frameY * 2) / floors.length)));
  const sorted = floors.slice();
  const activeIndex = sorted.findIndex((floor) => floor.floorKey === activeFloor);
  const transferIndex = sorted.findIndex((floor) => floor.floorKey === transferFloor);

  const rows = sorted.map((floor, index) => {
    const y = frameY + index * rowH;
    const isActive = floor.floorKey === activeFloor;
    const isTransfer = floor.floorKey === transferFloor;
    return `
      <rect x="${frameX}" y="${y}" width="${frameW}" height="${rowH - 2}" rx="10" fill="${isActive ? hexToRgba(accent, 0.18) : isTransfer ? "rgba(20,184,166,0.14)" : "rgba(255,255,255,0.92)"}" stroke="${isActive ? accent : isTransfer ? "#0f766e" : "rgba(148,163,184,0.42)"}" stroke-width="${isActive || isTransfer ? 2.5 : 1.2}"></rect>
      <text x="${frameX - 18}" y="${y + rowH / 2 + 4}" text-anchor="end" font-size="13" font-weight="700" fill="#334155">${escapeHtml(formatFloorLabel(floor.floorKey))}</text>
      <text x="${frameX + 20}" y="${y + rowH / 2 + 4}" font-size="12" font-weight="${isActive ? 700 : 600}" fill="#1e293b">${escapeHtml(trimLabel(floor.spaces[0]?.label || "Building floor", 28))}</text>
    `;
  }).join("");

  const activeY = frameY + activeIndex * rowH + rowH / 2;
  const transferY = frameY + transferIndex * rowH + rowH / 2;
  const pathStartY = direction === "down" ? activeY : transferY;
  const pathEndY = direction === "down" ? transferY : activeY;

  mount.innerHTML = `
    <div class="svg-caption">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(subtitle)}</span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)} elevation">
      <defs>
        <marker id="elevation-arrow-${escapeHtml(direction)}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="${accent}"></path>
        </marker>
      </defs>
      <rect x="84" y="16" width="312" height="${height - 32}" rx="28" fill="rgba(255,255,255,0.86)" stroke="rgba(99,102,241,0.18)"></rect>
      <rect x="${frameX + frameW + 18}" y="${frameY}" width="52" height="${rowH * sorted.length - 2}" rx="18" fill="rgba(37,99,235,0.08)" stroke="rgba(37,99,235,0.18)"></rect>
      ${rows}
      <text x="${frameX + frameW + 44}" y="${frameY - 8}" text-anchor="middle" font-size="13" font-weight="700" fill="#1d4ed8">Lift</text>
      <path d="M ${frameX + frameW + 44} ${pathStartY} L ${frameX + frameW + 44} ${pathEndY}" fill="none" stroke="${accent}" stroke-width="8" stroke-linecap="round" marker-end="url(#elevation-arrow-${escapeHtml(direction)})"></path>
      <circle cx="${frameX + frameW + 44}" cy="${pathStartY}" r="8" fill="${accent}"></circle>
      <circle cx="${frameX + frameW + 44}" cy="${pathEndY}" r="8" fill="${accent}"></circle>
      <text x="${frameX + frameW + 44}" y="${height - 24}" text-anchor="middle" font-size="12" fill="#475569">${direction === "down" ? "down to transfer" : "up to destination"}</text>
    </svg>
  `;
}

function renderBridge({ mount, sourceBuilding, sourceFloor, targetFloor }) {
  const width = 1100;
  const height = 320;
  const leftX = 90;
  const rightX = 780;
  const towerY = 48;
  const towerW = 170;
  const towerH = 200;
  const bridgeY = 138;
  const bridgeX = leftX + towerW + 36;
  const bridgeW = rightX - bridgeX;

  mount.innerHTML = `
    <div class="svg-caption">
      <strong>2/F Link Bridge Transfer</strong>
      <span>${escapeHtml(sourceBuilding.label)} ${escapeHtml(formatFloorLabel(sourceFloor.floorKey))} -> 2/F -> Link Bridge -> IPEB ${escapeHtml(formatFloorLabel(targetFloor.floorKey))}</span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Link bridge transfer plan">
      <defs>
        <marker id="bridge-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb"></path>
        </marker>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" rx="28" fill="url(#bridge-bg)"></rect>
      <defs>
        <linearGradient id="bridge-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffffff"></stop>
          <stop offset="100%" stop-color="#eef6ff"></stop>
        </linearGradient>
      </defs>
      <rect x="${leftX}" y="${towerY}" width="${towerW}" height="${towerH}" rx="26" fill="${hexToRgba(sourceBuilding.theme, 0.14)}" stroke="${sourceBuilding.theme}" stroke-width="3"></rect>
      <text x="${leftX + towerW / 2}" y="${towerY + 56}" text-anchor="middle" font-size="26" font-weight="800" fill="#0f172a">${escapeHtml(sourceBuilding.label)}</text>
      <text x="${leftX + towerW / 2}" y="${towerY + 86}" text-anchor="middle" font-size="14" fill="#475569">Go to 2/F Lift Lobby</text>
      <text x="${leftX + towerW / 2}" y="${towerY + 148}" text-anchor="middle" font-size="38" font-weight="800" fill="${sourceBuilding.theme}">2/F</text>

      <rect x="${bridgeX}" y="${bridgeY}" width="${bridgeW}" height="42" rx="20" fill="rgba(37,99,235,0.12)" stroke="#2563eb" stroke-width="3" stroke-dasharray="12 8"></rect>
      <text x="${bridgeX + bridgeW / 2}" y="${bridgeY + 27}" text-anchor="middle" font-size="16" font-weight="800" fill="#1d4ed8">Link Bridge Corridor</text>

      <rect x="${rightX}" y="${towerY}" width="${towerW}" height="${towerH}" rx="26" fill="rgba(37,99,235,0.12)" stroke="#2563eb" stroke-width="3"></rect>
      <text x="${rightX + towerW / 2}" y="${towerY + 56}" text-anchor="middle" font-size="26" font-weight="800" fill="#0f172a">IPEB</text>
      <text x="${rightX + towerW / 2}" y="${towerY + 86}" text-anchor="middle" font-size="14" fill="#475569">Arrive at 2/F Lift Lobby</text>
      <text x="${rightX + towerW / 2}" y="${towerY + 148}" text-anchor="middle" font-size="38" font-weight="800" fill="#2563eb">2/F</text>

      <path d="M ${leftX + towerW - 6} ${bridgeY + 21} L ${rightX + 8} ${bridgeY + 21}" fill="none" stroke="#2563eb" stroke-width="8" stroke-linecap="round" marker-end="url(#bridge-arrow)"></path>
      <circle cx="${leftX + towerW - 6}" cy="${bridgeY + 21}" r="8" fill="${sourceBuilding.theme}"></circle>
      <circle cx="${rightX + 8}" cy="${bridgeY + 21}" r="8" fill="#2563eb"></circle>
    </svg>
  `;
}

function formatFloorLabel(floorKey) {
  if (floorKey === "B01") return "B1/F";
  if (floorKey === "B02") return "B2/F";
  return `${floorKey}/F`;
}

function formatWingLabel(wing) {
  const map = {
    upper: "upper band",
    lower: "lower band",
    nwing: "north wing",
    sewing: "south-east wing",
    swwing: "south-west wing",
  };
  return map[wing] || wing;
}

function trimLabel(label, max) {
  if (label.length <= max) return label;
  return `${label.slice(0, Math.max(0, max - 1))}…`;
}

function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((part) => part + part).join("")
    : normalized;
  const bigint = Number.parseInt(value, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

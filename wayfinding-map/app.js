import * as THREE from "https://unpkg.com/three@0.166.1/build/three.module.js";

const SOURCE_HTML_PATH = "../index.html";
const FLOOR_HEIGHT = 5.6;
const FLOOR_THICKNESS = 1.5;
const ROUTE_DURATION_MS = 10500;

const SOURCE_BUILDINGS = [
  { index: 1, code: "CSB", label: "CSB", fullName: "Clinical Sciences Building", theme: "#8b5cf6" },
  { index: 2, code: "HKLM", label: "HKLM", fullName: "Old Block - HKLM Wing", theme: "#14b8a6" },
  { index: 3, code: "EF", label: "EF", fullName: "Old Block - EF Wing", theme: "#f97316" },
];

const TARGET_BUILDING = {
  code: "IPEB",
  label: "IPEB",
  fullName: "In-patient Extension Block",
  theme: "#38bdf8",
};

const FLOOR_ALIASES = {
  B02: -2,
  B01: -1,
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

const BUILDING_LAYOUT = {
  CSB: { position: new THREE.Vector3(-122, 0, -88), footprint: { x: 76, z: 48 }, color: "#8b5cf6" },
  HKLM: { position: new THREE.Vector3(-120, 0, 0), footprint: { x: 84, z: 56 }, color: "#14b8a6" },
  EF: { position: new THREE.Vector3(-122, 0, 88), footprint: { x: 66, z: 42 }, color: "#f97316" },
  IPEB: { position: new THREE.Vector3(138, 0, 0), footprint: { x: 120, z: 88 }, color: "#38bdf8" },
};

const DOM = {
  sourceBuilding: document.getElementById("sourceBuilding"),
  sourceFloor: document.getElementById("sourceFloor"),
  sourceSpace: document.getElementById("sourceSpace"),
  targetFloor: document.getElementById("targetFloor"),
  targetSpace: document.getElementById("targetSpace"),
  replayRoute: document.getElementById("replayRoute"),
  toggleCamera: document.getElementById("toggleCamera"),
  routeSteps: document.getElementById("routeSteps"),
  summaryStart: document.getElementById("summaryStart"),
  summaryStartMeta: document.getElementById("summaryStartMeta"),
  summaryEnd: document.getElementById("summaryEnd"),
  summaryEndMeta: document.getElementById("summaryEndMeta"),
  sceneTitle: document.getElementById("sceneTitle"),
  sceneSubtitle: document.getElementById("sceneSubtitle"),
  sceneMode: document.getElementById("sceneMode"),
  routeProgress: document.getElementById("routeProgress"),
  dataStatus: document.getElementById("dataStatus"),
  sceneViewport: document.getElementById("sceneViewport"),
  sceneCanvas: document.getElementById("sceneCanvas"),
  buildingLabels: document.getElementById("buildingLabels"),
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
  cameraMode: "follow",
  routeProgress: 0,
  isPlaying: true,
  lastTimestamp: 0,
  routeStartTime: 0,
  scene: null,
};

boot().catch((error) => {
  console.error(error);
  DOM.dataStatus.textContent = "Load Failed";
  DOM.sceneViewport.innerHTML = `<div class="error-state">未能載入 3D 場景。<br>${escapeHtml(error.message)}</div>`;
});

async function boot() {
  const raw = await loadSourceHtml();
  const leftBuildings = extractConst(raw, "leftBuildingsData");
  const rightTower = extractConst(raw, "rightTowerData");

  state.data = buildDataset(leftBuildings, rightTower);
  try {
    initScene();
  } catch (error) {
    console.warn("WebGL unavailable, using SVG fallback.", error);
    initFallbackScene();
  }
  initializeSelectors();
  bindEvents();
  applyDefaults();
  DOM.dataStatus.textContent = state.scene.mode === "webgl" ? "Loaded from original index.html" : "Loaded with SVG 3D fallback";
  DOM.sceneTitle.textContent = "4 棟 Building Overview";
  renderRoute();
  requestAnimationFrame(animate);
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
    if (!source) throw new Error(`Missing building index ${item.index}`);
    return {
      ...item,
      floors: normalizeFloors(source.floors),
    };
  });

  return {
    sourceBuildings,
    targetBuilding: {
      ...TARGET_BUILDING,
      floors: normalizeFloors(rightTower),
    },
  };
}

function normalizeFloors(floors) {
  return Object.entries(floors || {})
    .filter(([, value]) => value && ((Array.isArray(value) && value.length) || typeof value === "object"))
    .map(([floorKey, value]) => ({
      floorKey: String(floorKey),
      floorSort: getFloorSortValue(floorKey),
      spaces: normalizeSpaces(value, String(floorKey)),
    }))
    .filter((entry) => entry.spaces.length > 0)
    .sort((a, b) => b.floorSort - a.floorSort);
}

function normalizeSpaces(value, floorKey) {
  if (Array.isArray(value)) {
    return value.map((space, index) => normalizeSpace(space, floorKey, index, ""));
  }

  const orderedWings = ["upper", "lower", "nwing", "sewing", "swwing"];
  const keys = Object.keys(value).sort((a, b) => orderedWings.indexOf(a) - orderedWings.indexOf(b));
  const spaces = [];
  let sequence = 0;
  keys.forEach((wing) => {
    const wingSpaces = Array.isArray(value[wing]) ? value[wing] : [];
    wingSpaces.forEach((space, localIndex) => {
      spaces.push(normalizeSpace(space, floorKey, sequence, wing, localIndex));
      sequence += 1;
    });
  });
  return spaces;
}

function normalizeSpace(space, floorKey, index, wing = "", localIndex = index) {
  const name = (space && space.name ? String(space.name) : `Space ${index + 1}`).trim();
  return {
    key: `${floorKey}-${wing}-${localIndex}-${slugify(name)}`,
    name,
    label: normalizeLabel(name),
    width: parseWidthClass(space && space.widthClass),
    wing,
    floorKey,
    index,
    localIndex,
  };
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
    renderRoute();
  });

  DOM.sourceFloor.addEventListener("change", () => {
    state.selection.sourceFloor = DOM.sourceFloor.value;
    repopulateSourceSpaces();
    renderRoute();
  });

  DOM.sourceSpace.addEventListener("change", () => {
    state.selection.sourceSpaceKey = DOM.sourceSpace.value;
    renderRoute();
  });

  DOM.targetFloor.addEventListener("change", () => {
    state.selection.targetFloor = DOM.targetFloor.value;
    repopulateTargetSpaces();
    renderRoute();
  });

  DOM.targetSpace.addEventListener("change", () => {
    state.selection.targetSpaceKey = DOM.targetSpace.value;
    renderRoute();
  });

  DOM.replayRoute.addEventListener("click", restartRouteAnimation);
  DOM.toggleCamera.addEventListener("click", () => {
    state.cameraMode = state.cameraMode === "follow" ? "overview" : "follow";
    DOM.toggleCamera.textContent = `Camera: ${state.cameraMode === "follow" ? "Follow" : "Overview"}`;
    DOM.sceneMode.textContent = state.cameraMode === "follow" ? "Follow Camera" : "Overview Camera";
  });

  window.addEventListener("resize", handleResize);
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
  DOM.sourceSpace.innerHTML = floor.spaces
    .map((space) => `<option value="${space.key}">${escapeHtml(space.label)}</option>`)
    .join("");

  const hasCurrent = floor.spaces.some((space) => space.key === state.selection.sourceSpaceKey);
  state.selection.sourceSpaceKey = hasCurrent ? state.selection.sourceSpaceKey : floor.spaces[0]?.key || "";
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
  DOM.targetSpace.innerHTML = floor.spaces
    .map((space) => `<option value="${space.key}">${escapeHtml(space.label)}</option>`)
    .join("");

  const hasCurrent = floor.spaces.some((space) => space.key === state.selection.targetSpaceKey);
  state.selection.targetSpaceKey = hasCurrent ? state.selection.targetSpaceKey : floor.spaces[0]?.key || "";
  DOM.targetSpace.value = state.selection.targetSpaceKey;
}

function renderRoute() {
  const sourceBuilding = getCurrentSourceBuilding();
  const sourceFloor = getCurrentSourceFloor();
  const sourceSpace = getCurrentSourceSpace();
  const targetFloor = getCurrentTargetFloor();
  const targetSpace = getCurrentTargetSpace();

  if (!sourceBuilding || !sourceFloor || !sourceSpace || !targetFloor || !targetSpace) return;

  DOM.summaryStart.textContent = `${sourceBuilding.label} ${formatFloorLabel(sourceFloor.floorKey)}`;
  DOM.summaryStartMeta.textContent = `${sourceSpace.label} -> Lift Lobby`;
  DOM.summaryEnd.textContent = `${TARGET_BUILDING.label} ${formatFloorLabel(targetFloor.floorKey)}`;
  DOM.summaryEndMeta.textContent = `Lift Lobby -> ${targetSpace.label}`;
  DOM.sceneTitle.textContent = `${sourceBuilding.label} -> IPEB 3D Route`;
  DOM.sceneSubtitle.textContent = `${sourceSpace.label} 出發，去 ${TARGET_BUILDING.label} ${formatFloorLabel(targetFloor.floorKey)} ${targetSpace.label}`;
  DOM.sceneMode.textContent = state.cameraMode === "follow" ? "Follow Camera" : "Overview Camera";

  renderRouteSteps(sourceBuilding, sourceFloor, sourceSpace, targetFloor, targetSpace);
  if (state.scene.mode === "webgl") {
    buildRouteScene(sourceBuilding, sourceFloor, sourceSpace, targetFloor, targetSpace);
  } else {
    buildFallbackRouteScene(sourceBuilding, sourceFloor, sourceSpace, targetFloor, targetSpace);
  }
  restartRouteAnimation();
}

function renderRouteSteps(sourceBuilding, sourceFloor, sourceSpace, targetFloor, targetSpace) {
  const steps = [
    `由 ${sourceBuilding.label} ${formatFloorLabel(sourceFloor.floorKey)} 進入 ${sourceSpace.label}。`,
    `沿選中樓層平台行去 ${sourceBuilding.label} lift lobby。`,
    `喺建築核心落到 2/F transfer level。`,
    `經 link bridge corridor 過渡去 IPEB 2/F lift lobby。`,
    `於 IPEB 乘 lift 上 ${formatFloorLabel(targetFloor.floorKey)}。`,
    `由 IPEB lift lobby 行去 ${targetSpace.label} 完成導航。`,
  ];
  DOM.routeSteps.innerHTML = steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");
}

function initScene() {
  const renderer = new THREE.WebGLRenderer({
    canvas: DOM.sceneCanvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x06101d, 0.0022);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1400);
  camera.position.set(90, 168, 280);

  const ambient = new THREE.HemisphereLight(0xc7d2fe, 0x08101d, 1.35);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.55);
  keyLight.position.set(120, 180, 90);
  const rimLight = new THREE.PointLight(0x60a5fa, 85, 380, 2);
  rimLight.position.set(70, 120, -50);

  scene.add(ambient, keyLight, rimLight);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(420, 96),
    new THREE.MeshPhysicalMaterial({
      color: 0x09111f,
      roughness: 0.88,
      metalness: 0.18,
      transparent: true,
      opacity: 0.94,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.3;
  scene.add(ground);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(210, 280, 96),
    new THREE.MeshBasicMaterial({
      color: 0x1d4ed8,
      transparent: true,
      opacity: 0.07,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.15;
  scene.add(ring);

  const grid = new THREE.GridHelper(520, 32, 0x274266, 0x112036);
  grid.material.transparent = true;
  grid.material.opacity = 0.18;
  scene.add(grid);

  state.scene = {
    mode: "webgl",
    renderer,
    scene,
    camera,
    buildingGroup: new THREE.Group(),
    routeGroup: new THREE.Group(),
    labelAnchors: new Map(),
    buildings: new Map(),
    route: null,
  };

  scene.add(state.scene.buildingGroup, state.scene.routeGroup);
  createBuildingLabels();
  buildBuildings();
  handleResize();
}

function initFallbackScene() {
  DOM.sceneCanvas.style.display = "none";
  DOM.buildingLabels.style.display = "none";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.display = "block";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.id = "fallbackScene";
  DOM.sceneViewport.appendChild(svg);

  state.scene = {
    mode: "fallback",
    svg,
    route: null,
    labelAnchors: new Map(),
    buildings: new Map(),
  };
}

function buildBuildings() {
  state.scene.buildingGroup.clear();
  state.scene.buildings.clear();
  state.scene.labelAnchors.clear();

  const allBuildings = [...state.data.sourceBuildings, state.data.targetBuilding];
  allBuildings.forEach((building) => {
    const layout = BUILDING_LAYOUT[building.code];
    const group = new THREE.Group();
    group.position.copy(layout.position);

    const floorMeshes = new Map();
    const baseMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(layout.color).offsetHSL(0, -0.08, 0.02),
      roughness: 0.42,
      metalness: 0.16,
      transparent: true,
      opacity: 0.92,
      emissive: new THREE.Color(layout.color),
      emissiveIntensity: 0.08,
    });

    building.floors.forEach((floor) => {
      const floorMesh = new THREE.Mesh(
        new THREE.BoxGeometry(layout.footprint.x, FLOOR_THICKNESS, layout.footprint.z),
        baseMaterial.clone(),
      );
      floorMesh.position.y = getFloorY(floor.floorSort);
      group.add(floorMesh);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(floorMesh.geometry),
        new THREE.LineBasicMaterial({
          color: 0xbfd9ff,
          transparent: true,
          opacity: 0.18,
        }),
      );
      edges.position.copy(floorMesh.position);
      group.add(edges);
      floorMeshes.set(floor.floorKey, floorMesh);
    });

    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(10, getFloorY(building.floors[0].floorSort) + 6, 10),
      new THREE.MeshPhysicalMaterial({
        color: 0xe0e7ff,
        transparent: true,
        opacity: 0.1,
        emissive: 0x93c5fd,
        emissiveIntensity: 0.6,
        roughness: 0.1,
        metalness: 0.25,
      }),
    );
    shaft.position.set(building.code === "IPEB" ? -layout.footprint.x * 0.28 : layout.footprint.x * 0.28, shaft.geometry.parameters.height / 2, 0);
    group.add(shaft);

    state.scene.buildingGroup.add(group);
    state.scene.buildings.set(building.code, { building, layout, group, floorMeshes });
    state.scene.labelAnchors.set(building.code, new THREE.Vector3(layout.position.x, getFloorY(building.floors[0].floorSort) + 10, layout.position.z));
  });
}

function createBuildingLabels() {
  DOM.buildingLabels.innerHTML = "";
  Object.keys(BUILDING_LAYOUT).forEach((code) => {
    const tag = document.createElement("div");
    tag.className = "building-tag";
    tag.dataset.code = code;
    tag.textContent = code;
    DOM.buildingLabels.appendChild(tag);
  });
}

function buildRouteScene(sourceBuilding, sourceFloor, sourceSpace, targetFloor, targetSpace) {
  const sceneState = state.scene;
  sceneState.routeGroup.clear();
  sceneState.route = null;
  resetBuildingMaterials();

  highlightFloor(sourceBuilding.code, sourceFloor.floorKey, sourceBuilding.theme, 0.28);
  highlightFloor("IPEB", targetFloor.floorKey, TARGET_BUILDING.theme, 0.32);
  emphasizeBuilding(sourceBuilding.code);
  emphasizeBuilding("IPEB");

  const sourceInfo = sceneState.buildings.get(sourceBuilding.code);
  const targetInfo = sceneState.buildings.get("IPEB");

  const sourceSpacePos = getSpaceWorldPosition(sourceInfo, sourceFloor, sourceSpace);
  const sourceLiftPos = getLiftWorldPosition(sourceInfo, sourceFloor.floorSort, "source");
  const sourceLiftTransferPos = getLiftWorldPosition(sourceInfo, 2, "source");
  const sourceExitPos = getBridgeExitPosition(sourceInfo, sourceFloor.floorSort, "source");
  const sourceTransferExit = getBridgeExitPosition(sourceInfo, 2, "source");
  const corridorJoin = new THREE.Vector3(8, getFloorY(2) + 0.5, sourceInfo.layout.position.z);
  const bridgeHub = new THREE.Vector3(46, getFloorY(2) + 0.8, 0);
  const ipebApproach = getBridgeExitPosition(targetInfo, 2, "target");
  const ipebLift2 = getLiftWorldPosition(targetInfo, 2, "target");
  const ipebLiftTarget = getLiftWorldPosition(targetInfo, targetFloor.floorSort, "target");
  const targetSpacePos = getSpaceWorldPosition(targetInfo, targetFloor, targetSpace);

  const routeWaypoints = [
    sourceSpacePos,
    sourceLiftPos,
    sourceLiftTransferPos,
    sourceTransferExit,
    corridorJoin,
    bridgeHub,
    ipebApproach,
    ipebLift2,
    ipebLiftTarget,
    targetSpacePos,
  ];

  const curve = new THREE.CatmullRomCurve3(routeWaypoints, false, "catmullrom", 0.08);
  const sampled = curve.getPoints(280);
  const routeGeometry = new THREE.BufferGeometry().setFromPoints(sampled);

  const baseLine = new THREE.Line(
    routeGeometry.clone(),
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.12,
    }),
  );

  const revealGeometry = routeGeometry.clone();
  revealGeometry.setDrawRange(0, 2);
  const revealLine = new THREE.Line(
    revealGeometry,
    new THREE.LineBasicMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.95,
    }),
  );

  const glowLine = new THREE.Line(
    revealGeometry.clone(),
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.38,
    }),
  );

  sceneState.routeGroup.add(baseLine, glowLine, revealLine);
  sceneState.route = { curve, sampled, revealLine, glowLine };

  addRouteBeacon(sceneState.routeGroup, sourceSpacePos, sourceBuilding.theme);
  addRouteBeacon(sceneState.routeGroup, sourceLiftPos, "#ffffff");
  addRouteBeacon(sceneState.routeGroup, bridgeHub, "#60a5fa");
  addRouteBeacon(sceneState.routeGroup, targetSpacePos, TARGET_BUILDING.theme, 4.8);

  const sourceLiftColumn = createLiftColumn(sourceLiftPos, sourceLiftTransferPos, sourceBuilding.theme);
  const targetLiftColumn = createLiftColumn(ipebLift2, ipebLiftTarget, TARGET_BUILDING.theme);
  sceneState.routeGroup.add(sourceLiftColumn, targetLiftColumn);

  const bridgeTube = createBridgeTube(sourceTransferExit, corridorJoin, bridgeHub, ipebApproach);
  sceneState.routeGroup.add(bridgeTube);
}

function buildFallbackRouteScene(sourceBuilding, sourceFloor, sourceSpace, targetFloor, targetSpace) {
  const sourceInfo = getSceneInfo(sourceBuilding.code);
  const targetInfo = getSceneInfo("IPEB");

  const sourceSpacePos = getSpaceWorldPosition(sourceInfo, sourceFloor, sourceSpace);
  const sourceLiftPos = getLiftWorldPosition(sourceInfo, sourceFloor.floorSort, "source");
  const sourceLiftTransferPos = getLiftWorldPosition(sourceInfo, 2, "source");
  const sourceTransferExit = getBridgeExitPosition(sourceInfo, 2, "source");
  const corridorJoin = new THREE.Vector3(8, getFloorY(2) + 0.5, sourceInfo.layout.position.z);
  const bridgeHub = new THREE.Vector3(46, getFloorY(2) + 0.8, 0);
  const ipebApproach = getBridgeExitPosition(targetInfo, 2, "target");
  const ipebLift2 = getLiftWorldPosition(targetInfo, 2, "target");
  const ipebLiftTarget = getLiftWorldPosition(targetInfo, targetFloor.floorSort, "target");
  const targetSpacePos = getSpaceWorldPosition(targetInfo, targetFloor, targetSpace);

  const routeWaypoints = [
    sourceSpacePos,
    sourceLiftPos,
    sourceLiftTransferPos,
    sourceTransferExit,
    corridorJoin,
    bridgeHub,
    ipebApproach,
    ipebLift2,
    ipebLiftTarget,
    targetSpacePos,
  ];

  const curve = new THREE.CatmullRomCurve3(routeWaypoints, false, "catmullrom", 0.08);
  const sampled = curve.getPoints(240);
  const projectedRoute = sampled.map(projectIsometric);
  const svg = state.scene.svg;

  const allBuildings = [...state.data.sourceBuildings, state.data.targetBuilding];
  const shapes = allBuildings.map((building) => buildFallbackBuildingShape(building));
  const allPoints = [
    ...projectedRoute,
    ...shapes.flatMap((shape) => shape.allPoints),
  ];
  const bounds = getProjectedBounds(allPoints, 90);

  svg.setAttribute("viewBox", `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`);

  const routePath = toSvgPath(projectedRoute);
  const bridgePlate = [sourceTransferExit, corridorJoin, bridgeHub, ipebApproach].map(projectIsometric);
  const bridgeFloor = [
    new THREE.Vector3(sourceTransferExit.x, getFloorY(2), sourceTransferExit.z - 6),
    new THREE.Vector3(ipebApproach.x, getFloorY(2), sourceTransferExit.z - 6),
    new THREE.Vector3(ipebApproach.x, getFloorY(2), sourceTransferExit.z + 6),
    new THREE.Vector3(sourceTransferExit.x, getFloorY(2), sourceTransferExit.z + 6),
  ].map(projectIsometric);

  svg.innerHTML = `
    <defs>
      <linearGradient id="bg-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#08111f"></stop>
        <stop offset="100%" stop-color="#030712"></stop>
      </linearGradient>
      <filter id="route-glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="8" result="blur"></feGaussianBlur>
        <feMerge>
          <feMergeNode in="blur"></feMergeNode>
          <feMergeNode in="SourceGraphic"></feMergeNode>
        </feMerge>
      </filter>
    </defs>
    <rect x="${bounds.minX}" y="${bounds.minY}" width="${bounds.width}" height="${bounds.height}" fill="url(#bg-grad)"></rect>
    <g opacity="0.18">
      <ellipse cx="8" cy="10" rx="255" ry="102" fill="#0f172a"></ellipse>
      <ellipse cx="8" cy="10" rx="205" ry="74" fill="none" stroke="#1d4ed8"></ellipse>
    </g>
    ${shapes.map((shape) => shape.markup).join("")}
    <polygon points="${toSvgPoints(bridgeFloor)}" fill="rgba(56,189,248,0.16)" stroke="#60a5fa" stroke-width="3"></polygon>
    <polyline points="${toSvgPoints(bridgePlate)}" fill="none" stroke="#93c5fd" stroke-width="6" opacity="0.55"></polyline>
    <path d="${routePath}" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="5"></path>
    <path id="fallbackRouteGlow" d="${routePath}" fill="none" stroke="#ffffff" stroke-width="8" opacity="0.2" filter="url(#route-glow)"></path>
    <path id="fallbackRoute" d="${routePath}" fill="none" stroke="#93c5fd" stroke-width="5.5" stroke-linecap="round"></path>
    ${renderFallbackBeacons([
      [sourceSpacePos, sourceBuilding.theme, 6],
      [sourceLiftPos, "#ffffff", 4],
      [bridgeHub, "#60a5fa", 4],
      [targetSpacePos, TARGET_BUILDING.theme, 7],
    ])}
  `;

  const routeEl = svg.querySelector("#fallbackRoute");
  const glowEl = svg.querySelector("#fallbackRouteGlow");
  const routeLength = routeEl.getTotalLength();
  routeEl.style.strokeDasharray = `${routeLength}`;
  routeEl.style.strokeDashoffset = `${routeLength}`;
  glowEl.style.strokeDasharray = `${routeLength}`;
  glowEl.style.strokeDashoffset = `${routeLength}`;

  state.scene.route = {
    curve,
    sampled,
    projectedRoute,
    routeEl,
    glowEl,
    routeLength,
    bounds,
  };
}

function resetBuildingMaterials() {
  state.scene.buildings.forEach(({ group }) => {
    group.traverse((child) => {
      if (child.isMesh && child.material && child.material.emissive) {
        child.material.opacity = child.geometry.type === "BoxGeometry" ? 0.92 : child.material.opacity;
        child.material.emissiveIntensity = child.geometry.type === "BoxGeometry" ? 0.08 : child.material.emissiveIntensity;
      }
    });
  });
}

function highlightFloor(code, floorKey, color, opacityBoost) {
  const info = state.scene.buildings.get(code);
  if (!info) return;
  const mesh = info.floorMeshes.get(floorKey);
  if (!mesh) return;
  mesh.material.color = new THREE.Color(color).offsetHSL(0, -0.04, 0.12);
  mesh.material.emissive = new THREE.Color(color);
  mesh.material.emissiveIntensity = 0.58;
  mesh.material.opacity = 0.98;
}

function emphasizeBuilding(code) {
  const info = state.scene.buildings.get(code);
  if (!info) return;
  info.group.traverse((child) => {
    if (child.isMesh && child.material && child.material.emissive) {
      child.material.emissiveIntensity = Math.max(child.material.emissiveIntensity || 0, 0.2);
    }
  });
}

function createLiftColumn(start, end, color) {
  const height = Math.abs(end.y - start.y);
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.2, Math.max(height, 1), 18),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.22,
    }),
  );
  column.position.set(start.x, (start.y + end.y) / 2, start.z);
  return column;
}

function createBridgeTube(...points) {
  const bridgeCurve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.02);
  return new THREE.Mesh(
    new THREE.TubeGeometry(bridgeCurve, 100, 0.9, 12, false),
    new THREE.MeshBasicMaterial({
      color: 0x60a5fa,
      transparent: true,
      opacity: 0.2,
    }),
  );
}

function addRouteBeacon(group, position, color, size = 3.2) {
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(size, 22, 22),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.85,
    }),
  );
  beacon.position.copy(position);
  group.add(beacon);
}

function restartRouteAnimation() {
  state.routeProgress = 0;
  state.isPlaying = true;
  state.routeStartTime = performance.now();
  DOM.routeProgress.textContent = "0%";
  if (state.scene?.mode === "webgl" && state.scene.route) {
    state.scene.route.revealLine.geometry.setDrawRange(0, 2);
    state.scene.route.glowLine.geometry.setDrawRange(0, 2);
  } else if (state.scene?.mode === "fallback" && state.scene.route) {
    state.scene.route.routeEl.style.strokeDashoffset = `${state.scene.route.routeLength}`;
    state.scene.route.glowEl.style.strokeDashoffset = `${state.scene.route.routeLength}`;
  }
}

function animate(timestamp) {
  requestAnimationFrame(animate);
  if (!state.scene) return;

  if (!state.lastTimestamp) state.lastTimestamp = timestamp;
  const delta = timestamp - state.lastTimestamp;
  state.lastTimestamp = timestamp;

  if (state.isPlaying && state.scene.route) {
    state.routeProgress = Math.min((timestamp - state.routeStartTime) / ROUTE_DURATION_MS, 1);
    if (state.routeProgress >= 1) state.isPlaying = false;
    updateRouteReveal();
  }

  if (state.scene.mode === "webgl") {
    updateCamera(delta);
    updateBuildingLabels();
    state.scene.renderer.render(state.scene.scene, state.scene.camera);
  } else {
    updateFallbackCamera();
  }
}

function updateRouteReveal() {
  const route = state.scene.route;
  if (!route) return;
  if (state.scene.mode === "webgl") {
    const visibleCount = Math.max(2, Math.floor(state.routeProgress * route.sampled.length));
    route.revealLine.geometry.setDrawRange(0, visibleCount);
    route.glowLine.geometry.setDrawRange(0, visibleCount);
  } else {
    const remaining = route.routeLength * (1 - state.routeProgress);
    route.routeEl.style.strokeDashoffset = `${remaining}`;
    route.glowEl.style.strokeDashoffset = `${remaining}`;
  }
  DOM.routeProgress.textContent = `${Math.round(state.routeProgress * 100)}%`;
}

function updateCamera(delta) {
  const { camera } = state.scene;
  const target = new THREE.Vector3(10, 42, 0);
  const overviewPosition = new THREE.Vector3(90, 168, 280);

  if (!state.scene.route || state.cameraMode === "overview") {
    camera.position.lerp(overviewPosition, 0.045);
    const lookAt = target.clone();
    camera.lookAt(lookAt);
    return;
  }

  const route = state.scene.route;
  const progress = Math.min(Math.max(state.routeProgress, 0.001), 1);
  const current = route.curve.getPointAt(progress);
  const ahead = route.curve.getPointAt(Math.min(progress + 0.02, 1));
  const behind = route.curve.getPointAt(Math.max(progress - 0.01, 0));
  const tangent = ahead.clone().sub(behind).normalize();
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tangent).normalize();
  const desiredPosition = current
    .clone()
    .addScaledVector(tangent, -34)
    .addScaledVector(side, 15)
    .add(new THREE.Vector3(0, 18, 0));
  const desiredLookAt = current.clone().addScaledVector(tangent, 18).add(new THREE.Vector3(0, 4, 0));

  camera.position.lerp(desiredPosition, 0.065);
  camera.lookAt(desiredLookAt);
}

function updateBuildingLabels() {
  const viewportRect = DOM.sceneViewport.getBoundingClientRect();
  const width = viewportRect.width;
  const height = viewportRect.height;

  DOM.buildingLabels.querySelectorAll(".building-tag").forEach((labelEl) => {
    const anchor = state.scene.labelAnchors.get(labelEl.dataset.code);
    if (!anchor) return;
    const projected = anchor.clone().project(state.scene.camera);
    const isVisible = projected.z < 1 && projected.z > -1;
    if (!isVisible) {
      labelEl.style.opacity = "0";
      return;
    }
    labelEl.style.opacity = "1";
    labelEl.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
    labelEl.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`;
  });
}

function handleResize() {
  if (!state.scene || state.scene.mode !== "webgl") return;
  const width = DOM.sceneViewport.clientWidth;
  const height = DOM.sceneViewport.clientHeight;
  state.scene.camera.aspect = width / Math.max(height, 1);
  state.scene.camera.updateProjectionMatrix();
  state.scene.renderer.setSize(width, height, false);
}

function updateFallbackCamera() {
  const route = state.scene.route;
  if (!route || !Array.isArray(route.projectedRoute) || route.projectedRoute.length === 0) return;
  if (state.cameraMode === "overview") {
    state.scene.svg.setAttribute("viewBox", `${route.bounds.minX} ${route.bounds.minY} ${route.bounds.width} ${route.bounds.height}`);
    return;
  }
  const currentIndex = Math.min(route.projectedRoute.length - 1, Math.floor(state.routeProgress * (route.projectedRoute.length - 1)));
  const currentPoint = route.projectedRoute[currentIndex];
  if (!currentPoint) return;
  const width = route.bounds.width * 0.56;
  const height = route.bounds.height * 0.56;
  state.scene.svg.setAttribute("viewBox", `${currentPoint.x - width / 2} ${currentPoint.y - height / 2} ${width} ${height}`);
}

function getCurrentSourceBuilding() {
  return state.data.sourceBuildings.find((building) => building.index === state.selection.sourceBuildingIndex) || state.data.sourceBuildings[0];
}

function getCurrentSourceFloor() {
  const building = getCurrentSourceBuilding();
  return building.floors.find((floor) => floor.floorKey === state.selection.sourceFloor) || building.floors[0];
}

function getCurrentSourceSpace() {
  const floor = getCurrentSourceFloor();
  return floor.spaces.find((space) => space.key === state.selection.sourceSpaceKey) || floor.spaces[0];
}

function getCurrentTargetFloor() {
  return state.data.targetBuilding.floors.find((floor) => floor.floorKey === state.selection.targetFloor) || state.data.targetBuilding.floors[0];
}

function getCurrentTargetSpace() {
  const floor = getCurrentTargetFloor();
  return floor.spaces.find((space) => space.key === state.selection.targetSpaceKey) || floor.spaces[0];
}

function getSceneInfo(code) {
  if (state.scene?.mode === "webgl") {
    return state.scene.buildings.get(code);
  }
  const building = code === "IPEB"
    ? state.data.targetBuilding
    : state.data.sourceBuildings.find((item) => item.code === code);
  return {
    building,
    layout: BUILDING_LAYOUT[code],
  };
}

function getSpaceWorldPosition(info, floor, space) {
  const { layout } = info;
  const spacingStart = -layout.footprint.x * 0.34;
  const spacingEnd = layout.footprint.x * 0.18;
  const total = Math.max(floor.spaces.length - 1, 1);
  const frac = floor.spaces.length === 1 ? 0.5 : space.index / total;
  const x = THREE.MathUtils.lerp(spacingStart, spacingEnd, frac);
  const z = getWingZ(space.wing, layout.footprint.z);
  return new THREE.Vector3(layout.position.x + x, getFloorY(floor.floorSort) + 2.6, layout.position.z + z);
}

function getLiftWorldPosition(info, floorSort, type) {
  const { layout } = info;
  const x = type === "target" ? -layout.footprint.x * 0.28 : layout.footprint.x * 0.28;
  return new THREE.Vector3(layout.position.x + x, getFloorY(floorSort) + 1.6, layout.position.z);
}

function getBridgeExitPosition(info, floorSort, type) {
  const { layout } = info;
  const x = type === "target" ? -layout.footprint.x * 0.62 : layout.footprint.x * 0.62;
  return new THREE.Vector3(layout.position.x + x, getFloorY(floorSort) + 1.4, layout.position.z);
}

function getWingZ(wing, depth) {
  const map = {
    nwing: -depth * 0.2,
    sewing: depth * 0.18,
    swwing: depth * 0.3,
    upper: -depth * 0.18,
    lower: depth * 0.18,
  };
  return map[wing] || 0;
}

function getFloorY(floorSort) {
  return (floorSort + 2) * FLOOR_HEIGHT + FLOOR_THICKNESS * 0.5;
}

function getFloorSortValue(floorKey) {
  return FLOOR_ALIASES[floorKey] ?? Number.parseInt(floorKey, 10) ?? 0;
}

function parseWidthClass(widthClass) {
  const match = String(widthClass || "").match(/(\d+)/);
  return match ? Number(match[1]) : 80;
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

function formatFloorLabel(floorKey) {
  if (floorKey === "B01") return "B1/F";
  if (floorKey === "B02") return "B2/F";
  return `${floorKey}/F`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function projectIsometric(vector) {
  return {
    x: (vector.x - vector.z) * 1.08,
    y: (vector.x + vector.z) * 0.42 - vector.y * 1.06,
  };
}

function buildFallbackBuildingShape(building) {
  const layout = BUILDING_LAYOUT[building.code];
  const maxFloor = building.floors[0].floorSort;
  const height = getFloorY(maxFloor) + 12;
  const halfX = layout.footprint.x / 2;
  const halfZ = layout.footprint.z / 2;
  const cx = layout.position.x;
  const cz = layout.position.z;

  const top = [
    new THREE.Vector3(cx - halfX, height, cz - halfZ),
    new THREE.Vector3(cx + halfX, height, cz - halfZ),
    new THREE.Vector3(cx + halfX, height, cz + halfZ),
    new THREE.Vector3(cx - halfX, height, cz + halfZ),
  ].map(projectIsometric);
  const bottomFront = [
    new THREE.Vector3(cx - halfX, 0, cz + halfZ),
    new THREE.Vector3(cx + halfX, 0, cz + halfZ),
  ].map(projectIsometric);
  const bottomRight = [
    new THREE.Vector3(cx + halfX, 0, cz - halfZ),
    new THREE.Vector3(cx + halfX, 0, cz + halfZ),
  ].map(projectIsometric);

  const frontFace = [top[3], top[2], bottomFront[1], bottomFront[0]];
  const rightFace = [top[1], top[2], bottomRight[1], bottomRight[0]];
  const topFace = [top[0], top[1], top[2], top[3]];

  const sourceFloorKey = building.code === getCurrentSourceBuilding().code ? getCurrentSourceFloor().floorKey : null;
  const targetFloorKey = building.code === "IPEB" ? getCurrentTargetFloor().floorKey : null;
  const highlightFloorKey = sourceFloorKey || targetFloorKey;
  let highlightMarkup = "";

  if (highlightFloorKey) {
    const floor = building.floors.find((item) => item.floorKey === highlightFloorKey);
    if (floor) {
      const y = getFloorY(floor.floorSort) + 0.8;
      const plate = [
        new THREE.Vector3(cx - halfX, y, cz - halfZ),
        new THREE.Vector3(cx + halfX, y, cz - halfZ),
        new THREE.Vector3(cx + halfX, y, cz + halfZ),
        new THREE.Vector3(cx - halfX, y, cz + halfZ),
      ].map(projectIsometric);
      highlightMarkup = `<polygon points="${toSvgPoints(plate)}" fill="${hexToRgba(layout.color, 0.52)}" stroke="#ffffff" stroke-width="2"></polygon>`;
    }
  }

  const labelPoint = projectIsometric(new THREE.Vector3(cx, height + 10, cz));
  const markup = `
    <polygon points="${toSvgPoints(frontFace)}" fill="${hexToRgba(layout.color, 0.26)}" stroke="${layout.color}" stroke-width="2"></polygon>
    <polygon points="${toSvgPoints(rightFace)}" fill="${hexToRgba(layout.color, 0.18)}" stroke="${layout.color}" stroke-width="2"></polygon>
    <polygon points="${toSvgPoints(topFace)}" fill="${hexToRgba(layout.color, 0.42)}" stroke="#dbeafe" stroke-width="2.2"></polygon>
    ${highlightMarkup}
    <text x="${labelPoint.x}" y="${labelPoint.y}" text-anchor="middle" fill="#ffffff" font-size="16" font-weight="800" letter-spacing="0.12em">${building.code}</text>
  `;

  return {
    markup,
    allPoints: [...topFace, ...frontFace, ...rightFace],
  };
}

function getProjectedBounds(points, padding = 0) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs) - padding;
  const maxX = Math.max(...xs) + padding;
  const minY = Math.min(...ys) - padding;
  const maxY = Math.max(...ys) + padding;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function toSvgPoints(points) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function toSvgPath(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function renderFallbackBeacons(entries) {
  return entries.map(([worldPos, color, radius]) => {
    const point = projectIsometric(worldPos);
    return `
      <circle cx="${point.x}" cy="${point.y}" r="${radius * 1.75}" fill="${hexToRgba(color, 0.16)}"></circle>
      <circle cx="${point.x}" cy="${point.y}" r="${radius}" fill="${color}"></circle>
    `;
  }).join("");
}

function hexToRgba(hex, alpha) {
  const normalized = String(hex).replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((part) => part + part).join("")
    : normalized;
  const bigint = Number.parseInt(value, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

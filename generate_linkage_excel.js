const fs = require('fs');
const path = require('path');
const vm = require('vm');
const XLSX = require('xlsx');

const HTML_PATH = path.join(__dirname, 'index.html');
const OUTPUT_PATH = path.join(__dirname, 'building_linkage_list.xlsx');

const html = fs.readFileSync(HTML_PATH, 'utf8');

function extractConstExpression(source, constName) {
  const marker = `const ${constName} =`;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`Cannot find const ${constName}`);
  }

  let i = start + marker.length;
  while (i < source.length && /\s/.test(source[i])) i += 1;

  const opener = source[i];
  const pairs = { '[': ']', '{': '}' };
  const closer = pairs[opener];
  if (!closer) {
    throw new Error(`Unsupported expression start for ${constName}: ${opener}`);
  }

  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let j = i; j < source.length; j += 1) {
    const ch = source[j];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === opener) {
      depth += 1;
    } else if (ch === closer) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(i, j + 1);
      }
    }
  }

  throw new Error(`Unterminated expression for ${constName}`);
}

function evaluateConst(source, constName) {
  const expression = extractConstExpression(source, constName);
  return vm.runInNewContext(`(${expression})`);
}

const leftBuildingsData = evaluateConst(html, 'leftBuildingsData');
const rightTowerData = evaluateConst(html, 'rightTowerData');
const linkedSpaces = evaluateConst(html, 'linkedSpaces');
const mcbtc2030Floors = evaluateConst(html, 'mcbtc2030Floors');
const mcbtc2030Links = evaluateConst(html, 'mcbtc2030Links');
const exceptionalCaseMigrations = evaluateConst(html, 'exceptionalCaseMigrations');

const BUILDING_NAME_MAP = {
  MCBTC: 'MCBTC',
  CSB: 'CSB',
  HKLM: 'HKLM',
  EF: 'EF',
  SB: 'EF',
  DTB: 'HKLM',
  IPEB: 'IPEB',
  MCBTC2030: 'MCBTC2030'
};

function normalizeBuildingName(name) {
  const raw = String(name || '').trim().toUpperCase();
  if (BUILDING_NAME_MAP[raw]) return BUILDING_NAME_MAP[raw];
  if (raw.includes('CLINICAL SCIENCES BUILDING')) return 'CSB';
  if (raw.includes('HKLM')) return 'HKLM';
  if (raw.includes('EF')) return 'EF';
  if (raw.includes('MCBTC')) return 'MCBTC';
  if (raw.includes('IPEB')) return 'IPEB';
  return raw || '';
}

function floorLabel(floor) {
  const text = String(floor || '').trim();
  if (!text) return '';
  return `${text}/F`;
}

function cleanName(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object' && raw.name) return String(raw.name).trim();
  return String(raw).trim();
}

function getLeftSpace(buildingIndex, floor, index) {
  const building = leftBuildingsData[Number(buildingIndex)];
  if (!building) return null;
  const floors = building.floors || {};
  const floorData = floors[String(floor)] || floors[floor];
  if (!floorData) return null;

  let item = null;
  if (Number(buildingIndex) === 1 && String(floor) === '3' && floorData.upper && floorData.lower) {
    const upper = floorData.upper || [];
    const lower = floorData.lower || [];
    const idx = Number(index);
    item = idx < upper.length ? upper[idx] : lower[idx - upper.length];
  } else {
    item = floorData[Number(index)];
  }
  if (!item) return null;

  return {
    building: normalizeBuildingName(building.name),
    floor: String(floor),
    area: cleanName(item)
  };
}

function getRightSpace(floor, wing, index) {
  const wingName = String(wing || '');
  if (wingName === 'mcbtc2030') {
    const floorData = mcbtc2030Floors[String(floor)] || mcbtc2030Floors[floor];
    const item = Array.isArray(floorData) ? floorData[Number(index)] : null;
    if (!item) return null;
    return {
      building: 'MCBTC2030',
      floor: String(floor),
      area: cleanName(item)
    };
  }

  const floorData = rightTowerData[String(floor)] || rightTowerData[floor];
  const wingData = floorData && floorData[wingName];
  const item = Array.isArray(wingData) ? wingData[Number(index)] : null;
  if (!item) return null;

  return {
    building: 'IPEB',
    floor: String(floor),
    area: cleanName(item)
  };
}

function addRow(rowMap, row, sheetName) {
  const normalizedSheet = sheetName || 'All Linkages';
  const key = [
    normalizedSheet,
    row.fromBuilding,
    row.fromFloor,
    row.fromArea,
    row.toBuilding,
    row.toFloor,
    row.toArea,
    row.phaseRemark
  ].join('|');
  if (!rowMap.has(key)) {
    rowMap.set(key, { ...row, sheetName: normalizedSheet });
  }
}

const requestedBuildings = new Set(['MCBTC', 'HKLM', 'EF', 'CSB']);
const rows = new Map();

for (const link of linkedSpaces) {
  const leftItems = Array.isArray(link.left) ? link.left : [];
  const rightItems = Array.isArray(link.right) ? link.right : [];
  for (const leftItem of leftItems) {
    const source = getLeftSpace(leftItem.building, leftItem.floor, leftItem.index);
    if (!source || !requestedBuildings.has(source.building)) continue;
    for (const rightItem of rightItems) {
      const target = getRightSpace(rightItem.floor, rightItem.wing, rightItem.index);
      if (!target) continue;
      const row = {
        fromBuilding: source.building,
        fromFloor: floorLabel(source.floor),
        fromArea: source.area,
        toText: 'to',
        toBuilding: target.building,
        toFloor: floorLabel(target.floor),
        toArea: target.area,
        phaseRemark: ''
      };
      addRow(rows, row, source.building);
      addRow(rows, row, 'All Linkages');
    }
  }
}

for (const link of mcbtc2030Links) {
  const leftItems = Array.isArray(link.left) ? link.left : [];
  const rightItems = Array.isArray(link.right) ? link.right : [];
  for (const leftItem of leftItems) {
    const source = getLeftSpace(leftItem.building, leftItem.floor, leftItem.index);
    if (!source || !requestedBuildings.has(source.building)) continue;
    for (const rightItem of rightItems) {
      if (String(rightItem.wing || '') !== 'mcbtc2030') continue;
      const target = getRightSpace(rightItem.floor, rightItem.wing, rightItem.index);
      if (!target) continue;
      const row = {
        fromBuilding: source.building,
        fromFloor: floorLabel(source.floor),
        fromArea: source.area,
        toText: 'to',
        toBuilding: target.building,
        toFloor: floorLabel(target.floor),
        toArea: target.area,
        phaseRemark: ''
      };
      addRow(rows, row, source.building);
      addRow(rows, row, 'All Linkages');
    }
  }
}

function parseLocationString(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return { building: '', floor: '', area: '' };
  }

  let match = raw.match(/^(MCBTC2030|IPEB|MCBTC|CSB|DTB|HKLM|SB|EF)\s+([^/\s]+)\/F\s+(.+)$/i);
  if (match) {
    return {
      building: normalizeBuildingName(match[1]),
      floor: floorLabel(match[2]),
      area: String(match[3] || '').trim()
    };
  }

  match = raw.match(/^([^,]+?)\s+(\d+|B\d+)\/F\s+(.+)$/i);
  if (match) {
    return {
      building: normalizeBuildingName(match[1]),
      floor: floorLabel(match[2]),
      area: String(match[3] || '').trim()
    };
  }

  return {
    building: '',
    floor: '',
    area: raw
  };
}

for (const migration of exceptionalCaseMigrations) {
  const moves = Array.isArray(migration.moves) ? migration.moves : [];
  let currentSources = [String(migration.from || '').trim()];

  for (const move of moves) {
    const destinations = (Array.isArray(move.destinations) ? move.destinations : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean);

    if (destinations.length === 0) continue;

    for (const sourceText of currentSources) {
      const source = parseLocationString(sourceText);
      for (const destText of destinations) {
        const target = parseLocationString(destText);
        const row = {
          fromBuilding: source.building,
          fromFloor: source.floor,
          fromArea: source.area || String(migration.from || '').trim(),
          toText: 'to',
          toBuilding: target.building,
          toFloor: target.floor,
          toArea: target.area || destText,
          phaseRemark: `${String(move.year || '').trim()} | ${String(migration.title || '').trim()}`
        };
        addRow(rows, row, 'Exceptional Area');
        addRow(rows, row, 'All Linkages');
      }
    }

    currentSources = destinations.slice();
  }
}

function floorSortValue(value) {
  const raw = String(value || '').replace('/F', '').trim().toUpperCase();
  if (!raw) return -9999;
  if (/^B\d+$/.test(raw)) {
    return -Number(raw.slice(1));
  }
  const num = Number(raw);
  return Number.isFinite(num) ? num : -9998;
}

function sortRows(list) {
  return list.slice().sort((a, b) => {
    const buildingOrder = ['MCBTC', 'HKLM', 'EF', 'CSB', 'Exceptional Area', 'IPEB', 'MCBTC2030'];
    const aBuild = buildingOrder.indexOf(a.fromBuilding);
    const bBuild = buildingOrder.indexOf(b.fromBuilding);
    if (aBuild !== bBuild) return (aBuild === -1 ? 999 : aBuild) - (bBuild === -1 ? 999 : bBuild);

    const floorDiff = floorSortValue(b.fromFloor) - floorSortValue(a.fromFloor);
    if (floorDiff !== 0) return floorDiff;

    const areaDiff = a.fromArea.localeCompare(b.fromArea);
    if (areaDiff !== 0) return areaDiff;

    const toBuildDiff = a.toBuilding.localeCompare(b.toBuilding);
    if (toBuildDiff !== 0) return toBuildDiff;

    const toFloorDiff = floorSortValue(b.toFloor) - floorSortValue(a.toFloor);
    if (toFloorDiff !== 0) return toFloorDiff;

    const toAreaDiff = a.toArea.localeCompare(b.toArea);
    if (toAreaDiff !== 0) return toAreaDiff;

    return a.phaseRemark.localeCompare(b.phaseRemark);
  });
}

const workbook = XLSX.utils.book_new();
const headers = [
  'From Building',
  'From Floor',
  'From Area',
  'To',
  'To Building',
  'To Floor',
  'To Area',
  'Phase/Remark'
];

const sheetOrder = [
  'All Linkages',
  'MCBTC',
  'HKLM',
  'EF',
  'CSB',
  'Exceptional Area'
];

for (const sheetName of sheetOrder) {
  const sheetRows = sortRows(
    Array.from(rows.values()).filter((row) => row.sheetName === sheetName)
  ).map((row) => ({
    'From Building': row.fromBuilding,
    'From Floor': row.fromFloor,
    'From Area': row.fromArea,
    'To': row.toText,
    'To Building': row.toBuilding,
    'To Floor': row.toFloor,
    'To Area': row.toArea,
    'Phase/Remark': row.phaseRemark
  }));

  const worksheet = XLSX.utils.json_to_sheet(sheetRows, { header: headers });
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  const widths = headers.map((header) => ({
    wch: Math.min(
      48,
      Math.max(
        header.length + 2,
        ...sheetRows.map((row) => String(row[header] || '').length + 2),
        12
      )
    )
  }));
  worksheet['!cols'] = widths;
  worksheet['!autofilter'] = { ref: `A1:H${Math.max(sheetRows.length + 1, 2)}` };
}

XLSX.writeFile(workbook, OUTPUT_PATH);

const counts = {};
for (const name of sheetOrder) {
  counts[name] = Array.from(rows.values()).filter((row) => row.sheetName === name).length;
}

console.log(JSON.stringify({ output: OUTPUT_PATH, counts }, null, 2));

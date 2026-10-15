import { AIR_LAYOUT, T12_SUPPORT_LAYOUT as D } from './dimensions.js';
const rowCircuits = [1, 2, 2, 3, 4, 5, 6, 7, 7];
export const t12Regions = [0, 1].flatMap((side) =>
  Array.from({ length: 7 }, (_, i) => ({
    id: `${side ? 'left' : 'right'}.circuit${i + 1}`,
    name: `气路${i + 1}`,
    side,
    range: [0, 100],
    unit: 'level',
  })),
);
// Drawing establishes counts and connectivity; these metre dimensions are a visual fit.
export const t12Bags = [0, 1].flatMap((side) =>
  rowCircuits.map((c, row) => ({
    id: `${side ? 'left' : 'right'}.row${row + 1}`,
    regionId: `${side ? 'left' : 'right'}.circuit${c}`,
    side,
    x: (side ? 1 : -1) * D.centerX,
    z: D.firstRowZ + row * D.rowPitch,
    width: D.width,
    depth: D.depth,
    spreadX: D.spreadX,
    spread: D.spread,
    maxLift: 0.055,
    bottom: AIR_LAYOUT.bottom,
    minHalfHeight: D.minHalfHeight,
    halfHeightRange: D.halfHeightRange,
    shape: 'round-array',
    cellCount: 7,
  })),
);
export function tidalGroups(side, waist) {
  if (!['left', 'right'].includes(side) || ![3, 4, 5].includes(waist))
    throw Object.assign(new Error('腰部气路必须为3、4或5，侧别为left或right'), {
      code: 'INVALID_TIDAL',
    });
  const groups = [
    ['shoulder', '肩部', [1]],
    ['back', '背部', [2, ...[3, 4, 5].filter((n) => n < waist)]],
    ['lumbar', '腰部', [waist]],
    ['hip', '臀部', [...[3, 4, 5].filter((n) => n > waist), 6]],
    ['leg', '腿部', [7]],
  ];
  return groups.map(([part, name, numbers]) => ({
    id: `${side}.${part}`,
    name,
    side: side === 'left' ? 1 : 0,
    range: [0, 100],
    circuitIds: numbers.map((n) => `${side}.circuit${n}`),
  }));
}

// 圆囊气路的示意走线（米）。实体气管与调节光效共用，保证两者重合。
// 每条气路：trunk 从床尾汇流排到首排，branches 再分到该路的每一排；点位按从气源到圆囊的顺序排列。
export function circuitTubePaths(airbags) {
  const paths = [];
  for (const side of [0, 1]) {
    const ids = [...new Set(airbags.filter((b) => b.side === side).map((b) => b.regionId))];
    ids.forEach((regionId, index) => {
      const rows = airbags.filter((b) => b.regionId === regionId),
        sign = side ? 1 : -1,
        lane = sign * (D.laneOffset + index * D.lanePitch),
        inner = sign * D.branchX,
        y = D.tubeY;
      paths.push({
        side,
        regionId,
        index,
        trunk: [
          [lane, y, D.manifoldEndZ],
          [lane, y, D.controlBayStartZ],
          [lane, y, rows[0].z + D.trunkLead],
          [inner, y, rows[0].z],
        ],
        branches: rows.map((row) => [
          [inner, y, rows[0].z],
          [inner, y, row.z + D.branchLead],
          [sign * (Math.abs(row.x) - row.width / 2), y, row.z],
          [sign * (Math.abs(row.x) + row.width / 2 - D.branchEndInset), y, row.z],
        ]),
      });
    });
  }
  return paths;
}

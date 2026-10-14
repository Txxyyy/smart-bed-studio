import { AIR_LAYOUT, T11_AIR_LAYOUT } from './dimensions.js';

// API sides always follow the person lying on the mattress: head at -Z and
// feet at +Z. From the foot of the bed, the person's left is the +X half.
export const humanSide = (side) => (side === 1 ? 'left' : 'right');

export const ZONES = Object.freeze([
  { id: 'shoulder', name: '肩背', z: -0.6, spread: 0.21 },
  { id: 'lumbar', name: '腰部', z: -0.17, spread: 0.145 },
  { id: 'hip', name: '臀部', z: 0.19, spread: 0.17 },
  { id: 'leg', name: '腿部', z: 0.63, spread: 0.21 },
]);
export const DEFAULT_AIR_BAGS = Object.freeze(
  [0, 1].flatMap((side) =>
    ZONES.map((region, zone) =>
      Object.freeze({
        id: `${humanSide(side)}.${region.id}`,
        regionId: `${humanSide(side)}.${region.id}`,
        side,
        zone,
        x: (side ? 1 : -1) * AIR_LAYOUT.centerX,
        z: region.z,
        width: AIR_LAYOUT.pouchWidth,
        depth: region.spread * 1.8,
        spreadX: AIR_LAYOUT.spreadX,
        spread: region.spread,
        maxLift: 0.055,
        bottom: AIR_LAYOUT.bottom,
        minHalfHeight: AIR_LAYOUT.minHalfHeight,
        halfHeightRange: AIR_LAYOUT.halfHeightRange,
      }),
    ),
  ),
);
export const DEFAULT_HEAT_PATCHES = Object.freeze(
  [0, 1].flatMap((side) =>
    [
      { id: `${humanSide(side)}.lumbar`, side, region: 0, z: ZONES[1].z, depth: 0.3 },
      { id: `${humanSide(side)}.leg`, side, region: 1, z: ZONES[3].z, depth: 0.38 },
    ].map((p) =>
      Object.freeze({
        ...p,
        x: (side ? 1 : -1) * AIR_LAYOUT.centerX,
        width: AIR_LAYOUT.pouchWidth * 0.88,
        maxLevel: 3,
      }),
    ),
  ),
);

export function emptyChannels(items, indexKey, value = 0) {
  return [0, 1].map((side) =>
    Array.from(
      {
        length: items
          .filter((p) => p.side === side)
          .reduce((n, p) => Math.max(n, p[indexKey] + 1), 0),
      },
      () => value,
    ),
  );
}

export const T11_REGIONS = Object.freeze(
  [0, 1].flatMap((side) =>
    T11_AIR_LAYOUT.groups.map((group) =>
      Object.freeze({
        id: `${humanSide(side)}.${group.id}`,
        name: group.name,
        side,
        range: [0, 100],
        unit: 'level',
      }),
    ),
  ),
);
export const T11_AIR_BAGS = Object.freeze(
  [0, 1].flatMap((side) =>
    T11_AIR_LAYOUT.groups.flatMap((group) =>
      group.centers.map((z, index) =>
        Object.freeze({
          id: `${humanSide(side)}.${group.id}-${index + 1}`,
          regionId: `${humanSide(side)}.${group.id}`,
          side,
          x: (side ? 1 : -1) * T11_AIR_LAYOUT.centerX,
          z,
          width: T11_AIR_LAYOUT.width,
          depth: T11_AIR_LAYOUT.depth,
          spreadX: T11_AIR_LAYOUT.spreadX,
          spread: T11_AIR_LAYOUT.spread,
          maxLift: 0.055,
          bottom: AIR_LAYOUT.bottom,
          minHalfHeight: AIR_LAYOUT.minHalfHeight,
          halfHeightRange: AIR_LAYOUT.halfHeightRange,
        }),
      ),
    ),
  ),
);

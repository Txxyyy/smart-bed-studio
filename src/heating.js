import { clamp } from './kinematics.js';
import { sideIndices } from './firmness.js';

export const HEAT_ZONES = Object.freeze([
  { id: 'lumbar', name: '腰部', zone: 1, depth: 0.3 },
  { id: 'leg', name: '腿部', zone: 3, depth: 0.38 },
]);
export const HEAT_LEVELS = ['关闭', '低档', '中档', '高档'];

export function setHeatLevel(heating, side, region, level) {
  return heating.map((values, s) =>
    values.map((value, z) =>
      sideIndices(side).includes(s) && z === region ? Math.round(clamp(level, 0, 3)) : value,
    ),
  );
}

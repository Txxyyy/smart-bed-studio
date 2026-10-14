import { solveMechanism, LINKAGE } from './mechanism.js';
import { DIMENSIONS } from './dimensions.js';
import { DEFAULT_AIR_BAGS } from './air-layout.js';
export { DIMENSIONS } from './dimensions.js';
export { ZONES } from './air-layout.js';
export const PRESETS = Object.freeze({
  flat: { name: '平躺', back: 0, leg: 0 },
  read: { name: '阅读', back: 52, leg: 10 },
  zero: { name: '零重力', back: 28, leg: 24 },
  relax: { name: '舒展', back: 14, leg: 32 },
});
export const clamp = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// Compensate for the inset caused by smoothing a rigid hinge while retaining mattress arc length.
function bendShift(angle, width) {
  if (angle < 1e-8) return 0;
  let integral = 0;
  for (let i = 0; i < 32; i++) integral += Math.sin(angle * smooth(0, 1, (i + 0.5) / 32));
  return width * (integral / 32 / Math.sin(angle) - 0.5);
}
function bendCenters(b, l, c) {
  return {
    back: LINKAGE.backHinge.z + bendShift(b, 0.54),
    leg: LINKAGE.legHinge.z - bendShift(l, 0.3),
    knee: LINKAGE.flatKnee.z + 0.022 * Math.min(1, (l + c) / 0.8),
  };
}
function spineAngle(s, b, l, c, centers = bendCenters(b, l, c)) {
  return (
    b * (1 - smooth(centers.back - 0.27, centers.back + 0.27, s)) -
    l * smooth(centers.leg - 0.15, centers.leg + 0.15, s) +
    (l + c) * smooth(centers.knee - 0.09, centers.knee + 0.09, s)
  );
}
export function angleAt(s, back, leg) {
  const p = solveMechanism(back, leg);
  return spineAngle(s, p.back, p.leg, p.calf);
}

// Arc-length sampling keeps the cushion continuous while the three hinges bend.
export function buildSpine(back, leg, count = 420) {
  const min = -DIMENSIONS.length / 2,
    step = DIMENSIONS.length / count;
  const pose = solveMechanism(back, leg),
    centers = bendCenters(pose.back, pose.leg, pose.calf),
    angle = (s) => spineAngle(s, pose.back, pose.leg, pose.calf, centers);
  const samples = [{ y: 0, z: min, angle: angle(min) }];
  for (let i = 1; i <= count; i++) {
    const a = angle(min + (i - 0.5) * step);
    const prev = samples[i - 1];
    samples.push({
      y: prev.y - Math.sin(a) * step,
      z: prev.z + Math.cos(a) * step,
      angle: angle(min + i * step),
    });
  }
  const anchor = Math.round((0.0 - min) / step);
  const dy = DIMENSIONS.deckHeight - samples[anchor].y,
    dz = -samples[anchor].z;
  for (const p of samples) {
    p.y += dy;
    p.z += dz;
  }
  return { samples, min, step, count };
}
export function sampleSpine(spine, s) {
  const f = clamp((s - spine.min) / spine.step, 0, spine.count);
  const i = Math.min(Math.floor(f), spine.count - 1),
    t = f - i;
  const a = spine.samples[i],
    b = spine.samples[i + 1];
  return {
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    angle: a.angle + (b.angle - a.angle) * t,
  };
}
export function surfaceLift(x, z, pressures, airbags = DEFAULT_AIR_BAGS) {
  let lift = 0;
  for (const bag of airbags) {
    lift +=
      ((bag.maxLift * clamp(pressures[bag.side][bag.zone], 0, 100)) / 100) *
      Math.exp(-Math.pow((x - bag.x) / bag.spreadX, 4) - Math.pow((z - bag.z) / bag.spread, 4));
  }
  return lift;
}
export function mapPoint(spine, x, y, z, pressures, inflate = true, airbags = DEFAULT_AIR_BAGS) {
  const p = sampleSpine(spine, z);
  const height = y + (inflate ? surfaceLift(x, z, pressures, airbags) * smooth(0.025, 0.2, y) : 0);
  return { x, y: p.y + height * Math.cos(p.angle), z: p.z + height * Math.sin(p.angle) };
}

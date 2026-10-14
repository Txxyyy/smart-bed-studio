import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpine,
  sampleSpine,
  surfaceLift,
  mapPoint,
  angleAt,
  PRESETS,
  ZONES,
  DIMENSIONS,
} from './kinematics.js';
import { AIR_LAYOUT } from './dimensions.js';

const empty = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  full = [
    [100, 100, 100, 100],
    [100, 100, 100, 100],
  ];
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('flat pose preserves mattress coordinates and dimensions', () => {
  const spine = buildSpine(0, 0);
  for (let z = -DIMENSIONS.length / 2; z <= DIMENSIONS.length / 2; z += 0.01) {
    const p = mapPoint(spine, DIMENSIONS.width / 2, 0.21, z, empty);
    near(p.x, DIMENSIONS.width / 2);
    near(p.y, DIMENSIONS.deckHeight + 0.21);
    near(p.z, z);
  }
});
test('seat anchor stays fixed for every preset and extreme angles', () => {
  for (const p of [...Object.values(PRESETS), { back: 65, leg: 35 }]) {
    const a = sampleSpine(buildSpine(p.back, p.leg), 0);
    near(a.y, DIMENSIONS.deckHeight);
    near(a.z, 0);
  }
});
test('spine conserves arc length during articulation', () => {
  for (const back of [0, 28, 52, 65])
    for (const leg of [0, 24, 35]) {
      const s = buildSpine(back, leg);
      let length = 0;
      for (let i = 1; i < s.samples.length; i++)
        length += Math.hypot(
          s.samples[i].y - s.samples[i - 1].y,
          s.samples[i].z - s.samples[i - 1].z,
        );
      near(length, DIMENSIONS.length);
    }
});
test('fully inflated top does not fold back along the centerline at extreme angles', () => {
  for (const back of [0, 28, 52, 65])
    for (const leg of [0, 24, 35])
      for (const x of [-0.75, -AIR_LAYOUT.centerX, 0, AIR_LAYOUT.centerX, 0.75]) {
        const s = buildSpine(back, leg);
        let prev = mapPoint(s, x, 0.228, -DIMENSIONS.length / 2, full);
        for (let z = -DIMENSIONS.length / 2 + 0.002; z <= DIMENSIONS.length / 2; z += 0.002) {
          const p = mapPoint(s, x, 0.228, z, full),
            a = sampleSpine(s, z - 0.001).angle;
          const tangentProgress = (p.y - prev.y) * -Math.sin(a) + (p.z - prev.z) * Math.cos(a);
          assert.ok(tangentProgress > 0, `folded surface at back ${back}, leg ${leg}, z ${z}`);
          assert.ok(Number.isFinite(p.y));
          prev = p;
        }
      }
});
test('left and right air zones independently lift the matching surface', () => {
  const left = [
      [0, 100, 0, 0],
      [0, 0, 0, 0],
    ],
    right = [
      [0, 0, 0, 0],
      [0, 100, 0, 0],
    ];
  near(surfaceLift(-AIR_LAYOUT.centerX, ZONES[1].z, left), 0.055);
  near(surfaceLift(AIR_LAYOUT.centerX, ZONES[1].z, right), 0.055);
  assert.ok(surfaceLift(AIR_LAYOUT.centerX, ZONES[1].z, left) < 1e-10);
  assert.ok(surfaceLift(-AIR_LAYOUT.centerX, ZONES[1].z, right) < 1e-10);
});
test('inflation lifts the top while preserving its foundation', () => {
  const spine = buildSpine(0, 0),
    base0 = mapPoint(spine, -AIR_LAYOUT.centerX, 0.02, ZONES[1].z, empty),
    base1 = mapPoint(spine, -AIR_LAYOUT.centerX, 0.02, ZONES[1].z, full);
  near(base0.y, base1.y);
  assert.ok(
    mapPoint(spine, -AIR_LAYOUT.centerX, 0.228, ZONES[1].z, full).y >
      mapPoint(spine, -AIR_LAYOUT.centerX, 0.228, ZONES[1].z, empty).y + 0.05,
  );
});
test('angle inputs are clamped and samples outside mattress remain finite', () => {
  near(angleAt(-1, 100, -20), (65 * Math.PI) / 180);
  near(angleAt(-1, -5, 100), 0);
  for (const z of [-10, 10]) {
    const p = sampleSpine(buildSpine(65, 35), z);
    assert.ok(Number.isFinite(p.y) && Number.isFinite(p.z));
  }
});

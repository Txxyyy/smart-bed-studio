import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRegistry } from './model-profiles.js';
import { MassageSurfaceCache } from './massage-surface.js';
import { massageSurfaceLift } from './massage.js';
import { MassageEffect } from './massage-effect.js';
import { buildSpine, mapPoint } from './kinematics.js';
const profile = new ModelRegistry().resolve('T12');
test('cached spatial weights match original massage function across footprint and phases', () => {
  const points = Array.from({ length: 999 }, (_, i) => ({
      x: ((i % 37) / 36) * 1.6 - 0.8,
      z: (Math.floor(i / 37) / 26) * 1.9 - 0.95,
    })),
    cache = new MassageSurfaceCache(profile.massage, points);
  for (const phase of [0, 0.07, 0.25, 0.49, 0.73, 0.99]) {
    const lanes = {
      left: { amount: 1, intensity: 0.8, phase },
      right: { amount: 0.6, intensity: 1, phase: 1 - phase },
    };
    const heights = cache.update(lanes);
    points.forEach((p, i) =>
      assert.ok(
        Math.abs(heights[i] - massageSurfaceLift(profile.massage, lanes, p.x, p.z)) < 1e-14,
      ),
    );
  }
  assert.ok(cache.update({}).every((h) => h === 0));
  assert.ok(new MassageSurfaceCache([], points).update({}).every((h) => h === 0));
});
test('all visible massage vertices retain original positions at flat and maximum bend', () => {
  const effect = new MassageEffect(profile.massage, profile.airbags, 0.26);
  effect.root.visible = true;
  for (const [back, leg, phase] of [
    [0, 0, 0.1],
    [65, 35, 0.4],
  ]) {
    const spine = buildSpine(back, leg),
      lanes = {
        left: { amount: 1, intensity: 1, phase },
        right: { amount: 0.8, intensity: 0.6, phase: phase + 0.2 },
      };
    effect.update({ spine, lanes });
    for (const entry of effect.entries) {
      const meshes = [
        ...entry.glows.map((g) => ({ mesh: g.mesh, x: g.x, z: g.z, y: 0.263 })),
        ...entry.pads.map((p) => ({
          mesh: p.ripple,
          x: p.definition.x,
          z: p.definition.z,
          y: 0.264,
        })),
      ];
      for (const { mesh, x, z, y } of meshes) {
        const rest = mesh.userData.rest,
          positions = mesh.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          const px = x + rest.getX(i),
            pz = z + rest.getZ(i),
            p = mapPoint(
              spine,
              px,
              y + massageSurfaceLift(profile.massage, lanes, px, pz),
              pz,
              null,
              false,
            );
          assert.ok(Math.abs(positions.getY(i) - p.y) < 1e-6);
          assert.ok(Math.abs(positions.getZ(i) - p.z) < 1e-6);
        }
      }
    }
  }
  effect.root.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
});

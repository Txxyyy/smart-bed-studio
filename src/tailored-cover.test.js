import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HeatingEffect } from './heating-effect.js';
import { buildSpine, mapPoint } from './kinematics.js';
import { SHOWROOM_LAYOUT } from './dimensions.js';
import { handleRelief } from './tailored-attachments.js';
import { TAILORED_COVER, T12_FRONT_MARKS } from './dimensions.js';
import { SmartBed } from './model.js';
import { MATERIAL_CONFIG } from './materials.js';
import { ModelRegistry } from './model-profiles.js';
import { tailoredTextile, quiltValley } from './tailored-textile.js';

test('T12 revision 8 has its own upper band and leaves existing profiles unchanged', () => {
  const registry = new ModelRegistry(),
    t12 = registry.resolve('T12');
  assert.equal(t12.revision, 8);
  assert.equal(t12.appearance.coverStyle, 'tailored');
  assert.equal(t12.appearance.materials.waistband.pattern, 't12Tape');
  for (const id of ['T11+', 'generic'])
    assert.equal(registry.resolve(id).appearance.coverStyle, undefined);
  // Stitching runs across the bed width, independently of diagonal fabric motifs.
  assert.equal(quiltValley(0.1, 0.1), quiltValley(0.8, 0.1));
  assert.ok(quiltValley(0.1, 0.1) > 0.99);
  assert.ok(quiltValley(0.1, 0.1 + 1 / 60) < 0.01);
  for (const pattern of ['t12Rib', 't12Border']) {
    let maxJump = 0;
    for (let i = 0; i < 1000; i++)
      maxJump = Math.max(
        maxJump,
        Math.abs(
          tailoredTextile(pattern, i / 1000, 0.37).color -
            tailoredTextile(pattern, i / 1000 + 1e-6, 0.37).color,
        ),
      );
    assert.ok(maxJump < 0.1, 'woven motif must not have hard cell boundaries');
  }
  for (const pattern of ['t12Rib', 't12Border', 't12Tape'])
    for (const u of [0, 0.12, 0.999])
      for (const v of [0, 0.43, 0.999]) {
        for (const [key, value] of Object.entries(tailoredTextile(pattern, u, v)))
          assert.ok(
            Math.abs(value - tailoredTextile(pattern, u + 1, v + 1)[key]) < 1e-7,
            `${pattern} must tile without a seam`,
          );
      }
});

test('upper band and double welt stay attached through articulation and scan restoration', () => {
  const materials = Object.fromEntries(
    Object.keys(MATERIAL_CONFIG).map((id) => [id, new THREE.MeshStandardMaterial({ name: id })]),
  );
  const bed = new SmartBed({ get: (id) => materials[id] }, { coverStyle: 'tailored' });
  assert.equal(bed.tailoredDetails.filter((m) => m.name.includes('Cloth_Strap')).length, 4);
  const state = {
    pressures: [
      [100, 0, 65, 25],
      [0, 100, 25, 65],
    ],
    xray: 0,
    explode: 0,
    showroom: true,
  };
  for (const style of ['flush', 'wide'])
    for (const [back, leg] of [
      [0, 0],
      [65, 35],
    ]) {
      bed.setSurroundStyle(style);
      bed.update({
        ...state,
        back,
        leg,
        airReveal: { side: 'left', phase: 'adjust', progress: 1 },
      });
      for (const detail of bed.tailoredDetails) {
        assert.ok(detail.visible);
        assert.equal(detail.material, bed.coverReveal.copies.get(detail.sourceMaterial));
        const position = detail.geometry.attributes.position,
          source = bed.cover.geometry.attributes.position,
          expected = new THREE.Vector3(),
          point = new THREE.Vector3();
        for (let i = 0; i < position.count; i++) {
          const { ids, weights, lift } = detail.surfaceBinding.bindings[i];
          expected.set(0, 0, 0);
          ids.forEach((id, k) =>
            expected.addScaledVector(point.fromBufferAttribute(source, id), weights[k]),
          );
          const distance = expected.distanceTo(point.fromBufferAttribute(position, i));
          assert.ok(Math.abs(distance - lift) < 0.00001, `detached trim: ${style} ${back}/${leg}`);
        }
      }
      bed.update({ ...state, back, leg, airReveal: { phase: 'closed' } });
      for (const detail of bed.tailoredDetails)
        assert.equal(detail.material, detail.sourceMaterial);
      bed.update({ ...state, back, leg, explode: 1 });
      for (const detail of bed.tailoredDetails) assert.equal(detail.visible, false);
    }
});

test('T12 corner fabric coordinates agree across adjoining cover faces', () => {
  const materials = Object.fromEntries(
    Object.keys(MATERIAL_CONFIG).map((id) => [id, new THREE.MeshStandardMaterial({ name: id })]),
  );
  const bed = new SmartBed({ get: (id) => materials[id] }, { coverStyle: 'tailored' }),
    g = bed.cover.geometry,
    p = g.attributes.position,
    uv = g.attributes.uv,
    seen = new Map();
  for (const group of g.groups)
    if ([0, 1, 4, 5].includes(group.materialIndex)) {
      for (let j = group.start; j < group.start + group.count; j++) {
        const i = g.index.getX(j),
          key = [p.getX(i), p.getY(i), p.getZ(i)].map((v) => v.toFixed(6)).join(',');
        if (seen.has(key))
          assert.ok(
            Math.abs(
              (uv.getX(i) - seen.get(key)) / 4 - Math.round((uv.getX(i) - seen.get(key)) / 4),
            ) < 1e-5,
            'cloth jumps at the corner',
          );
        seen.set(key, uv.getX(i));
      }
    }
  const lower = bed.tailoredDetails.find((m) => m.name === 'Tailored_Second_Black_Welt');
  const lifts = lower.surfaceBinding.bindings.map((b) => b.lift);
  assert.ok(
    Math.max(...lifts) - Math.min(...lifts) > 0.002,
    'welt must have a rounded cross section',
  );
});

test('T12 has independent photo-fit height and front label placement', () => {
  const materials = Object.fromEntries(
    Object.keys(MATERIAL_CONFIG).map((id) => [id, new THREE.MeshStandardMaterial({ name: id })]),
  );
  const lib = { get: (id) => materials[id] },
    bed = new SmartBed(lib, { coverStyle: 'tailored' }),
    standard = new SmartBed(lib);
  assert.equal(bed.mattressHeight, 0.26);
  assert.equal(standard.mattressHeight, 0.21);
  assert.equal(bed.surfaceTop, 0.278);
  const top = bed.cover.geometry.attributes.position;
  assert.ok(
    Math.abs(Math.max(...Array.from({ length: top.count }, (_, i) => top.getY(i))) - 0.278) < 0.003,
  );
  const mark = bed.branding.find((m) => m.name === 'Mattress_T12');
  assert.equal(mark.geometry.parameters.height, 0.055);
  assert.ok(mark.surfaceBinding.bindings.every((b) => b.weights.every(Number.isFinite)));
});

test('T12 heating follows the taller shell at flat and maximum angles', () => {
  const heat = new HeatingEffect(undefined, undefined, 0.278);
  heat.root.visible = true;
  const pressures = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  for (const [back, leg] of [
    [0, 0],
    [65, 35],
  ]) {
    const spine = buildSpine(back, leg);
    heat.update({
      spine,
      pressures,
      heating: [
        [3, 3],
        [3, 3],
      ],
      time: 0,
      moving: false,
    });
    for (const entry of heat.entries) {
      const p = entry.mesh.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const expected = mapPoint(
          spine,
          entry.definition.x + entry.rest.getX(i),
          0.278 + SHOWROOM_LAYOUT.heatGap,
          entry.definition.z + entry.rest.getZ(i),
          pressures,
        );
        assert.ok(Math.abs(p.getY(i) - expected.y) < 1e-6);
        assert.ok(Math.abs(p.getZ(i) - expected.z) < 1e-6);
      }
    }
  }
});

test('T12 handles keep both ends sewn down and the logo on the raised fabric', () => {
  const d = TAILORED_COVER;
  assert.equal(handleRelief(0, -d.strapHeight / 2), 0);
  assert.equal(handleRelief(0, d.strapHeight / 2), 0);
  assert.ok(handleRelief(0, 0) > 0.004);
  assert.ok(T12_FRONT_MARKS[0].y < 0.15, 'front wordmark must not return to the upper edge');
  const materials = Object.fromEntries(
    Object.keys(MATERIAL_CONFIG).map((id) => [id, new THREE.MeshStandardMaterial({ name: id })]),
  );
  const bed = new SmartBed({ get: (id) => materials[id] }, { coverStyle: 'tailored' });
  for (const m of bed.tailoredDetails.filter((m) => m.name.endsWith('_Gold_Wordmark'))) {
    assert.equal(
      m.sourceMaterial,
      materials.retainerLogo,
      'side handles use wordmark without front AI badge',
    );
    assert.ok(
      Math.min(...m.surfaceBinding.bindings.map((b) => b.lift)) > 0.006,
      'ink follows the raised handle center',
    );
  }
});

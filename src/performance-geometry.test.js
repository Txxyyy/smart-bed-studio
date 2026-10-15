import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SmartBed } from './model.js';
import { FirmnessEffect } from './firmness-effect.js';
import { ModelRegistry } from './model-profiles.js';
import { DeviceState } from './device-state.js';
import { MATERIAL_CONFIG } from './materials.js';
import { buildSpine, mapPoint } from './kinematics.js';

const profile = new ModelRegistry().resolve('T12');
const version = (mesh) => mesh.geometry.attributes.position.version;
function fixture() {
  const materials = Object.fromEntries(
    Object.keys(MATERIAL_CONFIG).map((id) => [id, new THREE.MeshStandardMaterial()]),
  );
  const bed = new SmartBed(
    { get: (id) => materials[id] },
    { coverStyle: 'tailored', airbags: profile.airbags, massage: profile.massage },
  );
  const state = {
    ...new DeviceState(profile).targets(),
    back: 0,
    leg: 0,
    explode: 0,
    xray: 0,
    showroom: true,
    airReveal: { phase: 'adjust', side: 'left', progress: 1 },
  };
  return { bed, state };
}

test('unchanged geometry is not uploaded again while cover visibility and materials still update', () => {
  const { bed, state } = fixture();
  bed.update(state);
  const visible = bed.airbags.filter((b) => b.side === 1),
    hidden = bed.airbags.filter((b) => b.side === 0);
  const coverVersion = version(bed.cover),
    detailVersion = version(bed.coverDetails[0]),
    spine = bed.spine;
  const airVersions = visible.map((b) => version(b.cells[0]));
  assert.ok(hidden.every((b) => version(b.cells[0]) === 0));
  bed.update(structuredClone(state));
  assert.equal(bed.spine, spine);
  assert.equal(version(bed.cover), coverVersion);
  assert.equal(version(bed.coverDetails[0]), detailVersion);
  assert.deepEqual(
    visible.map((b) => version(b.cells[0])),
    airVersions,
  );
  // Reports can mutate pressure arrays in place; only the affected visible row changes.
  state.pressures[1][0] = 80;
  state.pressures[0][0] = 70;
  bed.update(state);
  assert.equal(version(visible[0].cells[0]), airVersions[0] + 1);
  assert.equal(version(visible[1].cells[0]), airVersions[1]);
  assert.equal(version(bed.cover), coverVersion);
  assert.equal(version(bed.coverDetails[0]), detailVersion);
  assert.ok(hidden.every((b) => version(b.cells[0]) === 0));
  bed.update({ ...state, airReveal: { phase: 'closed' } });
  assert.equal(bed.airGroup.visible, false);
  assert.equal(bed.cover.material, bed.coverMaterials);
  bed.update(state);
  assert.equal(bed.airGroup.visible, true);
  assert.notEqual(bed.cover.material, bed.coverMaterials);
  assert.equal(version(visible[0].cells[0]), airVersions[0] + 1);
});

test('hidden air rows catch up on reveal and cached cover/bindings follow massage, pose and explode changes', () => {
  const { bed, state } = fixture();
  bed.update(state);
  const flat = bed.cover.geometry.attributes.position.array.slice(),
    initial = version(bed.cover);
  state.massage = { left: { amount: 1, intensity: 1, phase: 0 } };
  bed.update(state);
  assert.ok(version(bed.cover) > initial);
  assert.notDeepEqual(bed.cover.geometry.attributes.position.array, flat);
  const massageVersion = version(bed.cover),
    detailVersion = version(bed.coverDetails[0]);
  bed.update(structuredClone(state));
  assert.equal(version(bed.cover), massageVersion);
  assert.equal(version(bed.coverDetails[0]), detailVersion);
  delete state.massage;
  bed.update(state);
  assert.deepEqual(bed.cover.geometry.attributes.position.array, flat);
  for (const style of ['wide', 'flush']) {
    bed.setSurroundStyle(style);
    state.back = 65;
    state.leg = 35;
    state.pressures[0][0] = 100;
    state.airReveal = { phase: 'adjust', side: 'right', progress: 1 };
    bed.update(state);
    const bag = bed.airbags.find((b) => b.side === 0),
      cell = bag.cells[0],
      rest = cell.userData.rest;
    const h = bag.minHalfHeight + bag.halfHeightRange,
      expected = mapPoint(
        bed.spine,
        bag.x + rest[0],
        bag.bottom + h + (rest[1] * h) / 0.06,
        bag.z + rest[2],
        null,
        false,
      );
    const position = cell.geometry.attributes.position;
    assert.ok(
      Math.hypot(
        position.getX(0) - expected.x,
        position.getY(0) - expected.y,
        position.getZ(0) - expected.z,
      ) < 1e-6,
    );
    assert.ok(position.array.every(Number.isFinite));
    assert.ok(bed.cover.geometry.attributes.normal.array.every(Number.isFinite));
    bed.update({ ...state, showroom: false, explode: 1 });
    assert.equal(bed.cover.visible, false);
    bed.update(state);
    assert.equal(bed.cover.visible, true);
    assert.ok(
      bed.coverDetails.every((d) => d.geometry.attributes.position.array.every(Number.isFinite)),
    );
  }
});

test('hologram time animation avoids static geometry work and hidden sides update when shown', () => {
  const effect = new FirmnessEffect(profile.airbags);
  effect.root.visible = true;
  const pressures = [Array(9).fill(50), Array(9).fill(50)],
    spine = buildSpine(0, 0);
  const state = {
    spine,
    pressures,
    selection: { side: 'left', kind: 'air', activeRegionIds: ['left.circuit2'] },
    time: 1,
    moving: true,
  };
  effect.update(state);
  const active = effect.entries.find((e) => e.definition.regionId === 'left.circuit2'),
    hidden = effect.entries.filter((e) => e.side === 0);
  const tileVersion = version(active.tile),
    pulseVersion = version(active.pulse),
    particleVersion = version(active.particles);
  effect.update({ ...state, time: 2 });
  assert.equal(version(active.tile), tileVersion);
  assert.equal(version(active.pulse), pulseVersion);
  assert.equal(version(active.particles), particleVersion);
  assert.ok(active.tile.material.uniforms.time.value > 0);
  assert.ok(hidden.every((e) => version(e.tile) === 0 && !e.tile.visible));
  assert.ok(!active.particles.visible && !active.pulse.visible);
  pressures[1][active.zone] = 85;
  effect.update({ ...state, time: 3 });
  assert.equal(version(active.tile), tileVersion + 1);
  const before = version(active.tile);
  effect.update({ ...state, selection: { ...state.selection, kind: 'heat' }, time: 4 });
  assert.ok(
    effect.entries.every((e) => !e.tile.visible && !e.pulse.visible && !e.particles.visible),
  );
  assert.equal(version(active.tile), before);
  effect.update({
    ...state,
    spine: buildSpine(65, 35),
    selection: { side: 'right', kind: 'air', activeRegionIds: ['right.circuit7'] },
    time: 5,
  });
  assert.ok(
    hidden.every(
      (e) =>
        version(e.tile) > 0 &&
        e.tile.visible &&
        e.tile.geometry.attributes.position.array.every(Number.isFinite),
    ),
  );
  assert.equal(effect.surface.entries.filter((e) => e.mesh.visible).length, 2);
});

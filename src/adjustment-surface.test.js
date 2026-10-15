import test from 'node:test';
import assert from 'node:assert/strict';
import { FirmnessEffect } from './firmness-effect.js';
import { AdjustmentSurface, adjustmentDirection } from './adjustment-surface.js';
import { BUILTIN_PROFILES } from './model-profiles.js';
import { buildSpine, mapPoint } from './kinematics.js';
test('surface direction uses explicit state and follows both articulation extremes', () => {
  const profile = BUILTIN_PROFILES.find((p) => p.id === 't12');
  const surface = new AdjustmentSurface(profile.airbags, 0.228);
  const id = 'left.circuit4',
    state = { selection: { activeRegionIds: [id] }, time: 1, moving: true };
  assert.equal(adjustmentDirection('adjusting'), 0);
  for (const [status, direction] of [
    ['inflating', 1],
    ['deflating', -1],
    ['idle', 0],
    ['fault', 0],
  ]) {
    for (const pose of [
      [0, 0],
      [65, 35],
    ]) {
      surface.update({ ...state, spine: buildSpine(...pose), airStates: { [id]: { status } } });
      const visible = surface.entries.filter((e) => e.mesh.visible);
      assert.equal(visible.length, 1);
      assert.equal(visible[0].mesh.material.uniforms.direction.value, direction);
      assert.ok([...visible[0].mesh.geometry.attributes.position.array].every(Number.isFinite));
    }
  }
  surface.update({ ...state, spine: buildSpine(0, 0), moving: false });
  assert.equal(surface.entries.find((e) => e.id === id).mesh.material.uniforms.moving.value, 0);
  surface.update({ ...state, spine: buildSpine(0, 0), selection: { activeRegionIds: [] } });
  assert.ok(surface.entries.every((e) => !e.mesh.visible));
  surface.root.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
});

test('energy phase freezes during inactive frames and resumes without catching up', () => {
  const profile = BUILTIN_PROFILES.find((p) => p.id === 't12');
  const surface = new AdjustmentSurface(profile.airbags, 0.228);
  const id = 'left.circuit4',
    spine = buildSpine(0, 0);
  const state = {
    spine,
    selection: { activeRegionIds: [id] },
    airStates: { [id]: { status: 'inflating' } },
  };
  const entry = surface.entries.find((e) => e.id === id),
    phase = () => entry.mesh.material.uniforms.time.value;
  surface.update({ ...state, time: 1, moving: true });
  surface.update({ ...state, time: 1.05, moving: true });
  const running = phase();
  assert.ok(running > 0);
  surface.update({ ...state, time: 2, moving: false });
  surface.update({ ...state, time: 5, moving: false });
  assert.equal(phase(), running);
  surface.update({ ...state, time: 6, moving: true });
  assert.equal(phase(), running);
  surface.update({ ...state, time: 6.05, moving: true });
  assert.ok(phase() > running && phase() < running + 0.06);
  const version = entry.mesh.geometry.attributes.position.version;
  surface.update({ ...state, time: 6.1, moving: true });
  assert.equal(entry.mesh.geometry.attributes.position.version, version);
  surface.root.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
});

test('energy panel follows the displayed pressure of its circuit without moving the other side', () => {
  const profile = BUILTIN_PROFILES.find((p) => p.id === 't12');
  const surface = new AdjustmentSurface(profile.airbags, 0.228);
  const pressures = [Array(9).fill(15), Array(9).fill(15)];
  const state = {
    spine: buildSpine(0, 0),
    selection: { activeRegionIds: ['left.circuit4', 'right.circuit4'] },
    time: 0,
    moving: false,
    pressures,
  };
  surface.update(state);
  const left = surface.entries.find((e) => e.id === 'left.circuit4');
  const right = surface.entries.find((e) => e.id === 'right.circuit4');
  const y = left.mesh.geometry.attributes.position.getY(0);
  const rightVersion = right.mesh.geometry.attributes.position.version;
  pressures[1][4] = 85;
  surface.update(state);
  assert.ok(Math.abs(left.mesh.geometry.attributes.position.getY(0) - y - 0.063) < 1e-6);
  assert.equal(right.mesh.geometry.attributes.position.version, rightVersion);
  surface.root.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
});

test('each physical row keeps its own footprint and tracks the actual bag top at both pose extremes', () => {
  for (const profile of BUILTIN_PROFILES) {
    const surface = new AdjustmentSurface(profile.airbags);
    const pressures = [Array(16).fill(85), Array(16).fill(15)];
    for (const pose of [
      [0, 0],
      [65, 35],
    ]) {
      const spine = buildSpine(...pose);
      surface.update({
        spine,
        pressures,
        selection: { activeRegionIds: profile.regions.map((r) => r.id) },
        time: 0,
        moving: false,
      });
      assert.equal(surface.entries.filter((e) => e.mesh.visible).length, profile.airbags.length);
      for (const entry of surface.entries) {
        const bag = entry.bag,
          size = entry.mesh.material.uniforms.fieldSize.value;
        assert.equal(size.x, bag.width);
        assert.equal(size.y, bag.depth);
        const height =
          bag.bottom +
          2 * (bag.minHalfHeight + (pressures[bag.side][bag.zone] / 100) * bag.halfHeightRange) +
          0.006;
        for (let i = 0; i < entry.rest.count; i++) {
          const expected = mapPoint(
            spine,
            bag.x + entry.rest.getX(i),
            height,
            bag.z + entry.rest.getZ(i),
            null,
            false,
          );
          const actual = entry.mesh.geometry.attributes.position;
          assert.ok(
            Math.hypot(
              actual.getX(i) - expected.x,
              actual.getY(i) - expected.y,
              actual.getZ(i) - expected.z,
            ) < 1e-6,
          );
        }
        assert.ok(
          entry.mesh.renderOrder < 4,
          'internal light must be drawn before the depth-writing cover',
        );
        assert.equal(entry.mesh.material.depthTest, true);
      }
    }
    surface.root.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
});

test('bag-side light flow uses explicit direction and stays frozen during paused frames', () => {
  const profile = BUILTIN_PROFILES.find((p) => p.id === 't12');
  const effect = new FirmnessEffect(profile.airbags);
  effect.root.visible = true;
  const state = {
    spine: buildSpine(0, 0),
    pressures: [Array(9).fill(50), Array(9).fill(50)],
    selection: { side: 'left', kind: 'air', activeRegionIds: ['left.circuit4'] },
    time: 0,
    moving: true,
  };
  const row = effect.entries.find((e) => e.definition.regionId === 'left.circuit4');
  for (const [status, direction] of [
    ['inflating', 1],
    ['deflating', -1],
    ['adjusting', 0],
    ['idle', 0],
    ['fault', 0],
  ]) {
    effect.update({ ...state, airStates: { 'left.circuit4': { status } } });
    assert.equal(row.tile.material.uniforms.direction.value, direction);
    assert.ok(
      effect.entries
        .filter((e) => e !== row)
        .every((e) => e.tile.material.uniforms.direction.value === 0),
    );
  }
  effect.update({ ...state, time: 0.05 });
  const phase = row.tile.material.uniforms.time.value;
  effect.update({ ...state, time: 3, moving: false });
  effect.update({ ...state, time: 10, moving: false });
  assert.equal(row.tile.material.uniforms.time.value, phase);
  assert.ok(!row.pulse.visible && !row.particles.visible);
  effect.root.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
});

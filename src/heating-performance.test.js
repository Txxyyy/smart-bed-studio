import test from 'node:test';
import assert from 'node:assert/strict';
import { HeatingEffect } from './heating-effect.js';
import { ModelRegistry } from './model-profiles.js';
import { buildSpine, mapPoint } from './kinematics.js';
import { massageSurfaceLift } from './massage.js';
import { SHOWROOM_LAYOUT } from './dimensions.js';

function fixture(t) {
  const profile = new ModelRegistry().resolve('T12'),
    heat = new HeatingEffect(profile.heating, profile.airbags, 0.26);
  heat.root.visible = true;
  t.after(() =>
    heat.root.traverse((object) => {
      object.geometry?.dispose();
      object.material?.dispose();
    }),
  );
  return {
    heat,
    profile,
    state: {
      spine: buildSpine(0, 0),
      heating: [
        [0, 0],
        [0, 0],
      ],
      time: 0,
      moving: true,
    },
  };
}
const versions = (heat) => heat.entries.map((e) => e.mesh.geometry.attributes.position.version);
function assertOnSurface(heat, entry, state) {
  const { definition, rest, mesh } = entry,
    positions = mesh.geometry.attributes.position;
  for (let i = 0; i < rest.count; i++) {
    const x = definition.x + rest.getX(i),
      z = definition.z + rest.getZ(i);
    const expected = mapPoint(
      state.spine,
      x,
      heat.surfaceTop +
        SHOWROOM_LAYOUT.heatGap +
        massageSurfaceLift(state.massageChannels || [], state.massage, x, z),
      z,
      null,
      false,
    );
    assert.ok(
      Math.hypot(
        positions.getX(i) - expected.x,
        positions.getY(i) - expected.y,
        positions.getZ(i) - expected.z,
      ) < 1e-6,
    );
  }
}

test('inactive heat patches perform no geometry work and initialize on first activation', (t) => {
  const { heat, state } = fixture(t),
    before = versions(heat);
  heat.update(state);
  assert.deepEqual(versions(heat), before);
  assert.ok(heat.entries.every((e) => !e.mesh.visible && !e.waves.visible));
  assert.equal(heat.surfaceState, null);
  state.spine = buildSpine(65, 35);
  state.heating[1][0] = 3;
  heat.update(state);
  for (const [i, entry] of heat.entries.entries()) {
    if (entry.mesh.visible) {
      assert.equal(entry.mesh.geometry.attributes.position.version, before[i] + 1);
      assertOnSurface(heat, entry, state);
    } else assert.equal(entry.mesh.geometry.attributes.position.version, before[i]);
  }
});

test('time and heat level animate uniforms and waves without re-uploading unchanged surface geometry', (t) => {
  const { heat, state } = fixture(t);
  state.heating = [
    [3, 3],
    [3, 3],
  ];
  heat.update(state);
  const surfaceVersions = versions(heat),
    waveVersions = heat.entries.map((e) => e.waves.geometry.attributes.position.version);
  state.spine = buildSpine(0, 0);
  state.time = 2;
  state.heating[0][0] = 1;
  state.pressures = [Array(9).fill(100), Array(9).fill(0)];
  heat.update(state);
  assert.deepEqual(versions(heat), surfaceVersions);
  for (const [i, entry] of heat.entries.entries()) {
    assert.equal(entry.mesh.material.uniforms.time.value, 2);
    assert.equal(
      entry.mesh.material.uniforms.amount.value,
      state.heating[entry.side][entry.region] / entry.definition.maxLevel,
    );
    assert.equal(entry.waves.geometry.attributes.position.version, waveVersions[i] + 1);
  }
  state.time = 3;
  state.moving = false;
  heat.update(state);
  assert.deepEqual(versions(heat), surfaceVersions);
  assert.ok(
    heat.entries.every((e) => !e.waves.visible && e.mesh.material.uniforms.moving.value === 0),
  );
});

test('cached heat surfaces follow articulation and evolving massage, but reuse paused and stopped shapes', (t) => {
  const { heat, profile, state } = fixture(t);
  state.heating = [
    [3, 3],
    [3, 3],
  ];
  state.massageChannels = profile.massage;
  state.massage = {
    left: { amount: 1, intensity: 1, phase: 0 },
    right: { amount: 0, intensity: 1, phase: 0 },
  };
  heat.update(state);
  const before = versions(heat);
  state.spine = buildSpine(65, 35);
  state.massage.left.phase = 0.19;
  heat.update(state);
  assert.deepEqual(
    versions(heat),
    before.map((v) => v + 1),
  );
  for (const entry of heat.entries) assertOnSurface(heat, entry, state);
  const paused = versions(heat);
  state.massage = structuredClone(state.massage);
  state.time = 4;
  heat.update(state);
  assert.deepEqual(versions(heat), paused);
  state.massage.left.amount = 0;
  heat.update(state);
  const stopped = versions(heat);
  assert.deepEqual(
    stopped,
    paused.map((v) => v + 1),
  );
  for (const entry of heat.entries) assertOnSurface(heat, entry, state);
  state.massage.left.phase = 0.8;
  state.massage.right.phase = 0.9;
  heat.update(state);
  assert.deepEqual(versions(heat), stopped);
});

test('a reopened heat zone catches up to pose and massage changes while it was off', (t) => {
  const { heat, profile, state } = fixture(t);
  state.heating = [
    [3, 3],
    [3, 3],
  ];
  heat.update(state);
  const entry = heat.entries[0],
    before = entry.mesh.geometry.attributes.position.version;
  state.heating[entry.side][entry.region] = 0;
  state.spine = buildSpine(65, 35);
  state.massageChannels = profile.massage;
  state.massage = {
    left: { amount: 1, intensity: 1, phase: 0.1 },
    right: { amount: 1, intensity: 1, phase: 0.5 },
  };
  heat.update(state);
  assert.equal(entry.mesh.visible, false);
  assert.equal(entry.mesh.geometry.attributes.position.version, before);
  state.heating[entry.side][entry.region] = 3;
  heat.update(state);
  assert.equal(entry.mesh.visible, true);
  assert.equal(entry.mesh.geometry.attributes.position.version, before + 1);
  assertOnSurface(heat, entry, state);
});

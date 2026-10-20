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

test('massage frames reuse per-pose curve samples and still match the original surface formula', (t) => {
  const { heat, profile, state } = fixture(t);
  state.heating = [
    [3, 3],
    [3, 3],
  ];
  state.moving = false;
  // 同一姿态对象连续多帧复用曲线缓存，换姿态或按摩布局后重新取样；每帧逐顶点与原公式对照。
  const flat = buildSpine(0, 0),
    bent = buildSpine(65, 35);
  for (const [spine, channels, phase] of [
    [flat, [], 0],
    [flat, profile.massage, 0.21],
    [flat, profile.massage, 0.47],
    [bent, profile.massage, 0.47],
    [bent, profile.massage, 0.73],
    [bent, profile.massage.slice(1), 0.73],
    [bent, profile.massage, 0.86],
    [flat, profile.massage, 0.9],
  ]) {
    state.spine = spine;
    state.massageChannels = channels;
    state.massage = {
      left: { amount: 1, intensity: 1, phase },
      right: { amount: 0.6, intensity: 0.7, phase: (phase + 0.13) % 1 },
    };
    const before = versions(heat);
    heat.update(state);
    assert.deepEqual(
      versions(heat),
      before.map((v) => v + 1),
    );
    for (const entry of heat.entries) assertOnSurface(heat, entry, state);
  }
});

test('dynamic heat waves reuse per-frame massage pulses and stay bit-identical to the per-point formula', (t) => {
  const { heat, profile, state } = fixture(t);
  // NaN 强度会让包围球为 NaN，three 会打印错误；这里只比较数值。
  t.mock.method(console, 'error', () => {});
  state.heating = [
    [3, 3],
    [3, 3],
  ];
  // 记录写入 Float32 属性前的双精度参数，避免 Float32 舍入掩盖 1 ulp 差异。
  const doubles = heat.entries.map((entry) => {
    const attribute = entry.waves.geometry.attributes.position,
      setXYZ = attribute.setXYZ,
      values = new Float64Array(attribute.count * 3);
    attribute.setXYZ = function (i, x, y, z) {
      values.set([x, y, z], i * 3);
      return setXYZ.call(this, i, x, y, z);
    };
    return values;
  });
  const flat = buildSpine(0, 0),
    bent = buildSpine(65, 35),
    lane = (amount, intensity, phase) => ({ amount, intensity, phase });
  for (const [spine, channels, left, right, time] of [
    [flat, profile.massage, lane(1, 0.7, 0.1), lane(1, 0.7, 0.4), 0.5],
    [bent, profile.massage, lane(1, 1, 0.33), lane(0.4, 0.2, 0.9), 2.25],
    [bent, profile.massage.slice(1), lane(1, 1, 0.61), lane(1, 1, 0.12), 7.1],
    [flat, profile.massage, lane(0, 1, 0), lane(0.8, 0, 0.5), 3],
    [flat, [], lane(1, 1, 0.2), lane(1, 1, 0.2), 4],
    // 未经 SDK 校验的通道值：权重为 0 的项照常相乘，NaN/Infinity 与原公式一样传播
    [bent, profile.massage, lane(1, NaN, 0.2), lane(1, Infinity, 0.6), 5.5],
    [flat, profile.massage, lane(1, 0.7, NaN), lane(NaN, 0.7, 0.3), 6],
    // 连续播放：隆起的末位差异多数被曲线基点吸收，需要足够多帧才能暴露乘法顺序的改变
    ...Array.from({ length: 400 }, (_, f) => [
      f % 3 ? bent : flat,
      profile.massage,
      lane(1, 0.7, (f * 0.0137) % 1),
      lane(0.85, 0.55, (f * 0.0291 + 0.3) % 1),
      f / 60,
    ]),
  ]) {
    Object.assign(state, { spine, time, massageChannels: channels, massage: { left, right } });
    heat.update(state);
    const y = heat.surfaceTop + SHOWROOM_LAYOUT.heatGap;
    for (const [k, entry] of heat.entries.entries()) {
      assert.equal(entry.waves.visible, true);
      const positions = entry.waves.geometry.attributes.position.array,
        { x: cx, z: cz } = entry.definition;
      for (let strand = 0; strand < 3; strand++)
        for (let segment = 0; segment < 12; segment++)
          for (let end = 0; end < 2; end++) {
            const u = (segment + end) / 12,
              phase = time * 1.5 + u * 7 + strand,
              x = cx + (strand - 1) * 0.15 + Math.sin(phase) * 0.013,
              z = cz + Math.cos(phase) * 0.013,
              expected = mapPoint(
                spine,
                x,
                y + 0.01 + u * 0.1 + massageSurfaceLift(channels, state.massage, x, z),
                z,
                null,
                false,
              ),
              i = (strand * 24 + segment * 2 + end) * 3;
            ['x', 'y', 'z'].forEach((axis, n) => {
              assert.ok(Object.is(doubles[k][i + n], expected[axis]));
              assert.ok(Object.is(positions[i + n], Math.fround(expected[axis])));
            });
          }
    }
  }
});

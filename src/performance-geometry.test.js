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

const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
const coverTrims = (bed) => [
  ...bed.coverDetails,
  ...bed.tailoredDetails,
  ...bed.branding,
  bed.waistband,
];

test('massage-only cover frames match a full rebuild vertex by vertex, flat and fully bent', () => {
  const { bed, state } = fixture(),
    { bed: reference } = fixture();
  state.airReveal = { phase: 'closed' };
  let fullNormals = 0;
  const computeVertexNormals = bed.cover.geometry.computeVertexNormals;
  bed.cover.geometry.computeVertexNormals = function () {
    fullNormals++;
    return computeVertexNormals.call(this);
  };
  // 参照床每帧清空缓存：床罩整网格重算、全部附件重新贴合，即原实现的结果。
  const rebuild = (s) => {
    reference.deformationCaches = new WeakMap();
    reference.boundSurfaceVersions = new WeakMap();
    reference.update(structuredClone(s));
  };
  const assertSame = (a, b) => {
    for (const name of ['position', 'normal'])
      assert.ok(
        maxDiff(a.geometry.attributes[name].array, b.geometry.attributes[name].array) < 1e-6,
        `${a.name} ${name}`,
      );
  };
  const lane = (phase, amount = 1, intensity = 0.7) => ({ amount, intensity, phase });
  const steps = [
    [0, 0, { left: lane(0), right: lane(0.2) }],
    [0, 0, { left: lane(0.11), right: lane(0.31, 0.45, 1) }],
    [0, 0, { left: lane(0.27), right: lane(0.52, 0.45, 1) }],
    [65, 35, { left: lane(0.4), right: lane(0.66) }],
    [65, 35, { left: lane(0.43, 1, 1), right: lane(0.71) }],
    [65, 35, { left: lane(0.43, 0.3, 1), right: lane(0.9, 0.2) }],
    [65, 35, { left: lane(0, 0), right: lane(0, 0) }],
  ];
  steps.forEach(([back, leg, massage], step) => {
    const posed = back !== state.back,
      before = fullNormals,
      trimVersions = coverTrims(bed).map(version);
    Object.assign(state, { back, leg, massage });
    if (step === 2) bed.setWaistband(true);
    if (step === 2) reference.setWaistband(true);
    bed.update(state);
    rebuild(state);
    // 同一姿态下只改按摩：不再整网格重算法线，未触及按摩区域的附件不重写也不重新上传。
    assert.equal(fullNormals, before + (step === 0 || posed ? 1 : 0));
    const cover = bed.cover.geometry,
      expected = reference.cover.geometry;
    assertSame(bed.cover, reference.cover);
    assert.ok(cover.boundingBox.equals(expected.boundingBox));
    assert.ok(cover.boundingSphere.equals(expected.boundingSphere));
    coverTrims(bed).forEach((trim, i) => {
      assert.equal(trim.visible, coverTrims(reference)[i].visible);
      if (!trim.visible) return;
      assertSame(trim, coverTrims(reference)[i]);
      if (step && !posed && step !== 2 && !bed.touchesMassage(trim))
        assert.equal(version(trim), trimVersions[i], trim.name);
    });
  });
  // T12 当前布局：按摩区域不触及任何包边、提手、标签或 Logo，按摩帧全部跳过重新贴合。
  assert.ok(coverTrims(bed).every((trim) => !bed.touchesMassage(trim)));
  // 床罩隐藏期间按摩继续变化（姿态不变），重新显示后按最新床面补齐。
  bed.update({ ...state, mechanism: true, massage: { left: lane(0.6) } });
  assert.equal(bed.cover.visible, false);
  const hidden = fullNormals;
  Object.assign(state, { massage: { left: lane(0.62), right: lane(0.1) } });
  bed.update(state);
  rebuild(state);
  assert.equal(fullNormals, hidden);
  assertSame(bed.cover, reference.cover);
  coverTrims(bed).forEach((trim, i) => trim.visible && assertSame(trim, coverTrims(reference)[i]));
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
  // 圆囊光点、目标环与流光都由着色器按时间推进，只改时间不重写任何几何。
  assert.equal(version(active.tile), tileVersion);
  assert.equal(version(active.pulse), pulseVersion);
  assert.equal(version(active.particles), particleVersion);
  assert.equal(active.tile.material.uniforms.time.value, 2);
  assert.ok(hidden.every((e) => version(e.tile) === 0 && !e.tile.visible));
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
  assert.equal(effect.entries.filter((e) => e.pulse.visible).length, 2);
});

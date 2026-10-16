import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ModelRegistry } from './model-profiles.js';
import { FirmnessEffect } from './firmness-effect.js';
import { AIR_FX_COLORS, airEffectInputs } from './air-cell-effect.js';
import { buildSpine, mapPoint, sampleSpine } from './kinematics.js';
import { SmartBed } from './model.js';
import { MATERIAL_CONFIG } from './materials.js';
import { DEFAULT_AIR_BAGS } from './air-layout.js';
import { T12_AIR_FX } from './dimensions.js';

const profile = new ModelRegistry().resolve('T12');
const display = (key) => new THREE.Color().setHex(AIR_FX_COLORS[key], THREE.LinearSRGBColorSpace);
const near = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const sameColor = (actual, key) =>
  assert.ok(
    actual
      .clone()
      .sub(display(key))
      .toArray()
      .every((v) => Math.abs(v) < 0.02),
    `${actual.getHexString()} != ${key}`,
  );

function setup(activeRegionIds, regionStates = {}, extra = {}) {
  const effect = new FirmnessEffect(profile.airbags);
  effect.root.visible = true;
  const state = {
    spine: buildSpine(0, 0),
    pressures: [Array(9).fill(45), Array(9).fill(45)],
    selection: { side: 'left', kind: 'air', activeRegionIds },
    regionStates,
    time: 1,
    moving: true,
    animate: true,
    ...extra,
  };
  return { effect, state };
}
// 以 20 fps 推进；返回最后一帧 update 的“仍需动画”结果。
function advance(effect, state, frames, patch = {}) {
  let animating = false;
  for (let i = 0; i < frames; i++) {
    state.time += 0.05;
    Object.assign(state, typeof patch === 'function' ? patch(i) : patch);
    animating = effect.update(state);
  }
  return animating;
}
const rows = (effect, regionId) => effect.entries.filter((e) => e.definition.regionId === regionId);

test('T12 adjusting circuits light up while idle circuits on the same side stay dormant', () => {
  const { effect, state } = setup(['left.circuit4'], {
    'left.circuit4': { status: 'inflating', direction: 1 },
  });
  advance(effect, state, 30);
  const [lit] = rows(effect, 'left.circuit4');
  assert.equal(lit.tile.material.uniforms.energy.value, 1);
  sameColor(lit.tile.material.uniforms.tint.value, 'inflate');
  assert.ok(lit.pad.visible && lit.pulse.visible && lit.particles.visible);
  for (const row of effect.entries.filter((e) => e !== lit)) {
    const left = row.definition.side === 1;
    // 同侧未调节的圆囊保留休眠描边，另一侧完全隐藏。
    assert.equal(row.tile.visible, left);
    assert.ok(!row.pad.visible && !row.pulse.visible && !row.particles.visible);
    if (left) assert.equal(row.tile.material.uniforms.energy.value, 0);
  }
  // 调节时不显示气路发光走线（引导线）。
  assert.ok(!effect.cells.objects.some((object) => object.name.startsWith('Air_Circuit_Trace')));
  assert.deepEqual(
    effect.cells.grids.map((g) => g.mesh.visible),
    [false, true],
  );
  for (const object of effect.cells.objects)
    if (object.visible) assert.ok(object.geometry.attributes.position.array.every(Number.isFinite));
});

test('direction follows explicit status, then visual motion, then reported value trend', () => {
  const { effect, state } = setup(['left.circuit6'], {
    'left.circuit6': { status: 'deflating', direction: -1 },
  });
  advance(effect, state, 30);
  const region = effect.cells.regions.get('left.circuit6');
  near(region.direction, -1);
  sameColor(rows(effect, 'left.circuit6')[0].tile.material.uniforms.tint.value, 'deflate');
  const flow = region.flow;
  advance(effect, state, 4);
  assert.ok(region.flow < flow, '放气时流光向下（相位递减）');
  // 只上报“调节中”与递增数值：由显示值变化推断为充气。
  state.regionStates = { 'left.circuit6': { status: 'adjusting', direction: 0 } };
  advance(effect, state, 30, (i) => ({
    pressures: [Array(9).fill(45), Array(9).fill(45 + i)],
  }));
  near(region.direction, 1);
  // 数值停止变化 0.8 秒后回到保压（无方向）外观。
  advance(effect, state, 60);
  near(region.direction, 0);
  sameColor(region.tint, 'hold');
});

test('faults turn red without flow and ended circuits fade out before frames stop', () => {
  const { effect, state } = setup(['left.circuit4'], {
    'left.circuit4': { status: 'adjusting', direction: 1 },
    'left.circuit2': { status: 'fault', direction: 0 },
  });
  advance(effect, state, 30);
  for (const row of rows(effect, 'left.circuit2')) {
    assert.equal(row.tile.material.uniforms.energy.value, 1);
    sameColor(row.tile.material.uniforms.tint.value, 'fault');
    assert.ok(!row.pulse.visible && !row.particles.visible);
  }
  state.selection = { side: 'left', kind: 'air', activeRegionIds: [] };
  state.regionStates = {};
  state.moving = false;
  const fading = [];
  for (let i = 0; i < 40; i++) fading.push(advance(effect, state, 1));
  assert.equal(fading[0], true, '淡出期间继续请求下一帧');
  assert.equal(fading.at(-1), false, '淡出完成后停止请求，静止停绘');
  assert.ok(
    effect.entries.every(
      (e) => e.tile.material.uniforms.energy.value === 0 && !e.pad.visible && !e.pulse.visible,
    ),
  );
  // 减少动态效果：状态立即到位，不产生额外帧。
  const reduced = setup(['left.circuit4'], {}, { moving: false, animate: false });
  assert.equal(advance(reduced.effect, reduced.state, 1), false);
  assert.equal(rows(reduced.effect, 'left.circuit4')[0].tile.material.uniforms.energy.value, 1);
});

test('target rings float above for inflation and wrap the wall for deflation', () => {
  for (const [goal, scale] of [
    [90, T12_AIR_FX.targetScale],
    [10, T12_AIR_FX.collarScale],
  ]) {
    const targets = [Array(9).fill(45), Array(9).fill(45)];
    const { effect, state } = setup(
      ['left.circuit4'],
      { 'left.circuit4': { status: 'adjusting', direction: goal > 45 ? 1 : -1 } },
      { targets },
    );
    const [row] = rows(effect, 'left.circuit4'),
      d = row.definition;
    targets[d.side][d.zone] = goal;
    advance(effect, state, 10);
    const ring = row.pulse.geometry.attributes,
      height = (d.minHalfHeight + (goal / 100) * d.halfHeightRange) * 2,
      center = mapPoint(state.spine, d.x - 3 * row.pitch, d.bottom + height, d.z, null, false);
    near(ring.center.getY(0), center.y, 1e-6);
    near(
      Math.hypot(ring.position.getX(0) - center.x, ring.position.getZ(0) - center.z),
      row.radius * scale,
      1e-6,
    );
    assert.equal(row.pulse.material.uniforms.dashed.value, 1);
    near(row.tile.material.uniforms.goal.value, goal / 100, 1e-9);
  }
});

test('cell effects follow the maximum fold on both sides with finite geometry', () => {
  const { effect, state } = setup(['left.circuit1', 'right.circuit7'], {
    'left.circuit1': { status: 'inflating', direction: 1 },
    'right.circuit7': { status: 'deflating', direction: -1 },
  });
  state.selection.side = 'both';
  state.spine = buildSpine(65, 35);
  advance(effect, state, 20);
  for (const row of effect.entries) {
    assert.ok(row.tile.visible);
    near(
      row.tile.material.uniforms.tilt.value,
      sampleSpine(state.spine, row.definition.z).angle,
      1e-9,
    );
  }
  for (const object of effect.cells.objects)
    if (object.visible) {
      const p = object.geometry.attributes.position.array;
      assert.ok(p.every(Number.isFinite), object.name);
    }
  // 右侧圆囊从靠近床中线（+X 一端）开始依次点亮。
  const right = rows(effect, 'right.circuit7')[0],
    left = rows(effect, 'left.circuit1')[0];
  assert.equal(right.tile.material.uniforms.innerFirst.value, 0);
  assert.equal(left.tile.material.uniforms.innerFirst.value, 1);
  // 隐藏后再显示时从休眠开始淡入，不保留上次的高亮。
  effect.root.visible = false;
  effect.update(state);
  effect.root.visible = true;
  advance(effect, state, 1);
  assert.ok(left.tile.material.uniforms.energy.value < 0.5);
});

test('SDK inputs give explicit status priority and normalise held targets', () => {
  const air = Object.fromEntries(profile.regions.map((r) => [r.id, { value: 40, status: 'idle' }]));
  air['left.circuit3'].status = 'deflating';
  const motions = new Map([
      ['left.circuit3', { target: 90, value: 50 }],
      ['left.circuit5', { target: 10, value: 50 }],
      ['left.circuit6', { target: 30, value: 30 }],
    ]),
    holds = new Map([['left.circuit5', 10]]),
    desired = [Array(9).fill(40), Array(9).fill(40)],
    { targets, regionStates } = airEffectInputs(profile, air, motions, holds, desired);
  assert.equal(regionStates['left.circuit3'].direction, -1);
  assert.equal(regionStates['left.circuit5'].direction, -1);
  assert.equal(regionStates['left.circuit6'].direction, 0);
  assert.equal(regionStates['right.circuit1'].direction, 0);
  const bag = profile.airbags.find((b) => b.regionId === 'left.circuit5');
  assert.equal(targets[bag.side][bag.zone], 10);
  assert.equal(desired[bag.side][bag.zone], 40, '不修改设备目标数组');
});

test('only round-array beds switch to the dark showroom substrate and restore it', () => {
  const library = Object.fromEntries(
    Object.keys(MATERIAL_CONFIG).map((id) => [id, new THREE.MeshStandardMaterial({ name: id })]),
  );
  const lib = { get: (id) => library[id] };
  const t12 = new SmartBed(lib, { airbags: profile.airbags, coverStyle: 'tailored' }),
    base = { back: 0, leg: 0, xray: 0, explode: 0 },
    pressures = [Array(9).fill(50), Array(9).fill(50)],
    circuits = t12.tubes.filter((t) => t.userData.circuitSide !== undefined),
    dark = t12.showroomMaterials;
  t12.update({
    ...base,
    pressures,
    showroom: true,
    airReveal: { side: 'left', phase: 'adjust', progress: 1 },
  });
  assert.equal(t12.innerFoam.material, dark.foam);
  assert.ok(circuits.every((t) => t.material === dark.tube));
  // 只处理揭开的一侧；另一侧隐藏，揭开时再切换。
  const shown = t12.airbags.filter((b) => b.group.visible);
  assert.deepEqual([...new Set(shown.map((b) => b.side))], [1]);
  assert.ok(shown.every((b) => b.seal.material === dark.seal));
  // 透视视图（非展示态）显示气囊层时恢复原材质。
  t12.update({ ...base, xray: 1, pressures, showroom: false });
  assert.equal(t12.innerFoam.material, library.foam);
  assert.ok(circuits.every((t) => t.material === t.sourceMaterial && t.material !== dark.tube));
  assert.ok(t12.airbags.every((b) => b.seal.material === b.sealMaterial));
  // 特效对象不进入床体（GLB 只导出床体）。
  const effect = new FirmnessEffect(profile.airbags);
  assert.ok(effect.cells.objects.every((o) => !t12.root.getObjectById(o.id)));
  // 矩形气囊型号不受影响。
  const generic = new SmartBed(lib, { airbags: DEFAULT_AIR_BAGS });
  generic.update({
    ...base,
    pressures: [Array(4).fill(50), Array(4).fill(50)],
    showroom: true,
    airReveal: { side: 'left', phase: 'adjust', progress: 1 },
  });
  assert.equal(generic.showroomMaterials, null);
  assert.equal(generic.innerFoam.material, library.foam);
  assert.equal(new FirmnessEffect(DEFAULT_AIR_BAGS).cells, undefined);
});

test('T11+ strips keep their rounded-rectangle shape and use the same per-circuit effect', () => {
  const t11 = new ModelRegistry().resolve('T11+');
  const effect = new FirmnessEffect(t11.airbags);
  effect.root.visible = true;
  assert.equal(effect.entries.length, 14);
  assert.ok(effect.entries.every((e) => e.cellFx && e.strip));
  const state = {
    spine: buildSpine(65, 35),
    pressures: [Array(7).fill(40), Array(7).fill(40)],
    selection: { side: 'left', kind: 'air', activeRegionIds: ['left.lumbar'] },
    regionStates: { 'left.lumbar': { status: 'inflating', direction: 1 } },
    targets: [Array(7).fill(40), Array(7).fill(90)],
    time: 1,
    moving: true,
    animate: true,
  };
  advance(effect, state, 30);
  const lit = rows(effect, 'left.lumbar');
  assert.equal(lit.length, 2);
  for (const row of lit) {
    assert.equal(row.tile.material.uniforms.energy.value, 1);
    assert.equal(row.tile.material.uniforms.rect.value, 1);
    sameColor(row.tile.material.uniforms.tint.value, 'inflate');
    assert.ok(row.pad.visible && row.pulse.visible && row.particles.visible);
    // 外壳与实体条囊同尺寸：静止几何的包围盒等于条囊宽深。
    const box = new THREE.Box3().setFromBufferAttribute(row.rest);
    near(box.max.x - box.min.x, row.definition.width, 1e-6);
    near(box.max.z - box.min.z, row.definition.depth, 1e-6);
  }
  for (const row of effect.entries.filter((e) => e.definition.regionId !== 'left.lumbar'))
    assert.ok(!row.pulse.visible && row.tile.visible === (row.side === 1));
  assert.ok(!effect.cells.objects.some((object) => object.name.startsWith('Air_Circuit_Trace')));
  for (const object of effect.cells.objects)
    if (object.visible) assert.ok(object.geometry.attributes.position.array.every(Number.isFinite));
  // 展示态切换为与 T12 相同的深色底座和石墨色气管，退出后恢复原材质。
  const library = Object.fromEntries(
    Object.keys(MATERIAL_CONFIG).map((id) => [id, new THREE.MeshStandardMaterial({ name: id })]),
  );
  const bed = new SmartBed({ get: (id) => library[id] }, { airbags: t11.airbags }),
    base = { back: 0, leg: 0, xray: 0, explode: 0, pressures: state.pressures };
  bed.update({
    ...base,
    showroom: true,
    airReveal: { side: 'left', phase: 'adjust', progress: 1 },
  });
  assert.equal(bed.innerFoam.material, bed.showroomMaterials.foam);
  assert.ok(
    bed.airbags.filter((b) => b.group.visible).every((b) => b.cells[0].material === b.showroomMat),
  );
  assert.ok(bed.airbags.every((b) => b.cells[0].name === 'Rounded_Rectangular_Air_Pouch'));
  bed.update({ ...base, xray: 1, showroom: false });
  assert.equal(bed.innerFoam.material, library.foam);
});

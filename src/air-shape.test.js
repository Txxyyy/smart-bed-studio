import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { roundAirMaterial, roundAirRow } from './air-shape.js';
import { SmartBed } from './model.js';
import { ModelRegistry } from './model-profiles.js';
import { DeviceState } from './device-state.js';
import { MATERIAL_CONFIG } from './materials.js';

test('round support keeps its row topology while giving caps and bellows different colors', () => {
  const geometry = roundAirRow(0.74, 0.12),
    single = new THREE.CylinderGeometry(1, 1, 0.12, 24, 6);
  const position = geometry.attributes.position,
    color = geometry.attributes.color,
    normal = geometry.attributes.normal;
  assert.equal(position.count, single.attributes.position.count * 7);
  assert.equal(color.count, position.count);
  assert.ok(color.array.every(Number.isFinite));
  const caps = [],
    walls = [];
  for (let i = 0; i < position.count; i++) {
    const rgb = [color.getX(i), color.getY(i), color.getZ(i)];
    (normal.getY(i) > 0.9 ? caps : walls).push(rgb);
  }
  const light = (rgb) => rgb[0] + rgb[1] + rgb[2];
  assert.ok(caps.length > 0 && walls.length > 0);
  assert.ok(
    caps.every(([r, g, b]) => b > g * 1.7 && g > r * 5),
    'caps keep a saturated blue hue',
  );
  assert.ok(
    Math.max(...caps.map(light)) <= Math.max(...walls.map(light)),
    'caps must not be a pale patch above the blue wall',
  );
  assert.ok(
    Math.max(...caps.map(light)) > Math.min(...caps.map(light)),
    'caps retain a soft center-to-rim gradient',
  );
  assert.ok(Math.max(...walls.map(light)) - Math.min(...walls.map(light)) > 0.2);
  const seal = roundAirRow(0.74, 0.12, 7, true);
  assert.equal(seal.attributes.color, undefined);
  geometry.dispose();
  single.dispose();
  seal.dispose();
});

test('T12 blue polymer is translucent, non-metallic and uses no transmission pass or new textures', () => {
  for (const options of [{}, { showroom: true }, { seal: true }]) {
    const material = roundAirMaterial(options);
    assert.equal(material.isMeshPhysicalMaterial, true);
    assert.equal(material.metalness, 0);
    assert.equal(material.transmission, 0);
    assert.equal(material.transparent, true);
    assert.ok(material.opacity > 0.5 && material.opacity < 1);
    assert.ok(material.clearcoat > 0.5);
    assert.equal(material.vertexColors, !options.seal);
    assert.equal(material.depthWrite, !options.seal);
    assert.ok(!Object.values(material).some((v) => v?.isTexture));
    material.dispose();
  }
});

test('both T12 sides keep blue materials and vertex colors through reveal and maximum bend', () => {
  const profile = new ModelRegistry().resolve('T12');
  const materials = Object.fromEntries(
    Object.keys(MATERIAL_CONFIG).map((id) => [id, new THREE.MeshStandardMaterial()]),
  );
  const bed = new SmartBed({ get: (id) => materials[id] }, { airbags: profile.airbags });
  const values = new DeviceState(profile).targets();
  for (const showroom of [false, true])
    for (const side of ['left', 'right'])
      for (const back of [0, 65]) {
        bed.update({
          ...values,
          back,
          leg: back ? 35 : 0,
          explode: 0,
          xray: showroom ? 0 : 1,
          showroom,
          airReveal: { phase: 'adjust', side, progress: 1 },
        });
        for (const bag of bed.airbags.filter(
          (b) => !showroom || b.side === (side === 'left' ? 1 : 0),
        )) {
          const cell = bag.cells[0];
          assert.equal(cell.material, showroom ? bag.showroomMat : bag.mat);
          assert.equal(cell.material.vertexColors, true);
          assert.equal(cell.material.color.getHex(), 0xffffff);
          assert.ok(cell.geometry.attributes.color.array.every(Number.isFinite));
          assert.ok(cell.geometry.attributes.position.array.every(Number.isFinite));
        }
      }
  const fallback = new SmartBed({ get: (id) => materials[id] });
  assert.ok(
    fallback.airbags.every(
      (b) => !b.mat.isMeshPhysicalMaterial && !b.cells[0].geometry.attributes.color,
    ),
  );
});

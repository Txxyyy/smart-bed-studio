// model 回归测试共用的 SmartBed 实例与默认姿态；每个测试文件各自持有一个实例。
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SmartBed } from './model.js';
import { MATERIAL_CONFIG } from './materials.js';

const materials = Object.fromEntries(
  Object.keys(MATERIAL_CONFIG).map((id) => [
    id,
    new THREE.MeshStandardMaterial({
      name: id,
      side: id === 'waistband' ? THREE.DoubleSide : THREE.FrontSide,
    }),
  ]),
);
export const bed = new SmartBed({ get: (id) => materials[id] });
export const state = {
  back: 0,
  leg: 0,
  pressures: [
    [50, 50, 50, 50],
    [50, 50, 50, 50],
  ],
  xray: 1,
  explode: 0,
};
export const bounds = (obj) => new THREE.Box3().setFromObject(obj, true);
export const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

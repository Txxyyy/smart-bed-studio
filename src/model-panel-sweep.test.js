// 全角度扫描回归耗时较长，单独成文件以便 node --test 并行执行。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bed, state } from './model-test-fixture.js';

test('the mattress underside clears all five imported panels throughout the angle range', () => {
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0)),
    point = new THREE.Vector3();
  const rest = bed.cover.userData.rest,
    p = bed.cover.geometry.attributes.position;
  for (const style of ['wide', 'flush']) {
    bed.setSurroundStyle(style);
    for (let back = 0; back <= 65; back += 5)
      for (let leg = 0; leg <= 35; leg += 5) {
        bed.update({
          ...state,
          back,
          leg,
          xray: 0,
          pressures: [
            [0, 0, 0, 0],
            [100, 100, 100, 100],
          ],
        });
        for (let i = 0; i < p.count; i++) {
          if (rest[i * 3 + 1] > 0.02 || Math.abs(rest[i * 3]) > 0.72) continue;
          point.fromBufferAttribute(p, i);
          ray.ray.origin.set(point.x, 3, point.z);
          const hit = ray.intersectObjects(
            bed.decks.map((d) => d.panel),
            false,
          )[0];
          if (hit)
            assert.ok(
              point.y - hit.point.y > -0.001,
              `panel enters mattress ${style} ${back}/${leg}: ${point.y - hit.point.y}`,
            );
        }
      }
  }
  bed.setSurroundStyle('wide');
});

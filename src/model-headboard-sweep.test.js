// 全角度扫描回归耗时较长，单独成文件以便 node --test 并行执行。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DIMENSIONS, HEADBOARD_LAYOUT } from './dimensions.js';
import { bed, state } from './model-test-fixture.js';

test('raised mattress and rigid back deck remain in front of the fuller headboard', () => {
  const point = new THREE.Vector3();
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  for (const head of ['cushion', 'channel'])
    for (const style of ['wide', 'flush']) {
      bed.setHeadboardStyle(head);
      bed.setSurroundStyle(style);
      for (let back = 0; back <= 65; back += 5)
        for (const pressure of [0, 100]) {
          bed.update({
            ...state,
            back,
            leg: 35,
            xray: 0,
            pressures: [
              [pressure, pressure, pressure, pressure],
              [100 - pressure, 100 - pressure, 100 - pressure, 100 - pressure],
            ],
          });
          const objects = [bed.cover, ...bed.decks[0].group.children];
          for (const object of objects) {
            const p = object.geometry.attributes.position;
            for (let i = 0; i < p.count; i++) {
              point.fromBufferAttribute(p, i).applyMatrix4(object.matrixWorld);
              if (
                point.z > -DIMENSIONS.length / 2 + 0.1 ||
                point.y < DIMENSIONS.deckHeight - 0.12 ||
                point.y > HEADBOARD_LAYOUT.height
              )
                continue;
              ray.ray.origin.set(point.x, point.y, 0.5);
              const hit = ray.intersectObject(bed.headboard, true)[0];
              if (hit)
                assert.ok(
                  point.z - hit.point.z > 0.005,
                  `headboard collision ${style}/${back}/${pressure} ${object.name} gap=${point.z - hit.point.z}`,
                );
            }
          }
        }
    }
  bed.setHeadboardStyle('cushion');
  bed.setSurroundStyle('wide');
});

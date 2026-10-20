import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpine, mapPoint } from './kinematics.js';
import { ModelRegistry } from './model-profiles.js';
import { MassageEffect } from './massage-effect.js';
import { massagePulse, massageSurfaceLift } from './massage.js';

test('massage frames leave hidden internals untouched while surface effects follow phase and pose', () => {
  const profile = new ModelRegistry().resolve('T12'),
    surfaceTop = 0.26;
  const effect = new MassageEffect(profile.massage, profile.airbags, surfaceTop);
  effect.root.visible = true;
  // 每个顶点都与原公式 mapPoint(床面高度 + 按摩隆起) 对照。
  const assertFollowsSurface = (mesh, spine, lanes, x, z, gap) => {
    const rest = mesh.userData.rest,
      position = mesh.geometry.attributes.position;
    for (let i = 0; i < rest.count; i++) {
      const px = x + rest.getX(i),
        pz = z + rest.getZ(i),
        expected = mapPoint(
          spine,
          px,
          surfaceTop + gap + massageSurfaceLift(profile.massage, lanes, px, pz),
          pz,
          null,
          false,
        );
      assert.ok(
        Math.hypot(
          position.getX(i) - expected.x,
          position.getY(i) - expected.y,
          position.getZ(i) - expected.z,
        ) < 1e-6,
      );
    }
  };
  const hidden = [];
  for (const entry of effect.entries) {
    for (const mesh of [entry.body, entry.rings]) {
      mesh.setMatrixAt =
        mesh.setColorAt =
        mesh.computeBoundingSphere =
          () => assert.fail('hidden massage instances must not be updated');
      hidden.push({
        attribute: mesh.instanceMatrix,
        before: mesh.instanceMatrix.array.slice(),
        version: mesh.instanceMatrix.version,
      });
    }
    for (const { base } of entry.pads) {
      base.geometry.computeBoundingSphere = () =>
        assert.fail('hidden massage base must not be deformed');
      const attribute = base.geometry.attributes.position;
      hidden.push({ attribute, before: attribute.array.slice(), version: attribute.version });
    }
  }
  try {
    // 同一姿态对象连续多帧复用曲线缓存，换姿态后重新取样。
    const flat = buildSpine(0, 0),
      bent = buildSpine(65, 35);
    for (const [spine, phase] of [
      [flat, 0],
      [flat, 0.25],
      [bent, 0.43],
      [bent, 0.61],
      [flat, 0.7],
    ]) {
      const lanes = {
        left: { amount: 1, intensity: 1, phase },
        right: { amount: 0.6, intensity: 0.7, phase: phase + 0.13 },
      };
      effect.update({ spine, lanes });
      for (const { channel, body, rings, pads, glows } of effect.entries) {
        const lane = lanes[channel.id];
        assert.equal(body.visible, false);
        assert.equal(rings.visible, false);
        for (const { base, ripple, definition } of pads) {
          assert.equal(base.visible, false);
          assert.equal(ripple.visible, true);
          assert.equal(ripple.material.uniforms.amount.value, lane.amount);
          assertFollowsSurface(ripple, spine, lanes, definition.x, definition.z, 0.004);
        }
        for (const { mesh, x, z, row } of glows) {
          assert.equal(mesh.visible, true);
          assert.equal(
            mesh.material.uniforms.pulse.value,
            massagePulse(lane.phase, row, pads.length) * lane.intensity,
          );
          assertFollowsSurface(mesh, spine, lanes, x, z, 0.003);
          assert.ok(mesh.geometry.attributes.position.version > 0);
        }
      }
    }
    for (const { attribute, before, version } of hidden) {
      assert.equal(attribute.version, version);
      assert.deepEqual(attribute.array, before);
    }
    const visibleAttributes = effect.entries.flatMap((e) => [
      ...e.glows.map((g) => g.mesh.geometry.attributes.position),
      ...e.pads.map((p) => p.ripple.geometry.attributes.position),
    ]);
    const versions = visibleAttributes.map((a) => a.version);
    effect.update({
      spine: buildSpine(0, 0),
      lanes: { left: { amount: 0 }, right: { amount: 0 } },
    });
    assert.deepEqual(
      visibleAttributes.map((a) => a.version),
      versions,
    );
    assert.ok(
      effect.entries.every(
        (e) => e.glows.every((g) => !g.mesh.visible) && e.pads.every((p) => !p.ripple.visible),
      ),
    );
  } finally {
    effect.root.traverse((object) => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
  }
});

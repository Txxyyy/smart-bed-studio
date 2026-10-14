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
    for (const [back, leg, phase] of [
      [0, 0, 0],
      [0, 0, 0.25],
      [65, 35, 0.43],
    ]) {
      const spine = buildSpine(back, leg),
        lanes = {
          left: { amount: 1, intensity: 1, phase },
          right: { amount: 0.6, intensity: 0.7, phase: phase + 0.13 },
        };
      effect.update({ spine, lanes });
      for (const { channel, body, rings, pads, glows } of effect.entries) {
        const lane = lanes[channel.id];
        assert.equal(body.visible, false);
        assert.equal(rings.visible, false);
        for (const { base, ripple } of pads) {
          assert.equal(base.visible, false);
          assert.equal(ripple.visible, true);
          assert.equal(ripple.material.uniforms.amount.value, lane.amount);
        }
        for (const { mesh, x, z, row } of glows) {
          assert.equal(mesh.visible, true);
          assert.equal(
            mesh.material.uniforms.pulse.value,
            massagePulse(lane.phase, row, pads.length) * lane.intensity,
          );
          const expected = mapPoint(
            spine,
            x,
            surfaceTop + 0.003 + massageSurfaceLift(profile.massage, lanes, x, z),
            z,
            null,
            false,
          );
          const position = mesh.geometry.attributes.position,
            center = Math.floor(position.count / 2);
          assert.ok(Math.abs(position.getY(center) - expected.y) < 1e-6);
          assert.ok(Math.abs(position.getZ(center) - expected.z) < 1e-6);
          assert.ok(position.version > 0);
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

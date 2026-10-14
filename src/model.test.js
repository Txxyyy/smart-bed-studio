import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ANATOMY_LAYERS } from './anatomy.js';
import { LINKAGE, CAD_FIT } from './mechanism.js';
import { RETAINER_SIZE, FRONT_MARKS } from './branding.js';
import { DIMENSIONS, AIR_LAYOUT, HEADBOARD_LAYOUT, SURROUND_HEIGHT } from './dimensions.js';
import { bed, state, bounds, near } from './model-test-fixture.js';

test('local reveal keeps the whole mattress and frame, reveals only the selected side, and restores for heating', () => {
  const materialsBefore = bed.cover.material;
  for (const style of ['wide', 'flush']) {
    bed.setSurroundStyle(style);
    for (const side of ['left', 'right']) {
      bed.update({
        ...state,
        xray: 0,
        back: 65,
        leg: 35,
        showroom: true,
        airReveal: { side, phase: 'adjust', progress: 1 },
      });
      assert.equal(bed.cover.visible, true);
      assert.notEqual(bed.cover.material, materialsBefore);
      assert.equal(bed.anatomy.entries.comfort.group.visible, false);
      assert.equal(bed.airGroup.visible, true);
      assert.deepEqual(
        bed.airbags.filter((b) => b.group.visible).map((b) => b.side),
        Array(4).fill(side === 'left' ? 1 : 0),
      );
      assert.deepEqual(
        bed.coverReveal.uniforms.revealSides.value.toArray(),
        side === 'right' ? [0, 1] : [1, 0],
      );
      assert.ok(
        bed.coverReveal.uniforms.revealOpacity.value >= 0.25 &&
          bed.coverReveal.uniforms.revealOpacity.value <= 0.5,
      );
      assert.ok(bed.decks.every((d) => d.group.visible));
      assert.equal(bed.base.visible, true);
    }
    bed.update({
      ...state,
      xray: 0,
      back: 65,
      leg: 35,
      showroom: true,
      airReveal: { side: null, phase: 'closed', progress: 0 },
    });
    assert.equal(bed.cover.material, materialsBefore);
    assert.equal(bed.airGroup.visible, false);
    assert.equal(bed.coverReveal.uniforms.revealOpen.value, 0);
    bed.update({ ...state, back: 65, leg: 35, showroom: false });
    assert.equal(bed.cover.material, materialsBefore);
    assert.equal(bed.airGroup.visible, true);
    assert.ok(bed.decks.every((d) => d.group.visible));
    assert.equal(bed.base.visible, true);
    bed.update({
      ...state,
      xray: 0,
      showroom: true,
      airReveal: {
        sides: { left: { phase: 'adjust', progress: 1 }, right: { phase: 'scan', progress: 0.4 } },
      },
    });
    assert.equal(
      bed.airbags.filter((b) => b.group.visible).length,
      8,
      'both human sides remain visible during an overlapping adjustment',
    );
  }
  bed.setSurroundStyle('wide');
  bed.update(state);
});

test('surround encloses both sides and the foot while leaving the mechanism opening clear', () => {
  bed.update(state);
  for (const [x, z] of [
    [-0.85, 0],
    [0.85, 0],
    [0, 0.996],
    [0, -0.953],
  ]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0));
    assert.ok(ray.intersectObject(bed.surroundShell).length > 0, `missing surround at ${x}, ${z}`);
  }
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0));
  assert.equal(ray.intersectObject(bed.surroundShell).length, 0);
});

test('surround joins the independent headboard without moving during articulation', () => {
  bed.update(state);
  const before = bounds(bed.surroundShell);
  assert.ok(
    before.min.z > bounds(bed.headboard.getObjectByName('Floor_Upholstered_Apron')).max.z + 0.005,
  );
  bed.update({ ...state, back: 65, leg: 35 });
  const after = bounds(bed.surroundShell);
  assert.ok(before.equals(after));
  // The expanded cover stays inside the surrounding upholstery in the width direction.
  const cover = bounds(bed.cover);
  assert.ok(
    cover.min.x > -DIMENSIONS.width / 2 - 0.001 && cover.max.x < DIMENSIONS.width / 2 + 0.001,
  );
});

test('rectangular air pouch inflation preserves footprint and lower surface, independently by side', () => {
  const low = {
    ...state,
    pressures: [
      [50, 0, 50, 50],
      [50, 50, 50, 50],
    ],
  };
  bed.update(low);
  const left = bed.airbags[1].cells[0],
    right = bed.airbags[5].cells[0];
  const before = bounds(left),
    rightBefore = bounds(right);
  bed.update({
    ...low,
    pressures: [
      [50, 100, 50, 50],
      [50, 50, 50, 50],
    ],
  });
  const after = bounds(left);
  near(before.min.x, after.min.x);
  near(before.max.x, after.max.x);
  near(before.min.z, after.min.z);
  near(before.max.z, after.max.z);
  near(before.min.y, after.min.y);
  assert.ok(after.max.y > before.max.y + 0.1);
  assert.ok(rightBefore.equals(bounds(right)));
});

test('all eight rounded pouches and their sealed edges remain finite while bent and inflated', () => {
  bed.update({
    ...state,
    back: 65,
    leg: 35,
    pressures: [
      [100, 100, 100, 100],
      [0, 0, 0, 0],
    ],
    explode: 0,
  });
  for (const bag of bed.airbags) {
    for (const object of [...bag.cells, bag.seal]) {
      assert.ok([...object.geometry.attributes.position.array].every(Number.isFinite));
      const box = bounds(object);
      assert.ok(box.max.x - box.min.x > AIR_LAYOUT.pouchWidth - 0.03);
    }
    assert.equal(bag.cells.length, 1);
  }
});

test('only three separated layers are built and no legacy component stack remains', () => {
  bed.update({ ...state, explode: 1 });
  assert.equal(ANATOMY_LAYERS.length, 3);
  for (const { id } of ANATOMY_LAYERS) {
    const group = bed.anatomy.entries[id].group;
    assert.ok(group.visible);
    assert.ok(group.children.length > 0);
  }
  assert.equal(bed.root.getObjectByName('Quilted_Zip_Case'), undefined);
  const top = bounds(bed.root.getObjectByName('Comfort_Layer'));
  const foam = bounds(bed.root.getObjectByName('Foundation_Foam'));
  assert.ok(top.min.y > foam.max.y + 0.5);
  assert.equal(bed.cover.visible, false);
  assert.equal(bed.headboard.visible, false);
});

test('exploded inspection flattens layers, isolates any chosen component and restores articulation', () => {
  const pose = { ...state, back: 52, leg: 10, xray: 0, explode: 0 };
  bed.update(pose);
  const original = Array.from(bed.cover.geometry.attributes.position.array);
  bed.update({ ...pose, explode: 1 });
  const flatTop = bounds(bed.root.getObjectByName('Comfort_Layer'));
  assert.ok(flatTop.max.y - flatTop.min.y < 0.1);
  for (const { id } of ANATOMY_LAYERS) {
    bed.selectedLayer = id;
    bed.update({ ...pose, explode: 1 });
    assert.deepEqual(
      Object.entries(bed.anatomy.entries)
        .filter(([, l]) => l.group.visible)
        .map(([key]) => key),
      [id],
    );
  }
  bed.selectedLayer = null;
  bed.update(pose);
  assert.deepEqual(Array.from(bed.cover.geometry.attributes.position.array), original);
  assert.equal(bed.cover.visible, true);
  assert.equal(bed.headboard.visible, true);
  assert.equal(pose.back, 52);
  assert.equal(pose.leg, 10);
});

test('all visible exploded meshes have valid unit normals for GLB export', () => {
  bed.selectedLayer = null;
  bed.update({ ...state, explode: 1 });
  bed.root.traverseVisible((object) => {
    if (!object.isMesh) return;
    const normals = object.geometry.attributes.normal;
    for (let i = 0; i < normals.count; i++) {
      const length = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i));
      assert.ok(Math.abs(length - 1) < 0.001, `${object.name} normal ${i} has length ${length}`);
    }
  });
});

function assertCadPins() {
  for (const [i, m] of bed.motors.entries()) {
    const p = bed.linkage.actuators[i],
      local = new THREE.Vector3(
        0,
        m.spec.restMoving.y - m.spec.anchor.y,
        m.spec.restMoving.z - m.spec.anchor.z,
      );
    const tip = local.applyMatrix4(m.shaft.matrixWorld),
      pin = m.movingPin.getWorldPosition(new THREE.Vector3());
    near(tip.distanceTo(pin), 0);
    near(
      m.assembly
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(m.fixedPin.getWorldPosition(new THREE.Vector3())),
      0,
    );
    near(m.assembly.scale.x, 1);
    near(m.assembly.scale.y, 1);
    near(m.assembly.scale.z, 1);
    near(m.shaft.scale.length(), Math.sqrt(3));
    const roller = new THREE.Vector3(
      0,
      m.spec.restRoller.y - m.spec.pivot.y,
      m.spec.restRoller.z - m.spec.pivot.z,
    ).applyMatrix4(m.lift.matrixWorld);
    near(roller.y, p.roller.y);
    near(roller.z, p.roller.z);
  }
  for (const link of bed.footLinks) {
    const c = LINKAGE.footClevis,
      anchor = LINKAGE.supportAnchor;
    const pin = new THREE.Vector3(
      0,
      LINKAGE.flatKnee.y + c.y - anchor.y,
      LINKAGE.flatKnee.z + c.z - anchor.z,
    ).applyMatrix4(link.bar.matrixWorld);
    near(pin.y, bed.linkage.footPin.y);
    near(pin.z, bed.linkage.footPin.z);
    near(link.bar.scale.length(), Math.sqrt(3));
  }
}

test('imported motors retain their geometry and align shafts, clevis pins and rollers', () => {
  assert.equal(bed.motors.length, 2);
  const source = bed.motors.map((m) => Array.from(m.body.geometry.attributes.position.array));
  for (const [back, leg] of [
    [0, 0],
    [32, 18],
    [65, 35],
  ]) {
    bed.update({ ...state, back, leg, mechanism: true });
    assertCadPins();
    bed.motors.forEach((m, i) =>
      assert.deepEqual(Array.from(m.body.geometry.attributes.position.array), source[i]),
    );
  }
});

test('headboard has two shaped cushions, two full height wings and its own floor supports', () => {
  bed.update({ ...state, xray: 0 });
  const left = bed.headboard.getObjectByName('Back_Cushion_Left'),
    right = bed.headboard.getObjectByName('Back_Cushion_Right');
  assert.ok(left && right);
  assert.ok(bounds(left).max.x < bounds(right).min.x);
  assert.ok(bounds(left).getSize(new THREE.Vector3()).z > 0.17);
  const feet = bed.headboard.children.filter((m) => m.name === 'Headboard_Floor_Pad');
  assert.equal(feet.length, 2);
  for (const foot of feet) near(bounds(foot).min.y, 0, 1e-6);
  for (const side of ['Left', 'Right']) {
    const wing = bounds(bed.headboard.getObjectByName(`Curved_Wing_${side}`));
    assert.ok(wing.min.y < 0.06 && wing.max.y > HEADBOARD_LAYOUT.height - 0.02);
  }
  assert.ok(bounds(bed.headboard.getObjectByName('Floor_Upholstered_Apron')).min.y < 0.07);
  assert.notEqual(left.material, bed.surroundShell.material);
});

test('flush surround aligns to the mattress and provides a smaller clear internal frame', () => {
  bed.setSurroundStyle('wide');
  bed.update({ ...state, xray: 0 });
  const wideBase = bounds(bed.base),
    wideDeck = bounds(bed.decks[0].panel);
  bed.setSurroundStyle('flush');
  bed.update({ ...state, xray: 0 });
  const rim = bounds(bed.surroundShell),
    cover = bounds(bed.cover),
    base = bounds(bed.base),
    deck = bounds(bed.decks[0].panel);
  near(rim.max.x, cover.max.x, 0.0001);
  near(rim.min.x, cover.min.x, 0.0001);
  near(rim.max.z, cover.max.z, 0.0001);
  assert.ok(base.max.x - base.min.x < wideBase.max.x - wideBase.min.x - 0.12);
  near(base.max.z - base.min.z, wideBase.max.z - wideBase.min.z);
  assert.ok(deck.max.x - deck.min.x < wideDeck.max.x - wideDeck.min.x - 0.15);
  assert.ok(base.max.x < bed.layout.innerWidth / 2 - 0.02);
  assert.ok(base.max.z < bed.layout.innerFoot);
  assert.equal(bed.surroundProfiles.wide.group.visible, false);
  assert.equal(bed.surroundProfiles.flush.group.visible, true);
  bed.setSurroundStyle('wide');
  bed.update(state);
  assert.ok(bounds(bed.base).equals(wideBase));
});

test('both frame sizes preserve hinge motion, fixed actuator lengths and transverse clearance', () => {
  for (const style of ['wide', 'flush']) {
    bed.setSurroundStyle(style);
    for (let back = 0; back <= 65; back += 5)
      for (const leg of [0, 17.5, 35]) {
        bed.update({ ...state, back, leg });
        for (const { group } of bed.decks) {
          const deck = bounds(group);
          assert.ok(deck.max.x < bed.layout.innerWidth / 2 - 0.015);
        }
        assertCadPins();
      }
  }
  bed.setSurroundStyle('wide');
});

test('mattress binding stays within 1.1 mm of its cover triangles at all angles and pressures', () => {
  const point = new THREE.Vector3(),
    a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    closest = new THREE.Vector3(),
    triangle = new THREE.Triangle(a, b, c);
  for (const [back, leg] of [
    [0, 0],
    [28, 24],
    [52, 10],
    [65, 35],
  ])
    for (const pressure of [0, 100]) {
      bed.update({
        ...state,
        back,
        leg,
        xray: 0,
        pressures: [
          [pressure, pressure, pressure, pressure],
          [100 - pressure, 100 - pressure, 100 - pressure, 100 - pressure],
        ],
      });
      for (const welt of bed.coverDetails) {
        const p = welt.geometry.attributes.position,
          source = bed.cover.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const binding = welt.surfaceBinding.bindings[i];
          a.fromBufferAttribute(source, binding.ids[0]);
          b.fromBufferAttribute(source, binding.ids[1]);
          c.fromBufferAttribute(source, binding.ids[2]);
          point.fromBufferAttribute(p, i);
          triangle.closestPointToPoint(point, closest);
          assert.ok(point.distanceTo(closest) < 0.0011, `detached ${welt.name} at ${back}/${leg}`);
        }
      }
    }
});

test('the headboard contact face leaves a small, consistent mattress gap in both bed styles', () => {
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  for (const style of ['wide', 'flush']) {
    bed.setSurroundStyle(style);
    bed.update({ ...state, xray: 0 });
    for (const x of [-0.7, -0.4, 0.4, 0.7])
      for (const y of [0.4, 0.49, 0.58]) {
        ray.ray.origin.set(x, y, 0);
        const hit = ray.intersectObject(bed.headboard, true)[0];
        assert.ok(hit);
        const gap = -DIMENSIONS.length / 2 - hit.point.z;
        assert.ok(gap > 0.012 && gap < 0.04, `${style} head gap ${gap} at ${x},${y}`);
      }
  }
  bed.setSurroundStyle('wide');
});

test('independent headboard mode shows only its own structure and restores the complete bed', () => {
  const pose = { ...state, back: 52, leg: 10, xray: 0 };
  bed.setSurroundStyle('flush');
  bed.update(pose);
  const headBounds = bounds(bed.headboard),
    originalCover = bounds(bed.cover);
  bed.update({ ...pose, headboardOnly: true });
  const visible = [];
  bed.root.traverseVisible((o) => {
    if (o.isMesh) visible.push(o);
  });
  assert.equal(visible.length, 12);
  for (const mesh of visible) {
    let parent = mesh;
    while (parent && parent !== bed.headboard) parent = parent.parent;
    assert.equal(parent, bed.headboard);
    const n = mesh.geometry.attributes.normal;
    for (let i = 0; i < n.count; i++) near(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)), 1, 0.001);
  }
  assert.ok(bounds(bed.headboard).equals(headBounds));
  bed.update(pose);
  assert.ok(
    bed.base.visible && bed.mattress.visible && bed.surround.visible && bed.mechanismGroup.visible,
  );
  assert.ok(bounds(bed.cover).equals(originalCover));
  bed.setSurroundStyle('wide');
});

test('the bed rear terminates in front of the floor apron with an actual assembly gap', () => {
  const frontRay = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  const rearRay = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
  for (const style of ['wide', 'flush']) {
    bed.setSurroundStyle(style);
    bed.update({ ...state, xray: 0 });
    for (const x of [-0.7, 0, 0.7])
      for (const y of [0.12, 0.22, 0.31]) {
        frontRay.ray.origin.set(x, y, 0);
        rearRay.ray.origin.set(x, y, -2);
        const head = frontRay.intersectObject(bed.headboard, true)[0],
          surround = rearRay.intersectObject(bed.surroundShell, false)[0];
        assert.ok(head && surround);
        const gap = surround.point.z - head.point.z;
        assert.ok(gap > 0.005 && gap < 0.045, `${style} assembly gap ${gap}`);
      }
  }
  bed.setSurroundStyle('wide');
});

test('native head deck tips clear the revised surround rear cross rail', () => {
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0)),
    point = new THREE.Vector3();
  for (const style of ['wide', 'flush']) {
    bed.setSurroundStyle(style);
    for (let back = 0; back <= 65; back += 5) {
      bed.update({ ...state, back, leg: 35 });
      for (const mesh of bed.decks[0].group.children) {
        const p = mesh.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          point.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
          if (point.z > -DIMENSIONS.length / 2 + 0.15 || point.y > SURROUND_HEIGHT.top + 0.06)
            continue;
          ray.ray.origin.set(point.x, 2, point.z);
          const hit = ray.intersectObject(bed.surroundShell, false)[0];
          if (hit) assert.ok(point.y > hit.point.y + 0.002, `${style} deck enters rear upholstery`);
        }
      }
    }
  }
  bed.setSurroundStyle('wide');
});

test('CAD assembly has five source panels, two base halves and six grounded legs', () => {
  bed.update({ ...state, mechanism: true, showDecks: true });
  assert.equal(bed.decks.length, 5);
  assert.equal(bed.cadFrame.legs.length, 6);
  assert.ok(bed.base.getObjectByName('Front_Tubular_Base'));
  assert.ok(bed.base.getObjectByName('Rear_Tubular_Base'));
  assert.deepEqual(
    bed.decks.map((d) => d.panel.userData.sourceMeshes[0]),
    [110, 100, 130, 140, 150],
  );
  const pads = bed.base.children.filter((m) => m.name === 'CAD_Floor_Pad');
  assert.equal(pads.length, 6);
  for (const pad of pads) near(bounds(pad).min.y, 0);
  assert.ok(bed.decks.every((d) => d.panel.visible));
  bed.update({ ...state, mechanism: true, showDecks: false });
  assert.ok(bed.decks.every((d) => !d.panel.visible));
  bed.update({ ...state, mechanism: false });
  assert.ok(bed.decks.every((d) => d.panel.visible));
  let triangles = 0;
  bed.cadFrame.assembly.traverse((o) => {
    if (o.isMesh)
      triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3;
  });
  assert.ok(triangles < 65000, `CAD triangle budget exceeded: ${triangles}`);
});

test('actual mattress, surround and headboard bounds meet the 160 by 190 size contract', () => {
  const original = bed.surroundStyle;
  for (const [style, outerWidth, headWidth, footExtra] of [
    ['wide', 1.76, 1.82, 0.075],
    ['flush', 1.6, 1.72, 0],
  ]) {
    bed.setSurroundStyle(style);
    bed.update({
      ...state,
      xray: 0,
      pressures: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    });
    const cover = bounds(bed.cover),
      rim = bounds(bed.surroundShell),
      head = bounds(bed.headboard);
    const size = cover.getSize(new THREE.Vector3());
    near(size.x, 1.6);
    near(size.z, 1.9);
    near(size.y, 0.21);
    near(size.z / size.x, 190 / 160);
    near(rim.max.x - rim.min.x, outerWidth);
    near(head.max.x - head.min.x, headWidth);
    near(head.max.y, HEADBOARD_LAYOUT.height);
    near(head.min.y, 0);
    near(rim.max.z - cover.max.z, footExtra);
    near(rim.max.x - cover.max.x, style === 'wide' ? 0.08 : 0);
    near(head.max.x - cover.max.x, style === 'wide' ? 0.11 : 0.06);
    near(cover.getCenter(new THREE.Vector3()).x, head.getCenter(new THREE.Vector3()).x);
    assert.ok(
      bounds(bed.headboard.getObjectByName('Headboard_Standing_Back_Frame')).max.z <
        cover.min.z - 0.1,
    );
    assert.ok(bed.headboards[style].visible);
    assert.equal(Object.values(bed.headboards).filter((h) => h.visible).length, 1);
  }
  bed.setSurroundStyle(original);
});

test('embedded decks retain the supplied STEP dimensions and mattress is supported near both ends', () => {
  near(CAD_FIT.scale, 1);
  bed.setSurroundStyle('wide');
  bed.update({ ...state, xray: 0 });
  const decks = new THREE.Box3();
  bed.decks.forEach((d) => decks.union(bounds(d.panel)));
  near(decks.max.x - decks.min.x, 1.59, 0.001);
  near(decks.max.z - decks.min.z, 1.89, 0.001);
  const cover = bounds(bed.cover);
  assert.ok(Math.abs(cover.min.z - decks.min.z) < 0.015);
  assert.ok(Math.abs(cover.max.z - decks.max.z) < 0.015);
  near(DIMENSIONS.deckHeight, 0.36);
});

test('universal upholstered retainer replaces the iron bar without shrinking in the flush frame', () => {
  assert.equal(bed.root.getObjectByName('Mattress_Retaining_Bar'), undefined);
  const retainer = bed.cadFrame.retainer,
    face = retainer.getObjectByName('Padded_Retaining_Face');
  assert.ok(retainer.parent === bed.decks[4].group);
  assert.equal(retainer.userData.branding, 'DeRUCCI');
  for (const style of ['wide', 'flush']) {
    bed.setSurroundStyle(style);
    bed.update({ ...state, xray: 0 });
    const b = bounds(face),
      size = b.getSize(new THREE.Vector3()),
      rest = retainer.position.clone();
    near(size.x, RETAINER_SIZE.width);
    near(size.y, RETAINER_SIZE.height);
    near(size.z, RETAINER_SIZE.depth);
    near(b.min.y, RETAINER_SIZE.bottom);
    near(b.min.z - DIMENSIONS.length / 2, 0.004);
    for (const leg of [10, 24, 35]) {
      bed.update({ ...state, back: 65, leg, xray: 0 });
      assert.ok(retainer.position.equals(rest));
      near(bounds(face).getSize(new THREE.Vector3()).x, 0.3);
    }
  }
  bed.setSurroundStyle('wide');
});

test('padded retainer clears the deformed mattress and foot surround over all leg angles', () => {
  const retainer = bed.cadFrame.retainer,
    normal = new THREE.Vector3(),
    point = new THREE.Vector3(),
    ray = new THREE.Raycaster();
  let samples = 0;
  for (const style of ['flush', 'wide']) {
    bed.setSurroundStyle(style);
    for (let leg = 0; leg <= 35; leg++)
      for (const pressure of [0, 100]) {
        bed.update({
          ...state,
          back: 65,
          leg,
          xray: 0,
          pressures: [
            [pressure, pressure, pressure, pressure],
            [100 - pressure, 100 - pressure, 100 - pressure, 100 - pressure],
          ],
        });
        normal.set(0, 0, 1).transformDirection(retainer.matrixWorld);
        for (const x of [-0.12, 0, 0.12])
          for (const y of [0.015, 0.03, 0.045, 0.06, 0.075]) {
            point.set(x, y, 0).applyMatrix4(retainer.matrixWorld);
            ray.set(point.clone().addScaledVector(normal, 0.2), normal.clone().negate());
            const hit = ray.intersectObject(bed.cover, false)[0];
            assert.ok(hit, `missing mattress ray at ${style}/${leg}/${x}/${y}`);
            samples++;
            assert.ok(
              hit.distance > 0.202,
              `retainer entered mattress at ${style}/${leg}: ${hit.distance - 0.2}`,
            );
          }
        assert.ok(
          bounds(retainer).min.y > bounds(bed.surroundShell).max.y + 0.002,
          `retainer mount enters surround at ${style}/${leg}`,
        );
      }
  }
  assert.equal(samples, 2160);
  bed.setSurroundStyle('wide');
});

test('front brand marks stay on the cover with readable outward normals through bending and inflation', () => {
  assert.deepEqual(
    bed.branding.map((m) => m.userData.text),
    FRONT_MARKS.map((m) => m.text),
  );
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    point = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    ray = new THREE.Raycaster();
  for (const [back, leg] of [
    [0, 0],
    [28, 24],
    [65, 35],
  ])
    for (const pressure of [0, 100]) {
      bed.update({
        ...state,
        back,
        leg,
        xray: 0,
        pressures: [
          [pressure, pressure, pressure, pressure],
          [100 - pressure, 100 - pressure, 100 - pressure, 100 - pressure],
        ],
      });
      for (const mark of bed.branding) {
        assert.ok(mark.visible);
        const p = mark.geometry.attributes.position,
          index = mark.geometry.index;
        for (let i = 0; i < index.count; i += 12) {
          a.fromBufferAttribute(p, index.getX(i));
          b.fromBufferAttribute(p, index.getX(i + 1));
          c.fromBufferAttribute(p, index.getX(i + 2));
          point.copy(a).add(b).add(c).divideScalar(3);
          normal.subVectors(b, a).cross(c.clone().sub(a)).normalize();
          assert.ok(normal.z > 0.85);
          ray.set(point.clone().addScaledVector(normal, 0.01), normal.clone().negate());
          const hits = ray.intersectObjects([mark, bed.cover], false);
          assert.ok(
            hits.length > 1 && hits[0].object === mark,
            `hidden branding at ${mark.name} ${back}/${leg}`,
          );
          const coverHit = hits.find((h) => h.object === bed.cover);
          assert.ok(coverHit && coverHit.distance > 0.0101 && coverHit.distance < 0.011);
        }
      }
    }
  for (const flags of [{ explode: 1 }, { xray: 1 }, { mechanism: true }, { headboardOnly: true }]) {
    bed.update({ ...state, xray: 0, ...flags });
    let marks = 0,
      retainers = 0;
    bed.root.traverseVisible((o) => {
      if (bed.branding.includes(o)) marks++;
      if (o === bed.cadFrame.retainer) retainers++;
    });
    assert.equal(marks, 0);
    assert.equal(retainers, flags.headboardOnly ? 0 : 1);
  }
});

test('reference headboard has eight sculpted channels and preserves both fitted sizes and floor contact', () => {
  bed.setHeadboardStyle('channel');
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  for (const style of ['wide', 'flush']) {
    bed.setSurroundStyle(style);
    bed.update({ ...state, xray: 0 });
    const face = bed.headboard.getObjectByName('Continuous_Eight_Channel_Cushion');
    assert.ok(face);
    assert.equal(face.userData.channels, 8);
    const sample = (x) => {
      ray.ray.origin.set(x, 0.9, 0);
      const hit = ray.intersectObject(face)[0];
      assert.ok(hit);
      return hit.point.z;
    };
    const width = bed.layout.headboardWidth - 0.14;
    for (let i = 1; i < 8; i++) {
      const seam = sample(width * (i / 8 - 0.5)),
        left = sample(width * ((i - 0.5) / 8 - 0.5)),
        right = sample(width * ((i + 0.5) / 8 - 0.5));
      assert.ok((left + right) / 2 - seam > 0.008, `missing channel seam ${style}/${i}`);
    }
    const size = bounds(bed.headboard);
    near(size.max.x - size.min.x, bed.layout.headboardWidth);
    near(size.max.y, HEADBOARD_LAYOUT.height);
    near(size.min.y, 0);
    for (const x of [-0.7, -0.4, 0.4, 0.7])
      for (const y of [0.4, 0.49, 0.58]) {
        ray.ray.origin.set(x, y, 0);
        const hit = ray.intersectObject(bed.headboard, true)[0];
        assert.ok(hit);
        const gap = -DIMENSIONS.length / 2 - hit.point.z;
        assert.ok(gap > 0.012 && gap < 0.045, `channel gap ${gap}`);
      }
    bed.root.traverseVisible((o) => {
      if (o.isMesh) {
        const n = o.geometry.attributes.normal;
        for (let i = 0; i < n.count; i++)
          near(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)), 1, 0.001);
      }
    });
  }
  bed.setHeadboardStyle('cushion');
  bed.setSurroundStyle('wide');
  bed.update(state);
});

test('waistband follows actual cover triangles with no corner occlusion when flat or articulated', () => {
  bed.setWaistband(true);
  const p = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    closest = new THREE.Vector3(),
    tri = new THREE.Triangle(a, b, c),
    ray = new THREE.Raycaster();
  for (const [back, leg] of [
    [0, 0],
    [28, 24],
    [65, 35],
  ])
    for (const pressure of [0, 100]) {
      bed.update({
        ...state,
        back,
        leg,
        xray: 0,
        pressures: [
          [pressure, pressure, pressure, pressure],
          [100 - pressure, 100 - pressure, 100 - pressure, 100 - pressure],
        ],
      });
      const band = bed.waistband,
        source = bed.cover.geometry.attributes.position,
        out = band.geometry.attributes.position;
      assert.equal(band.visible, true);
      for (let i = 0; i < out.count; i++) {
        const binding = band.surfaceBinding.bindings[i];
        a.fromBufferAttribute(source, binding.ids[0]);
        b.fromBufferAttribute(source, binding.ids[1]);
        c.fromBufferAttribute(source, binding.ids[2]);
        p.fromBufferAttribute(out, i);
        tri.closestPointToPoint(p, closest);
        assert.ok(p.distanceTo(closest) < 0.0015);
      }
      // Sample the centres of narrow tape quads, including all four rounded corners.
      const index = band.geometry.index;
      for (let i = 0; i < index.count; i += 48) {
        const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
        a.fromBufferAttribute(out, ids[0]);
        b.fromBufferAttribute(out, ids[1]);
        c.fromBufferAttribute(out, ids[2]);
        p.copy(a).add(b).add(c).divideScalar(3);
        normal.subVectors(b, a).cross(c.clone().sub(a)).normalize();
        if (normal.length() < 0.5) continue;
        ray.set(p.clone().addScaledVector(normal, 0.01), normal.clone().negate());
        const hits = ray.intersectObjects([band, bed.cover], false);
        assert.ok(hits.length);
        assert.ok(hits[0].object === band, `tape hidden at triangle ${i} pose ${back}/${leg}`);
      }
    }
  bed.update({ ...state, explode: 1 });
  assert.equal(bed.waistband.visible, false);
  bed.update({ ...state, xray: 0, headboardOnly: true });
  let visible = false;
  bed.root.traverseVisible((o) => {
    if (o === bed.waistband) visible = true;
  });
  assert.equal(visible, false);
  bed.setWaistband(false);
  bed.update({ ...state, xray: 0 });
  assert.equal(bed.waistband.visible, false);
});

test('headboard style changes are cached, reversible and independent of the mattress pose', () => {
  const pose = { ...state, back: 52, leg: 24, xray: 0 };
  bed.setSurroundStyle('flush');
  bed.setHeadboardStyle('cushion');
  bed.update(pose);
  const original = Array.from(bed.cover.geometry.attributes.position.array),
    cushion = bed.headboard;
  bed.setHeadboardStyle('channel');
  bed.update(pose);
  const channel = bed.headboard;
  assert.equal(cushion.visible, false);
  assert.equal(channel.visible, true);
  assert.deepEqual(Array.from(bed.cover.geometry.attributes.position.array), original);
  bed.setSurroundStyle('wide');
  bed.update(pose);
  assert.equal(bed.headboardStyle, 'channel');
  assert.equal(channel.visible, false);
  bed.setSurroundStyle('flush');
  assert.equal(bed.headboard, channel);
  bed.setHeadboardStyle('cushion');
  bed.update(pose);
  assert.equal(bed.headboard, cushion);
  assert.equal(channel.visible, false);
  assert.deepEqual(Array.from(bed.cover.geometry.attributes.position.array), original);
  bed.setSurroundStyle('wide');
});

test('all three mattress bindings have two continuous boundary loops with no flipped corner faces', () => {
  bed.setWaistband(true);
  bed.update({
    ...state,
    xray: 0,
    pressures: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  });
  for (const seam of [...bed.coverDetails, bed.waistband]) {
    const p = seam.geometry.attributes.position,
      idx = seam.geometry.index,
      keys = new Map(),
      ids = [],
      edges = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = [p.getX(i), p.getY(i), p.getZ(i)].map((v) => Math.round(v * 1e6)).join(',');
      if (!keys.has(key)) keys.set(key, keys.size);
      ids.push(keys.get(key));
    }
    for (let i = 0; i < idx.count; i += 3) {
      const tri = [ids[idx.getX(i)], ids[idx.getX(i + 1)], ids[idx.getX(i + 2)]];
      assert.equal(new Set(tri).size, 3);
      for (let k = 0; k < 3; k++) {
        const pair = [tri[k], tri[(k + 1) % 3]].sort((a, b) => a - b),
          key = pair.join(',');
        const edge = edges.get(key) || { pair, count: 0 };
        edge.count++;
        edges.set(key, edge);
      }
    }
    const boundary = new Map();
    for (const {
      pair: [a, b],
      count,
    } of edges.values()) {
      assert.ok(count === 1 || count === 2, 'non-manifold binding edge');
      if (count === 2) continue;
      for (const [x, y] of [
        [a, b],
        [b, a],
      ]) {
        if (!boundary.has(x)) boundary.set(x, []);
        boundary.get(x).push(y);
      }
    }
    for (const neighbours of boundary.values())
      assert.equal(neighbours.length, 2, 'open or branching binding edge');
    const visited = new Set();
    let loops = 0;
    for (const id of boundary.keys())
      if (!visited.has(id)) {
        loops++;
        const stack = [id];
        while (stack.length) {
          const next = stack.pop();
          if (visited.has(next)) continue;
          visited.add(next);
          stack.push(...boundary.get(next));
        }
      }
    assert.equal(loops, 2, 'binding must be a single continuous ribbon');
    const uv = seam.geometry.attributes.uv;
    for (let i = 0; i < idx.count; i += 3) {
      const u = [0, 1, 2].map((k) => uv.getX(idx.getX(i + k)));
      assert.ok(Math.max(...u) - Math.min(...u) < 0.1, 'UV wrap stretches across a face');
    }
  }
});

test('all four binding corners stay outside the mattress when flat, articulated and unevenly inflated', () => {
  bed.setWaistband(true);
  const a = new THREE.Vector3(),
    b = a.clone(),
    c = a.clone(),
    point = a.clone(),
    normal = a.clone(),
    reference = a.clone(),
    r = a.clone(),
    ray = new THREE.Raycaster();
  for (const [back, leg] of [
    [0, 0],
    [28, 24],
    [52, 10],
    [65, 35],
  ])
    for (const pressure of [0, 100]) {
      bed.update({
        ...state,
        back,
        leg,
        xray: 0,
        pressures: [
          [pressure, pressure, pressure, pressure],
          [100 - pressure, 100 - pressure, 100 - pressure, 100 - pressure],
        ],
      });
      const src = bed.cover.geometry.attributes.position,
        rest = bed.cover.userData.rest;
      for (const seam of [...bed.coverDetails, bed.waistband]) {
        const p = seam.geometry.attributes.position,
          idx = seam.geometry.index,
          corners = new Set();
        for (let i = 0; i < idx.count; i += 3) {
          const ids = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)],
            bind = seam.surfaceBinding.bindings[ids[0]];
          a.fromBufferAttribute(src, bind.ids[0]);
          b.fromBufferAttribute(src, bind.ids[1]);
          c.fromBufferAttribute(src, bind.ids[2]);
          reference.subVectors(b, a).cross(c.clone().sub(a)).normalize();
          a.fromBufferAttribute(p, ids[0]);
          b.fromBufferAttribute(p, ids[1]);
          c.fromBufferAttribute(p, ids[2]);
          normal.subVectors(b, a).cross(c.clone().sub(a)).normalize();
          assert.ok(normal.dot(reference) > 0.15, `flipped ${seam.name} at ${back}/${leg}`);
          r.set(0, 0, 0);
          bind.ids.forEach((id, k) =>
            r.addScaledVector(new THREE.Vector3().fromArray(rest, id * 3), bind.weights[k]),
          );
          if (Math.abs(r.x) < 0.7 || Math.abs(r.z) < 0.84) continue;
          corners.add((r.x < 0 ? 'L' : 'R') + (r.z < 0 ? 'H' : 'F'));
          for (const w of [
            [1 / 3, 1 / 3, 1 / 3],
            [0.6, 0.2, 0.2],
            [0.2, 0.6, 0.2],
            [0.2, 0.2, 0.6],
          ]) {
            point.copy(a).multiplyScalar(w[0]).addScaledVector(b, w[1]).addScaledVector(c, w[2]);
            ray.set(point.clone().addScaledVector(reference, 0.01), reference.clone().negate());
            const hit = ray.intersectObject(bed.cover, false)[0];
            assert.ok(hit, 'corner ray missed the mattress');
            assert.ok(
              hit.distance > 0.0101,
              `${seam.name} enters corner at ${back}/${leg}: ${hit.distance - 0.01}`,
            );
          }
        }
        assert.equal(corners.size, 4, 'all corners must be sampled');
      }
    }
});

import * as THREE from 'three';
import { CAD_MESHES } from './cad-data.js';
import { ACTUATORS, CAD_FIT, LINKAGE, cadPoint, solveMechanism } from './mechanism.js';
import { createUpholsteredRetainer } from './branding.js';

const vector = (p) => new THREE.Vector3(p.x || 0, p.y, p.z);
const decode = (s, Type) => {
  const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return new Type(bytes.buffer);
};
function geometry(key, origin = { x: 0, y: 0, z: 0 }) {
  const data = CAD_MESHES[key],
    source = decode(data.position, Int16Array),
    normals = decode(data.normal, Int8Array),
    p = [],
    n = [];
  for (let i = 0; i < source.length; i += 3) {
    const point = cadPoint(source[i] / 10, source[i + 1] / 10, source[i + 2] / 10);
    p.push(point.x - origin.x, point.y - origin.y, point.z - origin.z);
    const normal = new THREE.Vector3(
      normals[i + 1],
      normals[i + 2] / CAD_FIT.scale,
      -normals[i] / CAD_FIT.scale,
    ).normalize();
    n.push(normal.x, normal.y, normal.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  // CAD X points toward the head: converting to Three.js reflects one axis, so reverse triangle winding.
  const index = decode(data.index, data.indexBytes === 2 ? Uint16Array : Uint32Array);
  for (let i = 0; i < index.length; i += 3) {
    const v = index[i + 1];
    index[i + 1] = index[i + 2];
    index[i + 2] = v;
  }
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      p.flatMap((v, i) => (i % 3 === 0 ? [v, p[i + 2]] : [])),
      2,
    ),
  );
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
function add(parent, key, material, origin, name = key) {
  const m = new THREE.Mesh(geometry(key, origin), material);
  m.name = name;
  m.castShadow = m.receiveShadow = true;
  m.userData.sourceMeshes = CAD_MESHES[key].sourceIds;
  parent.add(m);
  return m;
}
function group(parent, name, origin) {
  const g = new THREE.Group();
  g.name = name;
  if (origin) g.position.copy(vector(origin));
  parent.add(g);
  return g;
}
function pin(parent, name, p, length = 0.04, r = 0.0064) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, length, 10),
    new THREE.MeshStandardMaterial({ color: 0xa5b5bc, metalness: 0.85, roughness: 0.3 }),
  );
  m.rotation.z = Math.PI / 2;
  m.position.copy(vector(p));
  m.name = name;
  parent.add(m);
  return m;
}

export function createCadFrame(root, frameMaterial, library) {
  const assembly = group(root, 'BZZ1_007_Adapted_Frame');
  const base = group(assembly, 'Stationary_Frame'),
    mechanismGroup = group(assembly, 'Roller_Lift_Mechanism');
  const dark = new THREE.MeshStandardMaterial({
    color: 0x252c30,
    roughness: 0.62,
    metalness: 0.25,
  });
  const hardware = new THREE.MeshStandardMaterial({
    color: 0x768589,
    roughness: 0.4,
    metalness: 0.65,
  });
  const deckMaterial = library.get('deck');
  add(base, 'frontBase', frameMaterial, undefined, 'Front_Tubular_Base');
  add(base, 'rearBase', frameMaterial, undefined, 'Rear_Tubular_Base');
  // The source has six 250 mm legs. Extend only the feet to retain the existing upholstered bed height.
  const legs = [];
  for (const [x, z, width] of [
    [755, -90.56, 614.5],
    [105, -90.56, 614.5],
    [-604.77, -91.62, 565.09],
  ])
    for (const side of [-1, 1]) {
      const p = cadPoint(x, side * width, z),
        h = p.y - 0.018;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.027, h, 12), frameMaterial);
      leg.position.set(p.x, 0.018 + h / 2, p.z);
      leg.name = 'CAD_Support_Leg';
      leg.castShadow = leg.receiveShadow = true;
      base.add(leg);
      legs.push(leg);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.018, 12), dark);
      pad.position.set(p.x, 0.009, p.z);
      pad.name = 'CAD_Floor_Pad';
      base.add(pad);
    }
  const keys = ['back', 'seat', 'lumbar', 'thigh', 'calf'];
  const decks = solveMechanism(0, 0).decks.map((pose, i) => {
    const g = group(assembly, pose.id, pose.origin),
      origin = { x: 0, ...pose.origin };
    const panel = add(g, keys[i] + 'Panel', deckMaterial, origin, 'Deck_Panel');
    const trim = add(g, keys[i] + 'Trim', hardware, origin, 'Hinges_And_Roller_Track');
    return { group: g, panel, trim };
  });
  const retainer = createUpholsteredRetainer(decks[4].group, library);
  const motors = ACTUATORS.map((spec) => {
    const lift = group(mechanismGroup, spec.id + '_Roller_Lifting_Yoke', spec.pivot);
    add(
      lift,
      spec.id + 'Lift',
      frameMaterial,
      { x: 0, ...spec.pivot },
      'Paired_Lift_Arms_And_Rollers',
    );
    const motor = group(mechanismGroup, spec.id + '_Fixed_Length_Motor', spec.anchor);
    const body = add(motor, spec.id + 'Motor', dark, spec.anchor, 'Original_Gearmotor_And_Barrel');
    const shaft = add(
      motor,
      spec.id + 'Shaft',
      hardware,
      spec.anchor,
      'Original_Telescoping_Shaft',
    );
    const fixedPin = pin(mechanismGroup, 'Frame_Clevis_Pin', spec.anchor);
    const movingPin = pin(mechanismGroup, 'Moving_Clevis_Pin', spec.restMoving);
    return { spec, lift, assembly: motor, body, shaft, fixedPin, movingPin };
  });
  const footLinks = ['left', 'right'].map((side) => {
    const pivot = { x: 0, ...LINKAGE.supportAnchor };
    const g = group(mechanismGroup, 'Calf_Constant_Length_Link_' + side, pivot);
    const bar = add(g, side + 'Support', frameMaterial, pivot, 'Original_Calf_Support_Link');
    return { group: g, bar };
  });
  function update(pose, { headboardOnly = false, mechanism = false, showDecks = false } = {}) {
    assembly.visible = !headboardOnly;
    base.visible = mechanismGroup.visible = !headboardOnly;
    decks.forEach((d, i) => {
      const p = pose.decks[i];
      d.group.position.set(0, p.origin.y, p.origin.z);
      d.group.rotation.x = p.angle;
      d.panel.visible = !mechanism || showDecks;
      d.trim.visible = !mechanism || showDecks;
    });
    motors.forEach((m, i) => {
      const p = pose.actuators[i];
      m.lift.rotation.x = p.armAngle;
      m.assembly.rotation.x = p.axisRotation;
      // Shaft slides along its original local axis; the housing never scales.
      const direction = new THREE.Vector3(
        0,
        m.spec.restMoving.y - m.spec.anchor.y,
        m.spec.restMoving.z - m.spec.anchor.z,
      ).normalize();
      m.shaft.position.copy(direction.multiplyScalar(p.stroke));
      m.movingPin.position.set(p.x, p.moving.y, p.moving.z);
    });
    const c = LINKAGE.footClevis,
      rest = { y: LINKAGE.flatKnee.y + c.y, z: LINKAGE.flatKnee.z + c.z },
      anchor = LINKAGE.supportAnchor;
    const a =
      Math.atan2(-(pose.footPin.y - anchor.y), pose.footPin.z - anchor.z) -
      Math.atan2(-(rest.y - anchor.y), rest.z - anchor.z);
    footLinks.forEach((link) => (link.group.rotation.x = a));
  }
  return {
    assembly,
    base,
    mechanismGroup,
    decks,
    motors,
    footLinks,
    legs,
    retainer,
    update,
    setWidth: (w) => {
      assembly.scale.x = w / CAD_FIT.boardWidth;
      retainer.scale.x = CAD_FIT.boardWidth / w;
    },
  };
}

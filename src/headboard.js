import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DIMENSIONS, HEADBOARD_LAYOUT, T12_HEADBOARD_LAYOUT } from './dimensions.js';
export { HEADBOARD_LAYOUT } from './dimensions.js';

const smooth = (a, b, v) => {
  const t = THREE.MathUtils.clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const cushionFront = (u, t) => {
  const fullness =
    0.038 * (1 - (Math.abs(u) * 2) ** 4) * smooth(0.12, 0.4, t) * (1 - smooth(0.63, 1, t));
  const seam = 0.13 + 0.018 * Math.sin(t * Math.PI);
  return (
    -1.087 +
    0.027 * Math.sin(Math.PI * t) ** 0.8 +
    fullness -
    0.083 * smooth(0.6, 1, t) -
    0.009 * Math.exp(-Math.pow((u - seam) / 0.035, 2)) * Math.sin(Math.PI * t)
  );
};

function addMesh(group, name, geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.castShadow = m.receiveShadow = true;
  group.add(m);
  return m;
}
function paddedPanel(
  group,
  name,
  { width, height, bottom, centerX = 0, rear, front, radius = 0.09, nx = 28, ny = 30 },
  material,
) {
  const geometry = new THREE.BoxGeometry(width, height, 1, nx, ny, 4),
    p = geometry.attributes.position,
    normals = geometry.attributes.normal.array.slice(),
    uv = geometry.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i),
      y = p.getY(i);
    const depth = THREE.MathUtils.clamp(p.getZ(i) + 0.5, 0, 1);
    const cx = THREE.MathUtils.clamp(x, -width / 2 + radius, width / 2 - radius),
      cy = THREE.MathUtils.clamp(y, -height / 2 + radius, height / 2 - radius),
      dx = x - cx,
      dy = y - cy,
      d = Math.hypot(dx, dy);
    if (d > radius) {
      x = cx + (dx / d) * radius;
      y = cy + (dy / d) * radius;
    }
    const t = THREE.MathUtils.clamp((y + height / 2) / height, 0, 1),
      u = x / width;
    const roll =
      Math.min(0.014, width * 0.12) * (1 - Math.sqrt(Math.max(0, 1 - (2 * depth - 1) ** 2)));
    x *= 1 - roll / (width / 2);
    y = bottom + t * height + roll * (1 - 2 * t);
    const z = THREE.MathUtils.lerp(typeof rear === 'function' ? rear(t) : rear, front(u, t), depth);
    x += centerX;
    p.setXYZ(i, x, y, z);
    // All upholstery pieces share a physical grain scale, including the separate cushions.
    if (Math.abs(normals[i * 3 + 2]) > 0.5) uv.setXY(i, (x + 1.13) / 2.1, y / 1.05);
    else if (Math.abs(normals[i * 3]) > 0.5) uv.setXY(i, (z + 1.4) / 2.1, y / 1.05);
    else uv.setXY(i, (x + 1.13) / 2.1, (z + 1.4) / 1.05);
  }
  geometry.computeVertexNormals();
  const n = geometry.attributes.normal;
  for (let i = 0; i < n.count; i++)
    if (Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) < 0.1)
      n.setXYZ(i, normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
  return addMesh(group, name, geometry, material);
}
export function createHeadboard(root, leather, piping, width, style = 'cushion') {
  if (style === 't12') return createT12Headboard(root, leather, width);
  if (style === 'channel') return createChannelHeadboard(root, leather, width);
  const group = new THREE.Group();
  group.name = 'Leather_Headboard';
  group.userData.structure = 'floor-standing wing frame with two upholstered cushions';
  root.add(group);
  const sy = (HEADBOARD_LAYOUT.height - 0.055) / 1.415,
    y = (v) => 0.055 + (v - 0.055) * sy;
  const dz = 1.05 - DIMENSIONS.length / 2,
    z = (v) => v + dz;
  const cushionWidth = (width - 0.26) / 2,
    cushionX = (cushionWidth + 0.012) / 2;
  group.userData.dimensions = { width, height: HEADBOARD_LAYOUT.height };
  paddedPanel(
    group,
    'Headboard_Standing_Back_Frame',
    {
      width: width - 0.12,
      height: 1.405 * sy,
      bottom: y(0.065),
      rear: z(-1.29),
      front: () => z(-1.215),
      radius: 0.05,
      nx: 20,
      ny: 20,
    },
    leather,
  );
  paddedPanel(
    group,
    'Floor_Upholstered_Apron',
    {
      width: width - 0.13,
      height: 0.585 * sy,
      bottom: y(0.065),
      rear: z(-1.245),
      front: (u, t) => z(-1.087 + 0.003 * Math.sin(Math.PI * t) - 0.004 * (Math.abs(u) * 2) ** 4),
      radius: 0.025,
      nx: 24,
      ny: 12,
    },
    leather,
  );
  for (const side of [-1, 1]) {
    paddedPanel(
      group,
      side < 0 ? 'Curved_Wing_Left' : 'Curved_Wing_Right',
      {
        width: 0.11,
        height: 1.415 * sy,
        bottom: 0.055,
        centerX: (side * (width - 0.11)) / 2,
        rear: (t) => z(-1.3 + 0.018 * Math.sin(Math.PI * t)),
        front: (u, t) =>
          z(
            -1.112 +
              0.035 * Math.exp(-Math.pow((t - 0.48) / 0.25, 2)) -
              0.065 * smooth(0.65, 1, t) +
              0.014 * (1 - smooth(0, 0.18, t)),
          ),
        radius: 0.045,
        nx: 6,
        ny: 36,
      },
      leather,
    );
    const cushion = paddedPanel(
      group,
      side < 0 ? 'Back_Cushion_Left' : 'Back_Cushion_Right',
      {
        width: cushionWidth,
        height: 0.82 * sy,
        bottom: y(0.595),
        centerX: side * cushionX,
        rear: z(-1.237),
        front: (u, t) => z(cushionFront(u, t)),
        radius: 0.085,
        nx: 32,
        ny: 32,
      },
      leather,
    );
    cushion.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1)),
      points = [];
    for (let i = 0; i <= 40; i++) {
      const t = 0.09 + (i / 40) * 0.83,
        x = side * cushionX + cushionWidth * (0.13 + 0.018 * Math.sin(t * Math.PI));
      ray.ray.origin.set(x, y(0.595 + t * 0.82), 0);
      const hit = ray.intersectObject(cushion, false)[0];
      if (hit) points.push(hit.point.add(new THREE.Vector3(0, 0, 0.0004)));
    }
    addMesh(
      group,
      'Cushion_Tailored_Seam',
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, 0.0006, 4, false),
      piping,
    );
  }
  const feetMaterial = new THREE.MeshStandardMaterial({
    color: 0x202628,
    roughness: 0.38,
    metalness: 0.6,
  });
  for (const side of [-1, 1]) {
    const x = side * (width / 2 - 0.15);
    const leg = addMesh(
      group,
      'Headboard_Independent_Foot',
      new RoundedBoxGeometry(0.065, 0.076, 0.1, 1, 0.006),
      feetMaterial,
    );
    leg.position.set(x, 0.047, z(-1.218));
    const pad = addMesh(
      group,
      'Headboard_Floor_Pad',
      new RoundedBoxGeometry(0.085, 0.014, 0.12, 1, 0.004),
      feetMaterial,
    );
    pad.position.set(x, 0.007, z(-1.218));
  }
  return group;
}

function createChannelHeadboard(root, leather, width) {
  const group = new THREE.Group();
  group.name = 'Channel_Leather_Headboard';
  root.add(group);
  group.userData = {
    structure: 'floor-standing continuous eight-channel upholstery',
    style: 'channel',
    channels: 8,
    dimensions: { width, height: HEADBOARD_LAYOUT.height },
  };
  const zOffset = 1.9 / 2 - DIMENSIONS.length / 2,
    z = (v) => v + zOffset;
  const top = HEADBOARD_LAYOUT.height;
  paddedPanel(
    group,
    'Headboard_Standing_Back_Frame',
    {
      width: width - 0.05,
      height: top - 0.055,
      bottom: 0.055,
      rear: z(-1.195),
      front: () => z(-1.115),
      radius: 0.085,
      nx: 24,
      ny: 24,
    },
    leather,
  );
  paddedPanel(
    group,
    'Floor_Upholstered_Apron',
    {
      width: width - 0.12,
      height: 0.54,
      bottom: 0.065,
      rear: z(-1.15),
      front: (u) => z(-0.987 - 0.004 * (Math.abs(u) * 2) ** 4),
      radius: 0.025,
      nx: 24,
      ny: 12,
    },
    leather,
  );
  for (const side of [-1, 1])
    paddedPanel(
      group,
      side < 0 ? 'Curved_Wing_Left' : 'Curved_Wing_Right',
      {
        width: 0.07,
        height: top - 0.055,
        bottom: 0.055,
        centerX: (side * (width - 0.07)) / 2,
        rear: z(-1.2),
        front: (u, t) => z(-0.995 + 0.01 * Math.sin(Math.PI * t) - 0.045 * smooth(0.74, 1, t)),
        radius: 0.028,
        nx: 6,
        ny: 32,
      },
      leather,
    );
  const face = paddedPanel(
    group,
    'Continuous_Eight_Channel_Cushion',
    {
      width: width - 0.14,
      height: top - 0.58,
      bottom: 0.55,
      rear: z(-1.115),
      radius: 0.078,
      nx: 160,
      ny: 30,
      front: (u, t) => {
        const phase = (u + 0.5) * 8,
          groove = Math.exp(-Math.pow((phase - Math.round(phase)) / 0.045, 2));
        const crown = 0.01 * Math.pow(Math.abs(Math.sin(Math.PI * phase)), 0.55);
        const seamFade = smooth(0, 0.04, t) * (1 - smooth(0.96, 1, t));
        return z(
          -0.988 +
            0.026 * Math.sin(Math.PI * t) -
            0.045 * smooth(0.62, 1, t) +
            (crown - 0.007 * groove) * seamFade,
        );
      },
    },
    leather,
  );
  face.userData.channels = 8;
  const feetMaterial = new THREE.MeshStandardMaterial({
    color: 0x202628,
    roughness: 0.38,
    metalness: 0.6,
  });
  for (const side of [-1, 1]) {
    const x = side * (width / 2 - 0.15);
    const leg = addMesh(
      group,
      'Headboard_Independent_Foot',
      new RoundedBoxGeometry(0.065, 0.076, 0.1, 1, 0.006),
      feetMaterial,
    );
    leg.position.set(x, 0.047, z(-1.118));
    const pad = addMesh(
      group,
      'Headboard_Floor_Pad',
      new RoundedBoxGeometry(0.085, 0.014, 0.12, 1, 0.004),
      feetMaterial,
    );
    pad.position.set(x, 0.007, z(-1.118));
  }
  return group;
}

function t12PaddedPanel(
  group,
  name,
  { width, height, bottom, centerX = 0, rear, front, radius, nx = 32, ny = 24 },
  material,
) {
  const depth = front(0, 0.5) - rear,
    r = Math.min(radius, depth / 2),
    half = new THREE.Vector3(width / 2, height / 2, depth / 2);
  const core = half.clone().subScalar(r),
    minCore = core.clone().negate(),
    geometry = new THREE.BoxGeometry(width, height, depth, nx, ny, 8);
  const p = geometry.attributes.position,
    uv = geometry.attributes.uv,
    originalNormals = geometry.attributes.normal.array.slice();
  const v = new THREE.Vector3(),
    q = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    q.copy(v).clamp(minCore, core);
    v.sub(q).normalize().multiplyScalar(r).add(q);
    const u = v.x / width,
      t = (v.y + half.y) / height,
      s = (v.z + half.z) / depth;
    const z = THREE.MathUtils.lerp(rear, front(u, t), s),
      x = v.x + centerX,
      y = v.y + bottom + half.y;
    p.setXYZ(i, x, y, z);
    if (Math.abs(originalNormals[i * 3 + 2]) > 0.5) uv.setXY(i, (x + 1.13) / 2.1, y / 1.05);
    else if (Math.abs(originalNormals[i * 3]) > 0.5) uv.setXY(i, (z + 1.4) / 2.1, y / 1.05);
    else uv.setXY(i, (x + 1.13) / 2.1, (z + 1.4) / 1.05);
  }
  // Share normals across UV seams so the cushion edge reads as a soft roll, not a hard cap.
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal,
    shared = new Map(),
    keys = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${Math.round(p.getX(i) * 1e6)},${Math.round(p.getY(i) * 1e6)},${Math.round(p.getZ(i) * 1e6)}`;
    keys.push(key);
    if (!shared.has(key)) shared.set(key, new THREE.Vector3());
    shared.get(key).add(v.fromBufferAttribute(normals, i));
  }
  for (let i = 0; i < p.count; i++) {
    v.copy(shared.get(keys[i])).normalize();
    normals.setXYZ(i, v.x, v.y, v.z);
  }
  return addMesh(group, name, geometry, material);
}

function createT12Headboard(root, leather, width) {
  const d = T12_HEADBOARD_LAYOUT,
    group = new THREE.Group();
  group.name = 'T12_Two_Row_Headboard';
  root.add(group);
  group.userData = {
    style: 't12',
    structure: 'two upper cushions and two lower bolsters, concealed standing back',
    dimensions: { width, height: d.height },
  };
  t12PaddedPanel(
    group,
    'T12_Standing_Back',
    {
      width,
      height: d.height - d.bottom - 0.008,
      bottom: d.bottom,
      rear: d.rear,
      front: (u, t) =>
        THREE.MathUtils.lerp(
          d.bodyFront,
          d.upperBodyFront,
          smooth(d.lowerBottom - 0.05, d.lowerBottom, d.bottom + t * (d.height - d.bottom - 0.008)),
        ),
      radius: 0.032,
      nx: 24,
      ny: 24,
    },
    leather,
  );
  const panelWidth = (width - d.edgeInset * 2 - d.centerGap) / 2;
  const seamMaterial = new THREE.LineBasicMaterial({ color: 0x777068 });
  const insetMaterial = new THREE.LineBasicMaterial({ color: 0x171617 });
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  for (const side of [-1, 1]) {
    const centerX = (side * (panelWidth + d.centerGap)) / 2;
    const upper = t12PaddedPanel(
      group,
      `T12_Upper_Cushion_${side}`,
      {
        width: panelWidth,
        height: d.upperHeight,
        bottom: d.upperBottom,
        centerX,
        rear: d.rear + 0.018,
        radius: d.radius,
        nx: 40,
        ny: 32,
        front: (u, t) => {
          const seam = side * (0.11 + 0.025 * Math.sin(Math.PI * t));
          const crown =
            d.upperCrown * Math.sin(Math.PI * t) ** 0.65 * (1 - 0.22 * (2 * Math.abs(u)) ** 6);
          return (
            d.upperFront +
            crown -
            d.upperLean * t -
            0.01 * (2 * Math.abs(u)) ** 6 -
            d.seamDepth * Math.exp(-(((u - seam) / d.seamHalfWidth) ** 2)) * Math.sin(Math.PI * t)
          );
        },
      },
      leather,
    );
    t12PaddedPanel(
      group,
      `T12_Lower_Bolster_${side}`,
      {
        width: panelWidth,
        height: d.lowerHeight,
        bottom: d.lowerBottom,
        centerX,
        rear: d.rear + 0.016,
        radius: 0.028,
        nx: 30,
        ny: 16,
        front: (u, t) =>
          d.lowerFront +
          d.lowerCrown * Math.sin(Math.PI * t) ** 0.7 -
          0.008 * (2 * Math.abs(u)) ** 6,
      },
      leather,
    );
    upper.updateMatrixWorld(true);
    const surface = (x, y) => {
      ray.ray.origin.set(x, y, 0);
      const hit = ray.intersectObject(upper, false)[0];
      return hit?.point.add(new THREE.Vector3(0, 0, 0.00045));
    };
    // Two rows of individual stitches sit on the actual curved upholstery surface.
    for (const offset of [-0.0015, 0.0015]) {
      const points = [];
      for (let i = 0; i < 96; i++)
        for (const fraction of [0, 0.45]) {
          const t = 0.045 + ((i + fraction) / 96) * 0.91;
          const x = centerX + panelWidth * side * (0.11 + 0.025 * Math.sin(Math.PI * t)) + offset;
          const p = surface(x, d.upperBottom + t * d.upperHeight);
          if (p) points.push(p);
        }
      const stitches = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(points),
        seamMaterial,
      );
      stitches.name = `T12_Curved_Double_Stitch_${side}_${offset}`;
      group.add(stitches);
    }
    // Fine top-edge stitching replaces the wide shiny border of the generic frame.
    const edge = [];
    for (let i = 0; i <= 70; i++) {
      const x = centerX - panelWidth / 2 + d.radius + ((panelWidth - 2 * d.radius) * i) / 70;
      const p = surface(x, d.height - 0.008);
      if (p) edge.push(p);
    }
    const topSeam = new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge), insetMaterial);
    topSeam.name = `T12_Top_Edge_Seam_${side}`;
    group.add(topSeam);
  }
  const zipMaterial = new THREE.MeshStandardMaterial({
    color: 0x656361,
    roughness: 0.57,
    metalness: 0.48,
  });
  const feetMaterial = new THREE.MeshStandardMaterial({ color: 0x1a191a, roughness: 0.7 });
  for (const side of [-1, 1]) {
    const zip = addMesh(
      group,
      `T12_Side_Zip_${side}`,
      new THREE.BoxGeometry(0.002, d.lowerBottom - 0.1, 0.002),
      zipMaterial,
    );
    zip.position.set(side * (width / 2 - 0.003), (d.lowerBottom + 0.02) / 2, d.bodyFront + 0.001);
    for (const y of [0.09, d.lowerBottom - 0.035]) {
      const pull = addMesh(
        group,
        'T12_Zip_Pull',
        new RoundedBoxGeometry(0.004, 0.017, 0.003, 1, 0.001),
        zipMaterial,
      );
      pull.position.set(side * (width / 2 - 0.003), y, d.bodyFront + 0.003);
    }
    const foot = addMesh(
      group,
      'T12_Independent_Foot',
      new RoundedBoxGeometry(0.047, 0.034, 0.086, 1, 0.004),
      feetMaterial,
    );
    foot.position.set(side * (width / 2 - 0.08), 0.017, d.rear + 0.06);
  }
  return group;
}

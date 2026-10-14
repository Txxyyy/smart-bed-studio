import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DIMENSIONS } from './dimensions.js';
import { LINKAGE } from './mechanism.js';
import { updateBoundWelt } from './upholstery.js';
// DeRUCCI 字标取自 https://us.derucci.com/ (2026-09-07)，原始透明 PNG 未修改。
// SHA-256 bacb8e21fbb32d585b9a8852ba9d27dca684e50dbe489f8b9f66f37f21824b3c；构建时由 Vite 内联为 data URL。
const WORDMARK_IMAGE = new URL('./assets/derucci-wordmark.png', import.meta.url).href;

let wordmarkImage;
export async function prepareBrandArtwork() {
  if (wordmarkImage) return;
  const image = new Image();
  image.src = WORDMARK_IMAGE;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = Math.round((2048 * image.height) / image.width);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  image.src = '';
  wordmarkImage = canvas;
}

export const RETAINER_SIZE = {
  width: 0.3,
  height: 0.096,
  depth: 0.02,
  bottom: 0.371,
  rear: DIMENSIONS.length / 2 + 0.004,
};
export const FRONT_MARKS = [
  {
    name: 'Mattress_DeRUCCI_AI',
    material: 'brand',
    text: 'DeRUCCI AI',
    x: -0.575,
    y: 0.173,
    width: 0.213,
    height: 0.032,
  },
  {
    name: 'Mattress_T11_Plus',
    material: 'modelMark',
    text: 'T11+',
    x: 0.64,
    y: 0.173,
    width: 0.105,
    height: 0.03,
  },
];

// Separate alpha artwork preserves the fabric underneath and remains replaceable in exported GLBs.
export function brandingMap(pattern) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = pattern === 'derucciAI' ? 160 : 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  const word = (text, x, y, width, height, font) => {
    ctx.font = font;
    const m = ctx.measureText(text),
      h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(width / m.width, height / h);
    ctx.fillText(text, 0, m.actualBoundingBoxAscent);
    ctx.restore();
  };
  if (pattern === 'derucciAI') {
    ctx.drawImage(wordmarkImage, 25, 13, 798, 133.56);
    ctx.fillRect(876, 26, 110, 110);
    ctx.globalCompositeOperation = 'destination-out';
    word('AI', 888, 49, 86, 65, 'bold 100px Arial, sans-serif');
  } else if (pattern === 't11') word('T11+', 36, 40, 952, 177, '600 160px Arial, sans-serif');
  else ctx.drawImage(wordmarkImage, 28, 47, 968, 162.0);
  const map = new THREE.CanvasTexture(canvas);
  map.name = pattern + '_artwork';
  map.colorSpace = THREE.SRGBColorSpace;
  return { map };
}

export function createUpholsteredRetainer(parent, library) {
  const size = RETAINER_SIZE,
    g = new THREE.Group();
  g.name = 'Upholstered_Brand_Retainer';
  g.position.set(0, size.bottom - LINKAGE.flatKnee.y, size.rear - LINKAGE.flatKnee.z);
  parent.add(g);
  g.userData = {
    style: 'reference upholstered retainer',
    dimensions: { ...size },
    branding: 'DeRUCCI',
    mount: 'Calf_Deck',
    universal: true,
  };
  const shape = new THREE.Shape();
  shape.moveTo(-0.143, 0.003);
  shape.lineTo(0.143, 0.003);
  shape.quadraticCurveTo(0.147, 0.003, 0.147, 0.007);
  shape.lineTo(0.147, 0.078);
  shape.quadraticCurveTo(0.147, 0.081, 0.141, 0.082);
  shape.bezierCurveTo(0.11, 0.088, 0.078, 0.093, 0.06, 0.093);
  shape.lineTo(-0.06, 0.093);
  shape.bezierCurveTo(-0.078, 0.093, -0.11, 0.088, -0.141, 0.082);
  shape.quadraticCurveTo(-0.147, 0.081, -0.147, 0.078);
  shape.lineTo(-0.147, 0.007);
  shape.quadraticCurveTo(-0.147, 0.003, -0.143, 0.003);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.014,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 3,
    steps: 1,
    curveSegments: 16,
  });
  geo.translate(0, 0, 0.003);
  const uv = geo.attributes.uv,
    p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 0.15) / 0.3, p.getY(i) / 0.096);
  const shell = new THREE.Mesh(geo, library.get('retainer'));
  shell.name = 'Padded_Retaining_Face';
  shell.castShadow = shell.receiveShadow = true;
  g.add(shell);
  // Slim mounting tongues sit above the foot surround and are concealed behind the padded face.
  const hardware = new THREE.MeshStandardMaterial({
    name: 'retainer_mount',
    color: 0x303638,
    roughness: 0.6,
    metalness: 0.65,
  });
  for (const x of [-0.102, 0.102]) {
    const tongue = new THREE.Mesh(new RoundedBoxGeometry(0.024, 0.004, 0.054, 1, 0.001), hardware);
    tongue.name = 'Concealed_Retainer_Mount';
    tongue.position.set(x, -0.014, -0.021);
    g.add(tongue);
    const riser = new THREE.Mesh(new RoundedBoxGeometry(0.024, 0.022, 0.004, 1, 0.001), hardware);
    riser.name = 'Concealed_Retainer_Riser';
    riser.position.set(x, -0.005, 0.001);
    g.add(riser);
  }
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.185, 0.04625), library.get('retainerLogo'));
  logo.name = 'Retainer_DeRUCCI_Logo';
  logo.position.set(0, 0.055, 0.0203);
  g.add(logo);
  // Tailored edge: a sub-millimetre recessed stitch, not a raised metal outline.
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x504941, roughness: 0.95 });
  const points = [
    new THREE.Vector3(-0.141, 0.012, 0.0201),
    new THREE.Vector3(-0.141, 0.079, 0.0201),
    new THREE.Vector3(0, 0.089, 0.0201),
    new THREE.Vector3(0.141, 0.079, 0.0201),
    new THREE.Vector3(0.141, 0.012, 0.0201),
  ];
  const seam = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.15),
      48,
      0.00035,
      4,
      false,
    ),
    edgeMaterial,
  );
  seam.name = 'Retainer_Tailored_Seam';
  g.add(seam);
  return g;
}

export function createMattressBranding(cover, library, marks = FRONT_MARKS) {
  const source = cover.geometry,
    p = source.attributes.position,
    idx = source.index,
    triangles = [];
  const front = source.groups.find((g) => g.materialIndex === 4);
  for (let i = front.start; i < front.start + front.count; i += 3) {
    const ids = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    const tri = new THREE.Triangle(
      ...ids.map((n) => new THREE.Vector3().fromBufferAttribute(p, n)),
    );
    if (tri.getArea() > 1e-10) triangles.push({ ids, tri });
  }
  return marks.map((mark) => {
    const geometry = new THREE.PlaneGeometry(mark.width, mark.height, 18, 4),
      out = geometry.attributes.position,
      bindings = [];
    const q = new THREE.Vector3(),
      bary = new THREE.Vector3();
    for (let i = 0; i < out.count; i++) {
      const v = new THREE.Vector3(
        out.getX(i) + mark.x,
        out.getY(i) + mark.y,
        DIMENSIONS.length / 2,
      );
      let best = null,
        distance = Infinity;
      for (const t of triangles) {
        t.tri.closestPointToPoint(v, q);
        const d = q.distanceToSquared(v);
        if (d < distance) {
          best = t;
          distance = d;
        }
      }
      best.tri.closestPointToPoint(v, q);
      best.tri.getBarycoord(q, bary);
      bindings.push({ ids: best.ids, weights: bary.toArray(), lift: 0.00055 });
    }
    const mesh = new THREE.Mesh(geometry, library.get(mark.material));
    mesh.name = mark.name;
    mesh.receiveShadow = true;
    mesh.userData = {
      text: mark.text,
      placement: 'foot facing',
      artwork:
        mark.material === 'brand'
          ? 'official DeRUCCI wordmark with reference AI badge'
          : 'reference T11+ reconstruction',
    };
    mesh.surfaceBinding = { cover, bindings };
    updateBoundWelt(mesh);
    return mesh;
  });
}

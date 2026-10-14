import * as THREE from 'three';
import { DIMENSIONS, TAILORED_COVER } from './dimensions.js';
import { updateBoundWelt } from './upholstery.js';

// Small sewn pieces use the same triangle binding as the cover trims.
function patch(
  cover,
  material,
  side,
  z,
  y,
  width,
  height,
  name,
  lift = 0.0015,
  textile = false,
  relief = () => 0,
) {
  const source = cover.geometry,
    p = source.attributes.position,
    index = source.index;
  const group = source.groups.find((g) => g.materialIndex === (side > 0 ? 0 : 1)),
    triangles = [];
  for (let i = group.start; i < group.start + group.count; i += 3) {
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const tri = new THREE.Triangle(
      ...ids.map((id) => new THREE.Vector3().fromBufferAttribute(p, id)),
    );
    if (tri.getArea() > 1e-10) triangles.push({ ids, tri });
  }
  const geometry = new THREE.PlaneGeometry(width, height, 4, 10),
    out = geometry.attributes.position,
    uv = geometry.attributes.uv,
    bindings = [];
  const q = new THREE.Vector3(),
    bary = new THREE.Vector3();
  for (let i = 0; i < out.count; i++) {
    const v = new THREE.Vector3(
      (side * DIMENSIONS.width) / 2,
      y + out.getY(i),
      z - side * out.getX(i),
    );
    let best,
      distance = Infinity;
    for (const t of triangles) {
      t.tri.closestPointToPoint(v, q);
      const d = q.distanceToSquared(v);
      if (d < distance) {
        distance = d;
        best = t;
      }
    }
    best.tri.closestPointToPoint(v, q);
    best.tri.getBarycoord(q, bary);
    bindings.push({ ids: best.ids, weights: bary.toArray(), lift: lift + relief(v.z, v.y) });
    if (textile)
      uv.setXY(
        i,
        (uv.getX(i) * width) / DIMENSIONS.length,
        (uv.getY(i) * height) / DIMENSIONS.mattressHeight,
      );
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.surfaceBinding = { cover, bindings, smooth: true };
  updateBoundWelt(mesh);
  return mesh;
}

export function createTailoredAttachments(cover, library) {
  const result = [],
    d = TAILORED_COVER;
  const handleFabric = library.get('waistband').clone();
  handleFabric.name = 'T12_Handle_Twill';
  handleFabric.color.copy(library.get('side').color).multiplyScalar(0.9);
  const labelMaterial = new THREE.MeshStandardMaterial({
    name: 'T12_Cream_Woven_Label',
    color: '#c5c1b3',
    roughness: 0.96,
  });
  const ink = library.get('retainerLogo').clone();
  ink.name = 'T12_Label_Ink';
  ink.color.set('#626462');
  ink.metalness = 0;
  for (const side of [-1, 1]) {
    for (const z of d.strapPositions) {
      const name = `T12_${side < 0 ? 'L' : 'R'}_${z}`;
      const relief = (positionZ, positionY) =>
        handleRelief(positionZ - z, positionY - d.strapCenter);
      const add = (mat, centerZ, centerY, w, h, suffix, lift, textile = false) => {
        const mesh = patch(
          cover,
          mat,
          side,
          centerZ,
          centerY,
          w,
          h,
          name + suffix,
          lift,
          textile,
          relief,
        );
        mesh.userData.handle = { side, z, centerY: d.strapCenter };
        result.push(mesh);
      };
      // A full-height backing strip with folded end panels and a shallow free middle.
      add(
        handleFabric,
        z,
        d.strapCenter,
        d.strapWidth,
        d.strapHeight,
        '_Cloth_Strap',
        0.0012,
        true,
      );
      for (const sign of [-1, 1]) {
        add(
          handleFabric,
          z,
          d.strapCenter + (sign * (d.strapHeight - d.strapFold)) / 2,
          d.strapWidth - 0.003,
          d.strapFold,
          '_Fold_' + sign,
          0.0021,
          true,
        );
        add(
          library.get('piping'),
          z + (sign * d.strapWidth) / 2,
          d.strapCenter,
          d.stitchWidth * 2,
          d.strapHeight,
          '_Strap_Edge_' + sign,
          0.0023,
        );
        add(
          library.get('piping'),
          z,
          d.strapCenter + sign * (d.strapHeight / 2 - d.strapFold),
          d.strapWidth - 0.004,
          d.stitchWidth,
          '_Anchor_Stitch_' + sign,
          0.0028,
        );
      }
      add(
        library.get('retainerLogo'),
        z,
        d.strapCenter,
        d.strapLogoWidth,
        d.strapLogoHeight,
        '_Gold_Wordmark',
        0.0029,
      );
    }
    const z = d.labelZ;
    result.push(
      patch(
        cover,
        labelMaterial,
        side,
        z,
        d.labelY,
        d.labelWidth,
        d.labelHeight,
        'T12_Cream_Label_' + side,
        0.002,
      ),
    );
    result.push(
      patch(
        cover,
        ink,
        side,
        z,
        d.labelY + 0.005,
        d.labelWidth * 0.86,
        0.01,
        'T12_Label_Wordmark_' + side,
        0.0034,
      ),
    );
  }
  return result;
}

export function handleRelief(z, y) {
  const d = TAILORED_COVER,
    t = (y + d.strapHeight / 2) / d.strapHeight;
  if (t <= 0.16 || t >= 0.84) return 0;
  const length = Math.sin(((t - 0.16) / 0.68) * Math.PI) ** 2;
  const width = 0.8 + 0.2 * Math.cos((Math.min(1, Math.abs(z) / (d.strapWidth / 2)) * Math.PI) / 2);
  return d.strapLift * length * width;
}

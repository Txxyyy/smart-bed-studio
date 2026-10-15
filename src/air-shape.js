import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
// Low-resolution circular bellows share one geometry per row and deform with the bed.
// With `coords`, bellows also carry cell-local coordinates so one effect shader can draw
// per-cell rings, gauges and flow without extra draw calls:
// cellCoord = (unit x, unit z, height 0–1, cap −1/0/1), cellIndex = 0…count−1 along +X.
export function roundAirRow(width, depth, count = 7, seal = false, coords = false) {
  const pitch = width / count,
    geometries = [];
  for (let cell = 0; cell < count; cell++) {
    const geometry = seal
      ? new THREE.TorusGeometry(1, 0.035, 4, 24)
      : new THREE.CylinderGeometry(1, 1, 0.12, 24, 6);
    if (seal) geometry.rotateX(Math.PI / 2);
    const p = geometry.attributes.position,
      coord = coords && !seal ? new Float32Array(p.count * 4) : null;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i),
        rib = seal ? 1 : 0.94 + 0.06 * Math.cos((y / 0.12) * Math.PI * 6);
      if (coord) coord.set([p.getX(i), p.getZ(i), y / 0.12 + 0.5, 0], i * 4);
      p.setXYZ(
        i,
        (cell - (count - 1) / 2) * pitch + p.getX(i) * pitch * 0.46 * rib,
        y,
        p.getZ(i) * Math.min(depth, pitch) * 0.46 * rib,
      );
    }
    geometry.computeVertexNormals();
    if (coord) {
      // Cap faces keep flat ±Y normals; ribbed walls tilt by well under 0.9.
      const n = geometry.attributes.normal;
      for (let i = 0; i < p.count; i++)
        coord[i * 4 + 3] = Math.abs(n.getY(i)) > 0.9 ? Math.sign(n.getY(i)) : 0;
      geometry.setAttribute('cellCoord', new THREE.BufferAttribute(coord, 4));
      geometry.setAttribute(
        'cellIndex',
        new THREE.BufferAttribute(new Float32Array(p.count).fill(cell), 1),
      );
    }
    geometries.push(geometry);
  }
  const merged = mergeGeometries(geometries);
  geometries.forEach((g) => g.dispose());
  return merged;
}

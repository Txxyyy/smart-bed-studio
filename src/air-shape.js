import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
// Low-resolution circular bellows share one geometry per row and deform with the bed.
export function roundAirRow(width, depth, count = 7, seal = false) {
  const pitch = width / count,
    geometries = [];
  for (let cell = 0; cell < count; cell++) {
    const geometry = seal
      ? new THREE.TorusGeometry(1, 0.035, 4, 24)
      : new THREE.CylinderGeometry(1, 1, 0.12, 24, 6);
    if (seal) geometry.rotateX(Math.PI / 2);
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i),
        rib = seal ? 1 : 0.94 + 0.06 * Math.cos((y / 0.12) * Math.PI * 6);
      p.setXYZ(
        i,
        (cell - (count - 1) / 2) * pitch + p.getX(i) * pitch * 0.46 * rib,
        y,
        p.getZ(i) * Math.min(depth, pitch) * 0.46 * rib,
      );
    }
    geometry.computeVertexNormals();
    geometries.push(geometry);
  }
  const merged = mergeGeometries(geometries);
  geometries.forEach((g) => g.dispose());
  return merged;
}

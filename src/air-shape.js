import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
const capCenterColor = new THREE.Color('#218bca'),
  capEdgeColor = new THREE.Color('#1469ad');
const ribColor = new THREE.Color('#1684d5'),
  grooveColor = new THREE.Color('#07448e');

export function roundAirMaterial({ showroom = false, seal = false } = {}) {
  // Alpha and clearcoat give the blue polymer a soft shell without a transmission render pass.
  return new THREE.MeshPhysicalMaterial({
    name: seal
      ? 'Blue_Polymer_Seam'
      : showroom
        ? 'Blue_Polymer_Support_Reveal'
        : 'Blue_Polymer_Support',
    color: seal ? 0x4cb1ee : 0xffffff,
    vertexColors: !seal,
    metalness: 0,
    roughness: seal ? 0.26 : 0.28,
    clearcoat: 0.6,
    clearcoatRoughness: 0.3,
    specularIntensity: 0.4,
    envMapIntensity: 0.1,
    ior: 1.38,
    transparent: true,
    opacity: seal ? 0.82 : 0.94,
    depthWrite: !seal,
    emissive: 0x073461,
    emissiveIntensity: showroom ? 0.22 : 0.12,
  });
}
// Low-resolution circular bellows share one geometry per row and deform with the bed.
export function roundAirRow(width, depth, count = 7, seal = false) {
  const pitch = width / count,
    geometries = [];
  for (let cell = 0; cell < count; cell++) {
    const geometry = seal
      ? new THREE.TorusGeometry(1, 0.035, 4, 24)
      : new THREE.CylinderGeometry(1, 1, 0.12, 24, 6);
    if (seal) geometry.rotateX(Math.PI / 2);
    const p = geometry.attributes.position,
      n = geometry.attributes.normal;
    const colors = seal ? null : new Float32Array(p.count * 3),
      color = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i),
        rib = seal ? 1 : 0.94 + 0.06 * Math.cos((y / 0.12) * Math.PI * 6);
      if (colors) {
        // Saturated blue and a darker rim keep overhead lighting from washing the cap white.
        if (n.getY(i) > 0.5)
          color
            .copy(capCenterColor)
            .lerp(capEdgeColor, Math.min(1, Math.hypot(p.getX(i), p.getZ(i))));
        else color.copy(grooveColor).lerp(ribColor, (rib - 0.88) / 0.12);
        color.toArray(colors, i * 3);
      }
      p.setXYZ(
        i,
        (cell - (count - 1) / 2) * pitch + p.getX(i) * pitch * 0.46 * rib,
        y,
        p.getZ(i) * Math.min(depth, pitch) * 0.46 * rib,
      );
    }
    if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometries.push(geometry);
  }
  const merged = mergeGeometries(geometries);
  geometries.forEach((g) => g.dispose());
  return merged;
}

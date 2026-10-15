import * as THREE from 'three';
import { mapPoint } from './kinematics.js';

export function adjustmentDirection(status) {
  return status === 'inflating' ? 1 : status === 'deflating' ? -1 : 0;
}

const vertexShader = `
  varying vec2 p;
  void main() {
    p = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const fragmentShader = `
  precision highp float;
  varying vec2 p;
  uniform vec2 fieldSize, planeSize;
  uniform float time;

  float roundedBox(vec2 point, vec2 halfSize, float radius) {
    vec2 q = abs(point) - halfSize + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  }

  void main() {
    vec2 point = (p - .5) * planeSize;
    float d = roundedBox(point, fieldSize * .5, min(.026, fieldSize.y * .3));
    float aa = max(fwidth(d), .0007);
    float inside = 1.0 - smoothstep(-aa, aa, d);
    float edge = exp(-pow(d / max(.0014, aa), 2.0));
    float glow = exp(-abs(d) / .010);
    float breath = .5 + .5 * sin(time * 1.745);
    float scan = exp(-pow((p.x - fract(time / 4.8)) * 15.0, 2.0));
    vec2 cell = fract(p * vec2(32.0, 3.0)) - .5;
    float dots = (1.0 - smoothstep(.06, .14, length(cell))) * inside;
    float fill = inside * (.31 + .025 * breath + .08 * scan);
    float alpha = clamp(fill + edge * .82 + glow * .40, 0.0, 1.0);
    vec3 light = vec3(.025, 1.05, 2.8) * fill
      + vec3(.25, 1.7, 3.0) * edge * .82
      + vec3(.02, .80, 2.1) * glow * .40
      + vec3(.1, .50, .85) * dots * .035;
    float fade = 1.0 - smoothstep(.013, .024, max(abs(point.x) - fieldSize.x * .5,
      abs(point.y) - fieldSize.y * .5));
    gl_FragColor = vec4(light / max(alpha, .001), alpha * fade);
  }
`;

export class AdjustmentSurface {
  constructor(bags) {
    this.bags = bags;
    this.root = new THREE.Group();
    this.root.name = 'Adjustment_Surface';
    // One contour per physical row: a two-row circuit must not fill the gap between rows.
    this.entries = bags.map((bag) => {
      const id = bag.regionId ?? `${bag.side}:${bag.zone}`;
      const fieldSize = new THREE.Vector2(bag.width, bag.depth);
      const planeSize = fieldSize.clone().addScalar(0.048);
      const geometry = new THREE.PlaneGeometry(planeSize.x, planeSize.y, 10, 6);
      geometry.rotateX(-Math.PI / 2);
      const rest = geometry.attributes.position.clone();
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          fieldSize: { value: fieldSize },
          planeSize: { value: planeSize },
          time: { value: 0 },
          moving: { value: 0 },
          direction: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      // CoverReveal writes depth at order 4. Draw inside the bed before the cover so
      // the contour aligns with the bags while the original reveal still masks it.
      mesh.renderOrder = 3.5;
      mesh.visible = false;
      mesh.name = `Adjustment_${bag.id ?? id}`;
      this.root.add(mesh);
      return { id, bag, mesh, rest, x: bag.x, z: bag.z };
    });
  }

  update({ spine, selection, time, moving, pressures, airStates = {} }) {
    for (const entry of this.entries) {
      const visible =
        !!selection.activeRegionIds?.includes(entry.id) &&
        selection.kind !== 'heat' &&
        selection.kind !== 'rest';
      entry.elapsed ??= 0;
      if (visible && moving && entry.wasMoving) {
        entry.elapsed += Math.max(0, Math.min(0.1, time - entry.lastTime));
      }
      entry.lastTime = time;
      entry.wasMoving = visible && moving;
      entry.mesh.visible = visible;
      if (!visible) continue;
      const uniforms = entry.mesh.material.uniforms;
      uniforms.time.value = entry.elapsed;
      uniforms.moving.value = moving ? 1 : 0;
      uniforms.direction.value = adjustmentDirection(airStates[entry.id]?.status);
      const bag = entry.bag;
      const amount = Math.min(100, Math.max(0, pressures?.[bag.side]?.[bag.zone] ?? 0)) / 100;
      const height = bag.bottom + 2 * (bag.minHalfHeight + amount * bag.halfHeightRange) + 0.006;
      if (entry.spine === spine && entry.height === height) continue;
      entry.spine = spine;
      entry.height = height;
      const positions = entry.mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const x = entry.x + entry.rest.getX(i),
          z = entry.z + entry.rest.getZ(i);
        const point = mapPoint(spine, x, height, z, null, false, this.bags);
        positions.setXYZ(i, point.x, point.y, point.z);
      }
      positions.needsUpdate = true;
      entry.mesh.geometry.computeBoundingSphere();
    }
  }
}

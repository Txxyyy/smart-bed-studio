import { roundAirRow } from './air-shape.js';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { AIR_LAYOUT, SHOWROOM_LAYOUT } from './dimensions.js';
import { ZONES, mapPoint } from './kinematics.js';
import { DEFAULT_AIR_BAGS, humanSide } from './air-layout.js';
import { isSelectedZone } from './firmness.js';

const vertexShader = `
  attribute vec3 localPosition;
  varying vec3 vLocal;
  void main() {
    vLocal = localPosition;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const fragmentShader = `
  uniform vec3 tint;
  uniform float focus;
  uniform float amount;
  uniform float time;
  uniform float moving;
  varying vec3 vLocal;
  void main() {
    vec2 p = vLocal.xz + 0.5;
    vec2 cell = abs(fract(p * vec2(10.0, 6.0) - 0.5) - 0.5) / max(fwidth(p * vec2(10.0, 6.0)), vec2(0.001));
    float grid = 1.0 - min(min(cell.x, cell.y), 1.0);
    float edge = 1.0 - smoothstep(0.012, 0.03, min(min(p.x, 1.0-p.x), min(p.y, 1.0-p.y)));
    float scan = exp(-pow((p.y - fract(time * .55)) * 25.0, 2.0)) * moving;
    float wake = exp(-pow((p.y - fract(time * .55)+.07) * 13.0, 2.0)) * moving;
    float fill = (1.0 - smoothstep(amount-.015, amount+.015, p.x));
    float top = step(.49, vLocal.y);
    float rim = smoothstep(.44, .5, abs(vLocal.y));
    float beat = .65+.35*sin(time*2.8)*sin(time*2.8);
    float tracks = pow(.5+.5*cos(p.x*6.283*4.0),28.0);
    float packets = pow(.5+.5*cos((p.y*5.0-time*.95*moving)*6.283),8.0);
    float flow = tracks*packets*moving;
    float layers = pow(.5+.5*cos((vLocal.y*6.0-time*.4*moving)*6.283),12.0)*(1.0-top);
    float brackets = step(.32,abs(vLocal.x))*step(.30,abs(vLocal.z))*edge*top;
    float alpha = (.035+grid*.32*top+edge*.85*rim+fill*.13*top+layers*.19+brackets*.8+scan*.88*top+wake*.18*top+flow*.72*top) * focus;
    vec3 light = tint*(1.15+scan*1.2+flow*.75+brackets*.4);
    gl_FragColor = vec4(light,clamp(alpha*(1.0+moving*beat*.18),0.0,1.0));
  }
`;
const particleVertex = `
  void main(){
    vec4 mv=modelViewMatrix*vec4(position,1.0);
    gl_Position=projectionMatrix*mv;
    gl_PointSize=clamp(34.0/max(.1,-mv.z),2.0,11.0);
  }
`;
const particleFragment = `
  uniform vec3 tint;
  void main(){
    float r=length(gl_PointCoord-.5);
    float glow=exp(-r*r*16.0)*(1.0-smoothstep(.32,.5,r));
    if(glow<.01)discard;
    gl_FragColor=vec4(tint*(1.4+exp(-r*r*80.0)*1.6),glow*.9);
  }
`;

export class FirmnessEffect {
  constructor(airbags = DEFAULT_AIR_BAGS) {
    this.root = new THREE.Group();
    this.root.name = 'Firmness_Showroom_Overlay';
    this.root.visible = false;
    this.entries = [];
    for (const definition of airbags) {
      const { side, zone, width, depth } = definition;
      const geometry =
        definition.shape === 'round-array'
          ? roundAirRow(width, depth)
          : new RoundedBoxGeometry(
              width,
              0.12,
              depth,
              2,
              Math.min(0.047, width * 0.2, depth * 0.2),
            );
      geometry.computeBoundingSphere();
      const rest = geometry.attributes.position.clone(),
        local = rest.clone();
      for (let i = 0; i < local.count; i++)
        local.setXYZ(i, rest.getX(i) / width, rest.getY(i) / 0.12, rest.getZ(i) / depth);
      geometry.setAttribute('localPosition', local);
      const color = new THREE.Color(side === 0 ? '#56f5db' : '#68bfff');
      const material = new THREE.ShaderMaterial({
        uniforms: {
          tint: { value: color },
          focus: { value: 0 },
          amount: { value: 0.5 },
          time: { value: 0 },
          moving: { value: 0 },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const tile = new THREE.Mesh(geometry, material);
      tile.name = `Hologram_${side}_${zone}`;
      const pulseGeometry = new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 65 }, () => new THREE.Vector3()),
      );
      const pulse = new THREE.Line(
        pulseGeometry,
        new THREE.LineBasicMaterial({
          color: color.clone().multiplyScalar(1.7),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const particles = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 40 }, () => new THREE.Vector3()),
        ),
        new THREE.ShaderMaterial({
          uniforms: { tint: { value: color } },
          vertexShader: particleVertex,
          fragmentShader: particleFragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      // Draw before the textile cover so its local opacity masks the internal effect.
      tile.renderOrder = 2;
      pulse.renderOrder = 3;
      particles.renderOrder = 3;
      this.root.add(tile, pulse, particles);
      this.entries.push({ definition, side, zone, tile, pulse, particles, rest });
    }
  }

  update({ spine, pressures, selection, time, moving }) {
    if (!this.root.visible) return;
    for (const entry of this.entries) {
      const { definition, side, zone, tile, pulse, particles, rest } = entry;
      const selected = selection.activeRegionIds
        ? selection.activeRegionIds.includes(definition.regionId)
        : isSelectedZone(selection, side, zone);
      // The legacy studio names sides from the foot; SDK region IDs use supine sides.
      const selectedSide = selection.activeRegionIds
        ? humanSide(side)
        : side === 0
          ? 'left'
          : 'right';
      const sameSide = selection.side === 'both' || selection.side === selectedSide;
      tile.visible = sameSide && selection.kind !== 'heat' && selection.kind !== 'rest';
      pulse.visible = particles.visible = tile.visible && selected && moving;
      if (!tile.visible) continue;
      const amount = pressures[side][zone] / 100;
      const { width, depth } = definition;
      const halfHeight = definition.minHalfHeight + amount * definition.halfHeightRange,
        height = halfHeight * 2;
      const cx = definition.x;
      const base = definition.bottom;
      const map = (x, y, z) => mapPoint(spine, cx + x, base + y, definition.z + z, null, false);
      const positions = tile.geometry.attributes.position,
        normals = tile.geometry.attributes.normal,
        gap = SHOWROOM_LAYOUT.airFlowGap;
      if (entry.tileSpine !== spine || entry.tileHeight !== halfHeight) {
        for (let i = 0; i < positions.count; i++) {
          const p = map(
            rest.getX(i) + normals.getX(i) * gap,
            halfHeight + (rest.getY(i) * halfHeight) / 0.06 + normals.getY(i) * gap,
            rest.getZ(i) + normals.getZ(i) * gap,
          );
          positions.setXYZ(i, p.x, p.y, p.z);
        }
        positions.needsUpdate = true;
        tile.geometry.computeBoundingSphere();
        entry.tileSpine = spine;
        entry.tileHeight = halfHeight;
      }
      const uniforms = tile.material.uniforms;
      uniforms.focus.value = selected ? 1 : sameSide ? 0.11 : 0;
      uniforms.amount.value = amount;
      uniforms.time.value = time;
      uniforms.moving.value = selected && moving ? 1 : 0;
      const phase = (time * 0.7) % 1;
      if (!pulse.visible) continue;
      pulse.material.opacity = 0.5 + 0.35 * Math.sin(phase * Math.PI) ** 2;
      // Pulse brightness animates independently from its stationary outline.
      if (entry.pulseSpine !== spine || entry.pulseHeight !== halfHeight) {
        for (let i = 0; i < 65; i++) {
          const a = (i / 64) * Math.PI * 2;
          const p = map(
            Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.38) * width * 0.48,
            height + 0.006,
            Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.38) * depth * 0.48,
          );
          pulse.geometry.attributes.position.setXYZ(i, p.x, p.y, p.z);
        }
        pulse.geometry.attributes.position.needsUpdate = true;
        pulse.geometry.computeBoundingSphere();
        entry.pulseSpine = spine;
        entry.pulseHeight = halfHeight;
      }
      for (let i = 0; i < 40; i++) {
        const p = map(
          ((i % 4) / 3 - 0.5) * width * 0.72,
          height + 0.008,
          (((time * 0.48 + Math.floor(i / 4) / 10) % 1) - 0.5) * depth * 0.8,
        );
        particles.geometry.attributes.position.setXYZ(i, p.x, p.y, p.z);
      }
      particles.geometry.attributes.position.needsUpdate = true;
      particles.geometry.computeBoundingSphere();
    }
  }
}

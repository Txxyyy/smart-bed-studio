import { massagePulse, massageSurfaceLift } from './massage.js';
import * as THREE from 'three';
import { SHOWROOM_LAYOUT } from './dimensions.js';
import { mapPoint } from './kinematics.js';
import { DEFAULT_HEAT_PATCHES, DEFAULT_AIR_BAGS } from './air-layout.js';

const NO_MASSAGE_CHANNELS = [];

const vertexShader = `
  varying vec2 vUv;
  void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;
const fragmentShader = `
  uniform float amount;
  uniform float time;
  uniform float moving;
  varying vec2 vUv;
  void main(){
    vec2 p=(vUv-.5)*2.0;
    float box=max(abs(p.x),abs(p.y));
    float edge=(1.0-smoothstep(.94,.98,box))*smoothstep(.89,.94,box);
    float field=exp(-dot(p*vec2(.9,1.05),p*vec2(.9,1.05))*1.35);
    float thermal=sin(length(p)*20.0-time*2.0*moving)*.5+.5;
    float filament=pow(.5+.5*cos((vUv.x*8.0+sin(vUv.y*6.283)*.13)*6.283),20.0);
    float fade=1.0-smoothstep(.75,.98,box);
    float energy=field*(.48+thermal*.12)+filament*.44*fade;
    vec3 amber=mix(vec3(1.0,.16,.015),vec3(1.0,.67,.20),field*.65+filament*.30);
    gl_FragColor=vec4(amber,(edge*.10+energy)*amount);
  }
`;

export class HeatingEffect {
  constructor(
    patches = DEFAULT_HEAT_PATCHES,
    airbags = DEFAULT_AIR_BAGS,
    surfaceTop = SHOWROOM_LAYOUT.surfaceTop,
  ) {
    this.surfaceTop = surfaceTop;
    this.airLayout = airbags;
    this.surfaceVersion = 0;
    this.surfaceState = null;
    this.root = new THREE.Group();
    this.root.name = 'Comfort_Layer_Heating';
    this.root.visible = false;
    this.entries = [];
    for (const definition of patches) {
      const { side, region, width, depth } = definition;
      const geometry = new THREE.PlaneGeometry(width, depth, 12, 16);
      geometry.rotateX(-Math.PI / 2);
      const rest = geometry.attributes.position.clone();
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { amount: { value: 0 }, time: { value: 0 }, moving: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `Heat_${side}_${definition.id}`;
      mesh.renderOrder = 6;
      const waves = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 72 }, () => new THREE.Vector3()),
        ),
        new THREE.LineBasicMaterial({
          color: 0xffbc63,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      waves.renderOrder = 7;
      this.root.add(mesh, waves);
      this.entries.push({ definition, side, region, mesh, waves, rest, surfaceVersion: -1 });
    }
  }

  updateSurfaceVersion(spine, channels, massage) {
    const previous = this.surfaceState;
    const weights = channels.flatMap((channel) =>
      channel.pads.map((pad, row) => {
        const lane = massage?.[channel.id];
        return lane?.amount
          ? lane.amount * lane.intensity * massagePulse(lane.phase, row, channel.pads.length)
          : 0;
      }),
    );
    let changed =
      !previous ||
      previous.channels !== channels ||
      previous.surfaceTop !== this.surfaceTop ||
      previous.min !== spine.min ||
      previous.step !== spine.step ||
      previous.count !== spine.count ||
      previous.spineValues.length !== spine.samples.length * 3 ||
      previous.weights.length !== weights.length;
    if (!changed) {
      for (let i = 0; i < spine.samples.length; i++) {
        const p = spine.samples[i],
          values = previous.spineValues;
        if (values[i * 3] !== p.y || values[i * 3 + 1] !== p.z || values[i * 3 + 2] !== p.angle) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) changed = weights.some((weight, i) => weight !== previous.weights[i]);
    if (changed) {
      this.surfaceState = {
        channels,
        surfaceTop: this.surfaceTop,
        min: spine.min,
        step: spine.step,
        count: spine.count,
        weights,
        spineValues: Float64Array.from(spine.samples.flatMap((p) => [p.y, p.z, p.angle])),
      };
      this.surfaceVersion++;
    }
    return this.surfaceVersion;
  }

  update({
    spine,
    heating,
    pressures,
    time,
    moving,
    massageChannels = NO_MASSAGE_CHANNELS,
    massage,
  }) {
    if (!this.root.visible) return;
    const y = this.surfaceTop + SHOWROOM_LAYOUT.heatGap;
    const map = (x, height, z) =>
      mapPoint(
        spine,
        x,
        height + massageSurfaceLift(massageChannels, massage, x, z),
        z,
        null,
        false,
        this.airLayout,
      );
    let surfaceVersion;
    for (const entry of this.entries) {
      const { definition, side, region, mesh, waves, rest } = entry;
      const amount = heating[side][region] / definition.maxLevel,
        cx = definition.x,
        cz = definition.z;
      mesh.material.uniforms.amount.value = amount;
      mesh.material.uniforms.time.value = time;
      mesh.material.uniforms.moving.value = moving ? 1 : 0;
      mesh.visible = amount > 0;
      waves.visible = amount > 0.015 && moving;
      waves.material.opacity = amount * 0.42;
      if (!mesh.visible) continue;
      surfaceVersion ??= this.updateSurfaceVersion(spine, massageChannels, massage);
      // Time animates shader energy, not the surface. Hidden patches catch up on reopening.
      if (entry.surfaceVersion !== surfaceVersion) {
        const positions = mesh.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          const p = map(cx + rest.getX(i), y, cz + rest.getZ(i));
          positions.setXYZ(i, p.x, p.y, p.z);
        }
        positions.needsUpdate = true;
        mesh.geometry.computeBoundingSphere();
        entry.surfaceVersion = surfaceVersion;
      }
      if (waves.visible) {
        const a = waves.geometry.attributes.position;
        for (let strand = 0; strand < 3; strand++)
          for (let segment = 0; segment < 12; segment++)
            for (let end = 0; end < 2; end++) {
              const t = (segment + end) / 12,
                phase = time * 1.5 + t * 7 + strand;
              const p = map(
                cx + (strand - 1) * 0.15 + Math.sin(phase) * 0.013,
                y + 0.01 + t * 0.1,
                cz + Math.cos(phase) * 0.013,
              );
              a.setXYZ(strand * 24 + segment * 2 + end, p.x, p.y, p.z);
            }
        a.needsUpdate = true;
        waves.geometry.computeBoundingSphere();
      }
    }
  }
}

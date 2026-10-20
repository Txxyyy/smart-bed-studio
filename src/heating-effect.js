import { massagePadWeight, massagePulse } from './massage.js';
import * as THREE from 'three';
import { SHOWROOM_LAYOUT, T12_MASSAGE_LAYOUT } from './dimensions.js';
import { mapPoint, sampleSpine } from './kinematics.js';
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

// 加热片顶点的 x/z 固定，姿态只改变曲线基点与朝向，按摩只改变高度。按姿态缓存每个顶点的
// 曲线基点与朝向，按按摩布局缓存每个顶点对各按摩块的权重（已乘隆起高度），逐帧只做乘加，
// 结果与 mapPoint(spine, x, y + massageSurfaceLift(...), z, null, false) 逐位一致。
function spineTerms(entry, spine) {
  if (entry.spine !== spine) {
    const { rest, definition } = entry;
    entry.spineTerms ??= new Float64Array(rest.count * 4);
    for (let i = 0; i < rest.count; i++) {
      const s = sampleSpine(spine, definition.z + rest.getZ(i));
      entry.spineTerms[i * 4] = s.y;
      entry.spineTerms[i * 4 + 1] = s.z;
      entry.spineTerms[i * 4 + 2] = Math.cos(s.angle);
      entry.spineTerms[i * 4 + 3] = Math.sin(s.angle);
    }
    entry.spine = spine;
  }
  return entry.spineTerms;
}

function massageTerms(entry, channels) {
  if (entry.massageChannels !== channels) {
    const { rest, definition } = entry,
      pads = channels.flatMap((channel) => channel.pads);
    entry.massageTerms = new Float64Array(rest.count * pads.length);
    for (let i = 0; i < rest.count; i++) {
      const x = definition.x + rest.getX(i),
        z = definition.z + rest.getZ(i);
      for (let k = 0; k < pads.length; k++)
        entry.massageTerms[i * pads.length + k] =
          massagePadWeight(pads[k], x, z) * T12_MASSAGE_LAYOUT.lift;
    }
    entry.massageChannels = channels;
  }
  return entry.massageTerms;
}

// 每个按摩块本帧的隆起系数；所在通道未运行时为 null，与 massageSurfaceLift 一样跳过。
function massageLanes(channels, massage) {
  return channels.flatMap((channel) => {
    const lane = massage?.[channel.id];
    return channel.pads.map((pad, row) =>
      lane?.amount
        ? {
            pad,
            amount: lane.amount,
            intensity: lane.intensity,
            pulse: massagePulse(lane.phase, row, channel.pads.length),
          }
        : null,
    );
  });
}

// 热纹点的 x/z 随时间变化，权重只能逐点计算；脉动相位与位置无关，按帧复用。
// 逐项相加且乘法顺序与 massageSurfaceLift 相同（权重为 0 的项也照常相乘），结果逐位一致。
function massageLift(lanes, x, z) {
  let height = 0;
  for (let k = 0; k < lanes.length; k++) {
    const lane = lanes[k];
    if (lane)
      height +=
        massagePadWeight(lane.pad, x, z) *
        T12_MASSAGE_LAYOUT.lift *
        lane.amount *
        lane.intensity *
        lane.pulse;
  }
  return height;
}

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
    let surfaceVersion, lanes;
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
        const positions = mesh.geometry.attributes.position,
          terms = spineTerms(entry, spine),
          weights = massageTerms(entry, massageChannels);
        lanes ??= massageLanes(massageChannels, massage);
        for (let i = 0; i < positions.count; i++) {
          let lift = 0;
          for (let k = 0; k < lanes.length; k++) {
            const lane = lanes[k];
            if (lane)
              lift += weights[i * lanes.length + k] * lane.amount * lane.intensity * lane.pulse;
          }
          const height = y + lift;
          positions.setXYZ(
            i,
            cx + rest.getX(i),
            terms[i * 4] + height * terms[i * 4 + 2],
            terms[i * 4 + 1] + height * terms[i * 4 + 3],
          );
        }
        positions.needsUpdate = true;
        mesh.geometry.computeBoundingSphere();
        entry.surfaceVersion = surfaceVersion;
      }
      if (waves.visible) {
        const a = waves.geometry.attributes.position;
        lanes ??= massageLanes(massageChannels, massage);
        for (let strand = 0; strand < 3; strand++)
          for (let segment = 0; segment < 12; segment++)
            for (let end = 0; end < 2; end++) {
              const t = (segment + end) / 12,
                phase = time * 1.5 + t * 7 + strand,
                x = cx + (strand - 1) * 0.15 + Math.sin(phase) * 0.013,
                z = cz + Math.cos(phase) * 0.013;
              const p = mapPoint(
                spine,
                x,
                y + 0.01 + t * 0.1 + massageLift(lanes, x, z),
                z,
                null,
                false,
                this.airLayout,
              );
              a.setXYZ(strand * 24 + segment * 2 + end, p.x, p.y, p.z);
            }
        a.needsUpdate = true;
        waves.geometry.computeBoundingSphere();
      }
    }
  }
}

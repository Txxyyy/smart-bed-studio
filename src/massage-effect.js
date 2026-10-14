import * as THREE from 'three';
import { mapPoint } from './kinematics.js';
import { T12_MASSAGE_LAYOUT as D } from './dimensions.js';
import { massagePulse } from './massage.js';
import { MassageSurfaceCache } from './massage-surface.js';

const vertexShader = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const fragmentShader = `
  varying vec2 vUv;
  uniform float amount,phase,pulse,surface;
  void main(){
    vec2 p=(vUv-.5)*2.;
    float box=max(abs(p.x),abs(p.y));
    float border=smoothstep(.88,.94,box)*(1.-smoothstep(.94,.99,box));
    float ripple=exp(-pow((length(p*vec2(1.,.75))-phase*1.3)*24.,2.))*(1.-phase);
    float trace=pow(.5+.5*cos(vUv.x*100.),16.)*pow(.5+.5*cos(vUv.y*45.),16.);
    float alpha=mix(.92+border*.06,border*.08+ripple*.8,surface);
    vec3 violet=mix(vec3(.045,.027,.095)+trace*.025,mix(vec3(.32,.15,.65),vec3(.8,.54,1.),pulse),surface);
    gl_FragColor=vec4(violet*(1.+pulse*.7),alpha*amount*(1.-smoothstep(.96,1.,box)));
  }
`;

function patch(pad, surface) {
  const geometry = new THREE.PlaneGeometry(
    pad.width + (surface ? 0 : 0.2),
    pad.depth + (surface ? 0 : 0.2),
    10,
    6,
  );
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      amount: { value: 0 },
      phase: { value: 0 },
      pulse: { value: 0 },
      surface: { value: surface ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: surface ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `Massage_${surface ? 'Ripple' : 'Base'}_${pad.id}`;
  mesh.renderOrder = surface ? 5 : 1;
  mesh.userData.rest = geometry.attributes.position.clone();
  return mesh;
}

function bellowsGeometry() {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 28, 12, false),
    p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const rib = 0.94 + 0.06 * Math.cos((p.getY(i) + 0.5) * Math.PI * 6);
    p.setXYZ(i, p.getX(i) * rib, p.getY(i), p.getZ(i) * rib);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export class MassageEffect {
  constructor(channels, airbags, surfaceTop) {
    this.channels = channels;
    this.airbags = airbags;
    this.surfaceTop = surfaceTop;
    this.baseY = surfaceTop - D.surfaceInset;
    this.root = new THREE.Group();
    this.root.name = 'T12_Massage_Layer';
    this.root.visible = false;
    this.entries = channels.map((channel) => {
      const count = channel.pads.reduce((n, p) => n + p.cells.length, 0);
      const body = new THREE.InstancedMesh(
        bellowsGeometry(),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0x3a1271,
          emissiveIntensity: 0.65,
          roughness: 0.48,
          metalness: 0.12,
          transparent: true,
          depthWrite: false,
        }),
        count,
      );
      body.name = `Massage_Bellows_${channel.id}`;
      body.renderOrder = 2;
      body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const ringGeometry = new THREE.TorusGeometry(1, 0.025, 4, 28);
      ringGeometry.rotateX(Math.PI / 2);
      const rings = new THREE.InstancedMesh(
        ringGeometry,
        new THREE.MeshBasicMaterial({
          color: 0xd9b7ff,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
        count,
      );
      rings.name = `Massage_Cap_Rings_${channel.id}`;
      rings.renderOrder = 3;
      rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const glows = channel.pads.flatMap((pad, row) =>
        pad.cells.map((cell) => {
          const geometry = new THREE.PlaneGeometry(
            cell.radius * D.glowDiameter,
            cell.radius * D.glowDiameter,
            12,
            12,
          );
          geometry.rotateX(-Math.PI / 2);
          const material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader: `varying vec2 vUv;uniform float amount,pulse;
          void main(){float r=length((vUv-.5)*2.);float halo=exp(-r*r*3.6);float ring=exp(-pow((r-.52-pulse*.12)*28.,2.));
          gl_FragColor=vec4(mix(vec3(.42,.16,1.),vec3(.85,.65,1.),pulse),amount*(halo*(.12+.32*pulse)+ring*(.15+.7*pulse))*(1.-smoothstep(.8,1.,r)));}`,
            uniforms: { amount: { value: 0 }, pulse: { value: 0 } },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.renderOrder = 5;
          mesh.userData.rest = geometry.attributes.position.clone();
          const x = pad.x + cell.x,
            z = pad.z + cell.z,
            rest = mesh.userData.rest;
          const surface = new MassageSurfaceCache(
            channels,
            Array.from({ length: rest.count }, (_, i) => ({
              x: x + rest.getX(i),
              z: z + rest.getZ(i),
            })),
          );
          return { mesh, x, z, row, surface };
        }),
      );
      const pads = channel.pads.map((definition) => {
        const ripple = patch(definition, true),
          rest = ripple.userData.rest;
        const surface = new MassageSurfaceCache(
          channels,
          Array.from({ length: rest.count }, (_, i) => ({
            x: definition.x + rest.getX(i),
            z: definition.z + rest.getZ(i),
          })),
        );
        return { definition, base: patch(definition, false), ripple, surface };
      });
      this.root.add(
        ...glows.map((g) => g.mesh),
        body,
        rings,
        ...pads.flatMap((p) => [p.base, p.ripple]),
      );
      return { channel, body, rings, pads, glows };
    });
  }
  update({ spine, pressures, lanes }) {
    if (!this.root.visible) return;
    for (const { channel, body, rings, pads, glows } of this.entries) {
      const lane = lanes[channel.id],
        amount = lane.amount,
        visible = amount > 0.001;
      body.visible = rings.visible = false;
      for (const { base, ripple } of pads) ((base.visible = false), (ripple.visible = visible));
      for (const glow of glows) {
        const { mesh, x, z, row } = glow;
        mesh.visible = visible;
        if (!visible) continue;
        mesh.material.uniforms.amount.value = amount;
        mesh.material.uniforms.pulse.value =
          massagePulse(lane.phase, row, pads.length) * lane.intensity;
        const rest = mesh.userData.rest,
          p = mesh.geometry.attributes.position,
          heights = glow.surface.update(lanes);
        for (let i = 0; i < p.count; i++) {
          const px = x + rest.getX(i),
            pz = z + rest.getZ(i),
            point = mapPoint(spine, px, this.surfaceTop + 0.003 + heights[i], pz, null, false);
          p.setXYZ(i, point.x, point.y, point.z);
        }
        p.needsUpdate = true;
        mesh.geometry.computeBoundingSphere();
      }
      if (!visible) continue;
      // The opaque-cover presentation only renders surface glows and ripples.
      // Keep its hidden internal meshes out of per-frame deformation and uploads.
      pads.forEach(({ definition, ripple, surface }, row) => {
        const lift = massagePulse(lane.phase, row, pads.length) * lane.intensity * amount;
        const rest = ripple.userData.rest,
          p = ripple.geometry.attributes.position,
          u = ripple.material.uniforms,
          heights = surface.update(lanes);
        u.amount.value = amount;
        u.pulse.value = lift;
        u.phase.value = ((((lane.phase - row / pads.length) * 2) % 1) + 1) % 1;
        for (let i = 0; i < p.count; i++) {
          const point = mapPoint(
            spine,
            definition.x + rest.getX(i),
            this.surfaceTop + 0.004 + heights[i],
            definition.z + rest.getZ(i),
            null,
            false,
            this.airbags,
          );
          p.setXYZ(i, point.x, point.y, point.z);
        }
        p.needsUpdate = true;
        ripple.geometry.computeBoundingSphere();
      });
    }
  }
}

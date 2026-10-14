import * as THREE from 'three';
import { DIMENSIONS, SHOWROOM_LAYOUT } from './dimensions.js';

// Keep the original cover geometry and textile maps. A local mask exposes only
// the scanned half; the other half remains fully opaque in the same draw call.
export class CoverReveal {
  constructor(cover) {
    cover.geometry.setAttribute(
      'showroomPosition',
      new THREE.Float32BufferAttribute(cover.userData.rest, 3),
    );
    this.uniforms = {
      revealProgressSides: { value: new THREE.Vector2() },
      revealOpenSides: { value: new THREE.Vector2() },
      revealScanSides: { value: new THREE.Vector2() },
      revealOpacity: { value: SHOWROOM_LAYOUT.coverOpacity },
      revealSides: { value: new THREE.Vector2() },
      revealProgress: { value: 0 },
      revealOpen: { value: 0 },
      revealScan: { value: 0 },
    };
    this.copies = new Map();
    this.sourceVersions = new WeakMap();
  }

  material(source) {
    if (!this.copies.has(source)) {
      const copy = source.clone();
      copy.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.uniforms);
        shader.vertexShader =
          'attribute vec3 showroomPosition;\nvarying vec3 vShowroom;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvShowroom=showroomPosition;',
        );
        shader.fragmentShader =
          `uniform vec2 revealProgressSides, revealOpenSides, revealScanSides;
          uniform float revealOpacity;
          varying vec3 vShowroom;\n` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          `
          float sideIndex=vShowroom.x<0.0?0.0:1.0;
          float selectedHalf=smoothstep(0.0,.025,abs(vShowroom.x));
          float revealProgress=mix(revealProgressSides.x,revealProgressSides.y,sideIndex);
          float revealOpen=mix(revealOpenSides.x,revealOpenSides.y,sideIndex);
          float revealScan=mix(revealScanSides.x,revealScanSides.y,sideIndex);
          float front=mix(-${DIMENSIONS.length / 2 + 0.03},${DIMENSIONS.length / 2 + 0.03},revealProgress);
          float revealed=(1.0-smoothstep(front-.022,front+.022,vShowroom.z))*selectedHalf*revealOpen;
          float line=exp(-pow((vShowroom.z-front)*90.0,2.0))*selectedHalf*revealScan;
          float wake=exp(-pow((vShowroom.z-front+.045)*22.0,2.0))*selectedHalf*revealScan;
          float ticks=pow(.5+.5*cos(vShowroom.x*180.0),12.0);
          diffuseColor.a*=mix(1.0,revealOpacity,revealed);
          outgoingLight+=vec3(.12,1.25,1.55)*(line*2.5+wake*(.16+ticks*.36));
          #include <opaque_fragment>
        `,
        );
      };
      copy.customProgramCacheKey = () => 'noctis-local-cover-reveal-v4-support-only';
      this.copies.set(source, copy);
    }
    const copy = this.copies.get(source);
    copy.copy(source);
    copy.transparent = true;
    copy.opacity = 1;
    copy.depthWrite = true;
    if (this.sourceVersions.get(source) !== source.version) {
      copy.needsUpdate = true;
      this.sourceVersions.set(source, source.version);
    }
    return copy;
  }

  update(state) {
    const sideState = (side) =>
      state?.sides?.[side] ?? (state?.side === side || state?.side === 'both' ? state : null) ?? {};
    // Index 0 is -X / human right; index 1 is +X / human left.
    for (const [index, side] of [
      [0, 'right'],
      [1, 'left'],
    ]) {
      const item = sideState(side),
        open = ['scan', 'adjust', 'closing'].includes(item?.phase);
      this.uniforms.revealProgressSides.value.setComponent(index, item?.progress || 0);
      this.uniforms.revealOpenSides.value.setComponent(index, +open);
      this.uniforms.revealScanSides.value.setComponent(
        index,
        +(item?.phase === 'scan' || item?.phase === 'closing'),
      );
    }
    // Compatibility state for V.18 hosts. The shader uses the independent
    // vectors above; callers should use the per-side representation.
    const open = ['scan', 'adjust', 'closing'].includes(state?.phase);
    this.uniforms.revealSides.value.set(
      +(state?.side === 'left' || state?.side === 'both'),
      +(state?.side === 'right' || state?.side === 'both'),
    );
    this.uniforms.revealProgress.value = state?.progress || 0;
    this.uniforms.revealOpen.value = +open;
    this.uniforms.revealScan.value = +(state?.phase === 'scan' || state?.phase === 'closing');
  }
}

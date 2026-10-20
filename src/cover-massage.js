import * as THREE from 'three';

// 按摩只抬起床面上几块固定区域。预先记录受按摩影响的顶点、因相邻三角形移动而需要重算法线的顶点，
// 以及这些顶点的全部相邻三角形。姿态不变时逐帧只重算这一小块：法线按 three.js
// computeVertexNormals 的三角形顺序与 Float32 累加方式计算，包围盒/包围球按原定义全量求值，
// 结果与整网格重算逐位一致。
export class CoverMassageRegion {
  constructor(geometry, weights, padCount) {
    const index = geometry.index.array,
      count = geometry.attributes.position.count;
    const moved = [],
      offsets = [0],
      pads = [],
      values = [];
    for (let i = 0; i < count; i++) {
      const first = pads.length;
      for (let k = 0; k < padCount; k++) {
        const weight = weights[i * padCount + k];
        if (weight !== 0) {
          pads.push(k);
          values.push(weight);
        }
      }
      if (pads.length > first) {
        moved.push(i);
        offsets.push(pads.length);
      }
    }
    this.moved = Uint32Array.from(moved);
    this.offsets = Uint32Array.from(offsets);
    this.pads = Uint16Array.from(pads);
    // 与 massageWeights 相同的 Float32 权重，逐项乘加顺序也与整网格变形一致。
    this.weights = Float32Array.from(values);
    this.movedMask = new Uint8Array(count);
    for (const i of moved) this.movedMask[i] = 1;

    const normalMask = new Uint8Array(count);
    for (let f = 0; f < index.length; f += 3)
      if (this.movedMask[index[f]] || this.movedMask[index[f + 1]] || this.movedMask[index[f + 2]])
        normalMask[index[f]] = normalMask[index[f + 1]] = normalMask[index[f + 2]] = 1;
    const faces = [],
      incident = new Map();
    for (let f = 0; f < index.length; f += 3) {
      const ids = new Set([index[f], index[f + 1], index[f + 2]]);
      if (![...ids].some((id) => normalMask[id])) continue;
      // 同一三角形内重复的顶点在 three.js 中只累加一次，这里同样去重。
      for (const id of ids)
        if (normalMask[id]) {
          if (!incident.has(id)) incident.set(id, []);
          incident.get(id).push(faces.length);
        }
      faces.push(f);
    }
    this.faces = Uint32Array.from(faces);
    this.faceNormals = new Float64Array(faces.length * 3);
    this.normalVertices = Uint32Array.from([...incident.keys()].sort((a, b) => a - b));
    this.normalOffsets = new Uint32Array(this.normalVertices.length + 1);
    const slots = [];
    this.normalVertices.forEach((id, k) => {
      slots.push(...incident.get(id));
      this.normalOffsets[k + 1] = slots.length;
    });
    this.normalSlots = Uint32Array.from(slots);
  }

  writeNormals(geometry) {
    const p = geometry.attributes.position.array,
      n = geometry.attributes.normal.array,
      index = geometry.index.array,
      { faces, faceNormals: fn, normalVertices, normalOffsets, normalSlots } = this;
    for (let s = 0; s < faces.length; s++) {
      const f = faces[s],
        a = index[f] * 3,
        b = index[f + 1] * 3,
        c = index[f + 2] * 3;
      const cbx = p[c] - p[b],
        cby = p[c + 1] - p[b + 1],
        cbz = p[c + 2] - p[b + 2],
        abx = p[a] - p[b],
        aby = p[a + 1] - p[b + 1],
        abz = p[a + 2] - p[b + 2];
      fn[s * 3] = cby * abz - cbz * aby;
      fn[s * 3 + 1] = cbz * abx - cbx * abz;
      fn[s * 3 + 2] = cbx * aby - cby * abx;
    }
    for (let k = 0; k < normalVertices.length; k++) {
      // three.js 每加一个三角形就写回 Float32 法线属性，这里逐步取 Float32 精度保持一致。
      let x = 0,
        y = 0,
        z = 0;
      for (let e = normalOffsets[k]; e < normalOffsets[k + 1]; e++) {
        const s = normalSlots[e] * 3;
        x = Math.fround(x + fn[s]);
        y = Math.fround(y + fn[s + 1]);
        z = Math.fround(z + fn[s + 2]);
      }
      const scale = 1 / (Math.sqrt(x * x + y * y + z * z) || 1),
        v = normalVertices[k] * 3;
      n[v] = x * scale;
      n[v + 1] = y * scale;
      n[v + 2] = z * scale;
    }
    geometry.attributes.normal.needsUpdate = true;
  }

  writeBounds(geometry) {
    const p = geometry.attributes.position.array;
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      minX = Math.min(minX, p[i]);
      minY = Math.min(minY, p[i + 1]);
      minZ = Math.min(minZ, p[i + 2]);
      maxX = Math.max(maxX, p[i]);
      maxY = Math.max(maxY, p[i + 1]);
      maxZ = Math.max(maxZ, p[i + 2]);
    }
    geometry.boundingBox ??= new THREE.Box3();
    geometry.boundingBox.min.set(minX, minY, minZ);
    geometry.boundingBox.max.set(maxX, maxY, maxZ);
    geometry.boundingSphere ??= new THREE.Sphere();
    const center = geometry.boundingSphere.center.set(
      (minX + maxX) * 0.5,
      (minY + maxY) * 0.5,
      (minZ + maxZ) * 0.5,
    );
    let radiusSq = 0;
    for (let i = 0; i < p.length; i += 3) {
      const dx = center.x - p[i],
        dy = center.y - p[i + 1],
        dz = center.z - p[i + 2];
      radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
    }
    geometry.boundingSphere.radius = Math.sqrt(radiusSq);
  }
}

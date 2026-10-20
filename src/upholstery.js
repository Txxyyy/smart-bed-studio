import * as THREE from 'three';

// Bind the tape to actual cover triangles, so pressure and bending cannot separate them.
export function createBoundWelt(cover, material, upper = true, options = {}) {
  return createSurfaceSeam(cover, material, upper, options);
}

const a = new THREE.Vector3(),
  b = new THREE.Vector3(),
  c = new THREE.Vector3(),
  n = new THREE.Vector3(),
  point = new THREE.Vector3();
export function updateBoundWelt(welt) {
  const { cover, bindings, smooth } = welt.surfaceBinding,
    p = cover.geometry.attributes.position,
    out = welt.geometry.attributes.position;
  const normals = smooth ? attachmentNormals(cover) : null;
  for (let i = 0; i < bindings.length; i++) {
    const { ids, weights, lift } = bindings[i];
    a.fromBufferAttribute(p, ids[0]);
    b.fromBufferAttribute(p, ids[1]);
    c.fromBufferAttribute(p, ids[2]);
    point
      .copy(a)
      .multiplyScalar(weights[0])
      .addScaledVector(b, weights[1])
      .addScaledVector(c, weights[2]);
    if (normals) {
      n.set(0, 0, 0);
      for (let k = 0; k < 3; k++) n.addScaledVector(a.fromArray(normals, ids[k] * 3), weights[k]);
      n.normalize();
    } else n.subVectors(b, a).cross(c.sub(a)).normalize();
    point.addScaledVector(n, lift);
    out.setXYZ(i, point.x, point.y, point.z);
  }
  out.needsUpdate = true;
  welt.geometry.computeVertexNormals();
  welt.geometry.computeBoundingSphere();
  if (welt.geometry.boundingBox) welt.geometry.computeBoundingBox();
}

// Clip a narrow seam out of each cover triangle. The resulting cells follow the
// exact same faces as the cover, including corners and articulated hinge regions.
function createSurfaceSeam(
  cover,
  material,
  upper,
  { waistband = false, offsetFromTop, halfWidth, name, rounded = false, physicalUV = false } = {},
) {
  const g = cover.geometry,
    p = g.attributes.position,
    index = g.index,
    heights = cover.surfaceHeight;
  const lo = Math.min(...heights),
    hi = Math.max(...heights),
    center =
      offsetFromTop !== undefined
        ? hi - offsetFromTop
        : waistband
          ? (lo + hi) / 2
          : upper
            ? hi - 0.006
            : lo + 0.006,
    half = halfWidth ?? (waistband ? 0.013 : 0.002);
  const positions = [],
    uvs = [],
    indices = [],
    bindings = [],
    vertices = new Map(),
    q = new THREE.Vector3();
  function clip(polygon, bound, keepAbove) {
    const result = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length],
        inside = keepAbove ? a.h >= bound : a.h <= bound,
        nextInside = keepAbove ? b.h >= bound : b.h <= bound;
      if (inside) result.push(a);
      if (inside !== nextInside) {
        const t = (bound - a.h) / (b.h - a.h);
        result.push({ h: bound, w: a.w.map((v, k) => v + (b.w[k] - v) * t) });
      }
    }
    return result;
  }
  // Multiple clipped cross-section slices provide a rounded cord without separating
  // any attachment from the deforming source surface.
  const slices = rounded ? 8 : 1;
  for (let slice = 0; slice < slices; slice++)
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)],
        h = ids.map((n) => heights[n]);
      if (Math.max(...h) < center - half || Math.min(...h) > center + half) continue;
      let polygon = h.map((v, k) => ({ h: v, w: [+(k === 0), +(k === 1), +(k === 2)] }));
      polygon = clip(
        clip(polygon, center - half + (2 * half * slice) / slices, true),
        center - half + (2 * half * (slice + 1)) / slices,
        false,
      );
      if (polygon.length < 3) continue;
      const face = polygon.map((v) => {
        q.set(0, 0, 0);
        ids.forEach((id, k) =>
          q.addScaledVector(new THREE.Vector3().fromBufferAttribute(p, id), v.w[k]),
        );
        const key = q
          .toArray()
          .map((x) => Math.round(x * 1e7))
          .join(',');
        let id = vertices.get(key);
        if (id === undefined) {
          id = bindings.length;
          vertices.set(key, id);
          positions.push(q.x, q.y, q.z);
          const across = (v.h - center + half) / (2 * half),
            lift = rounded
              ? waistband
                ? 0.001 + 0.0018 * Math.sin(across * Math.PI)
                : 0.0004 + half * Math.sin(across * Math.PI)
              : waistband
                ? 0.001 + 0.0004 * Math.sin(across * Math.PI)
                : 0.00065 + 0.00025 * Math.sin(across * Math.PI);
          bindings.push({ ids, weights: v.w, lift });
          uvs.push((Math.atan2(q.z, q.x) + Math.PI) / (Math.PI * 2), across);
        }
        return id;
      });
      for (let k = 1; k < face.length - 1; k++)
        if (new Set([face[0], face[k], face[k + 1]]).size === 3)
          indices.push(face[0], face[k], face[k + 1]);
    }
  if (physicalUV) {
    const ring = [];
    for (let id = 0; id < bindings.length; id++)
      if (Math.abs(uvs[id * 2 + 1] - 0.5) < 1e-5)
        ring.push({ angle: uvs[id * 2], x: positions[id * 3], z: positions[id * 3 + 2] });
    ring.sort((a, b) => a.angle - b.angle);
    let total = 0;
    ring.forEach((v, i) => {
      if (i) total += Math.hypot(v.x - ring[i - 1].x, v.z - ring[i - 1].z);
      v.distance = total;
    });
    if (ring.length > 1) {
      total += Math.hypot(ring[0].x - ring.at(-1).x, ring[0].z - ring.at(-1).z);
      const extended = [
        { ...ring.at(-1), angle: ring.at(-1).angle - 1, distance: ring.at(-1).distance - total },
        ...ring,
        { ...ring[0], angle: ring[0].angle + 1, distance: total },
      ];
      for (let i = 0; i < bindings.length; i++) {
        const angle = uvs[i * 2];
        let k = 1;
        while (k < extended.length - 1 && extended[k].angle < angle) k++;
        const a = extended[k - 1],
          b = extended[k],
          t = (angle - a.angle) / (b.angle - a.angle || 1);
        uvs[i * 2] = (a.distance + (b.distance - a.distance) * t) / total;
      }
    }
  }
  // Duplicate only UV seam vertices so future textile maps do not stretch across the wrap.
  const wrapped = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const ids = indices.slice(i, i + 3),
      us = ids.map((id) => uvs[id * 2]);
    if (Math.max(...us) - Math.min(...us) < 0.5) continue;
    for (let k = 0; k < 3; k++)
      if (us[k] < 0.5) {
        const id = ids[k];
        if (!wrapped.has(id)) {
          wrapped.set(id, bindings.length);
          bindings.push(bindings[id]);
          positions.push(...positions.slice(id * 3, id * 3 + 3));
          uvs.push(uvs[id * 2] + 1, uvs[id * 2 + 1]);
        }
        indices[i + k] = wrapped.get(id);
      }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const seam = new THREE.Mesh(geometry, material);
  seam.name = name ?? (waistband ? 'Woven_Waistband' : upper ? 'Upper_Piping' : 'Lower_Piping');
  seam.receiveShadow = true;
  seam.castShadow = false;
  seam.surfaceBinding = { cover, bindings, smooth: true };
  updateBoundWelt(seam);
  return seam;
}

function attachmentCache(cover) {
  const p = cover.geometry.attributes.position;
  let cache = cover.attachmentNormalCache;
  if (!cache) {
    const groups = [],
      keys = new Map(),
      ids = new Uint32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      const key = [p.getX(i), p.getY(i), p.getZ(i)].map((x) => Math.round(x * 1e6)).join(',');
      if (!keys.has(key)) {
        keys.set(key, groups.length);
        groups.push([]);
      }
      ids[i] = keys.get(key);
      groups[ids[i]].push(i);
    }
    // 分组成员按原顺序展平，逐组求和与归一化在类型数组上进行。
    const starts = new Uint32Array(groups.length + 1);
    groups.forEach((group, g) => (starts[g + 1] = starts[g] + group.length));
    cache = cover.attachmentNormalCache = {
      groups,
      ids,
      starts,
      members: Uint32Array.from(groups.flat()),
      values: new Float32Array(p.count * 3),
      version: -1,
    };
  }
  return cache;
}

// 与 Vector3 add/normalize 相同的运算顺序：同位置顶点法线依次相加后乘以 1/长度。
function writeGroupNormals(normal, cache, groups) {
  const n = normal.array,
    { starts, members, values } = cache;
  for (let k = 0; k < groups.length; k++) {
    const g = groups[k];
    let x = 0,
      y = 0,
      z = 0;
    for (let e = starts[g]; e < starts[g + 1]; e++) {
      const i = members[e] * 3;
      x += n[i];
      y += n[i + 1];
      z += n[i + 2];
    }
    const scale = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    for (let e = starts[g]; e < starts[g + 1]; e++) {
      const i = members[e] * 3;
      values[i] = x * scale;
      values[i + 1] = y * scale;
      values[i + 2] = z * scale;
    }
  }
}

function attachmentNormals(cover) {
  const p = cover.geometry.attributes.position,
    cache = attachmentCache(cover);
  if (cache.version !== p.version) {
    cache.all ??= Uint32Array.from(cache.groups.keys());
    writeGroupNormals(cover.geometry.attributes.normal, cache, cache.all);
    cache.version = p.version;
  }
  return cache.values;
}

// 与 vertices 共用位置的全部顶点：它们的平滑贴合法线会随 vertices 的法线变化。
export function attachmentNeighbours(cover, vertices) {
  const { groups, ids } = attachmentCache(cover),
    mask = new Uint8Array(ids.length);
  for (const v of vertices) for (const i of groups[ids[v]]) mask[i] = 1;
  return mask;
}

// 床罩只有 vertices 的法线改变时，只刷新它们所在的同位置分组。缓存若不是 previousVersion
// （之前已过期），保持过期，留给下次整体重算。
export function refreshAttachmentNormals(cover, vertices, previousVersion) {
  const cache = cover.attachmentNormalCache;
  if (cache?.version !== previousVersion) return;
  if (cache.partial?.vertices !== vertices)
    cache.partial = {
      vertices,
      groups: Uint32Array.from(new Set(vertices.map((v) => cache.ids[v]))),
    };
  writeGroupNormals(cover.geometry.attributes.normal, cache, cache.partial.groups);
  cache.version = cover.geometry.attributes.position.version;
}

// Distance along the rounded rectangle, with the wrap located at the head end.
export function perimeterDistance(x, z, width, length, radius) {
  const a = width / 2 - radius,
    b = length / 2 - radius,
    q = (radius * Math.PI) / 2;
  if (x >= a && z <= -b) return radius * (Math.atan2(z + b, x - a) + Math.PI / 2);
  if (x >= a && z >= b) return q + 2 * b + radius * Math.atan2(z - b, x - a);
  if (x <= -a && z >= b)
    return 2 * q + 2 * b + 2 * a + radius * (Math.atan2(z - b, x + a) - Math.PI / 2);
  if (x <= -a && z <= -b) {
    const angle = Math.atan2(z + b, x + a);
    return 3 * q + 4 * b + 2 * a + radius * ((angle < 0 ? angle + 2 * Math.PI : angle) - Math.PI);
  }
  if (x >= a) return q + z + b;
  if (z >= b) return 2 * q + 2 * b + a - x;
  if (x <= -a) return 3 * q + 2 * b + 2 * a + b - z;
  return 4 * q + 4 * b + 2 * a + x + a;
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { roundAirRow } from './air-shape.js';
import { mapPoint, sampleSpine } from './kinematics.js';
import { DIMENSIONS, FOUNDATION_FOAM, T12_AIR_FX as FX } from './dimensions.js';
import { humanSide } from './air-layout.js';
import { circuitTubePaths } from './t12-circuits.js';

// T12 圆囊阵列与 T11+ 条囊的调节光效：每一路气囊有“休眠 / 充气 / 放气 / 保压 / 故障”五种外观，
// 让用户一眼分清哪几排在调节、往哪个方向调。几何仍随床体折弯在 CPU 上贴合，
// 时间相关的流光、光点和刻度全部在着色器里完成，只改时间时不重写几何。
// 条囊保持原圆角矩形外形，顶面刻度改为从床中线一端向外的进度条，目标环与光点沿矩形轮廓排布。

// ShaderMaterial 直接写入帧缓冲、不做色彩空间转换，所以颜色按显示值（线性存储）保存。
const display = (hex) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);
export const AIR_FX_COLORS = Object.freeze({
  inflate: 0x16c8ff,
  deflate: 0xff8a1e,
  hold: 0x7fe2ff,
  fault: 0xff3048,
  idle: 0x6b8ca3,
  flash: 0x9cf1ff,
  grid: 0x2f7f99,
});
const COLORS = Object.fromEntries(
  Object.entries(AIR_FX_COLORS).map(([key, hex]) => [key, display(hex)]),
);
const TAU = Math.PI * 2;
// 单侧 7 囊一排，朝床中线的一端最靠近气路主干。
const CELLS = 7;

const additive = (uniforms, vertexShader, fragmentShader, extra = {}) =>
  new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    ...extra,
  });

const shellVertex = `
  attribute vec4 cellCoord;
  attribute float cellIndex;
  uniform float tilt;
  uniform float innerFirst;
  varying vec4 vCoord;
  varying float vOrder;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vCoord = cellCoord;
    vOrder = mix(6.0 - cellIndex, cellIndex, innerFirst) / 6.0;
    // 静止法线按该排所在床板角度旋转，省去每帧重算法线。
    float c = cos(tilt), s = sin(tilt);
    vec3 n = vec3(normal.x, normal.y * c - normal.z * s, normal.y * s + normal.z * c);
    vNormal = normalize(normalMatrix * n);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
const shellFragment = `
  uniform vec3 tint;
  uniform vec3 idleTint;
  uniform vec3 flashTint;
  uniform float energy;
  uniform float direction;
  uniform float flow;
  uniform float time;
  uniform float level;
  uniform float goal;
  uniform float focus;
  uniform float flash;
  uniform float rect;
  uniform vec2 halfSize;
  uniform float corner;
  uniform float innerFirst;
  varying vec4 vCoord;
  varying float vOrder;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec2 q = vCoord.xy;
    float r = length(q), h = vCoord.z;
    // 圆囊：刻度环从床头方向顺时针点亮。条囊：r 为到顶面圆角矩形边的归一化距离，
    // 刻度改为从床中线一端向外的进度条。
    float angle = fract(atan(q.x, -q.y) / 6.2832 + 1.0);
    if (rect > .5) {
      vec2 d = abs(q * halfSize) - (halfSize - corner);
      r = 1.0 + (length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - corner) / min(halfSize.x, halfSize.y);
      angle = clamp(mix(.5 - .5 * q.x, .5 + .5 * q.x, innerFirst), 0.0, 1.0);
    }
    float top = step(.5, vCoord.w), wall = 1.0 - top - step(.5, -vCoord.w);
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float fres = pow(1.0 - facing, 2.2);
    float aa = fwidth(r) + .004;
    float capEdge = top * smoothstep(.87 - aa, .95, r);
    // 休眠：只留顶面一圈冷灰描边和极弱的轮廓。
    float idle = capEdge * .5 + wall * fres * .14 + top * .02;
    // 调节中：光带沿柱壁流动，并从靠近气路的一端依次传到外侧圆囊。
    float wave = flow - vOrder * .45;
    float bands = pow(.5 + .5 * cos(6.2832 * (h * 2.2 - wave)), 12.0) * wall;
    float moving = clamp(abs(direction), 0.0, 1.0);
    float breathe = .5 + .5 * sin(time * 2.6 - vOrder * 2.4);
    float body = wall * (.1 + .5 * fres) * (.65 + .35 * h) + wall * exp(-h * 7.0) * .26;
    float capGlow = top * (.07 + .2 * (1.0 - smoothstep(0.0, .58, r)));
    float rim = top * smoothstep(.86 - aa, .93, r) * .95 + wall * smoothstep(.9, 1.0, h) * .45;
    // 顶面压力刻度：点亮到当前值，目标值处有一个亮点。
    float band = top * smoothstep(.6 - aa, .64, r) * (1.0 - smoothstep(.76, .8 + aa, r));
    float gauge = band * (.1 + step(angle, level) * .72);
    float tick = goal < 0.0 ? 0.0 : band * (1.0 - smoothstep(.006, .02, abs(angle - goal))) * 1.3;
    float ripple = top * pow(.5 + .5 * cos(6.2832 * (r * 1.5 - flow * .8)), 10.0)
      * (1.0 - smoothstep(.46, .58, r)) * moving;
    float energized = body + capGlow + rim + gauge + tick + ripple * .5
      + bands * (.16 + .56 * moving) + (1.0 - moving) * breathe * .14 * (wall + top);
    float scanned = flash * (top * .7 + capEdge * 1.4 + wall * fres * .9);
    vec3 color = idleTint * idle * (1.0 - energy) + tint * energized * energy + flashTint * scanned;
    gl_FragColor = vec4(color * focus, 1.0);
  }
`;
const ringVertex = `
  attribute vec3 center;
  attribute float angle;
  uniform float scale;
  varying float vAngle;
  void main() {
    vAngle = angle;
    vec3 p = center + (position - center) * scale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const ringFragment = `
  uniform vec3 tint;
  uniform float strength;
  uniform float dashed;
  uniform float spin;
  uniform float dashes;
  varying float vAngle;
  void main() {
    float dash = step(.45, fract(vAngle * dashes - spin));
    float a = mix(1.0, dash, dashed) * strength;
    if (a < .01) discard;
    gl_FragColor = vec4(tint * a, 1.0);
  }
`;
const sparkVertex = `
  attribute vec3 rise;
  attribute vec2 seed;
  uniform float flow;
  uniform float strength;
  varying float vAlpha;
  void main() {
    float s = fract(seed.x + flow * .55);
    vec3 p = mix(position, rise, s);
    vAlpha = strength * smoothstep(0.0, .18, s) * (1.0 - smoothstep(.72, 1.0, s));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(seed.y / max(.1, -mv.z), 1.5, 8.0);
  }
`;
const sparkFragment = `
  uniform vec3 tint;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - .5);
    float glow = exp(-r * r * 18.0) * (1.0 - smoothstep(.3, .5, r)) * vAlpha;
    if (glow < .01) discard;
    gl_FragColor = vec4(tint * (1.2 + exp(-r * r * 90.0) * 1.8) * glow, 1.0);
  }
`;
const padVertex = `
  attribute vec3 padCoord;
  varying vec3 vPad;
  void main() {
    vPad = padCoord;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const padFragment = `
  uniform vec3 tint;
  uniform vec2 halfSize;
  uniform float pitch;
  uniform float radius;
  uniform float energy;
  uniform float direction;
  uniform float flow;
  uniform float focus;
  uniform float rect;
  uniform vec2 cellHalf;
  uniform float corner;
  varying vec3 vPad;
  void main() {
    vec2 p = vPad.xy * halfSize;
    float radius = .03;
    vec2 d = abs(p) - (halfSize - radius);
    float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
    float aa = fwidth(sd) + .0008;
    float edge = 1.0 - smoothstep(.0006, .0006 + aa * 1.5, abs(sd + .002));
    // 两端加亮成“[ ]”形括号，长边保持细弱。
    float bracket = step(halfSize.x - .06, abs(p.x));
    float inside = 1.0 - smoothstep(-.004, 0.0, sd);
    float fill = inside * (.1 + .16 * smoothstep(-.05, 0.0, sd));
    float moving = clamp(abs(direction), 0.0, 1.0);
    float sweep = inside * pow(.5 + .5 * cos(6.2832 * (vPad.z * 1.6 - flow * .6)), 8.0) * moving;
    // 每个圆囊（或整条条囊）底部的光晕，让远景也能看清是哪一排在调节。
    float cx = (floor(p.x / pitch + 3.5) - 3.0) * pitch;
    float ring = length(vec2(p.x - cx, p.y)) - radius;
    if (rect > .5) {
      vec2 c = abs(p) - (cellHalf - corner);
      ring = length(max(c, 0.0)) + min(max(c.x, c.y), 0.0) - corner;
    }
    float halo = exp(-pow(max(ring, 0.0) / .012, 1.4)) * step(-.004, ring) * inside;
    float a = fill + edge * (.25 + .75 * bracket) + sweep * .42 + halo * .55;
    gl_FragColor = vec4(tint * a * energy * focus, 1.0);
  }
`;
const gridVertex = `
  attribute vec2 rest;
  varying vec2 vRest;
  void main() {
    vRest = rest;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const gridFragment = `
  uniform vec3 tint;
  uniform float focus;
  uniform float pitch;
  uniform float front;
  uniform float scanning;
  uniform vec2 extent;
  varying vec2 vRest;
  void main() {
    vec2 g = vRest / pitch;
    vec2 w = fwidth(g);
    vec2 l = abs(fract(g - .5) - .5) / max(w, vec2(.0001));
    float line = 1.0 - min(min(l.x, l.y), 1.0);
    vec2 n = abs(fract(g - .5) - .5);
    float node = 1.0 - smoothstep(.04, .09, length(n));
    float fade = smoothstep(0.0, .05, abs(vRest.x) - .01) * (1.0 - smoothstep(extent.x - .05, extent.x, abs(vRest.x)))
      * (1.0 - smoothstep(extent.y - .05, extent.y, abs(vRest.y)));
    float sweep = exp(-pow((vRest.y - front) * 16.0, 2.0)) * scanning;
    float a = (line * .1 + node * .16 + (line + node) * sweep * .55) * fade;
    gl_FragColor = vec4(tint * a * focus, 1.0);
  }
`;
const traceVertex = `
  attribute float pathDistance;
  varying float vDistance;
  void main() {
    vDistance = pathDistance;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const traceFragment = `
  uniform vec3 tint;
  uniform float energy;
  uniform float flow;
  uniform float focus;
  varying float vDistance;
  void main() {
    float packets = pow(.5 + .5 * cos(6.2832 * (vDistance / .12 - flow * 2.0)), 10.0);
    gl_FragColor = vec4(tint * (.32 + packets * 1.2) * energy * focus, 1.0);
  }
`;

const ease = (dt, rate) => 1 - Math.exp(-dt * rate);

// 从设备状态与视觉运动整理光效输入：每一路的状态与方向（显式 inflating/deflating 优先，
// 其次是 air.moveTo 的方向，都没有时由光效按数值变化推断），以及 0–100 的目标展示值。
export function airEffectInputs(profile, air, motions, holds, desired) {
  const regionStates = {},
    targets = desired.map((row) => row.slice());
  for (const region of profile.regions) {
    const status = air[region.id]?.status ?? null,
      motion = motions.get(region.id);
    regionStates[region.id] = {
      status,
      direction:
        status === 'inflating'
          ? 1
          : status === 'deflating'
            ? -1
            : motion && motion.target !== motion.value
              ? Math.sign(motion.target - motion.value)
              : 0,
    };
  }
  for (const bag of profile.airbags) {
    const goal = holds.get(bag.regionId);
    if (goal === undefined) continue;
    const [min, max] = profile.regions.find((r) => r.id === bag.regionId).range;
    targets[bag.side][bag.zone] = ((goal - min) / (max - min)) * 100;
  }
  return { targets, regionStates };
}

// 每一路气路的展示状态。所有属于同一路的排共享它，保证同路同步。
export class AirRegionFx {
  constructor(regionId, bag) {
    this.regionId = regionId;
    this.bag = bag;
    this.active = 0;
    this.direction = 0;
    this.flow = 0;
    this.trend = 0;
    this.trendAt = -Infinity;
    this.lastLevel = null;
    this.level = 0;
    this.fault = false;
    this.tint = COLORS.hold.clone();
  }
  reset() {
    this.active = 0;
    this.direction = 0;
    this.trend = 0;
    this.trendAt = -Infinity;
    this.lastLevel = null;
  }
  step({ selected, fault, direction, level, time, dt, moving, animate }) {
    // 设备只上报数值时，从显示值的变化推断方向，并保持 0.8 秒以免闪烁。
    if (this.lastLevel !== null && dt > 0) {
      const velocity = (level - this.lastLevel) / dt;
      if (Math.abs(velocity) > 0.004) {
        this.trend = Math.sign(velocity);
        this.trendAt = time;
      }
    }
    this.lastLevel = level;
    this.level = level;
    this.fault = fault;
    const trend = time - this.trendAt < 0.8 ? this.trend : 0,
      wantActive = selected || fault ? 1 : 0,
      wantDirection = selected && !fault ? direction || trend : 0,
      k = animate ? ease(dt, 7) : 1;
    this.active += (wantActive - this.active) * k;
    this.direction += (wantDirection - this.direction) * (animate ? ease(dt, 5) : 1);
    if (Math.abs(this.active - wantActive) < 0.002) this.active = wantActive;
    if (Math.abs(this.direction - wantDirection) < 0.002) this.direction = wantDirection;
    if (moving) this.flow = (this.flow + dt * 0.9 * this.direction) % 1000;
    const d = Math.min(1, Math.abs(this.direction));
    // 故障保持静态红色、不显示流向，静止时仍可停绘。
    if (fault) this.tint.copy(COLORS.fault);
    else
      this.tint
        .copy(COLORS.hold)
        .lerp(this.direction >= 0 ? COLORS.inflate : COLORS.deflate, d)
        // 换向途中先压暗再换色，避免青色与琥珀色线性混合出白色。
        .multiplyScalar(1 - 1.6 * d * (1 - d));
    return animate && (this.active !== wantActive || this.direction !== wantDirection);
  }
}

// 条囊与实体同样使用 RoundedBoxGeometry，圆角与 model.js 的条囊一致。
export const stripCorner = (width, depth) => Math.min(0.047, width * 0.2, depth * 0.2);

// 圆角矩形轮廓上按弧长均匀取点，t 为 0–1，从床头一侧长边开始绕一周；返回 [x, z]。
export function roundedRectPoint(hx, hz, r, t) {
  const sx = hx - r,
    sz = hz - r,
    arc = (Math.PI / 2) * r,
    parts = [2 * sx, arc, 2 * sz, arc, 2 * sx, arc, 2 * sz, arc];
  let s = (t - Math.floor(t)) * parts.reduce((a, b) => a + b, 0);
  for (let k = 0; k < 8; k++) {
    if (s <= parts[k] || k === 7) {
      const f = parts[k] ? Math.min(1, s / parts[k]) : 0,
        q = k >> 1;
      if (k % 2 === 0)
        return [
          [-sx + 2 * sx * f, -hz],
          [hx, -sz + 2 * sz * f],
          [sx - 2 * sx * f, hz],
          [-hx, sz - 2 * sz * f],
        ][q];
      const a = ((q - 1 + f) * Math.PI) / 2,
        [cx, cz] = [
          [sx, -sz],
          [sx, sz],
          [-sx, sz],
          [-sx, -sz],
        ][q];
      return [cx + r * Math.cos(a), cz + r * Math.sin(a)];
    }
    s -= parts[k];
  }
}

// 条囊外壳：与实体相同的圆角矩形，附带与圆囊相同格式的 cellCoord / cellIndex。
// cellCoord.xy 按顶面平坦区归一化（侧面圆角超出 ±1），cellIndex 沿 +X 连续取 0…6，
// 让流光仍从靠近气路的一端传到外侧。
function stripShell(width, depth) {
  const corner = stripCorner(width, depth),
    geometry = new RoundedBoxGeometry(width, 0.12, depth, 2, corner),
    p = geometry.attributes.position,
    n = geometry.attributes.normal,
    capX = width / 2 - corner,
    capZ = depth / 2 - corner,
    coord = new Float32Array(p.count * 4),
    index = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const ny = n.getY(i);
    coord.set(
      [
        p.getX(i) / capX,
        p.getZ(i) / capZ,
        p.getY(i) / 0.12 + 0.5,
        Math.abs(ny) > 0.9 ? Math.sign(ny) : 0,
      ],
      i * 4,
    );
    index[i] = THREE.MathUtils.clamp(p.getX(i) / width + 0.5, 0, 1) * (CELLS - 1);
  }
  geometry.setAttribute('cellCoord', new THREE.BufferAttribute(coord, 4));
  geometry.setAttribute('cellIndex', new THREE.BufferAttribute(index, 1));
  return { geometry, capX, capZ };
}

// 一排 7 个圆囊或一条条囊：外壳光效、目标高度环、上升/下落光点和地面光垫。
export class AirCellRowFx {
  constructor(definition) {
    this.definition = definition;
    this.cellFx = true;
    this.strip = definition.shape === 'strip';
    this.side = definition.side;
    this.zone = definition.zone;
    const { width, depth, side, zone } = definition,
      strip = this.strip;
    this.pitch = width / CELLS;
    this.radius = strip ? depth / 2 : Math.min(depth, this.pitch) * 0.46;
    this.corner = strip ? stripCorner(width, depth) : 0;
    let geometry,
      capHalf = new THREE.Vector2(1, 1);
    if (strip) {
      const shell = stripShell(width, depth);
      geometry = shell.geometry;
      capHalf = new THREE.Vector2(shell.capX, shell.capZ);
    } else geometry = roundAirRow(width, depth, CELLS, false, true);
    geometry.deleteAttribute('uv');
    this.rest = geometry.attributes.position.clone();
    this.restNormal = geometry.attributes.normal.clone();
    geometry.computeBoundingSphere();
    const innerFirst = definition.x > 0 ? 1 : 0;
    this.tile = new THREE.Mesh(
      geometry,
      additive(
        {
          tint: { value: COLORS.hold.clone() },
          idleTint: { value: COLORS.idle },
          flashTint: { value: COLORS.flash },
          energy: { value: 0 },
          direction: { value: 0 },
          flow: { value: 0 },
          time: { value: 0 },
          level: { value: 0.5 },
          goal: { value: -1 },
          focus: { value: 0 },
          flash: { value: 0 },
          tilt: { value: 0 },
          innerFirst: { value: innerFirst },
          rect: { value: strip ? 1 : 0 },
          halfSize: { value: capHalf },
          corner: { value: FX.stripCapCorner },
        },
        shellVertex,
        shellFragment,
        { side: THREE.FrontSide },
      ),
    );
    this.tile.name = `Air_Cell_Shell_${side}_${zone}`;
    // 圆囊每个一圈 32 段的环，条囊沿圆角矩形一整圈：有目标值时停在目标高度（虚线），
    // 否则贴着顶面呼吸。
    this.ringLoops = strip ? 1 : CELLS;
    this.ringSegments = strip ? FX.stripRingSegments : 32;
    const ringVertices = this.ringLoops * this.ringSegments * 2;
    const ringGeometry = new THREE.BufferGeometry();
    ringGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(ringVertices * 3), 3),
    );
    ringGeometry.setAttribute(
      'center',
      new THREE.BufferAttribute(new Float32Array(ringVertices * 3), 3),
    );
    const angles = new Float32Array(ringVertices),
      segments = this.ringSegments;
    for (let c = 0; c < this.ringLoops; c++)
      for (let j = 0; j < segments; j++)
        angles.set([j / segments, (j + 1) / segments], (c * segments + j) * 2);
    ringGeometry.setAttribute('angle', new THREE.BufferAttribute(angles, 1));
    this.pulse = new THREE.LineSegments(
      ringGeometry,
      additive(
        {
          tint: { value: COLORS.hold.clone() },
          strength: { value: 0 },
          dashed: { value: 0 },
          spin: { value: 0 },
          scale: { value: 1 },
          dashes: { value: strip ? FX.stripDashes : 16 },
        },
        ringVertex,
        ringFragment,
      ),
    );
    this.pulse.name = `Air_Cell_Target_${side}_${zone}`;
    this.pulse.frustumCulled = false;
    // 每个圆囊 3 个光点，条囊沿轮廓均布；从底到顶（放气时反向）。
    const sparkCount = strip ? FX.stripSparks : CELLS * 3,
      sparkGeometry = new THREE.BufferGeometry(),
      seeds = new Float32Array(sparkCount * 2);
    this.sparkAngles = [];
    for (let i = 0; i < sparkCount; i++) {
      this.sparkAngles.push(strip ? (i + 0.5) / sparkCount : (i * 2.39996) % TAU);
      seeds.set([(i * 0.618034) % 1, 24 + (i % 3) * 5], i * 2);
    }
    sparkGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(sparkCount * 3), 3),
    );
    sparkGeometry.setAttribute(
      'rise',
      new THREE.BufferAttribute(new Float32Array(sparkCount * 3), 3),
    );
    sparkGeometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 2));
    this.particles = new THREE.Points(
      sparkGeometry,
      additive(
        { tint: { value: COLORS.hold.clone() }, flow: { value: 0 }, strength: { value: 0 } },
        sparkVertex,
        sparkFragment,
      ),
    );
    this.particles.name = `Air_Cell_Sparks_${side}_${zone}`;
    this.particles.frustumCulled = false;
    // 气囊底部的整排光垫：圆角描边 + 从气路端扫向外侧的光带。
    const padX = width / 2 + FX.padMargin,
      padZ = this.radius + FX.padMargin,
      nx = 28,
      padRest = [],
      padCoord = [],
      index = [];
    for (let j = 0; j <= 2; j++)
      for (let i = 0; i <= nx; i++) {
        const u = (i / nx) * 2 - 1,
          v = j - 1;
        padRest.push(u * padX, 0, v * padZ);
        padCoord.push(u, v, innerFirst ? (u + 1) / 2 : (1 - u) / 2);
      }
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i,
          b = a + 1,
          c = a + nx + 1,
          d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    const padGeometry = new THREE.BufferGeometry();
    padGeometry.setAttribute('position', new THREE.Float32BufferAttribute(padRest, 3));
    padGeometry.setAttribute('padCoord', new THREE.Float32BufferAttribute(padCoord, 3));
    padGeometry.setIndex(index);
    this.padRest = Float32Array.from(padRest);
    this.pad = new THREE.Mesh(
      padGeometry,
      additive(
        {
          tint: { value: COLORS.hold.clone() },
          halfSize: { value: new THREE.Vector2(padX, padZ) },
          pitch: { value: this.pitch },
          radius: { value: this.radius },
          energy: { value: 0 },
          direction: { value: 0 },
          flow: { value: 0 },
          focus: { value: 0 },
          rect: { value: strip ? 1 : 0 },
          cellHalf: { value: new THREE.Vector2(width / 2, depth / 2) },
          corner: { value: this.corner },
        },
        padVertex,
        padFragment,
        { side: THREE.DoubleSide },
      ),
    );
    this.pad.name = `Air_Cell_Pad_${side}_${zone}`;
    // 与实体气囊同序：光垫在实体之前、外壳与光点在外罩之前绘制，外罩的局部透明度统一遮罩光效。
    this.pad.renderOrder = 1;
    this.tile.renderOrder = 2;
    this.pulse.renderOrder = 3;
    this.particles.renderOrder = 3;
    this.objects = [this.pad, this.tile, this.pulse, this.particles];
    this.cache = {};
  }

  // 条囊轮廓按“倍”放大：与圆囊一致地以短边半宽为基准外扩，长边不被拉得过远。
  outline(scale) {
    const grow = (scale - 1) * this.radius;
    return [this.definition.width / 2 + grow, this.definition.depth / 2 + grow, this.corner + grow];
  }

  map(spine, x, y, z) {
    const d = this.definition;
    return mapPoint(spine, d.x + x, d.bottom + y, d.z + z, null, false);
  }

  layoutShell(spine, halfHeight) {
    if (this.cache.shellSpine === spine && this.cache.shellHeight === halfHeight) return;
    const positions = this.tile.geometry.attributes.position,
      rest = this.rest,
      normal = this.restNormal,
      gap = FX.shellGap;
    for (let i = 0; i < positions.count; i++) {
      const p = this.map(
        spine,
        rest.getX(i) + normal.getX(i) * gap,
        halfHeight + (rest.getY(i) * halfHeight) / 0.06 + normal.getY(i) * gap,
        rest.getZ(i) + normal.getZ(i) * gap,
      );
      positions.setXYZ(i, p.x, p.y, p.z);
    }
    positions.needsUpdate = true;
    this.tile.geometry.computeBoundingSphere();
    this.cache.shellSpine = spine;
    this.cache.shellHeight = halfHeight;
  }

  layoutPad(spine) {
    if (this.cache.padSpine === spine) return;
    const positions = this.pad.geometry.attributes.position,
      rest = this.padRest;
    for (let i = 0; i < positions.count; i++) {
      const p = this.map(spine, rest[i * 3], -FX.padDrop, rest[i * 3 + 2]);
      positions.setXYZ(i, p.x, p.y, p.z);
    }
    positions.needsUpdate = true;
    this.pad.geometry.computeBoundingSphere();
    this.cache.padSpine = spine;
  }

  layoutRings(spine, height, scale) {
    // 光环与光点不贴实体，1.5 mm 内的高度变化不重排，减少充放气过程中的 CPU 工作。
    if (
      this.cache.ringSpine === spine &&
      Math.abs(this.cache.ringHeight - height) < FX.relayoutStep &&
      this.cache.ringScale === scale
    )
      return;
    const positions = this.pulse.geometry.attributes.position,
      centers = this.pulse.geometry.attributes.center,
      radius = this.radius * scale;
    if (this.strip) {
      const segments = this.ringSegments,
        [hx, hz, r] = this.outline(scale),
        center = this.map(spine, 0, height, 0);
      for (let j = 0; j < segments; j++)
        for (let k = 0; k < 2; k++) {
          const [x, z] = roundedRectPoint(hx, hz, r, (j + k) / segments),
            p = this.map(spine, x, height, z),
            i = j * 2 + k;
          positions.setXYZ(i, p.x, p.y, p.z);
          centers.setXYZ(i, center.x, center.y, center.z);
        }
    } else
      for (let c = 0; c < CELLS; c++) {
        const cx = (c - (CELLS - 1) / 2) * this.pitch,
          center = this.map(spine, cx, height, 0);
        for (let j = 0; j < 32; j++)
          for (let k = 0; k < 2; k++) {
            const a = ((j + k) / 32) * TAU,
              p = this.map(spine, cx + Math.sin(a) * radius, height, -Math.cos(a) * radius),
              i = (c * 32 + j) * 2 + k;
            positions.setXYZ(i, p.x, p.y, p.z);
            centers.setXYZ(i, center.x, center.y, center.z);
          }
      }
    positions.needsUpdate = centers.needsUpdate = true;
    Object.assign(this.cache, { ringSpine: spine, ringHeight: height, ringScale: scale });
  }

  layoutSparks(spine, halfHeight) {
    if (
      this.cache.sparkSpine === spine &&
      Math.abs(this.cache.sparkHeight - halfHeight) * 2 < FX.relayoutStep
    )
      return;
    const base = this.particles.geometry.attributes.position,
      rise = this.particles.geometry.attributes.rise,
      radius = this.radius * FX.sparkScale;
    const [hx, hz, r] = this.strip ? this.outline(FX.sparkScale) : [];
    for (let i = 0; i < base.count; i++) {
      const c = Math.floor(i / 3),
        cx = (c - (CELLS - 1) / 2) * this.pitch,
        a = this.sparkAngles[i],
        [x, z] = this.strip
          ? roundedRectPoint(hx, hz, r, a)
          : [cx + Math.sin(a) * radius, -Math.cos(a) * radius],
        from = this.map(spine, x, 0.004, z),
        to = this.map(spine, x, halfHeight * 2 + FX.sparkRise, z);
      base.setXYZ(i, from.x, from.y, from.z);
      rise.setXYZ(i, to.x, to.y, to.z);
    }
    base.needsUpdate = rise.needsUpdate = true;
    this.cache.sparkSpine = spine;
    this.cache.sparkHeight = halfHeight;
  }

  update({ spine, amount, target, region, visible, selected, moving, flash, time }) {
    const tile = this.tile,
      d = this.definition;
    tile.visible = visible;
    const lit = visible && (selected || region.active > 0.002);
    this.pad.visible = lit;
    // 目标环和光点只在该路被调节且允许动效时出现；结束后随整排淡出。
    this.pulse.visible = this.particles.visible = selected
      ? visible && moving
      : lit && region.flow !== 0;
    if (!visible) return;
    const halfHeight = d.minHalfHeight + amount * d.halfHeightRange;
    this.layoutShell(spine, halfHeight);
    const u = tile.material.uniforms;
    u.tint.value.copy(region.tint);
    u.energy.value = region.active;
    u.direction.value = region.direction;
    u.flow.value = region.flow;
    u.time.value = time;
    u.level.value = amount;
    u.goal.value = target === null ? -1 : target;
    u.focus.value = 1;
    u.flash.value = flash;
    u.tilt.value = sampleSpine(spine, d.z).angle;
    if (lit) {
      this.layoutPad(spine);
      const pad = this.pad.material.uniforms;
      pad.tint.value.copy(region.tint);
      pad.energy.value = region.active;
      pad.direction.value = region.direction;
      pad.flow.value = region.flow;
      pad.focus.value = 1;
    }
    if (this.pulse.visible) {
      const ring = this.pulse.material.uniforms,
        goal = target === null ? amount : target,
        aiming = Math.abs(goal - amount) > 0.04;
      // 有明确目标时，虚线环停在目标高度：向上调时悬在顶面上方，向下调时套在柱壁外侧。
      const height = aiming
        ? (d.minHalfHeight + goal * d.halfHeightRange) * 2
        : halfHeight * 2 + FX.ringLift;
      this.layoutRings(
        spine,
        height,
        !aiming ? FX.ringScale : goal > amount ? FX.targetScale : FX.collarScale,
      );
      ring.tint.value.copy(region.tint);
      ring.strength.value = region.active * (aiming ? 0.95 : 0.55);
      ring.dashed.value = aiming ? 1 : 0;
      ring.spin.value = time * 0.6;
      ring.scale.value = aiming
        ? 1
        : 1 + (this.strip ? FX.stripBreathe : 0.09) * (0.5 + 0.5 * Math.sin(time * 3.2));
      this.layoutSparks(spine, halfHeight);
      const spark = this.particles.material.uniforms;
      spark.tint.value.copy(region.tint);
      spark.flow.value = region.flow;
      spark.strength.value = region.active * Math.min(1, Math.abs(region.direction) * 1.4);
    }
  }
}

// 单侧底板的细网格；扫描进入/退出时随扫描线一同扫亮。
export class SubstrateGridFx {
  constructor(side) {
    this.side = side;
    const sign = side ? 1 : -1,
      halfWidth = (DIMENSIONS.width - FOUNDATION_FOAM.inset) / 2,
      halfLength = (DIMENSIONS.length - FOUNDATION_FOAM.inset) / 2,
      nx = 8,
      nz = 72,
      rest = [],
      coords = [],
      index = [];
    for (let j = 0; j <= nz; j++)
      for (let i = 0; i <= nx; i++) {
        const x = sign * (FX.gridInset + (i / nx) * (halfWidth - FX.gridInset)),
          z = -halfLength + (j / nz) * halfLength * 2;
        rest.push(x, 0, z);
        coords.push(x, z);
      }
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i,
          b = a + 1,
          c = a + nx + 1,
          d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(rest, 3));
    geometry.setAttribute('rest', new THREE.Float32BufferAttribute(coords, 2));
    geometry.setIndex(index);
    this.rest = Float32Array.from(rest);
    // 贴在基础承托泡棉顶面之上，略抬高避免深度冲突。
    this.surface = FOUNDATION_FOAM.center + FOUNDATION_FOAM.thickness / 2 + FX.gridLift;
    this.mesh = new THREE.Mesh(
      geometry,
      additive(
        {
          tint: { value: COLORS.grid },
          focus: { value: 0 },
          pitch: { value: FX.gridPitch },
          front: { value: 0 },
          scanning: { value: 0 },
          extent: { value: new THREE.Vector2(halfWidth, halfLength) },
        },
        gridVertex,
        gridFragment,
        { side: THREE.DoubleSide },
      ),
    );
    this.mesh.name = `Air_Substrate_Grid_${side}`;
    this.mesh.renderOrder = 1;
  }
  update({ spine, visible, front, scanning }) {
    this.mesh.visible = visible;
    if (!visible) return;
    if (this.spine !== spine) {
      const positions = this.mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const p = mapPoint(
          spine,
          this.rest[i * 3],
          this.surface,
          this.rest[i * 3 + 2],
          null,
          false,
        );
        positions.setXYZ(i, p.x, p.y, p.z);
      }
      positions.needsUpdate = true;
      this.mesh.geometry.computeBoundingSphere();
      this.spine = spine;
    }
    const u = this.mesh.material.uniforms;
    u.focus.value = 1;
    u.front.value = front;
    u.scanning.value = scanning;
  }
}

// 一路气路从床尾汇流排到各排圆囊的发光走线，流光方向随充气/放气反向。
export class CircuitTraceFx {
  constructor(path) {
    this.path = path;
    this.side = path.side;
    this.regionId = path.regionId;
    const pieces = [];
    const trunkCurve = new THREE.CatmullRomCurve3(path.trunk.map((p) => new THREE.Vector3(...p)));
    const trunkLength = trunkCurve.getLength();
    const add = (curve, segments, offset) => {
      const tube = new THREE.TubeGeometry(curve, segments, FX.traceRadius, 6, false),
        uv = tube.attributes.uv,
        length = curve.getLength(),
        distance = new Float32Array(uv.count);
      for (let i = 0; i < uv.count; i++) distance[i] = offset + uv.getX(i) * length;
      tube.setAttribute('pathDistance', new THREE.BufferAttribute(distance, 1));
      tube.deleteAttribute('uv');
      tube.deleteAttribute('normal');
      pieces.push(tube);
    };
    add(trunkCurve, 48, 0);
    for (const branch of path.branches)
      add(new THREE.CatmullRomCurve3(branch.map((p) => new THREE.Vector3(...p))), 32, trunkLength);
    const geometry = mergeGeometries(pieces);
    pieces.forEach((g) => g.dispose());
    this.rest = Float32Array.from(geometry.attributes.position.array);
    this.mesh = new THREE.Mesh(
      geometry,
      additive(
        {
          tint: { value: COLORS.hold.clone() },
          energy: { value: 0 },
          flow: { value: 0 },
          focus: { value: 0 },
        },
        traceVertex,
        traceFragment,
      ),
    );
    this.mesh.name = `Air_Circuit_Trace_${path.regionId}`;
    this.mesh.renderOrder = 2;
  }
  update({ spine, visible, region }) {
    this.mesh.visible = visible && region.active > 0.002;
    if (!this.mesh.visible) return;
    if (this.spine !== spine) {
      const positions = this.mesh.geometry.attributes.position,
        rest = this.rest;
      for (let i = 0; i < positions.count; i++) {
        const p = mapPoint(spine, rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2], null, false);
        positions.setXYZ(i, p.x, p.y, p.z);
      }
      positions.needsUpdate = true;
      this.mesh.geometry.computeBoundingSphere();
      this.spine = spine;
    }
    const u = this.mesh.material.uniforms;
    u.tint.value.copy(region.tint);
    u.energy.value = region.active;
    u.flow.value = region.flow;
    u.focus.value = 1;
  }
}

export const hasCellFx = (bag) => bag.shape === 'round-array' || bag.shape === 'strip';

// 组合：所有圆囊排或条囊、每侧底板网格、每一路气路走线。
export class AirCellEffect {
  constructor(airbags) {
    this.rows = airbags.filter(hasCellFx).map((b) => new AirCellRowFx(b));
    this.regions = new Map();
    for (const row of this.rows)
      if (!this.regions.has(row.definition.regionId))
        this.regions.set(
          row.definition.regionId,
          new AirRegionFx(row.definition.regionId, row.definition),
        );
    this.grids = [0, 1].map((side) => new SubstrateGridFx(side));
    this.traces = circuitTubePaths(airbags.filter(hasCellFx)).map(
      (path) => new CircuitTraceFx(path),
    );
    this.objects = [
      ...this.grids.map((g) => g.mesh),
      ...this.traces.map((t) => t.mesh),
      ...this.rows.flatMap((r) => r.objects),
    ];
    this.lastTime = null;
  }
  reset() {
    for (const region of this.regions.values()) region.reset();
    this.lastTime = null;
  }
  update(state) {
    const { spine, pressures, selection, time, moving } = state,
      animate = state.animate ?? moving,
      dt = this.lastTime === null ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const shown = selection.kind !== 'heat' && selection.kind !== 'rest',
      sideVisible = (side) =>
        shown && (selection.side === 'both' || selection.side === humanSide(side)),
      ids = selection.activeRegionIds || [];
    let animating = false;
    for (const region of this.regions.values()) {
      const bag = region.bag,
        visible = sideVisible(bag.side),
        status = state.regionStates?.[region.regionId];
      animating =
        region.step({
          selected: visible && ids.includes(region.regionId),
          fault: visible && status?.status === 'fault',
          direction: status?.direction || 0,
          level: pressures[bag.side][bag.zone] / 100,
          time,
          dt,
          moving: moving && visible && ids.includes(region.regionId),
          animate,
        }) || animating;
    }
    const scanState = (side) => {
      const name = humanSide(side),
        reveal = state.reveal,
        item = reveal?.sides
          ? reveal.sides[name]
          : reveal?.side === name || reveal?.side === 'both'
            ? reveal
            : null,
        scanning = ['scan', 'closing'].includes(item?.phase) ? 1 : 0,
        front = -DIMENSIONS.length / 2 - 0.03 + (DIMENSIONS.length + 0.06) * (item?.progress || 0);
      return { scanning, front };
    };
    const scans = [scanState(0), scanState(1)];
    for (const row of this.rows) {
      const d = row.definition,
        region = this.regions.get(d.regionId),
        { scanning, front } = scans[d.side],
        target = state.targets ? state.targets[d.side][d.zone] / 100 : null;
      row.update({
        spine,
        amount: pressures[d.side][d.zone] / 100,
        target,
        region,
        visible: sideVisible(d.side),
        selected: ids.includes(d.regionId),
        moving: moving && ids.includes(d.regionId),
        flash: scanning ? Math.exp(-(((d.z - front) / 0.07) ** 2)) : 0,
        time,
      });
    }
    for (const grid of this.grids)
      grid.update({ spine, visible: sideVisible(grid.side), ...scans[grid.side] });
    for (const trace of this.traces)
      trace.update({
        spine,
        visible: sideVisible(trace.side),
        region: this.regions.get(trace.regionId),
      });
    return animating;
  }
}

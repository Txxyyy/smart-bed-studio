// 网页版二维降级画面：与 Flutter 原生 SoftLightPainter（soft_light_painter.dart）同一画法和参数，二者同步修改。
// 透视层（reveal-*.png）与每路光效层（glow-*.png）取自 3D 渲染；缺图时回退为按床面透视的程序光效。
// 画布与底图同尺寸，以下尺寸均为 1200 宽底图像素。正式降级由 Flutter 原生绘制，本模块用于网页预览与评审。

export const FALLBACK_COLORS = Object.freeze({
  inflate: '#16c8ff',
  deflate: '#ff8a1e',
  hold: '#7fe2ff',
  fault: '#ff3048',
  scan: '#9cf1ff',
  heating: '#ffa36b',
  massage: '#c49be8',
});
const HALF_W = 0.8,
  HALF_L = 0.95;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const x = hex(a),
    y = hex(b);
  return (
    '#' +
    x
      .map((v, i) =>
        Math.round(v + (y[i] - v) * t)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
};
const rgba = (h, a) => {
  const [r, g, b] = hex(h);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
};
const ACTIVE_AIR = ['inflating', 'deflating', 'adjusting'];

/** 充气 1、放气 -1、保压/未知 0：显式状态优先，其次是展示中的 air.moveTo 方向。 */
export function airDirection(status, motion) {
  if (status === 'inflating') return 1;
  if (status === 'deflating') return -1;
  if (motion && motion.target !== motion.value) return Math.sign(motion.target - motion.value);
  return 0;
}
export const airTint = (status, direction) =>
  status === 'fault'
    ? FALLBACK_COLORS.fault
    : direction > 0
      ? FALLBACK_COLORS.inflate
      : direction < 0
        ? FALLBACK_COLORS.deflate
        : FALLBACK_COLORS.hold;
/** 扫描线位置，与 src/air-cell-effect.js 的 scanState 相同（米，床头为负）。 */
export const scanFront = (progress) => -HALF_L - 0.03 + (HALF_L * 2 + 0.06) * progress;

/** 床面顶面（1.6×1.9 m）到底图的单应变换，与 SurfaceProjection 相同。 */
export function surfaceProjection(metadata) {
  const p = metadata.surface.map(([u, v]) => [u * metadata.width, v * metadata.height]);
  const sx = p[0][0] - p[1][0] + p[2][0] - p[3][0],
    sy = p[0][1] - p[1][1] + p[2][1] - p[3][1];
  let a,
    b,
    c,
    d,
    e,
    f,
    g = 0,
    h = 0;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    [a, b, c] = [p[1][0] - p[0][0], p[3][0] - p[0][0], p[0][0]];
    [d, e, f] = [p[1][1] - p[0][1], p[3][1] - p[0][1], p[0][1]];
  } else {
    const dx1 = p[1][0] - p[2][0],
      dx2 = p[3][0] - p[2][0],
      dy1 = p[1][1] - p[2][1],
      dy2 = p[3][1] - p[2][1];
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
    [a, b, c] = [p[1][0] - p[0][0] + g * p[1][0], p[3][0] - p[0][0] + h * p[3][0], p[0][0]];
    [d, e, f] = [p[1][1] - p[0][1] + g * p[1][1], p[3][1] - p[0][1] + h * p[3][1], p[0][1]];
  }
  return (x, z) => {
    const u = (x + HALF_W) / (2 * HALF_W),
      v = (z + HALF_L) / (2 * HALF_L),
      w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
  };
}

function polygon(points) {
  const path = new Path2D();
  points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  path.closePath();
  return path;
}

/** 按型号气囊定义投影出程序光效使用的轮廓（缺光效层时才用到）。 */
function buildGeometry(metadata, profile) {
  const map = surfaceProjection(metadata),
    bags = [];
  for (const bag of profile?.airbags || []) {
    const sign = bag.x < 0 ? -1 : 1,
      inner = bag.x - (sign * bag.width) / 2,
      outer = bag.x + (sign * bag.width) / 2;
    const round = bag.shape === 'round-array',
      cells = [];
    if (round) {
      const count = bag.cellCount || 7,
        pitch = bag.width / count,
        r = Math.min(bag.depth, pitch) * 0.46;
      for (let i = 0; i < count; i++) {
        const cx = bag.x + (i - (count - 1) / 2) * pitch;
        cells.push({
          outline: Array.from({ length: 24 }, (_, k) =>
            map(cx + r * Math.cos((k * Math.PI) / 12), bag.z + r * Math.sin((k * Math.PI) / 12)),
          ),
          order: Math.min(1, Math.abs((cx - inner) / (outer - inner))),
        });
      }
    } else {
      const hx = bag.width / 2 - 0.006,
        hz = bag.depth / 2 - 0.006,
        r = Math.min(0.047, bag.width * 0.2, bag.depth * 0.2) - 0.006;
      const corners = [
        [bag.x + hx - r, bag.z - hz + r],
        [bag.x + hx - r, bag.z + hz - r],
        [bag.x - hx + r, bag.z + hz - r],
        [bag.x - hx + r, bag.z - hz + r],
      ];
      const outline = [];
      corners.forEach(([cx, cz], c) => {
        for (let k = 0; k <= 6; k++) {
          const angle = ((c - 1 + k / 6) * Math.PI) / 2;
          outline.push(map(cx + r * Math.cos(angle), cz + r * Math.sin(angle)));
        }
      });
      cells.push({ outline, order: 0.5 });
    }
    for (const cell of cells) cell.path = polygon(cell.outline);
    bags.push({ regionId: bag.regionId, round, inner, outer, z: bag.z, depth: bag.depth, cells });
  }
  const quad = (x0, x1, z0, z1) => polygon([map(x0, z0), map(x1, z0), map(x1, z1), map(x0, z1)]);
  return { map, bags, quad, surface: quad(-HALF_W, HALF_W, -HALF_L, HALF_L) };
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/**
 * 二维降级画面。frame 描述当前设备与展示状态（与原生后端相同的字段含义）：
 * { online, animate, air: {id: {status}}, motions: {id: {target, value}}, highlight: id[] | null,
 *   reveals: {left, right}, scanning: {left, right}, heating: {id: {status, level}},
 *   heatingMax: {id: maxLevel}, massage: {id: {status, intensity, cycleSeconds}} }
 */
export class FallbackView {
  constructor(host) {
    this.root = document.createElement('div');
    this.root.className = 'fallback-view';
    this.root.style.cssText =
      'position:absolute;inset:0;display:grid;place-items:center;pointer-events:none';
    this.poster = document.createElement('div');
    this.poster.style.cssText = 'position:relative;height:100%;max-width:100%';
    this.base = document.createElement('img');
    this.base.alt = '床尾正中视角底图';
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-label', '二维调节光效');
    for (const layer of [this.base, this.canvas])
      layer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain';
    this.poster.append(this.base, this.canvas);
    this.root.append(this.poster);
    host.append(this.root);
    this.ctx = this.canvas.getContext('2d');
    this.scratch = document.createElement('canvas');
    this.sctx = this.scratch.getContext('2d');
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.clock = 0;
    this.last = 0;
    this.raf = 0;
    this.lastAirBySide = { left: null, right: null };
    this.modelKey = null;
  }

  /** 载入型号的二维资源；assets = { base, reveal: {left, right}, glow: {regionId: url} }。 */
  async setModel(key, { metadata, profile, assets }) {
    this.modelKey = key;
    const [left, right, ...glows] = await Promise.all([
      loadImage(assets.reveal?.left),
      loadImage(assets.reveal?.right),
      ...Object.entries(assets.glow || {}).map(async ([id, url]) => [id, await loadImage(url)]),
    ]);
    if (this.modelKey !== key) return false;
    this.metadata = metadata;
    this.layers = {
      reveal: { left, right },
      glow: Object.fromEntries(glows.filter(([, image]) => image)),
    };
    this.geometry = buildGeometry(metadata, profile);
    this.base.src = assets.base;
    this.canvas.width = metadata.width;
    this.canvas.height = metadata.height;
    this.poster.style.aspectRatio = `${metadata.width} / ${metadata.height}`;
    this.lastAirBySide = { left: null, right: null };
    return true;
  }

  /** 持续绘制：每帧从 frameSource() 取得当前状态。 */
  start(frameSource) {
    this.frameSource = frameSource;
    if (this.raf) return;
    this.last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      const frame = this.frameSource?.(dt);
      if (frame) {
        if (frame.animate !== false && !this.reduced.matches) this.clock += dt;
        this.paint(frame);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
  dispose() {
    this.stop();
    this.root.remove();
  }

  fill(path, color, alpha, blur = 0) {
    const ctx = this.ctx;
    ctx.filter = blur > 0 ? `blur(${blur}px)` : 'none';
    ctx.fillStyle = rgba(color, alpha);
    ctx.fill(path);
    ctx.filter = 'none';
  }
  stroke(path, color, alpha, width, blur) {
    const ctx = this.ctx;
    ctx.filter = blur > 0 ? `blur(${blur}px)` : 'none';
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(color, alpha);
    ctx.stroke(path);
    ctx.filter = 'none';
  }

  /** 一路气囊：极淡内部染色 + 轮廓柔光晕 + 亮边 + 流光，均贴合床面透视。 */
  paintCircuit(bags, { tint, energy, direction, fault, animate }) {
    const t = this.clock,
      moving = fault ? 0 : Math.min(1, Math.abs(direction));
    const breathe = animate && !fault && moving === 0 ? 0.5 + 0.5 * Math.sin(t * 2.4) : 0.5;
    const glow = energy * (fault ? 0.95 : 0.82 + 0.18 * breathe);
    const union = new Path2D();
    for (const bag of bags) for (const cell of bag.cells) union.addPath(cell.path);
    this.fill(union, tint, 0.07 * glow);
    this.stroke(union, tint, 0.32 * glow, 6, 5);
    this.stroke(union, mix(tint, '#ffffff', 0.3), 0.85 * glow, 1.4, 0.6);
    if (!animate || moving === 0) return;
    const light = mix(tint, '#ffffff', 0.35);
    for (const bag of bags) {
      if (bag.round) {
        for (const cell of bag.cells) {
          const wave = Math.pow(
            0.5 + 0.5 * Math.cos(2 * Math.PI * (t * 0.8 * direction - cell.order * 0.9)),
            4,
          );
          this.fill(cell.path, light, 0.34 * wave * glow * moving, 2);
        }
      } else {
        const phase = (((t * 0.55 * direction) % 1) + 1) % 1,
          center = bag.inner + (bag.outer - bag.inner) * (-0.15 + 1.3 * phase),
          half = 0.075;
        this.ctx.save();
        this.ctx.clip(bag.cells[0].path);
        this.fill(
          this.geometry.quad(
            center - half,
            center + half,
            bag.z - bag.depth / 2,
            bag.z + bag.depth / 2,
          ),
          light,
          0.34 * glow * moving,
          9,
        );
        this.ctx.restore();
      }
    }
  }

  tinted(image, tint) {
    const { scratch, sctx } = this;
    scratch.width = image.width;
    scratch.height = image.height;
    sctx.globalCompositeOperation = 'copy';
    sctx.drawImage(image, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = tint;
    sctx.fillRect(0, 0, image.width, image.height);
    sctx.globalCompositeOperation = 'source-over';
    return scratch;
  }
  /** 该路的 3D 光效层：按状态着色后加色叠加；充放气时再叠一段从床中线扫向床边的流光。 */
  paintGlow(image, g, { tint, strength, direction, animate, side }) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, strength);
    ctx.drawImage(this.tinted(image, tint), g.x, g.y, g.width, g.height);
    if (animate && direction) {
      const phase = (((this.clock * 0.45 * direction) % 1) + 1) % 1,
        outward = side === 'left' ? 1 : -1;
      const inner = outward > 0 ? 0 : g.width,
        center = inner + outward * g.width * (-0.2 + 1.4 * phase),
        half = g.width * 0.16;
      const band = this.tinted(image, tint),
        bctx = band.getContext('2d');
      bctx.globalCompositeOperation = 'destination-in';
      const gradient = bctx.createLinearGradient(center - half, 0, center + half, 0);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,1)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      bctx.fillStyle = gradient;
      bctx.fillRect(0, 0, g.width, g.height);
      bctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, strength * 0.9);
      ctx.drawImage(band, g.x, g.y, g.width, g.height);
    }
    ctx.restore();
  }
  soft(color, rect, strength, heating) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(rect.cx, rect.cy);
    ctx.scale(rect.rx, rect.ry);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, rgba(color, strength * 0.75));
    gradient.addColorStop(heating ? 0.56 : 0.38, rgba(color, strength * 0.28));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  paintAir(frame) {
    const { metadata, geometry, layers, ctx, canvas } = this;
    const online = frame.online !== false;
    const air = frame.air || {},
      motions = frame.motions || {};
    const isActive = (id) =>
      frame.highlight
        ? frame.highlight.includes(id)
        : ACTIVE_AIR.includes(air[id]?.status) || !!motions[id];
    const center = geometry.map(0, 0)[0],
      head = geometry.map(0, -HALF_L)[1] - 6;
    for (const side of ['left', 'right']) {
      const reveal = Math.max(0, Math.min(1, frame.reveals?.[side] ?? 0)),
        scanning = !!frame.scanning?.[side];
      const lit = [];
      for (const region of metadata.regions) {
        if (region.kind !== 'air' || region.side !== side) continue;
        const id = region.id,
          status = air[id]?.status,
          fault = status === 'fault',
          active = isActive(id) || fault;
        if (isActive(id)) this.lastAirBySide[side] = id;
        const trailing = !active && this.lastAirBySide[side] === id && reveal > 0;
        if (!active && !trailing) continue;
        const direction = active && !fault ? airDirection(status, motions[id]) : 0;
        // 扫描入场时随扫描淡入；收尾时最后调节的气路随扫描淡出。
        const energy =
          (online ? 1 : 0.35) * (active ? (scanning ? reveal : 1) : trailing ? reveal : 0.5);
        if (energy <= 0.001) continue;
        lit.push({
          id,
          glow: region.glow,
          tint: active ? airTint(status, direction) : FALLBACK_COLORS.hold,
          energy,
          direction,
          fault,
          animate: frame.animate !== false && !this.reduced.matches && active && !fault,
        });
      }
      // 外罩揭开进度：有扫描时跟随扫描；没有扫描但有光效时直接揭开。
      const open = scanning ? reveal : lit.length ? 1 : reveal;
      const revealImage = layers.reveal[side],
        baked = new Set();
      if (revealImage && open > 0) {
        // 只换床垫部分：从床头边缘到扫描线（完全揭开时到画面底部，含床尾侧面）。
        const front = open >= 1 ? canvas.height : geometry.map(0, scanFront(open))[1];
        ctx.save();
        ctx.beginPath();
        if (side === 'left') ctx.rect(center, head, canvas.width - center, front - head);
        else ctx.rect(0, head, center, front - head);
        ctx.clip();
        ctx.drawImage(revealImage, 0, 0, canvas.width, canvas.height);
        for (const item of lit) {
          const image = layers.glow[item.id];
          if (!image || !item.glow) continue;
          // 保压时在 72%–100% 之间缓慢呼吸；调节中亮度稳定，方向由流光表达。
          const breathe =
            item.animate && item.direction === 0
              ? 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(this.clock * 2.6))
              : 1;
          this.paintGlow(image, item.glow, { ...item, strength: item.energy * breathe, side });
          baked.add(item.id);
        }
        ctx.restore();
      }
      const procedural = lit.filter((item) => !baked.has(item.id));
      if (procedural.length) {
        ctx.save();
        ctx.clip(geometry.surface);
        for (const item of procedural) {
          const bags = geometry.bags.filter((b) => b.regionId === item.id);
          if (bags.length) this.paintCircuit(bags, item);
        }
        ctx.restore();
      }
      // 扫描入场/退场时显示一条横跨该半侧床面的扫描光线，与 3D 外罩上的扫描线对应。
      if (scanning && reveal > 0 && reveal < 1) {
        const [x0, x1] = side === 'left' ? [0, HALF_W] : [-HALF_W, 0],
          z = scanFront(reveal);
        ctx.save();
        ctx.clip(geometry.surface);
        this.fill(geometry.quad(x0, x1, z - 0.045, z + 0.01), FALLBACK_COLORS.scan, 0.3, 6);
        this.fill(geometry.quad(x0, x1, z - 0.004, z + 0.004), FALLBACK_COLORS.scan, 0.75);
        ctx.restore();
      }
    }
  }

  /** 加热暖色渐变与按摩紫色波纹，按人体左右分别限制在所属半侧。 */
  paintComfort(frame) {
    const { metadata, ctx, canvas } = this;
    const online = frame.online !== false,
      dynamic = frame.animate !== false && !this.reduced.matches;
    const toCanvas = (points) => points.map(([x, y]) => [x * canvas.width, y * canvas.height]);
    for (const region of metadata.regions) {
      const kind = region.kind;
      if (kind !== 'heating' && kind !== 'massage') continue;
      const record = frame[kind]?.[region.id] || {},
        status = record.status;
      const active =
        kind === 'heating'
          ? ['heating', 'holding'].includes(status)
          : ['running', 'paused'].includes(status);
      if (!active) continue;
      const heating = kind === 'heating',
        color = heating ? FALLBACK_COLORS.heating : FALLBACK_COLORS.massage;
      const animate = dynamic && status !== 'paused' && status !== 'holding';
      const cycle = heating ? 2.8 : Math.max(4, Math.min(30, record.cycleSeconds ?? 8));
      const wave = animate ? 0.5 + 0.5 * Math.sin((this.clock * Math.PI * 2) / cycle) : 0.5;
      const intensity = heating
        ? (record.level ?? 0) / (frame.heatingMax?.[region.id] || 3)
        : (record.intensity ?? 0);
      const strength = (online ? 1 : 0.3) * (0.3 + 0.7 * Math.max(0, Math.min(1, intensity)));
      const sidePoints = metadata.sidePolygons?.[region.side];
      ctx.save();
      if (sidePoints) ctx.clip(polygon(toCanvas(sidePoints)));
      const points = toCanvas(region.polygon),
        xs = points.map((p) => p[0]),
        ys = points.map((p) => p[1]);
      const bounds = {
        cx: (Math.min(...xs) + Math.max(...xs)) / 2,
        cy: (Math.min(...ys) + Math.max(...ys)) / 2,
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      };
      this.soft(
        color,
        {
          cx: bounds.cx,
          cy: bounds.cy,
          rx: (bounds.w / 2) * (heating ? 1.18 : 1.04),
          ry: (bounds.h / 2) * (heating ? 1.55 : 1.25),
        },
        strength * (heating ? 0.78 + 0.1 * wave : 0.42),
        heating,
      );
      if (!heating && animate) {
        for (const offset of [0, 0.5]) {
          const progress = (this.clock / cycle + offset) % 1;
          ctx.beginPath();
          ctx.ellipse(
            bounds.cx,
            bounds.cy,
            (bounds.w / 2) * (0.35 + 0.65 * progress),
            (bounds.h / 2) * (0.35 + 0.65 * progress),
            0,
            0,
            Math.PI * 2,
          );
          ctx.strokeStyle = rgba(color, strength * 0.48 * (1 - progress));
          ctx.lineWidth = Math.max(0.8, canvas.width / 1000);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  paint(frame) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.metadata || !this.geometry) return;
    this.paintAir(frame);
    this.paintComfort(frame);
  }
}

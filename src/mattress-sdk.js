import { RenderScheduler, renderBudget } from './render-budget.js';
import { tidalGroups } from './t12-circuits.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SmartBed } from './model.js';
import { MaterialLibrary } from './materials.js';
import { prepareBrandArtwork } from './branding.js';
import { FirmnessEffect } from './firmness-effect.js';
import { HeatingEffect } from './heating-effect.js';
import { MassageEffect } from './massage-effect.js';
import { MassageMotion } from './massage.js';
import { ModelRegistry, sdkError } from './model-profiles.js';
import { DeviceState, DevicePresentation } from './device-state.js';
import { shortestAngle } from './firmness.js';

const clone = (x) => structuredClone(x);
const visibleRevealKey = (reveal) =>
  reveal?.sides
    ? Object.values(reveal.sides).map((v) => v.phase === 'closed')
    : reveal?.phase === 'closed';
const closed = () => ({ side: null, phase: 'closed', progress: 0, ready: true });
const validVector = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

function release(bundle) {
  if (!bundle) return;
  const materials = new Set(Object.values(bundle.library.materials)),
    geometries = new Set(),
    textures = new Set(bundle.library.owned);
  for (const root of [bundle.bed?.root, bundle.air?.root, bundle.heat?.root, bundle.massage?.root])
    root?.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry) geometries.add(o.geometry);
      if (o.sourceMaterial) materials.add(o.sourceMaterial);
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : [])
        materials.add(m);
    });
  for (const b of bundle.bed?.airbags || []) {
    materials.add(b.mat);
    materials.add(b.showroomMat);
  }
  for (const m of bundle.bed?.coverReveal.copies.values() || []) materials.add(m);
  for (const m of materials)
    if (!m.userData.shared) {
      for (const t of Object.values(m)) if (t?.isTexture) textures.add(t);
      m.dispose();
    }
  geometries.forEach((g) => g.dispose());
  textures.forEach((t) => t.dispose());
  bundle.library.owned.clear();
}

/**
 * 公开接口类型（JSDoc，供编辑器提示与 // @ts-check 使用）。完整语义见 docs/MODEL_SDK_API.md。
 * 左右一律按人仰躺在床上的左右侧。
 *
 * @typedef {'left' | 'right'} Side
 * @typedef {'idle' | 'inflating' | 'deflating' | 'adjusting' | 'fault'} AirStatus
 * @typedef {'off' | 'heating' | 'holding' | 'fault'} HeatingStatus
 * @typedef {'auto' | 'native' | 'eco' | 'balanced' | 'high'} PerformanceMode
 *
 * @typedef {object} ViewerOptions
 * @property {object[]} [profiles] 额外注册的声明式型号配置
 * @property {number} [pixelRatio] 设备像素比上限
 * @property {PerformanceMode} [performanceMode] 默认 'auto'（所有设备 native）
 * @property {boolean} [reducedMotion] 覆盖系统“减少动态效果”设置
 *
 * @typedef {object} CallOptions
 * @property {string} [modelToken] setModel 返回的标记；与当前型号不一致时抛出 STALE_MODEL
 * @property {number} [sequence] App 侧递增序号，用于发现断序
 *
 * @typedef {object} AirState
 * @property {number | null} [value] 型号区域 range 内的展示级别（默认 0–100，不等于 kPa）；null 表示未知
 * @property {AirStatus} [status]
 *
 * @typedef {object} Pose
 * @property {number | null} [back] 背部实际角度（度，0–65）
 * @property {number | null} [leg] 腿部实际角度（度，0–35）
 *
 * @typedef {{ angle: number, degreesPerSecond: number }} PoseTarget
 * @typedef {{ back?: PoseTarget, leg?: PoseTarget }} PoseTargets
 * @typedef {{ actionId: string, durationMs: number }} MotionHandle
 *
 * @typedef {object} ModelInfo
 * @property {string} id
 * @property {string} name
 * @property {number} revision
 * @property {string} status
 * @property {string | null} configurationNote
 * @property {string} modelToken 加载版本标记，不是设备绑定
 * @property {string} input
 * @property {object[]} regions 可调节区域（含 id、range）
 * @property {object[]} heating
 * @property {object[]} massage
 * @property {number} airbagCount
 * @property {number} airRowCount
 * @property {{ left: number, right: number } | null} waistCircuits 仅潮汐型号
 * @property {object[]} adjustmentGroups
 * @property {number} massageCellCount
 */

export class MattressViewer {
  /**
   * @param {HTMLElement} container 有限宽高的模型容器
   * @param {ViewerOptions} [options]
   */
  constructor(
    container,
    { profiles = [], pixelRatio, performanceMode = 'auto', reducedMotion } = {},
  ) {
    if (!container?.appendChild) throw sdkError('INVALID_CONTAINER', '需要模型容器');
    this.container = container;
    this.registry = new ModelRegistry(profiles);
    this.listeners = new Map();
    this.generation = 0;
    this.bundle = null;
    this.disposed = false;
    this.suspended = false;
    this.raf = 0;
    this.dirty = true;
    this.frames = 0;
    this.lastFrame = 0;
    this.actionCounter = 0;
    this.viewMode = 'solid';
    this.animationOwner = 'auto';
    this.animationPaused = false;
    this.timeOffset = 0;
    this.pauseAt = 0;
    this.follow = true;
    this.cameraFlight = null;
    this.revealOverride = null;
    this.sideReveals = null;
    this.scanFlights = new Map();
    this.highlightOverride = null;
    this.heatMoving = true;
    this.poseSpeed = 1;
    this.airMotions = new Map();
    this.airHolds = new Map();
    this.poseMotions = new Map();
    this.poseHolds = new Map();
    this.mobile = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
    this.pixelRatioLimit = pixelRatio;
    this.budget = renderBudget(performanceMode, this.mobile, pixelRatio);
    this.backgroundOffset = 0;
    this.backgroundAt = null;
    this.appVisible = true;
    this.inViewport = true;
    this.pageHidden = document.hidden;
    this.lastFrameMs = 0;
    this.presentationWaiters = new Set();
    this.scheduler = new RenderScheduler((t) => {
      try {
        this.frame(t);
      } catch (error) {
        this.cancelPresentation('RENDER_FAILED');
        this.suspend();
        this.emit('viewer.error', { code: 'RENDER_FAILED', message: error.message });
      }
    }, this.budget.maxFps);
    this.media = matchMedia('(prefers-reduced-motion: reduce)');
    this.motionOverride = reducedMotion;
    this.onMotionChange = () => {
      if (this.bundle)
        this.bundle.director.reducedMotion = this.motionOverride ?? this.media.matches;
      this.invalidate();
    };
    this.media.addEventListener('change', this.onMotionChange);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#10191d');
    this.scene.fog = new THREE.FogExp2(0x111a1d, 0.075);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'default',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.budget.pixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = this.budget.shadows;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.perspective = new THREE.PerspectiveCamera(38, 1, 0.05, 80);
    this.ortho = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.05, 80);
    this.activeCamera = this.perspective;
    this.activeCamera.position.set(3.1, 2.35, 3.8);
    this.controls = new OrbitControls(this.activeCamera, this.renderer.domElement);
    this.controls.target.set(0, 0.52, -0.03);
    this.controls.enableDamping = false;
    this.controls.minDistance = 1.4;
    this.controls.maxDistance = 10;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.update();
    this.onDrag = () => {
      this.camera.setFollow(false);
      this.camera.cancel();
      this.emit('camera.userControl', {});
    };
    this.onControl = () => this.invalidate();
    this.controls.addEventListener('start', this.onDrag);
    this.controls.addEventListener('change', this.onControl);
    this.scene.add(new THREE.HemisphereLight(0xdaf2f2, 0x18262b, 1.5));
    const key = new THREE.DirectionalLight(0xfff3df, 3);
    key.position.set(2, 5.5, 3);
    key.castShadow = true;
    this.keyLight = key;
    key.shadow.mapSize.set(this.budget.shadowSize, this.budget.shadowSize);
    key.shadow.normalBias = 0.018;
    key.shadow.bias = -0.0002;
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 });
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x8fceff, 1.8);
    fill.position.set(-3, 2.8, -2);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0x7ce4c8, 1.8);
    rim.position.set(2, 1, -3);
    this.scene.add(rim);
    const pmrem = new THREE.PMREMGenerator(this.renderer),
      room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.55;
    room.dispose();
    pmrem.dispose();
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x070c0e, metalness: 0.1, roughness: 0.85 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.006;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    this.grid = new THREE.GridHelper(14, 70, 0x3a5357, 0x243538);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.19;
    this.scene.add(this.grid);
    this.camera = this.cameraAPI();
    this.animation = this.animationAPI();
    this.effects = this.effectsAPI();
    this.adjustment = {
      begin: (ids, options) => this.setAdjustmentStatus(ids, 'adjusting', options),
      end: (ids, options) => this.setAdjustmentStatus(ids, 'idle', options),
      cancel: (ids, options) => this.setAdjustmentStatus(ids, 'idle', options),
    };
    this.body = {
      setState: (id, state, options = {}) => {
        this.assertReady();
        const group = this.getModelInfo().adjustmentGroups.find((g) => g.id === id);
        if (!group) throw sdkError('UNKNOWN_REGION', '未知人体部位');
        return this.updateDeviceState(
          { air: Object.fromEntries((group.circuitIds || [id]).map((c) => [c, state])) },
          { ...options, normalized: true },
        );
      },
    };
    this.tidal = {
      setWaistCircuit: (side, circuit, options = {}) =>
        this.setWaistCircuit(side, circuit, options),
    };
    this.air = {
      moveTo: (id, options = {}) => this.moveAir(id, options),
      stop: (id) => this.stopAir(id),
    };
    this.pose = { moveTo: (targets) => this.movePose(targets), stop: (key) => this.stopPose(key) };
    this.heating = {
      setState: (id, state, options = {}) =>
        this.updateDeviceState({ heating: { [id]: state } }, { ...options, normalized: true }),
    };
    this.massage = {
      setState: (side, state, options = {}) =>
        this.updateDeviceState({ massage: { [side]: state } }, { ...options, normalized: true }),
    };
    this.view = {
      setMode: (mode) => {
        this.assertReady();
        if (!['solid', 'xray', 'explode', 'mechanism', 'headboard'].includes(mode))
          throw sdkError('INVALID_VIEW', '未知结构视图');
        this.viewMode = mode;
        this.bundle.bed.selectedLayer = null;
        this.revealOverride = null;
        this.invalidate();
      },
      focusLayer: (id) => {
        this.assertReady();
        const b = this.bundle;
        if (!Object.hasOwn(b.bed.anatomy.entries, id))
          throw sdkError('UNKNOWN_LAYER', '未知结构层');
        this.viewMode = 'explode';
        b.bed.selectedLayer = id;
        this.renderer.shadowMap.needsUpdate = true;
        b.bed.update({ ...b.current, xray: 0, explode: 1, showroom: false });
        this.invalidate();
        const point = b.bed.getLayerAnchor(id);
        return this.camera.setPose({
          target: point.toArray(),
          position: point
            .clone()
            .add(new THREE.Vector3(2, 1.6, 2.5))
            .toArray(),
        });
      },
      setBedStyle: (style) => {
        this.assertReady();
        this.bundle.bed.setSurroundStyle(style);
        this.invalidate();
      },
      setHeadboardStyle: (style) => {
        this.assertReady();
        this.bundle.bed.setHeadboardStyle(style);
        this.invalidate();
      },
    };
    this.onVisibility = () => {
      this.pageHidden = document.hidden;
      this.updateVisibility();
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.intersectionObserver =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            this.inViewport = entries[0].isIntersecting;
            this.updateVisibility();
          });
    this.intersectionObserver?.observe(container);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.onLost = (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.cancelPresentation('CONTEXT_LOST');
      this.suspend();
      this.emit('viewer.error', {
        code: 'CONTEXT_LOST',
        message: '图形上下文丢失，请恢复后提交最新状态',
      });
    };
    this.onRestored = () => {
      this.contextLost = false;
      this.resume();
    };
    /**
     * 订阅事件；type 为 '*' 时接收全部事件。
     * @param {string} type 例如 'model.ready'、'state.applied'、'animation.started'
     * @param {(event: object) => void} fn
     * @returns {() => void} 取消订阅
     */
    this.renderer.domElement.addEventListener('webglcontextlost', this.onLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onRestored);
    this.resize();
  }
  assertAlive() {
    if (this.disposed) throw sdkError('DISPOSED', '组件已销毁');
  }
  assertReady() {
    this.assertAlive();
    if (!this.bundle) throw sdkError('MODEL_NOT_READY', '请先设置型号');
  }
  on(type, fn) {
    this.assertAlive();
    if (typeof fn !== 'function') throw sdkError('INVALID_LISTENER', '事件订阅需要函数');
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  emit(type, detail) {
    for (const fn of [...(this.listeners.get(type) || []), ...(this.listeners.get('*') || [])]) {
      try {
        fn(clone({ type, ...detail }));
      } catch (error) {
        console.error('Model event listener:', error);
        /**
         * 原子切换型号；同型号换设备也要重新调用。旧 modelToken 随之失效。
         * @param {string} id 'T11+' / 't11-plus' / 'T12' / 't12' / 'generic' 或已注册的型号
         * @returns {Promise<ModelInfo>}
         */
      }
    }
  }
  listModels() {
    return this.registry.list();
  }
  registerModel(profile) {
    this.assertAlive();
    const p = this.registry.register(profile);
    return { id: p.id, revision: p.revision };
  }
  async setModel(id) {
    this.assertAlive();
    const profile = this.registry.resolve(id),
      ticket = ++this.generation;
    this.cancelPresentation('MODEL_SUPERSEDED');
    this.emit('model.loading', { id: profile.id });
    await prepareBrandArtwork();
    this.assertAlive();
    if (ticket !== this.generation) throw sdkError('MODEL_SUPERSEDED', '已被后续型号请求替代');
    const library = new MaterialLibrary(this.renderer, () => {}, {
      maxAnisotropy: this.budget.anisotropy,
    });
    let next = { library };
    try {
      library.applyCollection(profile.appearance.collection);
      library.setModelLabel(profile.appearance.modelLabel);
      const loads = [];
      for (const [part, settings] of Object.entries(profile.appearance.materials || {})) {
        const { pattern, maps, ...values } = settings;
        if (pattern !== undefined) library.setPattern(part, pattern);
        library.update(part, values);
        for (const [slot, url] of Object.entries(maps || {}))
          loads.push(library.replace(part, slot, url));
      }
      const results = await Promise.allSettled(loads);
      if (results.some((r) => r.status === 'rejected'))
        throw sdkError('ASSET_LOAD_FAILED', '型号贴图加载失败');
      this.assertAlive();
      if (ticket !== this.generation) throw sdkError('MODEL_SUPERSEDED', '已被后续型号请求替代');
      const bed = new SmartBed(library, {
        airbags: profile.airbags,
        coverStyle: profile.appearance.coverStyle,
        massage: profile.massage,
      });
      next.bed = bed;
      bed.setSurroundStyle(profile.appearance.bedStyle);
      bed.setHeadboardStyle(profile.appearance.headboard);
      bed.setWaistband(profile.appearance.waistband);
      bed.setSurroundAccents(profile.appearance.surroundAccents);
      const mark = bed.branding.find((m) => m.material === library.get('modelMark'));
      mark.name = `Mattress_Model_${profile.id}`;
      mark.userData.text = profile.appearance.modelLabel;
      mark.userData.artwork = 'profile model label';
      bed.coverReveal.uniforms.revealOpacity.value = profile.presentation.coverOpacity;

      next = {
        ...next,
        waist: { left: 4, right: 4 },
        profile,
        air: new FirmnessEffect(profile.airbags),
        heat: new HeatingEffect(profile.heating, profile.airbags, bed.surfaceTop),
        massage: new MassageEffect(profile.massage, profile.airbags, bed.surfaceTop),
        massageMotion: new MassageMotion(profile.massage),
        store: new DeviceState(profile),
        director: new DevicePresentation(profile.presentation),
        modelToken: `model-${ticket}`,
      };
      next.current = { ...next.store.targets(), massage: next.massageMotion.snapshot() };
      next.reveal = closed();
      next.director.follow = this.follow;
      next.director.reducedMotion = this.motionOverride ?? this.media.matches;
      bed.update({ ...next.current, xray: 0, explode: 0, showroom: true, airReveal: next.reveal });
      const previous = this.bundle;
      this.camera.cancel();
      this.cancelScan();
      this.airMotions.clear();
      this.airHolds.clear();
      this.poseMotions.clear();
      this.poseHolds.clear();
      this.bundle = next;
      this.viewMode = 'solid';
      this.revealOverride = null;
      this.sideReveals = null;
      this.highlightOverride = null;
      this.animationOwner = 'auto';
      if (previous)
        this.scene.remove(
          previous.bed.root,
          previous.air.root,
          previous.heat.root,
          previous.massage.root,
        );
      this.scene.add(bed.root, next.air.root, next.heat.root, next.massage.root);
      release(previous);
      this.fitCamera(0, false);
      this.invalidate();
      /** @returns {ModelInfo} 当前型号、能力与区域定义的只读副本 */
      const info = this.getModelInfo();
      this.emit('model.ready', info);
      return info;
    } catch (error) {
      release(next);
      this.emit('viewer.error', {
        code: error.code || 'MODEL_LOAD_FAILED',
        message: error.message,
      });
      throw error;
    }
  }
  getModelInfo() {
    this.assertReady();
    const { profile, modelToken } = this.bundle;
    return clone({
      id: profile.id,
      name: profile.name,
      revision: profile.revision,
      status: profile.status,
      configurationNote: profile.configurationNote ?? null,
      modelToken,
      input: profile.input.format,
      regions: profile.regions,
      heating: profile.heating,
      massage: profile.massage,
      airbagCount: profile.airbags.reduce((n, b) => n + (b.cellCount || 1), 0),
      airRowCount: profile.airbags.length,
      waistCircuits: profile.tidal ? this.bundle.waist : null,
      /**
       * 批量写入 App 已解析的设备状态（air / heating / massage / pose / online 等）。
       * @param {object} payload
       * @param {CallOptions & { kind?: 'patch' | 'snapshot' }} [options] 首次默认 snapshot，之后默认 patch
       */
      adjustmentGroups: profile.tidal
        ? [
            ...tidalGroups('right', this.bundle.waist.right),
            ...tidalGroups('left', this.bundle.waist.left),
          ]
        : profile.regions,
      massageCellCount: profile.massage.reduce(
        (n, c) => n + c.pads.reduce((m, p) => m + p.cells.length, 0),
        0,
      ),
    });
  }
  updateDeviceState(payload, options = {}) {
    this.assertReady();
    if (options.modelToken !== undefined && options.modelToken !== this.bundle.modelToken)
      throw sdkError('STALE_MODEL', '上报属于已切换的模型');
    const wasMassaging = Object.values(this.bundle.store.state.massage).some((s) =>
      ['running', 'paused'].includes(s.status),
    );
    try {
      const result = this.bundle.store.apply(payload, options);
      if (!result.ignored) {
        if (options.normalized && payload.air)
          for (const id of Object.keys(payload.air)) this.stopAir(id, { silent: true });
        if (options.normalized && payload.pose)
          for (const key of Object.keys(payload.pose)) this.stopPose(key, { silent: true });
        const started = Object.entries(this.bundle.store.state.massage).filter(
          ([, s]) => s.status === 'running',
        );
        if (
          !wasMassaging &&
          started.length === 1 &&
          this.follow &&
          this.animationOwner === 'auto' &&
          !this.bundle.store.activeRegions().length &&
          !this.airMotions.size
        )
          this.focusSide(started[0][0], false, 1800);
        this.invalidate();
        this.emit('state.applied', {
          modelToken: this.bundle.modelToken,
          /**
           * T12 潮汐腰部：选择 3/4/5 路作为腰部，左右独立。
           * @param {Side} side
           * @param {3 | 4 | 5} circuit
           * @param {CallOptions} [options]
           * @returns {ModelInfo}
           */
          sequence: this.bundle.store.sequence,
        });
      }
      return result;
    } catch (error) {
      this.emit(error.code === 'RESYNC_REQUIRED' ? 'state.resyncRequired' : 'viewer.error', {
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    /**
     * @param {string} id 区域 ID，例如 'left.lumbar'、'right.circuit4'
     * @param {AirState} state
     * @param {CallOptions} [options]
     */
  }
  setWaistCircuit(side, circuit, options = {}) {
    this.assertReady();
    /**
     * 上报床体实际角度；会接管同一部位的视觉运动。
     * @param {Pose} pose
     * @param {CallOptions} [options]
     */
    const b = this.bundle;
    if (options.modelToken !== undefined && options.modelToken !== b.modelToken)
      throw sdkError('STALE_MODEL', '型号已切换');
    if (!b.profile.tidal) throw sdkError('UNSUPPORTED_TIDAL', '当前型号不支持潮汐腰部');
    tidalGroups(side, circuit);
    b.waist[side] = circuit;
    this.emit('model.mappingChanged', { modelToken: b.modelToken, side, circuit });
    return this.getModelInfo();
    /**
     * 仅用于预览的气囊匀速视觉运动，不发送设备命令。
     * @param {string} id
     * @param {{ target: number, ratePerSecond: number }} motion
     * @returns {MotionHandle}
     */
  }
  setAirState(id, state, options = {}) {
    return this.updateDeviceState({ air: { [id]: state } }, { ...options, normalized: true });
  }
  setPose(pose, options = {}) {
    return this.updateDeviceState({ pose }, { ...options, normalized: true });
  }
  regionDisplayValue(region) {
    const bag = this.bundle.profile.airbags.find((item) => item.regionId === region.id),
      amount = this.bundle.current.pressures[bag.side][bag.zone] / 100;
    return region.range[0] + amount * (region.range[1] - region.range[0]);
  }
  moveAir(id, { target, ratePerSecond } = {}) {
    this.assertReady();
    const region = this.bundle.profile.regions.find((item) => item.id === id);
    if (
      !region ||
      !Number.isFinite(target) ||
      target < region.range[0] ||
      target > region.range[1] ||
      !Number.isFinite(ratePerSecond) ||
      ratePerSecond <= 0 ||
      ratePerSecond > 1000
    )
      throw sdkError('INVALID_MOTION', '气囊目标值或速度无效');
    const start = this.regionDisplayValue(region),
      idAction = `air-${++this.actionCounter}`,
      durationMs = (Math.abs(target - start) / ratePerSecond) * 1000;
    this.airHolds.set(id, target);
    this.airMotions.set(id, { id: idAction, region, target, ratePerSecond, value: start });
    this.invalidate();
    this.emit('animation.started', {
      kind: 'air-motion',
      actionId: idAction,
      regionId: id,
      target,
      /**
       * 仅用于预览的床体匀速视觉运动，不发送设备命令。
       * @param {PoseTargets} targets
       * @returns {{ back?: MotionHandle, leg?: MotionHandle }}
       */
      ratePerSecond,
    });
    return { actionId: idAction, durationMs };
  }
  stopAir(id, { silent = false } = {}) {
    const motion = this.airMotions.get(id);
    this.airMotions.delete(id);
    this.airHolds.delete(id);
    if (motion && !silent)
      this.emit('animation.cancelled', { kind: 'air-motion', actionId: motion.id, regionId: id });
    this.invalidate();
  }
  movePose(targets) {
    this.assertReady();
    if (!targets || typeof targets !== 'object')
      throw sdkError('INVALID_MOTION', '床体运动参数无效');
    const result = {};
    for (const key of ['back', 'leg'])
      if (targets[key] !== undefined) {
        const { angle, degreesPerSecond } = targets[key] || {},
          max = key === 'back' ? 65 : 35;
        if (
          !Number.isFinite(angle) ||
          angle < 0 ||
          angle > max ||
          !Number.isFinite(degreesPerSecond) ||
          degreesPerSecond <= 0 ||
          degreesPerSecond > 30
        )
          throw sdkError('INVALID_MOTION', '床体角度或速度无效');
        const start = this.bundle.current[key],
          id = `pose-${++this.actionCounter}`,
          durationMs = (Math.abs(angle - start) / degreesPerSecond) * 1000;
        this.poseHolds.set(key, angle);
        this.poseMotions.set(key, { id, key, target: angle, rate: degreesPerSecond, value: start });
        result[key] = { actionId: id, durationMs };
        this.emit('animation.started', {
          kind: 'pose-motion',
          actionId: id,
          part: key,
          target: angle,
          degreesPerSecond,
        });
      }
    if (!Object.keys(result).length) throw sdkError('INVALID_MOTION', '请至少设置背部或腿部');
    this.invalidate();
    return result;
    /**
     * @param {string[]} ids
     * @param {AirStatus} status
     * @param {CallOptions} [options]
     */
  }
  stopPose(key, { silent = false } = {}) {
    for (const part of ['back', 'leg'])
      if (!key || part === key) {
        const motion = this.poseMotions.get(part);
        this.poseMotions.delete(part);
        this.poseHolds.delete(part);
        if (motion && !silent)
          this.emit('animation.cancelled', { kind: 'pose-motion', actionId: motion.id, part });
        /** @param {boolean} online 设备数据是否可用（离线 ≠ 页面隐藏） */
      }
    this.invalidate();
  }
  setAdjustmentStatus(ids, status, options = {}) {
    this.assertReady();
    if (!Array.isArray(ids) || !ids.length)
      throw sdkError('UNKNOWN_REGION', '请传入调节区域 ID 列表');
    return this.updateDeviceState(
      { air: Object.fromEntries(ids.map((id) => [id, { status }])) },
      { ...options, normalized: true },
    );
  }
  setDataAvailable(online) {
    this.assertReady();
    if (typeof online !== 'boolean') throw sdkError('INVALID_STATE', '数据可用状态必须为布尔值');
    this.bundle.store.state.online = online;
    this.invalidate();
    this.emit('state.applied', { modelToken: this.bundle.modelToken });
  }
  setInteractionEnabled(enabled) {
    this.assertAlive();
    this.controls.enabled = !!enabled;
  }
  getState() {
    this.assertReady();
    return clone({
      model: this.getModelInfo(),
      observed: this.bundle.store.snapshot(),
      rendered: this.bundle.current,
      reveal: this.sideReveals ? { sides: this.sideReveals } : this.bundle.reveal,
      view: this.viewMode,
      animationPaused: this.animationPaused,
      camera: {
        position: this.activeCamera.position.toArray(),
        target: this.controls.target.toArray(),
        projection: this.activeCamera.type,
        follow: this.follow,
      },
      motion: {
        poseSpeed: this.poseSpeed,
        air: [...this.airMotions.values()].map(({ id, region, target, ratePerSecond, value }) => ({
          id,
          regionId: region.id,
          target,
          ratePerSecond,
          value,
        })),
        airTargets: Object.fromEntries(this.airHolds),
        pose: [...this.poseMotions.values()].map(({ id, key, target, rate, value }) => ({
          id,
          key,
          target,
          rate,
          value,
        })),
        poseTargets: Object.fromEntries(this.poseHolds),
      },
      renderCount: this.frames,
      suspended: this.suspended,
    });
  }
  requestPresentation({ presentationRevision, modelToken } = {}) {
    this.assertReady();
    if (this.contextLost) throw sdkError('CONTEXT_LOST', '图形上下文尚未恢复');
    if (!Number.isSafeInteger(presentationRevision) || presentationRevision < 0)
      throw sdkError('INVALID_REQUEST', 'presentationRevision 必须为非负安全整数');
    if (modelToken !== this.bundle.modelToken) throw sdkError('STALE_MODEL', '呈现请求属于旧型号');
    const promise = new Promise((resolve, reject) =>
      this.presentationWaiters.add({ presentationRevision, modelToken, resolve, reject }),
    );
    this.invalidate();
    return promise;
  }
  cancelPresentation(code) {
    for (const pending of this.presentationWaiters || []) {
      pending.reject(sdkError(code, '呈现等待已取消'));
    }
    this.presentationWaiters?.clear();
  }
  completePresentation() {
    for (const pending of this.presentationWaiters || []) {
      if (pending.modelToken === this.bundle?.modelToken)
        pending.resolve({
          modelToken: pending.modelToken,
          presentationRevision: pending.presentationRevision,
        });
      else pending.reject(sdkError('STALE_MODEL', '呈现请求属于旧型号'));
    }
    this.presentationWaiters?.clear();
  }
  activeTime(now = performance.now()) {
    return (this.backgroundAt ?? now) - (this.backgroundOffset || 0);
  }
  clock() {
    return (this.animationPaused ? this.pauseAt : this.activeTime()) - this.timeOffset;
  }
  invalidate() {
    this.dirty = true;
    if (!this.suspended && !this.disposed) this.scheduler.request();
  }
  frame(now) {
    this.raf = 0;
    if (this.suspended || this.disposed || this.backgroundAt != null) return;
    const frameStart = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = now;
    let moving = false;
    if (this.bundle) {
      const b = this.bundle,
        t = this.clock(),
        deviceActive = b.store.activeRegions(),
        motionActive = [...this.airMotions.values()].map((motion) => motion.region),
        active = [
          ...new Map(
            [...deviceActive, ...motionActive].map((region) => [region.id, region]),
          ).values(),
        ];
      b.director.active = active;
      b.director.reducedMotion = this.motionOverride ?? this.media.matches;
      if (!this.animationPaused && this.animationOwner === 'auto') {
        const flight = b.director.reconcile(active, t);
        if (flight && this.follow) {
          const region = active.find((r) => (r.side === 1 ? 'left' : 'right') === flight.side);
          if (region) this.focusSide(flight.side, false, b.profile.presentation.flightMs);
        }
        const previous = b.reveal;
        b.reveal = b.director.tick(t);
        if (previous.side && previous.side !== b.reveal.side)
          this.emit('animation.completed', {
            kind: 'adjustment-presentation',
            side: previous.side,
            modelToken: b.modelToken,
          });
        if (b.reveal.side && previous.side !== b.reveal.side)
          this.emit('animation.started', {
            kind: 'adjustment-presentation',
            side: b.reveal.side,
            modelToken: b.modelToken,
          });
        if (previous.phase !== b.reveal.phase)
          this.emit('animation.phase', {
            phase: b.reveal.phase,
            side: b.reveal.side,
            modelToken: b.modelToken,
          });
      }
      if (this.scanFlights.size && !this.animationPaused) {
        this.sideReveals ??= { left: closed(), right: closed() };
        for (const [side, f] of [...this.scanFlights]) {
          const k = Math.min(1, (t - f.start) / Math.max(1, f.duration)),
            progress = f.from + (f.to - f.from) * k;
          this.sideReveals[side] = {
            side,
            progress,
            phase: k === 1 ? (f.to ? 'adjust' : 'closed') : f.to ? 'scan' : 'closing',
            ready: true,
          };
          if (k === 1) {
            this.scanFlights.delete(side);
            this.emit('animation.completed', { kind: 'scan', side, actionId: f.id });
          } else moving = true;
        }
      }
      if (this.revealOverride) b.reveal = { ...this.revealOverride, ready: true };
      const desired = b.store.targets(b.current);
      if (!this.animationPaused) {
        const ease = (this.motionOverride ?? this.media.matches) ? 1 : 1 - Math.exp(-dt * 7);
        const poseEase =
          (this.motionOverride ?? this.media.matches) ? 1 : 1 - Math.exp(-dt * 7 * this.poseSpeed);
        for (const key of ['back', 'leg']) {
          if (this.poseMotions.has(key) || this.poseHolds.has(key)) continue;
          const delta = desired[key] - b.current[key];
          if (Math.abs(delta) > 0.0002) {
            b.current[key] += delta * poseEase;
            moving = true;
          } else b.current[key] = desired[key];
        }
        for (const key of ['pressures', 'heating'])
          for (let s = 0; s < 2; s++)
            for (let z = 0; z < desired[key][s].length; z++) {
              const bag =
                key === 'pressures'
                  ? b.profile.airbags.find((item) => item.side === s && item.zone === z)
                  : null;
              if (bag && (this.airMotions.has(bag.regionId) || this.airHolds.has(bag.regionId)))
                continue;
              const delta = desired[key][s][z] - b.current[key][s][z];
              if (Math.abs(delta) > 0.001) {
                b.current[key][s][z] += delta * ease;
                moving = true;
              } else b.current[key][s][z] = desired[key][s][z];
            }
        for (const [id, motion] of [...this.airMotions]) {
          const delta = motion.target - motion.value,
            step = Math.min(Math.abs(delta), motion.ratePerSecond * dt) * Math.sign(delta);
          motion.value += step;
          const [min, max] = motion.region.range,
            amount = (motion.value - min) / (max - min);
          for (const bag of b.profile.airbags)
            if (bag.regionId === id) b.current.pressures[bag.side][bag.zone] = amount * 100;
          if (Math.abs(motion.target - motion.value) < 0.00001) {
            motion.value = motion.target;
            this.airMotions.delete(id);
            this.emit('animation.completed', {
              kind: 'air-motion',
              actionId: motion.id,
              regionId: id,
              target: motion.target,
            });
          } else moving = true;
        }
        for (const [key, motion] of [...this.poseMotions]) {
          const delta = motion.target - motion.value,
            step = Math.min(Math.abs(delta), motion.rate * dt) * Math.sign(delta);
          motion.value += step;
          b.current[key] = motion.value;
          if (Math.abs(motion.target - motion.value) < 0.00001) {
            motion.value = motion.target;
            this.poseMotions.delete(key);
            this.emit('animation.completed', {
              kind: 'pose-motion',
              actionId: motion.id,
              part: key,
              target: motion.target,
            });
          } else moving = true;
        }
      }
      const presentationReveal = this.sideReveals ? { sides: this.sideReveals } : b.reveal,
        reveal = this.viewMode === 'solid' ? presentationReveal : closed(),
        effectMoving =
          !this.animationPaused &&
          !(this.motionOverride ?? this.media.matches) &&
          b.store.state.online;
      const massageMoving = b.massageMotion.step(b.store.state.massage, dt, {
        paused: this.animationPaused,
        online: b.store.state.online,
        reducedMotion: this.motionOverride ?? this.media.matches,
      });
      b.current.massage = b.massageMotion.snapshot();
      this.floor.visible = !(b.air.root.visible || b.store.initialized);
      const shadowKey = JSON.stringify([
        b.current.back,
        b.current.leg,
        b.current.massage,
        this.viewMode,
        b.bed.surroundStyle,
        b.bed.headboardStyle,
        b.bed.selectedLayer,
        visibleRevealKey(reveal),
        this.viewMode === 'solid' ? null : b.current.pressures,
      ]);
      if (shadowKey !== b.shadowKey) {
        this.renderer.shadowMap.needsUpdate = true;
        b.shadowKey = shadowKey;
      }
      b.bed.update({
        ...b.current,
        xray: this.viewMode === 'xray' ? 1 : 0,
        explode: this.viewMode === 'explode' ? 1 : 0,
        mechanism: this.viewMode === 'mechanism',
        headboardOnly: this.viewMode === 'headboard',
        showroom: this.viewMode === 'solid',
        airReveal: reveal,
      });
      const visibleSides = this.sideReveals
        ? Object.values(this.sideReveals).filter((v) =>
            ['scan', 'adjust', 'closing'].includes(v.phase),
          )
        : ['scan', 'adjust', 'closing'].includes(reveal.phase)
          ? [reveal]
          : [];
      // Adjustment is shown by the cover reveal and pouch motion, without flashing overlays.
      b.air.root.visible = false;
      const visibleSideNames = new Set(visibleSides.map((item) => item.side));
      const renderedActive = this.sideReveals
        ? active
            .filter((region) => visibleSideNames.has(region.side === 1 ? 'left' : 'right'))
            .map((region) => region.id)
        : b.director.selection().activeRegionIds;
      const selection = {
        ...b.director.selection(),
        side: visibleSides.length === 2 ? 'both' : (visibleSides[0]?.side ?? null),
        activeRegionIds: this.highlightOverride ?? renderedActive,
      };
      b.air.update({
        spine: b.bed.spine,
        pressures: b.current.pressures,
        selection,
        time: t / 1000,
        moving: effectMoving && active.length > 0,
        airStates: b.store.state.air,
      });
      b.heat.root.visible =
        ['solid', 'xray'].includes(this.viewMode) && b.current.heating.flat().some((v) => v > 0);
      const thermalMoving =
        effectMoving &&
        this.heatMoving &&
        Object.values(b.store.state.heating).some((h) => h.status === 'heating');
      b.heat.update({
        massageChannels: b.profile.massage,
        spine: b.bed.spine,
        ...b.current,
        time: t / 1000,
        moving: thermalMoving,
      });
      b.massage.root.visible =
        ['solid', 'xray'].includes(this.viewMode) &&
        Object.values(b.current.massage).some((s) => s.amount > 0.001);
      b.massage.update({
        spine: b.bed.spine,
        pressures: b.current.pressures,
        lanes: b.current.massage,
      });
      moving ||= massageMoving && b.massage.root.visible;
      moving ||=
        !this.animationPaused &&
        ((this.animationOwner === 'auto' &&
          ['camera', 'scan', 'closing'].includes(b.reveal.phase)) ||
          (effectMoving && b.air.root.visible && active.length > 0) ||
          (thermalMoving && b.heat.root.visible) ||
          this.scanFlights.size > 0 ||
          this.airMotions.size > 0 ||
          this.poseMotions.size > 0);
    }
    if (this.cameraFlight && !this.cameraFlight.paused) {
      const f = this.cameraFlight,
        k =
          (this.motionOverride ?? this.media.matches)
            ? 1
            : Math.min(1, (this.activeTime(now) - f.start) / Math.max(1, f.duration)),
        ease = k * k * (3 - 2 * k);
      this.controls.target.lerpVectors(f.fromTarget, f.target, ease);
      const sphere = new THREE.Spherical(
        THREE.MathUtils.lerp(f.from.radius, f.to.radius, ease),
        THREE.MathUtils.lerp(f.from.phi, f.to.phi, ease),
        THREE.MathUtils.lerp(f.from.theta, f.to.theta, ease),
      );
      this.activeCamera.position
        .copy(this.controls.target)
        .add(new THREE.Vector3().setFromSpherical(sphere));
      if (k === 1) {
        this.cameraFlight = null;
        this.emit('camera.completed', { actionId: f.id });
      } else moving = true;
    }
    this.controls.update(dt);
    moving ||= this.controls.autoRotate;
    this.renderer.render(this.scene, this.activeCamera);
    this.completePresentation();
    this.frames++;
    this.dirty = false;
    this.lastFrameMs = performance.now() - frameStart;
    if (this.bundle && this.presentedToken !== this.bundle.modelToken) {
      this.presentedToken = this.bundle.modelToken;
      this.emit('model.presented', { modelToken: this.bundle.modelToken });
    }
    if (moving) this.invalidate();
  }
  transition(position, target, duration = 1000) {
    this.assertAlive();
    if (
      !validVector(position) ||
      !validVector(target) ||
      !Number.isFinite(duration) ||
      duration < 0 ||
      duration > 10000
    )
      throw sdkError('INVALID_CAMERA', '相机位置或时长无效');
    const destination = new THREE.Vector3(...position),
      focus = new THREE.Vector3(...target);
    if (destination.distanceTo(focus) < 0.2 || destination.distanceTo(focus) > 30)
      throw sdkError('INVALID_CAMERA', '相机距离超出范围');
    this.camera.cancel();
    this.controls.autoRotate = false;
    const from = new THREE.Spherical().setFromVector3(
        this.activeCamera.position.clone().sub(this.controls.target),
      ),
      to = new THREE.Spherical().setFromVector3(destination.sub(focus));
    to.theta = shortestAngle(from.theta, to.theta);
    const id = `camera-${++this.actionCounter}`;
    this.cameraFlight = {
      id,
      start: this.activeTime(),
      duration: (this.motionOverride ?? this.media.matches) ? 0 : duration,
      from,
      to,
      fromTarget: this.controls.target.clone(),
      target: focus,
    };
    this.invalidate();
    return { actionId: id };
  }
  focus(id, manual = true, duration = 1000) {
    this.assertReady();
    const region =
      this.bundle.profile.regions.find((r) => r.id === id) ||
      this.bundle.profile.heating.find((r) => r.id === id);
    if (!region) throw sdkError('UNKNOWN_REGION', '未知聚焦区域');
    if (manual) this.camera.setFollow(false);
    this.useCamera(this.perspective);
    const bags = this.bundle.profile.airbags.filter((b) => b.regionId === id),
      z = bags.length ? bags.reduce((a, b) => a + b.z, 0) / bags.length : region.z,
      sign = region.side === 0 ? -1 : 1;
    // Keep the foot-corner angle while gently pushing toward the active zone.
    const target = [sign * 0.15, 0.58, z * 0.38],
      radius = Math.max(4.35, 3.9 / Math.max(0.3, this.perspective.aspect)),
      polar = Math.PI / 3,
      theta = sign * 0.98;
    return this.transition(
      [
        target[0] + radius * Math.sin(polar) * Math.sin(theta),
        target[1] + radius * Math.cos(polar),
        target[2] + radius * Math.sin(polar) * Math.cos(theta),
      ],
      target,
      duration,
    );
  }
  focusSide(side, manual = true, duration = 1000) {
    this.assertReady();
    if (!['left', 'right'].includes(side)) throw sdkError('INVALID_CAMERA', '人体侧别无效');
    if (manual) this.camera.setFollow(false);
    this.useCamera(this.perspective);
    const sign = side === 'left' ? 1 : -1,
      target = [sign * 0.12, 0.52, 0.08],
      radius = Math.max(3.85, 3.6 / Math.max(0.3, this.perspective.aspect)),
      elevation = Math.PI / 6,
      azimuth = THREE.MathUtils.degToRad(70);
    // +Z is the foot; rotation and the initial push-in share one camera flight.
    return this.transition(
      [
        target[0] + sign * radius * Math.cos(elevation) * Math.sin(azimuth),
        target[1] + radius * Math.sin(elevation),
        target[2] + radius * Math.cos(elevation) * Math.cos(azimuth),
      ],
      target,
      duration,
    );
  }
  useCamera(camera) {
    if (this.activeCamera === camera) return;
    camera.position.copy(this.activeCamera.position);
    this.activeCamera = camera;
    this.controls.object = camera;
    this.resize();
  }
  fitCamera(duration = 1000, manual = true) {
    this.assertReady();
    if (manual) this.camera.setFollow(false);
    this.useCamera(this.perspective);
    this.perspective.zoom = 1;
    this.perspective.updateProjectionMatrix();
    const bounds = new THREE.Box3();
    this.bundle.bed.root.updateMatrixWorld(true);
    this.bundle.bed.root.traverseVisible((o) => {
      if (o.geometry) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        bounds.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      }
    });
    const sphere = bounds.getBoundingSphere(new THREE.Sphere()),
      half = THREE.MathUtils.degToRad(this.perspective.fov / 2),
      angle = Math.min(half, Math.atan(Math.tan(half) * this.perspective.aspect)),
      radius = Math.min(25, (sphere.radius / Math.sin(angle)) * 1.06),
      direction = new THREE.Vector3(3.1, 1.8, 3.8).normalize();
    return this.transition(
      sphere.center.clone().addScaledVector(direction, radius).toArray(),
      sphere.center.toArray(),
      duration,
    );
  }
  cameraAPI() {
    return {
      setFollow: (enabled) => {
        this.follow = !!enabled;
        if (this.follow) this.controls.autoRotate = false;
        if (this.bundle) this.bundle.director.follow = this.follow;
        this.invalidate();
      },
      focusRegion: (id, options = {}) => this.focus(id, true, options.duration ?? 1000),
      focusSide: (side, options = {}) => this.focusSide(side, true, options.duration ?? 1000),
      setPose: ({ position, target, duration = 1000 }) => {
        this.camera.setFollow(false);
        return this.transition(position, target, duration);
      },
      setPreset: (name) => {
        if (name === 'leftFoot') return this.focusSide('left');
        if (name === 'rightFoot') return this.focusSide('right');
        const presets = {
          perspective: [3.1, 2.35, 3.8],
          left: [3.3, 2.5, 2.8],
          right: [-3.3, 2.5, 2.8],
          top: [0, 5.4, -0.029],
          side: [4.6, 0.52, -0.03],
        };
        if (!presets[name]) throw sdkError('INVALID_CAMERA', '未知视角');
        if (name === 'perspective') return this.fitCamera();
        this.camera.setFollow(false);
        this.useCamera(['top', 'side'].includes(name) ? this.ortho : this.perspective);
        this.activeCamera.zoom = 1;
        this.activeCamera.updateProjectionMatrix();
        const target = new THREE.Vector3(0, 0.52, -0.03),
          position = new THREE.Vector3(...presets[name]);
        if (this.activeCamera === this.perspective)
          position
            .sub(target)
            .multiplyScalar(Math.max(1, 1 / this.perspective.aspect))
            .add(target);
        return this.transition(position.toArray(), target.toArray(), name === 'top' ? 0 : 1000);
      },
      fit: () => this.fitCamera(),
      reset: () => this.camera.setPreset('perspective'),
      pause: () => {
        if (this.cameraFlight) {
          this.cameraFlight.paused = this.activeTime();
        }
      },
      resume: () => {
        if (this.cameraFlight?.paused) {
          this.cameraFlight.start += this.activeTime() - this.cameraFlight.paused;
          this.cameraFlight.paused = null;
          this.invalidate();
        }
      },
      cancel: () => {
        if (this.cameraFlight) {
          const id = this.cameraFlight.id;
          this.cameraFlight = null;
          this.emit('camera.cancelled', { actionId: id });
        }
      },
      setAutoRotate: (enabled) => {
        this.camera.setFollow(false);
        this.camera.cancel();
        this.controls.autoRotate = !!enabled;
        this.invalidate();
      },
      setZoom: (zoom) => {
        this.assertAlive();
        if (!Number.isFinite(zoom) || zoom < 0.2 || zoom > 5)
          throw sdkError('INVALID_CAMERA', '缩放范围为 0.2–5');
        this.camera.setFollow(false);
        this.activeCamera.zoom = zoom;
        this.activeCamera.updateProjectionMatrix();
        this.invalidate();
      },
      setPreferredSide: (side) => {
        this.assertReady();
        if (![null, 'left', 'right'].includes(side))
          throw sdkError('INVALID_CAMERA', '焦点侧别无效');
        this.bundle.director.preferred = side;
        this.invalidate();
      },
    };
  }
  animationAPI() {
    return {
      setPolicy: (owner) => {
        if (!['auto', 'app'].includes(owner))
          throw sdkError('CONTROL_CONFLICT', '编排策略应为 auto 或 app');
        this.cancelScan();
        this.animationOwner = owner;
        if (owner === 'auto') {
          this.revealOverride = null;
          this.sideReveals = null;
          this.highlightOverride = null;
        }
        this.invalidate();
      },
      pause: () => {
        if (!this.animationPaused) {
          this.pauseAt = this.activeTime();
          this.animationPaused = true;
          this.invalidate();
        }
      },
      resume: () => {
        if (this.animationPaused) {
          this.timeOffset += this.activeTime() - this.pauseAt;
          this.animationPaused = false;
          this.invalidate();
        }
      },
      cancel: () => {
        this.cancelScan();
        this.animationOwner = 'app';
        this.revealOverride = closed();
        this.sideReveals = { left: closed(), right: closed() };
        this.highlightOverride = [];
        this.invalidate();
        this.emit('animation.cancelled', {});
      },
    };
  }
  cancelScan(side) {
    for (const [key, flight] of [...this.scanFlights])
      if (!side || key === side) {
        this.emit('animation.cancelled', { kind: 'scan', side: key, actionId: flight.id });
        this.scanFlights.delete(key);
      }
  }
  scan(side, to, { duration = this.bundle?.profile.presentation.scanMs ?? 950 } = {}) {
    this.assertReady();
    if (
      !['left', 'right'].includes(side) ||
      !Number.isFinite(duration) ||
      duration < 0 ||
      duration > 5000
    )
      throw sdkError('INVALID_EFFECT', '扫描侧别或时长无效');
    this.cancelScan(side);
    this.animationOwner = 'app';
    this.sideReveals ??= { left: closed(), right: closed() };
    const from = this.sideReveals[side]?.progress || 0,
      id = `scan-${++this.actionCounter}`;
    this.scanFlights.set(side, {
      id,
      side,
      from,
      to,
      start: this.clock(),
      duration: (this.motionOverride ?? this.media.matches) ? 0 : duration,
    });
    this.invalidate();
    this.emit('animation.started', { kind: 'scan', side, actionId: id });
    return { actionId: id };
  }
  effectsAPI() {
    return {
      scanIn: (side, options) => this.scan(side, 1, options),
      scanOut: (side, options) => {
        this.assertReady();
        const target =
          typeof side === 'string'
            ? side
            : this.sideReveals
              ? Object.entries(this.sideReveals).find(([, v]) => v.phase !== 'closed')?.[0]
              : this.bundle.reveal.side;
        if (!target) return { actionId: null };
        return this.scan(target, 0, options || {});
      },
      setReveal: ({ side = null, progress = 0, phase = progress ? 'adjust' : 'closed' }) => {
        this.assertReady();
        if (
          ![null, 'left', 'right', 'both'].includes(side) ||
          !Number.isFinite(progress) ||
          progress < 0 ||
          progress > 1 ||
          !['closed', 'scan', 'adjust', 'closing'].includes(phase) ||
          (phase !== 'closed' && !side)
        )
          throw sdkError('INVALID_EFFECT', '扫描参数无效');
        this.cancelScan();
        this.animationOwner = 'app';
        if (side === 'both') {
          this.sideReveals = {
            left: { side: 'left', progress, phase, ready: true },
            right: { side: 'right', progress, phase, ready: true },
          };
        } else {
          this.sideReveals ??= { left: closed(), right: closed() };
          if (side) this.sideReveals[side] = { side, progress, phase, ready: true };
          else this.sideReveals = { left: closed(), right: closed() };
        }
        this.invalidate();
      },
      setSideReveal: (side, { progress = 0, phase = progress ? 'adjust' : 'closed' } = {}) => {
        this.assertReady();
        if (
          !['left', 'right'].includes(side) ||
          !Number.isFinite(progress) ||
          progress < 0 ||
          progress > 1 ||
          !['closed', 'scan', 'adjust', 'closing'].includes(phase)
        )
          throw sdkError('INVALID_EFFECT', '扫描参数无效');
        this.cancelScan(side);
        this.animationOwner = 'app';
        this.sideReveals ??= { left: closed(), right: closed() };
        /** @param {boolean} visible App 告知模型是否可见；不可见时停绘但保留状态 */
        this.sideReveals[side] = { side, progress, phase, ready: true };
        this.invalidate();
      },
      setHighlight: (ids) => {
        this.assertReady();
        if (
          /** @param {PerformanceMode} mode */
          !Array.isArray(ids) ||
          ids.some((id) => !this.bundle.profile.regions.some((r) => r.id === id))
        )
          throw sdkError('UNKNOWN_REGION', '高亮区域无效');
        this.highlightOverride = [...ids];
        this.invalidate();
      },
      setHeatingStyle: ({ moving = true } = {}) => {
        this.heatMoving = !!moving;
        this.invalidate();
      },
      setPoseSpeed: (speed) => {
        if (!Number.isFinite(speed) || speed < 0.25 || speed > 3)
          throw sdkError('INVALID_MOTION', '床体运动速度范围为 0.25–3');
        this.poseSpeed = speed;
        this.invalidate();
      },
    };
  }
  updateVisibility() {
    const hidden =
      this.pageHidden ||
      !this.appVisible ||
      !this.inViewport ||
      this.container.clientWidth === 0 ||
      this.container.clientHeight === 0;
    const now = performance.now();
    if (hidden && this.backgroundAt === null) {
      this.backgroundAt = now;
      this.scheduler.setBlocked(true);
    } else if (!hidden && this.backgroundAt !== null) {
      this.backgroundOffset += now - this.backgroundAt;
      this.backgroundAt = null;
      this.lastFrame = now;
      this.scheduler.setBlocked(false);
      this.invalidate();
    }
  }
  setVisible(visible) {
    this.assertAlive();
    if (typeof visible !== 'boolean') throw sdkError('INVALID_STATE', '可见状态必须为布尔值');
    this.appVisible = visible;
    this.updateVisibility();
  }
  setPerformanceMode(mode) {
    this.assertAlive();
    const budget = renderBudget(mode, this.mobile, this.pixelRatioLimit);
    this.budget = budget;
    this.scheduler.maxFps = budget.maxFps;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, budget.pixelRatio));
    if (this.renderer.shadowMap.enabled !== budget.shadows)
      this.scene.traverse((object) => {
        for (const material of Array.isArray(object.material)
          ? object.material
          : object.material
            ? [object.material]
            : [])
          material.needsUpdate = true;
      });
    this.renderer.shadowMap.enabled = budget.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    const shadow = this.keyLight.shadow;
    if (shadow.mapSize.x !== budget.shadowSize) {
      shadow.map?.dispose();
      shadow.map = null;
      shadow.mapSize.set(budget.shadowSize, budget.shadowSize);
    }
    if (this.bundle) {
      this.bundle.library.maxAnisotropy = budget.anisotropy;
      for (const t of this.bundle.library.owned) {
        t.anisotropy = Math.min(budget.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
        t.needsUpdate = true;
      }
    }
    this.resize();
    return this.getPerformanceStats();
  }
  getPerformanceStats() {
    this.assertAlive();
    return {
      mode: this.budget.mode,
      maxFps: this.budget.maxFps,
      pixelRatio: this.renderer.getPixelRatio(),
      shadows: this.renderer.shadowMap.enabled,
      visible: this.backgroundAt === null && !this.suspended,
      renderCount: this.frames,
      lastFrameMs: this.lastFrameMs,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      memory: { ...this.renderer.info.memory },
    };
  }
  resize() {
    this.assertAlive();
    const w = Math.max(1, this.container.clientWidth),
      h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.updateVisibility();
    this.perspective.aspect = w / h;
    /** 释放渲染器、网格、纹理与事件监听；之后调用任何接口抛出 DISPOSED。 */
    this.perspective.updateProjectionMatrix();
    const half = Math.max(1.9, 1.1 / (w / h));
    Object.assign(this.ortho, {
      left: (-half * w) / h,
      right: (half * w) / h,
      top: half,
      bottom: -half,
    });
    this.ortho.updateProjectionMatrix();
    if (
      this.bundle &&
      this.follow &&
      !this.bundle.store.initialized &&
      this.activeCamera === this.perspective
    )
      this.fitCamera(0, false);
    this.invalidate();
  }
  suspend() {
    this.assertAlive();
    this.suspended = true;
    this.scheduler.cancel();
    this.raf = 0;
    this.camera.cancel();
    this.cancelScan();
    /**
     * 创建独立的模型实例。
     * @param {HTMLElement} container
     * @param {ViewerOptions} [options]
     * @returns {MattressViewer}
     */
    if (this.revealOverride?.phase === 'scan' || this.revealOverride?.phase === 'closing')
      this.revealOverride = closed();
    if (this.sideReveals)
      for (const side of ['left', 'right'])
        if (['scan', 'closing'].includes(this.sideReveals[side].phase))
          this.sideReveals[side] = closed();
  }
  resume() {
    this.assertAlive();
    this.suspended = false;
    this.lastFrame = performance.now();
    if (this.bundle) {
      this.bundle.current = this.bundle.store.targets(this.bundle.current);
      this.bundle.director.phase = 'closed';
      this.bundle.director.side = null;
    }
    this.invalidate();
    this.emit('state.resyncRequired', {});
  }
  dispose() {
    if (this.disposed) return;
    this.cancelPresentation('DISPOSED');
    this.disposed = true;
    ++this.generation;
    this.scheduler.cancel();
    this.intersectionObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.observer.disconnect();
    this.media.removeEventListener('change', this.onMotionChange);
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onRestored);
    release(this.bundle);
    this.environment.dispose();
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.grid.geometry.dispose();
    this.grid.material.dispose();
    this.scene.traverse((o) => o.shadow?.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.listeners.clear();
  }
}

export function createMattressViewer(container, options) {
  return new MattressViewer(container, options);
}

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MaterialLibrary, MATERIAL_CONFIG } from './materials.js';
import { SmartBed } from './model.js';
import { ANATOMY_LAYERS } from './anatomy.js';
import {
  COLLECTIONS,
  COLOR_SWATCHES,
  PATTERNS,
  PATTERN_OPTIONS,
  HEADBOARD_STYLES,
  DEFAULT_COLLECTION,
} from './cmf.js';
import { PRESETS, ZONES } from './kinematics.js';
import { DIMENSIONS, HEADBOARD_LAYOUT } from './dimensions.js';
import { prepareBrandArtwork } from './branding.js';
import { FirmnessEffect } from './firmness-effect.js';
import { HeatingEffect } from './heating-effect.js';
import { HEAT_ZONES, HEAT_LEVELS, setHeatLevel } from './heating.js';
import { DEMO_STEPS, sampleShowroomDemo, showroomDemoReveal } from './showroom-demo.js';
import {
  SIDE_NAMES,
  sideIndices,
  isSelectedZone,
  setZonePressure,
  desiredPressure,
  firmnessCamera,
  shortestAngle,
  sampleAirReveal,
  REVEAL_TIMING,
} from './firmness.js';
import './style.css';

const icons = {
  mark: '<path d="M5 20V4l14 16V4"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  orbit:
    '<ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-30 12 12)"/><circle cx="12" cy="12" r="3"/>',
  top: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 8h14M8 5h3m2 0h3"/>',
  side: '<path d="M3 18h18M4 17V8l7 7h9v3M4 10l7 7"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  layers: '<path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v5h16v-5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.orbit}</svg>`;
const bedIcon = (type) =>
  `<svg class="bed-icon" viewBox="0 0 92 38" fill="none" aria-hidden="true"><path d="M8 28h76M12 28v6m68-6v6" stroke="currentColor" opacity=".3" stroke-width="2"/><path d="${{ flat: 'M12 22h68', read: 'M12 6l29 16h22l11-4 6 4', zero: 'M12 12l27 13h14l15-12 12 8', relax: 'M12 18l26 7h14l15-16 13 12' }[type]}" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

document.querySelector('#app').innerHTML = `
  <header class="header">
    <a class="brand" href="#" aria-label="NOCTIS 首页"><span class="brand-mark">${icon('mark')}</span><span>NOCTIS<small>SMART SLEEP LAB</small></span></a>
    <div class="header-center"><span class="tiny-dot"></span> 智能睡眠 · 三维体验空间</div>
    <button class="outline-button" id="capture">${icon('download')}<span>保存视图</span></button>
  </header>
  <main class="workspace">
    <section class="stage" aria-label="智能床 3D 模型">
      <div id="viewport"></div>
      <div class="stage-title"><div class="eyebrow"><span>NOCTIS / 01</span><span class="hairline"></span> ADAPTIVE SLEEP SYSTEM</div><h1>好睡眠，从支撑开始<span>。</span></h1><p>智能床垫 · 电动床架 · 皮质床屏</p></div>
      <div class="stage-badge"><span class="live-dot"></span><span id="projection-label">REALTIME 3D</span></div>
      <div class="firmness-heading" hidden><span class="eyebrow">INTELLIGENT COMFORT / ONE MATTRESS</span><h1>支撑与温暖，融于一体。</h1><p>单侧扫描透视 · 腰腿独立温热</p><div class="effect-legend"><span class="air-legend">内部 · 气囊支撑</span><span class="heat-legend">表层 · 腰腿加热</span></div></div>
      <div class="firmness-hud" hidden>
        <div class="firmness-channel"><span class="live-dot"></span><span id="firmness-channel">LEFT CHANNEL</span><span id="firmness-phase">分区已就绪</span></div>
        <div class="firmness-readout"><div><small id="firmness-address">L / 02</small><strong id="firmness-name">左侧 · 腰部</strong></div><div class="firmness-number"><b id="firmness-current">50</b><span id="firmness-unit">%</span></div></div>
        <div class="firmness-meter"><i></i></div><div class="firmness-caption"><span id="firmness-min">偏软</span><span id="firmness-target">目标 50%</span><span id="firmness-max">偏硬</span></div>
        <div class="heat-live-readout" id="heat-live-readout">腰部加热 关闭 · 腿部加热 关闭</div>
      </div>
      <div class="firmness-caption-bar" hidden><span>一体床垫 · 分区独立</span><button id="stop-auto-demo" hidden>停止循环 ${icon('pause')}</button><button id="exit-firmness">退出演示 ${icon('arrow')}</button></div>
      <div id="firmness-announcement" class="sr-only" role="status" aria-live="polite"></div>
      <div class="camera-tools" aria-label="视角控制"><button data-camera="perspective" class="icon-button active" title="立体视角" aria-label="立体视角">${icon('orbit')}</button><button data-camera="side" class="icon-button" title="正投影侧视：核对接合与高度" aria-label="正投影侧视">${icon('side')}</button><button data-camera="top" class="icon-button" title="正投影俯视：核对长宽比例" aria-label="正投影俯视">${icon('top')}</button><i></i><button id="reset-view" class="icon-button" title="复位视角" aria-label="复位视角">${icon('reset')}</button></div>
      <div class="model-label" id="label-leather"><span></span><div>双靠包落地床屏<small>FLOOR-STANDING HEADBOARD</small></div></div>
      <div class="model-label" id="label-air"><span></span><div id="air-label-text">自适应气囊支撑<small>8 INDEPENDENT ZONES</small></div></div>
      <div class="layer-markers" hidden>${ANATOMY_LAYERS.map((layer, i) => `<button class="layer-marker" data-layer="${layer.id}" style="--layer-color:${layer.color}" title="${layer.label}" aria-label="定位${layer.label}">${String(i + 1).padStart(2, '0')}</button>`).join('')}</div>
      <div class="stage-meta"><span class="vertical-text">ENGINEERED FOR YOUR REST</span></div>
      <div class="stage-bottom"><div class="model-number"><span>01</span><div>智能睡眠系统<small>160 × 190 cm · 床垫尺寸</small></div></div><div class="view-switch" role="group" aria-label="模型显示方式"><button class="active" data-view="solid">${icon('eye')}整床外观</button><button data-view="xray">${icon('layers')}气囊透视</button><button data-view="explode">分层结构</button></div><button id="rotate" class="rotate-button" aria-pressed="false">${icon('orbit')}<span>自动旋转</span></button></div>
      <div class="interaction-hint">拖拽旋转 <span>·</span> 滚轮缩放 <span>·</span> 右键平移</div>
      <div id="loading" class="loading"><div class="loader-ring"></div><span>正在构建睡眠空间</span></div>
    </section>
    <aside class="panel">
      <div class="panel-heading"><div><span class="eyebrow">MAKE IT YOURS</span><h2>探索你的舒适区</h2></div><span class="panel-index">/ 01</span></div>
      <div class="tabs" role="tablist" aria-label="调节面板"><button id="tab-pose" class="active" role="tab" aria-selected="true" aria-controls="pane-pose" data-tab="pose">床体姿态</button><button id="tab-air" role="tab" aria-selected="false" aria-controls="pane-air" data-tab="air">气囊调节</button><button id="tab-structure" role="tab" aria-selected="false" aria-controls="pane-structure" data-tab="structure">三层结构</button><button id="tab-material" role="tab" aria-selected="false" aria-controls="pane-material" data-tab="material">材质定制</button></div>
      <div class="panel-content">
        <div id="pane-pose" role="tabpanel" aria-labelledby="tab-pose" class="pane">
          <div class="section-label">床体样式 <span>BED SILHOUETTE</span></div>
          <div class="bed-style-select" role="group" aria-label="床邦样式"><button data-bed-style="wide" class="active" aria-pressed="true"><b>内嵌床邦</b><small>两侧各留 8 cm</small></button><button data-bed-style="flush" aria-pressed="false"><b>齐边床邦</b><small>床垫与床邦齐边</small></button></div>
          <dl class="dimension-readout" aria-label="当前整床尺寸"><div><dt>床垫 · 宽 × 长 × 厚</dt><dd>160 × 190 × 21 cm</dd></div><div><dt>床邦 · 外宽 × 外长</dt><dd id="surround-size"></dd></div><div><dt>床屏 · 宽 × 高</dt><dd id="headboard-size"></dd></div></dl><p class="fine-print" id="bed-style-note"></p><label class="field-label" for="headboard-style">床屏造型</label><select id="headboard-style">${Object.entries(
            HEADBOARD_STYLES,
          )
            .map(([id, label]) => `<option value="${id}">${label}</option>`)
            .join(
              '',
            )}</select><label class="waistband-toggle" for="waistband-toggle"><span>床垫腰线织带</span><input id="waistband-toggle" type="checkbox"/></label>
          <button class="text-button" id="headboard-view" aria-pressed="false">${icon('eye')}<span>单独查看床屏</span>${icon('arrow')}</button><div class="section-label spacing">舒适，一键就位 <span>01—04</span></div>
          <div class="preset-grid">${Object.entries(PRESETS)
            .map(
              ([id, p], i) =>
                `<button data-preset="${id}" class="preset ${id === 'flat' ? 'active' : ''}" aria-pressed="${id === 'flat'}"><span class="preset-index">0${i + 1}</span>${bedIcon(id)}<span class="preset-name">${p.name}<small>${{ flat: 'FLAT', read: 'READING', zero: 'ZERO GRAVITY', relax: 'RELAX' }[id]}</small></span><span class="selected-dot"></span></button>`,
            )
            .join('')}</div>
          <div class="section-label spacing">精细调节 <span>ANGLE CONTROL</span></div>
          <div class="slider-block"><label for="back-angle">背部抬升 <output id="back-value">0<span>°</span></output></label><input id="back-angle" type="range" min="0" max="65" value="0"/><div class="range-scale"><span>0°</span><span>65°</span></div></div>
          <div class="slider-block"><label for="leg-angle">腿部抬升 <output id="leg-value">0<span>°</span></output></label><input id="leg-angle" type="range" min="0" max="35" value="0"/><div class="range-scale"><span>0°</span><span>35°</span></div></div>
          <div class="support-note"><span class="note-symbol">⌁</span><div>床垫随床架连续贴合<small>五段床板 · 摆臂滚轮抬升</small></div></div>
          <button class="mechanism-button" id="mechanism-view" aria-pressed="false">${icon('layers')}查看电动床架${icon('arrow')}</button><div id="mechanism-readout" hidden><span>背部推杆 <b id="back-stroke">0 mm</b></span><span>腿部推杆 <b id="leg-stroke">0 mm</b></span><small>BZZ1-007 · 参考规格 160 × 190 cm<br>纵向保留 STEP 尺寸 · 行程为动画计算值</small><button class="text-button" id="deck-panels" aria-pressed="false">显示五段床板</button></div><button class="text-button" id="flat-reset">${icon('reset')}一键恢复平躺${icon('arrow')}</button>
        </div>
        <div id="pane-air" role="tabpanel" aria-labelledby="tab-air" class="pane" hidden>
          <button class="auto-demo-button" id="auto-demo" aria-pressed="false">${icon('play')}<span><b>开始自动循环</b><small>左右气囊 → 腰腿加热 → 自动重复</small></span><em id="auto-demo-count">DEMO</em></button>
          <div class="auto-demo-progress"><i></i></div><p id="auto-demo-status">一键看全套效果，也可随时手动调节。</p>
          <div class="section-label">内部气囊 · 独立软硬调节 <span>AIR SUPPORT</span></div>
          <div class="side-select" role="group" aria-label="气囊调节侧"><button class="active" data-side="left" aria-pressed="true">左侧独立</button><button data-side="right" aria-pressed="false">右侧独立</button><button data-side="both" aria-pressed="false">双侧同步</button></div>
          <p class="air-instruction">点选部位或拖动滑杆：转向当前侧，扫描后调节。</p>
          <div class="air-map" aria-label="八气囊示意">${['L', 'R'].map((s, side) => `<div class="air-column"><span>${s === 'L' ? '左侧 L' : '右侧 R'}</span>${ZONES.map((z, i) => `<button class="air-zone" id="zone-${side}-${i}" data-air-side="${side}" data-air-zone="${i}" aria-label="${side === 0 ? '左侧' : '右侧'}${z.name}" aria-pressed="false"><i></i><b>${z.name}</b><small>50%</small></button>`).join('')}</div>`).join('')}</div>
          <div class="air-control-label"><span id="air-control-label">左侧 · 四区独立</span><span>软 ← → 硬</span></div>
          <div class="air-sliders">${ZONES.map((z, i) => `<div class="slider-block compact"><label for="pressure-${i}">${z.name}支撑 <output id="pressure-value-${i}">50<span>%</span></output></label><input id="pressure-${i}" data-pressure="${i}" type="range" min="0" max="100" value="50"/></div>`).join('')}</div>
          <div class="heating-controls"><div class="section-label">气囊上层 · 腰腿加热 <span>THERMAL COMFORT</span></div>${HEAT_ZONES.map((region, i) => `<div class="heat-control"><span>${region.name}<small>温热强度</small></span><div role="group" aria-label="${region.name}加热">${HEAT_LEVELS.map((label, level) => `<button data-heat-region="${i}" data-heat-level="${level}" aria-label="${region.name}加热${label}" aria-pressed="${level === 0}">${label}</button>`).join('')}</div></div>`).join('')}<p class="heat-control-note">当前侧独立设置；橙金色热纹显示在气囊上方。</p></div>
          <div class="toggle-row"><div>循环演示当前分区<small id="cycle-region">左侧 · 腰部</small></div><button class="switch" id="massage" role="switch" aria-checked="false" aria-label="循环演示当前分区"><span></span></button></div>
          <p class="fine-print">百分比和热档均为视觉演示。单独加热保留完整外观；左 / 右以床尾面向床屏定义。</p>
        </div>
        <div id="pane-structure" role="tabpanel" aria-labelledby="tab-structure" class="pane" hidden>
          <div class="section-label">由外到内，看见支撑 <span>3 ESSENTIAL LAYERS</span></div>
          <p class="structure-intro">面料与舒适衬层合并展示，保留分区气囊和基础承托。点击一层即可靠近查看。</p>
          <div class="layer-list">${ANATOMY_LAYERS.map((layer, i) => `<button data-layer="${layer.id}" class="layer-row" aria-pressed="false" aria-label="聚焦${layer.label}"><span class="layer-index" style="--layer-color:${layer.color}">${String(i + 1).padStart(2, '0')}</span><span><strong>${layer.label}</strong><small>${layer.english}</small></span><span class="layer-focus">＋</span></button>`).join('')}</div>
          <button class="text-button" id="show-all-layers">${icon('layers')}查看全部层${icon('arrow')}</button>
          <p class="fine-print">三层为展示归类，层厚和气囊尺寸为示意。</p>
        </div>
        <div id="pane-material" role="tabpanel" aria-labelledby="tab-material" class="pane" hidden>
          <div class="section-label">设计师整床搭配 <span>${COLLECTIONS.length} COLLECTIONS</span></div>
          <div class="collection-grid">${COLLECTIONS.map(
            (c) =>
              `<button class="collection-card ${c.id === DEFAULT_COLLECTION ? 'active' : ''}" data-collection="${c.id}" aria-pressed="${c.id === DEFAULT_COLLECTION}" aria-label="${c.name}配色"><span class="collection-colors">${c.colors
                .slice(0, 4)
                .map((color) => `<i style="background:${color}"></i>`)
                .join('')}</span><strong>${c.name}</strong><small>${c.mood}</small></button>`,
          ).join('')}</div>
          <p class="fine-print collection-note">暮蓝织序参考上传图片，搭配竖向分格床屏与浅色腰线；原有搭配仍可切换。</p>
          <div class="section-label spacing">定制部件 <span>COLOR & TEXTURE</span></div>
          <label class="field-label" for="material-part">选择部件</label><select id="material-part">${Object.entries(
            MATERIAL_CONFIG,
          )
            .map(([id, m]) => `<option value="${id}">${m.label}</option>`)
            .join('')}</select>
          <div class="material-preview"><div class="material-orb"></div><div><strong id="material-name">床屏与床邦皮革</strong><span id="material-description">细腻纹理 · 柔和反光</span></div><span class="material-tag">PBR</span></div>
          <button class="text-button" id="material-detail">放大查看材质 ${icon('arrow')}</button><div class="swatch-row">${COLOR_SWATCHES.map(([name, color]) => `<button class="swatch" data-color="${color}" style="--swatch:${color}" title="${name}" aria-label="${name}"></button>`).join('')}<label class="custom-color" title="自定义颜色"><input id="material-color" type="color" value="#f3eee4" aria-label="自定义材质颜色"/><span>＋</span></label></div>
          <div id="pattern-field"><label class="field-label" for="material-pattern">纹理与花纹</label><select id="material-pattern"></select></div>
          <div class="slider-block compact"><label for="roughness">粗糙度 <output id="roughness-value">0.62</output></label><input id="roughness" type="range" min="0" max="1" step="0.01" value="0.62"/></div>
          <div class="slider-block compact"><label for="texture-repeat">纹理重复 <output id="repeat-value">3 × 3</output></label><input id="texture-repeat" type="range" min="1" max="12" step="1" value="3"/></div>
          <div class="section-label spacing">替换纹理 <span>JPG / PNG / WEBP</span></div>
          <label class="texture-upload" for="texture-file">${icon('upload')}<strong>导入你的材质纹理</strong><span id="texture-filename">点击选择图片，即时预览</span></label><input id="texture-file" type="file" accept="image/png,image/jpeg,image/webp" hidden/>
          <label class="field-label" for="texture-channel">纹理通道</label><select id="texture-channel"><option value="map">颜色 · Base Color</option><option value="normalMap">法线 · Normal</option><option value="roughnessMap">粗糙度 · Roughness</option></select>
          <button class="text-button" id="reset-material">${icon('reset')}恢复当前部件材质${icon('arrow')}</button>
        </div>
      </div>
      <div class="panel-footer"><span class="live-dot"></span><span id="status-text">平躺姿态</span><span id="status-right">实时联动</span></div>
    </aside>
  </main>
  <footer class="footer"><span>NOCTIS <i>/</i> 智能睡眠实验室</span><span class="footer-middle">让科技，安静地承托每一次休息。</span><div><button id="export-config">导出配置 ${icon('download')}</button><button id="export-model">导出模型 ${icon('download')}</button><span class="version">V.13</span></div></footer>
  <div id="toast" role="status" aria-live="polite"></div>
`;

const $ = (q) => document.querySelector(q),
  $$ = (q) => [...document.querySelectorAll(q)];
const target = {
  back: 0,
  leg: 0,
  pressures: [
    [50, 50, 50, 50],
    [50, 50, 50, 50],
  ],
  heating: [
    [0, 0],
    [0, 0],
  ],
  xray: 0,
  explode: 0,
};
const current = structuredClone(target);
let activeSide = 'left',
  activeZone = 1,
  activePart = 'fabric',
  view = 'solid',
  massage = false,
  toastTimer,
  materialLibrary,
  bed,
  renderer,
  scene,
  camera,
  controls;
let firmnessEffect,
  heatingEffect,
  firmnessSelection = null,
  firmnessFlight = null,
  firmnessUntil = 0,
  cycleStarted = 0,
  lastFirmnessUI = 0,
  autoDemo = null,
  demoFrame = null;
let airTransition = null,
  airReveal = sampleAirReveal(null, null, 0),
  lastAirInput = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let needsRender = true,
  renderCount = 0,
  lastModelUpdateMs = 0,
  showDecks = false;
let perspectiveCamera,
  orthographicCamera,
  cameraView = 'perspective';
let cameraTarget = null,
  pendingLayerFocus = null,
  lastTime = 0,
  dirty = true,
  lastPressureUI = 0,
  rafId;
const viewport = $('#viewport');
function toast(text) {
  $('#toast').textContent = text;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3200);
}
function paintRange(el) {
  el.style.setProperty(
    '--progress',
    `${((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100}%`,
  );
}
function download(blob, name) {
  const a = document.createElement('a'),
    url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function initScene() {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  viewport.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', '可旋转的智能床三维模型');
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x111a1d, 0.075);
  perspectiveCamera = new THREE.PerspectiveCamera(37, 1, 0.05, 60);
  orthographicCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.05, 60);
  camera = perspectiveCamera;
  camera.position.set(3.1, 2.35, 3.8);
  configureControls(new THREE.Vector3(0, 0.52, -0.03));
  const pmrem = new THREE.PMREMGenerator(renderer),
    room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0xdaf2f2, 0x18262b, 1.5));
  const key = new THREE.DirectionalLight(0xfff3df, 3);
  key.position.set(2.0, 5.5, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -3;
  key.shadow.normalBias = 0.018;
  key.shadow.bias = -0.0002;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8fceff, 1.8);
  fill.position.set(-3, 2.8, -2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x7ce4c8, 1.8);
  rim.position.set(2, 1, -3);
  scene.add(rim);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x070c0e, metalness: 0.1, roughness: 0.85 }),
  );
  floor.name = 'Studio_Floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.005;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(14, 70, 0x3a5357, 0x243538);
  grid.material.transparent = true;
  grid.material.opacity = 0.19;
  grid.position.y = 0;
  scene.add(grid);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.81, 1.815, 160),
    new THREE.MeshBasicMaterial({
      color: 0x659188,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.006;
  scene.add(ring);
  const outerRing = new THREE.Mesh(
    new THREE.RingGeometry(1.86, 1.861, 160),
    new THREE.MeshBasicMaterial({
      color: 0x45645d,
      transparent: true,
      opacity: 0.23,
      side: THREE.DoubleSide,
    }),
  );
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = 0.006;
  scene.add(outerRing);
  materialLibrary = new MaterialLibrary(renderer, () => {
    needsRender = true;
  });
  bed = new SmartBed(materialLibrary);
  scene.add(bed.root);
  bed.setSurroundStyle('flush');
  applyCollection(DEFAULT_COLLECTION);
  bed.update(current);
  firmnessEffect = new FirmnessEffect();
  scene.add(firmnessEffect.root);
  heatingEffect = new HeatingEffect();
  scene.add(heatingEffect.root);
  updateDimensions();
  resize();
  new ResizeObserver(resize).observe(viewport);
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    cancelAnimationFrame(rafId);
    toast('三维渲染已暂停，请刷新页面恢复');
  });
  $('#loading').classList.add('loaded');
  $('#loading').setAttribute('aria-hidden', 'true');
  requestAnimationFrame(animate);
}
function configureControls(target) {
  controls?.dispose();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 1.1;
  controls.maxDistance = 8;
  controls.minZoom = 0.6;
  controls.maxZoom = 4;
  controls.minPolarAngle = camera.isOrthographicCamera ? 0 : 0.05;
  controls.maxPolarAngle = camera.isOrthographicCamera ? Math.PI / 2 : Math.PI / 2 - 0.035;
  controls.autoRotateSpeed = 0.65;
  controls.addEventListener('start', () => {
    stopAutoDemo();
    cameraTarget = null;
    firmnessFlight = null;
    pendingLayerFocus = null;
    cameraView = 'orbit';
    $$('[data-camera]').forEach((b) => b.classList.remove('active'));
    $('#projection-label').textContent = camera.isOrthographicCamera
      ? '正投影 · 自由观察'
      : 'REALTIME 3D';
  });
}
function resize() {
  if (!renderer) return;
  const { width, height } = viewport.getBoundingClientRect(),
    aspect = width / height;
  renderer.setSize(width, height);
  perspectiveCamera.aspect = aspect;
  perspectiveCamera.fov = THREE.MathUtils.radToDeg(
    2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(37 / 2)) * Math.max(1, 1.08 / aspect)),
  );
  perspectiveCamera.updateProjectionMatrix();
  const span = Math.max(3.5, 3.1 / aspect);
  orthographicCamera.left = (-span * aspect) / 2;
  orthographicCamera.right = (span * aspect) / 2;
  orthographicCamera.top = span / 2;
  orthographicCamera.bottom = -span / 2;
  orthographicCamera.updateProjectionMatrix();
  needsRender = true;
}
function updateDimensions() {
  const cm = (v) => Number((v * 100).toFixed(1)),
    p = bed.layout;
  $('#surround-size').textContent =
    `${cm(p.outerWidth)} × ${cm(p.foot - HEADBOARD_LAYOUT.bedRear)} cm`;
  $('#headboard-size').textContent = `${cm(p.headboardWidth)} × ${cm(HEADBOARD_LAYOUT.height)} cm`;
  $('#bed-style-note').textContent =
    bed.surroundStyle === 'flush'
      ? '两侧与床尾齐边；承托板收窄至 143 cm，床屏两侧各伸出 6 cm。'
      : '两侧各留 8 cm，床尾留 7.5 cm；159 cm 承托板匹配原 STEP 板面。';
  $('.model-number div').innerHTML =
    view === 'headboard'
      ? `独立落地床屏<small>${cm(p.headboardWidth)} × ${cm(HEADBOARD_LAYOUT.height)} cm · 宽 × 高</small>`
      : view === 'mechanism'
        ? '电动床架 · 双驱动<small>五段床板 · 六点支撑</small>'
        : '智能睡眠系统<small>160 × 190 cm · 床垫尺寸</small>';
}
function labelPosition(id, point, offsetX, offsetY) {
  const p = point.project(camera),
    el = $(id);
  const { width, height } = viewport.getBoundingClientRect();
  el.style.left = `${(p.x * 0.5 + 0.5) * width + offsetX}px`;
  el.style.top = `${(-p.y * 0.5 + 0.5) * height + offsetY}px`;
  el.style.opacity =
    p.z < 1 &&
    !camera.isOrthographicCamera &&
    view !== 'explode' &&
    view !== 'mechanism' &&
    !(view === 'headboard' && id === '#label-air')
      ? '1'
      : '0';
}
function animate(ms) {
  const dt = Math.min((ms - lastTime) / 1000 || 0.016, 0.05);
  lastTime = ms;
  const ease = 1 - Math.exp(-dt * 7);
  let changed = dirty;
  dirty = false;
  if (autoDemo) {
    demoFrame = sampleShowroomDemo((ms - autoDemo.started) / 1000, target);
    if (autoDemo.step !== demoFrame.index) {
      autoDemo.step = demoFrame.index;
      selectAirSide(demoFrame.selection.side);
      beginFirmness(demoFrame.selection.zone, true, demoFrame.selection.kind);
      $('#auto-demo-count').textContent = `${demoFrame.index + 1} / ${DEMO_STEPS.length}`;
      $('#auto-demo-status').textContent = `第 ${demoFrame.cycle} 轮 · ${demoFrame.label}`;
    }
    $('.auto-demo-progress i').style.width =
      `${((demoFrame.index + demoFrame.phase) / DEMO_STEPS.length) * 100}%`;
  }
  const nextReveal = autoDemo
    ? showroomDemoReveal(demoFrame, reducedMotion.matches)
    : sampleAirReveal(firmnessSelection, airTransition, ms, reducedMotion.matches);
  if (nextReveal.phase !== airReveal.phase || nextReveal.side !== airReveal.side) changed = true;
  airReveal = nextReveal;
  bed.coverReveal.update(airReveal);
  // Match the SDK: reveal and pressure motion remain, while the additive highlights stay hidden.
  firmnessEffect.root.visible = false;
  for (const k of ['back', 'leg', 'xray', 'explode']) {
    if (Math.abs(target[k] - current[k]) > 0.0002) {
      current[k] += (target[k] - current[k]) * ease;
      changed = true;
    }
  }
  for (let s = 0; s < 2; s++)
    for (let z = 0; z < 4; z++) {
      if (!airReveal.ready) continue;
      const cycleTime =
        Math.max(
          0,
          ms -
            Math.max(
              cycleStarted,
              (airTransition?.start || 0) + (airTransition?.flight || 0) + REVEAL_TIMING.scan,
            ),
        ) / 1000;
      const desired = autoDemo
        ? demoFrame.pressures[s][z]
        : desiredPressure(target.pressures, firmnessSelection, massage, s, z, cycleTime);
      if (Math.abs(desired - current.pressures[s][z]) > 0.015) {
        current.pressures[s][z] += (desired - current.pressures[s][z]) * ease;
        changed = true;
      }
    }
  for (let s = 0; s < 2; s++)
    for (let z = 0; z < 2; z++) {
      const desired = (autoDemo ? demoFrame : target).heating[s][z];
      if (Math.abs(desired - current.heating[s][z]) > 0.001) {
        current.heating[s][z] += (desired - current.heating[s][z]) * ease;
        changed = true;
      }
    }
  if (changed && bed) {
    const started = performance.now();
    bed.update({
      ...current,
      mechanism: view === 'mechanism',
      headboardOnly: view === 'headboard',
      showDecks,
      showroom: !!firmnessSelection,
      airReveal,
    });
    lastModelUpdateMs = performance.now() - started;
  }
  if (pendingLayerFocus && current.explode > 0.99) {
    const bounds = new THREE.Box3().setFromObject(
        bed.anatomy.entries[pendingLayerFocus].group,
        true,
      ),
      center = bounds.getCenter(new THREE.Vector3());
    const distance = Math.max(
      2.5,
      ((bounds.getSize(new THREE.Vector3()).length() * 0.6) /
        Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) *
        Math.max(1, 1 / camera.aspect),
    );
    cameraTarget = {
      position: center
        .clone()
        .add(new THREE.Vector3(3.2, 3.2, 4.5).normalize().multiplyScalar(distance)),
      target: center,
    };
    pendingLayerFocus = null;
  }
  if (ms - lastPressureUI > 150) {
    if (autoDemo) {
      updatePressureControls(current.pressures);
      updateHeatControls(demoFrame.heating);
    } else if (massage) updatePressureMap(current.pressures);
    lastPressureUI = ms;
  }
  if (cameraTarget) {
    camera.position.lerp(cameraTarget.position, ease);
    controls.target.lerp(cameraTarget.target, ease);
    if (camera.position.distanceTo(cameraTarget.position) < 0.005) cameraTarget = null;
  }
  if (firmnessFlight) {
    const flight = firmnessFlight,
      t = Math.min(1, (ms - flight.start) / REVEAL_TIMING.flight),
      k = t * t * (3 - 2 * t);
    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k);
    const sphere = new THREE.Spherical(
      THREE.MathUtils.lerp(flight.from.radius, flight.to.radius, k),
      THREE.MathUtils.lerp(flight.from.phi, flight.to.phi, k),
      THREE.MathUtils.lerp(flight.from.theta, flight.to.theta, k),
    );
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sphere));
    needsRender = true;
    if (t === 1) firmnessFlight = null;
  }
  const effectMoving =
    !!firmnessSelection &&
    !reducedMotion.matches &&
    (!!autoDemo || massage || !airReveal.ready || ms < firmnessUntil);
  if (
    firmnessSelection &&
    (changed || needsRender || effectMoving || firmnessEffect.moving !== effectMoving)
  ) {
    firmnessEffect.update({
      spine: bed.spine,
      pressures: current.pressures,
      selection: firmnessSelection,
      time: ms / 1000,
      moving: effectMoving && airReveal.ready,
    });
    heatingEffect.update({
      spine: bed.spine,
      heating: current.heating,
      pressures: current.pressures,
      time: ms / 1000,
      moving: effectMoving,
    });
    firmnessEffect.moving = effectMoving;
    needsRender = true;
  }
  if (firmnessSelection && ms - lastFirmnessUI > 100) {
    updateFirmnessHUD(ms);
    lastFirmnessUI = ms;
  }
  const cameraChanged = controls.update();
  if (changed || cameraChanged || cameraTarget || needsRender) {
    if (changed) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    renderCount++;
    needsRender = false;
    labelPosition(
      '#label-leather',
      new THREE.Vector3(-bed.layout.headboardWidth * 0.36, 1.09, -1.03),
      -134,
      -18,
    );
    labelPosition('#label-air', new THREE.Vector3(0.78, 0.56, 0.5), 30, -5);
    if (view === 'explode') {
      const { width, height } = viewport.getBoundingClientRect();
      $$('.layer-marker').forEach((el) => {
        const p = bed.getLayerAnchor(el.dataset.layer).project(camera);
        el.style.left = `${(p.x * 0.5 + 0.5) * width}px`;
        el.style.top = `${(-p.y * 0.5 + 0.5) * height}px`;
        el.hidden = !!bed.selectedLayer && bed.selectedLayer !== el.dataset.layer;
      });
    }
  }
  if (changed && view === 'mechanism') {
    for (const a of bed.linkage.actuators)
      $(`#${a.id}-stroke`).textContent = `${Math.round(a.stroke * 1000)} mm`;
  }
  rafId = requestAnimationFrame(animate);
}
function setCamera(name) {
  stopAutoDemo();
  pendingLayerFocus = null;
  cameraTarget = null;
  firmnessFlight = null;
  cameraView = name;
  const next = ['top', 'side'].includes(name) ? orthographicCamera : perspectiveCamera;
  const oldTarget = controls.target.clone();
  if (next !== camera) {
    camera = next;
    configureControls(oldTarget);
  }
  const positions = {
    perspective: [3.1, 2.35, 3.8],
    side: [4.6, 0.56, -0.07],
    top: [0, 5.4, -0.06999],
    exploded: [3.0, 2.5, 4.3],
    mechanism: [2.45, 1.5, 2.7],
    headboard: [1.4, 1.3, 2.05],
  };
  const level = view === 'explode' ? 0.91 : view === 'mechanism' ? 0.3 : 0.52;
  const focus =
    view === 'headboard' ? new THREE.Vector3(0, 0.68, -1.1) : new THREE.Vector3(0, level, -0.07);
  if (camera.isOrthographicCamera) {
    if (name === 'side' && view !== 'headboard') focus.y = 0.56;
    camera.position
      .copy(focus)
      .add(name === 'side' ? new THREE.Vector3(4.6, 0, 0) : new THREE.Vector3(0, 5.4, 0.00001));
    controls.target.copy(focus);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.update();
  } else cameraTarget = { position: new THREE.Vector3(...positions[name]), target: focus };
  controls.autoRotate = false;
  $('#rotate').setAttribute('aria-pressed', 'false');
  needsRender = true;
  $('#projection-label').textContent =
    { top: '正投影俯视 · 等比例', side: '正投影侧视 · 等比例' }[name] || 'REALTIME 3D';
  $$('[data-camera]').forEach((b) => b.classList.toggle('active', b.dataset.camera === name));
}
function setView(name, syncTab = true) {
  endFirmness();
  const previous = view;
  view = name;
  target.xray = name === 'xray' ? 1 : 0;
  target.explode = name === 'explode' ? 1 : 0;
  bed.selectedLayer = null;
  $$('[data-layer]').forEach((b) => {
    b.classList.remove('active');
    b.setAttribute('aria-pressed', 'false');
  });
  dirty = true;
  $('.layer-markers').hidden = name !== 'explode';
  if (name === 'explode') {
    setCamera('exploded');
    if (syncTab) activateTab('structure', false);
  } else if (name === 'headboard') {
    setCamera('headboard');
    if (syncTab) activateTab('pose', false);
  } else if (name === 'mechanism') {
    setCamera('mechanism');
    if (syncTab) activateTab('pose', false);
  } else if (previous === 'explode' || previous === 'mechanism' || previous === 'headboard') {
    setCamera('perspective');
    if (syncTab && $('#tab-structure').classList.contains('active')) activateTab('pose', false);
  }
  $$('[data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === name);
    b.setAttribute('aria-pressed', String(b.dataset.view === name));
  });
  updateDimensions();
  $('#headboard-view').setAttribute('aria-pressed', String(name === 'headboard'));
  $('#headboard-view span').textContent = name === 'headboard' ? '返回整床组合' : '单独查看床屏';
  $('#mechanism-view').setAttribute('aria-pressed', String(name === 'mechanism'));
  $('#mechanism-readout').hidden = name !== 'mechanism';
  $('#status-right').textContent = {
    solid: '实时联动',
    xray: '内部透视',
    explode: '三层展示',
    mechanism: '驱动机构',
    headboard: '独立床屏',
  }[name];
}
function activateTab(id, changeView = true) {
  if (id !== 'air' && firmnessSelection) {
    endFirmness();
    setView('solid', false);
  }
  $$('[data-tab]').forEach((t) => {
    const active = t.dataset.tab === id;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  $$('.pane').forEach((p) => (p.hidden = p.id !== `pane-${id}`));
  $('.panel-index').textContent = `/ 0${['pose', 'air', 'structure', 'material'].indexOf(id) + 1}`;
  $('.panel-heading h2').textContent = id === 'structure' ? '三层结构，清晰呈现' : '探索你的舒适区';
  if (changeView) {
    if (id === 'air') beginFirmness(activeZone, false, 'rest');
    else if (id === 'structure') setView('explode', false);
    else if (id === 'material') previewMaterial();
    else if (view === 'explode') setView('solid', false);
  }
  if (id === 'material') updateMaterialUI();
}
function setPreset(id) {
  const preset = PRESETS[id];
  target.back = preset.back;
  target.leg = preset.leg;
  $$('[data-preset]').forEach((b) => {
    b.classList.toggle('active', b.dataset.preset === id);
    b.setAttribute('aria-pressed', String(b.dataset.preset === id));
  });
  for (const key of ['back', 'leg']) {
    $(`#${key}-angle`).value = target[key];
    $(`#${key}-value`).innerHTML = `${target[key]}<span>°</span>`;
    paintRange($(`#${key}-angle`));
  }
  $('#status-text').textContent = preset.name + '姿态';
}
function updatePressureMap(values = target.pressures) {
  for (let s = 0; s < 2; s++)
    for (let z = 0; z < 4; z++) {
      const el = $(`#zone-${s}-${z}`),
        v = Math.round(values[s][z]);
      el.style.setProperty('--pressure', v / 100);
      el.querySelector('small').textContent = `${v}%`;
    }
}
function updatePressureControls(values = target.pressures) {
  ZONES.forEach((_, i) => {
    const a = values[0][i],
      b = values[1][i],
      value = activeSide === 'right' ? b : activeSide === 'left' ? a : (a + b) / 2;
    $(`#pressure-${i}`).value = value;
    paintRange($(`#pressure-${i}`));
    $(`#pressure-value-${i}`).innerHTML =
      activeSide === 'both' && a !== b
        ? `${Math.round(a)} / ${Math.round(b)}<span>%</span>`
        : `${Math.round(value)}<span>%</span>`;
  });
  updatePressureMap(values);
}

function selectAirSide(side) {
  activeSide = side;
  $$('[data-side]').forEach((el) => {
    const selected = el.dataset.side === side;
    el.classList.toggle('active', selected);
    el.setAttribute('aria-pressed', String(selected));
  });
  $$('.air-column').forEach((el, s) =>
    el.classList.toggle('dimmed', !sideIndices(side).includes(s)),
  );
  $('#air-control-label').textContent =
    `${SIDE_NAMES[side]} · ${side === 'both' ? '同部位同步' : '四区独立'}`;
  updatePressureControls();
  updateHeatControls();
}

function updateHeatControls(values = target.heating) {
  $$('[data-heat-level]').forEach((button) => {
    const region = Number(button.dataset.heatRegion),
      level = Number(button.dataset.heatLevel);
    const selected = sideIndices(activeSide).every((s) => Math.round(values[s][region]) === level);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function stopAutoDemo() {
  if (!autoDemo) return;
  const closing = airReveal.side && airReveal.progress > 0;
  const closingSide = airReveal.side;
  autoDemo = null;
  demoFrame = null;
  $('#auto-demo').setAttribute('aria-pressed', 'false');
  $('#stop-auto-demo').hidden = true;
  $('#auto-demo b').textContent = '开始自动循环';
  $('#auto-demo-count').textContent = 'DEMO';
  $('#auto-demo-status').textContent = '已停止，正在恢复手动设定。';
  $('.auto-demo-progress i').style.width = '0%';
  airTransition = closing
    ? {
        closing: true,
        side: closingSide,
        start: performance.now() - (1 - airReveal.progress) * REVEAL_TIMING.scan,
      }
    : null;
  if (closing) firmnessSelection = { ...firmnessSelection, kind: 'exit' };
  updatePressureControls();
  updateHeatControls();
  firmnessUntil = performance.now() + 1500;
  dirty = true;
}

function toggleAutoDemo() {
  if (autoDemo) {
    stopAutoDemo();
    return;
  }
  stopCycle();
  beginFirmness(0, false, 'rest');
  autoDemo = { started: performance.now(), step: -1 };
  $('#auto-demo').setAttribute('aria-pressed', 'true');
  $('#auto-demo b').textContent = '停止自动循环';
  $('#stop-auto-demo').hidden = false;
}

function stopCycle() {
  massage = false;
  $('#massage').setAttribute('aria-checked', 'false');
  updatePressureMap();
}

function beginFirmness(zone, animateEffect = true, kind = 'air') {
  const previous = firmnessSelection,
    previousSide = previous?.side,
    now = performance.now();
  if (!firmnessSelection) {
    setView('solid', false);
    current.xray = 0;
    current.explode = 0;
  }
  activeZone = zone;
  firmnessSelection = { side: activeSide, zone, kind };
  heatingEffect.root.visible = true;
  firmnessUntil = now + (animateEffect ? 4800 : 0);
  dirty = true;
  $('.stage').classList.add('firmness-mode');
  scene.getObjectByName('Studio_Floor').visible = false;
  for (const selector of ['.firmness-heading', '.firmness-hud', '.firmness-caption-bar'])
    $(selector).hidden = false;
  $('.firmness-hud').dataset.side = activeSide;
  $('.firmness-hud').dataset.kind = kind;
  $$('[data-air-zone]').forEach((el) => {
    const selected = isSelectedZone(
      firmnessSelection,
      Number(el.dataset.airSide),
      Number(el.dataset.airZone),
    );
    el.classList.toggle('selected', selected);
    el.setAttribute('aria-pressed', String(selected));
  });
  $$('[data-pressure]').forEach((el) =>
    el
      .closest('.slider-block')
      .classList.toggle('selected', kind === 'air' && Number(el.dataset.pressure) === zone),
  );
  $('#cycle-region').textContent = `${SIDE_NAMES[activeSide]} · ${ZONES[zone].name}`;
  $('#firmness-announcement').textContent =
    `${SIDE_NAMES[activeSide]}${ZONES[zone].name}，${kind === 'heat' ? '上层加热' : '内部气囊调节'}。`;
  controls.autoRotate = false;
  $('#rotate').setAttribute('aria-pressed', 'false');
  pendingLayerFocus = null;
  cameraTarget = null;
  const fly =
    kind !== 'rest' && (previousSide !== activeSide || cameraView !== `firmness-${activeSide}`);
  if (fly) {
    const focus = firmnessCamera(activeSide, zone),
      oldTarget = controls.target.clone();
    const fromPosition = camera.position.clone();
    if (camera !== perspectiveCamera) {
      camera = perspectiveCamera;
      camera.position.copy(fromPosition);
      configureControls(oldTarget);
    }
    // Clear residual drag damping before starting a deterministic camera flight.
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const to = new THREE.Spherical(
      focus.radius,
      focus.polar,
      shortestAngle(from.theta, focus.azimuth),
    );
    const toTarget = new THREE.Vector3(...focus.target);
    if (reducedMotion.matches) {
      camera.position.copy(toTarget).add(new THREE.Vector3().setFromSpherical(to));
      controls.target.copy(toTarget);
      firmnessFlight = null;
    } else firmnessFlight = { start: now, fromTarget: controls.target.clone(), toTarget, from, to };
    cameraView = `firmness-${activeSide}`;
    $$('[data-camera]').forEach((el) => el.classList.remove('active'));
  }
  if (kind === 'air' && !autoDemo) {
    if (
      !airTransition ||
      previous?.kind !== 'air' ||
      previousSide !== activeSide ||
      previous?.zone !== zone ||
      now - lastAirInput > 350
    ) {
      airTransition = {
        start: now,
        flight: reducedMotion.matches
          ? 0
          : firmnessFlight
            ? Math.max(0, REVEAL_TIMING.flight - (now - firmnessFlight.start))
            : 0,
      };
    }
    lastAirInput = now;
  } else airTransition = null;
  airReveal =
    autoDemo && demoFrame
      ? showroomDemoReveal(demoFrame, reducedMotion.matches)
      : sampleAirReveal(firmnessSelection, airTransition, now, reducedMotion.matches);
  firmnessEffect.root.visible = false;
  $('#projection-label').textContent = `${SIDE_NAMES[activeSide]} · 分区调节`;
  $('#status-right').textContent = '独立分区控制';
  updateFirmnessHUD(performance.now());
}

function updateFirmnessHUD(ms) {
  const side = SIDE_NAMES[activeSide],
    sides = sideIndices(activeSide),
    zone = firmnessSelection.zone;
  const heat = firmnessSelection.kind === 'heat',
    region = HEAT_ZONES.findIndex((r) => r.zone === zone),
    key = heat ? 'heating' : 'pressures',
    index = heat ? region : zone;
  const desired = autoDemo && demoFrame ? demoFrame : target;
  const value = sides.reduce((sum, s) => sum + current[key][s][index], 0) / sides.length;
  const values = sides.map((s) => Math.round(current[key][s][index]));
  const targets = sides.map((s) => Math.round(desired[key][s][index]));
  const settling = sides.some(
    (s) => Math.abs(current[key][s][index] - desired[key][s][index]) > (heat ? 0.03 : 0.5),
  );
  const phase =
    airReveal.phase === 'camera'
      ? '视角定位中'
      : airReveal.phase === 'scan'
        ? '扫描当前侧'
        : airReveal.phase === 'closing'
          ? '扫描恢复外观'
          : firmnessSelection.kind === 'rest'
            ? '整床待命'
            : autoDemo
              ? '自动循环中'
              : massage
                ? '单区循环中'
                : settling
                  ? '正在调节'
                  : ms < firmnessUntil
                    ? '调节已响应'
                    : '已设定';
  $('#firmness-channel').textContent = {
    left: 'LEFT CHANNEL',
    right: 'RIGHT CHANNEL',
    both: 'DUAL CHANNEL',
  }[activeSide];
  $('#firmness-phase').textContent = phase;
  $('#firmness-address').textContent = heat ? 'UPPER / 上层加热' : 'INNER / 内部气囊';
  $('#firmness-name').textContent = `${side} · ${ZONES[zone].name}`;
  $('#firmness-current').textContent = heat
    ? [...new Set(values.map((v) => HEAT_LEVELS[v]))].join('/')
    : [...new Set(values)].join(' / ');
  $('#firmness-unit').textContent = heat ? '' : '%';
  $('#firmness-target').textContent =
    `${heat ? '温热' : '目标'} ${[...new Set(targets.map((v) => (heat ? HEAT_LEVELS[v] : `${v}%`)))].join(' / ')}`;
  $('#firmness-min').textContent = heat ? '关闭' : '偏软';
  $('#firmness-max').textContent = heat ? '高档' : '偏硬';
  $('.firmness-meter i').style.width = `${heat ? (value / 3) * 100 : value}%`;
  $('#heat-live-readout').textContent = HEAT_ZONES.map(
    (r, i) =>
      `${r.name} ${[...new Set(sides.map((s) => HEAT_LEVELS[Math.round(current.heating[s][i])]))].join('/')}`,
  ).join(' · ');
  $('#status-text').textContent = `${side}${ZONES[zone].name} · ${phase}`;
}

function endFirmness() {
  if (!firmnessSelection) return;
  stopAutoDemo();
  stopCycle();
  firmnessSelection = null;
  firmnessFlight = null;
  firmnessUntil = 0;
  airTransition = null;
  firmnessEffect.root.visible = heatingEffect.root.visible = false;
  $('.stage').classList.remove('firmness-mode');
  scene.getObjectByName('Studio_Floor').visible = true;
  $('#projection-label').textContent = camera.isOrthographicCamera
    ? '正投影 · 自由观察'
    : 'REALTIME 3D';
  $('#status-text').textContent = '气囊手动调节';
  for (const selector of ['.firmness-heading', '.firmness-hud', '.firmness-caption-bar'])
    $(selector).hidden = true;
  dirty = true;
}
function updateMaterialUI() {
  const c = materialLibrary.config[activePart];
  $('#material-name').textContent = c.label;
  $('#material-description').textContent = {
    retainer: '通用软包挡板 · 随腿板联动',
    retainerLogo: '挡板正面压印 · 可替换透明标识图',
    brand: '床垫左侧品牌绣标 · 随围边贴合',
    modelMark: '床垫右侧型号绣标 · 随围边贴合',
    leather: HEADBOARD_STYLES[bed.headboardStyle] + ' · 独立落地',
    waistband: '浅色罗纹织带 · 可独立换色',
    surround: '床邦与床尾 · 统一皮革',
    fabric: '可选绗缝与织纹',
    side: '围边花纹 · 自由搭配',
    piping: '勾勒床垫与床体轮廓',
    frame: '金属结构 · 精密支撑',
    foam: '三层结构 · 基础承托',
  }[activePart];
  const patterns = PATTERN_OPTIONS[activePart] || [];
  $('#pattern-field').hidden = !patterns.length;
  $('#material-pattern').innerHTML = patterns
    .map((id) => `<option value="${id}">${PATTERNS[id]}</option>`)
    .join('');
  $('#material-pattern').value = c.pattern || '';
  $('#material-color').value = c.color;
  $('#roughness').value = c.roughness;
  $('#roughness-value').textContent = c.roughness.toFixed(2);
  $('#texture-repeat').value = c.repeat[0];
  $('#repeat-value').textContent = c.repeat.join(' × ');
  $('.material-orb').style.setProperty('--material-color', c.color);
  $$('.swatch').forEach((b) => b.classList.toggle('active', b.dataset.color === c.color));
  $('#texture-filename').textContent =
    c.maps[$('#texture-channel').value] || '点击选择图片，即时预览';
  $$('input[type=range]').forEach(paintRange);
}
function previewMaterial() {
  const layer = activePart === 'foam' ? 'foundation' : null;
  setView(layer ? 'explode' : 'solid', false);
  if (layer) focusAnatomy(layer);
}
function focusAnatomy(id) {
  bed.selectedLayer = id;
  dirty = true;
  $$('[data-layer]').forEach((el) => {
    const active = el.dataset.layer === id;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
  if (id) {
    controls.autoRotate = false;
    $('#rotate').setAttribute('aria-pressed', 'false');
    pendingLayerFocus = id;
  } else setCamera('exploded');
}

function updateAppearanceUI() {
  $('#headboard-style').value = bed.headboardStyle;
  $('#waistband-toggle').checked = bed.waistbandEnabled;
  $('#label-leather div').innerHTML =
    `${bed.headboardStyle === 'channel' ? '竖向分格落地床屏' : '双靠包落地床屏'}<small>FLOOR-STANDING HEADBOARD</small>`;
  $$('[data-bed-style]').forEach((el) => {
    const selected = el.dataset.bedStyle === bed.surroundStyle;
    el.classList.toggle('active', selected);
    el.setAttribute('aria-pressed', String(selected));
  });
}
function applyCollection(id) {
  const collection = COLLECTIONS.find((c) => c.id === id);
  materialLibrary.applyCollection(id);
  bed.setHeadboardStyle(collection.headboard || 'cushion');
  bed.setWaistband(!!collection.waistband);
  bed.setSurroundAccents(collection.surroundAccents !== false);
  dirty = true;
  updateAppearanceUI();
  $$('[data-collection]').forEach((el) => {
    const selected = el.dataset.collection === id;
    el.classList.toggle('active', selected);
    el.setAttribute('aria-pressed', String(selected));
  });
}
function bindUI() {
  for (const event of ['click', 'input', 'change'])
    $('#app').addEventListener(event, () => {
      needsRender = true;
    });
  $$('[data-bed-style]').forEach((b) =>
    b.addEventListener('click', () => {
      bed.setSurroundStyle(b.dataset.bedStyle);
      dirty = true;
      $$('[data-bed-style]').forEach((el) => {
        el.classList.toggle('active', el === b);
        el.setAttribute('aria-pressed', String(el === b));
      });
      updateDimensions();
    }),
  );
  $('#headboard-view').addEventListener('click', () =>
    setView(view === 'headboard' ? 'solid' : 'headboard'),
  );
  $('#mechanism-view').addEventListener('click', () =>
    setView(view === 'mechanism' ? 'solid' : 'mechanism'),
  );
  $('#deck-panels').addEventListener('click', () => {
    showDecks = !showDecks;
    $('#deck-panels').setAttribute('aria-pressed', String(showDecks));
    $('#deck-panels').textContent = showDecks ? '隐藏床板，查看机构' : '显示五段床板';
    dirty = true;
  });
  const custom = () => {
    materialLibrary.collection = null;
    $$('[data-collection]').forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
  };
  $('#headboard-style').addEventListener('change', (e) => {
    bed.setHeadboardStyle(e.target.value);
    custom();
    updateAppearanceUI();
    dirty = true;
  });
  $('#waistband-toggle').addEventListener('change', (e) => {
    bed.setWaistband(e.target.checked);
    custom();
    dirty = true;
  });
  $$('[data-collection]').forEach((b) =>
    b.addEventListener('click', () => {
      applyCollection(b.dataset.collection);
      activePart = 'fabric';
      $('#material-part').value = activePart;
      previewMaterial();
      updateMaterialUI();
      needsRender = true;
      toast(`${COLLECTIONS.find((c) => c.id === b.dataset.collection).name} · 整床搭配已应用`);
    }),
  );
  $('#material-detail').addEventListener('click', () => {
    if (activePart === 'foam') {
      focusAnatomy('foundation');
      return;
    }
    setView('solid', false);
    setCamera('perspective');
    controls.autoRotate = false;
    $('#rotate').setAttribute('aria-pressed', 'false');
    const head = activePart === 'leather',
      base = activePart === 'surround' || activePart === 'frame';
    if (['retainer', 'retainerLogo', 'brand', 'modelMark'].includes(activePart)) {
      cameraTarget = {
        position: new THREE.Vector3(0.42, 0.7, 2.25),
        target: new THREE.Vector3(0, 0.46, 0.94),
      };
      return;
    }
    cameraTarget = {
      position: new THREE.Vector3(...(head ? [0.75, 1.12, 0.23] : [1.85, base ? 0.43 : 0.8, 0.62])),
      target: new THREE.Vector3(...(head ? [0.05, 0.89, -1.11] : [0.65, base ? 0.22 : 0.52, 0.1])),
    };
    $$('[data-camera]').forEach((b) => b.classList.remove('active'));
  });
  $('#material-pattern').addEventListener('change', (e) => {
    materialLibrary.setPattern(activePart, e.target.value);
    custom();
    updateMaterialUI();
    needsRender = true;
  });

  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => activateTab(b.dataset.tab)));
  $$('[data-layer]').forEach((b) =>
    b.addEventListener('click', () => {
      if (view !== 'explode') setView('explode');
      focusAnatomy(bed.selectedLayer === b.dataset.layer ? null : b.dataset.layer);
    }),
  );
  $('#show-all-layers').addEventListener('click', () => focusAnatomy(null));
  $$('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => setPreset(b.dataset.preset)),
  );
  for (const key of ['back', 'leg'])
    $(`#${key}-angle`).addEventListener('input', (e) => {
      target[key] = Number(e.target.value);
      $(`#${key}-value`).innerHTML = `${target[key]}<span>°</span>`;
      paintRange(e.target);
      $$('[data-preset]').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      $('#status-text').textContent = '自定义姿态';
    });
  $('#flat-reset').addEventListener('click', () => setPreset('flat'));
  $$('[data-camera]').forEach((b) =>
    b.addEventListener('click', () => setCamera(b.dataset.camera)),
  );
  $('#reset-view').addEventListener('click', () => setCamera('perspective'));
  $('#rotate').addEventListener('click', () => {
    stopAutoDemo();
    firmnessFlight = null;
    if (camera.isOrthographicCamera) setCamera('perspective');
    controls.autoRotate = !controls.autoRotate;
    cameraTarget = null;
    $('#rotate').setAttribute('aria-pressed', String(controls.autoRotate));
  });
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $$('[data-side]').forEach((b) =>
    b.addEventListener('click', () => {
      stopAutoDemo();
      stopCycle();
      selectAirSide(b.dataset.side);
      beginFirmness(activeZone, true, firmnessSelection?.kind || 'rest');
    }),
  );
  $$('[data-air-zone]').forEach((b) =>
    b.addEventListener('click', () => {
      stopAutoDemo();
      stopCycle();
      selectAirSide(b.dataset.airSide === '0' ? 'left' : 'right');
      beginFirmness(Number(b.dataset.airZone));
    }),
  );
  $$('[data-pressure]').forEach((input) =>
    input.addEventListener('input', (e) => {
      stopAutoDemo();
      stopCycle();
      const index = Number(e.target.dataset.pressure);
      target.pressures = setZonePressure(
        target.pressures,
        activeSide,
        index,
        Number(e.target.value),
      );
      updatePressureControls();
      beginFirmness(index);
    }),
  );
  $('#massage').addEventListener('click', () => {
    stopAutoDemo();
    if (massage) {
      stopCycle();
      firmnessUntil = performance.now() + 1000;
    } else {
      beginFirmness(activeZone);
      cycleStarted = performance.now();
      massage = true;
      $('#massage').setAttribute('aria-checked', 'true');
    }
  });
  $('#auto-demo').addEventListener('click', toggleAutoDemo);
  $('#stop-auto-demo').addEventListener('click', stopAutoDemo);
  $$('[data-heat-level]').forEach((button) =>
    button.addEventListener('click', () => {
      stopAutoDemo();
      stopCycle();
      const region = Number(button.dataset.heatRegion);
      target.heating = setHeatLevel(
        target.heating,
        activeSide,
        region,
        Number(button.dataset.heatLevel),
      );
      beginFirmness(HEAT_ZONES[region].zone, true, 'heat');
      updateHeatControls();
    }),
  );
  $('#exit-firmness').addEventListener('click', () => setView('solid', false));
  $('#material-part').addEventListener('change', (e) => {
    activePart = e.target.value;
    previewMaterial();
    updateMaterialUI();
  });
  $$('[data-color]').forEach((b) =>
    b.addEventListener('click', () => {
      materialLibrary.update(activePart, { color: b.dataset.color });
      custom();
      updateMaterialUI();
    }),
  );
  $('#material-color').addEventListener('input', (e) => {
    materialLibrary.update(activePart, { color: e.target.value });
    custom();
    updateMaterialUI();
  });
  $('#roughness').addEventListener('input', (e) => {
    materialLibrary.update(activePart, { roughness: Number(e.target.value) });
    custom();
    $('#roughness-value').textContent = Number(e.target.value).toFixed(2);
    paintRange(e.target);
  });
  $('#texture-repeat').addEventListener('input', (e) => {
    const n = Number(e.target.value);
    materialLibrary.update(activePart, { repeat: [n, n] });
    custom();
    $('#repeat-value').textContent = `${n} × ${n}`;
    paintRange(e.target);
  });
  $('#texture-channel').addEventListener('change', updateMaterialUI);
  $('#texture-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast('请选择 PNG、JPG 或 WebP 图片');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast('图片请控制在 20 MB 以内');
      e.target.value = '';
      return;
    }
    const part = activePart,
      channel = $('#texture-channel').value,
      url = URL.createObjectURL(file);
    try {
      await materialLibrary.replace(part, channel, url, file.name);
      if (channel === 'map') materialLibrary.update(part, { color: '#ffffff' });
      custom();
      needsRender = true;
      updateMaterialUI();
      toast(`${materialLibrary.config[part].label}纹理已替换`);
    } catch {
      toast('纹理读取失败，请检查图片文件');
    } finally {
      URL.revokeObjectURL(url);
      e.target.value = '';
    }
  });
  $('#reset-material').addEventListener('click', () => {
    materialLibrary.reset(activePart);
    custom();
    updateMaterialUI();
    dirty = true;
    toast('当前部件材质已恢复');
  });
  $('#capture').addEventListener('click', () => {
    const canvas = renderer.domElement;
    renderer.render(scene, camera);
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#111a1d';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    ctx.fillStyle = '#b8cfc8';
    ctx.font = `${out.width / 55}px sans-serif`;
    ctx.fillText('NOCTIS / SMART SLEEP LAB', out.width * 0.05, out.height * 0.09);
    out.toBlob((b) => {
      if (b) {
        download(b, 'NOCTIS-smart-bed.png');
        toast('模型视图已保存');
      }
    }, 'image/png');
  });
  $('#export-config').addEventListener('click', () => {
    const config = {
      version: 17,
      presentation: firmnessSelection
        ? { mode: 'integrated-side-scan', ...firmnessSelection }
        : null,
      heating: target.heating,
      heatingUnits: 'visual-level-0-to-3',
      retainer: bed.cadFrame.retainer.userData,
      branding: bed.branding.map((m) => m.userData),
      modelView: view,
      showDecks,
      frameReference: 'BZZ1-007-160X190.stp',
      dimensions: {
        mattress: DIMENSIONS,
        surround: bed.layout,
        headboard: bed.headboard.userData.dimensions,
      },
      bedStyle: bed.surroundStyle,
      headboardStyle: bed.headboardStyle,
      waistband: bed.waistbandEnabled,
      surroundAccents: bed.surroundAccentsEnabled,
      collection: materialLibrary.collection,
      units: 'meters',
      pose: { back: target.back, leg: target.leg },
      pressures: target.pressures,
      materials: materialLibrary.config,
      textureNote:
        '上传纹理记录为文件名，请将图片放入 public/textures 并在 materials.js 配置 URL。',
    };
    download(
      new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }),
      'NOCTIS-config.json',
    );
    toast('配置已导出，纹理图片需单独保存');
  });
  $('#export-model').addEventListener('click', async () => {
    const button = $('#export-model'),
      snapshots = [];
    button.disabled = true;
    toast('正在生成当前姿态的 GLB 模型…');
    try {
      // GLB captures the physical model; shader-driven presentation stays in the viewer.
      const showroom = !!firmnessSelection;
      if (showroom) bed.update({ ...current, xray: 0, showroom: false });
      const model = bed.root.clone(true),
        materialCopies = new Map();
      model.traverse((o) => {
        if (o.userData.rest) delete o.userData.rest;
        // Freeze geometry and material values while an asynchronous export encodes images.
        if (o.geometry) {
          o.geometry = o.geometry.clone();
          o.geometry.deleteAttribute('showroomPosition');
          snapshots.push(o.geometry);
        }
        if (o.material) {
          const clone = (m) => {
            if (!materialCopies.has(m)) {
              const copy = m.clone();
              materialCopies.set(m, copy);
              snapshots.push(copy);
            }
            return materialCopies.get(m);
          };
          o.material = Array.isArray(o.material) ? o.material.map(clone) : clone(o.material);
        }
      });
      if (showroom) bed.update({ ...current, showroom: true, airReveal });
      const data = await new GLTFExporter().parseAsync(model, {
        binary: true,
        onlyVisible: true,
        maxTextureSize: 2048,
      });
      download(new Blob([data], { type: 'model/gltf-binary' }), 'NOCTIS-current-pose.glb');
      toast('当前姿态已导出，全息与交互动画保留在网页源码中');
    } catch (e) {
      console.error(e);
      toast('模型导出失败，请重试');
    } finally {
      snapshots.forEach((item) => item.dispose());
      button.disabled = false;
      dirty = true;
    }
  });
  $$('input[type=range]').forEach(paintRange);
  selectAirSide(activeSide);
}

try {
  await prepareBrandArtwork();
  initScene();
  bindUI();
  $('.version').textContent = 'V.17';
} catch (error) {
  console.error(error);
  $('#loading').innerHTML =
    '<strong>无法启动 3D 视图</strong><span>请使用支持 WebGL 2 的浏览器，并开启图形加速后重试。</span>';
}

// Read-only snapshots support integration checks without coupling tests to mesh ordering.
window.noctis = {
  getState: () =>
    structuredClone({
      target,
      current,
      view,
      massage,
      activeSide,
      activeZone,
      firmnessSelection,
      bedStyle: bed?.surroundStyle,
      headboardStyle: bed?.headboardStyle,
      waistband: bed?.waistbandEnabled,
      materials: materialLibrary?.config,
    }),
  getDiagnostics: () => ({
    webgl: !!renderer,
    retainer: bed?.cadFrame.retainer.userData,
    branding: bed?.branding.map((m) => ({
      name: m.name,
      visible: m.visible && bed.mattress.visible,
    })),
    bedStyle: bed?.surroundStyle,
    layout: bed?.layout,
    dimensions: DIMENSIONS,
    headboardDimensions: bed?.headboard.userData.dimensions,
    headboardStyle: bed?.headboardStyle,
    waistbandVisible: !!(bed?.waistband.visible && bed?.mattress.visible),
    projection: camera?.type,
    cameraView,
    cameraPosition: camera?.position.toArray(),
    cameraTarget: controls?.target.toArray(),
    firmness: {
      visible: !!firmnessEffect?.root.visible,
      selection: firmnessSelection,
      moving: !!firmnessEffect?.moving,
      flight: !!firmnessFlight,
      activeTiles: firmnessEffect?.entries
        .filter((e) => e.tile.material.uniforms.focus.value === 1)
        .map((e) => ({ side: e.side, zone: e.zone })),
    },
    materialMaps:
      materialLibrary &&
      Object.fromEntries(
        Object.entries(materialLibrary.materials).map(([id, m]) => [
          id,
          {
            type: m.type,
            normal: !!m.normalMap,
            roughness: !!m.roughnessMap,
            width: m.map?.image?.width,
            height: m.map?.image?.height,
            anisotropy: m.map?.anisotropy,
          },
        ]),
      ),
    meshCount: bed ? countMeshes(bed.root) : 0,
    drawCalls: renderer?.info.render.calls,
    renderCount,
    lastModelUpdateMs,
    triangles: renderer?.info.render.triangles,
    airbags: bed?.airbags.map((b) => ({
      side: b.side,
      zone: b.zone,
      halfHeight: b.halfHeight,
      shape: b.cells[0].name,
      y: b.group.position.y,
    })),
    coverBounds: bed?.cover.geometry.boundingSphere?.radius,
    selectedLayer: bed?.selectedLayer,
    anatomy: bed?.anatomy.layers.map((l) => ({
      id: l.id,
      visible: bed.anatomy.entries[l.id].group.visible,
      meshes: countMeshes(bed.anatomy.entries[l.id].group),
    })),
    coverVisible: !!(bed?.cover.visible && bed?.mattress.visible),
    headboardOnly: view === 'headboard',
    showDecks,
    deckCount: bed?.decks.length,
    headboardVisible: bed?.headboard.visible,
    motors: bed?.linkage?.actuators.map((a) => ({
      id: a.id,
      anchor: a.anchor,
      moving: a.moving,
      length: a.length,
      stroke: a.stroke,
      barrelLength: a.barrelLength,
      armAngle: a.armAngle,
      roller: a.roller,
      trackPosition: a.trackPosition,
    })),
    collection: materialLibrary?.collection,
  }),
};
function countMeshes(root) {
  let n = 0;
  root.traverse((o) => {
    if (o.isMesh) n++;
  });
  return n;
}
window.noctis.getShowroomState = () =>
  structuredClone({
    automatic: !!autoDemo,
    step: demoFrame?.index ?? null,
    cycle: demoFrame?.cycle ?? null,
    label: demoFrame?.label ?? null,
    airReveal,
    coverOpacity: bed?.coverReveal.uniforms.revealOpacity.value,
    revealedSides: bed?.coverReveal.uniforms.revealSides.value.toArray(),
    airVisible: !!bed?.airGroup.visible,
    visibleAirSides: bed?.airGroup.visible
      ? [...new Set(bed.airbags.filter((b) => b.group.visible).map((b) => b.side))]
      : [],
    comfortVisible: !!bed?.comfort.visible && !!bed?.anatomy.entries.comfort.group.visible,
    heatingVisible: !!heatingEffect?.root.visible,
    heatPatches: heatingEffect?.entries.map((e) => ({
      side: e.side,
      region: e.region,
      amount: e.mesh.material.uniforms.amount.value,
      waves: e.waves.visible,
    })),
  });

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MaterialLibrary, MATERIAL_CONFIG } from './materials.js';
import { SmartBed } from './model.js';
import { ANATOMY_LAYERS } from './anatomy.js';
import { COLLECTIONS,COLOR_SWATCHES,PATTERNS,PATTERN_OPTIONS,HEADBOARD_STYLES,DEFAULT_COLLECTION } from './cmf.js';
import { PRESETS, ZONES, clamp } from './kinematics.js';
import { DIMENSIONS, HEADBOARD_LAYOUT } from './dimensions.js';
import { prepareBrandArtwork } from './branding.js';
import './style.css';

const icons = {
  mark:'<path d="M5 20V4l14 16V4"/>',
  download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  reset:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  orbit:'<ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-30 12 12)"/><circle cx="12" cy="12" r="3"/>',
  top:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 8h14M8 5h3m2 0h3"/>',
  side:'<path d="M3 18h18M4 17V8l7 7h9v3M4 10l7 7"/>',
  eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  layers:'<path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4"/>',
  upload:'<path d="M12 16V4m-4 4 4-4 4 4M4 16v5h16v-5"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
  pause:'<path d="M8 5v14M16 5v14"/>',
  play:'<path d="m8 4 12 8-12 8V4Z"/>',
};
const icon=(name)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.orbit}</svg>`;
const bedIcon=(type)=>`<svg class="bed-icon" viewBox="0 0 92 38" fill="none" aria-hidden="true"><path d="M8 28h76M12 28v6m68-6v6" stroke="currentColor" opacity=".3" stroke-width="2"/><path d="${({flat:'M12 22h68',read:'M12 6l29 16h22l11-4 6 4',zero:'M12 12l27 13h14l15-12 12 8',relax:'M12 18l26 7h14l15-16 13 12'})[type]}" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

document.querySelector('#app').innerHTML=`
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
      <div class="camera-tools" aria-label="视角控制"><button data-camera="perspective" class="icon-button active" title="立体视角" aria-label="立体视角">${icon('orbit')}</button><button data-camera="side" class="icon-button" title="正投影侧视：核对接合与高度" aria-label="正投影侧视">${icon('side')}</button><button data-camera="top" class="icon-button" title="正投影俯视：核对长宽比例" aria-label="正投影俯视">${icon('top')}</button><i></i><button id="reset-view" class="icon-button" title="复位视角" aria-label="复位视角">${icon('reset')}</button></div>
      <div class="model-label" id="label-leather"><span></span><div>双靠包落地床屏<small>FLOOR-STANDING HEADBOARD</small></div></div>
      <div class="model-label" id="label-air"><span></span><div id="air-label-text">自适应气囊支撑<small>8 INDEPENDENT ZONES</small></div></div>
      <div class="layer-markers" hidden>${ANATOMY_LAYERS.map((layer,i)=>`<button class="layer-marker" data-layer="${layer.id}" style="--layer-color:${layer.color}" title="${layer.label}" aria-label="定位${layer.label}">${String(i+1).padStart(2,'0')}</button>`).join('')}</div>
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
          <dl class="dimension-readout" aria-label="当前整床尺寸"><div><dt>床垫 · 宽 × 长 × 厚</dt><dd>160 × 190 × 21 cm</dd></div><div><dt>床邦 · 外宽 × 外长</dt><dd id="surround-size"></dd></div><div><dt>床屏 · 宽 × 高</dt><dd id="headboard-size"></dd></div></dl><p class="fine-print" id="bed-style-note"></p><label class="field-label" for="headboard-style">床屏造型</label><select id="headboard-style">${Object.entries(HEADBOARD_STYLES).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select><label class="waistband-toggle" for="waistband-toggle"><span>床垫腰线织带</span><input id="waistband-toggle" type="checkbox"/></label>
          <button class="text-button" id="headboard-view" aria-pressed="false">${icon('eye')}<span>单独查看床屏</span>${icon('arrow')}</button><div class="section-label spacing">舒适，一键就位 <span>01—04</span></div>
          <div class="preset-grid">${Object.entries(PRESETS).map(([id,p],i)=>`<button data-preset="${id}" class="preset ${id==='flat'?'active':''}" aria-pressed="${id==='flat'}"><span class="preset-index">0${i+1}</span>${bedIcon(id)}<span class="preset-name">${p.name}<small>${({flat:'FLAT',read:'READING',zero:'ZERO GRAVITY',relax:'RELAX'})[id]}</small></span><span class="selected-dot"></span></button>`).join('')}</div>
          <div class="section-label spacing">精细调节 <span>ANGLE CONTROL</span></div>
          <div class="slider-block"><label for="back-angle">背部抬升 <output id="back-value">0<span>°</span></output></label><input id="back-angle" type="range" min="0" max="65" value="0"/><div class="range-scale"><span>0°</span><span>65°</span></div></div>
          <div class="slider-block"><label for="leg-angle">腿部抬升 <output id="leg-value">0<span>°</span></output></label><input id="leg-angle" type="range" min="0" max="35" value="0"/><div class="range-scale"><span>0°</span><span>35°</span></div></div>
          <div class="support-note"><span class="note-symbol">⌁</span><div>床垫随床架连续贴合<small>五段床板 · 摆臂滚轮抬升</small></div></div>
          <button class="mechanism-button" id="mechanism-view" aria-pressed="false">${icon('layers')}查看电动床架${icon('arrow')}</button><div id="mechanism-readout" hidden><span>背部推杆 <b id="back-stroke">0 mm</b></span><span>腿部推杆 <b id="leg-stroke">0 mm</b></span><small>BZZ1-007 · 参考规格 160 × 190 cm<br>纵向保留 STEP 尺寸 · 行程为动画计算值</small><button class="text-button" id="deck-panels" aria-pressed="false">显示五段床板</button></div><button class="text-button" id="flat-reset">${icon('reset')}一键恢复平躺${icon('arrow')}</button>
        </div>
        <div id="pane-air" role="tabpanel" aria-labelledby="tab-air" class="pane" hidden>
          <div class="section-label">分区支撑 <span>8 AIR ZONES</span></div>
          <div class="side-select" role="group" aria-label="气囊调节侧"><button class="active" data-side="both">双侧同步</button><button data-side="left">左侧</button><button data-side="right">右侧</button></div>
          <div class="air-map" aria-label="八气囊示意">${['L','R'].map((s,side)=>`<div class="air-column"><span>${s==='L'?'左侧 L':'右侧 R'}</span>${ZONES.map((z,i)=>`<div class="air-zone" id="zone-${side}-${i}"><i></i><b>${z.name}</b><small>50%</small></div>`).join('')}</div>`).join('')}</div>
          <div class="air-sliders">${ZONES.map((z,i)=>`<div class="slider-block compact"><label for="pressure-${i}">${z.name}支撑 <output id="pressure-value-${i}">50<span>%</span></output></label><input id="pressure-${i}" data-pressure="${i}" type="range" min="0" max="100" value="50"/></div>`).join('')}</div>
          <div class="toggle-row"><div>循环充放气<small>观察各区气囊与表面起伏</small></div><button class="switch" id="massage" role="switch" aria-checked="false" aria-label="循环充放气"><span></span></button></div>
          <p class="fine-print">百分比表示演示充气量。左 / 右以床尾面向床屏的观察方向定义。</p>
        </div>
        <div id="pane-structure" role="tabpanel" aria-labelledby="tab-structure" class="pane" hidden>
          <div class="section-label">由外到内，看见支撑 <span>3 ESSENTIAL LAYERS</span></div>
          <p class="structure-intro">面料与舒适衬层合并展示，保留分区气囊和基础承托。点击一层即可靠近查看。</p>
          <div class="layer-list">${ANATOMY_LAYERS.map((layer,i)=>`<button data-layer="${layer.id}" class="layer-row" aria-pressed="false" aria-label="聚焦${layer.label}"><span class="layer-index" style="--layer-color:${layer.color}">${String(i+1).padStart(2,'0')}</span><span><strong>${layer.label}</strong><small>${layer.english}</small></span><span class="layer-focus">＋</span></button>`).join('')}</div>
          <button class="text-button" id="show-all-layers">${icon('layers')}查看全部层${icon('arrow')}</button>
          <p class="fine-print">三层为展示归类，层厚和气囊尺寸为示意。</p>
        </div>
        <div id="pane-material" role="tabpanel" aria-labelledby="tab-material" class="pane" hidden>
          <div class="section-label">设计师整床搭配 <span>${COLLECTIONS.length} COLLECTIONS</span></div>
          <div class="collection-grid">${COLLECTIONS.map(c=>`<button class="collection-card ${c.id===DEFAULT_COLLECTION?'active':''}" data-collection="${c.id}" aria-pressed="${c.id===DEFAULT_COLLECTION}" aria-label="${c.name}配色"><span class="collection-colors">${c.colors.slice(0,4).map(color=>`<i style="background:${color}"></i>`).join('')}</span><strong>${c.name}</strong><small>${c.mood}</small></button>`).join('')}</div>
          <p class="fine-print collection-note">暮蓝织序参考上传图片，搭配竖向分格床屏与浅色腰线；原有搭配仍可切换。</p>
          <div class="section-label spacing">定制部件 <span>COLOR & TEXTURE</span></div>
          <label class="field-label" for="material-part">选择部件</label><select id="material-part">${Object.entries(MATERIAL_CONFIG).map(([id,m])=>`<option value="${id}">${m.label}</option>`).join('')}</select>
          <div class="material-preview"><div class="material-orb"></div><div><strong id="material-name">床屏与床邦皮革</strong><span id="material-description">细腻纹理 · 柔和反光</span></div><span class="material-tag">PBR</span></div>
          <button class="text-button" id="material-detail">放大查看材质 ${icon('arrow')}</button><div class="swatch-row">${COLOR_SWATCHES.map(([name,color])=>`<button class="swatch" data-color="${color}" style="--swatch:${color}" title="${name}" aria-label="${name}"></button>`).join('')}<label class="custom-color" title="自定义颜色"><input id="material-color" type="color" value="#f3eee4" aria-label="自定义材质颜色"/><span>＋</span></label></div>
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
  <footer class="footer"><span>NOCTIS <i>/</i> 智能睡眠实验室</span><span class="footer-middle">让科技，安静地承托每一次休息。</span><div><button id="export-config">导出配置 ${icon('download')}</button><button id="export-model">导出模型 ${icon('download')}</button><span class="version">V.12</span></div></footer>
  <div id="toast" role="status" aria-live="polite"></div>
`;

const $=(q)=>document.querySelector(q), $$=(q)=>[...document.querySelectorAll(q)];
const target={back:0,leg:0,pressures:[[50,50,50,50],[50,50,50,50]],xray:0,explode:0};
const current=structuredClone(target);
let activeSide='both', activePart='fabric', view='solid', massage=false, toastTimer, materialLibrary, bed, renderer, scene, camera, controls;
let needsRender=true,renderCount=0,lastModelUpdateMs=0,showDecks=false;
let perspectiveCamera, orthographicCamera, cameraView='perspective';
let cameraTarget=null, pendingLayerFocus=null, lastTime=0, dirty=true, lastPressureUI=0, rafId;
const viewport=$('#viewport');
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3200);}
function paintRange(el){el.style.setProperty('--progress',`${(Number(el.value)-Number(el.min))/(Number(el.max)-Number(el.min))*100}%`);}
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}

function initScene(){
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.35));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;renderer.outputColorSpace=THREE.SRGBColorSpace;
  viewport.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','可旋转的智能床三维模型');
  scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x111a1d,0.075);
  perspectiveCamera=new THREE.PerspectiveCamera(37,1,.05,60);orthographicCamera=new THREE.OrthographicCamera(-2,2,2,-2,.05,60);
  camera=perspectiveCamera;camera.position.set(3.1,2.35,3.8);configureControls(new THREE.Vector3(0,.52,-.03));
  const pmrem=new THREE.PMREMGenerator(renderer), room=new RoomEnvironment();scene.environment=pmrem.fromScene(room,0.04).texture;room.dispose();pmrem.dispose();scene.environmentIntensity=0.55;
  scene.add(new THREE.HemisphereLight(0xdaf2f2,0x18262b,1.5));
  const key=new THREE.DirectionalLight(0xfff3df,3);key.position.set(2.0,5.5,3);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-3;key.shadow.camera.right=3;key.shadow.camera.top=3;key.shadow.camera.bottom=-3;key.shadow.normalBias=0.018;key.shadow.bias=-0.0002;scene.add(key);
  const fill=new THREE.DirectionalLight(0x8fceff,1.8);fill.position.set(-3,2.8,-2);scene.add(fill);
  const rim=new THREE.DirectionalLight(0x7ce4c8,1.8);rim.position.set(2,1,-3);scene.add(rim);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x070c0e,metalness:0.10,roughness:0.85}));floor.rotation.x=-Math.PI/2;floor.position.y=-0.005;floor.receiveShadow=true;scene.add(floor);
  const grid=new THREE.GridHelper(14,70,0x3a5357,0x243538);grid.material.transparent=true;grid.material.opacity=0.19;grid.position.y=0;scene.add(grid);
  const ring=new THREE.Mesh(new THREE.RingGeometry(1.81,1.815,160),new THREE.MeshBasicMaterial({color:0x659188,transparent:true,opacity:0.25,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.006;scene.add(ring);
  const outerRing=new THREE.Mesh(new THREE.RingGeometry(1.86,1.861,160),new THREE.MeshBasicMaterial({color:0x45645d,transparent:true,opacity:.23,side:THREE.DoubleSide}));outerRing.rotation.x=-Math.PI/2;outerRing.position.y=.006;scene.add(outerRing);
  materialLibrary=new MaterialLibrary(renderer,()=>{needsRender=true;});bed=new SmartBed(materialLibrary);scene.add(bed.root);bed.setSurroundStyle('flush');applyCollection(DEFAULT_COLLECTION);bed.update(current);
  updateDimensions();resize();new ResizeObserver(resize).observe(viewport);
  renderer.domElement.addEventListener('webglcontextlost',(e)=>{e.preventDefault();cancelAnimationFrame(rafId);toast('三维渲染已暂停，请刷新页面恢复');});
  $('#loading').classList.add('loaded');$('#loading').setAttribute('aria-hidden','true');requestAnimationFrame(animate);
}
function configureControls(target){
  controls?.dispose();controls=new OrbitControls(camera,renderer.domElement);controls.target.copy(target);
  controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=1.1;controls.maxDistance=8;controls.minZoom=.6;controls.maxZoom=4;
  controls.minPolarAngle=camera.isOrthographicCamera?0:.05;controls.maxPolarAngle=camera.isOrthographicCamera?Math.PI/2:Math.PI/2-.035;controls.autoRotateSpeed=.65;
  controls.addEventListener('start',()=>{cameraTarget=null;pendingLayerFocus=null;cameraView='orbit';$$('[data-camera]').forEach(b=>b.classList.remove('active'));$('#projection-label').textContent=camera.isOrthographicCamera?'正投影 · 自由观察':'REALTIME 3D';});
}
function resize(){
  if(!renderer)return;const {width,height}=viewport.getBoundingClientRect(),aspect=width/height;renderer.setSize(width,height);
  perspectiveCamera.aspect=aspect;perspectiveCamera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(37/2))*Math.max(1,1.08/aspect)));perspectiveCamera.updateProjectionMatrix();
  const span=Math.max(3.5,3.1/aspect);orthographicCamera.left=-span*aspect/2;orthographicCamera.right=span*aspect/2;orthographicCamera.top=span/2;orthographicCamera.bottom=-span/2;orthographicCamera.updateProjectionMatrix();needsRender=true;
}
function updateDimensions(){
  const cm=v=>Number((v*100).toFixed(1)),p=bed.layout;
  $('#surround-size').textContent=`${cm(p.outerWidth)} × ${cm(p.foot-HEADBOARD_LAYOUT.bedRear)} cm`;
  $('#headboard-size').textContent=`${cm(p.headboardWidth)} × ${cm(HEADBOARD_LAYOUT.height)} cm`;
  $('#bed-style-note').textContent=bed.surroundStyle==='flush'?'两侧与床尾齐边；承托板收窄至 143 cm，床屏两侧各伸出 6 cm。':'两侧各留 8 cm，床尾留 7.5 cm；159 cm 承托板匹配原 STEP 板面。';
  $('.model-number div').innerHTML=view==='headboard'?`独立落地床屏<small>${cm(p.headboardWidth)} × ${cm(HEADBOARD_LAYOUT.height)} cm · 宽 × 高</small>`:view==='mechanism'?'电动床架 · 双驱动<small>五段床板 · 六点支撑</small>':'智能睡眠系统<small>160 × 190 cm · 床垫尺寸</small>';
}
function labelPosition(id,point,offsetX,offsetY){const p=point.project(camera),el=$(id);const {width,height}=viewport.getBoundingClientRect();el.style.left=`${(p.x*.5+.5)*width+offsetX}px`;el.style.top=`${(-p.y*.5+.5)*height+offsetY}px`;el.style.opacity=p.z<1&&!camera.isOrthographicCamera&&view!=='explode'&&view!=='mechanism'&&!(view==='headboard'&&id==='#label-air')?'1':'0';}
function animate(ms){
  const dt=Math.min((ms-lastTime)/1000||0.016,0.05);lastTime=ms;const ease=1-Math.exp(-dt*7);let changed=dirty;dirty=false;
  for(const k of ['back','leg','xray','explode']){if(Math.abs(target[k]-current[k])>0.0002){current[k]+= (target[k]-current[k])*ease;changed=true;}}
  for(let s=0;s<2;s++)for(let z=0;z<4;z++){
    const desired=massage?clamp(target.pressures[s][z]+30*Math.sin(ms*.0019-z*1.05+s*.65),0,100):target.pressures[s][z];
    if(Math.abs(desired-current.pressures[s][z])>.015){current.pressures[s][z]+=(desired-current.pressures[s][z])*ease;changed=true;}
  }
  if(changed&&bed){const started=performance.now();bed.update({...current,mechanism:view==='mechanism',headboardOnly:view==='headboard',showDecks});lastModelUpdateMs=performance.now()-started;}
  if(pendingLayerFocus&&current.explode>.99){
    const bounds=new THREE.Box3().setFromObject(bed.anatomy.entries[pendingLayerFocus].group,true),center=bounds.getCenter(new THREE.Vector3());
    const distance=Math.max(2.5,bounds.getSize(new THREE.Vector3()).length()*.6/Math.sin(THREE.MathUtils.degToRad(camera.fov/2))*Math.max(1,1/camera.aspect));
    cameraTarget={position:center.clone().add(new THREE.Vector3(3.2,3.2,4.5).normalize().multiplyScalar(distance)),target:center};pendingLayerFocus=null;
  }
  if(massage&&ms-lastPressureUI>150){updatePressureMap(current.pressures);lastPressureUI=ms;}
  if(cameraTarget){camera.position.lerp(cameraTarget.position,ease);controls.target.lerp(cameraTarget.target,ease);if(camera.position.distanceTo(cameraTarget.position)<.005)cameraTarget=null;}
  const cameraChanged=controls.update();
  if(changed||cameraChanged||cameraTarget||needsRender){
  if(changed)renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);renderCount++;needsRender=false;
  labelPosition('#label-leather',new THREE.Vector3(-bed.layout.headboardWidth*.36,1.09,-1.03),-134,-18);
  labelPosition('#label-air',new THREE.Vector3(.78,.56,.50),30,-5);
  if(view==='explode'){
    const {width,height}=viewport.getBoundingClientRect();
    $$('.layer-marker').forEach(el=>{
      const p=bed.getLayerAnchor(el.dataset.layer).project(camera);
      el.style.left=`${(p.x*.5+.5)*width}px`;el.style.top=`${(-p.y*.5+.5)*height}px`;
      el.hidden=!!bed.selectedLayer&&bed.selectedLayer!==el.dataset.layer;
    });
  }
  }
  if(changed&&view==='mechanism'){for(const a of bed.linkage.actuators)$(`#${a.id}-stroke`).textContent=`${Math.round(a.stroke*1000)} mm`;}
  rafId=requestAnimationFrame(animate);
}
function setCamera(name){
  pendingLayerFocus=null;cameraTarget=null;cameraView=name;
  const next=['top','side'].includes(name)?orthographicCamera:perspectiveCamera;
  const oldTarget=controls.target.clone();
  if(next!==camera){camera=next;configureControls(oldTarget);}
  const positions={perspective:[3.1,2.35,3.8],side:[4.6,.56,-.07],top:[0,5.4,-.06999],exploded:[3.0,2.5,4.3],mechanism:[2.45,1.5,2.7],headboard:[1.4,1.30,2.05]};
  const level=view==='explode'?.91:view==='mechanism'?.30:.52;
  const focus=view==='headboard'?new THREE.Vector3(0,.68,-1.10):new THREE.Vector3(0,level,-.07);
  if(camera.isOrthographicCamera){
    if(name==='side'&&view!=='headboard')focus.y=.56;
    camera.position.copy(focus).add(name==='side'?new THREE.Vector3(4.6,0,0):new THREE.Vector3(0,5.4,.00001));controls.target.copy(focus);camera.zoom=1;camera.updateProjectionMatrix();controls.update();
  }else cameraTarget={position:new THREE.Vector3(...positions[name]),target:focus};
  controls.autoRotate=false;$('#rotate').setAttribute('aria-pressed','false');needsRender=true;
  $('#projection-label').textContent=({top:'正投影俯视 · 等比例',side:'正投影侧视 · 等比例'})[name]||'REALTIME 3D';
  $$('[data-camera]').forEach(b=>b.classList.toggle('active',b.dataset.camera===name));
}
function setView(name,syncTab=true){
  const previous=view;
  view=name;target.xray=name==='xray'?1:0;target.explode=name==='explode'?1:0;
  bed.selectedLayer=null;$$('[data-layer]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');});dirty=true;
  $('.layer-markers').hidden=name!=='explode';
  if(name==='explode'){setCamera('exploded');if(syncTab)activateTab('structure',false);}
  else if(name==='headboard'){setCamera('headboard');if(syncTab)activateTab('pose',false);}
  else if(name==='mechanism'){setCamera('mechanism');if(syncTab)activateTab('pose',false);}
  else if(previous==='explode'||previous==='mechanism'||previous==='headboard'){setCamera('perspective');if(syncTab&&$('#tab-structure').classList.contains('active'))activateTab('pose',false);}
  $$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===name);b.setAttribute('aria-pressed',String(b.dataset.view===name));});
  updateDimensions();
  $('#headboard-view').setAttribute('aria-pressed',String(name==='headboard'));$('#headboard-view span').textContent=name==='headboard'?'返回整床组合':'单独查看床屏';
  $('#mechanism-view').setAttribute('aria-pressed',String(name==='mechanism'));$('#mechanism-readout').hidden=name!=='mechanism';
  $('#status-right').textContent=({solid:'实时联动',xray:'内部透视',explode:'三层展示',mechanism:'驱动机构',headboard:'独立床屏'})[name];
}
function activateTab(id,changeView=true){
  $$('[data-tab]').forEach(t=>{const active=t.dataset.tab===id;t.classList.toggle('active',active);t.setAttribute('aria-selected',String(active));});
  $$('.pane').forEach(p=>p.hidden=p.id!==`pane-${id}`);
  $('.panel-index').textContent=`/ 0${['pose','air','structure','material'].indexOf(id)+1}`;
  $('.panel-heading h2').textContent=id==='structure'?'三层结构，清晰呈现':'探索你的舒适区';
  if(changeView){if(id==='air')setView('xray',false);else if(id==='structure')setView('explode',false);else if(id==='material')previewMaterial();else if(view==='explode')setView('solid',false);}
  if(id==='material')updateMaterialUI();
}
function setPreset(id){
  const preset=PRESETS[id];target.back=preset.back;target.leg=preset.leg;
  $$('[data-preset]').forEach(b=>{b.classList.toggle('active',b.dataset.preset===id);b.setAttribute('aria-pressed',String(b.dataset.preset===id));});
  for(const key of ['back','leg']){$(`#${key}-angle`).value=target[key];$(`#${key}-value`).innerHTML=`${target[key]}<span>°</span>`;paintRange($(`#${key}-angle`));}
  $('#status-text').textContent=preset.name+'姿态';
}
function updatePressureMap(values=target.pressures){
  for(let s=0;s<2;s++)for(let z=0;z<4;z++){const el=$(`#zone-${s}-${z}`),v=Math.round(values[s][z]);el.style.setProperty('--pressure',v/100);el.querySelector('small').textContent=`${v}%`;}
}
function updatePressureControls(){
  ZONES.forEach((_,i)=>{
    const a=target.pressures[0][i],b=target.pressures[1][i],value=activeSide==='right'?b:activeSide==='left'?a:(a+b)/2;
    $(`#pressure-${i}`).value=value;paintRange($(`#pressure-${i}`));
    $(`#pressure-value-${i}`).innerHTML=activeSide==='both'&&a!==b?`${Math.round(a)} / ${Math.round(b)}<span>%</span>`:`${Math.round(value)}<span>%</span>`;
  });updatePressureMap();
}
function updateMaterialUI(){
  const c=materialLibrary.config[activePart];$('#material-name').textContent=c.label;$('#material-description').textContent=({retainer:'通用软包挡板 · 随腿板联动',retainerLogo:'挡板正面压印 · 可替换透明标识图',brand:'床垫左侧品牌绣标 · 随围边贴合',modelMark:'床垫右侧型号绣标 · 随围边贴合',leather:HEADBOARD_STYLES[bed.headboardStyle]+' · 独立落地',waistband:'浅色罗纹织带 · 可独立换色',surround:'床邦与床尾 · 统一皮革',fabric:'可选绗缝与织纹',side:'围边花纹 · 自由搭配',piping:'勾勒床垫与床体轮廓',frame:'金属结构 · 精密支撑',foam:'三层结构 · 基础承托'})[activePart];
  const patterns=PATTERN_OPTIONS[activePart]||[];$('#pattern-field').hidden=!patterns.length;$('#material-pattern').innerHTML=patterns.map(id=>`<option value="${id}">${PATTERNS[id]}</option>`).join('');$('#material-pattern').value=c.pattern||'';
  $('#material-color').value=c.color;$('#roughness').value=c.roughness;$('#roughness-value').textContent=c.roughness.toFixed(2);$('#texture-repeat').value=c.repeat[0];$('#repeat-value').textContent=c.repeat.join(' × ');
  $('.material-orb').style.setProperty('--material-color',c.color);$$('.swatch').forEach(b=>b.classList.toggle('active',b.dataset.color===c.color));
  $('#texture-filename').textContent=c.maps[$('#texture-channel').value]||'点击选择图片，即时预览';$$('input[type=range]').forEach(paintRange);
}
function previewMaterial(){
  const layer=activePart==='foam'?'foundation':null;
  setView(layer?'explode':'solid',false);
  if(layer)focusAnatomy(layer);
}
function focusAnatomy(id){
  bed.selectedLayer=id;dirty=true;
  $$('[data-layer]').forEach(el=>{const active=el.dataset.layer===id;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});
  if(id){controls.autoRotate=false;$('#rotate').setAttribute('aria-pressed','false');pendingLayerFocus=id;}
  else setCamera('exploded');
}

function updateAppearanceUI(){
  $('#headboard-style').value=bed.headboardStyle;$('#waistband-toggle').checked=bed.waistbandEnabled;
  $('#label-leather div').innerHTML=`${bed.headboardStyle==='channel'?'竖向分格落地床屏':'双靠包落地床屏'}<small>FLOOR-STANDING HEADBOARD</small>`;
  $$('[data-bed-style]').forEach(el=>{const selected=el.dataset.bedStyle===bed.surroundStyle;el.classList.toggle('active',selected);el.setAttribute('aria-pressed',String(selected));});
}
function applyCollection(id){
  const collection=COLLECTIONS.find(c=>c.id===id);materialLibrary.applyCollection(id);
  bed.setHeadboardStyle(collection.headboard||'cushion');bed.setWaistband(!!collection.waistband);bed.setSurroundAccents(collection.surroundAccents!==false);dirty=true;
  updateAppearanceUI();$$('[data-collection]').forEach(el=>{const selected=el.dataset.collection===id;el.classList.toggle('active',selected);el.setAttribute('aria-pressed',String(selected));});
}
function bindUI(){
  for(const event of ['click','input','change'])$('#app').addEventListener(event,()=>{needsRender=true;});
  $$('[data-bed-style]').forEach(b=>b.addEventListener('click',()=>{
    bed.setSurroundStyle(b.dataset.bedStyle);dirty=true;
    $$('[data-bed-style]').forEach(el=>{el.classList.toggle('active',el===b);el.setAttribute('aria-pressed',String(el===b));});
    updateDimensions();
  }));
  $('#headboard-view').addEventListener('click',()=>setView(view==='headboard'?'solid':'headboard'));
  $('#mechanism-view').addEventListener('click',()=>setView(view==='mechanism'?'solid':'mechanism'));
  $('#deck-panels').addEventListener('click',()=>{showDecks=!showDecks;$('#deck-panels').setAttribute('aria-pressed',String(showDecks));$('#deck-panels').textContent=showDecks?'隐藏床板，查看机构':'显示五段床板';dirty=true;});
  const custom=()=>{materialLibrary.collection=null;$$('[data-collection]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');});};
  $('#headboard-style').addEventListener('change',e=>{bed.setHeadboardStyle(e.target.value);custom();updateAppearanceUI();dirty=true;});
  $('#waistband-toggle').addEventListener('change',e=>{bed.setWaistband(e.target.checked);custom();dirty=true;});
  $$('[data-collection]').forEach(b=>b.addEventListener('click',()=>{
    applyCollection(b.dataset.collection);
    activePart='fabric';$('#material-part').value=activePart;previewMaterial();updateMaterialUI();needsRender=true;
    toast(`${COLLECTIONS.find(c=>c.id===b.dataset.collection).name} · 整床搭配已应用`);
  }));
  $('#material-detail').addEventListener('click',()=>{
    if(activePart==='foam'){focusAnatomy('foundation');return;}
    setView('solid',false);setCamera('perspective');controls.autoRotate=false;$('#rotate').setAttribute('aria-pressed','false');
    const head=activePart==='leather',base=activePart==='surround'||activePart==='frame';
    if(['retainer','retainerLogo','brand','modelMark'].includes(activePart)){cameraTarget={position:new THREE.Vector3(.42,.70,2.25),target:new THREE.Vector3(0,.46,.94)};return;}
    cameraTarget={position:new THREE.Vector3(...(head?[.75,1.12,.23]:[1.85,base?.43:.80,.62])),target:new THREE.Vector3(...(head?[.05,.89,-1.11]:[.65,base?.22:.52,.1]))};
    $$('[data-camera]').forEach(b=>b.classList.remove('active'));
  });
  $('#material-pattern').addEventListener('change',e=>{materialLibrary.setPattern(activePart,e.target.value);custom();updateMaterialUI();needsRender=true;});

  $$('[data-tab]').forEach(b=>b.addEventListener('click',()=>activateTab(b.dataset.tab)));
  $$('[data-layer]').forEach(b=>b.addEventListener('click',()=>{
    if(view!=='explode')setView('explode');
    focusAnatomy(bed.selectedLayer===b.dataset.layer?null:b.dataset.layer);
  }));
  $('#show-all-layers').addEventListener('click',()=>focusAnatomy(null));
  $$('[data-preset]').forEach(b=>b.addEventListener('click',()=>setPreset(b.dataset.preset)));
  for(const key of ['back','leg'])$(`#${key}-angle`).addEventListener('input',e=>{
    target[key]=Number(e.target.value);$(`#${key}-value`).innerHTML=`${target[key]}<span>°</span>`;paintRange(e.target);
    $$('[data-preset]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');});$('#status-text').textContent='自定义姿态';
  });
  $('#flat-reset').addEventListener('click',()=>setPreset('flat'));
  $$('[data-camera]').forEach(b=>b.addEventListener('click',()=>setCamera(b.dataset.camera)));$('#reset-view').addEventListener('click',()=>setCamera('perspective'));
  $('#rotate').addEventListener('click',()=>{if(camera.isOrthographicCamera)setCamera('perspective');controls.autoRotate=!controls.autoRotate;cameraTarget=null;$('#rotate').setAttribute('aria-pressed',String(controls.autoRotate));});
  $$('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $$('[data-side]').forEach(b=>b.addEventListener('click',()=>{activeSide=b.dataset.side;$$('[data-side]').forEach(t=>t.classList.toggle('active',t===b));$$('.air-column').forEach((col,i)=>col.classList.toggle('dimmed',(activeSide==='left'&&i===1)||(activeSide==='right'&&i===0)));updatePressureControls();}));
  $$('[data-pressure]').forEach(input=>input.addEventListener('input',e=>{
    const index=Number(e.target.dataset.pressure);for(let side=0;side<2;side++)if(activeSide==='both'||(activeSide==='left'&&side===0)||(activeSide==='right'&&side===1))target.pressures[side][index]=Number(e.target.value);updatePressureControls();
  }));
  $('#massage').addEventListener('click',()=>{massage=!massage;$('#massage').setAttribute('aria-checked',String(massage));$('#status-text').textContent=massage?'气囊循环充放气':'气囊手动调节';if(massage)setView('xray');else updatePressureMap();});
  $('#material-part').addEventListener('change',e=>{activePart=e.target.value;previewMaterial();updateMaterialUI();});
  $$('[data-color]').forEach(b=>b.addEventListener('click',()=>{materialLibrary.update(activePart,{color:b.dataset.color});custom();updateMaterialUI();}));
  $('#material-color').addEventListener('input',e=>{materialLibrary.update(activePart,{color:e.target.value});custom();updateMaterialUI();});
  $('#roughness').addEventListener('input',e=>{materialLibrary.update(activePart,{roughness:Number(e.target.value)});custom();$('#roughness-value').textContent=Number(e.target.value).toFixed(2);paintRange(e.target);});
  $('#texture-repeat').addEventListener('input',e=>{const n=Number(e.target.value);materialLibrary.update(activePart,{repeat:[n,n]});custom();$('#repeat-value').textContent=`${n} × ${n}`;paintRange(e.target);});
  $('#texture-channel').addEventListener('change',updateMaterialUI);
  $('#texture-file').addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){toast('请选择 PNG、JPG 或 WebP 图片');return;}
    if(file.size>20*1024*1024){toast('图片请控制在 20 MB 以内');e.target.value='';return;}
    const part=activePart,channel=$('#texture-channel').value,url=URL.createObjectURL(file);
    try{await materialLibrary.replace(part,channel,url,file.name);if(channel==='map')materialLibrary.update(part,{color:'#ffffff'});custom();needsRender=true;updateMaterialUI();toast(`${materialLibrary.config[part].label}纹理已替换`);}catch{toast('纹理读取失败，请检查图片文件');}finally{URL.revokeObjectURL(url);e.target.value='';}
  });
  $('#reset-material').addEventListener('click',()=>{materialLibrary.reset(activePart);custom();updateMaterialUI();dirty=true;toast('当前部件材质已恢复');});
  $('#capture').addEventListener('click',()=>{
    const canvas=renderer.domElement;renderer.render(scene,camera);
    const out=document.createElement('canvas');out.width=canvas.width;out.height=canvas.height;const ctx=out.getContext('2d');ctx.fillStyle='#111a1d';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(canvas,0,0);
    ctx.fillStyle='#b8cfc8';ctx.font=`${out.width/55}px sans-serif`;ctx.fillText('NOCTIS / SMART SLEEP LAB',out.width*.05,out.height*.09);
    out.toBlob(b=>{if(b){download(b,'NOCTIS-smart-bed.png');toast('模型视图已保存');}},'image/png');
  });
  $('#export-config').addEventListener('click',()=>{
    const config={version:12,retainer:bed.cadFrame.retainer.userData,branding:bed.branding.map(m=>m.userData),modelView:view,showDecks,frameReference:'BZZ1-007-160X190.stp',dimensions:{mattress:DIMENSIONS,surround:bed.layout,headboard:bed.headboard.userData.dimensions},bedStyle:bed.surroundStyle,headboardStyle:bed.headboardStyle,waistband:bed.waistbandEnabled,surroundAccents:bed.surroundAccentsEnabled,collection:materialLibrary.collection,units:'meters',pose:{back:target.back,leg:target.leg},pressures:target.pressures,materials:materialLibrary.config,textureNote:'上传纹理记录为文件名，请将图片放入 public/textures 并在 materials.js 配置 URL。'};
    download(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}),'NOCTIS-config.json');toast('配置已导出，纹理图片需单独保存');
  });
  $('#export-model').addEventListener('click',async()=>{
    const button=$('#export-model'),snapshots=[];button.disabled=true;toast('正在生成当前姿态的 GLB 模型…');
    try{
      const model=bed.root.clone(true),materialCopies=new Map();model.traverse(o=>{
        if(o.userData.rest)delete o.userData.rest;
        // Freeze geometry and material values while an asynchronous export encodes images.
        if(o.geometry){o.geometry=o.geometry.clone();snapshots.push(o.geometry);}
        if(o.material){const clone=m=>{if(!materialCopies.has(m)){const copy=m.clone();materialCopies.set(m,copy);snapshots.push(copy);}return materialCopies.get(m);};o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);}
      });
      const data=await new GLTFExporter().parseAsync(model,{binary:true,onlyVisible:true,maxTextureSize:2048});
      download(new Blob([data],{type:'model/gltf-binary'}),'NOCTIS-current-pose.glb');toast('当前姿态已导出，交互动画保留在 Three.js 源码中');
    }catch(e){console.error(e);toast('模型导出失败，请重试');}finally{snapshots.forEach(item=>item.dispose());button.disabled=false;}
  });
  $$('input[type=range]').forEach(paintRange);updatePressureControls();
}

try{await prepareBrandArtwork();initScene();bindUI();}catch(error){console.error(error);$('#loading').innerHTML='<strong>无法启动 3D 视图</strong><span>请使用支持 WebGL 2 的浏览器，并开启图形加速后重试。</span>';}

// Read-only snapshots support integration checks without coupling tests to mesh ordering.
window.noctis={getState:()=>structuredClone({target,current,view,massage,bedStyle:bed?.surroundStyle,headboardStyle:bed?.headboardStyle,waistband:bed?.waistbandEnabled,materials:materialLibrary?.config}),getDiagnostics:()=>({webgl:!!renderer,retainer:bed?.cadFrame.retainer.userData,branding:bed?.branding.map(m=>({name:m.name,visible:m.visible&&bed.mattress.visible})),bedStyle:bed?.surroundStyle,layout:bed?.layout,dimensions:DIMENSIONS,headboardDimensions:bed?.headboard.userData.dimensions,headboardStyle:bed?.headboardStyle,waistbandVisible:!!(bed?.waistband.visible&&bed?.mattress.visible),projection:camera?.type,cameraView,materialMaps:materialLibrary&&Object.fromEntries(Object.entries(materialLibrary.materials).map(([id,m])=>[id,{type:m.type,normal:!!m.normalMap,roughness:!!m.roughnessMap,width:m.map?.image?.width,height:m.map?.image?.height,anisotropy:m.map?.anisotropy}])),meshCount:bed?countMeshes(bed.root):0,drawCalls:renderer?.info.render.calls,renderCount,lastModelUpdateMs,triangles:renderer?.info.render.triangles,airbags:bed?.airbags.map(b=>({side:b.side,zone:b.zone,halfHeight:b.halfHeight,shape:b.cells[0].name,y:b.group.position.y})),coverBounds:bed?.cover.geometry.boundingSphere?.radius,selectedLayer:bed?.selectedLayer,anatomy:bed?.anatomy.layers.map(l=>({id:l.id,visible:bed.anatomy.entries[l.id].group.visible,meshes:countMeshes(bed.anatomy.entries[l.id].group)})),coverVisible:!!(bed?.cover.visible&&bed?.mattress.visible),headboardOnly:view==='headboard',showDecks,deckCount:bed?.decks.length,headboardVisible:bed?.headboard.visible,motors:bed?.linkage?.actuators.map(a=>({id:a.id,anchor:a.anchor,moving:a.moving,length:a.length,stroke:a.stroke,barrelLength:a.barrelLength,armAngle:a.armAngle,roller:a.roller,trackPosition:a.trackPosition})),collection:materialLibrary?.collection})};
function countMeshes(root){let n=0;root.traverse(o=>{if(o.isMesh)n++;});return n;}

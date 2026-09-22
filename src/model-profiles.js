import { t12Regions, t12Bags } from './t12-circuits.js';
import { DEFAULT_AIR_BAGS, DEFAULT_HEAT_PATCHES, T11_AIR_BAGS, T11_REGIONS, ZONES, humanSide } from './air-layout.js';
import { COLLECTIONS, PATTERN_OPTIONS } from './cmf.js';
import { MATERIAL_CONFIG } from './materials.js';
import { t12MassageChannels } from './massage.js';

export function sdkError(code,message){return Object.assign(new Error(message),{code});}
const fail=message=>{throw sdkError('INVALID_PROFILE',message);};
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const frozen=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value;};
const validId=id=>typeof id==='string'&&!['constructor','prototype','__proto__'].includes(id)&&/^[a-zA-Z0-9][a-zA-Z0-9_.+-]{0,79}$/.test(id);

export function validateProfile(source){
  const p=structuredClone(source);
  if(p.schemaVersion!==1||!validId(p.id)||typeof p.name!=='string'||!p.name||!Number.isInteger(p.revision)||p.revision<1)fail('型号身份或配置版本无效');
  if(p.template!=='articulated-160x190')throw sdkError('UNSUPPORTED_TEMPLATE','当前结构模板支持 160 × 190 cm 电动床垫');
  if(!Array.isArray(p.regions)||!Array.isArray(p.airbags)||!Array.isArray(p.heating)||p.regions.length>32||p.airbags.length>48||p.heating.length>16)fail('区域配置无效或超出支持数量');
  if(p.tidal&&(![0,1].every(side=>Array.from({length:7},(_,i)=>`${side?'left':'right'}.circuit${i+1}`).every(id=>p.regions.some(r=>r.id===id&&r.side===side)))))fail('潮汐配置必须包含左右七路');
  const ids=new Set();
  for(const r of p.regions){
    if(!validId(r.id)||ids.has(r.id)||![0,1].includes(r.side)||typeof r.name!=='string'||!Array.isArray(r.range)||r.range.length!==2||!r.range.every(Number.isFinite)||r.range[0]>=r.range[1])fail('调节区域无效');
    ids.add(r.id);
  }
  const bagIds=new Set(),counts=[0,0];
  for(const b of p.airbags){
    const r=p.regions.find(r=>r.id===b.regionId);
    if(!validId(b.id)||bagIds.has(b.id)||!r||r.side!==b.side)fail('气囊引用的区域无效');
    for(const [key,min,max] of [['width',.12,.76],['depth',.12,1.8],['spreadX',.03,.8],['spread',.03,1],['maxLift',0,.08],['bottom',.03,.10],['minHalfHeight',.01,.04],['halfHeightRange',0,.07]])if(!finite(b[key],min,max))fail(`气囊 ${b.id} 的 ${key} 无效`);
    if(!finite(b.x,-.8,.8)||!finite(b.z,-.95,.95)||Math.abs(b.x)+b.width/2>.80||Math.abs(b.z)+b.depth/2>.95||Math.abs(b.x)<b.width/2||(b.side===0?b.x>=0:b.x<=0))fail('气囊越出床垫或所在半侧');
    if(b.shape!==undefined&&b.shape!=='round-array')fail('未知气囊形态');
    if(b.shape==='round-array'&&b.cellCount!==7)fail('圆囊阵列每排必须为7个');
    b.zone=counts[b.side]++;bagIds.add(b.id);
  }
  if(p.regions.some(r=>!p.airbags.some(b=>b.regionId===r.id)))fail('调节区域未关联气囊');
  const heatIds=new Set(),heatCounts=[0,0];
  for(const h of p.heating){
    if(!validId(h.id)||heatIds.has(h.id)||![0,1].includes(h.side)||typeof h.name!=='string'||!finite(h.maxLevel,1,100)||!finite(h.width,.05,.76)||!finite(h.depth,.05,1.8)||!finite(h.x,-.8,.8)||!finite(h.z,-.95,.95)||Math.abs(h.x)+h.width/2>.8||Math.abs(h.z)+h.depth/2>.95||(h.side===0?h.x>=0:h.x<=0))fail('加热区域配置无效');
    h.region=heatCounts[h.side]++;heatIds.add(h.id);
  }
  p.massage??=[];
  if(!Array.isArray(p.massage)||p.massage.length>2)fail('按摩侧别配置无效');
  const massageIds=new Set();
  for(const channel of p.massage){
    if(!['left','right'].includes(channel.id)||channel.side!==(channel.id==='left'?1:0)||massageIds.has(channel.id)||typeof channel.name!=='string'||!finite(channel.defaultIntensity,0,1)||!finite(channel.defaultCycleSeconds,4,30)||!Array.isArray(channel.pads)||!channel.pads.length||channel.pads.length>6)fail('按摩通道配置无效');
    massageIds.add(channel.id);const padIds=new Set();
    for(const pad of channel.pads){
      if(!validId(pad.id)||padIds.has(pad.id)||!finite(pad.width,.1,.70)||!finite(pad.depth,.1,.5)||!finite(pad.x,-.8,.8)||!finite(pad.z,-.95,.95)||Math.abs(pad.x)+pad.width/2>.8||Math.abs(pad.x)<pad.width/2||Math.abs(pad.z)+pad.depth/2>.95||(channel.side===0?pad.x>=0:pad.x<=0)||!Array.isArray(pad.cells)||!pad.cells.length||pad.cells.length>8)fail('按摩单元超出床垫或所在半侧');
      padIds.add(pad.id);
      for(const cell of pad.cells)if(!finite(cell.radius,.015,.065)||!finite(cell.x,-.4,.4)||!finite(cell.z,-.25,.25)||Math.abs(cell.x)+cell.radius>pad.width/2||Math.abs(cell.z)+cell.radius>pad.depth/2)fail('按摩气囊超出单元范围');
    }
  }
  if(!COLLECTIONS.some(c=>c.id===p.appearance?.collection)||!['flush','wide'].includes(p.appearance?.bedStyle)||!['cushion','channel','t12'].includes(p.appearance?.headboard)||typeof p.appearance?.modelLabel!=='string')fail('外观预设无效');
  if(p.appearance.coverStyle!==undefined&&!['standard','tailored'].includes(p.appearance.coverStyle))fail('围条结构无效');
  for(const [part,c] of Object.entries(p.appearance.materials||{})){
    if(!Object.hasOwn(MATERIAL_CONFIG,part))fail('未知材质部件');
    for(const key of Object.keys(c))if(!['color','pattern','roughness','metalness','repeat','maps'].includes(key))fail('未知材质参数');
    if(c.color!==undefined&&!/^#[0-9a-f]{6}$/i.test(c.color))fail('颜色必须为六位十六进制');
    for(const key of ['roughness','metalness'])if(c[key]!==undefined&&!finite(c[key],0,1))fail('材质参数超出范围');
    if(c.pattern!==undefined&&c.pattern!==null&&!PATTERN_OPTIONS[part]?.includes(c.pattern))fail('纹理不适用于该部件');
    if(c.repeat!==undefined&&(!Array.isArray(c.repeat)||c.repeat.length!==2||!c.repeat.every(n=>finite(n,.1,32))))fail('纹理重复无效');
    for(const [slot,url] of Object.entries(c.maps||{}))if(!['map','normalMap','roughnessMap'].includes(slot)||typeof url!=='string'||!url||/^(javascript|file):/i.test(url))fail('贴图资源无效');
  }
  if(!['canonical-v1','mapped-v1'].includes(p.input?.format))fail('未定义上报格式');
  if(p.input.format==='mapped-v1'){
    if(!Array.isArray(p.input.fields)||!p.input.fields.length)fail('字段映射为空');
    const destinations=new Set();
    for(const f of p.input.fields){
      if(!Array.isArray(f.path)||!f.path.length||!f.path.every(k=>typeof k==='string'&&!['__proto__','prototype','constructor'].includes(k)))fail('字段路径必须是安全字符串数组');
      if(f.kind==='air'?!ids.has(f.id)||!['value','status'].includes(f.field):f.kind==='heating'?!heatIds.has(f.id)||!['level','status'].includes(f.field):f.kind!=='pose'||!['back','leg'].includes(f.field))fail('映射目标无效');
      const key=`${f.kind}/${f.id||''}/${f.field}`;if(destinations.has(key))fail('映射目标重复');destinations.add(key);
      if(f.scale!==undefined&&!finite(f.scale,-1e6,1e6)||f.offset!==undefined&&!finite(f.offset,-1e6,1e6))fail('映射换算无效');
    }
  }
  p.presentation={scanMs:950,flightMs:1150,coverOpacity:.38,...p.presentation};
  if(!finite(p.presentation.scanMs,0,5000)||!finite(p.presentation.flightMs,0,5000)||!finite(p.presentation.coverOpacity,.05,1))fail('视觉时序无效');
  return frozen(p);
}

const regions=[0,1].flatMap(side=>ZONES.map(r=>({id:`${humanSide(side)}.${r.id}`,name:r.name,side,range:[0,100],unit:'level'})));
const base={schemaVersion:1,revision:1,template:'articulated-160x190',sideConvention:'supine',regions,airbags:DEFAULT_AIR_BAGS,heating:DEFAULT_HEAT_PATCHES.map(h=>({...h,name:h.id.endsWith('lumbar')?'腰部':'腿部'})),input:{format:'canonical-v1'},presentation:{scanMs:950,flightMs:1150,coverOpacity:.38}};
export const BUILTIN_PROFILES=[
  validateProfile({...base,id:'t11-plus',revision:2,name:'T11+',status:'reference',regions:T11_REGIONS,airbags:T11_AIR_BAGS,configurationNote:'每侧7囊、3路：肩部2囊＋腰部2囊＋臀部3囊；气囊尺寸和间距为展示适配，待实测规格确认。',appearance:{collection:'indigoWeave',bedStyle:'flush',headboard:'channel',waistband:true,surroundAccents:false,modelLabel:'T11+'}}),
  validateProfile({...base,id:'t12',revision:8,regions:t12Regions,airbags:t12Bags,tidal:true,name:'T12',status:'reference',massage:t12MassageChannels(),configurationNote:'外观及26cm厚度为照片适配值；按摩按示意图配置，支撑按每侧7路9排圆囊配置，尺寸为展示适配；加热布局待设备规格确认',appearance:{collection:'indigoWeave',bedStyle:'flush',headboard:'t12',coverStyle:'tailored',waistband:false,surroundAccents:false,modelLabel:'T12',materials:{
    fabric:{color:'#142137',pattern:'t12Rib',roughness:.94,metalness:0,repeat:[1,1]},
    side:{color:'#17273f',pattern:'t12Border',roughness:.93,metalness:0,repeat:[1,1]},
    waistband:{color:'#131f32',pattern:'t12Tape',roughness:.9,metalness:0,repeat:[4,1]},
    deck:{color:'#151a22',roughness:.95,metalness:0},
    leather:{color:'#292426',pattern:'smooth',roughness:.72,metalness:0,repeat:[6,3]},
    surround:{color:'#272225',pattern:'smooth',roughness:.64,metalness:0,repeat:[6,3]},
    piping:{color:'#10141d',roughness:.78,metalness:0},
    brand:{color:'#bda571',pattern:'derucciAI',roughness:.76,metalness:.12},
    modelMark:{color:'#bda571',roughness:.76,metalness:.12},
    retainer:{color:'#272225',pattern:'smooth',roughness:.64},
    retainerLogo:{color:'#bda571',roughness:.76,metalness:.12},
  }}}),
  validateProfile({...base,id:'generic',name:'通用床垫',status:'generic',appearance:{collection:'ivory',bedStyle:'flush',headboard:'cushion',waistband:false,surroundAccents:false,modelLabel:'GENERIC'}}),
];

export class ModelRegistry{
  constructor(profiles=[]){this.profiles=new Map();this.aliases=new Map([['T11+','t11-plus'],['T12','t12']]);for(const p of [...BUILTIN_PROFILES,...profiles])this.register(p);}
  register(profile){const p=validateProfile(profile);if(this.profiles.has(p.id))throw sdkError('PROFILE_EXISTS','型号已登记；请使用独立型号 ID 或新建组件加载新版配置');this.profiles.set(p.id,p);return p;}
  resolve(id){const key=this.profiles.has(id)?id:this.aliases.get(id)||id,p=this.profiles.get(key);if(!p)throw sdkError(key==='t12'?'MODEL_NOT_CONFIGURED':'MODEL_NOT_FOUND',key==='t12'?'T12 尚待产品资料配置':'未登记的型号');return p;}
  list(){return [...this.profiles.values()].map(({id,name,revision,status})=>({id,name,revision,status}));}
}

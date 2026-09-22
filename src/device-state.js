import { emptyChannels, humanSide } from './air-layout.js';
import { sdkError } from './model-profiles.js';

const active=status=>['inflating','deflating','adjusting'].includes(status);
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const invalid=message=>{throw sdkError('INVALID_STATE',message);};
const pathValue=(object,path)=>{let value=object;for(const key of path){if(!plain(value)&&!Array.isArray(value)||!Object.hasOwn(value,key))return undefined;value=value[key];}return value;};

export function mapPayload(profile,payload){
  if(!plain(payload))invalid('设备上报必须是 JSON 对象');
  if(profile.input.format==='canonical-v1')return structuredClone(payload);
  const out={};let matches=0;
  for(const field of profile.input.fields){
    let value=pathValue(payload,field.path);if(value===undefined)continue;matches++;
    if(value!==null){
      if(field.values){if(!Object.hasOwn(field.values,String(value)))invalid('未定义的上报枚举值');value=field.values[String(value)];}
      if(field.scale!==undefined||field.offset!==undefined){if(typeof value!=='number'||!Number.isFinite(value))invalid('映射换算要求数字');value=value*(field.scale??1)+(field.offset??0);}
    }
    if(field.kind==='pose')(out.pose??={})[field.field]=value;
    else ((out[field.kind]??={})[field.id]??={})[field.field]=value;
  }
  if(!matches)throw sdkError('NO_MAPPED_FIELDS','消息中没有当前型号可识别的字段');
  return out;
}

export class DeviceState{
  constructor(profile){this.profile=profile;this.sequence=null;this.initialized=false;this.reset();}
  emptyState(){return {air:Object.fromEntries(this.profile.regions.map(r=>[r.id,{value:null,status:null}])),heating:Object.fromEntries(this.profile.heating.map(h=>[h.id,{level:null,status:null}])),massage:Object.fromEntries((this.profile.massage||[]).map(c=>[c.id,{status:null,intensity:null,cycleSeconds:null}])),pose:{back:null,leg:null},online:true};}
  reset(){this.state=this.emptyState();}
  apply(payload,{kind=this.initialized?'patch':'snapshot',sequence,normalized=false}={}){
    if(!['patch','snapshot'].includes(kind))invalid('更新类型无效');
    if(kind==='patch'&&!this.initialized)throw sdkError('SNAPSHOT_REQUIRED','请先提交完整状态');
    if(sequence!==undefined){
      if(!Number.isSafeInteger(sequence)||sequence<0)invalid('序号必须为非负整数');
      if(this.sequence!==null&&sequence<=this.sequence)return {ignored:true,reason:'stale'};
      if(kind==='patch'&&this.sequence!==null&&sequence!==this.sequence+1)throw sdkError('RESYNC_REQUIRED','增量序号断开，请提交完整状态');
    }
    const data=normalized?structuredClone(payload):mapPayload(this.profile,payload);
    if(!plain(data))invalid('状态必须为 JSON 对象');
    for(const key of Object.keys(data))if(!['air','heating','massage','pose','online'].includes(key))invalid(`未知状态字段 ${key}`);
    if(!Object.keys(data).length)invalid('状态更新为空');
    const next=kind==='snapshot'?this.emptyState():structuredClone(this.state);
    for(const [key,definitions,valueKey,statuses] of [['air',this.profile.regions,'value',['idle','inflating','deflating','adjusting','fault']],['heating',this.profile.heating,'level',['off','heating','holding','fault']]]){
      if(data[key]===undefined)continue;if(!plain(data[key]))invalid(`${key} 必须为对象`);
      for(const [id,record] of Object.entries(data[key])){
        const definition=definitions.find(r=>r.id===id);if(!definition)throw sdkError('UNKNOWN_REGION',`未知区域 ${id}`);
        if(!plain(record))invalid('区域状态必须为对象');
        for(const [field,value] of Object.entries(record)){
          if(field===valueKey){const [min,max]=key==='air'?definition.range:[0,definition.maxLevel];if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max))invalid(`${id} 数值超出范围`);}
          else if(field==='status'){if(value!==null&&!statuses.includes(value))invalid('工作状态无效');}
          else invalid(`未知区域字段 ${field}`);
          next[key][id][field]=value;
        }
      }
    }
    if(data.massage!==undefined){
      if(!plain(data.massage))invalid('按摩状态必须为对象');
      for(const [id,record] of Object.entries(data.massage)){
        if(!Object.hasOwn(next.massage,id))throw sdkError('UNSUPPORTED_MASSAGE','当前型号不支持此侧按摩');
        if(!plain(record)||!Object.keys(record).length)invalid('按摩通道状态不能为空');
        for(const [field,value] of Object.entries(record)){
          if(field==='status'){if(value!==null&&!['off','running','paused','fault'].includes(value))invalid('按摩工作状态无效');}
          else if(field==='intensity'||field==='cycleSeconds'){const [min,max]=field==='intensity'?[0,1]:[4,30];if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max))invalid('按摩强度或周期超出范围');}
          else invalid(`未知按摩字段 ${field}`);
          next.massage[id][field]=value;
        }
      }
    }
    if(data.pose!==undefined){if(!plain(data.pose))invalid('姿态必须为对象');for(const [key,value] of Object.entries(data.pose)){if(!['back','leg'].includes(key)||value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>(key==='back'?65:35)))invalid('姿态角度无效');next.pose[key]=value;}}
    if(data.online!==undefined){if(typeof data.online!=='boolean')invalid('online 必须为布尔值');next.online=data.online;}
    this.state=next;this.initialized=true;if(sequence!==undefined)this.sequence=sequence;
    return {ignored:false,state:this.snapshot()};
  }
  snapshot(){return structuredClone({...this.state,initialized:this.initialized,sequence:this.sequence});}
  activeRegions(){return this.state.online?this.profile.regions.filter(r=>active(this.state.air[r.id].status)):[];}
  targets(previous){
    const pressures=emptyChannels(this.profile.airbags,'zone'),heating=emptyChannels(this.profile.heating,'region');
    for(const bag of this.profile.airbags){const r=this.profile.regions.find(r=>r.id===bag.regionId),v=this.state.air[r.id].value;pressures[bag.side][bag.zone]=v===null?(previous?.pressures[bag.side]?.[bag.zone]??0):(v-r.range[0])/(r.range[1]-r.range[0])*100;}
    for(const h of this.profile.heating){const record=this.state.heating[h.id],v=record.level;heating[h.side][h.region]=['off','fault'].includes(record.status)?0:v===null?(previous?.heating[h.side]?.[h.region]??0):v;}
    return {pressures,heating,back:this.state.pose.back??previous?.back??0,leg:this.state.pose.leg??previous?.leg??0};
  }
}

// This timeline owns visibility only. It never delays or manufactures device state.
export class DevicePresentation{
  constructor({scanMs=950,flightMs=1150}={}){this.scanMs=scanMs;this.flightMs=flightMs;this.phase='closed';this.side=null;this.progress=0;this.started=0;this.active=[];this.follow=true;this.preferred=null;this.reducedMotion=false;}
  reconcile(regions,now){
    this.tick(now);this.active=regions;
    const sides=[...new Set(regions.map(r=>humanSide(r.side)))];
    const desired=this.preferred&&sides.includes(this.preferred)?this.preferred:sides.includes(this.side)?this.side:sides.length===1?sides[0]:null;
    if(this.phase==='closed'&&desired)return this.open(desired,now);
    if(this.phase!=='closed'&&this.phase!=='closing'&&desired!==this.side){
      if(this.progress===0){this.phase='closed';this.side=null;return desired?this.open(desired,now):null;}
      this.phase='closing';this.started=now;this.fromProgress=this.progress;
    }
    return null;
  }
  open(side,now){this.side=side;this.phase=this.reducedMotion?'adjust':this.follow&&this.flightMs?'camera':'scan';this.started=now;this.progress=this.reducedMotion?1:0;return {side};}
  tick(now){
    if(this.reducedMotion&&['camera','scan'].includes(this.phase)){this.phase='adjust';this.progress=1;}
    if(this.phase==='camera'&&now-this.started>=this.flightMs){this.phase='scan';this.started+=this.flightMs;}
    if(this.phase==='scan'){this.progress=this.scanMs?Math.min(1,(now-this.started)/this.scanMs):1;if(this.progress>=1)this.phase='adjust';}
    if(this.phase==='closing'){this.progress=this.reducedMotion?0:Math.max(0,this.fromProgress-(now-this.started)/Math.max(1,this.scanMs));if(this.progress===0){this.phase='closed';this.side=null;}}
    return {side:this.side,phase:this.phase,progress:this.progress,ready:true};
  }
  selection(){return {side:this.side,kind:'air',activeRegionIds:this.active.filter(r=>humanSide(r.side)===this.side).map(r=>r.id)};}
}

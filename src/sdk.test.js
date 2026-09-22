import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ModelRegistry, validateProfile } from './model-profiles.js';
import { DeviceState, DevicePresentation } from './device-state.js';
import { SmartBed } from './model.js';
import { MATERIAL_CONFIG } from './materials.js';
import { FirmnessEffect } from './firmness-effect.js';
import { HeatingEffect } from './heating-effect.js';
import { surfaceLift } from './kinematics.js';

const registry=new ModelRegistry(),base=registry.resolve('generic');
function fixture(){
  const p=structuredClone(base);p.id='fixture-asymmetric';p.name='测试结构';
  p.regions=p.regions.filter(r=>['left.lumbar','right.leg'].includes(r.id));
  const left=p.airbags.find(b=>b.regionId==='left.lumbar'),right=p.airbags.find(b=>b.regionId==='right.leg'),heat=p.heating.find(h=>h.id==='right.leg');
  p.airbags=[{...left,id:'left.lumbar-a',x:.58,width:.30,spreadX:.15},{...left,id:'left.lumbar-b',x:.22,width:.30,spreadX:.15},{...right,id:'right.leg-only'}];
  p.heating=[{...heat,id:'right.heat',name:'独立热区',z:.45}];
  return validateProfile(p);
}

test('profiles are immutable and T12 separates photo appearance from unconfirmed capabilities',()=>{
  assert.equal(registry.resolve('T11+').id,'t11-plus');assert.equal(registry.resolve('generic').appearance.modelLabel,'GENERIC');
  const t12=registry.resolve('T12');assert.equal(t12.id,'t12');assert.equal(t12.appearance.modelLabel,'T12');assert.equal(t12.appearance.waistband,false);assert.equal(t12.appearance.headboard,'t12');assert.match(t12.configurationNote,/展示适配/);assert.equal(t12.appearance.materials.fabric.pattern,'t12Rib');assert.equal(t12.appearance.materials.side.pattern,'t12Border');assert.equal(t12.appearance.materials.brand.pattern,'derucciAI');assert.equal(base.appearance.materials,undefined);
  assert.throws(()=>registry.resolve('unknown'),{code:'MODEL_NOT_FOUND'});
  assert.throws(()=>{base.airbags[0].x=0;},TypeError);
  const p=fixture();registry.register(p);assert.equal(registry.resolve(p.id).airbags.length,3);assert.equal(base.airbags.length,8);
});
test('profile validation catches dangling regions, bad geometry and mappings before model changes',()=>{
  for(const modify of [p=>p.airbags[0].regionId='missing',p=>p.airbags[0].width=3,p=>p.airbags[0].x=NaN,p=>p.heating[0].maxLevel=0,p=>p.regions.push(p.regions[0]),p=>p.appearance.materials={fabric:{roughness:2}},p=>p.input={format:'mapped-v1',fields:[{path:['__proto__'],kind:'air',id:'left.lumbar',field:'value'}]}]){const p=structuredClone(base);modify(p);assert.throws(()=>validateProfile(p),{code:'INVALID_PROFILE'});}
});
test('state begins unknown and region update is independent, atomic and range checked',()=>{
  const store=new DeviceState(base);assert.equal(store.snapshot().air['left.lumbar'].value,null);
  store.apply({air:{'left.lumbar':{value:70,status:'inflating'}}});assert.equal(store.state.air['right.lumbar'].value,null);
  const before=store.snapshot();assert.throws(()=>store.apply({air:{'left.lumbar':{value:20},'right.lumbar':{value:101}}}),{code:'INVALID_STATE'});assert.deepEqual(store.snapshot(),before);
  assert.throws(()=>store.apply({air:{ghost:{value:1}}}),{code:'UNKNOWN_REGION'});
  store.apply({air:{'left.lumbar':{value:null}}});assert.equal(store.state.air['left.lumbar'].value,null);assert.equal(store.state.air['left.lumbar'].status,'inflating');
  store.apply({air:{'left.lumbar':{value:0}}});assert.equal(store.state.air['left.lumbar'].value,0);
});
test('duplicate/old reports are ignored, missing patches request snapshot, snapshots clear stale fields',()=>{
  const store=new DeviceState(base);store.apply({pose:{back:20}},{sequence:10});
  assert.equal(store.apply({pose:{back:30}},{sequence:9}).ignored,true);
  assert.throws(()=>store.apply({pose:{back:30}},{sequence:12}),{code:'RESYNC_REQUIRED'});assert.equal(store.state.pose.back,20);
  store.apply({pose:{leg:10}},{sequence:12,kind:'snapshot'});assert.equal(store.state.pose.back,null);
});
test('optional field adapters map values without requiring App semantic calls to use MQTT fields',()=>{
  const p=structuredClone(base);p.input={format:'mapped-v1',fields:[{path:['channels','waist'],kind:'air',id:'left.lumbar',field:'value',scale:.1},{path:['running'],kind:'air',id:'left.lumbar',field:'status',values:{1:'inflating',0:'idle'}}]};
  const store=new DeviceState(validateProfile(p));store.apply({channels:{waist:600},running:1});assert.equal(store.state.air['left.lumbar'].value,60);assert.equal(store.activeRegions().length,1);
  store.apply({air:{'left.lumbar':{status:'idle'}}},{normalized:true});assert.equal(store.activeRegions().length,0);
});
test('multiple physical pouches share one control; heat is independent and off clears its appearance',()=>{
  const p=fixture(),store=new DeviceState(p);store.apply({air:{'left.lumbar':{value:70}},heating:{'right.heat':{level:2,status:'heating'}}});
  const target=store.targets();assert.deepEqual(target.pressures,[[0],[70,70]]);assert.deepEqual(target.heating,[[2],[]]);
  store.apply({heating:{'right.heat':{status:'off'}}});assert.equal(store.targets().heating[0][0],0);assert.equal(store.state.heating['right.heat'].level,2);
});
test('continuous same-side updates preserve a single scan; stop reverses scan without changing state',()=>{
  const director=new DevicePresentation({flightMs:100,scanMs:100}),left=base.regions.filter(r=>r.side===1);
  assert.deepEqual(director.reconcile([left[0]],0),{side:'left'});assert.equal(director.tick(150).phase,'scan');
  director.reconcile([left[1]],160);assert.equal(director.tick(220).progress,1);
  for(let t=250;t<500;t+=50){director.reconcile([left[2]],t);assert.equal(director.tick(t).phase,'adjust');}
  director.reconcile([],500);assert.equal(director.tick(550).phase,'closing');assert.equal(director.tick(601).phase,'closed');
});
test('early completion cancels old entry; both sides never fight for the camera',()=>{
  const d=new DevicePresentation({flightMs:100,scanMs:100}),left=base.regions.find(r=>r.side===1),right=base.regions.find(r=>r.side===0);
  d.reconcile([left],0);d.reconcile([],30);assert.equal(d.tick(500).phase,'closed');
  assert.equal(d.reconcile([left,right],600),null);assert.equal(d.phase,'closed');
  d.preferred='right';assert.deepEqual(d.reconcile([left,right],700),{side:'right'});d.tick(901);
  d.reconcile([left,right],1000);assert.equal(d.side,'right');d.reconcile([left],1100);assert.equal(d.tick(1150).phase,'closing');assert.deepEqual(d.reconcile([left],1201),{side:'left'});
});
test('offline preserves values but stops activities; heat alone never starts an air reveal',()=>{
  const store=new DeviceState(base);store.apply({air:{'left.lumbar':{value:60,status:'adjusting'}}});store.apply({online:false});assert.equal(store.activeRegions().length,0);assert.equal(store.state.air['left.lumbar'].value,60);
  const d=new DevicePresentation();d.reconcile([],0);assert.equal(d.tick(10000).phase,'closed');
});
test('enabling reduced motion during a live entrance immediately reveals and closes without replay',()=>{
  const d=new DevicePresentation({flightMs:1000,scanMs:1000});d.reconcile([base.regions[0]],0);d.reducedMotion=true;
  assert.equal(d.tick(10).phase,'adjust');assert.equal(d.progress,1);d.reconcile([],20);assert.equal(d.tick(20).phase,'closed');
});
test('dynamic pouches and independent heat follow the same surface at flat/max pose in both surrounds',()=>{
  const p=fixture(),materials=Object.fromEntries(Object.keys(MATERIAL_CONFIG).map(id=>[id,new THREE.MeshStandardMaterial()]));
  const bed=new SmartBed({get:id=>materials[id]},{airbags:p.airbags}),air=new FirmnessEffect(p.airbags),heat=new HeatingEffect(p.heating,p.airbags),store=new DeviceState(p);
  store.apply({air:{'left.lumbar':{value:100},'right.leg':{value:10}},heating:{'right.heat':{level:3}}});const values=store.targets();
  assert.equal(bed.airbags.length,3);assert.equal(air.entries.length,3);assert.equal(heat.entries.length,1);
  for(const style of ['wide','flush'])for(const [back,leg] of [[0,0],[65,35]]){
    bed.setSurroundStyle(style);bed.update({...values,back,leg,xray:0,explode:0,showroom:true,airReveal:{phase:'adjust',side:'left',progress:1}});
    air.root.visible=heat.root.visible=true;air.update({spine:bed.spine,pressures:values.pressures,selection:{side:'left',kind:'air',activeRegionIds:['left.lumbar']},time:1,moving:true});heat.update({spine:bed.spine,...values,time:1,moving:true});
    assert.equal(air.entries.filter(e=>e.pulse.visible).length,2);
    for(const root of [bed.root,air.root,heat.root])root.traverse(o=>{if(o.geometry)assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));});
  }
  const bag=p.airbags[0];assert.ok(surfaceLift(bag.x,bag.z,values.pressures,p.airbags)>0);
});

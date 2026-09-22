import { mapPoint } from './kinematics.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ModelRegistry, validateProfile } from './model-profiles.js';
import { DeviceState } from './device-state.js';
import { MassageMotion, massagePulse, massageSurfaceLift } from './massage.js';
import { MassageEffect } from './massage-effect.js';
import { MattressViewer } from './mattress-sdk.js';
import { SmartBed } from './model.js';
import { HeatingEffect } from './heating-effect.js';
import { MATERIAL_CONFIG } from './materials.js';
import { T12_MASSAGE_LAYOUT as D } from './dimensions.js';

const registry=new ModelRegistry(),profile=registry.resolve('T12');
const running={status:'running',intensity:.7,cycleSeconds:9};
function motionFixture(){const store=new DeviceState(profile),motion=new MassageMotion(profile.massage);return {store,motion,step:(n=60,options={})=>{let moving;for(let i=0;i<n;i++)moving=motion.step(store.state.massage,1/60,options);return moving;}};}

test('T12 massage layout has three separate modules on each supine side and rejects invalid layouts',()=>{
  assert.equal(registry.resolve('T11+').massage.length,0);assert.equal(registry.resolve('generic').massage.length,0);
  assert.deepEqual(profile.massage.map(c=>c.pads.map(p=>p.cells.length)),[[6,6,4],[6,6,4]]);
  for(const mutate of [p=>p.massage[0].pads[0].x=.4,p=>p.massage[0].pads[0].cells[0].radius=.2,p=>p.massage.push(p.massage[0]),p=>p.massage[0].defaultCycleSeconds=0]){
    const p=structuredClone(profile);mutate(p);assert.throws(()=>validateProfile(p),{code:'INVALID_PROFILE'});
  }
});
test('massage reports are atomic, independent of air/heat/pose and stale snapshots',()=>{
  const store=new DeviceState(profile);assert.equal(store.state.massage.left.status,null);
  store.apply({massage:{left:running},air:{'right.circuit4':{value:73,status:'adjusting'}},heating:{'left.leg':{level:3,status:'heating'}},pose:{back:25}},{sequence:1});
  const before=store.snapshot();assert.equal(store.state.massage.right.status,null);
  assert.throws(()=>store.apply({massage:{left:{status:'off'},right:{cycleSeconds:0}},pose:{back:0}},{sequence:2}),{code:'INVALID_STATE'});assert.deepEqual(store.snapshot(),before);
  for(const bad of [{intensity:NaN},{intensity:1.1},{cycleSeconds:31},{status:'inflate'},{extra:true}])assert.throws(()=>store.apply({massage:{left:bad}}),{code:'INVALID_STATE'});
  store.apply({massage:{right:running}},{sequence:2});assert.deepEqual(store.state.massage.left,before.massage.left);assert.deepEqual(store.state.air,before.air);assert.deepEqual(store.state.heating,before.heating);assert.deepEqual(store.state.pose,before.pose);
  assert.equal(store.apply({massage:{left:{status:'off'}}},{sequence:1}).ignored,true);
  store.apply({pose:{back:0}},{kind:'snapshot',sequence:3});assert.equal(store.state.massage.left.status,null);
  assert.throws(()=>new DeviceState(registry.resolve('generic')).apply({massage:{left:running}}),{code:'UNSUPPORTED_MASSAGE'});
});
test('each massage cycle keeps its phase when the opposite side starts, stops or repeats a report',()=>{
  const {store,motion,step}=motionFixture();store.apply({massage:{left:running}});step(100);
  const leftPhase=motion.lanes.left.phase;assert.equal(motion.lanes.right.amount,0);
  store.apply({massage:{right:running}});step(1);assert.ok(Math.abs(motion.lanes.left.phase-leftPhase-1/540)<1e-9);assert.ok(motion.lanes.right.phase<motion.lanes.left.phase);
  const phase=motion.lanes.left.phase;store.apply({massage:{left:running}});step(1);assert.ok(Math.abs(motion.lanes.left.phase-phase-1/540)<1e-9);
  store.apply({massage:{right:{status:'off'}}});step(60);assert.equal(motion.lanes.right.amount,0);assert.ok(motion.lanes.left.amount>0);
  assert.deepEqual(store.state.massage.left,running);
});
test('massage pauses and resumes smoothly, freezes offline, respects reduced motion and settles when off',()=>{
  const {store,motion,step}=motionFixture();store.apply({massage:{left:running}});step();
  store.apply({massage:{left:{status:'paused'}}});const frozen=motion.snapshot();assert.equal(step(),false);assert.deepEqual(motion.snapshot(),frozen);
  store.apply({massage:{left:{status:'running'}}});assert.equal(step(1),true);const global=motion.snapshot();step(60,{paused:true});assert.deepEqual(motion.snapshot(),global);
  step(60,{online:false});assert.deepEqual(motion.snapshot(),global);
  assert.equal(step(60,{reducedMotion:true}),false);assert.equal(motion.lanes.left.phase,global.left.phase);
  store.apply({massage:{left:{status:'off'}}});assert.equal(step(60),false);assert.equal(motion.lanes.left.amount,0);assert.equal(step(1),false);
  for(let i=0;i<100;i++)assert.ok(Math.abs(massagePulse(i/1000,0,3)-massagePulse((i+1)/1000,0,3))<.007);
});
test('intensity changes ease in during a run and remain frozen while paused',()=>{
  const {store,motion,step}=motionFixture();store.apply({massage:{left:running}});step();
  store.apply({massage:{left:{status:'paused',intensity:.1,cycleSeconds:20}}});const before=motion.snapshot();step();assert.deepEqual(motion.snapshot(),before);
  store.apply({massage:{left:{status:'running'}}});step(1);assert.ok(motion.lanes.left.intensity<.7&&motion.lanes.left.intensity>.65);assert.equal(motion.lanes.left.cycleSeconds,20);
  step(60);assert.ok(Math.abs(motion.lanes.left.intensity-.1)<1e-8);
});
test('massage geometry stays below heating, follows both bed styles and never reveals support by itself',()=>{
  const materials=Object.fromEntries(Object.keys(MATERIAL_CONFIG).map(id=>[id,new THREE.MeshStandardMaterial()]));
  const bed=new SmartBed({get:id=>materials[id]},{coverStyle:'tailored',airbags:profile.airbags,massage:profile.massage});
  const effect=new MassageEffect(profile.massage,profile.airbags,bed.surfaceTop),heat=new HeatingEffect(profile.heating,profile.airbags,bed.surfaceTop),store=new DeviceState(profile),motion=new MassageMotion(profile.massage);
  store.apply({massage:{left:{...running,intensity:1}},heating:{'left.lumbar':{level:3,status:'heating'}}});for(let i=0;i<60;i++)motion.step(store.state.massage,1/60);
  const values=store.targets(),lanes=motion.snapshot();assert.ok(effect.baseY+D.minHeight+D.lift<heat.surfaceTop);
  for(const style of ['wide','flush'])for(const [back,leg] of [[0,0],[65,35]]){
    bed.setSurroundStyle(style);values.pressures=[Array(9).fill(0),Array(9).fill(100)];
    bed.update({...values,back,leg,massage:lanes,xray:0,explode:0,showroom:true,airReveal:{phase:'closed'}});
    assert.equal(bed.airGroup.visible,false);assert.equal(bed.cover.renderOrder,0);assert.equal(bed.cover.material,bed.coverMaterials);
    effect.root.visible=heat.root.visible=true;effect.update({spine:bed.spine,pressures:values.pressures,lanes});heat.update({spine:bed.spine,...values,massageChannels:profile.massage,massage:lanes,time:1,moving:true});
    assert.equal(effect.entries.find(e=>e.channel.id==='right').body.visible,false);assert.ok(effect.entries.find(e=>e.channel.id==='left').glows.every(g=>g.mesh.visible));assert.equal(effect.entries.find(e=>e.channel.id==='left').body.count,16);
    for(const entry of effect.entries){assert.ok(entry.body.instanceMatrix.array.every(Number.isFinite));for(const {base,ripple} of entry.pads)for(const mesh of [base,ripple])assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));}
    for(const {definition,rest,mesh} of heat.entries.filter(e=>e.mesh.visible))for(let i=0;i<rest.count;i++){const x=definition.x+rest.getX(i),z=definition.z+rest.getZ(i),p=mapPoint(bed.spine,x,bed.surfaceTop+.009+massageSurfaceLift(profile.massage,lanes,x,z),z,null,false);assert.ok(Math.abs(mesh.geometry.attributes.position.getY(i)-p.y)<1e-6);}
    const m=new THREE.Matrix4(),top=new THREE.Vector3(0,.5,0),left=effect.entries.find(e=>e.channel.id==='left');left.body.getMatrixAt(0,m);top.applyMatrix4(m);assert.ok(top.y>.3);assert.ok(top.z>-.96);
    bed.update({...values,back,leg,massage:lanes,xray:0,explode:0,showroom:true,airReveal:{side:'right',phase:'adjust',progress:1}});assert.equal(bed.airGroup.visible,true);assert.equal(bed.coverReveal.uniforms.revealOpenSides.value.x,1);assert.equal(bed.coverReveal.uniforms.revealOpenSides.value.y,0);
    bed.update({...values,back,leg,xray:0,explode:0,showroom:true,airReveal:{phase:'closed'}});assert.equal(bed.cover.renderOrder,0);assert.equal(bed.airGroup.visible,false);assert.equal(bed.cover.material,bed.coverMaterials);
  }
});
test('SDK rejects old model tokens and invalid mixed updates without cancelling unrelated motions',()=>{
  const viewer=Object.create(MattressViewer.prototype);viewer.disposed=false;viewer.bundle={modelToken:'current',store:new DeviceState(profile)};viewer.invalidate=()=>{};viewer.emit=()=>{};viewer.follow=false;viewer.airMotions=new Map();let stops=0;viewer.stopAir=()=>stops++;viewer.stopPose=()=>stops++;
  assert.throws(()=>viewer.updateDeviceState({massage:{left:running}},{modelToken:'old',normalized:true}),{code:'STALE_MODEL'});
  viewer.updateDeviceState({massage:{left:running}},{normalized:true});
  assert.throws(()=>viewer.updateDeviceState({massage:{right:{intensity:2}},air:{'right.circuit7':{value:20}},pose:{back:10}},{normalized:true}),{code:'INVALID_STATE'});assert.equal(stops,0);assert.equal(viewer.bundle.store.state.massage.right.status,null);
  const other=new MassageMotion(profile.massage);assert.equal(other.lanes.left.amount,0);
});

test('support pressure leaves the cover flat while massage lifts only the active human side',()=>{
  const materials=Object.fromEntries(Object.keys(MATERIAL_CONFIG).map(id=>[id,new THREE.MeshStandardMaterial()]));
  const bed=new SmartBed({get:id=>materials[id]},{coverStyle:'tailored',airbags:profile.airbags,massage:profile.massage});
  const state={...new DeviceState(profile).targets(),back:0,leg:0,xray:0,explode:0,showroom:true,airReveal:{side:'both',phase:'adjust',progress:1}};
  state.pressures=[Array(9).fill(0),Array(9).fill(0)];bed.update(state);const flat=bed.cover.geometry.attributes.position.array.slice(),airHeight=bed.airbags[0].halfHeight;
  state.pressures=[Array(9).fill(100),Array(9).fill(100)];bed.update(state);
  assert.deepEqual(bed.cover.geometry.attributes.position.array,flat);assert.ok(bed.airbags[0].halfHeight>airHeight);
  for(const side of ['left','right']){
    bed.update({...state,massage:{[side]:{amount:1,intensity:1,phase:0}}});const positions=bed.cover.geometry.attributes.position.array;
    let peak=0;for(let i=0;i<positions.length;i+=3){const lift=positions[i+1]-flat[i+1];if((side==='left'?flat[i]>0:flat[i]<0))peak=Math.max(peak,lift);else assert.equal(lift,0);}
    assert.ok(peak>.025&&peak<.035);
  }
  bed.update(state);assert.deepEqual(bed.cover.geometry.attributes.position.array,flat);
});

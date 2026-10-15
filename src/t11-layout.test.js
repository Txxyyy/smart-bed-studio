import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ModelRegistry} from './model-profiles.js';
import {DeviceState} from './device-state.js';
import {SmartBed} from './model.js';
import {MATERIAL_CONFIG} from './materials.js';
import {FirmnessEffect} from './firmness-effect.js';
const profile=new ModelRegistry().resolve('T11+');
test('T11+ has seven nonoverlapping bags per side driven by three circuits',()=>{
  assert.equal(profile.airbags.length,14);assert.equal(profile.regions.length,6);
  for(const side of [0,1]){
    const regions=profile.regions.filter(r=>r.side===side),bags=profile.airbags.filter(b=>b.side===side);
    assert.deepEqual(regions.map(r=>r.name),['肩部','腰部','臀部']);
    assert.deepEqual(regions.map(r=>bags.filter(b=>b.regionId===r.id).length),[2,2,3]);
    for(let i=1;i<bags.length;i++)assert.ok(bags[i].z-bags[i].depth/2>bags[i-1].z+bags[i-1].depth/2);
  }
  assert.equal(new ModelRegistry().resolve('T12').airbags.length,18);
});
test('each T11+ circuit inflates and highlights all its bags, preserving the opposite side',()=>{
  const materials=Object.fromEntries(Object.keys(MATERIAL_CONFIG).map(id=>[id,new THREE.MeshStandardMaterial()]));
  const bed=new SmartBed({get:id=>materials[id]},{airbags:profile.airbags});
  const effect=new FirmnessEffect(profile.airbags);effect.root.visible=true;
  for(const style of ['wide','flush'])for(const back of [0,65])for(const region of profile.regions){
    const store=new DeviceState(profile);store.apply({air:{[region.id]:{value:75,status:'adjusting'}}});const values=store.targets();
    bed.setSurroundStyle(style);bed.update({...values,back,leg:back?35:0,explode:0,xray:0,showroom:true,airReveal:{phase:'adjust',side:region.side?'left':'right',progress:1}});
    effect.update({spine:bed.spine,pressures:values.pressures,selection:{activeRegionIds:[region.id],side:region.side?'left':'right'},time:1,moving:true});
    const expected=profile.airbags.filter(b=>b.regionId===region.id);
    assert.equal(effect.surface.entries.filter(e=>e.mesh.visible).length,expected.length);
    for(const bag of profile.airbags)assert.equal(values.pressures[bag.side][bag.zone],bag.regionId===region.id?75:0);
    for(const b of bed.airbags)for(const cell of b.cells)assert.ok(cell.geometry.attributes.position.array.every(Number.isFinite));
    assert.ok(bed.cover.geometry.attributes.position.array.every(Number.isFinite));
  }
});

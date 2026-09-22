import test from 'node:test';
import assert from 'node:assert/strict';
import {ModelRegistry} from './model-profiles.js';
import {DeviceState} from './device-state.js';
import {tidalGroups} from './t12-circuits.js';
import {MattressViewer} from './mattress-sdk.js';
const profile=new ModelRegistry().resolve('T12');
test('T12 drawing has nine rows of seven cells and seven independent circuits per side',()=>{
  for(const side of [0,1]){
    const rows=profile.airbags.filter(b=>b.side===side);assert.equal(rows.length,9);assert.ok(rows.every(b=>b.cellCount===7&&b.shape==='round-array'));
    assert.deepEqual(profile.regions.filter(r=>r.side===side).map(r=>rows.filter(b=>b.regionId===r.id).length),[1,2,1,1,1,1,2]);
  }
});
test('tidal assignment covers every circuit exactly once for all waist choices and sides',()=>{
  for(const side of ['left','right'])for(const waist of [3,4,5]){
    const groups=tidalGroups(side,waist),ids=groups.flatMap(g=>g.circuitIds);assert.equal(new Set(ids).size,7);assert.equal(ids.length,7);
    assert.deepEqual(groups[2].circuitIds,[`${side}.circuit${waist}`]);
    for(const n of [3,4,5])if(n!==waist)assert.ok(groups[n<waist?1:3].circuitIds.includes(`${side}.circuit${n}`));
    const store=new DeviceState(profile);store.apply({air:Object.fromEntries(groups[1].circuitIds.map(id=>[id,{value:63,status:'adjusting'}]))});
    const values=store.targets();for(const bag of profile.airbags)assert.equal(values.pressures[bag.side][bag.zone],groups[1].circuitIds.includes(bag.regionId)?63:0);
  }
});
test('waist reassignment preserves physical state and rejects stale and invalid selections',()=>{
  const v=Object.create(MattressViewer.prototype);v.disposed=false;v.bundle={profile,modelToken:'new',waist:{left:4,right:4},store:new DeviceState(profile)};v.emit=()=>{};
  v.bundle.store.apply({air:{'left.circuit3':{value:33,status:'adjusting'},'left.circuit4':{value:44,status:'idle'}}});
  const before=v.bundle.store.snapshot();v.setWaistCircuit('left',5,{modelToken:'new'});assert.equal(v.bundle.waist.right,4);assert.deepEqual(v.bundle.store.snapshot(),before);
  for(const args of [['left',2,{}],['both',4,{}],['right',3,{modelToken:'old'}]])assert.throws(()=>v.setWaistCircuit(...args));
  assert.deepEqual(v.bundle.waist,{left:5,right:4});
});


test('T12 compact rows leave the foot control bay free of support cells',()=>{
  const rows=profile.airbags.filter(b=>b.side===1);
  for(const row of rows){
    const diameter=row.width/7*.92;
    assert.ok(Math.abs(row.x)+row.width/2<.8);
    assert.ok(row.z+row.depth/2<.49);
    assert.ok(diameter>.095);
  }
  for(let i=1;i<rows.length;i++){
    const gap=rows[i].z-rows[i-1].z-rows[i].width/7*.92;
    assert.ok(gap>0&&gap<.045);
  }
});

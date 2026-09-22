import test from 'node:test';
import assert from 'node:assert/strict';
import { setZonePressure, desiredPressure, firmnessCamera, shortestAngle, sampleAirReveal, REVEAL_TIMING } from './firmness.js';
import { FirmnessEffect } from './firmness-effect.js';
import { buildSpine } from './kinematics.js';

test('every individual adjustment changes exactly one of eight independent values', () => {
  const initial = [[10, 20, 30, 40], [60, 70, 80, 90]];
  for (const side of ['left', 'right']) for (let zone = 0; zone < 4; zone++) {
    const next = setZonePressure(initial, side, zone, 100);
    const changes = next.flat().filter((v, i) => v !== initial.flat()[i]);
    assert.equal(changes.length, 1);
    assert.equal(next[side === 'left' ? 0 : 1][zone], 100);
  }
  assert.deepEqual(initial, [[10,20,30,40],[60,70,80,90]]);
  assert.deepEqual(setZonePressure(initial, 'both', 1, 0), [[10,0,30,40],[60,0,80,90]]);
});

test('cycle stays within the selected side and region, then restores saved setpoints', () => {
  const pressures = [[10,20,30,40],[60,70,80,90]], selection = {side:'right',zone:2};
  for (let side=0;side<2;side++) for(let zone=0;zone<4;zone++) {
    const value = desiredPressure(pressures,selection,true,side,zone,.7);
    if(side===1&&zone===2) assert.equal(value,100);
    else assert.equal(value,pressures[side][zone]);
    assert.equal(desiredPressure(pressures,selection,false,side,zone,.7),pressures[side][zone]);
  }
});

test('left and right cameras are mirrored, with a centered synchronized view and shortest orbit', () => {
  for (let zone=0;zone<4;zone++) {
    const left=firmnessCamera('left',zone),right=firmnessCamera('right',zone);
    assert.equal(left.azimuth,-right.azimuth);
    assert.equal(left.target[0],-right.target[0]);
    assert.equal(left.radius,right.radius);
    assert.equal(firmnessCamera('both',zone).azimuth,0);
  }
  assert.ok(Math.abs(shortestAngle(3.1,-3.1)-3.1)<.1);
});

test('air adjustment waits for camera then scan, while heat never reveals internal structure',()=>{
  const selection={kind:'air',side:'right',zone:1},transition={start:100,flight:REVEAL_TIMING.flight};
  const flight=sampleAirReveal(selection,transition,600);
  assert.equal(flight.phase,'camera');assert.equal(flight.progress,0);assert.equal(flight.ready,false);
  const scan=sampleAirReveal(selection,transition,100+REVEAL_TIMING.flight+400);
  assert.equal(scan.phase,'scan');assert.equal(scan.ready,false);assert.ok(scan.progress>0&&scan.progress<1);
  assert.equal(sampleAirReveal(selection,transition,100+REVEAL_TIMING.flight+REVEAL_TIMING.scan).ready,true);
  for(const kind of ['heat','rest'])assert.deepEqual(sampleAirReveal({...selection,kind},transition,5000),{side:null,phase:'closed',progress:0,ready:true});
  assert.equal(sampleAirReveal(selection,transition,100,true).phase,'adjust');
});

test('holograms follow flat and maximum articulation, with effects on the chosen region only', () => {
  const effect=new FirmnessEffect();effect.root.visible=true;
  for(const [back,leg] of [[0,0],[65,35]]) for(const side of ['left','right','both']) {
    effect.update({spine:buildSpine(back,leg),pressures:[[0,100,0,100],[100,0,100,0]],selection:{side,zone:1},time:1,moving:true});
    assert.equal(effect.entries.filter(e=>e.pulse.visible).length,side==='both'?2:1);
    for(const e of effect.entries) {
      for(const object of [e.tile,e.pulse,e.particles])assert.ok([...object.geometry.attributes.position.array].every(Number.isFinite));
      assert.ok(e.tile.geometry.boundingSphere.radius<.6);
    }
  }
  effect.update({spine:buildSpine(0,0),pressures:[[50,50,50,50],[50,50,50,50]],selection:{side:'left',zone:1},time:2,moving:false});
  assert.ok(effect.entries.every(e=>!e.pulse.visible&&!e.particles.visible));
});

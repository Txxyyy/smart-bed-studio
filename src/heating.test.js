import test from 'node:test';
import assert from 'node:assert/strict';
import { HEAT_ZONES, setHeatLevel } from './heating.js';
import { HeatingEffect } from './heating-effect.js';
import { FirmnessEffect } from './firmness-effect.js';
import { DEMO_STEPS, DEMO_STEP_SECONDS, sampleShowroomDemo } from './showroom-demo.js';
import { AIR_LAYOUT, SHOWROOM_LAYOUT, DIMENSIONS } from './dimensions.js';
import { buildSpine, mapPoint, ZONES } from './kinematics.js';

const pressures=[[50,50,50,50],[50,50,50,50]];

test('waist and leg heating stay independent on each side and only sync explicitly',()=>{
  const heating=[[0,1],[2,3]],copy=structuredClone(heating);
  assert.deepEqual(setHeatLevel(heating,'left',0,3),[[3,1],[2,3]]);
  assert.deepEqual(setHeatLevel(heating,'right',1,0),[[0,1],[2,0]]);
  assert.deepEqual(setHeatLevel(heating,'both',0,1),[[1,1],[1,3]]);
  assert.deepEqual(heating,copy);
});

test('internal air effects and heat stay inside one assembled mattress envelope',()=>{
  const spine=buildSpine(0,0),cold=new FirmnessEffect(),heat=new HeatingEffect();
  cold.root.visible=heat.root.visible=true;
  cold.update({spine,pressures:[[100,100,100,100],[100,100,100,100]],selection:{side:'left',zone:1},time:1,moving:true});
  heat.update({spine,pressures,heating:[[3,0],[0,2]],time:1,moving:true});
  const maxColdY=Math.max(...cold.entries.flatMap(e=>Array.from(e.tile.geometry.attributes.position.array).filter((_,i)=>i%3===1)));
  const minHeatY=Math.min(...heat.entries.filter(e=>e.mesh.visible).flatMap(e=>Array.from(e.mesh.geometry.attributes.position.array).filter((_,i)=>i%3===1)));
  assert.ok(maxColdY<DIMENSIONS.deckHeight+AIR_LAYOUT.bottom+2*(AIR_LAYOUT.minHalfHeight+AIR_LAYOUT.halfHeightRange)+.008);
  assert.ok(minHeatY>maxColdY,'heat is above the internal pouches');
  assert.ok(minHeatY<maxColdY+.07,'there is no exploded display gap');
  assert.equal(heat.entries.filter(e=>e.waves.visible).length,2);
  assert.equal(heat.entries[0].mesh.material.uniforms.amount.value,1);
  assert.equal(heat.entries[1].mesh.material.uniforms.amount.value,0);
  assert.equal(heat.root.children.length,8,'only the four patches and their heat waves, no lifted layer outline');
});

test('heating follows maximum articulation, and turning it off removes energy and waves',()=>{
  const heat=new HeatingEffect();heat.root.visible=true;
  const spine=buildSpine(65,35);
  heat.update({spine,pressures,heating:[[3,3],[3,3]],time:3,moving:true});
  for(const entry of heat.entries)assert.ok([...entry.mesh.geometry.attributes.position.array,...entry.waves.geometry.attributes.position.array].every(Number.isFinite));
  for(const entry of heat.entries){
    const {side,region,rest,mesh}=entry;
    for(let i=0;i<rest.count;i++){
      const expected=mapPoint(spine,(side?1:-1)*AIR_LAYOUT.centerX+rest.getX(i),SHOWROOM_LAYOUT.surfaceTop+SHOWROOM_LAYOUT.heatGap,ZONES[HEAT_ZONES[region].zone].z+rest.getZ(i),pressures,false);
      assert.ok(Math.hypot(mesh.geometry.attributes.position.getY(i)-expected.y,mesh.geometry.attributes.position.getZ(i)-expected.z)<1e-6,'heat follows the cover without support-pressure displacement');
    }
  }
  heat.update({spine,pressures,heating:[[0,0],[0,0]],time:4,moving:false});
  assert.ok(heat.entries.every(e=>!e.waves.visible&&e.mesh.material.uniforms.amount.value===0));
});

test('automatic sequence covers every air and heat zone, wraps, and never changes manual settings',()=>{
  const baseline={pressures:[[41,42,43,44],[61,62,63,64]],heating:[[0,1],[2,0]]},before=structuredClone(baseline);
  const visited=new Set();
  for(let step=0;step<DEMO_STEPS.length;step++){
    const frame=sampleShowroomDemo((step+.98)*DEMO_STEP_SECONDS,baseline);
    visited.add(`${frame.selection.side}/${frame.selection.kind}/${frame.selection.zone}`);
    if(['air','heat'].includes(frame.selection.kind)){
      const s=frame.selection.side==='right'?1:0;
      const value=frame.selection.kind==='air'?frame.pressures[s][frame.selection.zone]:frame.heating[s][HEAT_ZONES.findIndex(r=>r.zone===frame.selection.zone)];
      assert.equal(value,frame.selection.value);
    }else if(frame.selection.kind==='rest'){assert.deepEqual(frame.pressures,baseline.pressures);assert.deepEqual(frame.heating,baseline.heating);}
  }
  for(const side of ['left','right']){
    for(let zone=0;zone<4;zone++)assert.ok(visited.has(`${side}/air/${zone}`));
    for(const {zone} of HEAT_ZONES)assert.ok(visited.has(`${side}/heat/${zone}`));
  }
  const next=sampleShowroomDemo(DEMO_STEPS.length*DEMO_STEP_SECONDS+.01,baseline);
  assert.equal(next.cycle,2);assert.equal(next.index,0);
  assert.deepEqual(baseline,before);
});

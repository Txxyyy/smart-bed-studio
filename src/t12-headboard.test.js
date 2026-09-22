import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SmartBed } from './model.js';
import { MATERIAL_CONFIG } from './materials.js';
import { DIMENSIONS, TAILORED_COVER, T12_HEADBOARD_LAYOUT } from './dimensions.js';

function fixture(){
  const materials=Object.fromEntries(Object.keys(MATERIAL_CONFIG).map(id=>[id,new THREE.MeshStandardMaterial({name:id})]));
  const bed=new SmartBed({get:id=>materials[id]},{coverStyle:'tailored'});bed.setHeadboardStyle('t12');return bed;
}
const state={back:0,leg:0,pressures:[[0,0,0,0],[0,0,0,0]],xray:0,explode:0};

test('T12 headboard has four cushions, independent feet and photo-fit exposed proportions',()=>{
  const bed=fixture(),d=T12_HEADBOARD_LAYOUT;
  for(const style of ['wide','flush']){
    bed.setSurroundStyle(style);bed.update(state);const h=bed.headboard,bounds=new THREE.Box3().setFromObject(h);
    assert.ok(Math.abs(bounds.max.y-d.height)<1e-5);assert.ok(Math.abs(bounds.min.y)<1e-5);
    assert.ok(Math.abs(bounds.max.x-bounds.min.x-bed.layout.headboardWidth)<1e-5);
    assert.equal(h.children.filter(c=>c.name.startsWith('T12_Upper_Cushion')).length,2);
    assert.equal(h.children.filter(c=>c.name.startsWith('T12_Lower_Bolster')).length,2);
    assert.equal(h.children.filter(c=>c.name.startsWith('T12_Curved_Double_Stitch')).length,4);
    h.traverse(o=>{
      if(!o.isMesh)return;
      assert.ok(o.geometry.attributes.position.array.every(Number.isFinite),`${o.name}: finite vertices`);
      const n=o.geometry.attributes.normal;
      for(let i=0;i<n.count;i++)assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5,`${o.name}: unit normals`);
    });
    const surface=DIMENSIONS.deckHeight+bed.surfaceTop,exposed=d.height-surface;
    assert.ok(exposed/TAILORED_COVER.height>2.4&&exposed/TAILORED_COVER.height<2.6);
    assert.ok(d.lowerBottom>surface&&d.lowerBottom-surface<.02);
    const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,0,-1));
    for(const x of [-.70,-.40,0,.40,.70])for(const y of [.25,.40,.60]){
      ray.ray.origin.set(x,y,0);const hit=ray.intersectObject(h,true)[0];assert.ok(hit);
      const gap=-DIMENSIONS.length/2-hit.point.z;assert.ok(gap>.005&&gap<.035,`T12 rear gap ${gap}`);
    }
  }
  const chosen=bed.headboard;bed.setHeadboardStyle('cushion');assert.equal(chosen.visible,false);
  assert.ok(bed.headboard.getObjectByName('Back_Cushion_Left'));
  bed.setHeadboardStyle('t12');assert.equal(bed.headboard,chosen);
});

test('T12 padded headboard clears the tall mattress and back deck throughout articulation',()=>{
  const bed=fixture(),point=new THREE.Vector3(),ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,0,-1));
  for(const style of ['wide','flush']){
    bed.setSurroundStyle(style);const colliders=[];bed.headboard.traverse(o=>{if(o.isMesh)colliders.push(o);});
    for(const back of [0,15,35,52,65])for(const pressure of [0,100]){
      bed.update({...state,back,leg:35,pressures:[[pressure,pressure,pressure,pressure],[100-pressure,100-pressure,100-pressure,100-pressure]]});
      for(const object of [bed.cover,...bed.decks[0].group.children]){
        const p=object.geometry.attributes.position;
        for(let i=0;i<p.count;i+=3){
          point.fromBufferAttribute(p,i).applyMatrix4(object.matrixWorld);
          if(point.z>-.83||point.y<.24||point.y>T12_HEADBOARD_LAYOUT.height)continue;
          ray.ray.origin.set(point.x,point.y,.5);const hit=ray.intersectObjects(colliders,false)[0];
          if(hit)assert.ok(point.z-hit.point.z>.005,`${style} back=${back} ${object.name}: headboard gap ${point.z-hit.point.z}`);
        }
      }
    }
  }
});

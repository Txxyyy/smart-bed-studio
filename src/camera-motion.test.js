import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MattressViewer } from './mattress-sdk.js';

test('side entry rotates and pulls closer throughout the same flight',()=>{
  for(const side of ['left','right']){
    const viewer=Object.create(MattressViewer.prototype);
    viewer.perspective=new THREE.PerspectiveCamera(38,1.5,.05,80);
    viewer.activeCamera=viewer.perspective;
    viewer.activeCamera.position.set(0,2.5,4.7);
    viewer.controls={target:new THREE.Vector3(0,.52,0),update(){}};
    viewer.camera={cancel(){viewer.cameraFlight=null;},setFollow(){}};
    Object.assign(viewer,{assertReady(){},assertAlive(){},invalidate(){},emit(){},renderer:{render(){}},media:{matches:false},actionCounter:0,frames:0,lastFrame:0});
    viewer.focusSide(side,true,1800);
    const flight=viewer.cameraFlight;
    let radius=flight.from.radius,theta=0;
    assert.ok(flight.to.radius<radius-.5);
    for(const fraction of [.2,.4,.6,.8,1]){
      viewer.frame(flight.start+fraction*flight.duration);
      const spherical=new THREE.Spherical().setFromVector3(viewer.activeCamera.position.clone().sub(viewer.controls.target));
      assert.ok(spherical.radius<radius);
      assert.ok(Math.abs(spherical.theta)>theta);
      radius=spherical.radius;theta=Math.abs(spherical.theta);
    }
    assert.ok(Math.abs(viewer.activeCamera.position.clone().sub(viewer.controls.target).normalize().y-.5)<.001);
    assert.ok(Math.abs(theta-THREE.MathUtils.degToRad(70))<.00001);
  }
});

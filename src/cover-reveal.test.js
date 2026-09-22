import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CoverReveal } from './cover-reveal.js';

test('local cover material preserves source textiles and refreshes changed texture programs',()=>{
  const geometry=new THREE.BoxGeometry(1.6,.21,1.9);
  const cover=new THREE.Mesh(geometry),source=new THREE.MeshStandardMaterial({color:0x233647,map:new THREE.Texture()});
  cover.userData.rest=Array.from(geometry.attributes.position.array);
  const reveal=new CoverReveal(cover),copy=reveal.material(source),version=copy.version;
  assert.notEqual(copy,source);assert.equal(copy.map,source.map);
  assert.equal(source.transparent,false);assert.equal(source.opacity,1);
  assert.equal(reveal.material(source),copy);assert.equal(copy.version,version,'unchanged source does not rebuild its program');
  source.normalMap=new THREE.Texture();source.needsUpdate=true;
  reveal.material(source);assert.equal(copy.normalMap,source.normalMap);assert.ok(copy.version>version);
  reveal.update({side:'left',phase:'scan',progress:.4});
  assert.deepEqual(reveal.uniforms.revealSides.value.toArray(),[1,0]);
  assert.equal(reveal.uniforms.revealScan.value,1);
  reveal.update({side:null,phase:'closed',progress:0});
  assert.equal(reveal.uniforms.revealOpen.value,0);assert.equal(reveal.uniforms.revealScan.value,0);
  assert.deepEqual(reveal.uniforms.revealSides.value.toArray(),[0,0]);
});

test('independent human-left and human-right scan masks can coexist',()=>{
  const geometry=new THREE.BoxGeometry(1.6,.21,1.9),cover=new THREE.Mesh(geometry);cover.userData.rest=Array.from(geometry.attributes.position.array);
  const reveal=new CoverReveal(cover);
  reveal.update({sides:{left:{phase:'adjust',progress:1},right:{phase:'scan',progress:.35}}});
  // Shader slots are physical -X/right and +X/left, respectively.
  assert.deepEqual(reveal.uniforms.revealProgressSides.value.toArray(),[.35,1]);
  assert.deepEqual(reveal.uniforms.revealOpenSides.value.toArray(),[1,1]);
  assert.deepEqual(reveal.uniforms.revealScanSides.value.toArray(),[1,0]);
});

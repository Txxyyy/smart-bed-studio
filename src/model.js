import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildSpine, sampleSpine, mapPoint, ZONES } from './kinematics.js';
import { createAnatomy } from './anatomy.js';
import { createHeadboard, HEADBOARD_LAYOUT } from './headboard.js';
import { createBoundWelt, updateBoundWelt } from './upholstery.js';
import { solveMechanism } from './mechanism.js';
import { createCadFrame } from './cad-frame.js';
import { DIMENSIONS, AIR_LAYOUT, SURROUND_STYLES, SURROUND_HEIGHT } from './dimensions.js';
import { createMattressBranding } from './branding.js';
import { HEADBOARD_STYLES } from './cmf.js';
export { SURROUND_STYLES } from './dimensions.js';

const V = (x,y,z) => new THREE.Vector3(x,y,z);
const metal = new THREE.MeshStandardMaterial({color:0xa3b0b1,metalness:0.9,roughness:0.25});
const dark = new THREE.MeshStandardMaterial({color:0x141e20,metalness:0.5,roughness:0.45});
const cyan = new THREE.MeshStandardMaterial({color:0x74e9d1,emissive:0x26bfa7,emissiveIntensity:1.8,roughness:0.35});

function mesh(geometry, material, parent, name) {
  const m = new THREE.Mesh(geometry,material);m.castShadow=true;m.receiveShadow=true;m.name=name;parent.add(m);return m;
}
function box(parent,name,w,h,d,x,y,z,mat,r=0.02) {
  const m=mesh(new RoundedBoxGeometry(w,h,d,1,Math.min(r,w*.4,h*.4,d*.4)),mat,parent,name);m.position.set(x,y,z);return m;
}
function roundedRect(path,left,bottom,right,top,r) {
  path.moveTo(left+r,bottom);path.lineTo(right-r,bottom);
  path.quadraticCurveTo(right,bottom,right,bottom+r);path.lineTo(right,top-r);
  path.quadraticCurveTo(right,top,right-r,top);path.lineTo(left+r,top);
  path.quadraticCurveTo(left,top,left,top-r);path.lineTo(left,bottom+r);
  path.quadraticCurveTo(left,bottom,left+r,bottom);path.closePath();return path;
}
function upholsteredRing(parent,material,profile) {
  // The bed surround terminates in front of the independently supported headboard.
  const half=profile.outerWidth/2-.018;
  const shape=roundedRect(new THREE.Shape(),-half,-profile.foot+.018,half,-HEADBOARD_LAYOUT.bedRear-.018,.09);
  shape.holes.push(roundedRect(new THREE.Path(),-profile.innerWidth/2,-profile.innerFoot,profile.innerWidth/2,-HEADBOARD_LAYOUT.bedOpening,.018));
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:SURROUND_HEIGHT.top-SURROUND_HEIGHT.bottom-.036,bevelEnabled:true,bevelThickness:.018,bevelSize:.018,bevelSegments:4,steps:1,curveSegments:18});
  geometry.rotateX(-Math.PI/2);geometry.translate(0,SURROUND_HEIGHT.bottom+.018,0);
  return mesh(geometry,material,parent,'Continuous_Upholstered_Surround');
}
function perimeterTube(parent,name,width,length,centerZ,y,radius,tubeRadius,material) {
  const path=roundedRect(new THREE.Shape(),-width/2,centerZ-length/2,width/2,centerZ+length/2,radius);
  const points=path.getSpacedPoints(96).slice(0,-1).map(p=>V(p.x,y,p.y));
  return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points,true,'centripetal'),96,tubeRadius,4,true),material,parent,name);
}

function softBox(w,h,d,yCenter,mat,parent,name) {
  const g=new THREE.BoxGeometry(w,h,d,12,3,96);const p=g.attributes.position;
  const surfaceHeight=Float32Array.from({length:p.count},(_,i)=>p.getY(i)+yCenter);
  const radius=Math.min(.045,h*.38),inner=V(w/2-radius,h/2-radius,d/2-radius);
  for(let i=0;i<p.count;i++){
    const a=V(p.getX(i),p.getY(i),p.getZ(i)),clamped=a.clone().clamp(inner.clone().negate(),inner);
    a.sub(clamped).normalize().multiplyScalar(radius).add(clamped);
    p.setXYZ(i,a.x,a.y+yCenter,a.z);
  }
  const m=mesh(g,mat,parent,name);m.userData.rest=Array.from(p.array);m.surfaceHeight=surfaceHeight;return m;
}

export class SmartBed {
  constructor(library) {
    this.root=new THREE.Group();this.root.name='NOCTIS_SmartBed';this.lib=library;this.soft=[];this.decks=[];this.airbags=[];this.motors=[];this.deformationCaches=new WeakMap();
    const frame=library.get('frame'),leather=library.get('leather'),surroundMaterial=library.get('surround');
    this.piping=library.get('piping');
    this.cadFrame=createCadFrame(this.root,frame,library);
    Object.assign(this,{base:this.cadFrame.base,mechanismGroup:this.cadFrame.mechanismGroup,decks:this.cadFrame.decks,motors:this.cadFrame.motors,footLinks:this.cadFrame.footLinks});
    this.surround=new THREE.Group();this.surround.name='Upholstered_Bed_Surround';this.root.add(this.surround);
    this.surroundProfiles={};this.surroundAccentsEnabled=true;
    for(const [id,profile] of Object.entries(SURROUND_STYLES)){
      const group=new THREE.Group();group.name=`Surround_${id}`;this.surround.add(group);
      const shell=upholsteredRing(group,surroundMaterial,profile);
      const length=profile.foot-HEADBOARD_LAYOUT.bedRear,centerZ=(profile.foot+HEADBOARD_LAYOUT.bedRear)/2;
      perimeterTube(group,'Surround_Stitched_Edge',profile.outerWidth+.003,length+.003,centerZ,SURROUND_HEIGHT.top-.055,.11,.0012,this.piping);
      perimeterTube(group,'Continuous_Ambient_Reveal',profile.outerWidth+.002,length+.002,centerZ,SURROUND_HEIGHT.bottom+.04,.11,.003,cyan);
      for(const x of [-1,1])box(group,'Recessed_Lower_Trim',.08,.045,length-.17,x*(profile.outerWidth/2-.07),SURROUND_HEIGHT.bottom-.013,centerZ,dark,.015);
      box(group,'Footboard_Lower_Trim',profile.outerWidth-.12,.045,.08,0,SURROUND_HEIGHT.bottom-.013,profile.foot-.07,dark,.015);
      this.surroundProfiles[id]={group,shell};
    }
    this.headboards=Object.fromEntries(Object.entries(SURROUND_STYLES).map(([id,p])=>[id,createHeadboard(this.root,leather,this.piping,p.headboardWidth)]));
    this.headboardStyle='cushion';this.headboardVariants={cushion:this.headboards};
    this.mattress=new THREE.Group();this.mattress.name='Flexible_Mattress';this.root.add(this.mattress);
    const top=library.get('fabric'),side=library.get('side');
    this.cover=softBox(DIMENSIONS.width,DIMENSIONS.mattressHeight,DIMENSIONS.length,0.123,[side,side,top,side,side,side],this.mattress,'Continuous_Cover');this.soft.push(this.cover);
    this.coverDetails=[createBoundWelt(this.cover,this.piping,true),createBoundWelt(this.cover,this.piping,false)];
    this.mattress.add(...this.coverDetails);
    this.branding=createMattressBranding(this.cover,library);this.mattress.add(...this.branding);
    this.waistband=createBoundWelt(this.cover,library.get('waistband'),true,{waistband:true});this.mattress.add(this.waistband);this.waistbandEnabled=false;
    this.innerFoam=softBox(DIMENSIONS.width-.05,.035,DIMENSIONS.length-.05,.045,library.get('foam'),this.mattress,'Foundation_Foam');this.soft.push(this.innerFoam);
    this.airGroup=new THREE.Group();this.airGroup.name='Eight_Air_Zones';this.root.add(this.airGroup);
    for(let sideIndex=0;sideIndex<2;sideIndex++) for(let zone=0;zone<4;zone++) {
      const group=new THREE.Group();group.name=`Airbag_${sideIndex===0?'L':'R'}_${ZONES[zone].id}`;this.airGroup.add(group);
      const mat=new THREE.MeshStandardMaterial({color:sideIndex===0?0x40ae9a:0x4d91b8,roughness:0.58,metalness:0.04,emissive:sideIndex===0?0x08392e:0x092536,emissiveIntensity:0.25});
      const depth=ZONES[zone].spread*1.80;
      const cell=mesh(new RoundedBoxGeometry(AIR_LAYOUT.pouchWidth,.12,depth,2,.047),mat,group,'Rounded_Rectangular_Air_Pouch');
      cell.userData.rest=Array.from(cell.geometry.attributes.position.array);
      const sealMaterial=new THREE.MeshStandardMaterial({color:sideIndex===0?0x277f70:0x316480,roughness:.73,metalness:.05});
      const seal=perimeterTube(group,'Heat_Sealed_Rectangular_Edge',AIR_LAYOUT.pouchWidth+.008,depth+.008,0,0,.052,.0025,sealMaterial);
      seal.userData.rest=Array.from(seal.geometry.attributes.position.array);
      const valve=box(group,'Valve',0.037,0.028,0.05,0,0,0,metal,0.008);
      this.airbags.push({group,cells:[cell],seal,valve,side:sideIndex,zone,mat,halfHeight:.057});
    }
    this.tubes=[];
    for(const x of [-0.10,0.10]) {
      const g=new THREE.TubeGeometry(new THREE.LineCurve3(V(x,.07,-.75),V(x,.07,.76)),48,.0035,4,false);
      const tube=mesh(g,new THREE.MeshStandardMaterial({color:0x6dcbc0,roughness:.63}),this.airGroup,'Pneumatic_Manifold');
      tube.userData.rest=Array.from(g.attributes.position.array);this.tubes.push(tube);
    }
    this.anatomy=createAnatomy({root:this.root,library,softBox,box,mesh,soft:this.soft,airGroup:this.airGroup,innerFoam:this.innerFoam});
    this.selectedLayer=null;this.currentExplode=0;
    this.setSurroundStyle('wide');
    this.root.userData={units:'meters',nominalMattress:[DIMENSIONS.width,DIMENSIONS.length,DIMENSIONS.mattressHeight],description:'Visual demonstrator. Procedural deformation is driven by src/kinematics.js.'};
  }
  setSurroundStyle(id){
    const profile=SURROUND_STYLES[id];if(!profile)throw new Error('Unknown surround style');
    this.surroundStyle=id;this.layout=profile;
    Object.entries(this.surroundProfiles).forEach(([key,value])=>{value.group.visible=key===id;});
    this.surroundShell=this.surroundProfiles[id].shell;
    this.headboard=this.headboards[id];
    Object.entries(this.headboards).forEach(([key,head])=>{head.visible=key===id;});
    this.cadFrame.setWidth(profile.deckWidth);
  }
  setHeadboardStyle(id){
    if(!HEADBOARD_STYLES[id])throw new Error('Unknown headboard style');
    Object.values(this.headboards).forEach(head=>{head.visible=false;});
    if(!this.headboardVariants[id])this.headboardVariants[id]=Object.fromEntries(Object.entries(SURROUND_STYLES).map(([key,p])=>[key,createHeadboard(this.root,this.lib.get('leather'),this.piping,p.headboardWidth,id)]));
    this.headboardStyle=id;this.headboards=this.headboardVariants[id];this.setSurroundStyle(this.surroundStyle);
  }
  setWaistband(enabled){this.waistbandEnabled=!!enabled;}
  setSurroundAccents(enabled){
    this.surroundAccentsEnabled=!!enabled;
    for(const {group} of Object.values(this.surroundProfiles))for(const name of ['Continuous_Ambient_Reveal','Surround_Stitched_Edge'])group.getObjectByName(name).visible=this.surroundAccentsEnabled;
  }
  deform(obj, spine, pressures, explode=0, inflate=true) {
    const a=obj.geometry.attributes.position,rest=obj.userData.rest;
    let cache=this.deformationCaches.get(obj);
    if(!cache){
      const weights=new Float32Array(a.count*8);
      for(let i=0;i<a.count;i++){
        const x=rest[i*3],y=rest[i*3+1],z=rest[i*3+2],t=THREE.MathUtils.clamp((y-.025)/.175,0,1),fade=t*t*(3-2*t);
        for(let side=0;side<2;side++)for(let zone=0;zone<4;zone++)weights[i*8+side*4+zone]=.00055*fade*Math.exp(-Math.pow((x-(side?1:-1)*AIR_LAYOUT.centerX)/AIR_LAYOUT.spreadX,4)-Math.pow((z-ZONES[zone].z)/ZONES[zone].spread,4));
      }
      cache={weights};this.deformationCaches.set(obj,cache);
    }
    for(let i=0;i<a.count;i++){
      const f=THREE.MathUtils.clamp((rest[i*3+2]-spine.min)/spine.step,0,spine.count),j=Math.min(Math.floor(f),spine.count-1),t=f-j,p=spine.samples[j],q=spine.samples[j+1];
      const angle=p.angle+(q.angle-p.angle)*t;let height=rest[i*3+1];
      if(inflate)for(let k=0;k<8;k++)height+=cache.weights[i*8+k]*pressures[k>>2][k%4];
      a.setXYZ(i,rest[i*3],p.y+(q.y-p.y)*t+height*Math.cos(angle)+explode,p.z+(q.z-p.z)*t+height*Math.sin(angle));
    }
    a.needsUpdate=true;obj.geometry.computeVertexNormals();obj.geometry.computeBoundingBox();obj.geometry.computeBoundingSphere();
  }

  deformAirPouch(obj,bag,spine,halfHeight,seal=false) {
    const a=obj.geometry.attributes.position,rest=obj.userData.rest,centerX=(bag.side===0?-1:1)*AIR_LAYOUT.centerX;
    for(let i=0;i<a.count;i++) {
      const y=.066+halfHeight+rest[i*3+1]*(seal?1:halfHeight/.06);
      const p=mapPoint(spine,centerX+rest[i*3],y,ZONES[bag.zone].z+rest[i*3+2],null,false);
      a.setXYZ(i,p.x,p.y,p.z);
    }
    a.needsUpdate=true;obj.geometry.computeVertexNormals();obj.geometry.computeBoundingBox();obj.geometry.computeBoundingSphere();
  }
  update(state) {
    // Unfold only the display geometry in the exploded view; the user's pose values are preserved.
    const spine=buildSpine(state.back*(1-state.explode),state.leg*(1-state.explode));this.spine=spine;this.currentExplode=state.explode;
    const exploded=state.explode>.01,headOnly=!!state.headboardOnly;
    this.base.visible=this.mechanismGroup.visible=this.mattress.visible=!headOnly;
    this.decks.forEach(d=>{d.group.visible=!headOnly;});
    this.cover.visible=!exploded&&!state.mechanism;this.coverDetails.forEach(m=>m.visible=!exploded&&!state.mechanism);
    this.waistband.visible=this.waistbandEnabled&&this.cover.visible;
    this.branding.forEach(m=>{m.visible=this.cover.visible&&state.xray<.1;});
    Object.entries(this.headboards).forEach(([id,head])=>{head.visible=id===this.surroundStyle&&!exploded&&!state.mechanism;});this.surround.visible=!state.mechanism&&!headOnly;
    for(const layer of Object.values(this.anatomy.entries)){
      const inXray=['airbag','foundation'].includes(layer.id);
      layer.group.visible=!headOnly&&!state.mechanism&&(exploded||state.xray>.01&&inXray)&&(!exploded||!this.selectedLayer||this.selectedLayer===layer.id);
    }
    this.linkage=solveMechanism(state.back*(1-state.explode),state.leg*(1-state.explode));
    this.cadFrame.update(this.linkage,state);
    // Hidden anatomy is deformed when it becomes visible, keeping normal pose changes light.
    this.soft.forEach(m=>{const id=m.userData.anatomyLayer;if(id?this.anatomy.entries[id].group.visible:m.visible)this.deform(m,spine,state.pressures,state.explode*(m.userData.explodeOffset||0),m.userData.inflate!==false);});
    if(this.cover.visible)this.coverDetails.forEach(updateBoundWelt);
    if(this.waistband.visible)updateBoundWelt(this.waistband);
    this.branding.filter(m=>m.visible).forEach(updateBoundWelt);
    const airOffset=this.anatomy.entries.airbag.offset;
    if(this.airGroup.visible)this.tubes.forEach(t=>this.deform(t,spine,state.pressures,state.explode*airOffset,false));
    if(this.airGroup.visible)for(const bag of this.airbags){
      const pressure=THREE.MathUtils.clamp(state.pressures[bag.side][bag.zone]/100,0,1);
      const p=sampleSpine(spine,ZONES[bag.zone].z),h=.025+pressure*.057;bag.halfHeight=h;
      bag.group.position.set(0,state.explode*airOffset,0);
      bag.cells.forEach(cell=>this.deformAirPouch(cell,bag,spine,h));
      this.deformAirPouch(bag.seal,bag,spine,h,true);
      const valve=mapPoint(spine,(bag.side===0?-1:1)*(AIR_LAYOUT.centerX-AIR_LAYOUT.valveOffset),.066+h,ZONES[bag.zone].z,null,false);
      bag.valve.position.set(valve.x,valve.y,valve.z);bag.valve.rotation.x=p.angle;
      bag.mat.emissiveIntensity=.12+pressure*.3;
    }
    const opacity=1-state.xray*0.90;
    for(const id of ['fabric','side','waistband']){const m=this.lib.get(id),transparent=state.xray>0.005;if(m.transparent!==transparent){m.transparent=transparent;m.needsUpdate=true;}m.opacity=opacity;m.depthWrite=!transparent;}
    this.cover.castShadow=state.xray<0.1;
    this.root.updateMatrixWorld(true);
  }
  getLayerAnchor(id){
    const entry=this.anatomy.entries[id],a=entry.anchor,p=mapPoint(this.spine,...a,null,false);
    return new THREE.Vector3(p.x,p.y+this.currentExplode*entry.offset,p.z);
  }
}

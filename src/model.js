import { roundAirRow, roundAirMaterial } from './air-shape.js';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildSpine, sampleSpine, mapPoint, ZONES } from './kinematics.js';
import { createAnatomy } from './anatomy.js';
import { createHeadboard, HEADBOARD_LAYOUT } from './headboard.js';
import { createBoundWelt, updateBoundWelt, perimeterDistance } from './upholstery.js';
import { solveMechanism } from './mechanism.js';
import { createCadFrame } from './cad-frame.js';
import { DIMENSIONS, AIR_LAYOUT, SURROUND_STYLES, SURROUND_HEIGHT, TAILORED_COVER, T12_FRONT_MARKS } from './dimensions.js';
import { DEFAULT_AIR_BAGS } from './air-layout.js';
import { CoverReveal } from './cover-reveal.js';
import { massagePadWeight, massagePulse } from './massage.js';
import { T12_MASSAGE_LAYOUT, T12_SUPPORT_LAYOUT } from './dimensions.js';
import { quiltValley } from './tailored-textile.js';
import { createTailoredAttachments } from './tailored-attachments.js';
import { createMattressBranding } from './branding.js';
import { HEADBOARD_STYLES } from './cmf.js';
export { SURROUND_STYLES } from './dimensions.js';

const V = (x,y,z) => new THREE.Vector3(x,y,z);
const sameValues=(a,b)=>a?.length===b.length&&b.every((value,i)=>value===a[i]);
const metal = new THREE.MeshStandardMaterial({color:0xa3b0b1,metalness:0.9,roughness:0.25});
const dark = new THREE.MeshStandardMaterial({color:0x141e20,metalness:0.5,roughness:0.45});
const cyan = new THREE.MeshStandardMaterial({color:0x74e9d1,emissive:0x26bfa7,emissiveIntensity:1.8,roughness:0.35});
for(const material of [metal,dark,cyan])material.userData.shared=true;

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

function softBox(w,h,d,yCenter,mat,parent,name,longSegments=96,widthSegments=12) {
  const g=new THREE.BoxGeometry(w,h,d,widthSegments,3,longSegments);const p=g.attributes.position;
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
  constructor(library, {airbags=DEFAULT_AIR_BAGS,coverStyle='standard',massage=[]}={}) {
    this.airLayout=airbags;
    this.massageChannels=massage;this.massageWeights=new WeakMap();
    this.massagePads=massage.flatMap(channel=>channel.pads.map((pad,row)=>({pad,channel,row})));
    this.boundSurfaceVersions=new WeakMap();this.pouchDeformationCaches=new WeakMap();
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
    const tailored=coverStyle==='tailored';this.coverStyle=coverStyle;
    this.mattressHeight=tailored?TAILORED_COVER.height:DIMENSIONS.mattressHeight;
    this.surfaceTop=TAILORED_COVER.bottom+this.mattressHeight;
    this.cover=softBox(DIMENSIONS.width,this.mattressHeight,DIMENSIONS.length,TAILORED_COVER.bottom+this.mattressHeight/2,[side,side,top,side,side,side],this.mattress,'Continuous_Cover',tailored?TAILORED_COVER.quiltRows*4:96,tailored?48:12);this.soft.push(this.cover);
    if(tailored){
      const g=this.cover.geometry,p=g.attributes.position,uv=g.attributes.uv;
      for(let i=0;i<p.count;i++){
        const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
        const fade=Math.min(1,Math.max(0,(DIMENSIONS.width/2-Math.abs(x))/.10))*Math.min(1,Math.max(0,(DIMENSIONS.length/2-Math.abs(z))/.07))*Math.min(1,Math.max(0,(y-(this.surfaceTop-.038))/.038));
        const valley=quiltValley(x/DIMENSIONS.width+.5,z/DIMENSIONS.length+.5);
        p.setY(i,y-TAILORED_COVER.quiltDepth*valley*fade);
      }
      // Continuous physical cloth coordinates across side faces and all four corners.
      const radius=.045,perimeter=2*(DIMENSIONS.width+DIMENSIONS.length-4*radius)+2*Math.PI*radius;
      const repeats=Math.round(perimeter/DIMENSIONS.length);
      for(const group of g.groups)if([0,1,4,5].includes(group.materialIndex)){
        const ids=new Set(Array.from({length:group.count},(_,i)=>g.index.getX(group.start+i)));
        for(const id of ids){
          let u=perimeterDistance(p.getX(id),p.getZ(id),DIMENSIONS.width,DIMENSIONS.length,radius)/perimeter*repeats;
          // The rear face crosses the wrap; unwrap it locally instead of stretching one triangle.
          if(group.materialIndex===5&&u<repeats/2)u+=repeats;
          uv.setX(id,u);
        }
      }
      this.cover.userData.rest=Array.from(p.array);g.computeVertexNormals();
    }
    this.coverMaterials=this.cover.material;
    this.coverReveal=new CoverReveal(this.cover);
    this.coverDetails=[createBoundWelt(this.cover,this.piping,true,tailored?{halfWidth:TAILORED_COVER.weltHalfWidth,rounded:true,physicalUV:true}:{}),createBoundWelt(this.cover,this.piping,false)];
    this.mattress.add(...this.coverDetails);
    this.tailoredDetails=[];
    if(tailored){
      this.tailoredDetails=[
        createBoundWelt(this.cover,library.get('waistband'),true,{offsetFromTop:TAILORED_COVER.bandOffset,halfWidth:TAILORED_COVER.bandHalfWidth,rounded:true,waistband:true,physicalUV:true,name:'Tailored_Upper_Border_Tape'}),
        createBoundWelt(this.cover,this.piping,true,{offsetFromTop:TAILORED_COVER.lowerWeltOffset,halfWidth:TAILORED_COVER.weltHalfWidth,rounded:true,physicalUV:true,name:'Tailored_Second_Black_Welt'}),
        ...createTailoredAttachments(this.cover,library),
      ];
      for(const detail of this.tailoredDetails){detail.sourceMaterial=detail.material;detail.geometry.setAttribute('showroomPosition',detail.geometry.attributes.position.clone());}
      this.mattress.add(...this.tailoredDetails);
    }
    this.branding=createMattressBranding(this.cover,library,tailored?T12_FRONT_MARKS:undefined);this.mattress.add(...this.branding);
    this.waistband=createBoundWelt(this.cover,library.get('waistband'),true,{waistband:true});this.mattress.add(this.waistband);this.waistbandEnabled=false;
    this.innerFoam=softBox(DIMENSIONS.width-.05,.035,DIMENSIONS.length-.05,.045,library.get('foam'),this.mattress,'Foundation_Foam');this.soft.push(this.innerFoam);
    this.airGroup=new THREE.Group();this.airGroup.name='Eight_Air_Zones';this.root.add(this.airGroup);
    for(const definition of this.airLayout) {
      const {side:sideIndex,zone,width,depth}=definition;
      const group=new THREE.Group();group.name=`Airbag_${sideIndex===0?'L':'R'}_${definition.id}`;this.airGroup.add(group);
      const mat=definition.shape==='round-array'?roundAirMaterial():new THREE.MeshStandardMaterial({color:sideIndex===0?0x40ae9a:0x4d91b8,roughness:0.58,metalness:0.04,emissive:sideIndex===0?0x08392e:0x092536,emissiveIntensity:0.25});
      const cell=mesh(definition.shape==='round-array'?roundAirRow(width,depth):new RoundedBoxGeometry(width,.12,depth,2,Math.min(.047,width*.2,depth*.2)),mat,group,definition.shape==='round-array'?'Circular_Air_Array':'Rounded_Rectangular_Air_Pouch');
      cell.userData.rest=Array.from(cell.geometry.attributes.position.array);
      const sealMaterial=definition.shape==='round-array'?roundAirMaterial({seal:true}):new THREE.MeshStandardMaterial({color:sideIndex===0?0x277f70:0x316480,roughness:.73,metalness:.05});
      const seal=definition.shape==='round-array'?mesh(roundAirRow(width,depth,7,true),sealMaterial,group,'Circular_Sealed_Edges'):perimeterTube(group,'Heat_Sealed_Rectangular_Edge',width+.008,depth+.008,0,0,.052,.0025,sealMaterial);
      seal.userData.rest=Array.from(seal.geometry.attributes.position.array);
      const valve=box(group,'Valve',0.037,0.028,0.05,0,0,0,metal,0.008);
      const showroomMat=definition.shape==='round-array'?roundAirMaterial({showroom:true}):new THREE.MeshStandardMaterial({color:sideIndex===0?0x165758:0x164355,emissive:sideIndex===0?0x0b5046:0x0b324e,emissiveIntensity:.3,roughness:.45,metalness:.18});
      this.airbags.push({...definition,group,cells:[cell],seal,valve,side:sideIndex,zone,mat,showroomMat,halfHeight:.057});
    }
    this.tubes=[];
    for(const x of (this.airLayout.some(b=>b.shape==='round-array')?[]:[-0.10,0.10])) {
      const g=new THREE.TubeGeometry(new THREE.LineCurve3(V(x,.07,-.75),V(x,.07,.76)),48,.0035,4,false);
      const tube=mesh(g,new THREE.MeshStandardMaterial({color:0x6dcbc0,roughness:.63}),this.airGroup,'Pneumatic_Manifold');
      tube.userData.rest=Array.from(g.attributes.position.array);this.tubes.push(tube);
    }
    if(this.airLayout.some(b=>b.shape==='round-array')){
      const colors=[0xff825f,0xeac94f,0x6ae8df,0x86d781,0xb492ec,0x69bde5,0xdd89d3];
      for(const side of [0,1]){
        const ids=[...new Set(this.airLayout.filter(b=>b.side===side).map(b=>b.regionId))];
        ids.forEach((id,c)=>{
          const rows=this.airLayout.filter(b=>b.regionId===id),sign=side?1:-1,lane=sign*(.018+c*.0065),inner=sign*.075;
          const add=points=>{const g=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),32,.002,4,false),tube=mesh(g,new THREE.MeshStandardMaterial({color:colors[c],emissive:colors[c],emissiveIntensity:.25}),this.airGroup,`Circuit_${id}`);tube.userData.rest=Array.from(g.attributes.position.array);tube.userData.circuitSide=side;this.tubes.push(tube);};
          add([V(lane,.085,T12_SUPPORT_LAYOUT.manifoldEndZ),V(lane,.085,T12_SUPPORT_LAYOUT.controlBayStartZ),V(lane,.085,rows[0].z+.035),V(inner,.085,rows[0].z)]);
          for(const row of rows)add([V(inner,.085,rows[0].z),V(inner,.085,row.z+.008),V(sign*(Math.abs(row.x)-row.width/2),.085,row.z),V(sign*(Math.abs(row.x)+row.width/2-.025),.085,row.z)]);
        });
      }
    }
    this.anatomy=createAnatomy({root:this.root,library,softBox,box,mesh,soft:this.soft,airGroup:this.airGroup,innerFoam:this.innerFoam});
    this.comfort=this.anatomy.entries.comfort.group.children[0];this.comfortMaterials=this.comfort.material;
    this.selectedLayer=null;this.currentExplode=0;
    this.setSurroundStyle('wide');
    this.root.userData={units:'meters',nominalMattress:[DIMENSIONS.width,DIMENSIONS.length,this.mattressHeight],description:'Visual demonstrator. Procedural deformation is driven by src/kinematics.js.'};
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
  deform(obj, spine, pressures, explode=0, inflate=true, massage=null) {
    const a=obj.geometry.attributes.position,rest=obj.userData.rest;
    const pads=obj===this.cover?this.massagePads:[];
    const lifts=pads.map(({channel,row})=>{const lane=massage?.[channel.id];return lane?T12_MASSAGE_LAYOUT.lift*lane.amount*lane.intensity*massagePulse(lane.phase,row,channel.pads.length):0;});
    const values=obj===this.cover?lifts:inflate?this.airLayout.map(bag=>pressures[bag.side][bag.zone]):[];
    let cache=this.deformationCaches.get(obj);
    if(cache?.spine===spine&&cache.position===a&&cache.rest===rest&&cache.explode===explode&&cache.inflate===inflate&&sameValues(cache.values,values))return;
    if(!cache||cache.position!==a||cache.rest!==rest)cache={};
    // Support pressure never deforms the cover, and rigid tubes need no air weights.
    if(inflate&&obj!==this.cover&&!cache.weights){
      const weights=new Float32Array(a.count*this.airLayout.length);
      for(let i=0;i<a.count;i++){
        const x=rest[i*3],y=rest[i*3+1],z=rest[i*3+2],t=THREE.MathUtils.clamp((y-.025)/.175,0,1),fade=t*t*(3-2*t);
        this.airLayout.forEach((bag,k)=>{weights[i*this.airLayout.length+k]=bag.maxLift/100*fade*Math.exp(-Math.pow((x-bag.x)/bag.spreadX,4)-Math.pow((z-bag.z)/bag.spread,4));});
      }
      cache.weights=weights;
    }
    let massageWeights=this.massageWeights.get(obj);
    if(obj===this.cover&&!massageWeights){
      massageWeights=Float32Array.from({length:a.count*pads.length},(_,k)=>{
        const i=Math.floor(k/pads.length),pad=pads[k%pads.length].pad;
        const fade=THREE.MathUtils.smoothstep(rest[i*3+1],this.surfaceTop-.07,this.surfaceTop-.008);
        return fade*massagePadWeight(pad,rest[i*3],rest[i*3+2]);
      });this.massageWeights.set(obj,massageWeights);
    }
    for(let i=0;i<a.count;i++){
      const f=THREE.MathUtils.clamp((rest[i*3+2]-spine.min)/spine.step,0,spine.count),j=Math.min(Math.floor(f),spine.count-1),t=f-j,p=spine.samples[j],q=spine.samples[j+1];
      const angle=p.angle+(q.angle-p.angle)*t;let height=rest[i*3+1];
      if(obj===this.cover){for(let k=0;k<lifts.length;k++)height+=massageWeights[i*pads.length+k]*lifts[k];}
      else if(inflate)this.airLayout.forEach((bag,k)=>{height+=cache.weights[i*this.airLayout.length+k]*pressures[bag.side][bag.zone];});
      a.setXYZ(i,rest[i*3],p.y+(q.y-p.y)*t+height*Math.cos(angle)+explode,p.z+(q.z-p.z)*t+height*Math.sin(angle));
    }
    a.needsUpdate=true;obj.geometry.computeVertexNormals();obj.geometry.computeBoundingBox();obj.geometry.computeBoundingSphere();
    Object.assign(cache,{spine,position:a,rest,explode,inflate,values});this.deformationCaches.set(obj,cache);
  }

  deformAirPouch(obj,bag,spine,halfHeight,seal=false) {
    const a=obj.geometry.attributes.position,rest=obj.userData.rest,centerX=bag.x;
    const cache=this.pouchDeformationCaches.get(obj);
    if(cache?.spine===spine&&cache.position===a&&cache.rest===rest&&cache.halfHeight===halfHeight&&cache.seal===seal)return;
    for(let i=0;i<a.count;i++) {
      const y=bag.bottom+halfHeight+rest[i*3+1]*(seal?1:halfHeight/.06);
      const p=mapPoint(spine,centerX+rest[i*3],y,bag.z+rest[i*3+2],null,false);
      a.setXYZ(i,p.x,p.y,p.z);
    }
    a.needsUpdate=true;obj.geometry.computeVertexNormals();obj.geometry.computeBoundingBox();obj.geometry.computeBoundingSphere();
    this.pouchDeformationCaches.set(obj,{spine,position:a,rest,halfHeight,seal});
  }
  updateSurfaceBinding(detail){
    const position=detail.surfaceBinding.cover.geometry.attributes.position,cache=this.boundSurfaceVersions.get(detail);
    if(cache?.position===position&&cache.version===position.version)return;
    updateBoundWelt(detail);this.boundSurfaceVersions.set(detail,{position,version:position.version});
  }
  update(state) {
    // Unfold only the display geometry in the exploded view; the user's pose values are preserved.
    const back=state.back*(1-state.explode),leg=state.leg*(1-state.explode);
    if(!this.spine||this.spineBack!==back||this.spineLeg!==leg){this.spine=buildSpine(back,leg);this.spineBack=back;this.spineLeg=leg;}
    const spine=this.spine;this.currentExplode=state.explode;
    const exploded=state.explode>.01,headOnly=!!state.headboardOnly;
    const reveal=state.showroom?state.airReveal:null;
    const visibleRevealSides=reveal?.sides?Object.entries(reveal.sides).filter(([,value])=>['scan','adjust','closing'].includes(value.phase)).map(([side])=>side):[];
    const showingAir=visibleRevealSides.length>0||!!reveal&&['scan','adjust','closing'].includes(reveal.phase);
    const showingCover=showingAir;
    this.coverReveal.update(reveal);
    this.cover.material=showingCover?this.coverMaterials.map(m=>this.coverReveal.material(m)):this.coverMaterials;
    this.cover.renderOrder=showingCover?4:0;
    this.base.visible=this.mechanismGroup.visible=this.mattress.visible=!headOnly;
    this.decks.forEach(d=>{d.group.visible=!headOnly;});
    this.cover.visible=!exploded&&!state.mechanism;this.coverDetails.forEach(m=>m.visible=this.cover.visible);
    this.waistband.visible=this.waistbandEnabled&&this.cover.visible;
    for(const detail of this.tailoredDetails){detail.visible=this.cover.visible;detail.material=showingAir?this.coverReveal.material(detail.sourceMaterial):detail.sourceMaterial;detail.renderOrder=showingAir?5:1;}
    this.branding.forEach(m=>{m.visible=this.cover.visible&&state.xray<.1;});
    Object.entries(this.headboards).forEach(([id,head])=>{head.visible=id===this.surroundStyle&&!exploded&&!state.mechanism;});this.surround.visible=!state.mechanism&&!headOnly;
    for(const layer of Object.values(this.anatomy.entries)){
      const inXray=['airbag','foundation'].includes(layer.id);
      layer.group.visible=!headOnly&&!state.mechanism&&(state.showroom?showingAir&&inXray:exploded||state.xray>.01&&inXray)&&(!exploded||!this.selectedLayer||this.selectedLayer===layer.id);
    }
    this.linkage=solveMechanism(state.back*(1-state.explode),state.leg*(1-state.explode));
    this.cadFrame.update(this.linkage,state);
    // Hidden anatomy is deformed when it becomes visible, keeping normal pose changes light.
    this.soft.forEach(m=>{
      const id=m.userData.anatomyLayer;
      const lift=state.explode*(m.userData.explodeOffset||0);
      if(id?this.anatomy.entries[id].group.visible:m.visible)this.deform(m,spine,state.pressures,lift,m.userData.inflate!==false,state.massage);
    });
    if(this.cover.visible)this.coverDetails.forEach(m=>this.updateSurfaceBinding(m));
    if(this.cover.visible)this.tailoredDetails.forEach(m=>this.updateSurfaceBinding(m));
    if(this.waistband.visible)this.updateSurfaceBinding(this.waistband);
    this.branding.filter(m=>m.visible).forEach(m=>this.updateSurfaceBinding(m));
    const airOffset=this.anatomy.entries.airbag.offset;
    this.tubes.forEach(t=>{t.visible=t.userData.circuitSide!==undefined?(!state.showroom||showingAir&&(visibleRevealSides.length?visibleRevealSides.includes(t.userData.circuitSide?'left':'right'):reveal?.side==='both'||reveal?.side===(t.userData.circuitSide?'left':'right'))):!state.showroom;if(this.airGroup.visible&&t.visible)this.deform(t,spine,state.pressures,state.explode*airOffset,false);});
    this.airbags.forEach(bag=>{const humanSide=bag.side===1?'left':'right',requested=visibleRevealSides.length?visibleRevealSides.includes(humanSide):reveal?.side==='both'||bag.side===(reveal?.side==='left'?1:0);bag.group.visible=!state.showroom||showingAir&&requested;});
    if(this.airGroup.visible)for(const bag of this.airbags){
      if(!bag.group.visible)continue;
      const pressure=THREE.MathUtils.clamp(state.pressures[bag.side][bag.zone]/100,0,1);
      const p=sampleSpine(spine,bag.z),h=bag.minHalfHeight+pressure*bag.halfHeightRange;bag.halfHeight=h;
      bag.group.position.set(0,state.explode*airOffset,0);
      bag.cells.forEach(cell=>{cell.material=state.showroom?bag.showroomMat:bag.mat;this.deformAirPouch(cell,bag,spine,h);});
      this.deformAirPouch(bag.seal,bag,spine,h,true);
      const valve=mapPoint(spine,bag.x+(bag.side===0?1:-1)*bag.width*.45,bag.bottom+h,bag.z,null,false);
      bag.valve.position.set(valve.x,valve.y,valve.z);bag.valve.rotation.x=p.angle;
      bag.mat.emissiveIntensity=.12+pressure*.3;
    }
    const xray=state.showroom?0:state.xray,opacity=1-xray*0.90;
    for(const id of ['fabric','side','waistband']){const m=this.lib.get(id),transparent=xray>0.005;if(m.transparent!==transparent){m.transparent=transparent;m.needsUpdate=true;}m.opacity=opacity;m.depthWrite=!transparent;}
    this.cover.castShadow=xray<0.1;
    this.root.updateMatrixWorld(true);
  }
  getLayerAnchor(id){
    const entry=this.anatomy.entries[id],a=entry.anchor,p=mapPoint(this.spine,...a,null,false);
    return new THREE.Vector3(p.x,p.y+this.currentExplode*entry.offset,p.z);
  }
}

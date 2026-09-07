import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DIMENSIONS, HEADBOARD_LAYOUT } from './dimensions.js';
export { HEADBOARD_LAYOUT } from './dimensions.js';

const smooth=(a,b,v)=>{const t=THREE.MathUtils.clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
const cushionFront=(u,t)=>{
  const fullness=.038*(1-(Math.abs(u)*2)**4)*smooth(.12,.40,t)*(1-smooth(.63,1,t));
  const seam=.13+.018*Math.sin(t*Math.PI);
  return -1.087+.027*Math.sin(Math.PI*t)**.8+fullness-.083*smooth(.60,1,t)-.009*Math.exp(-Math.pow((u-seam)/.035,2))*Math.sin(Math.PI*t);
};

function addMesh(group,name,geometry,material){
  const m=new THREE.Mesh(geometry,material);m.name=name;m.castShadow=m.receiveShadow=true;group.add(m);return m;
}
function paddedPanel(group,name,{width,height,bottom,centerX=0,rear,front,radius=.09,nx=28,ny=30},material){
  const geometry=new THREE.BoxGeometry(width,height,1,nx,ny,4),p=geometry.attributes.position,normals=geometry.attributes.normal.array.slice(),uv=geometry.attributes.uv;
  for(let i=0;i<p.count;i++){
    let x=p.getX(i),y=p.getY(i);const depth=THREE.MathUtils.clamp(p.getZ(i)+.5,0,1);
    const cx=THREE.MathUtils.clamp(x,-width/2+radius,width/2-radius),cy=THREE.MathUtils.clamp(y,-height/2+radius,height/2-radius),dx=x-cx,dy=y-cy,d=Math.hypot(dx,dy);
    if(d>radius){x=cx+dx/d*radius;y=cy+dy/d*radius;}
    const t=THREE.MathUtils.clamp((y+height/2)/height,0,1),u=x/width;
    const roll=Math.min(.014,width*.12)*(1-Math.sqrt(Math.max(0,1-(2*depth-1)**2)));
    x*=1-roll/(width/2);y=bottom+t*height+roll*(1-2*t);
    const z=THREE.MathUtils.lerp(typeof rear==='function'?rear(t):rear,front(u,t),depth);x+=centerX;
    p.setXYZ(i,x,y,z);
    // All upholstery pieces share a physical grain scale, including the separate cushions.
    if(Math.abs(normals[i*3+2])>.5)uv.setXY(i,(x+1.13)/2.1,y/1.05);
    else if(Math.abs(normals[i*3])>.5)uv.setXY(i,(z+1.4)/2.1,y/1.05);
    else uv.setXY(i,(x+1.13)/2.1,(z+1.4)/1.05);
  }
  geometry.computeVertexNormals();const n=geometry.attributes.normal;
  for(let i=0;i<n.count;i++)if(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))<.1)n.setXYZ(i,normals[i*3],normals[i*3+1],normals[i*3+2]);
  return addMesh(group,name,geometry,material);
}
export function createHeadboard(root,leather,piping,width,style='cushion'){
  if(style==='channel')return createChannelHeadboard(root,leather,width);
  const group=new THREE.Group();group.name='Leather_Headboard';group.userData.structure='floor-standing wing frame with two upholstered cushions';root.add(group);
  const sy=(HEADBOARD_LAYOUT.height-.055)/1.415,y=v=>.055+(v-.055)*sy;
  const dz=1.05-DIMENSIONS.length/2,z=v=>v+dz;
  const cushionWidth=(width-.26)/2,cushionX=(cushionWidth+.012)/2;
  group.userData.dimensions={width,height:HEADBOARD_LAYOUT.height};
  paddedPanel(group,'Headboard_Standing_Back_Frame',{width:width-.12,height:1.405*sy,bottom:y(.065),rear:z(-1.29),front:()=>z(-1.215),radius:.05,nx:20,ny:20},leather);
  paddedPanel(group,'Floor_Upholstered_Apron',{width:width-.13,height:.585*sy,bottom:y(.065),rear:z(-1.245),front:(u,t)=>z(-1.087+.003*Math.sin(Math.PI*t)-.004*(Math.abs(u)*2)**4),radius:.025,nx:24,ny:12},leather);
  for(const side of [-1,1]){
    paddedPanel(group,side<0?'Curved_Wing_Left':'Curved_Wing_Right',{
      width:.11,height:1.415*sy,bottom:.055,centerX:side*(width-.11)/2,rear:t=>z(-1.30+.018*Math.sin(Math.PI*t)),
      front:(u,t)=>z(-1.112+.035*Math.exp(-Math.pow((t-.48)/.25,2))-.065*smooth(.65,1,t)+.014*(1-smooth(0,.18,t))),radius:.045,nx:6,ny:36,
    },leather);
    const cushion=paddedPanel(group,side<0?'Back_Cushion_Left':'Back_Cushion_Right',{
      width:cushionWidth,height:.82*sy,bottom:y(.595),centerX:side*cushionX,rear:z(-1.237),front:(u,t)=>z(cushionFront(u,t)),radius:.085,nx:32,ny:32,
    },leather);
    cushion.updateMatrixWorld(true);
    const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,0,-1)),points=[];
    for(let i=0;i<=40;i++){
      const t=.09+i/40*.83,x=side*cushionX+cushionWidth*(.13+.018*Math.sin(t*Math.PI));
      ray.ray.origin.set(x,y(.595+t*.82),0);const hit=ray.intersectObject(cushion,false)[0];if(hit)points.push(hit.point.add(new THREE.Vector3(0,0,.0004)));
    }
    addMesh(group,'Cushion_Tailored_Seam',new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),48,.0006,4,false),piping);
  }
  const feetMaterial=new THREE.MeshStandardMaterial({color:0x202628,roughness:.38,metalness:.6});
  for(const side of [-1,1]){
    const x=side*(width/2-.15);
    const leg=addMesh(group,'Headboard_Independent_Foot',new RoundedBoxGeometry(.065,.076,.10,1,.006),feetMaterial);leg.position.set(x,.047,z(-1.218));
    const pad=addMesh(group,'Headboard_Floor_Pad',new RoundedBoxGeometry(.085,.014,.12,1,.004),feetMaterial);pad.position.set(x,.007,z(-1.218));
  }
  return group;
}

function createChannelHeadboard(root,leather,width){
  const group=new THREE.Group();group.name='Channel_Leather_Headboard';root.add(group);
  group.userData={structure:'floor-standing continuous eight-channel upholstery',style:'channel',channels:8,dimensions:{width,height:HEADBOARD_LAYOUT.height}};
  const zOffset=1.90/2-DIMENSIONS.length/2,z=v=>v+zOffset;
  paddedPanel(group,'Headboard_Standing_Back_Frame',{width:width-.05,height:1.195,bottom:.055,rear:z(-1.195),front:()=>z(-1.115),radius:.085,nx:24,ny:24},leather);
  paddedPanel(group,'Floor_Upholstered_Apron',{width:width-.12,height:.54,bottom:.065,rear:z(-1.15),front:u=>z(-.987-.004*(Math.abs(u)*2)**4),radius:.025,nx:24,ny:12},leather);
  for(const side of [-1,1])paddedPanel(group,side<0?'Curved_Wing_Left':'Curved_Wing_Right',{
    width:.07,height:1.195,bottom:.055,centerX:side*(width-.07)/2,rear:z(-1.20),
    front:(u,t)=>z(-.995+.010*Math.sin(Math.PI*t)-.045*smooth(.74,1,t)),radius:.028,nx:6,ny:32,
  },leather);
  const face=paddedPanel(group,'Continuous_Eight_Channel_Cushion',{
    width:width-.14,height:.67,bottom:.55,rear:z(-1.115),radius:.078,nx:160,ny:30,
    front:(u,t)=>{
      const phase=(u+.5)*8,groove=Math.exp(-Math.pow((phase-Math.round(phase))/.045,2));
      const crown=.010*Math.pow(Math.abs(Math.sin(Math.PI*phase)),.55);
      const seamFade=smooth(0,.04,t)*(1-smooth(.96,1,t));
      return z(-.988+.026*Math.sin(Math.PI*t)-.045*smooth(.62,1,t)+(crown-.007*groove)*seamFade);
    },
  },leather);
  face.userData.channels=8;
  const feetMaterial=new THREE.MeshStandardMaterial({color:0x202628,roughness:.38,metalness:.6});
  for(const side of [-1,1]){
    const x=side*(width/2-.15);
    const leg=addMesh(group,'Headboard_Independent_Foot',new RoundedBoxGeometry(.065,.076,.10,1,.006),feetMaterial);leg.position.set(x,.047,z(-1.118));
    const pad=addMesh(group,'Headboard_Floor_Pad',new RoundedBoxGeometry(.085,.014,.12,1,.004),feetMaterial);pad.position.set(x,.007,z(-1.118));
  }
  return group;
}

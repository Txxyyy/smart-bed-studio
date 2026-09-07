import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DIMENSIONS } from './dimensions.js';
import { LINKAGE } from './mechanism.js';
import { updateBoundWelt } from './upholstery.js';
import { WORDMARK_IMAGE } from './brand-artwork.js';

let wordmarkImage;
export async function prepareBrandArtwork(){
  if(wordmarkImage)return;
  const image=new Image();image.src=WORDMARK_IMAGE;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=Math.round(2048*image.height/image.width);
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);image.src='';wordmarkImage=canvas;
}

export const RETAINER_SIZE={width:.30,height:.096,depth:.020,bottom:.371,rear:DIMENSIONS.length/2+.004};
export const FRONT_MARKS=[
  {name:'Mattress_DeRUCCI_AI',material:'brand',text:'DeRUCCI AI',x:-.575,y:.173,width:.213,height:.032},
  {name:'Mattress_T11_Plus',material:'modelMark',text:'T11+',x:.64,y:.173,width:.105,height:.030},
];

// Separate alpha artwork preserves the fabric underneath and remains replaceable in exported GLBs.
export function brandingMap(pattern){
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=pattern==='derucciAI'?160:256;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';
  const word=(text,x,y,width,height,font)=>{
    ctx.font=font;const m=ctx.measureText(text),h=m.actualBoundingBoxAscent+m.actualBoundingBoxDescent;
    ctx.save();ctx.translate(x,y);ctx.scale(width/m.width,height/h);ctx.fillText(text,0,m.actualBoundingBoxAscent);ctx.restore();
  };
  if(pattern==='derucciAI'){
    ctx.drawImage(wordmarkImage,25,13,798,133.56);
    ctx.fillRect(876,26,110,110);ctx.globalCompositeOperation='destination-out';
    word('AI',888,49,86,65,'bold 100px Arial, sans-serif');
  }else if(pattern==='t11')word('T11+',36,40,952,177,'600 160px Arial, sans-serif');
  else ctx.drawImage(wordmarkImage,28,47,968,162.0);
  const map=new THREE.CanvasTexture(canvas);map.name=pattern+'_artwork';map.colorSpace=THREE.SRGBColorSpace;
  return {map};
}

export function createUpholsteredRetainer(parent,library){
  const size=RETAINER_SIZE,g=new THREE.Group();g.name='Upholstered_Brand_Retainer';
  g.position.set(0,size.bottom-LINKAGE.flatKnee.y,size.rear-LINKAGE.flatKnee.z);parent.add(g);
  g.userData={style:'reference upholstered retainer',dimensions:{...size},branding:'DeRUCCI',mount:'Calf_Deck',universal:true};
  const shape=new THREE.Shape();
  shape.moveTo(-.143,.003);shape.lineTo(.143,.003);
  shape.quadraticCurveTo(.147,.003,.147,.007);shape.lineTo(.147,.078);
  shape.quadraticCurveTo(.147,.081,.141,.082);
  shape.bezierCurveTo(.110,.088,.078,.093,.060,.093);shape.lineTo(-.060,.093);
  shape.bezierCurveTo(-.078,.093,-.110,.088,-.141,.082);
  shape.quadraticCurveTo(-.147,.081,-.147,.078);shape.lineTo(-.147,.007);
  shape.quadraticCurveTo(-.147,.003,-.143,.003);
  const geo=new THREE.ExtrudeGeometry(shape,{depth:.014,bevelEnabled:true,bevelThickness:.003,bevelSize:.003,bevelSegments:3,steps:1,curveSegments:16});
  geo.translate(0,0,.003);
  const uv=geo.attributes.uv,p=geo.attributes.position;
  for(let i=0;i<p.count;i++)uv.setXY(i,(p.getX(i)+.15)/.30,p.getY(i)/.096);
  const shell=new THREE.Mesh(geo,library.get('retainer'));shell.name='Padded_Retaining_Face';shell.castShadow=shell.receiveShadow=true;g.add(shell);
  // Slim mounting tongues sit above the foot surround and are concealed behind the padded face.
  const hardware=new THREE.MeshStandardMaterial({name:'retainer_mount',color:0x303638,roughness:.6,metalness:.65});
  for(const x of [-.102,.102]){
    const tongue=new THREE.Mesh(new RoundedBoxGeometry(.024,.004,.054,1,.001),hardware);tongue.name='Concealed_Retainer_Mount';tongue.position.set(x,-.014,-.021);g.add(tongue);
    const riser=new THREE.Mesh(new RoundedBoxGeometry(.024,.022,.004,1,.001),hardware);riser.name='Concealed_Retainer_Riser';riser.position.set(x,-.005,.001);g.add(riser);
  }
  const logo=new THREE.Mesh(new THREE.PlaneGeometry(.185,.04625),library.get('retainerLogo'));logo.name='Retainer_DeRUCCI_Logo';logo.position.set(0,.055,.0203);g.add(logo);
  // Tailored edge: a sub-millimetre recessed stitch, not a raised metal outline.
  const edgeMaterial=new THREE.MeshStandardMaterial({color:0x504941,roughness:.95});
  const points=[new THREE.Vector3(-.141,.012,.0201),new THREE.Vector3(-.141,.079,.0201),new THREE.Vector3(0,.089,.0201),new THREE.Vector3(.141,.079,.0201),new THREE.Vector3(.141,.012,.0201)];
  const seam=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points,false,'centripetal',.15),48,.00035,4,false),edgeMaterial);seam.name='Retainer_Tailored_Seam';g.add(seam);
  return g;
}

export function createMattressBranding(cover,library){
  const source=cover.geometry,p=source.attributes.position,idx=source.index,triangles=[];
  const front=source.groups.find(g=>g.materialIndex===4);
  for(let i=front.start;i<front.start+front.count;i+=3){
    const ids=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)];
    const tri=new THREE.Triangle(...ids.map(n=>new THREE.Vector3().fromBufferAttribute(p,n)));
    if(tri.getArea()>1e-10)triangles.push({ids,tri});
  }
  return FRONT_MARKS.map(mark=>{
    const geometry=new THREE.PlaneGeometry(mark.width,mark.height,18,4),out=geometry.attributes.position,bindings=[];
    const q=new THREE.Vector3(),bary=new THREE.Vector3();
    for(let i=0;i<out.count;i++){
      const v=new THREE.Vector3(out.getX(i)+mark.x,out.getY(i)+mark.y,DIMENSIONS.length/2);let best=null,distance=Infinity;
      for(const t of triangles){t.tri.closestPointToPoint(v,q);const d=q.distanceToSquared(v);if(d<distance){best=t;distance=d;}}
      best.tri.closestPointToPoint(v,q);best.tri.getBarycoord(q,bary);
      bindings.push({ids:best.ids,weights:bary.toArray(),lift:.00055});
    }
    const mesh=new THREE.Mesh(geometry,library.get(mark.material));mesh.name=mark.name;mesh.receiveShadow=true;
    mesh.userData={text:mark.text,placement:'foot facing',artwork:mark.material==='brand'?'official DeRUCCI wordmark with reference AI badge':'reference T11+ reconstruction'};
    mesh.surfaceBinding={cover,bindings};updateBoundWelt(mesh);return mesh;
  });
}

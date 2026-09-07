import * as THREE from 'three';
import { brandingMap } from './branding.js';

const cache=new Map();
const clamp=(v)=>Math.max(0,Math.min(1,v));
const hash=(x,y)=>{let h=Math.imul(x,374761393)^Math.imul(y,668265263)^73;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;};
const line=(v,n,w)=>Math.exp(-Math.pow((v*n-Math.round(v*n))/w,2));
const leatherPatterns=['grain','pebble','smooth'];
export function proceduralMaps(pattern,part){
  if(!pattern)return {};
  if(['derucciAI','derucci','t11'].includes(pattern))return brandingMap(pattern);
  const leather=leatherPatterns.includes(pattern),side=part==='side',ribbon=pattern==='ribbon',woven=['performance','microMesh'].includes(pattern);
  const width=side?2048:leather?512:1024,height=side?256:ribbon?64:width,key=`${pattern}:${width}:${height}`;
  if(!cache.has(key)){
    const heights=new Float32Array(width*height),colors=new Uint8Array(width*height),rough=new Uint8Array(width*height);
    const cells=pattern==='pebble'?52:88;
    const sites=leather?Array.from({length:cells*cells},(_,i)=>[.15+hash(i%cells,Math.floor(i/cells))*.7,.15+hash(i%cells+217,Math.floor(i/cells)+91)*.7]):null;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const u=x/width,v=y/height,noise=hash(x,y)-.5;let h=.5,c=245,r=242;
      if(leather){
        const gx=u*cells,gy=v*cells,ix=Math.floor(gx),iy=Math.floor(gy);let first=9,second=9;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const sx=ix+dx,sy=iy+dy,site=sites[((sy+cells)%cells)*cells+(sx+cells)%cells];
          const d=Math.hypot(sx+site[0]-gx,sy+site[1]-gy);
          if(d<first){second=first;first=d;}else if(d<second)second=d;
        }
        const valley=1-clamp((second-first)/.18),pore=hash(x+117,y+93)>.985?.12:0;
        const depth=pattern==='smooth'?.16:1;
        h=.6-depth*(valley*.38+pore)+noise*.024;
        c=246-depth*valley*13+noise*4;r=219+valley*25+noise*7;
      }else if(woven){
        // Thread crossings form small diamonds; broad, low ribs run across the mattress width.
        const a=(u*(side?288:128)+v*(side?32:152)),b=(u*(side?288:128)-v*(side?32:152));
        const warp=.5+.5*Math.cos(a*Math.PI*2),weft=.5+.5*Math.cos(b*Math.PI*2);
        const crossing=warp*weft,thread=Math.max(warp,weft),hole=(1-warp)*(1-weft);
        const rib=side?0:line(v,24,.12),stripe=side?0:.5+.5*Math.cos(v*Math.PI*48);
        h=.44+thread*.075+crossing*.045-hole*.06+rib*.035+noise*.01;
        c=186+thread*48+crossing*16-hole*24+rib*12+stripe*5+noise*6;
        r=234+hole*15-thread*9;
      }else if(ribbon){
        const rib=.5+.5*Math.cos(v*Math.PI*28),fiber=Math.sin((u*256+v*8)*Math.PI*2);
        const stitch=(line(v-.10,1,.015)+line(v-.90,1,.015))*(.5+.5*Math.cos(u*Math.PI*128));
        h=.48+rib*.05+fiber*.014-stitch*.07;c=238+rib*10+fiber*3-stitch*25;r=238;
      }else{
        let seam=0,puff=0;
        if(pattern==='wave'){
          const a=line(u-.021*Math.sin(v*Math.PI*12),5,.028),b=line(v-.016*Math.sin(u*Math.PI*10),6,.028);seam=Math.max(a,b);puff=(1-line(u,5,.29))*(1-line(v,6,.29));
        }
        if(pattern==='diamond')seam=Math.max(line(u+v,side?14:5,.036),line(u-v,side?14:5,.036));
        if(pattern==='channel'){seam=line(u,side?28:12,.055);puff=1-line(u,side?28:12,.31);}
        if(pattern==='grid'){seam=Math.max(line(u,24,.048),line(v,4,.055));puff=(1-line(u,24,.3))*(1-line(v,4,.3));}
        if(pattern==='herringbone')seam=.38*line(u+(Math.floor(v*16)%2?1:-1)*v,side?90:45,.22);
        if(pattern==='honeycomb'){
          const px=u*9,py=v*6*Math.sqrt(3),col=Math.round(px/1.5);let nearest=Infinity,lx=0,ly=0;
          for(let k=col-1;k<=col+1;k++){
            const shift=((k%2+2)%2)*Math.sqrt(3)/2,row=Math.round((py-shift)/Math.sqrt(3));
            const dx=px-k*1.5,dy=py-row*Math.sqrt(3)-shift,d=dx*dx+dy*dy;
            if(d<nearest){nearest=d;lx=Math.abs(dx);ly=Math.abs(dy);}
          }
          seam=Math.exp(-Math.pow((Math.max(ly,lx*Math.sqrt(3)/2+ly/2)-Math.sqrt(3)/2)/.027,2));
        }
        const warp=Math.sin(x*Math.PI*2/4),weft=Math.sin(y*Math.PI*2/4),weave=(warp+weft)*.014;
        h=.52+puff*.12-seam*.24+weave+noise*.008;c=246-seam*20+(warp+weft)*1.8+noise*3;
        if(pattern==='foam'){h=.7-(hash(x,y)>.95?.3:0);c=242-(hash(x,y)>.95?26:0);}
      }
      const i=y*width+x;heights[i]=h;colors[i]=c;rough[i]=r;
    }
    const make=()=>{const c=document.createElement('canvas');c.width=width;c.height=height;return c;};
    const colorCanvas=make(),normalCanvas=make(),roughCanvas=leather||woven?make():null;
    const colorContext=colorCanvas.getContext('2d'),normalContext=normalCanvas.getContext('2d'),roughContext=roughCanvas?.getContext('2d');
    const albedo=colorContext.createImageData(width,height),normal=normalContext.createImageData(width,height),roughness=roughContext?.createImageData(width,height);
    const strength=leather?3.6:2.8;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x,j=i*4;
      // The image Y axis is downward; glTF/Three.js tangent-space normal Y is upward.
      const dx=(heights[y*width+(x+1)%width]-heights[y*width+(x+width-1)%width])*strength;
      const dy=(heights[((y+1)%height)*width+x]-heights[((y+height-1)%height)*width+x])*strength;
      const length=Math.hypot(dx,dy,1);
      for(let k=0;k<3;k++)albedo.data[j+k]=colors[i];albedo.data[j+3]=255;
      normal.data[j]=127.5-dx/length*127.5;normal.data[j+1]=127.5+dy/length*127.5;normal.data[j+2]=127.5+127.5/length;normal.data[j+3]=255;
      if(roughness){for(let k=0;k<3;k++)roughness.data[j+k]=rough[i];roughness.data[j+3]=255;}
    }
    colorContext.putImageData(albedo,0,0);normalContext.putImageData(normal,0,0);if(roughness)roughContext.putImageData(roughness,0,0);
    cache.set(key,{map:colorCanvas,normalMap:normalCanvas,...(roughCanvas?{roughnessMap:roughCanvas}:{})});
  }
  return Object.fromEntries(Object.entries(cache.get(key)).map(([slot,canvas])=>{
    const t=new THREE.CanvasTexture(canvas);t.name=`${part}_${pattern}_${slot}`;t.wrapS=t.wrapT=THREE.RepeatWrapping;
    t.colorSpace=slot==='map'?THREE.SRGBColorSpace:THREE.NoColorSpace;return [slot,t];
  }));
}

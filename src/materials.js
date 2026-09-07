import * as THREE from 'three';
import {COLLECTIONS,PATTERN_OPTIONS} from './cmf.js';
import {proceduralMaps} from './textures.js';

export const MATERIAL_CONFIG={
  fabric:{label:'床垫上层面料',color:'#f3eee4',pattern:'wave',roughness:.94,metalness:0,repeat:[1,1],maps:{}},
  side:{label:'床垫围边面料',color:'#d7cbb7',pattern:'grid',roughness:.92,metalness:0,repeat:[1,1],maps:{}},
  waistband:{label:'床垫腰线织带',color:'#cfc5b2',pattern:'ribbon',roughness:.88,metalness:0,repeat:[4,1],maps:{}},
  leather:{label:'床屏皮革',color:'#c8b59a',pattern:'grain',roughness:.66,metalness:0,repeat:[6,3],maps:{}},
  surround:{label:'床邦与床尾皮革',color:'#a48d71',pattern:'grain',roughness:.68,metalness:0,repeat:[6,3],maps:{}},
  piping:{label:'床垫与床体包边',color:'#8e7c65',pattern:null,roughness:.78,metalness:0,repeat:[1,1],maps:{}},
  frame:{label:'金属床架',color:'#354046',pattern:null,roughness:.4,metalness:.7,repeat:[1,1],maps:{}},
  foam:{label:'基础承托泡棉',color:'#d9d1bd',pattern:'foam',roughness:1,metalness:0,repeat:[2,2],maps:{}},
  retainer:{label:'床尾软包挡板',color:'#443d36',pattern:'grain',roughness:.82,metalness:0,repeat:[3,1],maps:{}},
  retainerLogo:{label:'挡板 DeRUCCI 标识',color:'#171410',pattern:'derucci',roughness:.94,metalness:0,repeat:[1,1],maps:{}},
  brand:{label:'床垫 DeRUCCI AI 标识',color:'#e0dace',pattern:'derucciAI',roughness:.83,metalness:0,repeat:[1,1],maps:{}},
  modelMark:{label:'床垫 T11+ 标识',color:'#e0dace',pattern:'t11',roughness:.83,metalness:0,repeat:[1,1],maps:{}},
};
export class MaterialLibrary{
  constructor(renderer,invalidate=()=>{}){
    this.invalidate=invalidate;this.config=structuredClone(MATERIAL_CONFIG);this.materials={};this.renderer=renderer;this.owned=new Set();this.collection='ivory';
    for(const [id,c]of Object.entries(this.config)){
      const urls={...c.maps};this.materials[id]=['leather','surround','retainer'].includes(id)
        ?new THREE.MeshPhysicalMaterial({name:id,color:c.color,roughness:c.roughness,metalness:0,clearcoat:.16,clearcoatRoughness:.48})
        :new THREE.MeshStandardMaterial({name:id,color:c.color,roughness:c.roughness,metalness:c.metalness,alphaTest:['brand','modelMark','retainerLogo'].includes(id)?.22:0,side:id==='waistband'?THREE.DoubleSide:THREE.FrontSide});this.setPattern(id,c.pattern);
      for(const [slot,url]of Object.entries(urls))if(url)this.replace(id,slot,url).catch(console.error);
    }
  }
  get(id){return this.materials[id];}
  release(t){if(t&&this.owned.has(t)){t.dispose();this.owned.delete(t);}}
  configureTexture(t,id){if(!t)return;t.repeat.set(...this.config[id].repeat);t.anisotropy=Math.min(16,this.renderer.capabilities.getMaxAnisotropy());this.owned.add(t);}
  setPattern(id,pattern){
    if(pattern!==null&&!PATTERN_OPTIONS[id]?.includes(pattern))throw new Error('不适用于此部件的纹理');
    const m=this.get(id),c=this.config[id];
    for(const slot of ['map','bumpMap','normalMap','roughnessMap']){this.release(m[slot]);m[slot]=null;}
    c.pattern=pattern;c.maps={};
    for(const [slot,t] of Object.entries(proceduralMaps(pattern,id))){m[slot]=t;this.configureTexture(t,id);}
    m.normalScale.setScalar(['grain','pebble'].includes(pattern)?.65:pattern==='smooth'?.4:.42);
    m.needsUpdate=true;this.invalidate();
  }
  update(id,values){
    const c=this.config[id],m=this.get(id);Object.assign(c,values);
    if(values.color)m.color.set(values.color);if(values.roughness!==undefined)m.roughness=values.roughness;if(values.metalness!==undefined)m.metalness=values.metalness;
    if(values.repeat)for(const key of ['map','bumpMap','normalMap','roughnessMap'])if(m[key])m[key].repeat.set(...values.repeat);
    this.invalidate();
  }
  applyCollection(id){
    const c=COLLECTIONS.find(c=>c.id===id);if(!c)throw new Error('未知搭配方案');
    ['fabric','side','leather','surround','piping'].forEach((part,i)=>{
      const pattern=i<4?c.patterns[Math.min(i,2)]:null;
      this.update(part,{color:c.colors[i],roughness:c.roughness?.[i]??(pattern==='smooth'?.5:pattern==='pebble'?.78:MATERIAL_CONFIG[part].roughness),repeat:[...MATERIAL_CONFIG[part].repeat]});
      this.setPattern(part,pattern);
    });
    this.update('waistband',{color:c.bandColor||MATERIAL_CONFIG.waistband.color,roughness:.88,repeat:[4,1]});this.setPattern('waistband','ribbon');
    const sideColor=new THREE.Color(c.colors[1]),luminance=.2126*sideColor.r+.7152*sideColor.g+.0722*sideColor.b;
    for(const part of ['brand','modelMark']){this.update(part,{color:luminance>.28?'#46423b':'#e0dace',repeat:[1,1]});this.setPattern(part,MATERIAL_CONFIG[part].pattern);}
    for(const part of ['retainer','retainerLogo'])this.reset(part);
    this.collection=id;
  }
  async replace(id,slot,url,label=url){
    if(!['map','normalMap','roughnessMap'].includes(slot))throw new Error('不支持的纹理通道');
    const t=await new THREE.TextureLoader().loadAsync(url);t.colorSpace=slot==='map'?THREE.SRGBColorSpace:THREE.NoColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;this.configureTexture(t,id);
    const m=this.get(id);this.release(m[slot]);m[slot]=t;
    if(slot==='normalMap'){this.release(m.bumpMap);m.bumpMap=null;m.normalScale.set(.45,.45);}
    m.needsUpdate=true;this.config[id].maps[slot]=label;this.invalidate();
  }
  reset(id){const c=structuredClone(MATERIAL_CONFIG[id]),urls={...c.maps};this.config[id]=c;this.setPattern(id,c.pattern);this.update(id,c);for(const [slot,url]of Object.entries(urls))if(url)this.replace(id,slot,url).catch(console.error);}
}

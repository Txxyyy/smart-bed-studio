import { T12_MASSAGE_LAYOUT as D } from './dimensions.js';

export function t12MassageChannels(){
  return [0,1].map(side=>{
    const id=side===1?'left':'right';
    return {id,side,name:side===1?'人体左侧':'人体右侧',defaultIntensity:D.defaultIntensity,defaultCycleSeconds:D.defaultCycleSeconds,
      pads:D.rows.map((z,row)=>({id:`${id}.massage-${row+1}`,x:(side===1?1:-1)*D.sideX,z,width:D.padWidth,depth:D.padDepth,
        cells:row===2?[-.174,-.058,.058,.174].map(x=>({x,z:0,radius:D.radius})):
          [-D.clusterX,D.clusterX].flatMap(cx=>[{x:cx-D.clusterSpread,z:D.clusterDepth/2,radius:D.radius},{x:cx+D.clusterSpread,z:D.clusterDepth/2,radius:D.radius},{x:cx,z:-D.clusterDepth,radius:D.radius}]),
      })),
    };
  });
}

export const massagePulse=(phase,row,count)=>Math.max(0,Math.cos((phase-row/count)*Math.PI*2))**2;

// Only the display advances. The observed App state is never overwritten by a cycle.
export class MassageMotion{
  constructor(channels){this.channels=channels;this.lanes=Object.fromEntries(channels.map(c=>[c.id,{amount:0,phase:0,intensity:c.defaultIntensity,cycleSeconds:c.defaultCycleSeconds}]));}
  step(states,dt,{paused=false,online=true,reducedMotion=false}={}){
    if(paused)return false;
    let moving=false;
    for(const channel of this.channels){
      const state=states[channel.id],lane=this.lanes[channel.id];
      if(!online||state.status==='paused')continue;
      const intensity=state.intensity??channel.defaultIntensity,intensityDelta=intensity-lane.intensity;
      lane.intensity=reducedMotion||lane.amount===0?intensity:lane.intensity+Math.sign(intensityDelta)*Math.min(Math.abs(intensityDelta),dt/D.fadeSeconds);
      lane.cycleSeconds=state.cycleSeconds??channel.defaultCycleSeconds;
      const target=state.status==='running'&&intensity>0?1:0;
      const delta=target-lane.amount;
      lane.amount=reducedMotion?target:lane.amount+Math.sign(delta)*Math.min(Math.abs(delta),dt/D.fadeSeconds);
      if(Math.abs(target-lane.amount)<1e-6)lane.amount=target;
      if(!reducedMotion&&lane.amount>0){lane.phase=(lane.phase+dt/lane.cycleSeconds)%1;moving=true;}
      if(lane.amount===0)lane.phase=0;
    }
    return moving;
  }
  snapshot(){return structuredClone(this.lanes);}
}

// Compact, soft footprints are shared by the cover, heat and massage overlays.
export function massagePadWeight(pad,x,z){
  let weight=0;
  for(const cell of pad.cells){
    const distance=Math.hypot(x-pad.x-cell.x,z-pad.z-cell.z)/(cell.radius*D.surfaceSpread);
    if(distance<1)weight=Math.max(weight,Math.pow(.5+.5*Math.cos(Math.PI*distance),2));
  }
  return weight;
}
export function massageSurfaceLift(channels,lanes,x,z){
  let height=0;
  for(const channel of channels){
    const lane=lanes?.[channel.id];if(!lane?.amount)continue;
    channel.pads.forEach((pad,row)=>{height+=massagePadWeight(pad,x,z)*D.lift*lane.amount*lane.intensity*massagePulse(lane.phase,row,channel.pads.length);});
  }
  return height;
}

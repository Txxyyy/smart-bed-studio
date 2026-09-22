// Auto preserves the original image quality and follows display refresh cadence.
const MODES={
  native:{maxFps:null,pixelRatio:1.35,shadows:true,shadowSize:1024,anisotropy:16},
  eco:{maxFps:30,pixelRatio:1,shadows:false,shadowSize:512,anisotropy:2},
  balanced:{maxFps:30,pixelRatio:1.35,shadows:true,shadowSize:512,anisotropy:4},
  high:{maxFps:60,pixelRatio:1.75,shadows:true,shadowSize:1024,anisotropy:8},
};
export function renderBudget(mode='auto',mobile=false,pixelRatio){
  const resolved=mode==='auto'?'native':mode;
  if(!MODES[resolved]||(pixelRatio!==undefined&&(!Number.isFinite(pixelRatio)||pixelRatio<.5||pixelRatio>2)))throw Object.assign(new Error('性能模式须为 auto / native / eco / balanced / high，像素比范围0.5～2'),{code:'INVALID_PERFORMANCE'});
  const budget={...MODES[resolved],mode:resolved,requestedMode:mode};
  if(pixelRatio!==undefined)budget.pixelRatio=Math.min(budget.pixelRatio,pixelRatio);
  return budget;
}
export class RenderScheduler{
  constructor(callback,maxFps,{now=()=>performance.now(),raf=fn=>requestAnimationFrame(fn),cancelRaf=id=>cancelAnimationFrame(id),timer=(fn,ms)=>setTimeout(fn,ms),cancelTimer=id=>clearTimeout(id)}={}){
    Object.assign(this,{callback,maxFps,now,raf,cancelRaf,timer,cancelTimer});this.last=null;this.pending=false;this.blocked=false;
  }
  request(){
    if(this.blocked||this.pending)return;
    this.pending=true;
    const wait=this.maxFps===null||this.last===null?0:Math.max(0,1000/this.maxFps-(this.now()-this.last));
    const enqueue=()=>{this.timerId=null;this.rafId=this.raf(t=>{
      this.rafId=null;this.pending=false;
      if(this.blocked)return;
      if(this.maxFps!==null&&this.last!==null&&t-this.last<1000/this.maxFps-.5){this.request();return;}
      this.last=t;this.callback(t);
    });};
    if(wait>1)this.timerId=this.timer(enqueue,wait);else enqueue();
  }
  cancel(){if(this.timerId!=null)this.cancelTimer(this.timerId);if(this.rafId!=null)this.cancelRaf(this.rafId);this.timerId=this.rafId=null;this.pending=false;}
  setBlocked(blocked){this.blocked=blocked;if(blocked)this.cancel();else this.last=null;}
}

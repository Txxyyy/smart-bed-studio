import test from 'node:test';
import assert from 'node:assert/strict';
import {solveMechanism,transformPoint,LINKAGE,CAD_FIT} from './mechanism.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('actuators extend monotonically and remain inside the configured stroke limits',()=>{
  for(const [id,max]of [['back',65],['leg',35]]){
    let prev=-1;
    for(let angle=0;angle<=max;angle+=.5){
      const pose=solveMechanism(id==='back'?angle:0,id==='leg'?angle:0),motor=pose.actuators.find(a=>a.id===id),other=pose.actuators.find(a=>a.id!==id);
      assert.ok(motor.stroke>=prev);assert.ok(motor.stroke<=motor.maxStroke);
      assert.ok(motor.length>motor.barrelLength+.02);near(other.stroke,0);prev=motor.stroke;
    }
  }
});

test('five rigid decks preserve the source hinge layout and foot support links keep a constant length',()=>{
  for(let back=0;back<=65;back+=5)for(let leg=0;leg<=35;leg+=5){
    const m=solveMechanism(back,leg);
    assert.equal(m.decks.length,5);
    for(let i=0;i<4;i++){
      const d=m.decks[i],n=m.decks[i+1],a=transformPoint(d.origin,{y:0,z:d.end},d.angle),b=transformPoint(n.origin,{y:0,z:n.start},n.angle);
      assert.ok(Math.hypot(a.y-b.y,a.z-b.z)<.001);
    }
    const pin=transformPoint(m.knee,LINKAGE.footClevis,m.calf);
    near(pin.y,m.footPin.y);near(pin.z,m.footPin.z);
    near(Math.hypot(pin.y-LINKAGE.supportAnchor.y,pin.z-LINKAGE.supportAnchor.z),m.supportLength);
  }
});


test('STEP pin measurements and independent roller tracks agree with the source',()=>{
  const rest=solveMechanism(0,0);
  near(rest.actuators[0].closedLength/CAD_FIT.scale,.28805271800314614);
  near(rest.actuators[1].closedLength/CAD_FIT.scale,.29722536048762726);
  for(let back=0;back<=65;back+=.5)for(const leg of [0,10,24,35]){
    for(const p of solveMechanism(back,leg).actuators){
      const normalDistance=(p.roller.y-p.hinge.y)*Math.cos(p.boardAngle)+(p.roller.z-p.hinge.z)*Math.sin(p.boardAngle);
      near(normalDistance,p.contactOffset);
      // Source roller tracks: X 523.51..703.51 (back), -441.63..-261.63 (leg).
      const x=(p.id==='back'?337.5:-142.65)-p.trackPosition/CAD_FIT.scale*1000;
      const [min,max]=p.id==='back'?[523.51,703.51]:[-439.63,-261.63];
      assert.ok(x>min+10&&x<max-10,`${p.id} roller left its track at ${back}/${leg}: ${x}`);
      assert.ok(Math.abs(p.armAngle-p.boardAngle)<.13);
    }
  }
});

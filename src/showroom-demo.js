import { ZONES, clamp } from './kinematics.js';
import { HEAT_ZONES } from './heating.js';
import { REVEAL_TIMING } from './firmness.js';

export const DEMO_STEP_SECONDS = 4;
export const DEMO_STEPS = Object.freeze([
  ...['left', 'right'].flatMap((side) => [
    { side, zone: 0, kind: 'enter', value: 0 },
    { side, zone: 0, kind: 'air', value: 80 },
    { side, zone: 1, kind: 'air', value: 25 },
    { side, zone: 2, kind: 'air', value: 75 },
    { side, zone: 3, kind: 'air', value: 30 },
    { side, zone: 3, kind: 'exit', value: 0 },
    { side, zone: 1, kind: 'heat', value: 3 },
    { side, zone: 3, kind: 'heat', value: 2 },
  ]),
  { side: 'both', zone: 1, kind: 'rest', value: 0 },
]);

// Derive temporary demonstration values without writing over the user's manual setpoints.
export function sampleShowroomDemo(elapsed, baseline) {
  const clock = Math.max(0, elapsed),
    index = Math.floor(clock / DEMO_STEP_SECONDS) % DEMO_STEPS.length;
  const phase = (clock % DEMO_STEP_SECONDS) / DEMO_STEP_SECONDS;
  const frame = {
    pressures: baseline.pressures.map((row) => [...row]),
    heating: baseline.heating.map((row) => [...row]),
  };
  for (let i = 0; i <= index; i++) {
    const step = DEMO_STEPS[i],
      side = step.side === 'right' ? 1 : 0;
    if (step.kind === 'enter' || step.kind === 'exit') continue;
    const t = i === index ? clamp(phase / 0.72, 0, 1) : 1,
      ease = t * t * (3 - 2 * t);
    if (step.kind === 'rest') {
      for (const key of ['pressures', 'heating'])
        frame[key] = frame[key].map((row, s) =>
          row.map((v, z) => v + (baseline[key][s][z] - v) * ease),
        );
    } else {
      const key = step.kind === 'air' ? 'pressures' : 'heating';
      const z =
        step.kind === 'air'
          ? step.zone
          : HEAT_ZONES.findIndex((region) => region.zone === step.zone);
      frame[key][side][z] += (step.value - frame[key][side][z]) * ease;
    }
  }
  const selection = DEMO_STEPS[index];
  const sideName = selection.side === 'left' ? '左侧' : '右侧';
  const label =
    selection.kind === 'rest'
      ? '恢复设定 · 准备下一轮'
      : selection.kind === 'enter'
        ? `${sideName} · 扫描进入`
        : selection.kind === 'exit'
          ? `${sideName} · 扫描恢复外观`
          : `${sideName}${ZONES[selection.zone].name} · ${selection.kind === 'air' ? '气囊软硬' : '上层加热'}`;
  return {
    ...frame,
    index,
    phase,
    selection,
    cycle: Math.floor(clock / (DEMO_STEP_SECONDS * DEMO_STEPS.length)) + 1,
    label,
  };
}

export function showroomDemoReveal(frame, reducedMotion = false) {
  const { side, kind } = frame.selection,
    t = frame.phase * DEMO_STEP_SECONDS;
  if (kind === 'air') return { side, phase: 'adjust', progress: 1, ready: true };
  if (kind === 'enter') {
    if (reducedMotion) return { side, phase: 'adjust', progress: 1, ready: true };
    if (t < REVEAL_TIMING.flight / 1000)
      return { side, phase: 'camera', progress: 0, ready: false };
    const progress = clamp((t * 1000 - REVEAL_TIMING.flight) / REVEAL_TIMING.scan, 0, 1);
    return { side, phase: progress < 1 ? 'scan' : 'adjust', progress, ready: progress === 1 };
  }
  if (kind === 'exit' && !reducedMotion && t * 1000 < REVEAL_TIMING.scan)
    return { side, phase: 'closing', progress: 1 - (t * 1000) / REVEAL_TIMING.scan, ready: false };
  return { side: null, phase: 'closed', progress: 0, ready: true };
}

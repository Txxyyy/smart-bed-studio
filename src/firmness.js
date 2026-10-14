import { AIR_LAYOUT } from './dimensions.js';
import { ZONES, clamp } from './kinematics.js';

export const SIDE_NAMES = { left: '左侧', right: '右侧', both: '双侧' };
export const sideIndices = (side) => (side === 'both' ? [0, 1] : [side === 'right' ? 1 : 0]);
export const isSelectedZone = (selection, side, zone) =>
  !!selection &&
  (!selection.kind || selection.kind === 'air') &&
  selection.zone === zone &&
  sideIndices(selection.side).includes(side);

export const REVEAL_TIMING = Object.freeze({ flight: 1150, scan: 950 });

export function sampleAirReveal(selection, transition, now, reducedMotion = false) {
  if (transition?.closing) {
    const progress = 1 - clamp((now - transition.start) / REVEAL_TIMING.scan, 0, 1);
    return !reducedMotion && progress > 0
      ? { side: transition.side, phase: 'closing', progress, ready: false }
      : { side: null, phase: 'closed', progress: 0, ready: true };
  }
  if (selection?.kind !== 'air' || !transition)
    return { side: null, phase: 'closed', progress: 0, ready: true };
  const elapsed = now - transition.start;
  if (reducedMotion) return { side: selection.side, phase: 'adjust', progress: 1, ready: true };
  if (elapsed < transition.flight)
    return { side: selection.side, phase: 'camera', progress: 0, ready: false };
  const progress = clamp((elapsed - transition.flight) / REVEAL_TIMING.scan, 0, 1);
  return {
    side: selection.side,
    phase: progress < 1 ? 'scan' : 'adjust',
    progress,
    ready: progress === 1,
  };
}

export function setZonePressure(pressures, side, zone, value) {
  return pressures.map((values, s) =>
    values.map((v, z) => (z === zone && sideIndices(side).includes(s) ? clamp(value, 0, 100) : v)),
  );
}

export function desiredPressure(pressures, selection, cycling, side, zone, elapsed) {
  const base = pressures[side][zone];
  return cycling && isSelectedZone(selection, side, zone)
    ? clamp(base + 28 * Math.sin(elapsed * 1.9), 0, 100)
    : base;
}

export function firmnessCamera(side, zone) {
  const sign = side === 'left' ? -1 : side === 'right' ? 1 : 0;
  return {
    target: [sign * AIR_LAYOUT.centerX * 0.4, 0.58, ZONES[zone].z * 0.16],
    azimuth: sign * 0.98,
    polar: 0.94,
    radius: 5.3,
  };
}

// Orbit around the bed instead of interpolating through it when switching sides.
export function shortestAngle(from, to) {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

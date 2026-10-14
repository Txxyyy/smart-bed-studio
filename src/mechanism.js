import { DIMENSIONS } from './dimensions.js';
// Preserve STEP longitudinal dimensions and pin centres. Only the flush variant narrows the assembly.
export const CAD_FIT = {
  scale: 1,
  originX: 35,
  hingeZ: 1.639,
  deckHeight: DIMENSIONS.deckHeight,
  boardWidth: 1.59,
};
export const cadPoint = (x, y, z) => ({
  x: y / 1000,
  y: CAD_FIT.deckHeight + ((z - CAD_FIT.hingeZ) * CAD_FIT.scale) / 1000,
  z: (-(x - CAD_FIT.originX) * CAD_FIT.scale) / 1000,
});
const sub = (a, b) => ({ y: a.y - b.y, z: a.z - b.z });
const backHinge = cadPoint(337.5, 0, 1.639),
  legHinge = cadPoint(-142.65, 0, 1.33),
  flatKnee = cadPoint(-457.65, 0, 0.78);
const supportAnchor = cadPoint(-581.021, 0, -71.633),
  flatFootPin = cadPoint(-805.605, 0, -22.015);
export const LINKAGE = {
  backHinge,
  legHinge,
  flatKnee,
  backLength: 0.6425 * CAD_FIT.scale,
  thighLength: 0.315 * CAD_FIT.scale,
  calfLength: 0.45252 * CAD_FIT.scale,
  supportAnchor,
  footClevis: sub(flatFootPin, flatKnee),
};
export const ACTUATORS = [
  {
    id: 'back',
    label: '背部推杆',
    anchor: cadPoint(780.003, 50.5, -75.558),
    pivot: cadPoint(395.003, 0, -75.214),
    restMoving: cadPoint(497.118, 50.5, -21.24),
    restRoller: cadPoint(650.444, 0, -26.738),
    maxStroke: 0.125 * CAD_FIT.scale,
    rollerRadius: 0.02533 * CAD_FIT.scale,
  },
  {
    id: 'leg',
    label: '腿部推杆',
    anchor: cadPoint(-664.853, -51.5, -77.702),
    pivot: cadPoint(-210.009, 0, -75.698),
    restMoving: cadPoint(-372.759, -51.5, -22.711),
    restRoller: cadPoint(-418.027, 0, -27.549),
    maxStroke: 0.13 * CAD_FIT.scale,
    rollerRadius: 0.02534 * CAD_FIT.scale,
  },
].map((s) => ({
  ...s,
  x: s.anchor.x,
  barrelLength: (s.id === 'back' ? 0.24 : 0.25) * CAD_FIT.scale,
}));
export function rotatePoint(p, a) {
  return { y: p.y * Math.cos(a) - p.z * Math.sin(a), z: p.y * Math.sin(a) + p.z * Math.cos(a) };
}
export function transformPoint(origin, p, a) {
  const q = rotatePoint(p, a);
  return { y: origin.y + q.y, z: origin.z + q.z };
}
const rad = (d) => (Math.max(0, d) * Math.PI) / 180;

function solveLift(spec, hinge, boardAngle) {
  const q = sub(spec.restRoller, spec.pivot),
    offset = spec.restRoller.y - hinge.y;
  const rhs =
    offset -
    (spec.pivot.y - hinge.y) * Math.cos(boardAngle) -
    (spec.pivot.z - hinge.z) * Math.sin(boardAngle);
  const radius = Math.hypot(q.y, q.z),
    phase = Math.atan2(-q.z, q.y),
    ratio = rhs / radius;
  if (Math.abs(ratio) > 1 + 1e-8) throw Error('Roller cannot reach the board');
  const a = Math.acos(Math.max(-1, Math.min(1, ratio)));
  const candidates = [boardAngle + phase + a, boardAngle + phase - a];
  const armAngle = candidates.sort(
    (a, b) => Math.abs(a - boardAngle) - Math.abs(b - boardAngle),
  )[0];
  const moving = transformPoint(spec.pivot, sub(spec.restMoving, spec.pivot), armAngle),
    roller = transformPoint(spec.pivot, q, armAngle);
  const length = Math.hypot(moving.y - spec.anchor.y, moving.z - spec.anchor.z),
    closedLength = Math.hypot(spec.restMoving.y - spec.anchor.y, spec.restMoving.z - spec.anchor.z);
  const direction = Math.atan2(-(moving.y - spec.anchor.y), moving.z - spec.anchor.z),
    restDirection = Math.atan2(
      -(spec.restMoving.y - spec.anchor.y),
      spec.restMoving.z - spec.anchor.z,
    );
  return {
    ...spec,
    hinge,
    boardAngle,
    angle: armAngle,
    armAngle,
    moving,
    roller,
    length,
    closedLength,
    stroke: length - closedLength,
    axisRotation: direction - restDirection,
    contactOffset: offset,
    trackPosition:
      (roller.z - hinge.z) * Math.cos(boardAngle) - (roller.y - hinge.y) * Math.sin(boardAngle),
  };
}

export function solveMechanism(back, leg) {
  const b = rad(Math.min(65, Number(back) || 0)),
    l = rad(Math.min(35, Number(leg) || 0));
  const knee = transformPoint(legHinge, sub(flatKnee, legHinge), -l),
    f = supportAnchor,
    c = LINKAGE.footClevis;
  const supportLength = Math.hypot(flatFootPin.y - f.y, flatFootPin.z - f.z),
    radius = Math.hypot(c.y, c.z);
  const dy = f.y - knee.y,
    dz = f.z - knee.z,
    d = Math.hypot(dy, dz);
  const along = (radius * radius - supportLength * supportLength + d * d) / (2 * d),
    heightSquared = radius * radius - along * along;
  if (heightSquared < -1e-10) throw Error('Calf linkage cannot close');
  const height = Math.sqrt(Math.max(0, heightSquared)),
    center = { y: knee.y + (dy * along) / d, z: knee.z + (dz * along) / d };
  const choices = [
    { y: center.y - (dz * height) / d, z: center.z + (dy * height) / d },
    { y: center.y + (dz * height) / d, z: center.z - (dy * height) / d },
  ];
  const footPin = choices[0].z > choices[1].z ? choices[0] : choices[1];
  const calf = Math.atan2(-(footPin.y - knee.y), footPin.z - knee.z) - Math.atan2(-c.y, c.z);
  const seam = cadPoint(35, 0, 1.639);
  const decks = [
    { id: 'Back_Deck', origin: backHinge, angle: b, start: -LINKAGE.backLength, end: 0 },
    { id: 'Seat_Deck', origin: backHinge, angle: 0, start: 0, end: seam.z - backHinge.z },
    { id: 'Lumbar_Deck', origin: seam, angle: 0, start: 0, end: legHinge.z - seam.z },
    { id: 'Thigh_Deck', origin: legHinge, angle: -l, start: 0, end: LINKAGE.thighLength },
    { id: 'Calf_Deck', origin: knee, angle: calf, start: 0, end: LINKAGE.calfLength },
  ];
  return {
    back: b,
    leg: l,
    calf,
    knee,
    footPin,
    supportLength,
    decks,
    actuators: [solveLift(ACTUATORS[0], backHinge, b), solveLift(ACTUATORS[1], legHinge, -l)],
  };
}

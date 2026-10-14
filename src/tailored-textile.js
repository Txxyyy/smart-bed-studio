const tau = Math.PI * 2;
const distance = (v) => v - Math.round(v);

// Periodic, smoothly warped cloth coordinates: no parity cells or sharp polygon boundaries.
export function quiltValley(u, v) {
  // Stitch direction is transverse; diagonal jacquard belongs only to the cloth maps.
  return Math.exp(-((distance(30 * v) / 0.14) ** 2));
}

export function tailoredTextile(pattern, u, v, noise = 0) {
  const top = pattern === 't12Rib',
    tape = pattern === 't12Tape';
  const warp = 0.24 * Math.sin(tau * (3 * u + v)) + 0.12 * Math.sin(tau * (7 * u - 2 * v));
  const diagonal = (top ? 12 : 40) * u + (top ? 22 : tape ? 2 : 4) * v + warp;
  const motif = Math.sin(tau * diagonal) + 0.32 * Math.sin(tau * (diagonal * 2 + u - v));
  const seam = top ? quiltValley(u, v) : tape ? 0 : Math.exp(-((distance(40 * u) / 0.06) ** 2));
  const twill = Math.sin(
    tau * ((top ? 340 : 480) * u + (top ? 290 : tape ? 10 : 48) * v) +
      0.32 * Math.sin(tau * diagonal),
  );
  const yarn =
    Math.sin(tau * (top ? 420 : 560) * u) * Math.cos(tau * (top ? 460 : tape ? 28 : 96) * v);
  const nap =
    Math.sin(tau * (73 * u + 61 * v)) * 0.55 +
    Math.sin(tau * (137 * u - 83 * v)) * Math.cos(tau * (51 * u + 97 * v)) * 0.45;
  return {
    height:
      0.52 -
      seam * (top ? 0.16 : 0.065) +
      twill * 0.014 +
      yarn * 0.01 +
      nap * 0.006 +
      noise * 0.006,
    color:
      (top ? 210 : tape ? 190 : 199) -
      seam * (top ? 26 : 32) +
      motif * (top ? 5 : tape ? 5 : 12) +
      twill * 10 +
      yarn * 7 +
      nap * 8 +
      noise * 11,
    roughness: (top ? 236 : 232) + seam * 7 - motif * 3 - twill * 3,
  };
}

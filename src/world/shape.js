// Overture's outer mould line, simplified to a handful of analytic curves.
// Units are metres. Nose at x = −30.5, tail at x = +30.5 (201 ft overall).

export const NOSE = -30.5;
export const TAIL = 30.5;
export const LENGTH = TAIL - NOSE;
export const R = 1.55;          // outer fuselage radius
export const R_CABIN = 1.40;    // cabin wall radius
export const SY = 1.05;         // cross-section is slightly taller than wide
export const FLOOR_Y = -0.62;

const CABIN_START = -13;
const CABIN_END = 12;

export function radiusAt(x) {
  if (x < CABIN_START) {
    const s = (x - NOSE) / (CABIN_START - NOSE);
    return R * Math.pow(Math.sin(s * Math.PI / 2), 1.55);
  }
  if (x > CABIN_END) {
    const s = (x - CABIN_END) / (TAIL - CABIN_END);
    return R * (1 - 0.9 * Math.pow(s, 1.6));
  }
  return R;
}

// the nose droops a little, the tail cone sweeps up
export function centerYAt(x) {
  if (x < CABIN_START) {
    const s = (x - NOSE) / (CABIN_START - NOSE);
    return -0.32 * (1 - s) * (1 - s);
  }
  if (x > CABIN_END) {
    const s = (x - CABIN_END) / (TAIL - CABIN_END);
    return 0.55 * s * s;
  }
  return 0;
}

// Cabin windows: two rows, one per side.
export const WINDOW = { x0: -11.5, pitch: 1.05, count: 21, y: 0.18, hw: 0.2, hh: 0.28 };
export const HERO_WINDOW_INDEX = 9; // the one the camera flies through
export const HERO_WINDOW_X = WINDOW.x0 + WINDOW.pitch * HERO_WINDOW_INDEX; // −2.05

// Engines: inboard/outboard, x span of the nacelle, centre height.
export const ENGINES = [
  { z: 3.9, y: -2.05 },
  { z: 6.4, y: -2.2 },
];
export const NACELLE = { x0: 14.0, length: 9.3, radius: 0.75 };

// Wing planform (half-span, +Z side). Piecewise-linear leading/trailing edges.
export const WING = {
  y: -0.85,
  root: 0.9,
  tip: 16.2,
  le: [[0.9, -9.5], [5.0, 4.0], [13.8, 14.5], [16.2, 17.6]],
  te: [[0.9, 23.5], [9.0, 21.6], [16.2, 20.0]],
};

export function piecewise(points, z) {
  if (z <= points[0][0]) return points[0][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [z0, v0] = points[i];
    const [z1, v1] = points[i + 1];
    if (z <= z1) return v0 + ((z - z0) / (z1 - z0)) * (v1 - v0);
  }
  return points[points.length - 1][1];
}

// Gull wing: anhedral inboard to the engines, gentle dihedral outboard.
export function wingYAt(z) {
  return WING.y - 0.09 * Math.min(Math.max(z - 1.3, 0), 5) + 0.035 * Math.max(z - 6.3, 0);
}

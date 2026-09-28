// Overture's outer mould line, simplified to analytic curves traced from Boom's renderings.
// Units are metres. Nose at x = −30.5, tail at x = +30.5 (201 ft overall), left side toward +Z.

export const NOSE = -30.5;
export const TAIL = 30.5;
export const LENGTH = TAIL - NOSE;
export const R = 1.55;          // outer fuselage radius
export const R_CABIN = 1.40;    // cabin wall radius
export const SY = 1.05;         // cross-section is slightly taller than wide
export const FLOOR_Y = -0.62;

const CABIN_START = -12;
const CABIN_END = 10;

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Tail cone (after Boom's side-profile renders): the crown descends and the belly rises
// until they meet a little above the centreline, while the width tapers more slowly,
// so the fuselage finishes as a flat, wide blade behind the fin.
const TAIL_TOP = 0.5;       // crown height at the tip
const TAIL_BOTTOM = 0.4;    // belly height at the tip
const tailS = (x) => (x - CABIN_END) / (TAIL - CABIN_END);
const tailTop = (s) => R * SY - (R * SY - TAIL_TOP) * Math.pow(s, 1.4);
const tailBottom = (s) => -R * SY + (R * SY + TAIL_BOTTOM) * Math.pow(s, 1.25);

// Half-width of the fuselage (z).
export function radiusAt(x) {
  if (x < CABIN_START) {
    // nose cone
    const s = (x - NOSE) / (CABIN_START - NOSE);
    return R * Math.pow(Math.sin(s * Math.PI / 2), 0.95); // near-conical, as on Boom’s renders
  }
  if (x > CABIN_END) return R * (1 - 0.8 * Math.pow(tailS(x), 1.5));
  // area-ruled waist where the wing is thickest
  return R * (1 - 0.035 * smooth(-2, 6, x) * (1 - smooth(6, 10, x)));
}

// Half-height of the fuselage (y). Equal to radius × SY except on the flattened tail cone.
export function halfHeightAt(x) {
  if (x > CABIN_END) {
    const s = tailS(x);
    return (tailTop(s) - tailBottom(s)) / 2;
  }
  return radiusAt(x) * SY;
}

export function centerYAt(x) {
  if (x < CABIN_START) {
    const s = (x - NOSE) / (CABIN_START - NOSE);
    return -0.34 * (1 - s) * (1 - s);           // the nose sits slightly low
  }
  if (x > CABIN_END) {
    const s = tailS(x);
    return (tailTop(s) + tailBottom(s)) / 2;
  }
  return 0;
}

// Cabin windows: small, closely spaced, one row per side.
// Dense row, as on Boom's renders: 38 windows at 0.55 m between the two doors.
export const WINDOW = { x0: -11.9, pitch: 0.55, count: 38, y: 0.2, hw: 0.16, hh: 0.23 };
export const HERO_WINDOW_INDEX = 18; // the one the camera flies through
export const HERO_WINDOW_X = WINDOW.x0 + WINDOW.pitch * HERO_WINDOW_INDEX; // −2.0 (camera path depends on it)

// Gull wing (after Boom's orbit film): a long curved strake that starts just behind the
// cockpit, blending into a straight, sharply swept outer panel with cropped tips.
export const WING = {
  root: 0.9,
  tip: 16.2,
  le: [[0.9, -13.5], [1.6, -10.0], [2.6, -6.2], [4.0, -2.4], [5.8, 1.6], [7.8, 5.2], [16.2, 19.6]],
  te: [[0.9, 23.6], [3.2, 22.0], [5.4, 21.3], [16.2, 21.7]],
  t0: 0.66,   // root thickness
  t1: 0.05,   // tip thickness
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

// Gentle gull: a touch of anhedral to the engines, then dihedral outboard.
export function wingYAt(z) {
  return -1.22 - 0.05 * Math.min(Math.max(z - 1.3, 0), 4.6) + 0.035 * Math.max(z - 5.9, 0); // low wing
}

// Biconvex half-thickness at chord fraction u (0 = leading edge, 1 = trailing edge).
export function wingHalfThickness(z, u) {
  const w = (z - WING.root) / (WING.tip - WING.root);
  const tm = WING.t0 + (WING.t1 - WING.t0) * w;
  return (tm / 2) * Math.pow(Math.max(0, 1 - (2 * u - 1) ** 2), 0.7);
}

export function wingLowerY(x, z) {
  const le = piecewise(WING.le, z), te = piecewise(WING.te, z);
  const u = Math.min(1, Math.max(0, (x - le) / (te - le)));
  return wingYAt(z) - wingHalfThickness(z, u);
}

// Four Symphony engines spread along the span (inboard at about a third of the semispan,
// outboard just past half). Long nacelles tucked tight under the wing, from near the leading
// edge to just ahead of the trailing edge, with the supersonic inlet spike pointing forward.
export const NACELLE = { length: 11.0, radius: 0.74 };
export const ENGINES = [[5.0, 7.8], [8.6, 9.6]].map(([z, x0]) => {
  // hang each nacelle just clear of the wing's lowest point along its length
  let lowest = Infinity;
  for (let x = x0; x <= x0 + NACELLE.length; x += 0.25) lowest = Math.min(lowest, wingLowerY(x, z));
  return { z, x0, y: lowest - NACELLE.radius - 0.05 };
});

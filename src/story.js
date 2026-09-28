// The whole experience is one shot. Scroll progress (0 → 1) is the only clock.
// Everything that changes with scroll is declared here so the choreography
// can be read (and retimed) in one place.

// Camera keyframes: p = scroll progress, pos/look in world metres, fov in degrees.
// The aircraft sits at the origin, nose toward −X, left side facing +Z.
export const SHOTS = [
  // 01 — Hero: the rendering, rebuilt. Overture over the cloud deck.
  { p: 0.000, pos: [-64, -11, 60], look: [1, -5, 0], fov: 30 },
  { p: 0.050, pos: [-44, -7, 64], look: [1, -4, 0], fov: 30 },

  // 02 — By the numbers: a slow tracking pass along the fuselage.
  { p: 0.100, pos: [4, 2.5, 52], look: [4, -3.0, 0], fov: 30 },
  { p: 0.150, pos: [6, 3, 34], look: [-1.5, -0.8, 0], fov: 32 },

  // 03 — Approach: line up on one window and push in until it fills frame.
  { p: 0.195, pos: [-1.2, 0.9, 11], look: [-2.0, 0.2, 0], fov: 34 },
  { p: 0.225, pos: [-2.0, 0.3, 4.2], look: [-2.0, 0.2, 0], fov: 36 },
  { p: 0.250, pos: [-2.0, 0.22, 1.9], look: [-2.0, 0.2, -1], fov: 40 },

  // 04 — Cabin: through the glass, turn down the aisle, settle at a window seat.
  { p: 0.268, pos: [-2.0, 0.28, 1.05], look: [-2.6, 0.2, -2], fov: 50 },
  { p: 0.290, pos: [-1.6, 0.42, 0.1], look: [-7.5, 0.05, 0.25], fov: 52 },
  { p: 0.330, pos: [1.3, 0.48, -0.05], look: [-6.0, 0.0, 0.55], fov: 52 },
  { p: 0.370, pos: [-3.05, 0.62, -0.05], look: [-4.6, 0.1, -1.0], fov: 50 }, // down the aisle, then step into the seat
  { p: 0.405, pos: [-3.1, 0.82, -0.06], look: [-4.5, 0.02, -1.25], fov: 62 }, // from the aisle, behind the seat — as in Boom's render

  // 05 — Airframe: rise through the ceiling as the aircraft comes apart.
  { p: 0.430, pos: [-3.6, 2.6, 0.8], look: [-3.6, 0.0, 0.0], fov: 46 },
  { p: 0.470, pos: [-44, 40, 50], look: [10, -5, -5], fov: 34 },
  { p: 0.515, pos: [-36, 22, 36], look: [-6, -1, 0], fov: 34 },

  // 06 — Carbon: push into the nose skin, the plies peel away...
  { p: 0.545, pos: [-22.4, 1.5, 6.6], look: [-24.0, 0.58, 1.2], fov: 34 },
  { p: 0.575, pos: [-24.0, 0.66, 2.9], look: [-24.0, 0.58, 0.4], fov: 34 },

  // 07 — ...down to the silicon.
  { p: 0.600, pos: [-24.0, 0.6, 0.95], look: [-24.0, 0.58, 0.3], fov: 34 },
  { p: 0.625, pos: [-24.0, 0.585, 0.42], look: [-24.0, 0.58, 0.3], fov: 32 },
  { p: 0.650, pos: [-23.996, 0.5825, 0.3165], look: [-24.0, 0.58, 0.3027], fov: 30 },
  { p: 0.662, pos: [-23.9975, 0.5818, 0.3150], look: [-24.0, 0.5798, 0.3027], fov: 30 },

  // 08 — Symphony: pull all the way back out as the aircraft reassembles, swing to an engine.
  { p: 0.686, pos: [-8, 4, 29], look: [8, -1.8, 8.6], fov: 34 },
  { p: 0.705, pos: [13.5, -3.3, 23.5], look: [18.0, -2.3, 8.6], fov: 32 },
  { p: 0.742, pos: [10.2, -3.2, 19.0], look: [16.8, -2.3, 8.6], fov: 32 },
  { p: 0.780, pos: [19.5, -3.0, 22.0], look: [17.4, -2.3, 8.6], fov: 32 },

  // 09 — Mach: back out wide, watch the shock cone form and sharpen.
  { p: 0.805, pos: [6, 5, 58], look: [0.0, 0.0, 0.0], fov: 32 },
  { p: 0.860, pos: [30, 7, 80], look: [6.0, -1.0, 0.0], fov: 32 },

  // 10 — Boomless Cruise: drop below to see the boom bend away from the ground.
  { p: 0.890, pos: [18, -18, 150], look: [14.0, -26.0, 0.0], fov: 34 },
  { p: 0.930, pos: [4, -14, 160], look: [10.0, -24.0, 0.0], fov: 34 },

  // 11 — Airlines: the closing beauty shot.
  { p: 0.965, pos: [-56, -5, 34], look: [-2.0, 0.0, 0.0], fov: 30 },
  { p: 1.000, pos: [-64, -8, 42], look: [0.0, 1.0, 0.0], fov: 28 },
];

// Chapter windows [in, fullIn, fullOut, out] for captions and scene states.
export const CHAPTERS = [
  { id: 'hero',     label: 'Overture',   w: [-1, -1, 0.045, 0.075] },
  { id: 'numbers',  label: 'Numbers',    w: [0.075, 0.095, 0.155, 0.175] },
  { id: 'approach', label: 'Approach',   w: [0.180, 0.195, 0.230, 0.250] },
  { id: 'cabin',    label: 'Cabin',      w: [0.290, 0.305, 0.400, 0.420] },
  { id: 'airframe', label: 'Airframe',   w: [0.460, 0.475, 0.515, 0.535] },
  { id: 'carbon',   label: 'Carbon',     w: [0.545, 0.555, 0.580, 0.592] },
  { id: 'silicon',  label: 'Silicon',    w: [0.605, 0.620, 0.662, 0.672] },
  { id: 'symphony', label: 'Symphony',   w: [0.700, 0.712, 0.775, 0.790] },
  { id: 'mach',     label: 'Mach 1.7',   w: [0.810, 0.825, 0.865, 0.880] },
  { id: 'boomless', label: 'Boomless',   w: [0.890, 0.900, 0.935, 0.948] },
  { id: 'airlines', label: 'Airlines',   w: [0.960, 0.975, 2, 2] },
];

// ── tiny math helpers used by every module ──────────────────────────────
export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// 0 → 1 → 0 over a [in, fullIn, fullOut, out] window
export const windowed = (w, p) => smooth(w[0], w[1], p) * (1 - smooth(w[2], w[3], p));

// Scene states derived from progress. Pure function of p — deterministic and scrubbable.
export function sceneState(p) {
  return {
    // hero window glass clears as we reach it
    glass: 1 - smooth(0.21, 0.245, p),
    // cabin lights up as we pass the glass, dims as we leave
    cabin: smooth(0.235, 0.27, p) * (1 - smooth(0.44, 0.48, p)),
    // skin becomes x-ray as we rise through the ceiling; back to solid before the engine
    xray: smooth(0.41, 0.45, p) * (1 - smooth(0.664, 0.695, p)),
    // parts pull apart for the airframe chapter
    explode: smooth(0.44, 0.50, p) * (1 - smooth(0.664, 0.695, p)),
    // carbon plies peel one by one
    plies: smooth(0.555, 0.595, p),
    // chip lid lifts, die lights up
    die: smooth(0.615, 0.642, p),
    // the airframe clears away for the macro dive
    macro: smooth(0.525, 0.55, p) * (1 - smooth(0.664, 0.676, p)),
    // background falls away to a dark studio for the engineering chapters
    dim: smooth(0.43, 0.47, p) * (1 - smooth(0.664, 0.69, p)),
    // nacelle cutaway
    cutaway: smooth(0.70, 0.725, p) * (1 - smooth(0.78, 0.80, p)),
    // mach number over the Mach chapter
    mach: 0.94 + 0.76 * smooth(0.815, 0.87, p),
    // shock cone opacity
    shock: smooth(0.82, 0.835, p) * (1 - smooth(0.945, 0.965, p)),
    // Mach-cutoff rays, over a darkened sky so the diagram reads
    rays: smooth(0.885, 0.91, p) * (1 - smooth(0.945, 0.96, p)),
    night: 0.72 * smooth(0.88, 0.905, p) * (1 - smooth(0.945, 0.965, p)),
  };
}

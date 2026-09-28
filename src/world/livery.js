import * as THREE from 'three';
import { NOSE, LENGTH, halfHeightAt, centerYAt } from './shape.js';

// Livery painted at runtime on canvases, traced from Boom's Overture renderings.
// The fuselage is unwrapped as u = along the body (nose → tail) and v = angle around it,
// starting at the belly (θ = −π/2) so the seam never crosses the livery; θ = 0 is the +Z side. Three maps share that layout:
//   map        — base colour
//   roughness  — satin paint, glossier dark band, mirror-like cockpit glass
//   bump       — panel seams and door outlines

const W = 4096, H = 1024;
const WHITE = [236, 238, 241];
const INK = [17, 21, 30];         // the near-black navy of the tail and fin
const SLATE = [52, 60, 76];       // the band lightens toward its forward tip
const GLASS = [10, 13, 19];

// Fin texture space: metres, isotropic, so the mark keeps its proportions on the tapered fin.
export const FIN_UV = { x0: 16.4, y0: 0.2, size: 12.5 };

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function canvasTexture(canvas, renderer, srgb = true) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  return tex;
}

// Signed coverage of the dark band at (x, h), h = sin θ (−1 belly … +1 crown).
function bandCoverage(x, h, aa) {
  if (x < -7) return 0;
  // top edge: under the windows at its tip, rising across the aft windows, then over the whole tail
  const top1 = -0.075 + 0.62 * smooth(-2, 10, x);
  const top = top1 + (1.5 - top1) * smooth(14, 27.5, x);
  // bottom edge: a sharp point that drops to the belly within a few metres
  const bottom = lerp(-0.075, -1.2, smooth(-7, 1.5, x));
  return smooth(-aa, aa, top - h) * smooth(-aa, aa, h - bottom);
}

// Cockpit visor, as elevation angles e = asin(h) on each side. Where `hi` passes π/2 the two
// sides meet over the crown: one glossy horseshoe at the front, thin stripes trailing aft.
const VISOR = {
  x:  [-25.4, -23.6, -21.0, -18.0, -14.0, -9.0, -4.0, -1.0],
  lo: [0.95,  0.56,  0.42,  0.40,  0.47,  0.6,  0.7,  0.78],
  hi: [0.95,  1.7,   1.7,   1.22,  1.0,   0.9,  0.83, 0.78],
};
function visorCoverage(x, e, aa) {
  if (x <= VISOR.x[0] || x >= VISOR.x[VISOR.x.length - 1]) return 0;
  let i = 0;
  while (x > VISOR.x[i + 1]) i++;
  const t = (x - VISOR.x[i]) / (VISOR.x[i + 1] - VISOR.x[i]);
  const k = t * t * (3 - 2 * t);
  const lo = lerp(VISOR.lo[i], VISOR.lo[i + 1], k), hi = lerp(VISOR.hi[i], VISOR.hi[i + 1], k);
  return smooth(-aa, aa, e - lo) * smooth(-aa, aa, hi - e);
}

export function fuselageLivery(renderer) {
  const [colC, col] = canvas2d(W, H);
  const [rghC, rgh] = canvas2d(W, H);
  const [bmpC, bmp] = canvas2d(W, H);

  // 1 — per-pixel base: paint, band and glass, with matching roughness
  const ci = col.createImageData(W, H);
  const ri = rgh.createImageData(W, H);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const streak = new Float32Array(W).map(() => (rnd() - 0.5) * 0.035);
  const rowH = new Float32Array(H), rowE = new Float32Array(H);
  for (let j = 0; j < H; j++) {
    rowH[j] = Math.sin((j / (H - 1)) * Math.PI * 2 - Math.PI / 2);
    rowE[j] = Math.asin(Math.max(-1, Math.min(1, rowH[j])));
  }
  const bandCol = [0, 0, 0];
  for (let i = 0; i < W; i++) {
    const x = NOSE + (i / (W - 1)) * LENGTH;
    const g = smooth(-6, 20, x);
    for (let n = 0; n < 3; n++) bandCol[n] = lerp(SLATE[n], INK[n], g);
    for (let j = 0; j < H; j++) {
      const band = bandCoverage(x, rowH[j], 0.006);
      const glass = visorCoverage(x, rowE[j], 0.008);
      const k = (j * W + i) * 4;
      for (let n = 0; n < 3; n++) ci.data[k + n] = lerp(lerp(WHITE[n], bandCol[n], band), GLASS[n], glass);
      ci.data[k + 3] = 255;
      // roughness lives in G: satin white 0.34, band 0.28, glass 0.04, with faint streaks
      const r = lerp(lerp(0.34, 0.28, band), 0.04, glass) + streak[i] * (1 - glass);
      const g = Math.round(Math.min(1, Math.max(0, r)) * 255);
      ri.data[k] = g; ri.data[k + 1] = g; ri.data[k + 2] = g; ri.data[k + 3] = 255;
    }
  }
  col.putImageData(ci, 0, 0);
  rgh.putImageData(ri, 0, 0);

  // Paint in metres: x along the body, y up the side.
  const px = (x) => ((x - NOSE) / LENGTH) * W;
  const thetaFor = (x, y) => Math.asin(Math.max(-1, Math.min(1, (y - centerYAt(x)) / halfHeightAt(x))));
  const TAU = Math.PI * 2;
  const py = (th) => ((((th + Math.PI / 2) % TAU) + TAU) % TAU) / TAU * H;
  const bothSides = (th) => [py(th), py(Math.PI - th)];

  // 2 — panel seams and doors in the bump map (mid-grey base, seams pressed in)
  bmp.fillStyle = 'rgb(128,128,128)';
  bmp.fillRect(0, 0, W, H);
  bmp.strokeStyle = 'rgb(92,92,92)';
  bmp.lineWidth = 2;
  for (const x of [-24, -19, -13, -7.5, -1, 4.5, 10, 15, 20.5, 25.5]) {
    bmp.beginPath(); bmp.moveTo(px(x), 0); bmp.lineTo(px(x), H); bmp.stroke();
  }
  bmp.lineWidth = 1.5;
  for (const y of [0.78, -0.42]) {
    for (const t of bothSides(thetaFor(0, y))) {
      bmp.beginPath(); bmp.moveTo(px(-13), t); bmp.lineTo(px(10), t); bmp.stroke();
    }
  }
  bmp.lineWidth = 2.5;
  for (const [x, w] of [[-13.3, 0.85], [9.6, 0.8]]) {
    const t0 = thetaFor(x, -0.5), t1 = thetaFor(x, 0.98);
    for (const [a, b] of [[py(t0), py(t1)], [py(Math.PI - t1), py(Math.PI - t0)]]) {
      bmp.beginPath();
      bmp.roundRect(px(x), Math.min(a, b), (w / LENGTH) * W, Math.abs(b - a), 8);
      bmp.stroke();
    }
  }

  // Text reads nose-to-tail on the left (+Z) side and tail-to-nose on the right (−Z) side,
  // so each side gets its own flip. Everything is drawn in centimetres.
  const onSide = (side, x, y, draw) => {
    const th = thetaFor(x, y);
    col.save();
    col.translate(px(x), py(side > 0 ? th : Math.PI - th));
    const sx = W / LENGTH / 100, sy = H / (Math.PI * 2 * halfHeightAt(x)) / 100;
    col.scale(side > 0 ? sx : -sx, side > 0 ? -sy : sy);
    draw();
    col.restore();
  };

  const ink = 'rgb(34,40,54)';
  const text = (str, weight, size, spacing, color) => {
    col.fillStyle = color;
    col.font = `${weight} expanded ${size}px Archivo, "Helvetica Neue", Arial, sans-serif`;
    if ('fontStretch' in col) col.fontStretch = 'expanded';
    col.textAlign = 'center';
    col.textBaseline = 'middle';
    if ('letterSpacing' in col) col.letterSpacing = `${spacing}px`;
    col.fillText(str, 0, 0);
  };

  for (const side of [1, -1]) {
    // 3 — registration, then the Boom mark with its wordmark, just ahead of the front door
    onSide(side, -19.4, 0.12, () => text('N2808M', 500, 26, 3, ink));
    onSide(side, -14.35, 0.62, () => drawPhoenix(col, 0, 0, 30, ink, 'rgb(236,238,241)'));
    onSide(side, -14.35, 0.2, () => text('BOOM', 600, 11, 4, ink));

    // 4 — OVERTURE, large and thin across the band, aft of the windows
    onSide(side, 14.7, centerYAt(14.7) + 0.1, () => text('OVERTURE', 400, 100, 30, 'rgb(236,238,241)'));
  }

  return {
    map: canvasTexture(colC, renderer),
    roughnessMap: canvasTexture(rghC, renderer, false),
    bumpMap: canvasTexture(bmpC, renderer, false),
  };
}

// Boom's phoenix: raised wings forming a solid V around a rounded notch (the head),
// with slim feathers radiating around the rest of the circle. Drawn y-up, radius r.
export function drawPhoenix(ctx, cx, cy, r, color, bg) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(r, -r);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  const feather = (deg, r0, r1, width) => {
    const a = (deg * Math.PI) / 180;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.stroke();
  };
  // slim feathers from the upper left, down and around to the upper right
  const n = 15;
  for (let i = 0; i < n; i++) {
    const deg = 146 + (i * (394 - 146)) / (n - 1);
    const down = Math.max(0, -Math.sin((deg * Math.PI) / 180));
    feather(deg, 0.32, 0.95 - down * 0.14, 0.085);
  }
  // raised wings: two broad feathers meeting in a solid core
  feather(62, 0.1, 0.84, 0.26);
  feather(118, 0.1, 0.84, 0.26);
  ctx.beginPath();
  ctx.arc(0, 0, 0.34, 0, Math.PI * 2);
  ctx.fill();
  // the rounded notch between the wings (the head)
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.ellipse(0, 0.56, 0.13, 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-0.13, 0.56, 0.26, 0.7);
  ctx.restore();
}

// The simpler fan used on screens and the cabin bulkhead.
export function drawSunburst(ctx, cx, cy, radius, color, rays = 13) {
  ctx.fillStyle = color;
  for (let i = 0; i < rays; i++) {
    const a = Math.PI * (0.06 + (0.88 * i) / (rays - 1));
    const len = radius * (0.78 + 0.22 * Math.sin((i / (rays - 1)) * Math.PI));
    const spread = 0.055;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a - spread) * len, cy - Math.sin(a - spread) * len);
    ctx.lineTo(cx + Math.cos(a) * len * 1.04, cy - Math.sin(a) * len * 1.04);
    ctx.lineTo(cx + Math.cos(a + spread) * len, cy - Math.sin(a + spread) * len);
    ctx.closePath();
    ctx.fill();
  }
}

// Fin: UVs are metres / FIN_UV.size from (x0, y0), u aft and v up — see overture.js.
export function tailLivery(renderer) {
  const S = 1024;
  const [c, ctx] = canvas2d(S, S);
  ctx.fillStyle = `rgb(${INK.join(',')})`;
  ctx.fillRect(0, 0, S, S);
  // place the mark in metres on the fin
  const px = (x) => ((x - FIN_UV.x0) / FIN_UV.size) * S;
  const pv = (y) => ((y - FIN_UV.y0) / FIN_UV.size) * S;
  ctx.save();
  // large, and clipped by the fin's edges — as painted on the aircraft
  ctx.translate(px(26.1), pv(3.0));
  ctx.scale(1, -1); // canvas y (= v) runs upward on the fin; drawPhoenix draws y-up itself
  drawPhoenix(ctx, 0, 0, 2.6 / FIN_UV.size * S, 'rgb(236,238,241)', `rgb(${INK.join(',')})`);
  ctx.restore();
  return canvasTexture(c, renderer);
}

// Control-surface hinge lines and panel seams for the wing and tailplanes (u chord, v span).
export function wingBump(renderer) {
  const S = 1024;
  const [c, ctx] = canvas2d(S, S);
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgb(90,90,90)';
  ctx.lineWidth = 3;
  const line = (u0, v0, u1, v1) => { ctx.beginPath(); ctx.moveTo(u0 * S, v0 * S); ctx.lineTo(u1 * S, v1 * S); ctx.stroke(); };
  line(0.82, 0.2, 0.82, 0.97);                   // elevon hinge line
  for (const v of [0.2, 0.46, 0.72, 0.97]) line(0.82, v, 1, v);
  line(0.1, 0.05, 0.1, 0.98);                    // leading-edge panel
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgb(108,108,108)';
  for (const v of [0.14, 0.3, 0.46, 0.62, 0.78]) line(0.1, v, 0.82, v);
  return canvasTexture(c, renderer, false);
}

// Seat-back screen: a moving-map in Overture's UI style.
const CONTINENTS = [
  // rough lon/lat outlines — enough to read as a map at seat-back size
  [[-168, 66], [-140, 70], [-95, 72], [-80, 63], [-60, 55], [-53, 47], [-70, 43], [-76, 35], [-81, 25], [-97, 26], [-105, 20], [-92, 15], [-83, 9], [-79, 8], [-88, 14], [-105, 22], [-117, 32], [-124, 40], [-125, 49], [-135, 58], [-152, 58], [-165, 60]],
  [[-80, 9], [-70, 12], [-60, 8], [-50, 0], [-35, -7], [-40, -22], [-48, -28], [-58, -38], [-66, -55], [-73, -50], [-72, -30], [-70, -18], [-81, -5]],
  [[-45, 60], [-20, 70], [-18, 80], [-60, 83], [-72, 78], [-55, 68]],
  [[-10, 36], [-9, 43], [-2, 48], [-5, 58], [5, 62], [10, 71], [30, 71], [60, 70], [100, 77], [140, 72], [180, 68], [170, 60], [140, 55], [135, 43], [122, 30], [120, 22], [108, 20], [105, 10], [98, 16], [92, 22], [80, 15], [77, 8], [72, 20], [60, 25], [50, 30], [35, 32], [28, 36], [22, 40], [15, 38], [5, 43], [-5, 36]],
  [[-17, 21], [-10, 35], [10, 37], [32, 31], [43, 12], [51, 11], [40, -15], [33, -26], [20, -35], [12, -18], [9, 4], [-8, 4], [-17, 14]],
  [[113, -22], [122, -18], [136, -12], [142, -11], [153, -27], [150, -37], [140, -38], [130, -32], [115, -34]],
  [[-8, 51], [-3, 50], [2, 51], [-1, 57], [-5, 58]],
];

export function screenTexture(renderer) {
  const W = 1024, H = 640;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#16325a');
  bg.addColorStop(1, '#0c1c36');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // map viewport: North Atlantic
  const lon0 = -100, lon1 = 40, lat0 = 20, lat1 = 72;
  const mx = (lon) => 300 + ((lon - lon0) / (lon1 - lon0)) * 700;
  const my = (lat) => 60 + ((lat1 - lat) / (lat1 - lat0)) * 520;
  ctx.save();
  ctx.beginPath();
  ctx.rect(300, 60, 700, 520);
  ctx.clip();
  const path = new Path2D();
  for (const poly of CONTINENTS) {
    poly.forEach(([lo, la], i) => (i ? path.lineTo(mx(lo), my(la)) : path.moveTo(mx(lo), my(la))));
    path.closePath();
  }
  ctx.fillStyle = 'rgba(120,160,210,0.28)';
  for (let x = 300; x < 1000; x += 9) {
    for (let y = 60; y < 580; y += 9) {
      if (ctx.isPointInPath(path, x, y)) ctx.fillRect(x, y, 4, 4);
    }
  }
  // route: New York → London, great-circle-ish arc
  const a = [mx(-73.8), my(40.6)], b = [mx(-0.45), my(51.5)];
  const c = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 110];
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.setLineDash([6, 8]);
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(...a); ctx.quadraticCurveTo(...c, ...b); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#fff555';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i <= 58; i++) {
    const t = i / 100;
    const x = (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0];
    const y = (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1];
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  for (const p of [a, b]) { ctx.beginPath(); ctx.arc(...p, 7, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();

  // side panel
  ctx.fillStyle = '#ffffff';
  drawSunburst(ctx, 58, 84, 26, '#ffffff', 9);
  ctx.font = '700 22px Archivo, Arial, sans-serif';
  ctx.fillText('OVERTURE', 96, 88);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '500 17px Archivo, Arial, sans-serif';
  ctx.fillText('NEW YORK  →  LONDON', 40, 170);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 64px Archivo, Arial, sans-serif';
  ctx.fillText('1:24', 40, 250);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '500 17px Archivo, Arial, sans-serif';
  ctx.fillText('TIME TO DESTINATION', 40, 282);
  const rows = [['MACH', '1.70'], ['ALTITUDE', '60,000 ft'], ['OUTSIDE', '−57 °C']];
  rows.forEach(([k, v], i) => {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(k, 40, 350 + i * 70);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 28px Archivo, Arial, sans-serif';
    ctx.fillText(v, 40, 380 + i * 70);
    ctx.font = '500 17px Archivo, Arial, sans-serif';
  });

  const tex = canvasTexture(canvas, renderer);
  tex.flipY = true;
  return tex;
}

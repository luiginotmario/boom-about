import * as THREE from 'three';
import { NOSE, LENGTH, SY, radiusAt, centerYAt } from './shape.js';

// Livery painted at runtime on canvases. The fuselage texture is unwrapped
// as u = along the body, v = angle around it (θ = 0 on the +Z side, mid-height).

const NAVY = [20, 33, 61];
const NAVY_DEEP = [11, 19, 38];
const GREY = [96, 106, 124];
const WHITE = [244, 245, 247];

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function canvasTexture(canvas, renderer) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  return tex;
}

export function fuselageLivery(renderer) {
  const W = 4096, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // 1 — base paint: white forward, navy sweeping up the aft body to the tail.
  const img = ctx.createImageData(W, H);
  for (let i = 0; i < W; i++) {
    const u = i / (W - 1);
    const boundary = lerp(-1.25, 1.35, smooth(0.5, 0.93, u)); // in units of sin θ
    for (let j = 0; j < H; j++) {
      const th = (j / (H - 1)) * Math.PI * 2;
      const h = Math.sin(th);
      const k = (j * W + i) * 4;
      let c = WHITE;
      const edge = boundary - h;
      if (edge > 0.0) {
        const g = smooth(0.0, 0.22, edge);
        const deep = smooth(0.3, 1.4, edge) * 0.6 + smooth(0.8, 1.0, u) * 0.4;
        const navy = [lerp(NAVY[0], NAVY_DEEP[0], deep), lerp(NAVY[1], NAVY_DEEP[1], deep), lerp(NAVY[2], NAVY_DEEP[2], deep)];
        c = [lerp(GREY[0], navy[0], g), lerp(GREY[1], navy[1], g), lerp(GREY[2], navy[2], g)];
      }
      img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Helpers to paint in metres on the body: x along the fuselage, arc up the side.
  const px = (x) => ((x - NOSE) / LENGTH) * W;
  const thetaFor = (x, y) => Math.asin(Math.max(-1, Math.min(1, (y - centerYAt(x)) / (radiusAt(x) * SY))));
  const py = (th) => (((th % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * H;

  // 2 — cabin windows are drawn in the skin shader (see overture.js), not painted here.

  // 3 — cockpit visor: the dark band that runs along the upper nose.
  ctx.fillStyle = '#07090d';
  for (const side of [1, -1]) {
    ctx.beginPath();
    const xs = [-25.5, -22, -18, -15.2];
    const lo = [0.62, 0.5, 0.46, 0.5];
    const hi = [0.62, 0.95, 0.98, 0.9];
    const at = (th) => (side > 0 ? th : Math.PI - th);
    ctx.moveTo(px(xs[0]), py(at(lo[0])));
    for (let i = 1; i < xs.length; i++) ctx.lineTo(px(xs[i]), py(at(lo[i])));
    for (let i = xs.length - 1; i >= 0; i--) ctx.lineTo(px(xs[i]), py(at(hi[i])));
    ctx.closePath();
    ctx.fill();
  }

  // 4 — subtle panel lines and doors.
  ctx.strokeStyle = 'rgba(40,48,64,0.35)';
  ctx.lineWidth = 2;
  for (const x of [-13, -1, 12]) {
    ctx.beginPath(); ctx.moveTo(px(x), 0); ctx.lineTo(px(x), H); ctx.stroke();
  }
  for (const [x, w] of [[-12.6, 0.9], [8.9, 0.8]]) {
    const th0 = thetaFor(x, -0.55), th1 = thetaFor(x, 0.95);
    for (const t of [[th0, th1], [Math.PI - th1, Math.PI - th0]]) {
      ctx.beginPath();
      ctx.roundRect(px(x), py(t[0]), (w / LENGTH) * W, py(t[1]) - py(t[0]), 10);
      ctx.stroke();
    }
  }

  // 5 — OVERTURE wordmark, aft body, +Z side (canvas is flipped vertically there).
  const wx = 17.5;
  const r = radiusAt(wx);
  const sy = H / (Math.PI * 2 * r * SY);
  const sx = W / LENGTH;
  ctx.save();
  ctx.translate(px(wx), py(thetaFor(wx, centerYAt(wx) + 0.02)));
  ctx.scale(sx / 100, -sy / 100); // draw in centimetres: tiny px font sizes rasterise poorly
  ctx.fillStyle = '#f4f5f7';
  ctx.font = '700 62px Archivo, "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '9px';
  ctx.fillText('OVERTURE', 0, 0);
  ctx.restore();

  return canvasTexture(canvas, renderer);
}

// Boom's sunburst on the fin: tapered rays fanning out from one point.
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

// Fin texture: u = chord (0 leading edge → 1 trailing edge), v = span (0 root → 1 tip).
export function tailLivery(renderer) {
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, '#1a2a4f');
  g.addColorStop(1, '#0b1326');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // canvas y = span (flipY is off); flip so the burst fans from near the root toward the tip
  ctx.save();
  ctx.translate(0, S);
  ctx.scale(1, -1);
  drawSunburst(ctx, S * 0.64, S * 0.8, S * 0.42, '#f4f5f7', 13);
  ctx.restore();
  return canvasTexture(canvas, renderer);
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

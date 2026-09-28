// Monotone cubic (Fritsch–Carlson) interpolation over non-uniform keyframe times.
// Unlike Catmull-Rom it never overshoots between keys, which matters here:
// the camera threads a 40 cm window and a 3 mm chip die — overshoot = clipping.

function monotoneTangents(t, v) {
  const n = t.length;
  const d = new Array(n - 1);
  const m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (v[i + 1] - v[i]) / (t[i + 1] - t[i]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return m;
}

function channel(t, v) {
  const m = monotoneTangents(t, v);
  return (x) => {
    if (x <= t[0]) return v[0];
    const last = t.length - 1;
    if (x >= t[last]) return v[last];
    let i = 0;
    while (x > t[i + 1]) i++;
    const h = t[i + 1] - t[i];
    const s = (x - t[i]) / h;
    const s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * v[i] + (s3 - 2 * s2 + s) * h * m[i]
         + (-2 * s3 + 3 * s2) * v[i + 1] + (s3 - s2) * h * m[i + 1];
  };
}

export function createCameraPath(shots) {
  const t = shots.map((s) => s.p);
  const ch = (pick) => channel(t, shots.map(pick));
  const px = ch((s) => s.pos[0]), py = ch((s) => s.pos[1]), pz = ch((s) => s.pos[2]);
  const lx = ch((s) => s.look[0]), ly = ch((s) => s.look[1]), lz = ch((s) => s.look[2]);
  const fov = ch((s) => s.fov);
  return (p, outPos, outLook) => {
    outPos.set(px(p), py(p), pz(p));
    outLook.set(lx(p), ly(p), lz(p));
    return fov(p);
  };
}

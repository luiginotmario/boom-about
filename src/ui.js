import * as THREE from 'three';
import { CHAPTERS, windowed, smooth } from './story.js';

// DOM layer: captions, HUD, odometer stats, chapter rail and 3D-anchored labels.
// Everything is written from the single frame loop, and only when it changes.

const fmtMach = (m) => m.toFixed(2);

function buildOdometers(root) {
  for (const el of root.querySelectorAll('[data-odo]')) {
    const text = el.dataset.odo;
    el.setAttribute('aria-label', text);
    el.textContent = '';
    let col = 0;
    for (const ch of text) {
      if (/\d/.test(ch)) {
        const wrap = document.createElement('span');
        wrap.className = 'odo-col';
        wrap.setAttribute('aria-hidden', 'true');
        const strip = document.createElement('span');
        strip.className = 'odo-strip';
        strip.style.setProperty('--d', ch);
        strip.style.setProperty('--i', col++);
        strip.textContent = '0123456789';
        wrap.append(strip);
        el.append(wrap);
      } else {
        const s = document.createElement('span');
        s.className = 'odo-char';
        s.setAttribute('aria-hidden', 'true');
        s.textContent = ch;
        el.append(s);
      }
    }
  }
}

export function createUI({ onJump }) {
  const caps = new Map();
  for (const c of CHAPTERS) {
    const el = document.querySelector(`[data-chapter="${c.id}"]`);
    if (el) caps.set(c.id, { el, w: c.w, last: -1 });
  }
  buildOdometers(document);

  // chapter rail
  const rail = document.querySelector('.rail');
  const railItems = CHAPTERS.map((c, i) => {
    const b = document.createElement('button');
    b.className = 'rail-item';
    b.type = 'button';
    b.innerHTML = `<span class="rail-num">${String(i + 1).padStart(2, '0')}</span><span class="rail-label">${c.label}</span>`;
    const target = c.w[1] < 0 ? 0 : (c.w[1] + Math.min(c.w[2], 1)) / 2;
    b.addEventListener('click', () => onJump(target));
    rail.append(b);
    return b;
  });

  const hud = {
    mach: document.querySelector('[data-hud="mach"]'),
    alt: document.querySelector('[data-hud="alt"]'),
    chapter: document.querySelector('[data-hud="chapter"]'),
    bar: document.querySelector('.hud-progress i'),
    liveMach: document.querySelector('[data-live="mach"]'),
    liveMu: document.querySelector('[data-live="mu"]'),
  };
  const numbers = caps.get('numbers')?.el;
  const cue = document.querySelector('.scroll-cue');
  const scrim = document.querySelector('.hero-scrim');

  // 3D-anchored labels: { el, anchor: Vector3 | () => Vector3, visible: (p, s) => 0..1 }
  const labels = [];
  const addLabel = (el, anchor, visible) => labels.push({ el, anchor, visible, last: '' });
  const v = new THREE.Vector3();

  let activeIndex = -1;
  let lastMach = '';

  function update(p, s, camera, width, height) {
    // captions
    for (const cap of caps.values()) {
      const o = windowed(cap.w, p);
      if (Math.abs(o - cap.last) < 0.002) continue;
      cap.last = o;
      cap.el.style.opacity = o.toFixed(3);
      cap.el.style.transform = `translate3d(0, ${((1 - o) * 28).toFixed(1)}px, 0)`;
      const on = o > 0.5;
      if (cap.el.classList.contains('on') !== on) {
        cap.el.classList.toggle('on', on);
        cap.el.toggleAttribute('inert', !on);
      }
    }
    if (numbers) numbers.classList.toggle('rolled', windowed(caps.get('numbers').w, p) > 0.6);
    if (cue) cue.style.opacity = (1 - smooth(0.0, 0.03, p)).toFixed(3);
    if (scrim) scrim.style.opacity = (1 - smooth(0.0, 0.05, p)).toFixed(3);

    // chapter index = last chapter whose window has started
    let idx = 0;
    CHAPTERS.forEach((c, i) => { if (p >= Math.max(0, c.w[0])) idx = i; });
    if (idx !== activeIndex) {
      activeIndex = idx;
      railItems.forEach((b, i) => b.toggleAttribute('aria-current', i === idx));
      hud.chapter.textContent = `${String(idx + 1).padStart(2, '0')} / ${String(CHAPTERS.length).padStart(2, '0')} — ${CHAPTERS[idx].label}`;
    }
    hud.bar.style.transform = `scaleX(${p.toFixed(4)})`;

    // Mach readout replays the acceleration during the Mach chapter.
    const replay = smooth(0.79, 0.812, p) * (1 - smooth(0.87, 0.9, p));
    const mach = 1.7 + (s.mach - 1.7) * replay;
    const m = fmtMach(mach);
    if (m !== lastMach) {
      lastMach = m;
      hud.mach.textContent = m;
      if (hud.liveMach) hud.liveMach.textContent = m;
      if (hud.liveMu) hud.liveMu.textContent = mach >= 1 ? `${(Math.asin(1 / mach) * 180 / Math.PI).toFixed(1)}°` : '—';
    }

    // anchored labels
    for (const l of labels) {
      const o = l.visible(p, s);
      if (o < 0.01) {
        if (l.last !== 'hidden') { l.el.style.opacity = '0'; l.el.style.visibility = 'hidden'; l.last = 'hidden'; }
        continue;
      }
      v.copy(typeof l.anchor === 'function' ? l.anchor() : l.anchor).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) {
        if (l.last !== 'hidden') { l.el.style.opacity = '0'; l.el.style.visibility = 'hidden'; l.last = 'hidden'; }
        continue;
      }
      const x = (v.x * 0.5 + 0.5) * width;
      const y = (-v.y * 0.5 + 0.5) * height;
      const key = `${x.toFixed(1)}|${y.toFixed(1)}|${o.toFixed(2)}`;
      if (key === l.last) continue;
      l.last = key;
      l.el.style.visibility = 'visible';
      l.el.style.opacity = o.toFixed(2);
      l.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }

  return { update, addLabel };
}

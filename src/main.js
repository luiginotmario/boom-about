import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

import { SHOTS, CHAPTERS, sceneState, windowed, smooth } from './story.js';
import { createCameraPath } from './camera-path.js';
import { createComposer } from './post.js';
import { createUI } from './ui.js';
import { createSky, bakeEnvironment, loadSkyHdri, setSunElevation, SUN } from './world/sky.js';
import { createOverture } from './world/overture.js';
import { NACELLE } from './world/shape.js';
import { createCabin } from './world/cabin.js';
import { createSymphony } from './world/symphony.js';
import { createSiliconRig } from './world/silicon.js';
import { createShock } from './world/shock.js';

gsap.registerPlugin(ScrollTrigger);

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const mobile = coarse || matchMedia('(max-width: 760px)').matches;
const maxDpr = mobile ? 1.5 : 2;

// ── renderer ────────────────────────────────────────────────────────────
const canvas = document.getElementById('webgl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxDpr));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.localClippingEnabled = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // the aircraft rarely moves: re-render shadows only when it does

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 3000);

// A photographed sky (Poly Haven, CC0) lights the aircraft. Loaded alongside the font;
// if it can't be reached the procedural sky stands in, so the page never blocks on it.
const HDRI_URL = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr';
const timeout = (ms) => new Promise((r) => setTimeout(r, ms));
const [, hdri] = await Promise.all([
  Promise.race([
    Promise.all([document.fonts.load('700 62px Archivo'), document.fonts.load('500 54px Archivo')]),
    timeout(2500),
  ]),
  Promise.race([loadSkyHdri(HDRI_URL).catch(() => null), timeout(6000).then(() => null)]),
]);
if (hdri) setSunElevation(hdri.sunElevation);

// ── world ───────────────────────────────────────────────────────────────
const env = bakeEnvironment(renderer, hdri);
hdri?.texture.dispose();
scene.environment = env;
const sky = createSky();
scene.add(sky);

// The sun: warm, with soft shadows sized to the aircraft.
const sun = new THREE.DirectionalLight(0xfff0de, 4.2);
sun.position.copy(SUN).multiplyScalar(90);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(mobile ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 20, far: 170 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.035;
sun.shadow.radius = 3;
scene.add(sun, sun.target);

const overture = createOverture(renderer);
scene.add(overture.root);
const cabin = createCabin(renderer);
scene.add(cabin.root);
const symphony = createSymphony(overture.heroEngine.clipPlanes);
overture.heroEngine.holder.add(symphony.root);
symphony.root.scale.setScalar(NACELLE.length / 8.6); // internals are modelled for an 8.6 m nacelle
// neutral studio reflections for the macro shots (the sky would mirror in the glossy plies)
const pmrem = new THREE.PMREMGenerator(renderer);
const studioEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();
const silicon = createSiliconRig(studioEnv);
scene.add(silicon.root);
const shock = createShock();
scene.add(shock.root);

const post = createComposer(renderer, scene, camera, {
  mobile,
  aoHidden: [sky, shock.root, overture.heroGlass], // transparent or infinitely far: no occlusion
});

// ── scroll → progress ──────────────────────────────────────────────────
// Lenis owns the scroll, ScrollTrigger maps it to a target, the loop damps it.
const state = {
  progress: { current: 0, target: 0, ease: 0.075 },
  mouseX: { current: 0, target: 0, ease: 0.08 },
  mouseY: { current: 0, target: 0, ease: 0.08 },
};
const damp = (s, dt) => { s.current += (s.target - s.current) * (1 - Math.pow(1 - s.ease, dt * 60)); };

const lenis = reduced ? null : new Lenis({
  duration: 1.25,
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  smoothWheel: true,
  prevent: () => false,
});
lenis?.on('scroll', ScrollTrigger.update);

gsap.to(state.progress, {
  target: 1,
  ease: 'none',
  scrollTrigger: { trigger: '#scroll', start: 'top top', end: 'bottom bottom', scrub: true },
});

const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight;
const ui = createUI({
  onJump: (p) => {
    const y = p * maxScroll();
    if (lenis) lenis.scrollTo(y, { duration: 2.2 });
    else window.scrollTo(0, y);
  },
});

// ── 3D-anchored labels ──────────────────────────────────────────────────
const byName = (n) => overture.root.getObjectByName(n);
const chapterW = (id) => CHAPTERS.find((c) => c.id === id).w;
const anchored = (obj, local) => { const v = new THREE.Vector3(); return () => obj.localToWorld(v.copy(local)); };

const tagSpecs = [
  ['nose', 'nose', [-24, 1.3, 0]],
  ['fuselage', 'forward-fuselage', [-7, 1.7, 0.4]],
  ['wing', 'left-wing', [12.5, -1.1, 11]],
  ['engines', 'symphony-L1', [3.5, -0.8, 0]],
  ['fin', 'fin', [27, 7.6, 0]],
];
for (const [key, obj, local] of tagSpecs) {
  const el = document.querySelector(`[data-tag="${key}"]`);
  ui.addLabel(el, anchored(byName(obj), new THREE.Vector3(...local)), (p) => windowed(chapterW('airframe'), p));
}
for (const [key, local] of Object.entries(symphony.anchors)) {
  const el = document.querySelector(`[data-tag="${key}"]`);
  const w = chapterW('symphony');
  const scaled = local.clone().multiplyScalar(symphony.root.scale.x);
  ui.addLabel(el, anchored(overture.heroEngine.holder, scaled), (p) => windowed([w[0] + 0.01, w[1] + 0.01, w[2], w[3]], p));
}
for (const [key, pos] of Object.entries(cabin.hotspots)) {
  const el = document.querySelector(`[data-hotspot="${key}"]`);
  ui.addLabel(el, pos, (p) => windowed(chapterW('cabin'), p));
}
ui.addLabel(document.querySelector('[data-tag="ground"]'), new THREE.Vector3(60, -46, 40), (p) => windowed(chapterW('boomless'), p));

// ── input ───────────────────────────────────────────────────────────────
if (!coarse && !reduced) {
  window.addEventListener('pointermove', (e) => {
    state.mouseX.target = (e.clientX / window.innerWidth) * 2 - 1;
    state.mouseY.target = -((e.clientY / window.innerHeight) * 2 - 1);
  }, { passive: true });
}
let resizePending = true;
window.addEventListener('resize', () => { resizePending = true; });

// ── frame ───────────────────────────────────────────────────────────────
const path = createCameraPath(SHOTS);
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
// Inspection mode: ?cam=x,y,z,lookX,lookY,lookZ,fov pins the camera (for comparing against references).
const inspect = new URLSearchParams(location.search).get('cam')?.split(',').map(Number) ?? null;
const intro = { v: reduced || inspect ? 0 : 1 };
let elapsed = 0;
let lastShadowKey = '';
let width = window.innerWidth, height = window.innerHeight;

function frame(dt) {
  dt = Math.min(dt, 0.1);
  elapsed += dt;

  if (resizePending) {
    resizePending = false;
    width = window.innerWidth; height = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxDpr));
    renderer.setSize(width, height);
    post.setSize(width, height);
    camera.aspect = width / height;
  }

  for (const k in state) damp(state[k], dt);
  const p = state.progress.current;
  const s = sceneState(p);

  // camera: sample the path at the damped progress, then add a little life
  let fov = path(p, camPos, camLook);
  if (inspect) { camPos.set(inspect[0], inspect[1], inspect[2]); camLook.set(inspect[3], inspect[4], inspect[5]); fov = inspect[6]; }
  fwd.subVectors(camLook, camPos);
  const dist = fwd.length();
  fwd.divideScalar(dist);
  right.crossVectors(fwd, THREE.Object3D.DEFAULT_UP).normalize();
  up.crossVectors(right, fwd);
  if (intro.v > 0) camPos.addScaledVector(fwd, -intro.v * 38).addScaledVector(up, intro.v * 4);
  const mx = state.mouseX.current, my = state.mouseY.current;
  const outside = 1 - s.cabin;
  const macro = s.dim;
  camPos.addScaledVector(right, mx * dist * 0.02 * outside * (1 - macro))
        .addScaledVector(up, my * dist * 0.012 * outside * (1 - macro));
  camLook.addScaledVector(right, mx * 1.1 * s.cabin).addScaledVector(up, my * 0.45 * s.cabin);

  camera.position.copy(camPos);
  camera.lookAt(camLook);
  // Shots are composed for ~16:10. On narrower screens, open the lens partway
  // so the aircraft still fits without going fisheye.
  const designAspect = 1.6;
  if (camera.aspect < designAspect) {
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * designAspect);
    const full = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / camera.aspect));
    camera.fov = Math.min(fov + (full - fov) * 0.5, fov * 1.8);
  } else {
    camera.fov = fov;
  }
  camera.near = THREE.MathUtils.clamp(dist * 0.015, 0.0002, 0.3);
  camera.updateProjectionMatrix();

  // world
  const replay = smooth(0.79, 0.812, p) * (1 - smooth(0.87, 0.9, p));
  const mach = 1.7 + (s.mach - 1.7) * replay;
  sky.position.copy(camera.position);
  sky.material.uniforms.uTime.value = elapsed;
  sky.material.uniforms.uSpeed.value = (reduced ? 0.1 : 0.55) * (mach / 1.7);
  sky.material.uniforms.uDim.value = Math.max(s.dim, s.night);
  // inside the cabin the windows carry the daylight, not the walls
  const indoors = Math.max(s.cabin, s.dim);
  sun.intensity = 4.2 * (1 - 0.88 * indoors);
  scene.environmentIntensity = 1 - 0.82 * indoors;

  // shadows only need re-rendering when the aircraft itself changes shape
  const shadowKey = `${s.explode.toFixed(4)}|${s.cutaway.toFixed(3)}|${s.macro > 0.999}`;
  if (shadowKey !== lastShadowKey) {
    lastShadowKey = shadowKey;
    renderer.shadowMap.needsUpdate = true;
  }

  overture.update(s);
  cabin.update(s);
  symphony.update(s, dt, elapsed, reduced);
  silicon.update(s, elapsed);
  shock.update(s, elapsed, mach);

  ui.update(p, s, camera, width, height);

  post.setAO(s.xray < 0.01 && s.dim < 0.01 && s.night < 0.01, 2.2 + (0.45 - 2.2) * s.cabin);
  post.setTime(elapsed);
  post.composer.render(dt);
}

// One clock for everything: Lenis, ScrollTrigger and the render share gsap.ticker.
gsap.ticker.lagSmoothing(0);
gsap.ticker.add((time, deltaMs) => {
  lenis?.raf(time * 1000);
  frame(deltaMs / 1000);
});

// Deep links / review: ?p=0.3 (or __boom.jump(0.3)) scrolls straight to a moment.
function jumpTo(p) {
  const y = p * maxScroll();
  if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
  else window.scrollTo(0, y);
  ScrollTrigger.update();
  state.progress.current = state.progress.target;
  intro.v = 0;
}
window.__boom = { jump: jumpTo };
const deepLink = parseFloat(new URLSearchParams(location.search).get('p'));
if (deepLink >= 0) gsap.delayedCall(0.05, () => jumpTo(deepLink));

// ── reveal ──────────────────────────────────────────────────────────────
await renderer.compileAsync(scene, camera).catch(() => {});
document.documentElement.classList.add('ready');
if (!reduced) gsap.to(intro, { v: 0, duration: 2.6, ease: 'power3.out', delay: 0.15 });

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { R, R_CABIN, SY, FLOOR_Y, WINDOW } from './shape.js';
import { bodyGeometry } from './overture.js';
import { screenTexture, drawSunburst } from './livery.js';

// The all-premium cabin from Boom's rendering: white shell seats, charcoal
// leather, walnut consoles, seat-back moving maps, deep oval windows.

const CABIN_X0 = -12.4;
const CABIN_X1 = 10.4;
const ROW_X0 = -11.0;
const ROW_PITCH = 1.6;
const ROWS = 13;
const SEAT_Z = 0.62;

const wallZ = (y, r) => r * Math.sqrt(Math.max(0, 1 - (y / (r * SY)) ** 2));

// every cabin window becomes a real opening in the wall
function withWindowCutouts(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          float k = floor((vObjPos.x - ${WINDOW.x0.toFixed(3)}) / ${WINDOW.pitch.toFixed(3)} + 0.5);
          if (k >= 0.0 && k < ${WINDOW.count.toFixed(1)}) {
            float cx = ${WINDOW.x0.toFixed(3)} + k * ${WINDOW.pitch.toFixed(3)};
            vec2 q = abs(vec2(vObjPos.x - cx, vObjPos.y - ${WINDOW.y.toFixed(3)})) / vec2(${WINDOW.hw.toFixed(3)}, ${WINDOW.hh.toFixed(3)});
            if (pow(q.x, 2.6) + pow(q.y, 2.6) < 1.0) discard;
          }
        }`);
  };
  material.customProgramCacheKey = () => 'cabin-window-cutouts';
  return material;
}

// superellipse outline matching the cut-outs, projected onto a fuselage radius
function windowRing(xc, side, scale, radius, n = 44) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const lx = WINDOW.hw * scale * Math.sign(c) * Math.pow(Math.abs(c), 2 / 2.6);
    const ly = WINDOW.hh * scale * Math.sign(s) * Math.pow(Math.abs(s), 2 / 2.6);
    const y = WINDOW.y + ly;
    pts.push(new THREE.Vector3(xc + lx, y, side * wallZ(y, radius)));
  }
  return pts;
}

// triangle strip between two rings with matching vertex counts
function bridge(pos, a, b) {
  for (let i = 0; i < a.length; i++) {
    const j = (i + 1) % a.length;
    pos.push(...a[i].toArray(), ...b[i].toArray(), ...a[j].toArray());
    pos.push(...a[j].toArray(), ...b[i].toArray(), ...b[j].toArray());
  }
}

function windowTrim() {
  const wells = [], bezels = [];
  for (let k = 0; k < WINDOW.count; k++) {
    const x = WINDOW.x0 + k * WINDOW.pitch;
    for (const side of [1, -1]) {
      bridge(wells, windowRing(x, side, 1.0, R_CABIN), windowRing(x, side, 0.94, R + 0.01));
      bridge(bezels, windowRing(x, side, 1.0, R_CABIN - 0.004), windowRing(x, side, 1.32, R_CABIN - 0.004));
    }
  }
  const toGeo = (arr) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    return g;
  };
  return { wells: toGeo(wells), bezels: toGeo(bezels) };
}

function box(w, h, d, x, y, z, r = 0.03, rotZ = 0) {
  const g = new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * 0.99);
  if (rotZ) g.rotateZ(rotZ);
  g.translate(x, y, z);
  return g;
}

// One seat pod in local space: forward = −X, floor at y = 0, window side = +Z.
function seatParts() {
  const shell = mergeGeometries([
    box(0.1, 1.22, 0.8, 0.5, 0.61, 0.06, 0.05),       // tall back shell
    box(0.95, 0.68, 0.07, 0.05, 0.34, -0.37, 0.03),   // aisle-side wing
    box(0.95, 0.56, 0.26, 0.05, 0.28, 0.43, 0.04),    // console base
    box(0.34, 0.34, 0.44, -0.52, 0.17, 0.06, 0.06),   // ottoman
  ]);
  const leather = mergeGeometries([
    box(0.62, 0.14, 0.56, 0.05, 0.45, 0.04, 0.06),    // cushion
    box(0.14, 0.72, 0.54, 0.36, 0.86, 0.04, 0.06, -0.18), // backrest, reclined
    box(0.55, 0.06, 0.1, 0.1, 0.67, -0.3, 0.025),     // armrest
    box(0.02, 0.34, 0.52, 0.555, 0.95, 0.06, 0.01),   // screen bezel
  ]);
  const head = box(0.13, 0.26, 0.46, 0.45, 1.33, 0.04, 0.06);
  const walnut = box(0.97, 0.035, 0.28, 0.05, 0.575, 0.43, 0.012);
  const screen = new THREE.PlaneGeometry(0.46, 0.29).rotateY(Math.PI / 2).translate(0.567, 0.95, 0.06);
  return { shell, leather, head, walnut, screen };
}

function mirrorZ(geometry) {
  const g = geometry.clone();
  g.scale(1, 1, -1);
  const idx = g.getIndex();
  if (idx) {
    const a = idx.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
  }
  g.computeVertexNormals();
  return g;
}

function emblemTexture(renderer) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#efece6';
  ctx.fillRect(0, 0, S, S);
  drawSunburst(ctx, S / 2, S * 0.56, S * 0.2, '#b9a27a', 13);
  ctx.fillStyle = '#8f7c5a';
  ctx.font = '700 34px Archivo, Arial, sans-serif';
  ctx.textAlign = 'center';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '8px';
  ctx.fillText('OVERTURE', S / 2, S * 0.68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function createCabin(renderer) {
  const root = new THREE.Group();
  root.name = 'cabin';

  // Walls, with every window cut through.
  const wallMat = withWindowCutouts(new THREE.MeshStandardMaterial({
    color: 0xebe8e3, roughness: 0.62, side: THREE.BackSide,
  }));
  const wall = new THREE.Mesh(bodyGeometry(CABIN_X0, CABIN_X1, 80, 128, () => R_CABIN, () => 0), wallMat);
  root.add(wall);

  // Window wells and trim.
  const trim = windowTrim();
  root.add(
    new THREE.Mesh(trim.wells, new THREE.MeshStandardMaterial({ color: 0xd6d2cb, roughness: 0.5, side: THREE.DoubleSide })),
    new THREE.Mesh(trim.bezels, new THREE.MeshStandardMaterial({ color: 0xf6f4ef, roughness: 0.38, side: THREE.DoubleSide })),
  );

  // Floor, aisle lighting and ceiling coves.
  const floorW = 2 * wallZ(FLOOR_Y, R_CABIN) + 0.02;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(CABIN_X1 - CABIN_X0, floorW).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.95 }),
  );
  floor.position.set((CABIN_X0 + CABIN_X1) / 2, FLOOR_Y, 0);
  root.add(floor);

  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.82, 0.62).multiplyScalar(2.2) });
  const stripGeo = new THREE.BoxGeometry(CABIN_X1 - CABIN_X0 - 0.4, 0.012, 0.03);
  for (const z of [0.34, -0.34]) {
    const s = new THREE.Mesh(stripGeo, glow);
    s.position.set((CABIN_X0 + CABIN_X1) / 2, FLOOR_Y + 0.006, z);
    root.add(s);
  }
  const coveGeo = new THREE.BoxGeometry(CABIN_X1 - CABIN_X0 - 0.4, 0.03, 0.05);
  for (const z of [0.86, -0.86]) {
    const s = new THREE.Mesh(coveGeo, glow);
    s.position.set((CABIN_X0 + CABIN_X1) / 2, 1.06, z);
    root.add(s);
  }

  // Bulkheads with the Overture emblem.
  const bulkGeo = new THREE.CircleGeometry(R_CABIN, 64).scale(1, SY, 1);
  const bulkMat = new THREE.MeshStandardMaterial({ color: 0xefece6, roughness: 0.6 });
  const front = new THREE.Mesh(bulkGeo, bulkMat);
  front.position.x = CABIN_X0;
  front.rotation.y = Math.PI / 2;
  const back = new THREE.Mesh(bulkGeo, bulkMat);
  back.position.x = CABIN_X1;
  back.rotation.y = -Math.PI / 2;
  const emblem = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.9),
    new THREE.MeshStandardMaterial({ map: emblemTexture(renderer), roughness: 0.55 }),
  );
  emblem.position.set(CABIN_X1 - 0.01, 0.35, 0);
  emblem.rotation.y = -Math.PI / 2;
  const emblemFront = emblem.clone();
  emblemFront.position.x = CABIN_X0 + 0.01;
  emblemFront.rotation.y = Math.PI / 2;
  root.add(front, back, emblem, emblemFront);

  // Seats: one merged geometry per material, instanced per side.
  const parts = seatParts();
  const mats = {
    shell: new THREE.MeshPhysicalMaterial({ color: 0xf4f3f0, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x4a4b4f, roughness: 0.7 }),
    head: new THREE.MeshStandardMaterial({ color: 0x2c2d31, roughness: 0.8 }),
    walnut: new THREE.MeshStandardMaterial({ color: 0x7a5234, roughness: 0.42 }),
    screen: new THREE.MeshBasicMaterial({ map: screenTexture(renderer), color: new THREE.Color(1.25, 1.25, 1.25) }),
  };
  const m4 = new THREE.Matrix4();
  for (const side of [1, -1]) {
    for (const key of Object.keys(parts)) {
      const geo = side > 0 ? parts[key] : mirrorZ(parts[key]);
      const mesh = new THREE.InstancedMesh(geo, mats[key], ROWS);
      for (let r = 0; r < ROWS; r++) {
        mesh.setMatrixAt(r, m4.makeTranslation(ROW_X0 + r * ROW_PITCH, FLOOR_Y, side * SEAT_Z));
      }
      mesh.frustumCulled = false;
      root.add(mesh);
    }
  }

  // Warm cabin light — only on while we are inside.
  const lights = [-8.5, -3.5, 1.5, 6.5].map((x) => {
    const l = new THREE.PointLight(0xffd9ad, 0, 7.5, 2);
    l.position.set(x, 0.95, 0);
    root.add(l);
    return l;
  });

  root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

  // Anchors for the interactive hotspots (world space: cabin sits at the origin).
  const seatX = (r) => ROW_X0 + r * ROW_PITCH;
  const hotspots = {
    // framed from a right-hand window seat, like Boom's cabin rendering
    window: new THREE.Vector3(WINDOW.x0 + Math.round((-4.3 - WINDOW.x0) / WINDOW.pitch) * WINDOW.pitch, WINDOW.y + 0.12, -(wallZ(WINDOW.y, R_CABIN) - 0.05)),
    screen: new THREE.Vector3(seatX(4) + 0.57, FLOOR_Y + 1.06, -(SEAT_Z + 0.06)),
    seat: new THREE.Vector3(seatX(5) - 0.25, FLOOR_Y + 0.6, -(SEAT_Z + 0.43)),
  };

  function update(s) {
    root.visible = (s.cabin > 0.001 || s.xray > 0.001 || s.glass < 0.999) && s.macro < 0.999;
    for (const l of lights) l.intensity = 2.2 * s.cabin;
  }

  return { root, update, hotspots };
}

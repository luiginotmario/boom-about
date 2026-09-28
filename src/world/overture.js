import * as THREE from 'three';
import {
  NOSE, TAIL, LENGTH, SY, radiusAt, centerYAt, WINDOW, HERO_WINDOW_X,
  ENGINES, NACELLE, WING, piecewise, wingYAt,
} from './shape.js';
import { fuselageLivery, tailLivery } from './livery.js';

// ── geometry builders ───────────────────────────────────────────────────

// Fuselage skin between x0 and x1. u runs along the body, v around it.
export function bodyGeometry(x0, x1, segments, radial, radiusFn = radiusAt, centerFn = centerYAt) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segments; i++) {
    // bunch samples toward the nose tip where curvature is highest
    const s = i / segments;
    const x = x0 + (x1 - x0) * (x0 === NOSE ? 1 - Math.pow(1 - s, 1.6) : s);
    const r = radiusFn(x), yc = centerFn(x);
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      pos.push(x, yc + r * SY * Math.sin(th), r * Math.cos(th));
      uv.push((x - NOSE) / LENGTH, j / radial);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * row + j, b = a + row;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A wing-like surface: span along +Z (or −Z), biconvex section, cosine chord spacing.
function liftingSurface({ z0, z1, le, te, t0, t1, yAt, side = 1, nu = 36, nw = 40 }) {
  const pos = [], uv = [], idx = [];
  const row = nu + 1;
  for (const s of [1, -1]) {
    const base = pos.length / 3;
    for (let iw = 0; iw <= nw; iw++) {
      const w = iw / nw;
      const z = z0 + (z1 - z0) * w;
      const xl = piecewise(le, z), xt = piecewise(te, z);
      const tm = t0 + (t1 - t0) * w;
      for (let iu = 0; iu <= nu; iu++) {
        const u = 0.5 - 0.5 * Math.cos((Math.PI * iu) / nu);
        const half = (tm / 2) * Math.pow(Math.max(0, 1 - (2 * u - 1) ** 2), 0.7);
        pos.push(xl + (xt - xl) * u, yAt(z) + s * half, z * side);
        uv.push(u, w);
      }
    }
    const flip = (s < 0) !== (side < 0);
    for (let iw = 0; iw < nw; iw++) {
      for (let iu = 0; iu < nu; iu++) {
        const a = base + iw * row + iu, b = a + row, c = a + 1, d = b + 1;
        if (flip) idx.push(a, c, b, c, d, b);
        else idx.push(a, b, c, c, b, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function nacelleGeometry() {
  const L = NACELLE.length, R = NACELLE.radius;
  // outer skin forward → aft, then the inner duct back to the lip (closed profile)
  const profile = [
    [R * 0.8, 0], [R * 0.93, 0.35], [R, 1.2], [R, 6.8], [R * 0.86, 8.7], [R * 0.78, L],
    [R * 0.7, L], [R * 0.74, 8.2], [R * 0.76, 1.0], [R * 0.78, 0.15], [R * 0.8, 0],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(profile, 72);
  g.rotateZ(-Math.PI / 2); // lathe axis Y → X, intake forward (−X)
  return g;
}

// Blueprint structure lines: frames and stringers inside a fuselage section.
function structureLines(x0, x1) {
  const pts = [];
  const radial = 64;
  for (let x = Math.ceil(x0 / 0.9) * 0.9; x < x1; x += 0.9) {
    const r = radiusAt(x) * 0.985, yc = centerYAt(x);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2, b = ((j + 1) / radial) * Math.PI * 2;
      pts.push(x, yc + r * SY * Math.sin(a), r * Math.cos(a), x, yc + r * SY * Math.sin(b), r * Math.cos(b));
    }
  }
  const strings = 18, steps = 40;
  for (let k = 0; k < strings; k++) {
    const th = (k / strings) * Math.PI * 2;
    for (let i = 0; i < steps; i++) {
      const xa = x0 + ((x1 - x0) * i) / steps, xb = x0 + ((x1 - x0) * (i + 1)) / steps;
      const ra = radiusAt(xa) * 0.985, rb = radiusAt(xb) * 0.985;
      pts.push(xa, centerYAt(xa) + ra * SY * Math.sin(th), ra * Math.cos(th),
               xb, centerYAt(xb) + rb * SY * Math.sin(th), rb * Math.cos(th));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

function wingStructureLines(side) {
  const pts = [];
  const push = (x, z) => pts.push(x, wingYAt(z), z * side);
  // spars
  for (const u of [0.12, 0.45, 0.8]) {
    for (let z = WING.root; z < WING.tip - 0.2; z += 0.4) {
      const xa = piecewise(WING.le, z) + (piecewise(WING.te, z) - piecewise(WING.le, z)) * u;
      const zb = z + 0.4;
      const xb = piecewise(WING.le, zb) + (piecewise(WING.te, zb) - piecewise(WING.le, zb)) * u;
      push(xa, z); push(xb, zb);
    }
  }
  // ribs
  for (let z = 1.6; z < WING.tip; z += 1.1) {
    push(piecewise(WING.le, z), z);
    push(piecewise(WING.te, z), z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

// ── materials ───────────────────────────────────────────────────────────

function skinMaterial(opts) {
  return new THREE.MeshPhysicalMaterial({
    roughness: 0.3,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.14,
    envMapIntensity: 1.0,
    transparent: true,
    ...opts,
  });
}

// Cabin windows are drawn analytically on the skin (crisp at any distance),
// and the one window the camera flies through is punched out entirely.
function withWindows(material) {
  const f = (v) => v.toFixed(3);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHole = { value: new THREE.Vector3(HERO_WINDOW_X, WINDOW.y, 0) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nuniform vec3 uHole;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        vec2 winSize = vec2(${f(WINDOW.hw)}, ${f(WINDOW.hh)});
        {
          vec2 q = abs(vObjPos.xy - uHole.xy) / winSize;
          if (vObjPos.z > 0.0 && pow(q.x, 2.6) + pow(q.y, 2.6) < 1.0) discard;
        }
        float winMask = 0.0;
        float winRing = 0.0;
        {
          float k = floor((vObjPos.x - ${f(WINDOW.x0)}) / ${f(WINDOW.pitch)} + 0.5);
          if (k >= 0.0 && k < ${WINDOW.count.toFixed(1)}) {
            vec2 q = abs(vec2(vObjPos.x - (${f(WINDOW.x0)} + k * ${f(WINDOW.pitch)}), vObjPos.y - ${f(WINDOW.y)})) / winSize;
            float d = pow(q.x, 2.6) + pow(q.y, 2.6);
            float aa = fwidth(d) * 1.2;
            winMask = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
            winRing = smoothstep(1.0 - aa, 1.0 + aa, d) * (1.0 - smoothstep(1.28 - aa, 1.28 + aa, d));
          }
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb *= 1.0 - 0.1 * winRing;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.018, 0.03), winMask);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.04, winMask);`);
  };
  material.customProgramCacheKey = () => 'overture-skin-windows';
  return material;
}

// ── the aircraft ────────────────────────────────────────────────────────

export function createOverture(renderer) {
  const root = new THREE.Group();
  root.name = 'overture';

  const paint = withWindows(skinMaterial({ map: fuselageLivery(renderer), color: 0xffffff }));
  const white = skinMaterial({ color: 0xeef0f3, roughness: 0.34, clearcoat: 0.6 });
  const fin = skinMaterial({ map: tailLivery(renderer), color: 0xffffff, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.6, transparent: true, side: THREE.DoubleSide });
  const heroNacelle = skinMaterial({ color: 0xeef0f3, roughness: 0.34, clearcoat: 0.6, side: THREE.DoubleSide, clippingPlanes: [] });
  const lines = new THREE.LineBasicMaterial({
    color: 0xfff555, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const skins = [paint, white, fin, dark, heroNacelle];

  const parts = []; // { obj, explode: Vector3 }
  const part = (name, explode) => {
    const g = new THREE.Group();
    g.name = name;
    root.add(g);
    parts.push({ obj: g, explode: new THREE.Vector3(...explode) });
    return g;
  };

  // Fuselage, split at production joints so it can come apart.
  const sections = [
    { name: 'nose', x0: NOSE, x1: -13, seg: 110, explode: [-7, 0.6, 0] },
    { name: 'forward-fuselage', x0: -13, x1: -1, seg: 40, explode: [-2.5, 2.2, 0] },
    { name: 'aft-fuselage', x0: -1, x1: 12, seg: 40, explode: [2.5, 2.2, 0] },
    { name: 'tail-cone', x0: 12, x1: TAIL, seg: 70, explode: [8, 1.2, 0] },
  ];
  const sectionGroups = {};
  for (const s of sections) {
    const g = part(s.name, s.explode);
    const skin = new THREE.Mesh(bodyGeometry(s.x0, s.x1, s.seg, 96), paint);
    skin.renderOrder = 2;
    g.add(skin, new THREE.LineSegments(structureLines(s.x0, s.x1), lines));
    sectionGroups[s.name] = g;
  }

  // Hero window glass — clears as the camera arrives.
  const glassGeo = new THREE.ShapeGeometry(roundedRectShape(WINDOW.hw * 2.02, WINDOW.hh * 2.02, 0.12), 12);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0c1422, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.85, envMapIntensity: 1.6,
    depthWrite: false,
  });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  const zSkin = Math.sqrt(Math.max(0, 1.55 ** 2 - (WINDOW.y / SY) ** 2));
  glass.position.set(HERO_WINDOW_X, WINDOW.y, zSkin + 0.004);
  glass.renderOrder = 3;
  sectionGroups['forward-fuselage'].add(glass);

  // Wings (with their engines) — each side is one part.
  const wingGroups = [];
  for (const side of [1, -1]) {
    const g = part(side > 0 ? 'left-wing' : 'right-wing', [1.5, -2.8, 6 * side]);
    const wing = liftingSurface({
      z0: WING.root, z1: WING.tip, le: WING.le, te: WING.te, t0: 0.62, t1: 0.05, yAt: wingYAt, side,
    });
    g.add(new THREE.Mesh(wing, white), new THREE.LineSegments(wingStructureLines(side), lines));
    wingGroups.push(g);
  }

  // Horizontal stabilisers.
  for (const side of [1, -1]) {
    const g = part(side > 0 ? 'left-stabilizer' : 'right-stabilizer', [9, 0.3, 3.5 * side]);
    const y = centerYAt(28.3) - 0.05;
    const stab = liftingSurface({
      z0: 0.2, z1: 4.6, le: [[0.2, 25.2], [4.6, 29.2]], te: [[0.2, 30.4], [4.6, 30.6]],
      t0: 0.2, t1: 0.03, yAt: () => y, side, nu: 20, nw: 16,
    });
    g.add(new THREE.Mesh(stab, white));
  }

  // Vertical fin (built flat, then stood up: span Z → Y).
  {
    const g = part('fin', [10, 5.5, 0]);
    const finGeo = liftingSurface({
      z0: 0.8, z1: 8.3, le: [[0.8, 19.0], [8.3, 28.7]], te: [[0.8, 30.3], [8.3, 30.95]],
      t0: 0.5, t1: 0.05, yAt: () => 0, nu: 30, nw: 30,
    });
    finGeo.rotateX(-Math.PI / 2);
    g.add(new THREE.Mesh(finGeo, fin));
  }

  // Four Symphony nacelles, hung under the gull wing.
  const nacelleGeo = nacelleGeometry();
  const intakeGeo = new THREE.CircleGeometry(NACELLE.radius * 0.76, 48).rotateY(-Math.PI / 2);
  const pylonGeo = new THREE.BoxGeometry(5.5, 0.5, 0.14);
  let heroEngine = null;
  wingGroups.forEach((wingGroup, wi) => {
    const side = wi === 0 ? 1 : -1;
    for (const [ei, e] of ENGINES.entries()) {
      const holder = new THREE.Group();
      holder.name = `symphony-${side > 0 ? 'L' : 'R'}${ei + 1}`;
      holder.position.set(NACELLE.x0, e.y, e.z * side);
      const isHero = side > 0 && ei === 1; // outboard: nothing between it and the camera
      const shell = new THREE.Mesh(nacelleGeo, isHero ? heroNacelle : white);
      const intake = new THREE.Mesh(intakeGeo, dark);
      intake.position.x = 1.2;
      const pylon = new THREE.Mesh(pylonGeo, white);
      pylon.position.set(5.0, NACELLE.radius + 0.1, 0);
      holder.add(shell, pylon);
      if (!isHero) holder.add(intake);
      else heroEngine = { holder, intake, clipPlanes: null };
      wingGroup.add(holder);
      // engines drop further out of the wing when exploded
      parts.push({ obj: holder, explode: new THREE.Vector3(1.0, -2.2, 0.9 * side * (ei + 1)), base: holder.position.clone() });
    }
  });

  root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 100);
  heroNacelle.clippingPlanes = [clipPlane];
  heroEngine.clipPlanes = heroNacelle.clippingPlanes;
  const tmp = new THREE.Vector3();

  function update(s) {
    for (const p of parts) {
      if (p.base) p.obj.position.copy(p.base).addScaledVector(p.explode, s.explode);
      else p.obj.position.copy(p.explode).multiplyScalar(s.explode);
    }
    root.visible = s.macro < 0.999;
    const solid = (1 - s.xray * 0.82) * (1 - s.macro);
    for (const m of skins) {
      m.opacity = solid;
      m.depthWrite = solid > 0.98;
      m.emissive.setScalar(0.22 * s.xray); // ghosted parts glow faintly against the dark studio
    }
    paint.side = s.xray > 0.01 ? THREE.DoubleSide : THREE.FrontSide;
    lines.opacity = s.xray * 0.6 * (1 - s.macro);
    glassMat.opacity = 0.85 * s.glass;
    glass.visible = s.glass > 0.001;

    // Nacelle cutaway: a plane sweeps in from the camera side to the engine axis.
    heroEngine.holder.getWorldPosition(tmp);
    clipPlane.constant = tmp.z + (1 - s.cutaway) * 1.2 + 0.001;
    heroEngine.intake.visible = s.cutaway < 0.02;
  }

  return { root, update, sectionGroups, heroEngine };
}

export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

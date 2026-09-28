import * as THREE from 'three';
import {
  NOSE, TAIL, LENGTH, SY, radiusAt, halfHeightAt, centerYAt, WINDOW, HERO_WINDOW_X,
  ENGINES, NACELLE, WING, piecewise, wingYAt,
} from './shape.js';
import { fuselageLivery, tailLivery, wingBump, FIN_UV } from './livery.js';

// ── geometry builders ───────────────────────────────────────────────────

// Fuselage skin between x0 and x1. u runs along the body, v around it.
export function bodyGeometry(x0, x1, segments, radial, radiusFn = radiusAt, centerFn = centerYAt, heightFn = halfHeightAt) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segments; i++) {
    // bunch samples toward the nose tip where curvature is highest
    const s = i / segments;
    const x = x0 + (x1 - x0) * (x0 === NOSE ? 1 - Math.pow(1 - s, 1.6) : s);
    const r = radiusFn(x), hh = heightFn(x), yc = centerFn(x);
    for (let j = 0; j <= radial; j++) {
      // start at the belly so the texture seam sits under the aircraft, not across the livery
      const th = (j / radial) * Math.PI * 2 - Math.PI / 2;
      pos.push(x, yc + hh * Math.sin(th), r * Math.cos(th));
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

// Nacelle in two lathes: painted outer cowl, bare-metal duct and nozzle inside.
function lathe(points, segments = 96) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  g.rotateZ(-Math.PI / 2); // lathe axis Y → X, intake forward (−X)
  return g;
}
function nacelleGeometries() {
  const L = NACELLE.length, R = NACELLE.radius;
  const f = (t) => t * L; // profile stations as fractions of the nacelle length
  // long cowl: sharp inlet lip, parallel body, gentle boat-tail to a blunt nozzle
  const cowl = lathe([
    [R * 0.86, 0], [R * 0.92, f(0.006)], [R * 0.97, f(0.03)], [R, f(0.1)], [R, f(0.7)], [R * 0.97, f(0.86)],
    [R * 0.9, f(0.96)], [R * 0.86, L],
  ]);
  const duct = lathe([
    [R * 0.86, 0], [R * 0.82, f(0.03)], [R * 0.8, f(0.12)], [R * 0.79, f(0.8)], [R * 0.8, L],
  ]);
  // supersonic inlet spike: a cone that pokes forward out of the intake
  const spike = new THREE.ConeGeometry(R * 0.5, 2.0, 64).rotateZ(Math.PI / 2).translate(-0.35, 0, 0);
  const spikeBody = new THREE.CylinderGeometry(R * 0.42, R * 0.5, 1.4, 64).rotateZ(-Math.PI / 2).translate(1.35, 0, 0); // widest where it meets the cone
  // exhaust plug, recessed inside the blunt nozzle
  const plugBase = new THREE.ConeGeometry(R * 0.4, 1.4, 48).rotateZ(-Math.PI / 2).translate(L - 0.9, 0, 0);
  return { cowl, duct, spike, spikeBody, plugBase };
}

// Blueprint structure lines: frames and stringers inside a fuselage section.
function structureLines(x0, x1) {
  const pts = [];
  const radial = 64;
  for (let x = Math.ceil(x0 / 0.9) * 0.9; x < x1; x += 0.9) {
    const r = radiusAt(x) * 0.985, hh = halfHeightAt(x) * 0.985, yc = centerYAt(x);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2, b = ((j + 1) / radial) * Math.PI * 2;
      pts.push(x, yc + hh * Math.sin(a), r * Math.cos(a), x, yc + hh * Math.sin(b), r * Math.cos(b));
    }
  }
  const strings = 18, steps = 40;
  for (let k = 0; k < strings; k++) {
    const th = (k / strings) * Math.PI * 2;
    for (let i = 0; i < steps; i++) {
      const xa = x0 + ((x1 - x0) * i) / steps, xb = x0 + ((x1 - x0) * (i + 1)) / steps;
      const ra = radiusAt(xa) * 0.985, rb = radiusAt(xb) * 0.985;
      const ha = halfHeightAt(xa) * 0.985, hb = halfHeightAt(xb) * 0.985;
      pts.push(xa, centerYAt(xa) + ha * Math.sin(th), ra * Math.cos(th),
               xb, centerYAt(xb) + hb * Math.sin(th), rb * Math.cos(th));
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

// Aerospace topcoat: satin base under a hard clearcoat.
function skinMaterial(opts) {
  return new THREE.MeshPhysicalMaterial({
    roughness: 0.32,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.07,
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

  const livery = fuselageLivery(renderer);
  const paint = withWindows(skinMaterial({
    map: livery.map, roughnessMap: livery.roughnessMap, roughness: 1, bumpMap: livery.bumpMap, bumpScale: 3,
  }));
  const PAINT_WHITE = 0xe3e6ea; // real white topcoat, not an albedo of 1.0
  const white = skinMaterial({
    color: PAINT_WHITE, roughness: 0.4, clearcoatRoughness: 0.14, bumpMap: wingBump(renderer), bumpScale: 3, side: THREE.DoubleSide,
  });
  const cowlMat = skinMaterial({ color: PAINT_WHITE, roughness: 0.3 });
  const fin = skinMaterial({ map: tailLivery(renderer), roughness: 0.28, side: THREE.DoubleSide });
  const metal = new THREE.MeshStandardMaterial({ color: 0x5b5f66, metalness: 1, roughness: 0.34, transparent: true, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.6, transparent: true, side: THREE.DoubleSide });
  const heroNacelle = skinMaterial({ color: PAINT_WHITE, roughness: 0.3, side: THREE.DoubleSide, clippingPlanes: [] });
  const heroDuct = new THREE.MeshStandardMaterial({ color: 0x5b5f66, metalness: 1, roughness: 0.34, transparent: true, side: THREE.DoubleSide, clippingPlanes: [] });
  const lines = new THREE.LineBasicMaterial({
    color: 0xfff555, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const skins = [paint, white, cowlMat, fin, metal, dark, heroNacelle, heroDuct];

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
    const skin = new THREE.Mesh(bodyGeometry(s.x0, s.x1, s.seg, 160), paint);
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
  const rHero = radiusAt(HERO_WINDOW_X);
  const zSkin = Math.sqrt(Math.max(0, rHero ** 2 - (WINDOW.y / SY) ** 2));
  glass.position.set(HERO_WINDOW_X, WINDOW.y, zSkin + 0.004);
  glass.renderOrder = 3;
  sectionGroups['forward-fuselage'].add(glass);

  // Wings (with their engines) — each side is one part.
  const wingGroups = [];
  for (const side of [1, -1]) {
    const g = part(side > 0 ? 'left-wing' : 'right-wing', [1.5, -2.8, 6 * side]);
    const wing = liftingSurface({
      z0: WING.root, z1: WING.tip, le: WING.le, te: WING.te, t0: WING.t0, t1: WING.t1, yAt: wingYAt, side, nu: 56, nw: 96,
    });
    g.add(new THREE.Mesh(wing, white), new THREE.LineSegments(wingStructureLines(side), lines));
    wingGroups.push(g);
  }

  // Horizontal stabilisers.
  for (const side of [1, -1]) {
    const g = part(side > 0 ? 'left-stabilizer' : 'right-stabilizer', [9, 0.3, 3.5 * side]);
    // mid-set on the tail cone, swept, running aft to the tail tip, with a little dihedral
    const y = centerYAt(27.5);
    const stab = liftingSurface({
      z0: 0.2, z1: 5.6, le: [[0.2, 23.8], [5.6, 28.4]], te: [[0.2, 30.3], [5.6, 30.4]],
      t0: 0.26, t1: 0.03, yAt: (z) => y + 0.06 * z, side, nu: 32, nw: 32,
    });
    g.add(new THREE.Mesh(stab, white));
  }

  // Vertical fin (built flat, then stood up: span Z → Y).
  {
    const g = part('fin', [10, 5.5, 0]);
    // shark-fin profile: a long shallow dorsal fillet that steepens (concave leading edge),
    // a short flat tip, and a near-vertical trailing edge ending ahead of the tail blade
    const finGeo = liftingSurface({
      z0: 0.3, z1: 4.3,
      le: [[0.3, 16.8], [1.05, 20.6], [1.85, 23.2], [2.75, 24.9], [3.55, 25.8], [4.3, 26.15]],
      te: [[0.3, 28.3], [4.3, 27.95]],
      t0: 0.5, t1: 0.06, yAt: () => 0, nu: 40, nw: 48,
    });
    finGeo.rotateX(-Math.PI / 2);
    // Isotropic UVs in metres (u aft, v up) so the livery mark isn't stretched by the taper.
    const fp = finGeo.attributes.position, fuv = finGeo.attributes.uv;
    for (let i = 0; i < fp.count; i++) fuv.setXY(i, (fp.getX(i) - FIN_UV.x0) / FIN_UV.size, (fp.getY(i) - FIN_UV.y0) / FIN_UV.size);
    g.add(new THREE.Mesh(finGeo, fin));
  }

  // Four Symphony nacelles, hung under the gull wing.
  const nac = nacelleGeometries();
  const intakeGeo = new THREE.CircleGeometry(NACELLE.radius * 0.8, 64).rotateY(-Math.PI / 2);
  const pylonGeo = new THREE.BoxGeometry(NACELLE.length * 0.7, 0.24, 0.18);
  let heroEngine = null;
  wingGroups.forEach((wingGroup, wi) => {
    const side = wi === 0 ? 1 : -1;
    for (const [ei, e] of ENGINES.entries()) {
      const holder = new THREE.Group();
      holder.name = `symphony-${side > 0 ? 'L' : 'R'}${ei + 1}`;
      holder.position.set(e.x0, e.y, e.z * side);
      const isHero = side > 0 && ei === 1; // outboard: nothing between it and the camera
      const shell = new THREE.Mesh(nac.cowl, isHero ? heroNacelle : cowlMat);
      const duct = new THREE.Mesh(nac.duct, isHero ? heroDuct : metal);
      const spike = new THREE.Mesh(nac.spike, metal);
      const spikeBody = new THREE.Mesh(nac.spikeBody, metal);
      const plug = new THREE.Mesh(nac.plugBase, metal);
      const intake = new THREE.Mesh(intakeGeo, dark);
      intake.position.x = 1.0;
      const pylon = new THREE.Mesh(pylonGeo, cowlMat);
      pylon.position.set(NACELLE.length * 0.5, NACELLE.radius + 0.08, 0);
      holder.add(shell, duct, spike, spikeBody, plug, pylon);
      if (!isHero) holder.add(intake);
      else heroEngine = { holder, intake, clipPlanes: null };
      wingGroup.add(holder);
      // engines drop further out of the wing when exploded
      parts.push({ obj: holder, explode: new THREE.Vector3(1.0, -2.2, 0.9 * side * (ei + 1)), base: holder.position.clone() });
    }
  });

  // Blade antennas on the crown and belly — small, but they sell the scale.
  const bladeGeo = new THREE.BoxGeometry(0.34, 0.2, 0.025).translate(0, 0.1, 0);
  bladeGeo.attributes.position.array.forEach((v, i, arr) => {
    if (i % 3 === 0 && arr[i + 1] > 0.1) arr[i] = v + 0.12; // sweep the top edge back
  });
  for (const [x, up] of [[-17.5, 1], [-6, 1], [3.5, 1], [-9, -1]]) {
    const blade = new THREE.Mesh(bladeGeo, metal);
    blade.position.set(x, centerYAt(x) + up * (halfHeightAt(x) - 0.01), 0);
    if (up < 0) blade.rotation.z = Math.PI;
    const section = x < -13 ? 'nose' : x < -1 ? 'forward-fuselage' : 'aft-fuselage';
    sectionGroups[section].add(blade);
  }

  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    o.castShadow = true;
    o.receiveShadow = true;
  });
  glass.castShadow = glass.receiveShadow = false;

  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 100);
  heroNacelle.clippingPlanes = [clipPlane];
  heroDuct.clippingPlanes = heroNacelle.clippingPlanes;
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

  return { root, update, sectionGroups, heroEngine, heroGlass: glass };
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

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  NOSE, TAIL, LENGTH, SY, radiusAt, halfHeightAt, centerYAt, WINDOW, HERO_WINDOW_X,
  ENGINES, NACELLE, WING, piecewise, wingYAt,
} from './shape.js';
import { fuselageLivery, tailLivery, wingBump } from './livery.js';

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

// ── the Blender airframe ────────────────────────────────────────────────
// models/overture.glb is built by blender/build_overture.py from the same mould lines as
// shape.js, in page coordinates, left-side parts only. UV0 follows the page's conventions
// (glTF stores V flipped, so it's flipped back here); UV1 carries the baked ambient occlusion.
const MODEL_URL = new URL('../../models/overture.glb', import.meta.url).href;
const AO_URL = (name) => new URL(`../../models/ao/${name}.png`, import.meta.url).href;

async function loadAirframe() {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const geos = {};
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const uv = g.attributes.uv;
    if (uv) for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    geos[o.name] = g;
  });
  return geos;
}

async function loadAO(names) {
  const loader = new THREE.TextureLoader();
  const out = {};
  await Promise.all(names.map(async (n) => {
    try {
      const t = await loader.loadAsync(AO_URL(n));
      t.flipY = false;               // glTF UV convention
      t.channel = 1;                 // UV1: the lightmap unwrap
      t.colorSpace = THREE.NoColorSpace;
      out[n] = t;
    } catch { /* not baked yet: render without it */ }
  }));
  return out;
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

export async function createOverture(renderer) {
  const [geo, ao] = await Promise.all([
    loadAirframe(),
    loadAO(['fuselage', 'wing', 'elevons', 'fairing', 'stabilizer', 'fin', 'nacelle', 'pylon']),
  ]);
  const root = new THREE.Group();
  root.name = 'overture';
  const withAO = (m, key) => {
    if (ao[key]) { m.aoMap = ao[key]; m.aoMapIntensity = 1; }
    return m;
  };

  const livery = fuselageLivery(renderer);
  const paint = withAO(withWindows(skinMaterial({
    map: livery.map, roughnessMap: livery.roughnessMap, roughness: 1, bumpMap: livery.bumpMap, bumpScale: 3,
  })), 'fuselage');
  const PAINT_WHITE = 0xe3e6ea; // real white topcoat, not an albedo of 1.0
  const panels = wingBump(renderer);
  const whiteSkin = (key) => withAO(skinMaterial({
    color: PAINT_WHITE, roughness: 0.4, clearcoatRoughness: 0.14, bumpMap: panels, bumpScale: 3,
  }), key);
  const wingMat = whiteSkin('wing');
  const elevonMat = whiteSkin('elevons');
  const fairingMat = withAO(skinMaterial({ color: PAINT_WHITE, roughness: 0.4, clearcoatRoughness: 0.14 }), 'fairing');
  const stabMat = whiteSkin('stabilizer');
  const cowlMat = withAO(skinMaterial({ color: PAINT_WHITE, roughness: 0.3 }), 'nacelle');
  const pylonMat = withAO(skinMaterial({ color: PAINT_WHITE, roughness: 0.34 }), 'pylon');
  const fin = withAO(skinMaterial({ map: tailLivery(renderer), roughness: 0.28 }), 'fin');
  const metal = new THREE.MeshStandardMaterial({ color: 0x5b5f66, metalness: 1, roughness: 0.34, transparent: true, side: THREE.DoubleSide });
  const ductMat = withAO(new THREE.MeshStandardMaterial({ color: 0x5b5f66, metalness: 1, roughness: 0.34, transparent: true, side: THREE.DoubleSide }), 'nacelle');
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.6, transparent: true, side: THREE.DoubleSide });
  const wickMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5, transparent: true });
  const heroNacelle = withAO(skinMaterial({ color: PAINT_WHITE, roughness: 0.3, side: THREE.DoubleSide, clippingPlanes: [], clipShadows: true }), 'nacelle');
  const heroDuct = withAO(new THREE.MeshStandardMaterial({ color: 0x5b5f66, metalness: 1, roughness: 0.34, transparent: true, side: THREE.DoubleSide, clippingPlanes: [], clipShadows: true }), 'nacelle');
  const lines = new THREE.LineBasicMaterial({
    color: 0xfff555, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const skins = [paint, wingMat, elevonMat, fairingMat, stabMat, cowlMat, pylonMat, fin, metal, ductMat, dark, wickMat, heroNacelle, heroDuct];
  const paintInner = withWindows(skinMaterial({
    map: livery.map, roughnessMap: livery.roughnessMap, roughness: 1, side: THREE.BackSide, depthWrite: false,
  }));
  const innerSkins = [];
  // position and anti-collision lights: lit lenses, faded with the skin in the x-ray view
  const lamp = (color, intensity) => new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.2, transparent: true,
  });
  const lamps = [lamp(0xff2a1a, 2.2), lamp(0x2aff6a, 2.2), lamp(0xff2a1a, 1.6), lamp(0xffffff, 1.4)];
  const [navRed, navGreen, beaconMat, tailMat] = lamps;

  const mesh = (name, material) => new THREE.Mesh(geo[name], material);
  // right-side copy of a left-side part: mirrored across the centre plane
  const mirrored = (...objs) => {
    const g = new THREE.Group();
    g.scale.z = -1;
    g.add(...objs);
    return g;
  };

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
    { name: 'nose', x0: NOSE, x1: -13, explode: [-7, 0.6, 0] },
    { name: 'forward-fuselage', x0: -13, x1: -1, explode: [-2.5, 2.2, 0] },
    { name: 'aft-fuselage', x0: -1, x1: 12, explode: [2.5, 2.2, 0] },
    { name: 'tail-cone', x0: 12, x1: TAIL, explode: [8, 1.2, 0] },
  ];
  const sectionGroups = {};
  for (const s of sections) {
    const g = part(s.name, s.explode);
    const skin = new THREE.Mesh(geo[s.name], paint);
    skin.renderOrder = 2;
    // inner faces, only for the x-ray view: a separate layer that fades in with it
    const inner = new THREE.Mesh(geo[s.name], paintInner);
    inner.renderOrder = 1;
    inner.visible = false;
    innerSkins.push(inner);
    g.add(inner);
    g.add(skin, new THREE.LineSegments(structureLines(s.x0, s.x1), lines));
    sectionGroups[s.name] = g;
  }
  // pitot probes and AoA vane on both sides of the nose; beacons on crown and belly; tail light
  sectionGroups.nose.add(mesh('probes', metal), mirrored(mesh('probes', metal)));
  sectionGroups['forward-fuselage'].add(mesh('beacons', beaconMat));
  sectionGroups['tail-cone'].add(mesh('taillight', tailMat));

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

  // Wings, with their elevons, wing-root fairing, nav light and static wicks — each side is one part.
  const wingGroups = [];
  for (const side of [1, -1]) {
    const g = part(side > 0 ? 'left-wing' : 'right-wing', [1.5, -2.8, 6 * side]);
    const pieces = [
      mesh('wing', wingMat), mesh('elevons', elevonMat), mesh('fairing', fairingMat),
      mesh('navlight', side > 0 ? navRed : navGreen), mesh('wicks', wickMat),
    ];
    g.add(side > 0 ? new THREE.Group().add(...pieces) : mirrored(...pieces));
    g.add(new THREE.LineSegments(wingStructureLines(side), lines));
    wingGroups.push(g);
  }

  // Horizontal stabilisers: mid-set on the tail cone, swept, running aft to the tail tip.
  for (const side of [1, -1]) {
    const g = part(side > 0 ? 'left-stabilizer' : 'right-stabilizer', [9, 0.3, 3.5 * side]);
    const stab = mesh('stabilizer', stabMat);
    g.add(side > 0 ? stab : mirrored(stab));
  }

  // Vertical fin and rudder (shark-fin profile; isotropic livery UVs in metres).
  {
    const g = part('fin', [10, 5.5, 0]);
    g.add(mesh('fin', fin), mesh('rudder', fin));
  }

  // Four Symphony nacelles, hung under the gull wing on aerofoil pylons.
  const intakeGeo = new THREE.CircleGeometry(NACELLE.radius * 0.8, 64).rotateY(-Math.PI / 2);
  let heroEngine = null;
  wingGroups.forEach((wingGroup, wi) => {
    const side = wi === 0 ? 1 : -1;
    for (const [ei, e] of ENGINES.entries()) {
      const holder = new THREE.Group();
      holder.name = `symphony-${side > 0 ? 'L' : 'R'}${ei + 1}`;
      holder.position.set(e.x0, e.y, e.z * side);
      const isHero = side > 0 && ei === 1; // outboard: nothing between it and the camera
      const shell = mesh('cowl', isHero ? heroNacelle : cowlMat);
      const duct = mesh('duct', isHero ? heroDuct : ductMat);
      const nozzle = mesh('nozzle', isHero ? heroNacelle : cowlMat);
      const spike = mesh('spike', metal);
      const plug = mesh('plug', metal);
      const intake = new THREE.Mesh(intakeGeo, dark);
      intake.position.x = 1.0;
      const pylon = mesh(`pylon${ei + 1}`, pylonMat);
      holder.add(shell, duct, nozzle, spike, plug, pylon);
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
    // inner faces fade in only once the skin is already translucent — never a one-frame pop
    const innerOpacity = solid * THREE.MathUtils.smoothstep(s.xray, 0.35, 0.9);
    paintInner.opacity = innerOpacity;
    paintInner.emissive.setScalar(0.22 * s.xray);
    for (const m of innerSkins) m.visible = innerOpacity > 0.002;
    for (const m of lamps) m.opacity = solid;
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

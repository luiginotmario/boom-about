import * as THREE from 'three';
import { NOSE, TAIL, centerYAt } from './shape.js';

// Mach cone: half-angle μ = asin(1 / M). Driven live by the Mach number.
// Boomless Cruise: shock rays that refract back upward before reaching the ground.

const coneVertex = /* glsl */ `
  varying float vAxial;
  varying float vRim;
  void main() {
    vAxial = position.x;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vRim = clamp(1.0 - abs(dot(n, normalize(-mv.xyz))), 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const coneFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying float vAxial;
  varying float vRim;
  void main() {
    float fade = pow(clamp(1.0 - vAxial, 0.0, 1.0), 1.4) * smoothstep(0.0, 0.02, vAxial); // clamp: pow(<0) is NaN
    float rings = 0.55 + 0.45 * sin(vAxial * 60.0 - uTime * 7.0);
    float a = uOpacity * fade * (0.18 + 0.82 * vRim * vRim) * rings;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

function coneGeometry() {
  // unit cone, apex at origin, opening toward +X, length 1, radius 1
  const g = new THREE.ConeGeometry(1, 1, 128, 48, true);
  g.translate(0, -0.5, 0);
  g.rotateZ(Math.PI / 2);
  return g;
}

function coneMaterial(color) {
  return new THREE.ShaderMaterial({
    vertexShader: coneVertex,
    fragmentShader: coneFragment,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

const vaporFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uOpacity;
  varying float vAxial;
  varying float vRim;
  varying vec3 vPos;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    float n = noise(vPos * 3.0 + vec3(uTime * 4.0, 0.0, 0.0)) * 0.6 + noise(vPos * 9.0 - vec3(uTime * 6.0, 0.0, 0.0)) * 0.4;
    float edge = smoothstep(0.0, 0.15, vAxial) * (1.0 - smoothstep(0.35, 1.0, vAxial));
    float a = uOpacity * edge * smoothstep(0.35, 0.75, n) * (0.4 + 0.6 * vRim);
    gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * a, a);
  }
`;

const rayVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const rayFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float head = fract(vUv.x * 1.5 - uTime * 0.35);
    float pulse = smoothstep(0.6, 1.0, head) * 1.8 + 0.55;
    float a = uOpacity * pulse * (1.0 - vUv.x * 0.55) * smoothstep(0.0, 0.03, vUv.x);
    gl_FragColor = vec4(vec3(1.0, 0.96, 0.33) * a, a);
  }
`;

const groundFragment = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    vec2 g = abs(fract(vUv * 40.0) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.03, min(g.x, g.y));
    float fade = 1.0 - smoothstep(0.15, 0.5, length(vUv - 0.5));
    float a = uOpacity * fade * (0.08 + line * 0.35);
    gl_FragColor = vec4(vec3(0.55, 0.7, 1.0) * a, a);
  }
`;

export function createShock() {
  const root = new THREE.Group();
  root.name = 'shock';

  const bowMat = coneMaterial(0xcfe3ff);
  const bow = new THREE.Mesh(coneGeometry(), bowMat);
  bow.position.set(NOSE, centerYAt(NOSE), 0);
  const tailMat = coneMaterial(0x9fc0ff);
  const tail = new THREE.Mesh(coneGeometry(), tailMat);
  tail.position.set(TAIL, centerYAt(TAIL), 0);

  const vaporMat = new THREE.ShaderMaterial({
    vertexShader: coneVertex.replace('varying float vRim;', 'varying float vRim;\nvarying vec3 vPos;').replace('vAxial = position.x;', 'vAxial = position.x;\nvPos = position * vec3(1.0, 2.0, 2.0);'),
    fragmentShader: vaporFragment,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const vapor = new THREE.Mesh(coneGeometry(), vaporMat);
  vapor.position.set(-3, -0.4, 0);
  vapor.scale.set(16, 12, 12);

  // Mach-cutoff rays, fanned out below the aircraft.
  const rayMat = new THREE.ShaderMaterial({
    vertexShader: rayVertex, fragmentShader: rayFragment,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const rays = new THREE.Group();
  const fan = 9;
  for (let i = 0; i < fan; i++) {
    const k = i / (fan - 1);
    const phi = (k - 0.5) * 1.3;
    const start = new THREE.Vector3(-18 + k * 30, -1.2, 0);
    const pts = [];
    for (let s = 0; s <= 130; s += 5) {
      const depth = -s + (s * s) / 150;          // down, turns at s = 75, back up
      pts.push(new THREE.Vector3(start.x + s * 0.75, start.y + depth * Math.cos(phi), start.z + s * 0.9 * Math.sin(phi)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    rays.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 140, 0.26, 8, false), rayMat));
  }

  const groundMat = new THREE.ShaderMaterial({
    vertexShader: rayVertex, fragmentShader: groundFragment,
    uniforms: { uOpacity: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), groundMat);
  ground.position.set(20, -46, 0);

  root.add(bow, tail, vapor, rays, ground);
  root.traverse((o) => { o.frustumCulled = false; });

  function update(s, time, mach) {
    const supersonic = THREE.MathUtils.smoothstep(mach, 1.0, 1.06);
    const mu = Math.asin(1 / Math.max(mach, 1.0001));
    const L = 90;
    const r = L * Math.tan(mu);
    bow.scale.set(L, r, r);
    tail.scale.set(L * 0.8, r * 0.8, r * 0.8);
    bowMat.uniforms.uOpacity.value = s.shock * supersonic * 0.9;
    tailMat.uniforms.uOpacity.value = s.shock * supersonic * 0.45;
    bowMat.uniforms.uTime.value = tailMat.uniforms.uTime.value = time;

    const transonic = Math.exp(-(((mach - 1.0) / 0.05) ** 2));
    vaporMat.uniforms.uOpacity.value = s.shock > 0 ? transonic * 0.9 : 0;
    vaporMat.uniforms.uTime.value = time;

    rayMat.uniforms.uOpacity.value = s.rays;
    rayMat.uniforms.uTime.value = time;
    groundMat.uniforms.uOpacity.value = s.rays;

    bow.visible = tail.visible = s.shock > 0.001;
    vapor.visible = vaporMat.uniforms.uOpacity.value > 0.002;
    rays.visible = ground.visible = s.rays > 0.001;
  }

  return { root, update };
}

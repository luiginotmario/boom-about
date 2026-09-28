import * as THREE from 'three';

// One shader, no textures: a ray-traced spherical Earth with a cloud deck
// 15 km below the aircraft. The horizon dips and bends exactly as it would
// from 60,000 ft because it is an actual ray–sphere intersection.

export const SUN = new THREE.Vector3(-0.55, 0.32, 0.77).normalize();

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDir = wp.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * wp;
    gl_Position.z = gl_Position.w; // pin to the far plane
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uDim;
  uniform vec3 uSun;
  varying vec3 vDir;

  const float R = 6371.0;     // km
  const float H = 18.3;       // aircraft altitude, km (60,000 ft)
  const float DECK = 3.0;     // cloud tops, km

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 6; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
    return v;
  }
  vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

  void main() {
    vec3 d = normalize(vDir);

    vec3 zenith  = toLinear(vec3(0.03, 0.1, 0.3));
    vec3 upper   = toLinear(vec3(0.1, 0.34, 0.72));
    vec3 horizon = toLinear(vec3(0.78, 0.87, 0.98));

    float h = clamp(d.y + 0.08, 0.0, 1.0);
    vec3 col = mix(horizon, upper, smoothstep(0.0, 0.13, h));
    col = mix(col, zenith, smoothstep(0.13, 0.9, h));

    // Earth: ray from (0, R+H, 0) against a sphere of radius R+DECK at the origin.
    float b = (R + H) * d.y;
    float c = (H - DECK) * (2.0 * R + H + DECK);
    float disc = b * b - c;
    if (disc > 0.0) {
      float t = -b - sqrt(disc);
      if (t > 0.0) {
        vec2 p = vec2(d.x, d.z) * t;
        p.x += uTime * uSpeed;
        float cover  = fbm(p * 0.045 + 7.3);
        float detail = fbm(p * 0.32);
        float cloud = smoothstep(0.44, 0.64, cover * 0.78 + detail * 0.34);
        float lit = detail - fbm(p * 0.32 + uSun.xz * 0.55);
        float shade = clamp(0.66 + lit * 3.2, 0.3, 1.08);
        vec3 ocean = toLinear(vec3(0.03, 0.09, 0.2));
        vec3 cloudCol = mix(toLinear(vec3(0.46, 0.55, 0.72)), toLinear(vec3(0.97, 0.97, 0.96)), shade);
        vec3 ground = mix(ocean, cloudCol, cloud);
        float haze = 1.0 - exp(-pow(t * 0.0026, 1.5));
        vec3 hazeCol = toLinear(vec3(0.7, 0.79, 0.92));
        col = mix(ground, hazeCol, clamp(haze, 0.0, 1.0));
      }
    }

    // thin bright limb right at the horizon
    float dip = -0.0757;
    col += toLinear(vec3(0.9, 0.95, 1.0)) * exp(-abs(d.y - dip) * 70.0) * 0.35;

    // sun
    float s = max(dot(d, uSun), 0.0);
    col += vec3(1.0, 0.94, 0.84) * (pow(s, 3000.0) * 60.0 + pow(s, 60.0) * 0.5 + pow(s, 8.0) * 0.08);

    col = mix(col, toLinear(vec3(0.01, 0.012, 0.02)), uDim);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSky() {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: 0.55 }, // km/s ≈ Mach 1.7 at altitude
      uDim: { value: 0 },
      uSun: { value: SUN },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), material);
  mesh.name = 'sky';
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return mesh;
}

// Bake the sky into a PMREM so the aircraft reflects the actual sky it flies in.
export function bakeEnvironment(renderer) {
  const scene = new THREE.Scene();
  const sky = createSky();
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0, 0.1, 2000).texture;
  pmrem.dispose();
  sky.geometry.dispose();
  sky.material.dispose();
  return env;
}

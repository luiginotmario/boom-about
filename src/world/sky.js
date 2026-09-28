import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// One shader, no textures: a ray-traced spherical Earth with a cloud deck
// 15 km below the aircraft. The horizon dips and bends exactly as it would
// from 60,000 ft because it is an actual ray–sphere intersection.

// Sun azimuth is a design choice (it rakes across the camera-facing side); its elevation
// is taken from the HDRI once loaded so the light, shadows and reflections agree.
const SUN_AZIMUTH = Math.atan2(0.77, -0.55);
export const SUN = new THREE.Vector3(-0.55, 0.32, 0.77).normalize();

export function setSunElevation(elevation) {
  SUN.set(Math.cos(SUN_AZIMUTH) * Math.cos(elevation), Math.sin(elevation), Math.sin(SUN_AZIMUTH) * Math.cos(elevation));
}

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
  #ifdef USE_HDRI
    uniform sampler2D uHdri;
    uniform float uHdriRot;
    uniform float uHdriGain;
    // equirectangular lookup, rotated about Y so the photographed sun lines up with ours
    vec3 hdri(vec3 d) {
      float c = cos(uHdriRot), s = sin(uHdriRot);
      vec3 r = vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
      vec2 uv = vec2(atan(r.z, r.x) * 0.1591549 + 0.5, asin(clamp(r.y, -1.0, 1.0)) * 0.3183099 + 0.5);
      // clamp the sun out of the capture: the directional light owns it (and its shadows)
      return min(texture2D(uHdri, uv).rgb * uHdriGain, vec3(8.0));
    }
  #endif

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

    // deep altitude blue overhead, pale at the limb
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
        col = mix(ground, toLinear(vec3(0.7, 0.79, 0.92)), clamp(haze, 0.0, 1.0));
      }
    }

    // thin bright limb right at the horizon
    col += toLinear(vec3(0.9, 0.95, 1.0)) * exp(-abs(d.y + 0.0757) * 70.0) * 0.35;

    #ifndef USE_HDRI
      float s = max(dot(d, uSun), 0.0);
      col += vec3(1.0, 0.94, 0.84) * (pow(s, 3000.0) * 60.0 + pow(s, 60.0) * 0.5 + pow(s, 8.0) * 0.08);
    #endif

    #ifdef USE_HDRI
      // environment bake: the photographed sky above the horizon, our cloud deck below —
      // the deck toned down so the sun, not the bounce, models the airframe
      col = mix(col * 0.55, hdri(d), smoothstep(-0.07, 0.02, d.y));
    #endif

    col = min(col, vec3(60.0));
    col = mix(col, toLinear(vec3(0.01, 0.012, 0.02)), uDim);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSky(hdri = null) {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    defines: hdri ? { USE_HDRI: '' } : {},
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: 0.55 }, // km/s ≈ Mach 1.7 at altitude
      uDim: { value: 0 },
      uSun: { value: SUN },
      uHdri: { value: hdri?.texture ?? null },
      uHdriRot: { value: hdri?.rotation ?? 0 },
      uHdriGain: { value: hdri?.gain ?? 1 },
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

// Load a Poly Haven sky HDRI and find its sun, so it can be rotated into our sun's azimuth.
export async function loadSkyHdri(url) {
  const loader = new RGBELoader().setDataType(THREE.HalfFloatType); // half floats filter linearly everywhere
  const texture = await loader.loadAsync(url);
  const { data, width, height } = texture.image;
  let best = 0, bi = 0, bj = 0, sum = 0, n = 0;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const k = (j * width + i) * 4;
      const half = THREE.DataUtils.fromHalfFloat;
      const l = 0.2126 * half(data[k]) + 0.7152 * half(data[k + 1]) + 0.0722 * half(data[k + 2]);
      if (l > best) { best = l; bi = i; bj = j; }
      // average sky radiance of the upper hemisphere, sun excluded
      if (j < height / 2 && l < 50) { sum += l; n++; }
    }
  }
  // rows run top → bottom; three samples with v = asin(y)/π + 0.5 after flipY
  const u = (bi + 0.5) / width, v = 1 - (bj + 0.5) / height;
  const sunAzimuth = (u - 0.5) * Math.PI * 2;
  const sunElevation = (v - 0.5) * Math.PI;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return {
    texture,
    sunElevation,
    rotation: sunAzimuth - SUN_AZIMUTH,
    gain: 0.42 / Math.max(1e-4, sum / Math.max(1, n)), // match the brightness of our altitude sky
  };
}

// Bake the environment into a PMREM so the aircraft reflects the sky it flies in.
export function bakeEnvironment(renderer, hdri = null) {
  const scene = new THREE.Scene();
  const sky = createSky(hdri);
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0, 0.1, 2000).texture;
  pmrem.dispose();
  sky.geometry.dispose();
  sky.material.dispose();
  return env;
}

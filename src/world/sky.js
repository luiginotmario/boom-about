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

  // ── Preetham daylight (after three's Sky.js), tuned for thin air at altitude ──
  uniform float uRayleigh;
  uniform float uTurbidity;
  uniform float uSkyGain;
  const float PI = 3.141592653589793;
  const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
  const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);

  vec3 atmosphere(vec3 d, bool withSun) {
    float sunE = 1000.0 * max(0.0, 1.0 - exp(-((1.6110731556870734 - acos(clamp(uSun.y, -1.0, 1.0))) / 1.5)));
    vec3 betaR = totalRayleigh * uRayleigh;
    vec3 betaM = 0.434 * (0.2 * uTurbidity * 10E-18) * MieConst * 0.004;
    float zenith = acos(max(0.0, d.y));
    float inv = 1.0 / (cos(zenith) + 0.15 * pow(93.885 - zenith * 180.0 / PI, -1.253));
    vec3 Fex = exp(-(betaR * 8.4E3 * inv + betaM * 1.25E3 * inv));
    float cosT = dot(d, uSun);
    float rPhase = 0.05968310365946075 * (1.0 + pow(cosT * 0.5 + 0.5, 2.0));
    float g = 0.8, g2 = g * g;
    float mPhase = 0.07957747154594767 * (1.0 - g2) / pow(1.0 - 2.0 * g * cosT + g2, 1.5);
    vec3 scatter = (betaR * rPhase + betaM * mPhase) / (betaR + betaM);
    vec3 Lin = pow(sunE * scatter * (1.0 - Fex), vec3(1.5));
    Lin *= mix(vec3(1.0), pow(sunE * scatter * Fex, vec3(0.5)), clamp(pow(1.0 - uSun.y, 5.0), 0.0, 1.0));
    vec3 L0 = vec3(0.1) * Fex;
    if (withSun) L0 += sunE * 19000.0 * Fex * smoothstep(0.99995, 0.99997, cosT);
    vec3 c = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);
    return pow(c, vec3(1.0 / 2.4)) * uSkyGain;
  }

  // Cloud-top density and lighting. Relief comes from the density gradient.
  float density(vec2 p) {
    return fbm(p * 0.045 + 7.3) * 0.78 + fbm(p * 0.32) * 0.34;
  }

  void main() {
    vec3 d = normalize(vDir);
    vec3 col = atmosphere(d, true);

    // Earth: ray from (0, R+H, 0) against a sphere of radius R+DECK at the origin.
    float b = (R + H) * d.y;
    float c = (H - DECK) * (2.0 * R + H + DECK);
    float disc = b * b - c;
    if (disc > 0.0) {
      float t = -b - sqrt(disc);
      if (t > 0.0) {
        vec2 p = vec2(d.x, d.z) * t;
        p.x += uTime * uSpeed;
        float dn = density(p);
        float cloud = smoothstep(0.44, 0.64, dn);
        // detail fades with distance so the far deck doesn't shimmer
        float e = 0.25 + t * 0.002;
        vec2 grad = vec2(density(p + vec2(e, 0.0)) - dn, density(p + vec2(0.0, e)) - dn) / e;
        vec3 n = normalize(vec3(-grad.x * 2.2, 1.0, -grad.y * 2.2));
        float lambert = max(dot(n, uSun), 0.0);
        vec3 lit = vec3(1.0, 0.97, 0.93) * (0.25 + 0.95 * lambert);
        vec3 shade = toLinear(vec3(0.5, 0.58, 0.72)) * 0.8;
        vec3 cloudCol = mix(shade, lit, smoothstep(0.0, 0.9, lambert + cloud * 0.25));
        vec3 ocean = toLinear(vec3(0.02, 0.07, 0.16));
        vec3 surface = mix(ocean, cloudCol, cloud);
        // aerial perspective toward the horizon colour of this azimuth
        vec3 hazeCol = atmosphere(normalize(vec3(d.x, 0.0, d.z)), false);
        float haze = 1.0 - exp(-pow(t * 0.0028, 1.4));
        col = mix(surface, hazeCol, clamp(haze, 0.0, 1.0));
      }
    }

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
      uRayleigh: { value: 0.6 },    // thin air at 60,000 ft: fewer molecules, deeper blue
      uTurbidity: { value: 1.6 },
      uSkyGain: { value: 0.55 },
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

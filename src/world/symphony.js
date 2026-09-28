import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Symphony: a medium-bypass turbofan, no afterburner, in the nacelle's local frame
// (intake at x = 0, axis +X). Shown only during the cutaway. The hardware — twisted fan and
// compressor blades, stator rows, flanged core casing, annular combustor — is modelled in
// Blender (blender/build_symphony.py) with ambient occlusion baked into its vertex colours.
const MODEL_URL = new URL('../../models/symphony.glb', import.meta.url).href;

const flowVertex = /* glsl */ `
  precision highp float;
  attribute vec3 seed;          // phase, lane (0 bypass / 1 core), angle
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;

  float coreRadius(float x) {
    if (x < 1.4) return mix(0.32, 0.3, x / 1.4);
    if (x < 3.5) return mix(0.3, 0.23, (x - 1.4) / 2.1);
    if (x < 4.4) return 0.24;
    if (x < 5.6) return mix(0.24, 0.33, (x - 4.4) / 1.2);
    return mix(0.33, 0.3, clamp((x - 5.6) / 3.0, 0.0, 1.0));
  }

  void main() {
    float core = seed.y;
    float speed = core > 0.5 ? 0.16 : 0.22;
    float t = fract(seed.x + uTime * speed);
    float x = t * 9.4 - 0.1;
    float jitter = fract(seed.x * 91.7);
    float r = core > 0.5 ? coreRadius(x) + (jitter - 0.5) * 0.07
                         : mix(0.46, 0.6, jitter) - smoothstep(6.5, 9.3, x) * 0.1;
    float ang = seed.z + x * (core > 0.5 ? 0.7 : 0.25);
    vec3 pos = vec3(x, cos(ang) * r, sin(ang) * r);

    vec3 cold = vec3(0.55, 0.75, 1.0);
    vec3 hot = vec3(1.0, 0.5, 0.16) * 2.2;
    float heat = core > 0.5 ? smoothstep(3.6, 4.1, x) * (1.0 - smoothstep(5.8, 8.8, x) * 0.6) : 0.0;
    vColor = mix(cold, hot, heat);
    vAlpha = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.9, 1.0, t));

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (core > 0.5 ? 34.0 : 26.0) * uPixelRatio / -mv.z;
  }
`;

const flowFragment = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * a, a * vAlpha * uOpacity);
  }
`;

function airflow(count = 2600) {
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    seeds[i * 3] = Math.random();
    seeds[i * 3 + 1] = i % 3 === 0 ? 1 : 0; // one third core, two thirds bypass
    seeds[i * 3 + 2] = Math.random() * Math.PI * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
  const material = new THREE.ShaderMaterial({
    vertexShader: flowVertex,
    fragmentShader: flowFragment,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(g, material);
  points.frustumCulled = false;
  return points;
}

export async function createSymphony(clipPlanes) {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const part = (name) => gltf.scene.getObjectByName(name);
  const root = new THREE.Group();
  root.name = 'symphony-internals';

  const metal = (color, roughness, extra = {}) => new THREE.MeshStandardMaterial({
    color, metalness: 0.85, roughness, vertexColors: true, ...extra,
  });
  const titanium = metal(0xd2d5da, 0.28);
  const steel = metal(0xb4b9c2, 0.34);
  const hotMetal = metal(0x9a7a5c, 0.4);
  const casing = metal(0x9aa1ab, 0.42, { metalness: 0.7, side: THREE.DoubleSide, clippingPlanes: clipPlanes, clipShadows: true });
  const flame = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.45, 0.12).multiplyScalar(3.2), vertexColors: true, side: THREE.DoubleSide });
  const mesh = (name, material) => {
    const m = new THREE.Mesh(part(name).geometry, material);
    m.name = name;
    return m;
  };

  // LP spool: spinner and fan, booster, low-pressure turbine, shaft
  const lp = new THREE.Group();
  lp.add(mesh('fan', titanium), mesh('booster', steel), mesh('lpt', hotMetal), mesh('shaft', steel));
  // HP spool: six-stage compressor on its drum, one-stage turbine
  const hp = new THREE.Group();
  hp.add(mesh('hpc', steel), mesh('hpt', hotMetal));
  // Static: stator and guide-vane rows, turbine nozzle vanes, core casing (cut away with the
  // nacelle), combustor liners (lit), dome with fuel-nozzle swirl cups, exhaust centre body
  const core = mesh('casing', casing);
  const combustor = mesh('combustor', flame);
  root.add(lp, hp, mesh('stators', steel), mesh('ngv', hotMetal), core, combustor, mesh('dome', hotMetal), mesh('centerbody', steel));

  const flow = airflow();
  root.add(flow);

  const anchors = {
    fan: new THREE.Vector3(1.08, 0.62, 0.1),
    compressor: new THREE.Vector3(2.8, 0.38, 0.1),
    combustor: new THREE.Vector3(3.95, 0.34, 0.1),
    turbine: new THREE.Vector3(5.1, 0.42, 0.1),
    nozzle: new THREE.Vector3(8.7, 0.62, 0.1),
  };

  function update(s, dt, time, reduced) {
    root.visible = s.cutaway > 0.001;
    if (!root.visible) return;
    const spin = reduced ? 0.15 : 1;
    lp.rotation.x += dt * 2.6 * spin;
    hp.rotation.x += dt * 4.4 * spin;
    flow.material.uniforms.uTime.value = time * (reduced ? 0.2 : 1);
    flow.material.uniforms.uOpacity.value = s.cutaway;
    const flicker = reduced ? 1 : 0.9 + 0.1 * Math.sin(time * 23.0) * Math.sin(time * 7.3);
    flame.color.setRGB(1.0, 0.45, 0.12).multiplyScalar(3.2 * flicker * s.cutaway);
  }

  return { root, update, anchors };
}

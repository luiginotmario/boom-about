import * as THREE from 'three';

// Symphony: a medium-bypass turbofan, no afterburner. Built in the nacelle's
// local frame (intake at x = 0, axis +X). Shown only during the cutaway.

function bladeGeometry(chord, span, hub, twist, thick = 0.018) {
  const g = new THREE.BoxGeometry(chord, span, thick, 2, 6, 1);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = (v.y / span + 0.5);                // 0 at root, 1 at tip
    const a = 0.55 + twist * k;                  // stagger + twist
    const x = v.x * Math.cos(a) - v.z * Math.sin(a);
    const z = v.x * Math.sin(a) + v.z * Math.cos(a);
    p.setXYZ(i, x, v.y + hub + span / 2, z);
  }
  g.computeVertexNormals();
  return g;
}

function stage({ x, count, hub, tip, chord, twist, material }) {
  const geo = bladeGeometry(chord, tip - hub, hub, twist);
  const mesh = new THREE.InstancedMesh(geo, material, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    m.makeRotationX((i / count) * Math.PI * 2);
    m.setPosition(x, 0, 0);
    mesh.setMatrixAt(i, m);
  }
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(hub, hub, chord * 0.9, 40).rotateZ(Math.PI / 2).translate(x, 0, 0),
    material,
  );
  const g = new THREE.Group();
  g.add(mesh, disc);
  return g;
}

function along(geo) {
  return geo.rotateZ(-Math.PI / 2); // cylinder/cone axis Y → X
}

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

export function createSymphony(clipPlanes) {
  const root = new THREE.Group();
  root.name = 'symphony-internals';

  const titanium = new THREE.MeshStandardMaterial({ color: 0xd2d5da, metalness: 0.85, roughness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb4b9c2, metalness: 0.9, roughness: 0.34 });
  const hotMetal = new THREE.MeshStandardMaterial({ color: 0x9a7a5c, metalness: 0.8, roughness: 0.38 });
  const casing = new THREE.MeshStandardMaterial({
    color: 0x9aa1ab, metalness: 0.7, roughness: 0.42, side: THREE.DoubleSide, clippingPlanes: clipPlanes,
  });
  const flame = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.45, 0.12).multiplyScalar(3.2) });

  // LP spool: fan, booster, low-pressure turbine
  const lp = new THREE.Group();
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 40).rotateZ(Math.PI / 2).translate(0.95, 0, 0), titanium);
  lp.add(
    spinner,
    stage({ x: 1.08, count: 20, hub: 0.16, tip: 0.6, chord: 0.2, twist: 0.8, material: titanium }),
    stage({ x: 1.6, count: 30, hub: 0.2, tip: 0.4, chord: 0.1, twist: 0.4, material: steel }),
    stage({ x: 1.85, count: 30, hub: 0.2, tip: 0.39, chord: 0.1, twist: 0.4, material: steel }),
    stage({ x: 4.85, count: 44, hub: 0.2, tip: 0.36, chord: 0.1, twist: -0.3, material: hotMetal }),
    stage({ x: 5.15, count: 46, hub: 0.2, tip: 0.39, chord: 0.1, twist: -0.3, material: hotMetal }),
    stage({ x: 5.45, count: 48, hub: 0.2, tip: 0.42, chord: 0.1, twist: -0.3, material: hotMetal }),
    new THREE.Mesh(along(new THREE.CylinderGeometry(0.05, 0.05, 5.0, 16)).translate(3.4, 0, 0), steel),
  );

  // HP spool: compressor and high-pressure turbine
  const hp = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const k = i / 5;
    hp.add(stage({
      x: 2.2 + i * 0.24, count: 36 + i * 2, hub: 0.2 - k * 0.03, tip: 0.36 - k * 0.11, chord: 0.08, twist: 0.3, material: steel,
    }));
  }
  hp.add(stage({ x: 4.45, count: 42, hub: 0.19, tip: 0.31, chord: 0.09, twist: -0.4, material: hotMetal }));

  // Static parts: core casing (cut away with the nacelle), combustor, exhaust plug
  const core = new THREE.Mesh(along(new THREE.CylinderGeometry(0.4, 0.44, 4.4, 64, 1, true)).translate(3.55, 0, 0), casing);
  const combustor = new THREE.Mesh(along(new THREE.CylinderGeometry(0.31, 0.3, 0.7, 48, 1, true)).translate(3.95, 0, 0), flame);
  const liner = new THREE.Mesh(along(new THREE.CylinderGeometry(0.18, 0.18, 0.7, 48, 1, true)).translate(3.95, 0, 0), flame);
  const plug = new THREE.Mesh(new THREE.ConeGeometry(0.21, 1.8, 40).rotateZ(-Math.PI / 2).translate(6.55, 0, 0), steel);

  const flow = airflow();
  root.add(lp, hp, core, combustor, liner, plug, flow);

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

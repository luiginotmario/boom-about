import * as THREE from 'three';

// A powers-of-ten dive inside the nose: composite skin plies peel away to reveal
// the flight computer, then the processor's lid lifts off its die.
// Rig centre in world space (the nose is pulled forward during the exploded view).
export const RIG = new THREE.Vector3(-24, 0.58, 0); // nose centreline, exploded position
export const PLY_R = 1.415;                         // nose skin radius here
export const BOARD_Z = 0.3;
export const DIE_Z = BOARD_Z + 0.0032;

function fiberTexture(angle, weave) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0c0e';
  ctx.fillRect(0, 0, S, S);
  if (weave) {
    // 2×2 twill: bundles alternate direction in a stepped diagonal
    const n = 16, cell = S / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const horiz = ((i + Math.floor(j / 2) * 2 + j) >> 1) % 2 === 0;
        const g = horiz
          ? ctx.createLinearGradient(0, j * cell, 0, (j + 1) * cell)
          : ctx.createLinearGradient(i * cell, 0, (i + 1) * cell, 0);
        g.addColorStop(0, '#15171b');
        g.addColorStop(0.5, '#3a3f47');
        g.addColorStop(1, '#15171b');
        ctx.fillStyle = g;
        ctx.fillRect(i * cell + 1, j * cell + 1, cell - 2, cell - 2);
      }
    }
  } else {
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(angle);
    for (let y = -S; y < S; y += 3) {
      const l = 22 + Math.random() * 30;
      ctx.strokeStyle = `rgb(${l},${l + 3},${l + 8})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-S, y); ctx.lineTo(S, y + (Math.random() - 0.5) * 2); ctx.stroke();
    }
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function boardTexture() {
  const W = 1024, H = 684;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0c1712';
  ctx.fillRect(0, 0, W, H);
  // Manhattan-routed traces converging on the processor
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const side = i % 4;
    let x = side === 0 ? 0 : side === 1 ? W : rnd() * W;
    let y = side === 2 ? 0 : side === 3 ? H : rnd() * H;
    const tx = W / 2 + (rnd() - 0.5) * 110, ty = H / 2 + (rnd() - 0.5) * 110;
    ctx.strokeStyle = `rgba(196,160,84,${0.35 + rnd() * 0.4})`;
    ctx.lineWidth = rnd() < 0.2 ? 3 : 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      if ((k + i) % 2) x += (tx - x) * (0.4 + rnd() * 0.5); else y += (ty - y) * (0.4 + rnd() * 0.5);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(tx, y); ctx.lineTo(tx, ty);
    ctx.stroke();
  }
  // vias
  ctx.fillStyle = 'rgba(210,175,100,0.8)';
  for (let i = 0; i < 400; i++) { ctx.beginPath(); ctx.arc(rnd() * W, rnd() * H, 2.2, 0, Math.PI * 2); ctx.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const dieVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vView;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vNormal = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;

const dieFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uLit;
  varying vec2 vUv;
  varying vec3 vView;
  varying vec3 vNormal;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float box(vec2 p, vec2 a, vec2 b) {
    vec2 s = step(a, p) * step(p, b);
    return s.x * s.y;
  }

  void main() {
    vec2 uv = vUv;
    float fres = 1.0 - clamp(dot(normalize(vView), normalize(vNormal)), 0.0, 1.0);
    // thin-film interference: the rainbow sheen of polished silicon
    vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + fres * 1.6 + uv.x * 0.6 - uv.y * 0.4));
    vec3 col = vec3(0.004, 0.005, 0.008) + film * 0.012;

    // 4×4 compute cores separated by streets
    vec2 g = uv * 4.0;
    vec2 cell = floor(g);
    vec2 f = fract(g);
    float street = 1.0 - box(f, vec2(0.06), vec2(0.94));
    float h = hash(cell);

    // standard-cell rows with irregular cell breaks
    float row = floor(f.y * 140.0);
    float rowStripe = step(0.35, fract(f.y * 140.0));
    float cellBreak = step(0.18, fract(f.x * (40.0 + hash(vec2(row, cell.x)) * 60.0)));
    vec3 logic = mix(vec3(0.006, 0.007, 0.01), vec3(0.03, 0.033, 0.045), rowStripe * cellBreak);
    // power rails
    float rail = 1.0 - smoothstep(0.0, 0.035, abs(fract(f.y * 12.0) - 0.5));
    logic = mix(logic, vec3(0.07, 0.068, 0.06), rail * 0.8);

    // SRAM arrays: very fine grid, strongest iridescence
    float cache = box(f, vec2(0.1, 0.56), vec2(0.46, 0.9)) + box(f, vec2(0.54, 0.56), vec2(0.9, 0.9));
    vec2 cg = fract(f * vec2(320.0, 220.0));
    float bit = step(0.45, cg.x) * step(0.45, cg.y);
    vec3 sram = mix(vec3(0.008, 0.008, 0.014), vec3(0.04, 0.04, 0.06), bit) + film * 0.05;

    vec3 core = mix(logic + film * 0.015, sram, cache);
    col = mix(core, col, street);

    // interconnect: data pulses running down the streets
    float lanes = street * max(1.0 - abs(f.x) * 30.0, 1.0 - abs(f.y) * 30.0);
    float pulseX = smoothstep(0.82, 1.0, fract(uv.x * 2.0 - uTime * 0.35 + cell.y * 0.37));
    float pulseY = smoothstep(0.82, 1.0, fract(uv.y * 2.0 - uTime * 0.28 + cell.x * 0.29));
    float glow = clamp(lanes, 0.0, 1.0) * max(pulseX, pulseY);
    // some cores are busy and glow faintly
    float busy = step(0.5, h) * (0.5 + 0.5 * sin(uTime * 1.6 + h * 12.0));
    vec3 yellow = vec3(1.0, 0.94, 0.3);
    col += yellow * (glow * 2.6 + (1.0 - street) * (1.0 - cache) * rowStripe * busy * 0.035) * uLit;

    // die edge seal ring
    float edge = 1.0 - box(uv, vec2(0.012), vec2(0.988));
    col = mix(col, vec3(0.06, 0.06, 0.07), edge);

    gl_FragColor = vec4(col, 1.0);
  }
`;

// A curved patch of the nose skin (around the fuselage axis, facing +Z).
function plyGeometry(radius) {
  const g = new THREE.CylinderGeometry(radius, radius, 1.2, 48, 1, true, -0.38, 0.76);
  g.rotateZ(Math.PI / 2); // cylinder axis Y → X; the arc stays centred on +Z
  return g;
}

export function createSiliconRig(env) {
  const root = new THREE.Group();
  root.name = 'silicon-rig';
  root.position.copy(RIG);

  // Composite plies: woven outer ply, then unidirectional plies at 0/45/90/−45.
  const angles = [null, 0, Math.PI / 4, Math.PI / 2, -Math.PI / 4];
  const plies = angles.map((a, i) => {
    const m = new THREE.MeshPhysicalMaterial({
      map: fiberTexture(a ?? 0, a === null),
      roughness: 0.42, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.22,
      envMap: env, envMapIntensity: 0.45,
      transparent: true, side: THREE.DoubleSide,
    });
    m.map.repeat.set(2.4, 2.4);
    const mesh = new THREE.Mesh(plyGeometry(PLY_R - i * 0.016), m);
    mesh.userData.sign = i % 2 ? 1 : -1;
    root.add(mesh);
    return mesh;
  });

  // a soft key light that travels with the dive
  const key = new THREE.PointLight(0xfff1dc, 0, 4, 2);
  key.position.set(0.6, 0.9, 2.2);
  root.add(key);

  // Flight computer board
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.24, 0.0024),
    [
      ...Array(4).fill(new THREE.MeshStandardMaterial({ color: 0x0c1712, roughness: 0.6 })),
      new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.4, metalness: 0.35, envMap: env }),
      new THREE.MeshStandardMaterial({ color: 0x0c1712, roughness: 0.6 }),
    ],
  );
  board.position.z = BOARD_Z - 0.0012;
  root.add(board);

  const pkgMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5 });
  const pkg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.0026), pkgMat);
  pkg.position.z = BOARD_Z + 0.0013;
  root.add(pkg);

  // memory + passives
  const mem = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.012, 0.0016), pkgMat, 4);
  const m4 = new THREE.Matrix4();
  [[-0.055, 0.03], [-0.055, -0.03], [0.055, 0.03], [0.055, -0.03]].forEach(([x, y], i) => {
    mem.setMatrixAt(i, m4.makeTranslation(x, y, BOARD_Z + 0.0008));
  });
  root.add(mem);
  const caps = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.004, 0.002, 0.0015),
    new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 0.4, metalness: 0.5, envMap: env }),
    220,
  );
  for (let i = 0; i < 220; i++) {
    let x, y;
    do { x = (Math.random() - 0.5) * 0.34; y = (Math.random() - 0.5) * 0.22; } while (Math.abs(x) < 0.03 && Math.abs(y) < 0.03);
    m4.makeRotationZ(Math.random() < 0.5 ? 0 : Math.PI / 2).setPosition(x, y, BOARD_Z + 0.00075);
    caps.setMatrixAt(i, m4);
  }
  root.add(caps);

  // the die itself
  const dieMat = new THREE.ShaderMaterial({
    vertexShader: dieVertex,
    fragmentShader: dieFragment,
    uniforms: { uTime: { value: 0 }, uLit: { value: 0 } },
  });
  const die = new THREE.Mesh(new THREE.PlaneGeometry(0.014, 0.014), dieMat);
  die.position.z = DIE_Z - 0.00055;
  root.add(die);

  // the heat spreader lid that lifts away
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.03, 0.0011),
    new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 1.0, roughness: 0.22, envMap: env }),
  );
  lid.position.z = DIE_Z + 0.0002;
  root.add(lid);

  root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

  function update(s, time) {
    root.visible = s.dim > 0.001;
    if (!root.visible) return;
    // plies peel off the skin one by one, sliding around the fuselage
    plies.forEach((mesh, i) => {
      const t = THREE.MathUtils.smoothstep(s.plies, i * 0.14, i * 0.14 + 0.32);
      mesh.rotation.x = mesh.userData.sign * t * 1.1;
      mesh.position.x = mesh.userData.sign * t * 0.9;
      mesh.material.opacity = 1 - t * t;
      mesh.visible = t < 0.999;
    });
    key.intensity = 3.5 * s.macro;
    // the heat spreader slides off sideways, out of frame
    const lift = s.die;
    lid.position.set(lift * 0.06, lift * 0.012, DIE_Z + 0.0002 + Math.sin(lift * Math.PI) * 0.002);
    lid.rotation.z = lift * 0.35;
    lid.visible = lift < 0.999;
    dieMat.uniforms.uTime.value = time;
    dieMat.uniforms.uLit.value = lift;
  }

  return { root, update, dieCenter: new THREE.Vector3(RIG.x, RIG.y, DIE_Z) };
}

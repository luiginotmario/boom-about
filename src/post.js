import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// HDR target (MSAA) → ambient occlusion → bloom → tone mapping → vignette + grain.
export function createComposer(renderer, scene, camera, { mobile, aoHidden = [] }) {
  const w = window.innerWidth, h = window.innerHeight;
  const target = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    samples: mobile ? 0 : 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);

  composer.addPass(new RenderPass(scene, camera));

  // Ground-truth AO grounds the wing root, pylons and tail junctions. Half resolution,
  // Poisson-denoised; desktop only. Transparent effects are hidden from its geometry pass.
  let ao = null;
  let aoRadius = 0;
  if (!mobile) {
    ao = new GTAOPass(scene, camera, w, h);
    ao.output = GTAOPass.OUTPUT.Default;
    ao.blendIntensity = 1.0;
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
    const setAoSize = ao.setSize.bind(ao);
    ao.setSize = (width, height) => setAoSize(Math.round(width / 2), Math.round(height / 2));
    const renderAo = ao.render.bind(ao);
    ao.render = (...args) => {
      const was = aoHidden.map((o) => o.visible);
      aoHidden.forEach((o) => { o.visible = false; });
      renderAo(...args);
      aoHidden.forEach((o, i) => { o.visible = was[i]; });
    };
    composer.addPass(ao);
  }

  // Only genuinely bright things bloom: the sun, glints, emissives. Never the white paint.
  const bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.28, 0.5, 1.4);
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  const finish = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uGrain: { value: mobile ? 0.03 : 0.045 },
      uVignette: { value: 0.35 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform float uGrain;
      uniform float uVignette;
      varying vec2 vUv;
      float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float v = smoothstep(0.95, 0.3, length(vUv - 0.5));
        c.rgb *= mix(1.0 - uVignette, 1.0, v);
        c.rgb += (rand(vUv * 1.7 + fract(uTime)) - 0.5) * uGrain;
        gl_FragColor = c;
      }
    `,
  });
  composer.addPass(finish);

  return {
    composer,
    bloom,
    setTime(t) { finish.uniforms.uTime.value = t; },
    // AO fades rather than switching (weight 0…1); radius is in metres: wide for the airframe, tight for the cabin
    setAO(weight, radius) {
      if (!ao) return;
      ao.enabled = weight > 0.001;
      ao.blendIntensity = weight;
      if (ao.enabled && Math.abs(radius - aoRadius) > 0.05) {
        aoRadius = radius;
        ao.updateGtaoMaterial({ radius, distanceExponent: 1, thickness: radius * 1.2, scale: 1.5, samples: 16 });
      }
    },
    setSize(width, height) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    },
  };
}

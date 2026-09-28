import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// HDR target (with MSAA on capable GPUs) → bloom → ACES output → vignette + grain.
export function createComposer(renderer, scene, camera, { mobile }) {
  const w = window.innerWidth, h = window.innerHeight;
  const target = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    samples: mobile ? 0 : 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.35, 0.55, 0.9);
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
    setSize(width, height) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    },
  };
}

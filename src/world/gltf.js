import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// One glTF loader for the Blender-built models, which are Draco-compressed.
// The decoder comes from the same pinned three release as the rest of the page.
const draco = new DRACOLoader().setDecoderPath('https://unpkg.com/three@0.170.0/examples/jsm/libs/draco/gltf/');
export const gltfLoader = new GLTFLoader().setDRACOLoader(draco);

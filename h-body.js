import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";

const MODEL_URL = "./Man%20by%20Quaternius%20-%20HMnuH5geEG.glb";

let templatePromise = null;

function loadTemplate() {
  if (!templatePromise) {
    const loader = new GLTFLoader();
    templatePromise = new Promise((resolve, reject) => {
      loader.load(MODEL_URL, resolve, undefined, reject);
    });
  }
  return templatePromise;
}

export function createHumanoidPlaceholder(options = {}) {
  const group = new THREE.Group();
  group.userData.phase = Math.random() * Math.PI * 2;
  group.userData.isGLBHumanoid = true;
  group.userData.loading = true;
  loadTemplate().then((gltf) => {
    const model = gltf.scene.clone(true);
    const scale = options.scale ?? 1;
    model.scale.setScalar(scale);
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    group.add(model);
    group.userData.animations = gltf.animations;
    group.userData.animationClips = gltf.animations;
    group.userData.loading = false;
  }).catch((error) => {
    console.error("Failed to load humanoid GLB:", error);
    group.userData.loading = false;
  });
  return group;
}

export function preloadHumanModel() {
  return loadTemplate();
}

export function getHumanAnimations() {
  return loadTemplate().then((gltf) => gltf.animations);
}

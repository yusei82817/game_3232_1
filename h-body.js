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

function cloneModel(gltf, options = {}) {
  const group = new THREE.Group();
  const model = gltf.scene.clone(true);

  model.scale.setScalar(options.scale ?? 1);
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });

  group.add(model);
  group.userData.phase = Math.random() * Math.PI * 2;
  group.userData.isGLBHumanoid = true;
  group.userData.animations = gltf.animations ?? [];
  group.userData.animationClips = gltf.animations ?? [];
  group.userData.mixer = group.userData.animations.length
    ? new THREE.AnimationMixer(model)
    : null;
  group.userData.activeAction = null;
  group.userData.activeAnimationName = null;
  group.userData.disposed = false;

  return group;
}

export async function createHumanBody(options = {}) {
  const gltf = await loadTemplate();
  return cloneModel(gltf, options);
}

export function preloadHumanModel() {
  return loadTemplate();
}

export function getHumanAnimations() {
  return loadTemplate().then((gltf) => gltf.animations ?? []);
}

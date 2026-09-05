import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";

const MODEL_URL = "./Man%20by%20Quaternius%20-%20HMnuH5geEG.glb";

let templatePromise = null;

function loadTemplate() {
  if (!templatePromise) {
    const loader = new GLTFLoader();
    templatePromise = new Promise((resolve, reject) => {
      loader.load(
        MODEL_URL,
        (gltf) => resolve(gltf),
        undefined,
        (error) => reject(error)
      );
    });
  }
  return templatePromise;
}

function setupModel(model, options) {
  const scale = options.scale ?? 1;
  model.scale.setScalar(scale);
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);

  model.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      if (object.material) {
        object.material = object.material.clone();
      }
    }
  });

  model.userData.phase = Math.random() * Math.PI * 2;
  model.userData.animations = options.animations ?? [];
  model.userData.animationClips = options.animationClips ?? [];
  model.userData.isGLBHumanoid = true;
  return model;
}

export async function createHumanBody(options = {}) {
  const gltf = await loadTemplate();
  const model = gltf.scene.clone(true);
  return setupModel(model, {
    ...options,
    animations: gltf.animations,
    animationClips: gltf.animations
  });
}

export function getHumanAnimations() {
  return templatePromise?.then((gltf) => gltf.animations) ?? loadTemplate().then((gltf) => gltf.animations);
}

export function preloadHumanModel() {
  return loadTemplate();
}

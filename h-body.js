import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/utils/SkeletonUtils.js";

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

export async function createHumanBody(options = {}) {
  const gltf = await loadTemplate();
  const model = cloneSkeleton(gltf.scene);

  model.scale.setScalar(options.scale ?? 1);
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);

  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });

  model.userData.phase = Math.random() * Math.PI * 2;
  model.userData.isGLBHumanoid = true;
  model.userData.animations = gltf.animations ?? [];
  model.userData.animationClips = gltf.animations ?? [];
  model.userData.mixer = model.userData.animationClips.length
    ? new THREE.AnimationMixer(model)
    : null;
  model.userData.activeAction = null;
  model.userData.activeAnimationName = null;

  console.info("Humanoid GLB ready:", model.userData.animationClips.map((clip) => clip.name));
  return model;
}

export function preloadHumanModel() {
  return loadTemplate();
}

export function getHumanAnimations() {
  return loadTemplate().then((gltf) => gltf.animations ?? []);
}

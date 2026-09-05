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

  // 重要: プレイヤーが操作するTransformと、GLBの骨格Transformを分離する。
  // AnimationMixerがGLB内部のノードを動かしても、プレイヤーの位置・回転は影響を受けない。
  const root = new THREE.Group();
  const model = cloneSkeleton(gltf.scene);

  model.scale.setScalar(options.scale ?? 1);
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);

  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });

  root.add(model);
  root.userData.phase = Math.random() * Math.PI * 2;
  root.userData.isGLBHumanoid = true;
  root.userData.glbModel = model;
  root.userData.animations = gltf.animations ?? [];
  root.userData.animationClips = gltf.animations ?? [];
  root.userData.mixer = root.userData.animationClips.length
    ? new THREE.AnimationMixer(model)
    : null;
  root.userData.activeAction = null;
  root.userData.activeAnimationName = null;
  root.userData.loading = false;

  console.info(
    "Humanoid GLB ready:",
    MODEL_URL,
    "animations:",
    root.userData.animationClips.map((clip) => clip.name)
  );

  return root;
}

export function preloadHumanModel() {
  return loadTemplate();
}

export function getHumanAnimations() {
  return loadTemplate().then((gltf) => gltf.animations ?? []);
}

/*
 * WASTELAND // FISH SYSTEM
 *
 * Fish by Quaternius のGLBを使った空中遊泳システムです。
 *
 * 魚は地面・水面の物理に縛らず、独立した遊泳空間を泳ぎます。
 * SkeletonUtils.clone() を使うため、複数の魚を生成してもスケルトンを共有しません。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/utils/SkeletonUtils.js";

const MODEL_URL = "./Fish%20by%20Quaternius%20-%20XWl86YFtpF.glb";
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

function findClip(clips, keywords) {
  for (const keyword of keywords) {
    const found = clips.find((clip) => (clip.name ?? "").toLowerCase().includes(keyword));
    if (found) return found;
  }
  return clips[0] ?? null;
}

function dampAngle(current, target, smoothing, dt) {
  const delta = THREE.MathUtils.euclideanModulo(target - current + Math.PI, Math.PI * 2) - Math.PI;
  return current + delta * (1 - Math.exp(-smoothing * dt));
}

function createFishModel(gltf, scale) {
  const model = cloneSkeleton(gltf.scene);
  model.scale.setScalar(scale);
  model.rotation.set(0, 0, 0);
  model.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  const clips = gltf.animations ?? [];
  const mixer = clips.length ? new THREE.AnimationMixer(model) : null;
  const swimClip = findClip(clips, ["swim", "swimming", "idle"]);
  let action = null;

  if (mixer && swimClip) {
    action = mixer.clipAction(swimClip);
    action.play();
  }

  model.userData.mixer = mixer;
  model.userData.action = action;
  return model;
}

export async function createFishManager({ scene, getPlayerPosition = () => ({ x: 0, y: 0, z: 0 }), config = {} }) {
  const gltf = await loadTemplate();
  const fish = [];
  const count = config.fishCount ?? 12;
  const radius = config.fishSpawnRadius ?? 24;
  const minHeight = config.fishMinHeight ?? 3.5;
  const maxHeight = config.fishMaxHeight ?? 10.0;
  const speedMin = config.fishSpeedMin ?? 0.8;
  const speedMax = config.fishSpeedMax ?? 1.8;
  const random = Math.random;

  function spawnOne() {
    const player = getPlayerPosition() ?? { x: 0, y: 0, z: 0 };
    const angle = random() * Math.PI * 2;
    const distance = 6 + Math.sqrt(random()) * Math.max(1, radius - 6);
    const position = new THREE.Vector3(
      player.x + Math.cos(angle) * distance,
      player.y + minHeight + random() * (maxHeight - minHeight),
      player.z + Math.sin(angle) * distance
    );

    const model = createFishModel(gltf, 0.55 + random() * 0.35);
    model.position.copy(position);
    scene.add(model);

    const fishState = {
      model,
      velocity: new THREE.Vector3(),
      target: new THREE.Vector3(),
      speed: speedMin + random() * (speedMax - speedMin),
      turnRate: 0.8 + random() * 1.4,
      phase: random() * Math.PI * 2,
      wanderTimer: 0,
      bobAmplitude: 0.08 + random() * 0.16,
      bobSpeed: 0.8 + random() * 1.1
    };

    chooseTarget(fishState, player);
    fish.push(fishState);
    return fishState;
  }

  function chooseTarget(state, player) {
    const angle = random() * Math.PI * 2;
    const distance = 5 + random() * Math.max(2, radius - 5);
    const vertical = minHeight + random() * (maxHeight - minHeight);
    state.target.set(
      player.x + Math.cos(angle) * distance,
      player.y + vertical,
      player.z + Math.sin(angle) * distance
    );
    state.wanderTimer = 3 + random() * 5;
  }

  function updateOne(state, dt) {
    const player = getPlayerPosition() ?? { x: 0, y: 0, z: 0 };
    const position = state.model.position;
    const toTarget = new THREE.Vector3().subVectors(state.target, position);
    const distance = toTarget.length();

    state.wanderTimer -= dt;
    if (state.wanderTimer <= 0 || distance < 1.5) {
      chooseTarget(state, player);
      toTarget.subVectors(state.target, position);
    }

    if (toTarget.lengthSq() > 0.001) toTarget.normalize();

    const desiredVelocity = toTarget.multiplyScalar(state.speed);
    state.velocity.lerp(desiredVelocity, 1 - Math.exp(-state.turnRate * dt));
    position.addScaledVector(state.velocity, dt);

    state.phase += dt * state.bobSpeed;
    position.y += Math.sin(state.phase) * state.bobAmplitude * dt;

    if (state.velocity.lengthSq() > 0.01) {
      const direction = state.velocity.clone().normalize();
      const targetYaw = Math.atan2(direction.x, direction.z);
      const targetPitch = Math.atan2(direction.y, Math.hypot(direction.x, direction.z));
      state.model.rotation.y = dampAngle(state.model.rotation.y, targetYaw, 4.0, dt);
      state.model.rotation.x = THREE.MathUtils.damp
        ? THREE.MathUtils.damp(state.model.rotation.x, -targetPitch, 3.0, dt)
        : state.model.rotation.x + (-targetPitch - state.model.rotation.x) * (1 - Math.exp(-3.0 * dt));
    }

    state.model.rotation.z = Math.sin(state.phase * 1.7) * 0.025;
    state.model.userData.mixer?.update(dt);
  }

  for (let i = 0; i < count; i++) spawnOne();

  function update(dt) {
    for (const state of fish) updateOne(state, dt);
  }

  function getAll() {
    return fish;
  }

  return { update, getAll, spawnOne };
}

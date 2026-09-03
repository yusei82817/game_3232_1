/*
 * WASTELAND // FIELD TEST
 *
 * ゲーム全体の初期化と描画ループ、各システムの接続を担当します。
 * physics.jsは物理、map.jsはマップ、npc.jsはNPC、camera.jsはカメラ、
 * field.jsは時間・天候・環境、player.jsはプレイヤー、input.jsは入力を担当します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { initPhysics } from "./physics.js";
import { buildMap } from "./map.js";
import { createNPCManager } from "./npc.js";
import { createCameraController } from "./camera.js";
import { createFieldController } from "./field.js";
import { createPlayerController, animateHumanoid } from "./player.js";
import { createInputController } from "./input.js";

const CONFIG = {
  worldSize: 180,
  terrainSegments: 64,
  playerRadius: 0.38,
  playerHalfHeight: 0.72,
  playerMass: 72,
  walkSpeed: 4.0,
  runSpeed: 7.4,
  groundAcceleration: 24.0,
  groundBraking: 18.0,
  airAcceleration: 6.0,
  jumpSpeed: 5.8,
  groundProbeLength: 1.24,
  swimSpeed: 2.6,
  swimAcceleration: 8.5,
  swimBraking: 5.5,
  swimUpSpeed: 3.2,
  waterBuoyancy: 1.18,
  cameraDistance: 6.4,
  cameraHeight: 2.9,
  cameraLookHeight: 1.15,
  cameraSmoothing: 9.0,
  cameraYawSpeed: 1.9,
  cameraPitchSpeed: 1.45,
  cameraPitchMin: -0.38,
  cameraPitchMax: 0.72,
  cameraCollisionPadding: 0.35,

  dayLengthSeconds: 240,
  startTimeHours: 9.5,
  weatherCycleHours: 6,
  weatherTransitionSeconds: 8,
  rainCount: 700,

  npcCount: 14,
  npcWalkSpeed: 1.7,
  npcThinkInterval: 0.35,
  sunIntensity: 3.0,
  ambientDayIntensity: 0.55,
  ambientNightIntensity: 0.12
};

let scene, camera, renderer, physicsWorld;
let sunLight, sunMesh, hemiLight;
let npcManager, cameraController, fieldController, playerController;
let terrainHeightAt, mapState;

const inputController = createInputController();
const clock = new THREE.Clock();

function makeMaterial(color, roughness = 0.86) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 });
}

/**
 * NPCとプレイヤーで共有する人型モデルを生成します。
 * モデル生成はキャラクターの見た目に関する処理なので、
 * プレイヤーの物理・操作ロジックとは分離したままgame.jsに残します。
 */
function createHumanoid(options = {}) {
  const group = new THREE.Group();
  const skin = makeMaterial(options.skin ?? 0xb98468);
  const shirt = makeMaterial(options.shirt ?? 0x536a78);
  const pants = makeMaterial(options.pants ?? 0x34383e);
  const shoe = makeMaterial(0x202225);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.62, 5, 10), shirt);
  torso.position.y = 1.18;
  group.add(torso);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.16, 8), skin);
  neck.position.y = 1.75;
  group.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.29, 14, 10), skin);
  head.position.y = 2.03;
  group.add(head);

  function limb(radius, length, material, x, y) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), material);
    mesh.position.y = -length * 0.5;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  }

  const upperArmL = limb(0.105, 0.42, shirt, -0.43, 1.48);
  const upperArmR = limb(0.105, 0.42, shirt, 0.43, 1.48);
  const foreArmL = limb(0.095, 0.40, skin, -0.43, 1.06);
  const foreArmR = limb(0.095, 0.40, skin, 0.43, 1.06);
  const thighL = limb(0.14, 0.48, pants, -0.19, 0.76);
  const thighR = limb(0.14, 0.48, pants, 0.19, 0.76);
  const shinL = limb(0.105, 0.52, pants, -0.19, 0.28);
  const shinR = limb(0.105, 0.52, pants, 0.19, 0.28);

  const footL = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.12, 0.34), shoe);
  footL.position.set(-0.19, 0.05, 0.08);
  group.add(footL);
  const footR = footL.clone();
  footR.position.x = 0.19;
  group.add(footR);

  group.userData.limbs = {
    upperArmL, upperArmR, foreArmL, foreArmR,
    thighL, thighR, shinL, shinR
  };
  group.userData.phase = Math.random() * Math.PI * 2;
  return group;
}

function setupScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9aa4a0);
  scene.fog = new THREE.Fog(0x9aa4a0, 55, 180);

  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 300);
  camera.position.set(0, CONFIG.cameraHeight, CONFIG.cameraDistance);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  hemiLight = new THREE.HemisphereLight(0xbfd4dd, 0x5b5548, CONFIG.ambientDayIntensity);
  scene.add(hemiLight);
  sunLight = new THREE.DirectionalLight(0xfff1d1, CONFIG.sunIntensity);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1536, 1536);
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 130;
  sunLight.shadow.camera.left = -55;
  sunLight.shadow.camera.right = 55;
  sunLight.shadow.camera.top = 55;
  sunLight.shadow.camera.bottom = -55;
  scene.add(sunLight);
  scene.add(sunLight.target);
  sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffe6a3 })
  );
  scene.add(sunMesh);
}

function syncVisuals() {
  playerController?.syncVisual();
  npcManager?.syncVisuals();
}

function updateWaterHud() {
  const status = document.getElementById("status");
  if (!status || !playerController) return;

  const info = playerController.getWaterInfo();
  const submerged = info.isWater ? Math.max(0, info.depth) : 0;
  if (info.isWater && submerged > 0.35) {
    status.textContent = `SWIMMING // DEPTH ${submerged.toFixed(1)}m`;
  } else if (info.isWater) {
    status.textContent = "SHALLOW WATER";
  } else {
    status.textContent = "WORLD ONLINE";
  }
}

function showReady() {
  const loading = document.getElementById("loading");
  const hud = document.getElementById("hud");
  const status = document.getElementById("status");
  if (loading) loading.hidden = true;
  if (hud) hud.hidden = false;
  if (status) status.textContent = "WORLD ONLINE";
}

function showError(error) {
  console.error(error);
  const loading = document.getElementById("loading");
  const errorElement = document.getElementById("error");
  if (loading) loading.hidden = true;
  if (errorElement) {
    errorElement.hidden = false;
    errorElement.textContent = `WORLD ERROR: ${error?.message ?? error}`;
  }
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);

  playerController?.update(dt);
  npcManager?.update(dt);
  fieldController?.update(dt);
  mapState?.update(dt);
  physicsWorld.step();
  syncVisuals();
  updateWaterHud();
  cameraController?.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function resize() {
  if (!camera || !renderer) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

async function boot() {
  try {
    physicsWorld = await initPhysics();
    setupScene();

    fieldController = createFieldController({
      scene,
      config: CONFIG,
      sunLight,
      sunMesh,
      hemiLight,
      getPlayerPosition: () => playerController?.getBody()?.translation() ?? null
    });

    mapState = buildMap(scene, CONFIG);
    terrainHeightAt = mapState.terrainHeightAt;

    playerController = createPlayerController({
      scene,
      config: CONFIG,
      physicsWorld,
      terrainHeightAt,
      mapState,
      createModel: createHumanoid,
      getCameraYaw: () => cameraController?.getYaw() ?? Math.PI,
      isDown: inputController.isDown
    });
    playerController.create();

    cameraController = createCameraController({
      camera,
      config: CONFIG,
      physicsWorld,
      playerBody: playerController.getBody(),
      playerCollider: playerController.getCollider(),
      isDown: inputController.isDown
    });

    npcManager = createNPCManager({
      scene,
      config: CONFIG,
      terrainHeightAt,
      mapState,
      createModel: createHumanoid,
      animateModel: animateHumanoid,
      physicsWorld,
      playerBody: playerController.getBody()
    });
    npcManager.createAll();

    window.addEventListener("resize", resize);
    syncVisuals();
    showReady();
    clock.start();
    requestAnimationFrame(frame);
  } catch (error) {
    showError(error);
  }
}

boot();

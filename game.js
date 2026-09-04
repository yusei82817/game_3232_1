/*
 * WASTELAND // FIELD TEST
 *
 * ゲーム全体の初期化と描画ループ、各システムの接続を担当します。
 * physics.jsは物理司令塔、map.jsはマップ、npc.jsはNPC、camera.jsはカメラ、
 * field.jsは時間・天候・環境、player.jsはプレイヤー、input.jsは入力を担当します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { initPhysics, stepPhysics } from "./physics.js";
import { buildMap } from "./map.js";
import { createNPCManager } from "./npc.js";
import { createCameraController } from "./camera.js";
import { createFieldController } from "./field.js";
import { createPlayerController } from "./player.js";
import { animateHumanoid } from "./animation.js";
import { createInputController } from "./input.js";
import { createHumanoid } from "./entity.js";

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

  // 物理の更新は必ずphysics.jsへ渡します。
  // physics.jsがgravity・speed・touchを統括し、ここでは物理エンジンの直接操作をしません。
  stepPhysics();

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
    // Three.jsのScene・Camera・Rendererを先に作ります。
    // Rapier初期化中に処理が止まっても、画面そのものが完全な黒画面にならないようにします。
    setupScene();

    // 表示環境を作った後でRapierを初期化します。
    physicsWorld = await initPhysics();

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

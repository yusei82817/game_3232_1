/*
 * WASTELAND // FIELD TEST
 *
 * ゲーム全体の初期化と描画ループ、各システムの接続を担当します。
 * physics.jsは物理司令塔、map.jsはマップ、chunk.jsは巨大世界のストリーミング、
 * npc.jsはNPC、mob.jsは動物Mob、camera.jsはカメラ、field.jsは時間・天候、player.jsはプレイヤーを担当します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { initPhysics, stepPhysics } from "./physics.js";
import { buildMap } from "./map.js";
import { createNPCManager } from "./npc.js";
import { createMobManager } from "./mob.js";
import { createCameraController } from "./camera.js";
import { createFieldController } from "./field.js";
import { createPlayerController } from "./player.js";
import { animateHumanoid } from "./animation.js";
import { createInputController } from "./input.js";
import { createHumanoid } from "./entity.js";

const CONFIG = {
  // 世界を固定サイズで作らず、60m四方のチャンクを必要な範囲だけ生成します。
  // 理論上はチャンクを東西南北へ増やせるため、世界サイズに実質的な上限を設けません。
  chunkSize: 60,
  // 1チャンクあたりの地形分割数。60m / 32なので約1.9m間隔です。
  chunkTerrainSegments: 32,
  // 表示用は7×7チャンク。プレイヤーから最大約240m先まで地形を保持します。
  chunkRenderRadius: 3,
  // 物理用は3×3チャンク。プレイヤー周辺180m四方だけRapierへ登録します。
  chunkPhysicsRadius: 1,

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

  // チャンクを遠くまで表示するため、カメラとフォグの範囲も拡張します。
  cameraFar: 520,
  fogNear: 95,
  fogFar: 440,
  shadowDistance: 180,

  // ゲーム内の1日を30分（1800秒）に設定します。
  dayLengthSeconds: 1800,
  startTimeHours: 9.5,
  weatherCycleHours: 6,
  weatherTransitionSeconds: 8,
  rainCount: 700,

  npcCount: 14,
  npcWalkSpeed: 1.7,
  npcThinkInterval: 0.35,

  // 動物Mob。プレイヤーから見える距離を優先し、初期配置を近距離にします。
  chickenCount: 8,
  cowCount: 4,
  pigCount: 5,
  mobSpawnRadius: 14,
  mobThinkInterval: 1.2,
  mobFearDistance: 7.0,

  sunIntensity: 3.0,
  ambientDayIntensity: 0.55,
  ambientNightIntensity: 0.12
};

let scene, camera, renderer, physicsWorld;
let sunLight, sunMesh, hemiLight;
let npcManager, mobManager, cameraController, fieldController, playerController;
let terrainHeightAt, mapState;

const inputController = createInputController();
const clock = new THREE.Clock();

function setupScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9aa4a0);
  scene.fog = new THREE.Fog(0x9aa4a0, CONFIG.fogNear, CONFIG.fogFar);

  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, CONFIG.cameraFar);
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
  // 広い地形でもプレイヤー周辺に自然な影を落とせるよう、影用カメラの範囲を拡張します。
  sunLight.shadow.camera.far = CONFIG.shadowDistance;
  sunLight.shadow.camera.left = -75;
  sunLight.shadow.camera.right = 75;
  sunLight.shadow.camera.top = 75;
  sunLight.shadow.camera.bottom = -75;
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
  mobManager?.syncVisuals();
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
  mobManager?.update(dt);
  fieldController?.update(dt);

  // プレイヤーの現在位置をチャンク管理へ渡し、周囲の世界をロード・アンロードします。
  const playerPosition = playerController?.getBody()?.translation() ?? null;
  mapState?.update(dt, playerPosition);

  // 物理の更新は必ずphysics.jsへ渡します。
  // physics.jsがgravity・speed・touchを統括し、ここでは物理エンジンを直接操作しません。
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

    // 初期チャンクを先に生成してから動物を配置します。
    // これでMob生成直後からプレイヤー周辺の地形コリジョンが存在します。
    const initialPlayerPosition = playerController.getBody().translation();
    mapState.update(0, initialPlayerPosition);

    mobManager = createMobManager({
      scene,
      terrainHeightAt,
      physicsWorld,
      playerBody: playerController.getBody(),
      isWaterAt: mapState.isWaterAt,
      config: CONFIG
    });

    mobManager.spawnMany("chicken", CONFIG.chickenCount, {
      x: initialPlayerPosition.x,
      z: initialPlayerPosition.z,
      radius: CONFIG.mobSpawnRadius
    });
    mobManager.spawnMany("cow", CONFIG.cowCount, {
      x: initialPlayerPosition.x,
      z: initialPlayerPosition.z,
      radius: CONFIG.mobSpawnRadius
    });
    mobManager.spawnMany("pig", CONFIG.pigCount, {
      x: initialPlayerPosition.x,
      z: initialPlayerPosition.z,
      radius: CONFIG.mobSpawnRadius
    });

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

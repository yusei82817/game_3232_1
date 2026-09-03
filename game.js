/*
 * WASTELAND // FIELD TEST
 *
 * ゲーム本体。Three.jsは「見た目」、physics.js/Rapierは「物理状態」、map.jsは「マップ」、npc.jsは「NPC」を担当します。
 * プレイヤーについては、見た目のモデルを直接移動させず、Rapierの速度・位置を先に更新します。
 *
 * マップ生成はmap.jsへ切り離しています。水面もmap.jsで生成しますが、
 * 水面自体には歩行用コリジョンを付けず、ここで水中状態・浮力・泳ぎを処理します。
 * NPCの生成・AI・移動はnpc.jsへ切り離し、ここではNPCマネージャーを起動して更新を渡します。
 *
 * 重点:
 * - 人型プレイヤーを物理カプセルで支える
 * - WASD / 矢印キーを同時入力できる入力集合方式
 * - Z + W を走行として扱う
 * - 加速・減速を物理的な速度変化として処理
 * - ジャンプと接地判定
 * - 坂・段差を含む地形上での移動
 * - 三人称カメラの追従、回転、地形へのめり込み防止
 * - 歩行・走行・待機・水泳に応じた人型アニメーション
 * - 水中では浮力を物理状態へ加え、陸上と異なる移動速度にする
 *
 * ブラウザだけで動かすため、外部3Dモデルは使わずThree.jsで人型を生成します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { initPhysics, createDynamicCapsule, RAPIER } from "./physics.js";
import { buildMap } from "./map.js";
import { createNPCManager } from "./npc.js";

const CONFIG = {
  worldSize: 180,
  terrainSegments: 64,

  // プレイヤーの物理寸法。Rapierのカプセルと人型モデルの身長を近づけます。
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

  // 水中の移動設定。水中では陸上より水平速度を落とし、Spaceで上向きに泳ぎます。
  swimSpeed: 2.6,
  swimAcceleration: 8.5,
  swimBraking: 5.5,
  swimUpSpeed: 3.2,
  waterBuoyancy: 1.18,

  // カメラ。distance/heightを調整すると三人称視点の距離と高さを変更できます。
  cameraDistance: 6.4,
  cameraHeight: 2.9,
  cameraLookHeight: 1.15,
  cameraSmoothing: 9.0,
  cameraYawSpeed: 1.9,
  cameraPitchSpeed: 1.45,
  cameraPitchMin: -0.38,
  cameraPitchMax: 0.72,
  cameraCollisionPadding: 0.35,

  // 1実秒で進むゲーム内時間。240秒で24時間を一周します。
  dayLengthSeconds: 240,
  startTimeHours: 9.5,

  // NPC設定本体はnpc.jsから利用します。
  npcCount: 14,
  npcWalkSpeed: 1.7,
  npcThinkInterval: 0.35,

  // 太陽・環境光。太陽高度と光量を同じ時刻計算から決定します。
  sunIntensity: 3.0,
  ambientDayIntensity: 0.55,
  ambientNightIntensity: 0.12
};

let scene, camera, renderer, physicsWorld;
let playerBody, playerCollider, playerModel;
let sunLight, sunMesh, hemiLight;
let npcManager;
let gameHours = CONFIG.startTimeHours;
let cameraYaw = Math.PI;
let cameraPitch = 0.22;
let terrainHeightAt;
let mapState;
let jumpLatch = false;

const keys = new Set();
const clock = new THREE.Clock();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

// キーは「現在押されている集合」で保持します。これによりZ+W+Aなども同時に認識できます。
window.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
    event.preventDefault();
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => keys.clear());

function down(...codes) {
  return codes.some((code) => keys.has(code));
}

function makeMaterial(color, roughness = 0.86) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 });
}

function createHumanoid(options = {}) {
  // 人型を複数の部位と関節Pivotに分けます。アニメーションはPivotを回して作ります。
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

  group.userData.limbs = { upperArmL, upperArmR, foreArmL, foreArmR, thighL, thighR, shinL, shinR };
  group.userData.phase = Math.random() * Math.PI * 2;
  return group;
}

function createPlayer() {
  const physics = createDynamicCapsule({
    x: 0,
    y: terrainHeightAt(0, 0) + 2.4,
    z: 0,
    radius: CONFIG.playerRadius,
    halfHeight: CONFIG.playerHalfHeight,
    mass: CONFIG.playerMass,
    friction: 0.82,
    damping: 0.8
  });
  playerBody = physics.body;
  playerCollider = physics.collider;
  playerModel = createHumanoid({ shirt: 0x536a78, pants: 0x34383e });
  scene.add(playerModel);
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
  sunMesh = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffe6a3 }));
  scene.add(sunMesh);
}

function movementInput() {
  // W/Sはカメラ基準の前後、A/Dはカメラ基準の左右です。
  const forward = tmpA.set(Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
  const right = tmpB.set(Math.cos(cameraYaw), 0, Math.sin(cameraYaw));
  const move = tmpC.set(0, 0, 0);
  if (down("KeyW", "ArrowUp")) move.add(forward);
  if (down("KeyS", "ArrowDown")) move.sub(forward);
  if (down("KeyD", "ArrowRight")) move.add(right);
  if (down("KeyA", "ArrowLeft")) move.sub(right);
  if (move.lengthSq() > 1) move.normalize();
  return move;
}

function isGrounded() {
  const translation = playerBody.translation();
  const velocity = playerBody.linvel();
  if (velocity.y > 1.0) return false;

  const ray = new RAPIER.Ray(
    { x: translation.x, y: translation.y - CONFIG.playerHalfHeight, z: translation.z },
    { x: 0, y: -1, z: 0 }
  );
  const hit = physicsWorld.castRay(
    ray,
    CONFIG.groundProbeLength,
    true,
    undefined,
    undefined,
    playerCollider.handle
  );
  return hit !== null;
}

function getPlayerWaterInfo() {
  if (!mapState || !playerBody) return { isWater: false, surfaceY: 0, depth: 0, shoreFactor: 0 };
  const position = playerBody.translation();
  return mapState.getWaterInfoAt(position.x, position.z);
}

function applyWaterPhysics(dt, waterInfo) {
  if (!waterInfo.isWater) return;

  const position = playerBody.translation();
  const velocity = playerBody.linvel();
  const capsuleBottom = position.y - CONFIG.playerHalfHeight;
  const capsuleHeight = CONFIG.playerHalfHeight * 2;
  const submerged = THREE.MathUtils.clamp((waterInfo.surfaceY - capsuleBottom) / capsuleHeight, 0, 1);

  if (submerged <= 0) return;

  // 重力に対抗する浮力を深さに応じて加えます。完全に沈んだ状態ではほぼ体重分を支えます。
  const buoyancyImpulse = CONFIG.playerMass * 9.81 * CONFIG.waterBuoyancy * submerged * dt;
  playerBody.applyImpulse({ x: 0, y: buoyancyImpulse, z: 0 }, true);

  // 水面付近で落下速度が大きくなりすぎないよう、水の抵抗を表現します。
  if (velocity.y < -1.8) {
    playerBody.setLinvel({ x: velocity.x, y: velocity.y * 0.72, z: velocity.z }, true);
  }

  // Spaceを押している間は上向きの泳ぎを行います。陸上のジャンプとは別処理です。
  if (down("Space")) {
    const verticalDelta = CONFIG.swimUpSpeed - velocity.y;
    const change = THREE.MathUtils.clamp(verticalDelta, -2.0, 2.0) * dt;
    playerBody.applyImpulse({ x: 0, y: change * playerMassSafe(), z: 0 }, true);
  }

  // 水中では水平速度にも抵抗を掛けます。
  const drag = Math.max(0, 1 - 2.2 * submerged * dt);
  playerBody.setLinvel({ x: velocity.x * drag, y: playerBody.linvel().y, z: velocity.z * drag }, true);

  playerModel.userData.inWater = true;
  playerModel.userData.submerged = submerged;
  playerModel.userData.waterSurfaceY = waterInfo.surfaceY;
}

function playerMassSafe() {
  return Math.max(1, CONFIG.playerMass);
}

function updatePlayer(dt) {
  const move = movementInput();
  const waterInfo = getPlayerWaterInfo();
  const inWater = waterInfo.isWater && waterInfo.depth > 0.35;
  const grounded = isGrounded() && !inWater;
  const running = down("KeyZ") && down("KeyW") && !inWater;

  const targetSpeed = inWater ? CONFIG.swimSpeed : (running ? CONFIG.runSpeed : CONFIG.walkSpeed);
  const targetVX = move.x * targetSpeed;
  const targetVZ = move.z * targetSpeed;
  const velocity = playerBody.linvel();
  const acceleration = inWater ? CONFIG.swimAcceleration : (grounded ? CONFIG.groundAcceleration : CONFIG.airAcceleration);
  const braking = inWater ? CONFIG.swimBraking : (grounded ? CONFIG.groundBraking : CONFIG.airAcceleration * 0.55);

  const deltaVX = targetVX - velocity.x;
  const deltaVZ = targetVZ - velocity.z;
  const hasInput = move.lengthSq() > 0.0001;
  const rate = hasInput ? acceleration : braking;
  const maxChange = rate * dt;
  const changeX = THREE.MathUtils.clamp(deltaVX, -maxChange, maxChange);
  const changeZ = THREE.MathUtils.clamp(deltaVZ, -maxChange, maxChange);
  playerBody.applyImpulse({ x: changeX * CONFIG.playerMass, y: 0, z: changeZ * CONFIG.playerMass }, true);

  const jumpDown = down("Space");
  if (!inWater && jumpDown && !jumpLatch && grounded) {
    const jumpDelta = CONFIG.jumpSpeed - Math.max(0, velocity.y);
    playerBody.applyImpulse({ x: 0, y: jumpDelta * CONFIG.playerMass, z: 0 }, true);
  }
  jumpLatch = jumpDown;

  if (inWater) applyWaterPhysics(dt, waterInfo);

  if (hasInput) {
    const desiredAngle = Math.atan2(move.x, move.z);
    const currentAngle = playerModel.rotation.y;
    playerModel.rotation.y = THREE.MathUtils.lerpAngle(currentAngle, desiredAngle, 1 - Math.exp(-9 * dt));
  }

  const horizontalSpeed = Math.hypot(playerBody.linvel().x, playerBody.linvel().z);
  animateHumanoid(playerModel, horizontalSpeed, grounded, running, dt, inWater);
}

function animateHumanoid(model, speed, grounded, running, dt, inWater = false) {
  const limbs = model.userData.limbs;
  const moving = speed > 0.2;
  model.userData.phase += dt * (moving ? 6.0 + speed * 0.8 : 1.5);
  const phase = model.userData.phase;

  if (inWater) {
    // 水中では手足を交互に動かす泳ぎ姿勢にします。
    const swim = Math.sin(phase * 0.9) * 0.42;
    const counter = Math.sin(phase * 0.9 + Math.PI) * 0.42;
    limbs.thighL.rotation.x = swim * 0.7;
    limbs.thighR.rotation.x = counter * 0.7;
    limbs.shinL.rotation.x = -swim * 0.35;
    limbs.shinR.rotation.x = -counter * 0.35;
    limbs.upperArmL.rotation.x = counter;
    limbs.upperArmR.rotation.x = swim;
    limbs.foreArmL.rotation.x = -counter * 0.65;
    limbs.foreArmR.rotation.x = -swim * 0.65;
    return;
  }

  const targetSwing = moving && grounded ? (running ? 0.78 : 0.5) * Math.min(speed / CONFIG.runSpeed, 1) : 0;

  if (!grounded) {
    limbs.thighL.rotation.x = -0.18;
    limbs.thighR.rotation.x = 0.18;
    limbs.shinL.rotation.x = 0.15;
    limbs.shinR.rotation.x = 0.15;
    limbs.upperArmL.rotation.x = -0.18;
    limbs.upperArmR.rotation.x = -0.18;
    limbs.foreArmL.rotation.x = 0.1;
    limbs.foreArmR.rotation.x = 0.1;
    return;
  }

  const swing = Math.sin(phase) * targetSwing;
  const opposite = Math.sin(phase + Math.PI) * targetSwing;
  limbs.thighL.rotation.x = swing;
  limbs.thighR.rotation.x = opposite;
  limbs.shinL.rotation.x = Math.max(0, -swing) * 0.5;
  limbs.shinR.rotation.x = Math.max(0, -opposite) * 0.5;
  limbs.upperArmL.rotation.x = opposite * 0.72;
  limbs.upperArmR.rotation.x = swing * 0.72;
  limbs.foreArmL.rotation.x = -opposite * 0.25;
  limbs.foreArmR.rotation.x = -swing * 0.25;
}

function updateCamera(dt) {
  if (down("ArrowLeft")) cameraYaw += CONFIG.cameraYawSpeed * dt;
  if (down("ArrowRight")) cameraYaw -= CONFIG.cameraYawSpeed * dt;
  if (down("ArrowUp")) cameraPitch += CONFIG.cameraPitchSpeed * dt;
  if (down("ArrowDown")) cameraPitch -= CONFIG.cameraPitchSpeed * dt;
  cameraPitch = THREE.MathUtils.clamp(cameraPitch, CONFIG.cameraPitchMin, CONFIG.cameraPitchMax);

  const playerPosition = playerBody.translation();
  const target = tmpA.set(playerPosition.x, playerPosition.y + CONFIG.cameraLookHeight, playerPosition.z);
  const horizontal = Math.cos(cameraPitch) * CONFIG.cameraDistance;
  const desired = tmpB.set(
    target.x - Math.sin(cameraYaw) * horizontal,
    target.y + Math.sin(cameraPitch) * CONFIG.cameraDistance,
    target.z + Math.cos(cameraYaw) * horizontal
  );

  const origin = new RAPIER.Vector3(target.x, target.y, target.z);
  const rayDirection = new RAPIER.Vector3(desired.x - target.x, desired.y - target.y, desired.z - target.z);
  const distance = rayDirection.norm();
  if (distance > 0.001) rayDirection.normalize();
  const ray = new RAPIER.Ray(origin, rayDirection);
  const hit = physicsWorld.castRay(ray, distance, true, undefined, undefined, playerCollider.handle);
  if (hit) {
    const safeDistance = Math.max(0.8, hit.toi - CONFIG.cameraCollisionPadding);
    desired.copy(target).add(tmpC.set(rayDirection.x, rayDirection.y, rayDirection.z).multiplyScalar(safeDistance));
  }

  camera.position.lerp(desired, 1 - Math.exp(-CONFIG.cameraSmoothing * dt));
  camera.lookAt(target.x, target.y, target.z);
}

function updateSun(dt) {
  gameHours = (gameHours + dt * 24 / CONFIG.dayLengthSeconds) % 24;
  const angle = (gameHours - 6) / 24 * Math.PI * 2;
  const altitude = Math.sin(angle);
  const azimuth = angle + Math.PI * 0.15;
  const horizontal = Math.cos(angle);
  const distance = 85;
  const sunY = altitude * distance;
  const sunX = Math.cos(azimuth) * horizontal * distance;
  const sunZ = Math.sin(azimuth) * horizontal * distance;

  sunLight.position.set(sunX, Math.max(4, sunY), sunZ);
  sunLight.target.position.set(0, 0, 0);
  sunMesh.position.copy(sunLight.position);

  const daylight = THREE.MathUtils.clamp((altitude + 0.12) / 0.75, 0, 1);
  sunLight.intensity = CONFIG.sunIntensity * (0.08 + daylight * 0.92);
  hemiLight.intensity = THREE.MathUtils.lerp(CONFIG.ambientNightIntensity, CONFIG.ambientDayIntensity, daylight);

  const sky = new THREE.Color().setHSL(0.56, 0.18 + daylight * 0.2, 0.18 + daylight * 0.48);
  scene.background.copy(sky);
  scene.fog.color.copy(sky);

  const clockElement = document.getElementById("clock");
  if (clockElement) {
    const hour = Math.floor(gameHours);
    const minute = Math.floor((gameHours - hour) * 60);
    clockElement.textContent = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
}

function syncVisuals() {
  const playerPosition = playerBody.translation();
  playerModel.position.set(playerPosition.x, playerPosition.y - 1.10, playerPosition.z);
  npcManager?.syncVisuals();
}

function updateWaterHud() {
  const status = document.getElementById("status");
  if (!status || !playerBody) return;
  const info = getPlayerWaterInfo();
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
  updatePlayer(dt);
  npcManager?.update(dt);
  updateSun(dt);
  mapState?.update(dt);
  physicsWorld.step();
  syncVisuals();
  updateWaterHud();
  updateCamera(dt);
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

    // マップ生成はmap.jsに委譲。地形と水域の情報をここで共有します。
    mapState = buildMap(scene, CONFIG);
    terrainHeightAt = mapState.terrainHeightAt;

    createPlayer();

    // NPCの生成・更新はnpc.jsのManagerへ委譲します。
    npcManager = createNPCManager({
      scene,
      config: CONFIG,
      terrainHeightAt,
      mapState,
      createModel: createHumanoid,
      animateModel: animateHumanoid
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
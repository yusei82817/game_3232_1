/*
 * WASTELAND // FIELD TEST
 *
 * ゲーム本体。Three.jsは「見た目」、physics.js/Rapierは「物理状態」、map.jsは「マップ」を担当します。
 * プレイヤーについては、見た目のモデルを直接移動させず、Rapierの速度・位置を先に更新します。
 *
 * 今回は地形・岩の生成をmap.jsへ切り離しました。
 *
 * 重点:
 * - 人型プレイヤーを物理カプセルで支える
 * - WASD / 矢印キーを同時入力できる入力集合方式
 * - Z + W を走行として扱う
 * - 加速・減速を物理的な速度変化として処理
 * - ジャンプと接地判定
 * - 坂・段差を含む地形上での移動
 * - 三人称カメラの追従、回転、地形へのめり込み防止
 * - 歩行・走行・待機に応じた人型アニメーション
 *
 * ブラウザだけで動かすため、外部3Dモデルは使わずThree.jsで人型を生成します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { initPhysics, createDynamicCapsule, RAPIER } from "./physics.js";
import { buildMap } from "./map.js";

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

  // NPCはプレイヤーより少し軽量化しますが、人型・物理・自律行動は維持します。
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
let gameHours = CONFIG.startTimeHours;
let cameraYaw = Math.PI;
let cameraPitch = 0.22;
let terrainHeightAt;
let jumpLatch = false;

const npcs = [];
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

function createNPC(index) {
  const angle = index / CONFIG.npcCount * Math.PI * 2;
  const radius = 12 + (index % 4) * 7;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const physics = createDynamicCapsule({
    x,
    y: terrainHeightAt(x, z) + 2.3,
    z,
    radius: 0.34,
    halfHeight: 0.68,
    mass: 65,
    friction: 0.82,
    damping: 1.1
  });
  const model = createHumanoid({
    shirt: new THREE.Color().setHSL((index * 0.13) % 1, 0.28, 0.38).getHex(),
    pants: 0x30333a
  });
  model.scale.setScalar(0.96);
  scene.add(model);
  npcs.push({
    body: physics.body,
    collider: physics.collider,
    model,
    target: new THREE.Vector3(x, 0, z),
    thinkTimer: Math.random() * CONFIG.npcThinkInterval,
    phase: Math.random() * Math.PI * 2,
    speed: CONFIG.npcWalkSpeed * (0.9 + Math.random() * 0.25)
  });
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

  const ray = new RAPIER.Ray({ x: translation.x, y: translation.y - CONFIG.playerHalfHeight, z: translation.z }, { x: 0, y: -1, z: 0 });
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

function updatePlayer(dt) {
  const move = movementInput();
  const grounded = isGrounded();
  const running = down("KeyZ") && down("KeyW");
  const targetSpeed = running ? CONFIG.runSpeed : CONFIG.walkSpeed;
  const targetVX = move.x * targetSpeed;
  const targetVZ = move.z * targetSpeed;
  const velocity = playerBody.linvel();
  const acceleration = grounded ? CONFIG.groundAcceleration : CONFIG.airAcceleration;
  const braking = grounded ? CONFIG.groundBraking : CONFIG.airAcceleration * 0.55;

  const deltaVX = targetVX - velocity.x;
  const deltaVZ = targetVZ - velocity.z;
  const hasInput = move.lengthSq() > 0.0001;
  const rate = hasInput ? acceleration : braking;
  const maxChange = rate * dt;
  const changeX = THREE.MathUtils.clamp(deltaVX, -maxChange, maxChange);
  const changeZ = THREE.MathUtils.clamp(deltaVZ, -maxChange, maxChange);
  playerBody.applyImpulse({ x: changeX * CONFIG.playerMass, y: 0, z: changeZ * CONFIG.playerMass }, true);

  const jumpDown = down("Space");
  if (jumpDown && !jumpLatch && grounded) {
    const jumpDelta = CONFIG.jumpSpeed - Math.max(0, velocity.y);
    playerBody.applyImpulse({ x: 0, y: jumpDelta * CONFIG.playerMass, z: 0 }, true);
  }
  jumpLatch = jumpDown;

  if (hasInput) {
    const desiredAngle = Math.atan2(move.x, move.z);
    const currentAngle = playerModel.rotation.y;
    playerModel.rotation.y = THREE.MathUtils.lerpAngle(currentAngle, desiredAngle, 1 - Math.exp(-12 * dt));
  }

  const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
  animateHumanoid(playerModel, horizontalSpeed, grounded, running, dt);
}

function animateHumanoid(model, speed, grounded, running, dt) {
  const limbs = model.userData.limbs;
  const moving = speed > 0.35;
  const targetSwing = moving && grounded ? (running ? 0.78 : 0.5) * Math.min(speed / CONFIG.runSpeed, 1) : 0;
  model.userData.phase += dt * (moving ? 6.0 + speed * 0.8 : 1.5);
  const phase = model.userData.phase;

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

function updateNPCs(dt) {
  for (const npc of npcs) {
    npc.thinkTimer -= dt;
    const position = npc.body.translation();

    if (npc.thinkTimer <= 0 || Math.hypot(position.x - npc.target.x, position.z - npc.target.z) < 1.8) {
      npc.thinkTimer = 0.45 + Math.random() * 0.6;
      const angle = Math.random() * Math.PI * 2;
      const radius = 7 + Math.random() * 16;
      npc.target.set(position.x + Math.cos(angle) * radius, 0, position.z + Math.sin(angle) * radius);
      npc.target.x = THREE.MathUtils.clamp(npc.target.x, -CONFIG.worldSize * 0.46, CONFIG.worldSize * 0.46);
      npc.target.z = THREE.MathUtils.clamp(npc.target.z, -CONFIG.worldSize * 0.46, CONFIG.worldSize * 0.46);
    }

    const direction = tmpA.set(npc.target.x - position.x, 0, npc.target.z - position.z);
    if (direction.lengthSq() > 0.01) direction.normalize();
    const velocity = npc.body.linvel();
    const targetVX = direction.x * npc.speed;
    const targetVZ = direction.z * npc.speed;
    const changeX = THREE.MathUtils.clamp(targetVX - velocity.x, -8 * dt, 8 * dt);
    const changeZ = THREE.MathUtils.clamp(targetVZ - velocity.z, -8 * dt, 8 * dt);
    npc.body.applyImpulse({ x: changeX * 65, y: 0, z: changeZ * 65 }, true);

    if (direction.lengthSq() > 0.01) {
      const angle = Math.atan2(direction.x, direction.z);
      npc.model.rotation.y = THREE.MathUtils.lerpAngle(npc.model.rotation.y, angle, 1 - Math.exp(-8 * dt));
    }

    animateHumanoid(npc.model, Math.hypot(velocity.x, velocity.z), true, false, dt);
  }
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
    desired.copy(target).add(tmpC.copy(rayDirection).multiplyScalar(safeDistance));
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

  for (const npc of npcs) {
    const position = npc.body.translation();
    npc.model.position.set(position.x, position.y - 1.04, position.z);
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
  updateNPCs(dt);
  updateSun(dt);
  physicsWorld.step();
  syncVisuals();
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

    // マップ生成はmap.jsに委譲。ここで返された高さ関数をプレイヤー/NPCでも共有します。
    const map = buildMap(scene, CONFIG);
    terrainHeightAt = map.terrainHeightAt;

    createPlayer();
    for (let i = 0; i < CONFIG.npcCount; i++) createNPC(i);

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

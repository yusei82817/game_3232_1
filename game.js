/*
 * WASTELAND // FIELD TEST
 *
 * ゲーム本体。Three.jsは見た目、physics.js/Rapierは物理状態、map.jsはマップ、
 * npc.jsはNPC、camera.jsは三人称カメラ、field.jsは時間・天候・環境を担当します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { initPhysics, createDynamicCapsule, RAPIER } from "./physics.js";
import { buildMap } from "./map.js";
import { createNPCManager } from "./npc.js";
import { createCameraController } from "./camera.js";
import { createFieldController } from "./field.js";

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

  // field.jsが時間・天候サイクルを管理します。
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
let playerBody, playerCollider, playerModel;
let sunLight, sunMesh, hemiLight;
let npcManager, cameraController, fieldController;
let terrainHeightAt, mapState;
let jumpLatch = false;

const keys = new Set();
const clock = new THREE.Clock();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

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
  sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffe6a3 })
  );
  scene.add(sunMesh);
}

function movementInput() {
  const cameraYaw = cameraController?.getYaw() ?? Math.PI;
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
  if (!mapState || !playerBody) {
    return { isWater: false, surfaceY: 0, depth: 0, shoreFactor: 0 };
  }
  const position = playerBody.translation();
  return mapState.getWaterInfoAt(position.x, position.z);
}

function playerMassSafe() {
  return Math.max(1, CONFIG.playerMass);
}

function applyWaterPhysics(dt, waterInfo) {
  if (!waterInfo.isWater) return;

  const position = playerBody.translation();
  const velocity = playerBody.linvel();
  const capsuleBottom = position.y - CONFIG.playerHalfHeight;
  const capsuleHeight = CONFIG.playerHalfHeight * 2;
  const submerged = THREE.MathUtils.clamp(
    (waterInfo.surfaceY - capsuleBottom) / capsuleHeight,
    0,
    1
  );

  if (submerged <= 0) return;

  const buoyancyImpulse = CONFIG.playerMass * 9.81 * CONFIG.waterBuoyancy * submerged * dt;
  playerBody.applyImpulse({ x: 0, y: buoyancyImpulse, z: 0 }, true);

  if (velocity.y < -1.8) {
    playerBody.setLinvel({
      x: velocity.x,
      y: velocity.y * 0.72,
      z: velocity.z
    }, true);
  }

  if (down("Space")) {
    const verticalDelta = CONFIG.swimUpSpeed - velocity.y;
    const change = THREE.MathUtils.clamp(verticalDelta, -2.0, 2.0) * dt;
    playerBody.applyImpulse({
      x: 0,
      y: change * playerMassSafe(),
      z: 0
    }, true);
  }

  const drag = Math.max(0, 1 - 2.2 * submerged * dt);
  playerBody.setLinvel({
    x: velocity.x * drag,
    y: playerBody.linvel().y,
    z: velocity.z * drag
  }, true);

  playerModel.userData.inWater = true;
  playerModel.userData.submerged = submerged;
  playerModel.userData.waterSurfaceY = waterInfo.surfaceY;
}

function updatePlayer(dt) {
  const move = movementInput();
  const waterInfo = getPlayerWaterInfo();
  const inWater = waterInfo.isWater && waterInfo.depth > 0.35;
  const grounded = isGrounded() && !inWater;
  const running = down("KeyZ") && down("KeyW") && !inWater;

  const targetSpeed = inWater
    ? CONFIG.swimSpeed
    : (running ? CONFIG.runSpeed : CONFIG.walkSpeed);
  const targetVX = move.x * targetSpeed;
  const targetVZ = move.z * targetSpeed;
  const velocity = playerBody.linvel();

  const acceleration = inWater
    ? CONFIG.swimAcceleration
    : (grounded ? CONFIG.groundAcceleration : CONFIG.airAcceleration);
  const braking = inWater ? CONFIG.swimBraking : CONFIG.groundBraking;
  const hasInput = move.lengthSq() > 0.001;
  const rate = hasInput ? acceleration : braking;
  const maxChange = rate * dt;
  const changeX = THREE.MathUtils.clamp(targetVX - velocity.x, -maxChange, maxChange);
  const changeZ = THREE.MathUtils.clamp(targetVZ - velocity.z, -maxChange, maxChange);

  playerBody.applyImpulse({
    x: changeX * CONFIG.playerMass,
    y: 0,
    z: changeZ * CONFIG.playerMass
  }, true);

  if (!inWater && down("Space") && grounded && !jumpLatch) {
    playerBody.setLinvel({
      x: playerBody.linvel().x,
      y: CONFIG.jumpSpeed,
      z: playerBody.linvel().z
    }, true);
    jumpLatch = true;
  }
  if (!down("Space")) jumpLatch = false;

  applyWaterPhysics(dt, waterInfo);
  animateHumanoid(playerModel, Math.hypot(velocity.x, velocity.z), grounded, running, dt, inWater);
}

function animateHumanoid(model, speed, grounded, running, dt, inWater = false) {
  const limbs = model.userData.limbs;
  if (!limbs) return;
  model.userData.phase += dt * (speed > 0.15 ? (running ? 10 : 7) : 1.5);
  const intensity = Math.min(speed / (running ? CONFIG.runSpeed : CONFIG.walkSpeed), 1);

  if (!grounded && !inWater) {
    limbs.thighL.rotation.x = -0.18;
    limbs.thighR.rotation.x = 0.18;
    limbs.shinL.rotation.x = 0.18;
    limbs.shinR.rotation.x = 0.18;
    limbs.upperArmL.rotation.x = -0.28;
    limbs.upperArmR.rotation.x = -0.28;
    limbs.foreArmL.rotation.x = -0.12;
    limbs.foreArmR.rotation.x = -0.12;
    return;
  }

  if (inWater) {
    const swim = Math.sin(model.userData.phase) * 0.55;
    limbs.thighL.rotation.x = swim;
    limbs.thighR.rotation.x = -swim;
    limbs.shinL.rotation.x = -swim * 0.55;
    limbs.shinR.rotation.x = swim * 0.55;
    limbs.upperArmL.rotation.x = -swim * 1.35;
    limbs.upperArmR.rotation.x = swim * 1.35;
    limbs.foreArmL.rotation.x = -swim * 0.8;
    limbs.foreArmR.rotation.x = swim * 0.8;
    return;
  }

  const swing = Math.sin(model.userData.phase) * 0.55 * intensity;
  const opposite = -swing;
  limbs.thighL.rotation.x = swing;
  limbs.thighR.rotation.x = opposite;
  limbs.shinL.rotation.x = Math.max(0, -swing) * 0.5;
  limbs.shinR.rotation.x = Math.max(0, -opposite) * 0.5;
  limbs.upperArmL.rotation.x = opposite * 0.72;
  limbs.upperArmR.rotation.x = swing * 0.72;
  limbs.foreArmL.rotation.x = -opposite * 0.25;
  limbs.foreArmR.rotation.x = -swing * 0.25;
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
      getPlayerPosition: () => playerBody?.translation() ?? null
    });

    mapState = buildMap(scene, CONFIG);
    terrainHeightAt = mapState.terrainHeightAt;
    createPlayer();

    cameraController = createCameraController({
      camera,
      config: CONFIG,
      physicsWorld,
      playerBody,
      playerCollider,
      isDown: down
    });

    npcManager = createNPCManager({
      scene,
      config: CONFIG,
      terrainHeightAt,
      mapState,
      createModel: createHumanoid,
      animateModel: animateHumanoid,
      physicsWorld,
      playerBody
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

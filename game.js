/*
 * WASTELAND // FIELD TEST
 *
 * ゲーム本体。Three.jsは「見た目」、physics.js/Rapierは「物理状態」を担当します。
 * プレイヤーについては、見た目のモデルを直接移動させず、Rapierの速度・位置を先に更新します。
 *
 * 今回の重点:
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
import { initPhysics, getWorld, createDynamicCapsule, createFixedHeightfield, createFixedBall } from "./physics.js";

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

function buildTerrain() {
  const size = CONFIG.worldSize;
  const segments = CONFIG.terrainSegments;
  const count = (segments + 1) ** 2;
  const positions = new Float32Array(count * 3);
  const heights = new Float32Array(count);
  const indices = [];

  terrainHeightAt = (x, z) => {
    // 大きな起伏 + 細かな起伏。荒野を平面にしないための決定的な地形関数です。
    const broad = Math.sin(x * 0.045) * 2.2 + Math.cos(z * 0.052) * 1.6;
    const detail = Math.sin((x + z) * 0.11) * 0.65 + Math.cos((x - z) * 0.075) * 0.45;
    const ridge = Math.max(0, Math.sin(x * 0.018 + z * 0.031)) * 1.3;
    return broad + detail + ridge - 0.6;
  };

  for (let iz = 0; iz <= segments; iz++) {
    for (let ix = 0; ix <= segments; ix++) {
      const i = iz * (segments + 1) + ix;
      const x = -size / 2 + (ix / segments) * size;
      const z = -size / 2 + (iz / segments) * size;
      const y = terrainHeightAt(x, z);
      heights[i] = y;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }
  }

  for (let z = 0; z < segments; z++) {
    for (let x = 0; x < segments; x++) {
      const a = z * (segments + 1) + x;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, makeMaterial(0x5b5747));
  mesh.receiveShadow = true;
  scene.add(mesh);

  // 表示と物理で同じheight配列を使うことで、足元の見た目と衝突面のズレを防ぎます。
  createFixedHeightfield({
    rows: segments + 1,
    cols: segments + 1,
    heights,
    scale: { x: size / segments, y: 1, z: size / segments }
  });
}

function addRock(x, z, scale = 1) {
  const y = terrainHeightAt(x, z) + 0.65 * scale;
  const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), makeMaterial(0x5f625e));
  mesh.scale.set(1.25 * scale, 0.75 * scale, 0.95 * scale);
  mesh.rotation.set(Math.random(), Math.random(), Math.random());
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  createFixedBall({ x, y, z, radius: 0.95 * scale });
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
  playerModel.castShadow = true;
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

  sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffe6a3 })
  );
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
  // カプセル中心から下向きに短いRayを飛ばし、足元の地形/物体を確認します。
  // 上向きの速度中に地面判定を残しすぎないよう、垂直速度も条件にします。
  const translation = playerBody.translation();
  const velocity = playerBody.linvel();
  if (velocity.y > 1.0) return false;
  const ray = new RAPIER.Ray({ x: translation.x, y: translation.y, z: translation.z }, { x: 0, y: -1, z: 0 });
  const hit = physicsWorld.castRay(ray, CONFIG.groundProbeLength, true);
  return hit !== null;
}

function updatePlayer(dt) {
  const move = movementInput();
  const grounded = isGrounded();
  const running = down("KeyZ") && down("KeyW");
  const targetSpeed = running ? CONFIG.runSpeed : CONFIG.walkSpeed;
  const targetX = move.x * targetSpeed;
  const targetZ = move.z * targetSpeed;
  const velocity = playerBody.linvel();
  const acceleration = grounded ? CONFIG.groundAcceleration : CONFIG.airAcceleration;
  const braking = grounded ? CONFIG.groundBraking : CONFIG.airAcceleration;

  // 速度差から必要な加速度を作り、質量を考慮したImpulseとしてRapierへ渡します。
  // 位置を直接書き換えないため、衝突・重力・落下は物理エンジンが処理します。
  const dx = targetX - velocity.x;
  const dz = targetZ - velocity.z;
  const limit = (move.lengthSq() > 0 ? acceleration : braking) * dt;
  const changeX = THREE.MathUtils.clamp(dx, -limit, limit);
  const changeZ = THREE.MathUtils.clamp(dz, -limit, limit);
  playerBody.applyImpulse({
    x: changeX * CONFIG.playerMass,
    y: 0,
    z: changeZ * CONFIG.playerMass
  }, true);

  // ジャンプは接地中だけ許可。SpaceまたはZ以外の移動キーを邪魔しない構造です。
  if (down("Space") && grounded && !playerBody.userData?.jumpLatch) {
    playerBody.applyImpulse({ x: 0, y: CONFIG.jumpSpeed * CONFIG.playerMass, z: 0 }, true);
    playerBody.userData = { jumpLatch: true };
  }
  if (!down("Space")) playerBody.userData = { jumpLatch: false };

  // 動いている方向へ身体を向けます。回転は物理ボディを直接回さず表示側だけで行います。
  // プレイヤーの衝突姿勢はlockRotationsで安定させています。
  if (move.lengthSq() > 0.0001) {
    const desiredYaw = Math.atan2(move.x, move.z);
    playerModel.rotation.y = THREE.MathUtils.lerpAngle(playerModel.rotation.y, desiredYaw, 1 - Math.exp(-12 * dt));
  }

  animateHumanoid(playerModel, Math.hypot(velocity.x, velocity.z), dt, grounded, running);
}

function animateHumanoid(model, speed, dt, grounded, running) {
  const limbs = model.userData.limbs;
  const moving = speed > 0.35;
  const frequency = running ? 11 : 8;
  model.userData.phase += dt * frequency * (moving ? 1 : 0.15);
  const swing = moving && grounded ? Math.sin(model.userData.phase) * (running ? 0.72 : 0.48) : 0;

  limbs.thighL.rotation.x = swing;
  limbs.thighR.rotation.x = -swing;
  limbs.shinL.rotation.x = Math.max(0, -swing) * 0.45;
  limbs.shinR.rotation.x = Math.max(0, swing) * 0.45;
  limbs.upperArmL.rotation.x = -swing * 0.72;
  limbs.upperArmR.rotation.x = swing * 0.72;
  limbs.foreArmL.rotation.x = -swing * 0.22;
  limbs.foreArmR.rotation.x = swing * 0.22;

  // 空中では手足を少し戻し、空中姿勢を表現します。
  if (!grounded) {
    limbs.thighL.rotation.x = 0.16;
    limbs.thighR.rotation.x = 0.16;
    limbs.upperArmL.rotation.x = -0.22;
    limbs.upperArmR.rotation.x = -0.22;
  }
}

function updateNPCs(dt) {
  for (const npc of npcs) {
    npc.thinkTimer -= dt;
    const p = npc.body.translation();
    if (npc.thinkTimer <= 0 || npc.target.distanceToSquared(new THREE.Vector3(p.x, 0, p.z)) < 2.2) {
      npc.thinkTimer = CONFIG.npcThinkInterval + Math.random() * 0.7;
      npc.target.set(
        p.x + (Math.random() - 0.5) * 22,
        0,
        p.z + (Math.random() - 0.5) * 22
      );
    }

    const dx = npc.target.x - p.x;
    const dz = npc.target.z - p.z;
    const len = Math.hypot(dx, dz);
    const speed = len > 1 ? npc.speed : 0;
    const v = npc.body.linvel();
    const desiredX = len ? dx / len * speed : 0;
    const desiredZ = len ? dz / len * speed : 0;
    const mass = 65;
    const limit = 10 * dt;
    npc.body.applyImpulse({
      x: THREE.MathUtils.clamp(desiredX - v.x, -limit, limit) * mass,
      y: 0,
      z: THREE.MathUtils.clamp(desiredZ - v.z, -limit, limit) * mass
    }, true);

    if (speed > 0.2) {
      npc.model.rotation.y = THREE.MathUtils.lerpAngle(npc.model.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-8 * dt));
    }
    animateHumanoid(npc.model, Math.hypot(v.x, v.z), dt, true, false);
  }
}

function updateCamera(dt) {
  // 矢印キーは移動と同時に押しても成立するよう、カメラ入力としても独立処理します。
  if (down("ArrowLeft")) cameraYaw += CONFIG.cameraYawSpeed * dt;
  if (down("ArrowRight")) cameraYaw -= CONFIG.cameraYawSpeed * dt;
  if (down("ArrowUp")) cameraPitch += CONFIG.cameraPitchSpeed * dt;
  if (down("ArrowDown")) cameraPitch -= CONFIG.cameraPitchSpeed * dt;
  cameraPitch = THREE.MathUtils.clamp(cameraPitch, CONFIG.cameraPitchMin, CONFIG.cameraPitchMax);

  const p = playerBody.translation();
  const target = tmpA.set(p.x, p.y + CONFIG.cameraLookHeight, p.z);
  const horizontal = Math.cos(cameraPitch) * CONFIG.cameraDistance;
  const desired = tmpB.set(
    p.x - Math.sin(cameraYaw) * horizontal,
    p.y + CONFIG.cameraHeight + Math.sin(cameraPitch) * CONFIG.cameraDistance,
    p.z + Math.cos(cameraYaw) * horizontal
  );

  // カメラとプレイヤーの間に地形があれば、カメラを手前へ寄せて地面へのめり込みを防ぎます。
  const origin = { x: target.x, y: target.y, z: target.z };
  const direction = { x: desired.x - target.x, y: desired.y - target.y, z: desired.z - target.z };
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length > 0.001) {
    direction.x /= length;
    direction.y /= length;
    direction.z /= length;
    const ray = new RAPIER.Ray(origin, direction);
    const hit = physicsWorld.castRay(ray, length, true);
    if (hit && hit.toi < length) {
      const safeLength = Math.max(0.8, hit.toi - CONFIG.cameraCollisionPadding);
      desired.set(
        target.x + direction.x * safeLength,
        target.y + direction.y * safeLength,
        target.z + direction.z * safeLength
      );
    }
  }

  const blend = 1 - Math.exp(-CONFIG.cameraSmoothing * dt);
  camera.position.lerp(desired, blend);
  camera.lookAt(target);
}

function updateSun(dt) {
  gameHours = (gameHours + dt * 24 / CONFIG.dayLengthSeconds) % 24;
  const radians = (gameHours - 6) / 24 * Math.PI * 2;
  const altitude = Math.sin(radians);
  const azimuth = radians + Math.PI * 0.18;
  const horizontal = Math.cos(radians);
  const distance = 110;

  sunMesh.position.set(
    Math.cos(azimuth) * horizontal * distance,
    altitude * distance + 18,
    Math.sin(azimuth) * horizontal * distance
  );
  sunLight.position.copy(sunMesh.position);
  sunLight.target.position.set(0, 0, 0);

  // 高度から昼夜を連続的に作ります。夜間は太陽光を完全な0にはせず、ごく弱く残します。
  const daylight = THREE.MathUtils.smoothstep(altitude, -0.12, 0.18);
  sunLight.intensity = 0.04 + CONFIG.sunIntensity * daylight;
  hemiLight.intensity = THREE.MathUtils.lerp(CONFIG.ambientNightIntensity, CONFIG.ambientDayIntensity, daylight);
  scene.background.setHSL(0.56, 0.12, THREE.MathUtils.lerp(0.055, 0.61, daylight));
  scene.fog.color.copy(scene.background);

  const clockText = document.getElementById("clock");
  const h = Math.floor(gameHours).toString().padStart(2, "0");
  const m = Math.floor((gameHours % 1) * 60).toString().padStart(2, "0");
  clockText.textContent = `${h}:${m}`;
}

function syncVisuals() {
  // ここで初めて物理結果をThree.jsへ反映します。物理→内部状態→表示の一方向です。
  const p = playerBody.translation();
  playerModel.position.set(p.x, p.y - 1.10, p.z);

  for (const npc of npcs) {
    const n = npc.body.translation();
    npc.model.position.set(n.x, n.y - 1.02, n.z);
  }
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

async function boot() {
  const loading = document.getElementById("loading");
  const error = document.getElementById("error");
  try {
    physicsWorld = await initPhysics();
    setupScene();
    buildTerrain();
    createPlayer();

    const rocks = [
      [-12, -10, 1.4], [8, -16, 0.9], [21, 8, 1.6], [-26, 17, 1.1],
      [32, -26, 1.9], [-38, -30, 1.5], [44, 22, 1.2], [-4, 29, 0.8],
      [14, 34, 1.3], [-31, 2, 0.75], [39, -4, 0.95], [-48, 36, 1.7]
    ];
    rocks.forEach(([x, z, s]) => addRock(x, z, s));
    for (let i = 0; i < CONFIG.npcCount; i++) createNPC(i);

    window.addEventListener("resize", onResize);
    loading.hidden = true;
    document.getElementById("hud").hidden = false;
    document.getElementById("status").textContent = "WORLD ONLINE // PLAYER PHYSICS ONLINE";

    clock.start();
    requestAnimationFrame(frame);
  } catch (err) {
    console.error(err);
    loading.hidden = true;
    error.hidden = false;
    error.textContent = `WORLD INITIALIZATION FAILED\n\n${err?.stack ?? err}`;
  }
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);

  updatePlayer(dt);
  updateNPCs(dt);
  updateSun(dt);

  // Rapierを進めたあと、物理状態を表示へ同期します。
  // これが#6の「内部情報と見た目の情報を丁重に扱う」ための中心部分です。
  physicsWorld.step();
  syncVisuals();
  updateCamera(dt);

  renderer.render(scene, camera);
}

boot();

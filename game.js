/*
 * WASTELAND // FIELD TEST
 *
 * 3Dゲーム本体。
 *
 * 設計上の重要点:
 * 1. Rapierが物理状態の正本です。Three.jsのモデルを先に動かしてから物理を合わせることはしません。
 * 2. Three.jsは物理結果を画面へ表示する役割です。
 * 3. 入力は「押されているキーの集合」で管理するため、3キー以上の同時押しに対応します。
 * 4. 外部モデルを使わず、ブラウザだけで動く低負荷な人型モデルを生成します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import RAPIER from "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.0/+esm";

const CONFIG = {
  // ワールドサイズ。大きくすると探索範囲は広がりますが物理・描画負荷も増えます。
  worldSize: 180,
  terrainSegments: 56,
  terrainHeight: 5.5,

  // プレイヤーの物理パラメータ。カプセルの寸法と質量をここで調整します。
  playerRadius: 0.38,
  playerHalfHeight: 0.72,
  playerMass: 72,
  walkSpeed: 4.0,
  runSpeed: 7.4,
  acceleration: 22,
  airControl: 0.25,

  // カメラ。distance / heightを変えると三人称視点の距離・高さが変わります。
  cameraDistance: 6.4,
  cameraHeight: 3.0,
  cameraSmoothing: 8.0,
  cameraLookHeight: 1.15,
  cameraPitchMin: -0.45,
  cameraPitchMax: 0.75,

  // ゲーム内時間。1秒で何ゲーム分進むか。
  dayLengthSeconds: 240,
  startTimeHours: 9.5,

  // NPC数。NPCはプレイヤーより軽量ですが、物理・AI・人型表示を維持します。
  npcCount: 14,
  npcWalkSpeed: 1.7,
  npcRunSpeed: 3.2,
  npcThinkInterval: 0.35,

  // 太陽の見え方。光量を極端にせず、空・太陽・環境光を連動させます。
  sunIntensity: 3.0,
  ambientDayIntensity: 0.55,
  ambientNightIntensity: 0.12
};

let scene, camera, renderer;
let physicsWorld;
let playerBody, playerCollider;
let playerModel;
const npcs = [];
const keys = new Set();
const clock = new THREE.Clock();

let gameHours = CONFIG.startTimeHours;
let cameraYaw = Math.PI;
let cameraPitch = 0.22;
let sunLight, sunMesh, hemiLight;
let terrainMesh;

const tmpVec3 = new THREE.Vector3();
const tmpVec3b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

window.addEventListener("keydown", (event) => {
  keys.add(event.code);
  // 矢印キーはページスクロールに使わせず、ゲーム側のカメラ入力として扱います。
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
    event.preventDefault();
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => keys.clear());

function isDown(...codes) {
  return codes.some((code) => keys.has(code));
}

function makeMaterial(color, roughness = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 });
}

function createHumanoid(options = {}) {
  // 人型は頭・胴体・上腕・前腕・大腿・下腿に分け、最低限の関節構造を持たせます。
  // NPCも単なる箱にはせず、プレイヤーと同じ基本的な身体構造を使います。
  const group = new THREE.Group();
  const skin = makeMaterial(options.skin ?? 0xb98468);
  const shirt = makeMaterial(options.shirt ?? 0x4f5d62);
  const pants = makeMaterial(options.pants ?? 0x30343b);
  const shoe = makeMaterial(0x202225);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.62, 5, 10), shirt);
  torso.position.y = 1.18;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.29, 12, 8), skin);
  head.position.y = 2.02;
  group.add(head);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.16, 8), skin);
  neck.position.y = 1.75;
  group.add(neck);

  const createLimb = (radius, length, material, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 7), material);
    mesh.position.y = -length * 0.5;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  };

  const upperArmL = createLimb(0.105, 0.42, shirt, -0.43, 1.47);
  const upperArmR = createLimb(0.105, 0.42, shirt, 0.43, 1.47);
  const foreArmL = createLimb(0.095, 0.40, skin, -0.43, 1.05);
  const foreArmR = createLimb(0.095, 0.40, skin, 0.43, 1.05);
  const thighL = createLimb(0.14, 0.48, pants, -0.19, 0.76);
  const thighR = createLimb(0.14, 0.48, pants, 0.19, 0.76);
  const shinL = createLimb(0.105, 0.52, pants, -0.19, 0.28);
  const shinR = createLimb(0.105, 0.52, pants, 0.19, 0.28);

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

function createTerrain() {
  const size = CONFIG.worldSize;
  const segments = CONFIG.terrainSegments;
  const count = (segments + 1) * (segments + 1);
  const positions = new Float32Array(count * 3);
  const heights = new Float32Array(count);
  const indices = [];

  const heightAt = (x, z) => {
    // 複数の低周波ノイズを重ねて、荒野らしい緩い起伏を作ります。
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
      const y = heightAt(x, z);
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
  terrainMesh = new THREE.Mesh(geometry, makeMaterial(0x5b5747));
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  // 同じ高さ配列からRapierのHeightfieldを作るため、見た目と衝突面を同じデータから生成します。
  const scale = { x: size / segments, y: 1, z: size / segments };
  const terrainCollider = RAPIER.ColliderDesc.heightfield(segments + 1, segments + 1, heights, scale);
  physicsWorld.createCollider(terrainCollider);
}

function createRock(x, z, scale = 1) {
  const y = 1.0;
  const group = new THREE.Group();
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), makeMaterial(0x5f625e));
  rock.scale.set(1.25 * scale, 0.75 * scale, 0.95 * scale);
  rock.rotation.set(Math.random(), Math.random(), Math.random());
  group.add(rock);
  group.position.set(x, y, z);
  rock.castShadow = true;
  rock.receiveShadow = true;
  scene.add(group);

  // 岩の見た目に対応する固定コライダー。自然物も物理世界の一部として扱います。
  const body = physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  const collider = RAPIER.ColliderDesc.ball(0.95 * scale).setFriction(0.9).setRestitution(0.08);
  physicsWorld.createCollider(collider, body);
}

function createPlayer() {
  playerBody = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 7, 0)
      .setLinearDamping(1.2)
      .setAngularDamping(10)
      .lockRotations()
  );
  playerCollider = physicsWorld.createCollider(
    RAPIER.ColliderDesc.capsule(CONFIG.playerHalfHeight, CONFIG.playerRadius)
      .setMass(CONFIG.playerMass)
      .setFriction(0.8)
      .setRestitution(0.0),
    playerBody
  );
  playerModel = createHumanoid({ shirt: 0x536a78, pants: 0x34383e });
  scene.add(playerModel);
}

function createNPC(index) {
  const angle = (index / CONFIG.npcCount) * Math.PI * 2;
  const radius = 12 + (index % 4) * 7;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const body = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, 7, z)
      .setLinearDamping(1.5)
      .setAngularDamping(10)
      .lockRotations()
  );
  const collider = physicsWorld.createCollider(
    RAPIER.ColliderDesc.capsule(0.68, 0.34)
      .setMass(65)
      .setFriction(0.8), body
  );
  const model = createHumanoid({
    shirt: new THREE.Color().setHSL((index * 0.13) % 1, 0.28, 0.38).getHex(),
    pants: 0x30333a
  });
  model.scale.setScalar(0.96);
  scene.add(model);

  npcs.push({
    body, collider, model,
    target: new THREE.Vector3(x, 0, z),
    nextThink: Math.random() * CONFIG.npcThinkInterval,
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

  // 太陽そのものを小さな発光球として表示。実際の照明はDirectionalLightが担当します。
  sunMesh = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffe6a3 }));
  scene.add(sunMesh);

  createTerrain();
  createPlayer();

  // 遠景だけでなく足元にも自然物を置き、探索空間に視覚的な密度を作ります。
  const rocks = [
    [-13, -8, 1.8], [18, -14, 1.4], [-27, 15, 2.2], [32, 22, 1.6],
    [-39, -26, 1.2], [7, 31, 1.9], [43, -4, 1.5], [-4, -38, 1.7],
    [52, 35, 2.4], [-54, 30, 1.8], [26, 48, 1.2], [-45, -47, 2.1]
  ];
  rocks.forEach(([x, z, s]) => createRock(x, z, s));
  for (let i = 0; i < CONFIG.npcCount; i++) createNPC(i);
}

function updateSun(delta) {
  gameHours = (gameHours + delta * 24 / CONFIG.dayLengthSeconds) % 24;
  const dayAngle = (gameHours - 6) / 24 * Math.PI * 2;
  const altitude = Math.sin(dayAngle);
  const azimuth = dayAngle * 0.82;

  // 太陽高度と方位から光源位置を計算します。高度が低いほど光線が横から入り、影が長くなります。
  const horizontal = Math.cos(dayAngle) * 75;
  const y = altitude * 75;
  const x = horizontal * Math.cos(azimuth);
  const z = horizontal * Math.sin(azimuth);
  sunLight.position.set(x, y, z);
  sunLight.target.position.set(0, 0, 0);
  sunMesh.position.copy(sunLight.position);

  const daylight = THREE.MathUtils.clamp((altitude + 0.12) / 0.55, 0, 1);
  const twilight = THREE.MathUtils.clamp((altitude + 0.3) / 0.5, 0, 1);
  sunLight.intensity = CONFIG.sunIntensity * daylight;
  hemiLight.intensity = THREE.MathUtils.lerp(CONFIG.ambientNightIntensity, CONFIG.ambientDayIntensity, twilight);

  // 昼夜に合わせて空・霧も連動させます。
  const sky = new THREE.Color();
  sky.setHSL(0.55 - (1 - twilight) * 0.06, 0.22, 0.28 + twilight * 0.34);
  scene.background.copy(sky);
  scene.fog.color.copy(sky);
  sunMesh.visible = altitude > -0.05;
  sunMesh.scale.setScalar(0.8 + daylight * 0.35);

  document.getElementById("clock").textContent = `${String(Math.floor(gameHours)).padStart(2, "0")}:${String(Math.floor((gameHours % 1) * 60)).padStart(2, "0")}`;
}

function getMovementInput() {
  // W/Sはカメラ前後、A/Dはカメラ左右。矢印キーはカメラ操作へ割り当てるため移動とは分離します。
  const forward = (isDown("KeyW") ? 1 : 0) - (isDown("KeyS") ? 1 : 0);
  const strafe = (isDown("KeyD") ? 1 : 0) - (isDown("KeyA") ? 1 : 0);
  const input = new THREE.Vector2(strafe, forward);
  if (input.lengthSq() > 1) input.normalize();
  return input;
}

function updateCameraInput(delta) {
  const cameraTurn = 1.9 * delta;
  const cameraTilt = 1.35 * delta;
  if (isDown("ArrowLeft")) cameraYaw += cameraTurn;
  if (isDown("ArrowRight")) cameraYaw -= cameraTurn;
  if (isDown("ArrowUp")) cameraPitch = Math.min(CONFIG.cameraPitchMax, cameraPitch + cameraTilt);
  if (isDown("ArrowDown")) cameraPitch = Math.max(CONFIG.cameraPitchMin, cameraPitch - cameraTilt);
}

function updatePlayer(delta) {
  const input = getMovementInput();
  const running = isDown("KeyZ") && isDown("KeyW");
  const speed = running ? CONFIG.runSpeed : CONFIG.walkSpeed;

  const forward = new THREE.Vector3(Math.sin(cameraYaw), 0, Math.cos(cameraYaw)).multiplyScalar(-1);
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  const desired = new THREE.Vector3();
  desired.addScaledVector(forward, input.y).addScaledVector(right, input.x);
  if (desired.lengthSq() > 0) desired.normalize().multiplyScalar(speed);

  const current = playerBody.linvel();
  const grounded = Math.abs(current.y) < 0.45;
  const control = grounded ? 1 : CONFIG.airControl;
  const blend = 1 - Math.exp(-CONFIG.acceleration * control * delta);
  const vx = THREE.MathUtils.lerp(current.x, desired.x, blend);
  const vz = THREE.MathUtils.lerp(current.z, desired.z, blend);

  // Y速度はRapierに任せます。ここで毎フレーム0にすると重力や段差の物理が壊れます。
  playerBody.setLinvel({ x: vx, y: current.y, z: vz }, true);

  const p = playerBody.translation();
  playerModel.position.set(p.x, p.y - CONFIG.playerHalfHeight - CONFIG.playerRadius + 0.02, p.z);
  if (desired.lengthSq() > 0.01) {
    playerModel.rotation.y = Math.atan2(desired.x, desired.z);
  }
  animateHumanoid(playerModel, desired.length() > 0.1 ? (running ? 10 : 6) : 0, delta);
}

function animateHumanoid(model, rate, delta) {
  const limbs = model.userData.limbs;
  if (!limbs) return;
  model.userData.phase += delta * rate;
  const swing = Math.sin(model.userData.phase) * (rate ? 0.42 : 0.04);
  limbs.thighL.rotation.x = swing;
  limbs.thighR.rotation.x = -swing;
  limbs.shinL.rotation.x = -swing * 0.45;
  limbs.shinR.rotation.x = swing * 0.45;
  limbs.upperArmL.rotation.x = -swing * 0.65;
  limbs.upperArmR.rotation.x = swing * 0.65;
  limbs.foreArmL.rotation.x = swing * 0.35;
  limbs.foreArmR.rotation.x = -swing * 0.35;
}

function chooseNPCTarget(npc) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 7 + Math.random() * 28;
  const current = npc.body.translation();
  npc.target.set(current.x + Math.cos(angle) * radius, 0, current.z + Math.sin(angle) * radius);
  npc.target.x = THREE.MathUtils.clamp(npc.target.x, -CONFIG.worldSize / 2 + 5, CONFIG.worldSize / 2 - 5);
  npc.target.z = THREE.MathUtils.clamp(npc.target.z, -CONFIG.worldSize / 2 + 5, CONFIG.worldSize / 2 - 5);
}

function updateNPCs(delta) {
  for (const npc of npcs) {
    npc.nextThink -= delta;
    if (npc.nextThink <= 0) {
      npc.nextThink = CONFIG.npcThinkInterval;
      const dx = npc.target.x - npc.body.translation().x;
      const dz = npc.target.z - npc.body.translation().z;
      if (dx * dx + dz * dz < 9) chooseNPCTarget(npc);
    }

    const p = npc.body.translation();
    const dx = npc.target.x - p.x;
    const dz = npc.target.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const speed = npc.speed;
    const v = npc.body.linvel();
    const blend = 1 - Math.exp(-7 * delta);
    npc.body.setLinvel({ x: THREE.MathUtils.lerp(v.x, dx / len * speed, blend), y: v.y, z: THREE.MathUtils.lerp(v.z, dz / len * speed, blend) }, true);

    npc.model.position.set(p.x, p.y - 0.7, p.z);
    if (len > 0.5) npc.model.rotation.y = Math.atan2(dx, dz);
    animateHumanoid(npc.model, speed > 2.4 ? 9 : 5, delta);
  }
}

function updateCamera(delta) {
  const p = playerBody.translation();
  const target = tmpVec3.set(p.x, p.y + CONFIG.cameraLookHeight, p.z);
  const horizontal = Math.cos(cameraPitch) * CONFIG.cameraDistance;
  const offset = tmpVec3b.set(
    Math.sin(cameraYaw) * horizontal,
    Math.sin(cameraPitch) * CONFIG.cameraDistance + CONFIG.cameraHeight,
    Math.cos(cameraYaw) * horizontal
  );
  const desired = target.clone().add(offset);
  const smooth = 1 - Math.exp(-CONFIG.cameraSmoothing * delta);
  camera.position.lerp(desired, smooth);
  camera.lookAt(target);
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
    await RAPIER.init();
    physicsWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    setupScene();
    window.addEventListener("resize", onResize);
    loading.hidden = true;
    document.getElementById("hud").hidden = false;
    requestAnimationFrame(loop);
  } catch (err) {
    console.error("WORLD INITIALIZATION ERROR", err);
    loading.hidden = true;
    error.hidden = false;
    error.textContent = `WORLD INITIALIZATION FAILED\n${err?.message ?? err}`;
  }
}

function loop() {
  const delta = Math.min(clock.getDelta(), 0.05);
  updateCameraInput(delta);
  updateSun(delta);
  updatePlayer(delta);
  updateNPCs(delta);
  physicsWorld.timestep = delta;
  physicsWorld.step();
  // 物理計算後の位置をモデルへ反映し、表示と内部状態の順序を固定します。
  const pp = playerBody.translation();
  playerModel.position.set(pp.x, pp.y - CONFIG.playerHalfHeight - CONFIG.playerRadius + 0.02, pp.z);
  for (const npc of npcs) {
    const p = npc.body.translation();
    npc.model.position.set(p.x, p.y - 0.7, p.z);
  }
  updateCamera(delta);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

boot();

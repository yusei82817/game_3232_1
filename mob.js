/*
 * WASTELAND // MOB SYSTEM
 *
 * 動物Mobの共通ランタイムです。
 *
 * mobdata/chicken.js・cow.js・pig.jsは「その動物の定義」を担当し、
 * このファイルは生成・移動・逃走・地面への同期・アニメーション更新を担当します。
 * NPCとは別系統にしてあるため、人間NPCのAIを動物へ無理に流用しません。
 *
 * 物理位置はRapierを正とし、Three.jsモデルは毎フレーム物理位置へ同期します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import {
  createDynamicCapsule,
  applyHorizontalSpeed,
  raycastTouch,
  limitHorizontalSpeed
} from "./physics.js";
import { chickenData } from "./mobdata/chicken.js";
import { cowData } from "./mobdata/cow.js";
import { pigData } from "./mobdata/pig.js";

const MOB_DATA = Object.freeze({
  chicken: chickenData,
  cow: cowData,
  pig: pigData
});

function lerpAngle(current, target, alpha) {
  const twoPi = Math.PI * 2;
  const delta = THREE.MathUtils.euclideanModulo(target - current + Math.PI, twoPi) - Math.PI;
  return current + delta * alpha;
}

function animateMob(mob, dt) {
  const velocity = mob.body.linvel();
  const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
  const moving = horizontalSpeed > 0.12;
  mob.phase += dt * (moving ? 6.0 + horizontalSpeed * 1.2 : 1.4);

  const limbs = mob.model.userData.limbs;
  if (!limbs?.legs) return;

  const swing = moving ? Math.sin(mob.phase) * 0.38 : 0;
  for (let i = 0; i < limbs.legs.length; i++) {
    limbs.legs[i].rotation.x = i % 2 === 0 ? swing : -swing;
  }

  // 豚と鶏は停止中に頭・耳をほんの少し動かします。
  if (!moving) {
    if (mob.species === "pig" && limbs.ears) {
      const earSwing = Math.sin(mob.phase * 0.7) * 0.035;
      limbs.ears[0].rotation.x = earSwing;
      limbs.ears[1].rotation.x = -earSwing;
    }
    if (mob.species === "chicken") {
      mob.model.rotation.z = Math.sin(mob.phase * 0.45) * 0.025;
    }
  } else {
    mob.model.rotation.z *= Math.max(0, 1 - dt * 5);
  }
}

export function getMobData(id) {
  return MOB_DATA[id] ?? null;
}

export function getMobTypes() {
  return Object.keys(MOB_DATA);
}

export function createMobManager({
  scene,
  terrainHeightAt,
  physicsWorld,
  playerBody = null,
  isWaterAt = () => false,
  config = {}
}) {
  const mobs = [];
  const random = Math.random;
  const thinkInterval = config.mobThinkInterval ?? 1.2;
  const playerFearDistance = config.mobFearDistance ?? 7.0;

  function isSafeGround(x, z) {
    if (isWaterAt(x, z)) return false;

    const center = terrainHeightAt(x, z);
    const samples = [
      terrainHeightAt(x + 1.5, z),
      terrainHeightAt(x - 1.5, z),
      terrainHeightAt(x, z + 1.5),
      terrainHeightAt(x, z - 1.5)
    ];
    return Math.max(...samples.map((height) => Math.abs(height - center))) < 1.6;
  }

  function chooseWanderTarget(mob, position) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = random() * Math.PI * 2;
      const distance = 5 + random() * 15;
      const x = position.x + Math.cos(angle) * distance;
      const z = position.z + Math.sin(angle) * distance;

      if (isSafeGround(x, z)) {
        mob.target.set(x, 0, z);
        return;
      }
    }

    mob.target.set(
      position.x + Math.cos(mob.directionAngle) * 5,
      0,
      position.z + Math.sin(mob.directionAngle) * 5
    );
  }

  function fleeFromPlayer(mob, position) {
    if (!playerBody) return false;

    const player = playerBody.translation();
    const awayX = position.x - player.x;
    const awayZ = position.z - player.z;
    const distance = Math.hypot(awayX, awayZ);

    if (distance > playerFearDistance || distance < 0.001) return false;

    const nx = awayX / distance;
    const nz = awayZ / distance;
    const fleeDistance = 8 + random() * 9;
    mob.target.set(position.x + nx * fleeDistance, 0, position.z + nz * fleeDistance);
    mob.state = "FLEE";
    mob.stateTimer = 1.5 + random() * 1.5;
    return true;
  }

  function avoidObstacle(mob, position, direction) {
    if (!physicsWorld || direction.lengthSq() < 0.001) return;

    const hit = raycastTouch(
      { x: position.x, y: position.y - 0.25, z: position.z },
      { x: direction.x, y: 0, z: direction.z },
      1.7,
      mob.collider.handle
    );
    if (!hit) return;

    const side = random() < 0.5 ? -1 : 1;
    const steer = new THREE.Vector3(-direction.z * side, 0, direction.x * side);
    direction.lerp(steer, 0.9).normalize();
    mob.state = "AVOID";
  }

  function create(type, { x, z, scale = 1 } = {}) {
    const data = getMobData(type);
    if (!data) throw new Error(`Unknown mob type: ${type}`);

    const startX = x ?? 0;
    const startZ = z ?? 0;
    const startY = terrainHeightAt(startX, startZ) + data.halfHeight + data.radius + 0.08;
    const finalScale = data.scale * scale;

    const physics = createDynamicCapsule({
      x: startX,
      y: startY,
      z: startZ,
      radius: data.radius,
      halfHeight: data.halfHeight,
      mass: data.mass,
      friction: 0.85,
      damping: 1.4
    });

    const model = data.createModel();
    model.scale.setScalar(finalScale);
    model.castShadow = true;
    model.receiveShadow = true;
    scene.add(model);

    const mob = {
      type,
      species: data.id,
      data,
      body: physics.body,
      collider: physics.collider,
      model,
      target: new THREE.Vector3(startX, 0, startZ),
      directionAngle: random() * Math.PI * 2,
      thinkTimer: random() * thinkInterval,
      stateTimer: 0,
      phase: random() * Math.PI * 2,
      state: "WANDER"
    };

    chooseWanderTarget(mob, { x: startX, z: startZ });
    mobs.push(mob);
    return mob;
  }

  function updateMob(mob, dt) {
    mob.thinkTimer -= dt;
    mob.stateTimer -= dt;

    const position = mob.body.translation();
    const fleeing = fleeFromPlayer(mob, position);
    const targetDistance = Math.hypot(
      position.x - mob.target.x,
      position.z - mob.target.z
    );

    if (mob.stateTimer <= 0 && mob.state !== "FLEE") {
      mob.state = "WANDER";
    }

    if (!fleeing && (mob.thinkTimer <= 0 || targetDistance < 1.3)) {
      mob.thinkTimer = thinkInterval * (0.7 + random() * 0.8);
      chooseWanderTarget(mob, position);
    }

    const direction = new THREE.Vector3(
      mob.target.x - position.x,
      0,
      mob.target.z - position.z
    );

    if (direction.lengthSq() > 0.001) direction.normalize();
    else direction.set(Math.sin(mob.directionAngle), 0, Math.cos(mob.directionAngle));

    avoidObstacle(mob, position, direction);

    const desiredAngle = Math.atan2(direction.x, direction.z);
    mob.directionAngle = lerpAngle(
      mob.directionAngle,
      desiredAngle,
      1 - Math.exp(-5.0 * dt)
    );

    const fleeMultiplier = mob.state === "FLEE" ? mob.data.fleeSpeedMultiplier : 1;
    const targetSpeed = mob.data.speed * fleeMultiplier;
    const targetX = Math.sin(mob.directionAngle) * targetSpeed;
    const targetZ = Math.cos(mob.directionAngle) * targetSpeed;

    applyHorizontalSpeed(mob.body, {
      targetX,
      targetZ,
      acceleration: mob.data.acceleration,
      braking: mob.data.acceleration * 1.35,
      mass: mob.data.mass,
      dt
    });
    limitHorizontalSpeed(mob.body, targetSpeed * 1.08);

    mob.model.rotation.y = lerpAngle(
      mob.model.rotation.y,
      mob.directionAngle,
      1 - Math.exp(-6.0 * dt)
    );

    animateMob(mob, dt);
  }

  function update(dt) {
    for (const mob of mobs) updateMob(mob, dt);
  }

  function syncVisuals() {
    for (const mob of mobs) {
      const position = mob.body.translation();
      const groundY = terrainHeightAt(position.x, position.z);
      const expectedY = groundY + mob.data.halfHeight + mob.data.radius + 0.08;

      // Rapierの落下結果を優先し、モデルだけ地面に合わせて浮かせたりはしません。
      mob.model.position.set(position.x, position.y - mob.data.halfHeight - mob.data.radius - 0.08, position.z);
      mob.model.userData.groundY = groundY;
      mob.model.userData.expectedGroundY = expectedY;
    }
  }

  function spawn(type, options = {}) {
    return create(type, options);
  }

  function spawnMany(type, count, area = {}) {
    const result = [];
    const radius = area.radius ?? 20;
    const centerX = area.x ?? 0;
    const centerZ = area.z ?? 0;

    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const angle = random() * Math.PI * 2;
        const distance = Math.sqrt(random()) * radius;
        const x = centerX + Math.cos(angle) * distance;
        const z = centerZ + Math.sin(angle) * distance;
        if (!isSafeGround(x, z)) continue;
        result.push(create(type, { x, z }));
        break;
      }
    }
    return result;
  }

  function getAll() {
    return mobs;
  }

  return {
    create,
    spawn,
    spawnMany,
    update,
    syncVisuals,
    getAll
  };
}

export { MOB_DATA };

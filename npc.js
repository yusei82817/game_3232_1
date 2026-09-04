/*
 * NPC担当。
 *
 * NPCの生成・AI・移動・向き・アニメーション更新をgame.jsから独立させます。
 * NPCの物理位置はRapierを正とし、Three.jsモデルは毎フレームその位置へ同期します。
 *
 * このファイルでは「ただランダムに歩く」状態から一段進めて、
 * 個体差・加減速・障害物回避・他NPC回避・プレイヤーへの反応を扱います。
 * 速度計算と接触Rayはphysics.jsを司令塔として利用します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { createDynamicCapsule, applyHorizontalSpeed, raycastTouch } from "./physics.js";

export function createNPCManager({ scene, config, terrainHeightAt, mapState, createModel, animateModel, physicsWorld, playerBody }) {
  const npcs = [];
  const nearbyScratch = new THREE.Vector3();

  function createNPC(index) {
    const angle = index / config.npcCount * Math.PI * 2;
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

    const model = createModel({
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
      thinkTimer: Math.random() * config.npcThinkInterval,
      phase: Math.random() * Math.PI * 2,
      speed: config.npcWalkSpeed * (0.88 + Math.random() * 0.28),
      acceleration: 5.5 + Math.random() * 2.5,
      turnRate: 3.5 + Math.random() * 2.5,
      preferredDistance: 4.0 + Math.random() * 3.0,
      wanderBias: Math.random() * Math.PI * 2,
      state: "WANDER",
      stateTimer: 0,
      lastDirection: new THREE.Vector3(0, 0, 1)
    });
  }

  function targetIsSafe(x, z, originX, originZ) {
    if (Math.hypot(x - originX, z - originZ) < 3.0) return false;
    if (mapState?.isWaterAt(x, z)) return false;

    // 地形の高低差が大きすぎる目的地は避け、急斜面への突入を減らします。
    const center = terrainHeightAt(x, z);
    const samples = [
      terrainHeightAt(x + 1.5, z),
      terrainHeightAt(x - 1.5, z),
      terrainHeightAt(x, z + 1.5),
      terrainHeightAt(x, z - 1.5)
    ];
    const maxSlope = Math.max(...samples.map((height) => Math.abs(height - center)));
    return maxSlope < 1.45;
  }

  function chooseTarget(npc, position) {
    // 近い範囲から複数候補を試し、湖・急斜面・極端に近い地点を避けます。
    for (let attempt = 0; attempt < 14; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 6 + Math.random() * 18;
      const x = THREE.MathUtils.clamp(
        position.x + Math.cos(angle) * radius,
        -config.worldSize * 0.46,
        config.worldSize * 0.46
      );
      const z = THREE.MathUtils.clamp(
        position.z + Math.sin(angle) * radius,
        -config.worldSize * 0.46,
        config.worldSize * 0.46
      );

      if (targetIsSafe(x, z, position.x, position.z)) {
        npc.target.set(x, 0, z);
        npc.wanderBias = angle;
        return;
      }
    }

    // 候補が全滅した場合は、現在位置の少し先へ退避させます。
    const angle = npc.wanderBias + (Math.random() - 0.5) * 1.4;
    npc.target.set(
      THREE.MathUtils.clamp(position.x + Math.cos(angle) * 6, -config.worldSize * 0.46, config.worldSize * 0.46),
      0,
      THREE.MathUtils.clamp(position.z + Math.sin(angle) * 6, -config.worldSize * 0.46, config.worldSize * 0.46)
    );
  }

  function applyAvoidance(npc, position, direction) {
    const avoidance = nearbyScratch.set(0, 0, 0);

    // NPC同士が密集した場合は、近い個体から離れる方向へ補正します。
    for (const other of npcs) {
      if (other === npc) continue;
      const otherPosition = other.body.translation();
      const dx = position.x - otherPosition.x;
      const dz = position.z - otherPosition.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq > 16 || distanceSq < 0.0001) continue;

      const distance = Math.sqrt(distanceSq);
      const strength = (4 - distance) / 4;
      avoidance.x += (dx / distance) * strength;
      avoidance.z += (dz / distance) * strength;
    }

    // プレイヤーへ近づきすぎたNPCは、会話ではなく行動として距離を取ります。
    if (playerBody) {
      const playerPosition = playerBody.translation();
      const dx = position.x - playerPosition.x;
      const dz = position.z - playerPosition.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < 36 && distanceSq > 0.0001) {
        const distance = Math.sqrt(distanceSq);
        const strength = (6 - distance) / 6;
        avoidance.x += (dx / distance) * strength * 1.7;
        avoidance.z += (dz / distance) * strength * 1.7;
        if (distance < 3.0) npc.state = "FLEE";
      }
    }

    if (avoidance.lengthSq() > 0.001) {
      avoidance.normalize();
      direction.lerp(avoidance, Math.min(0.72, avoidance.length() + 0.18)).normalize();
    }
  }

  function obstacleAvoidance(npc, position, direction) {
    if (!physicsWorld) return;

    // 前方を短いRayで確認し、岩などの固定コリジョンへ正面衝突し続けないようにします。
    const origin = { x: position.x, y: position.y - 0.35, z: position.z };
    const hit = raycastTouch(
      origin,
      { x: direction.x, y: 0, z: direction.z },
      2.4,
      npc.collider.handle
    );
    if (!hit) return;

    const side = Math.random() < 0.5 ? -1 : 1;
    const steer = new THREE.Vector3(-direction.z * side, 0, direction.x * side);
    direction.lerp(steer, 0.75).normalize();
    npc.state = "AVOID";
  }

  function updateNPC(npc, dt) {
    npc.thinkTimer -= dt;
    npc.stateTimer -= dt;

    const position = npc.body.translation();
    const targetDistance = Math.hypot(position.x - npc.target.x, position.z - npc.target.z);

    if (npc.state === "FLEE" && npc.stateTimer <= 0) {
      npc.stateTimer = 1.2 + Math.random() * 1.2;
      const playerPosition = playerBody?.translation();
      if (playerPosition) {
        const away = new THREE.Vector3(position.x - playerPosition.x, 0, position.z - playerPosition.z);
        if (away.lengthSq() > 0.01) away.normalize();
        npc.target.set(
          THREE.MathUtils.clamp(position.x + away.x * (8 + Math.random() * 8), -config.worldSize * 0.46, config.worldSize * 0.46),
          0,
          THREE.MathUtils.clamp(position.z + away.z * (8 + Math.random() * 8), -config.worldSize * 0.46, config.worldSize * 0.46)
        );
      }
    }

    if (npc.thinkTimer <= 0 || targetDistance < 1.7) {
      npc.thinkTimer = 0.35 + Math.random() * 0.65;
      if (npc.state !== "FLEE") npc.state = "WANDER";
      if (npc.state === "WANDER") chooseTarget(npc, position);
    }

    const direction = new THREE.Vector3(
      npc.target.x - position.x,
      0,
      npc.target.z - position.z
    );
    if (direction.lengthSq() > 0.01) direction.normalize();
    else direction.copy(npc.lastDirection);

    applyAvoidance(npc, position, direction);
    obstacleAvoidance(npc, position, direction);
    npc.lastDirection.lerp(direction, 1 - Math.exp(-npc.turnRate * dt)).normalize();

    const targetSpeed = npc.state === "FLEE" ? npc.speed * 1.45 : npc.speed;
    const targetVX = npc.lastDirection.x * targetSpeed;
    const targetVZ = npc.lastDirection.z * targetSpeed;
    const acceleration = npc.state === "AVOID" ? npc.acceleration * 1.35 : npc.acceleration;

    // 速度計算はspeed.jsへphysics.js経由で委譲し、RapierへImpulseを適用します。
    applyHorizontalSpeed(npc.body, {
      targetX: targetVX,
      targetZ: targetVZ,
      acceleration,
      braking: acceleration,
      mass: 65,
      dt
    });

    // 移動方向へ身体を自然に向けます。
    if (npc.lastDirection.lengthSq() > 0.01) {
      const angle = Math.atan2(npc.lastDirection.x, npc.lastDirection.z);
      npc.model.rotation.y = THREE.MathUtils.lerpAngle(
        npc.model.rotation.y,
        angle,
        1 - Math.exp(-npc.turnRate * dt)
      );
    }

    const velocity = npc.body.linvel();
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    const moving = horizontalSpeed > 0.18;
    npc.phase += dt * (moving ? 6.0 + horizontalSpeed * 0.8 : 1.5);

    // 歩行アニメーションはnpc.jsから共通アニメーション関数へ渡します。
    if (animateModel) {
      animateModel(npc.model, horizontalSpeed, true, false, dt, false);
    } else {
      const limbs = npc.model.userData.limbs;
      const swing = moving ? Math.sin(npc.phase) * 0.42 : 0;
      const opposite = -swing;
      limbs.thighL.rotation.x = swing;
      limbs.thighR.rotation.x = opposite;
      limbs.upperArmL.rotation.x = opposite * 0.7;
      limbs.upperArmR.rotation.x = swing * 0.7;
    }
  }

  function update(dt) {
    for (const npc of npcs) updateNPC(npc, dt);
  }

  function syncVisuals() {
    // NPCの表示位置はRapierの物理状態から毎フレーム決定します。
    for (const npc of npcs) {
      const position = npc.body.translation();
      npc.model.position.set(position.x, position.y - 1.04, position.z);
    }
  }

  function createAll() {
    for (let i = 0; i < config.npcCount; i++) createNPC(i);
  }

  function getAll() {
    return npcs;
  }

  return { createAll, update, syncVisuals, getAll };
}

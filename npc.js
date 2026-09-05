/*
 * NPC担当。
 * NPCの生成・AI・移動・向き・アニメーション更新を担当します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { createDynamicCapsule, applyHorizontalSpeed, raycastTouch } from "./physics.js";

function lerpAngle(current, target, alpha) {
  const twoPi = Math.PI * 2;
  const delta = THREE.MathUtils.euclideanModulo(target - current + Math.PI, twoPi) - Math.PI;
  return current + delta * alpha;
}

export function createNPCManager({ scene, config, terrainHeightAt, mapState, createModel, animateModel, physicsWorld, playerBody }) {
  const npcs = [];
  const nearbyScratch = new THREE.Vector3();

  async function createNPC(index) {
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

    const model = await createModel({
      shirt: new THREE.Color().setHSL((index * 0.13) % 1, 0.28, 0.38).getHex(),
      pants: 0x30333a,
      scale: 0.96
    });
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
    const center = terrainHeightAt(x, z);
    const samples = [terrainHeightAt(x + 1.5, z), terrainHeightAt(x - 1.5, z), terrainHeightAt(x, z + 1.5), terrainHeightAt(x, z - 1.5)];
    const maxSlope = Math.max(...samples.map((height) => Math.abs(height - center)));
    return maxSlope < 1.45;
  }

  function chooseTarget(npc, position) {
    for (let attempt = 0; attempt < 14; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 6 + Math.random() * 18;
      const x = position.x + Math.cos(angle) * radius;
      const z = position.z + Math.sin(angle) * radius;
      if (targetIsSafe(x, z, position.x, position.z)) {
        npc.target.set(x, 0, z);
        npc.wanderBias = angle;
        return;
      }
    }
    const angle = npc.wanderBias + (Math.random() - 0.5) * 1.4;
    npc.target.set(position.x + Math.cos(angle) * 6, 0, position.z + Math.sin(angle) * 6);
  }

  function applyAvoidance(npc, position, direction) {
    const avoidance = nearbyScratch.set(0, 0, 0);
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
    const hit = raycastTouch(
      { x: position.x, y: position.y - 0.35, z: position.z },
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
        npc.target.set(position.x + away.x * (8 + Math.random() * 8), 0, position.z + away.z * (8 + Math.random() * 8));
      }
    }

    if (npc.thinkTimer <= 0 || targetDistance < 1.7) {
      npc.thinkTimer = 0.35 + Math.random() * 0.65;
      if (npc.state !== "FLEE") npc.state = "WANDER";
      if (npc.state === "WANDER") chooseTarget(npc, position);
    }

    const direction = new THREE.Vector3(npc.target.x - position.x, 0, npc.target.z - position.z);
    if (direction.lengthSq() > 0.01) direction.normalize();
    else direction.copy(npc.lastDirection);
    applyAvoidance(npc, position, direction);
    obstacleAvoidance(npc, position, direction);
    npc.lastDirection.lerp(direction, 1 - Math.exp(-npc.turnRate * dt)).normalize();

    const targetSpeed = npc.state === "FLEE" ? npc.speed * 1.45 : npc.speed;
    applyHorizontalSpeed(npc.body, {
      targetX: npc.lastDirection.x * targetSpeed,
      targetZ: npc.lastDirection.z * targetSpeed,
      acceleration: npc.state === "AVOID" ? npc.acceleration * 1.35 : npc.acceleration,
      braking: npc.acceleration,
      mass: 65,
      dt
    });

    if (npc.lastDirection.lengthSq() > 0.01) {
      const angle = Math.atan2(npc.lastDirection.x, npc.lastDirection.z);
      npc.model.rotation.y = lerpAngle(npc.model.rotation.y, angle, 1 - Math.exp(-npc.turnRate * dt));
    }

    const velocity = npc.body.linvel();
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    npc.phase += dt * (horizontalSpeed > 0.18 ? 6.0 + horizontalSpeed * 0.8 : 1.5);
    animateModel?.(npc.model, horizontalSpeed, true, false, dt, false);
  }

  function update(dt) {
    for (const npc of npcs) updateNPC(npc, dt);
  }

  function syncVisuals() {
    for (const npc of npcs) {
      const position = npc.body.translation();
      npc.model.position.set(position.x, position.y - 1.04, position.z);
    }
  }

  async function createAll() {
    await Promise.all(Array.from({ length: config.npcCount }, (_, index) => createNPC(index)));
  }

  function getAll() { return npcs; }

  return { createAll, update, syncVisuals, getAll };
}

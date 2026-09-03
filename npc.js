/*
 * NPC担当。
 *
 * NPCの生成・徘徊AI・移動・向き・アニメーション更新をgame.jsから独立させます。
 * game.jsはNPCの細かな判断を持たず、NPCマネージャーへ時間経過を渡すだけにします。
 *
 * NPCの物理位置はRapierを正とし、Three.jsモデルは毎フレームその位置へ同期します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { createDynamicCapsule } from "./physics.js";

export function createNPCManager({ scene, config, terrainHeightAt, mapState, createModel }) {
  const npcs = [];

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
      speed: config.npcWalkSpeed * (0.9 + Math.random() * 0.25)
    });
  }

  function chooseTarget(npc, position) {
    // 水域には不用意に入り込ませず、陸地側から次の移動先を選びます。
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 7 + Math.random() * 16;
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

      if (!mapState?.isWaterAt(x, z)) {
        npc.target.set(x, 0, z);
        return;
      }
    }
  }

  function updateNPC(npc, dt) {
    npc.thinkTimer -= dt;
    const position = npc.body.translation();

    if (
      npc.thinkTimer <= 0 ||
      Math.hypot(position.x - npc.target.x, position.z - npc.target.z) < 1.8
    ) {
      npc.thinkTimer = 0.45 + Math.random() * 0.6;
      chooseTarget(npc, position);
    }

    const direction = new THREE.Vector3(
      npc.target.x - position.x,
      0,
      npc.target.z - position.z
    );

    if (direction.lengthSq() > 0.01) direction.normalize();

    const velocity = npc.body.linvel();
    const targetVX = direction.x * npc.speed;
    const targetVZ = direction.z * npc.speed;
    const changeX = THREE.MathUtils.clamp(targetVX - velocity.x, -8 * dt, 8 * dt);
    const changeZ = THREE.MathUtils.clamp(targetVZ - velocity.z, -8 * dt, 8 * dt);

    // 直接座標を書き換えず、Rapierへ速度変化に相当するImpulseを与えます。
    npc.body.applyImpulse({ x: changeX * 65, y: 0, z: changeZ * 65 }, true);

    if (direction.lengthSq() > 0.01) {
      const angle = Math.atan2(direction.x, direction.z);
      npc.model.rotation.y = THREE.MathUtils.lerpAngle(
        npc.model.rotation.y,
        angle,
        1 - Math.exp(-8 * dt)
      );
    }

    // game.jsから渡された人型生成関数が作る共通アニメーション情報を利用します。
    const limbs = npc.model.userData.limbs;
    const speed = Math.hypot(velocity.x, velocity.z);
    const moving = speed > 0.2;
    npc.phase += dt * (moving ? 6.0 + speed * 0.8 : 1.5);
    const swing = moving ? Math.sin(npc.phase) * 0.5 * Math.min(speed / config.runSpeed, 1) : 0;
    const opposite = Math.sin(npc.phase + Math.PI) * 0.5 * Math.min(speed / config.runSpeed, 1);

    limbs.thighL.rotation.x = swing;
    limbs.thighR.rotation.x = opposite;
    limbs.shinL.rotation.x = Math.max(0, -swing) * 0.5;
    limbs.shinR.rotation.x = Math.max(0, -opposite) * 0.5;
    limbs.upperArmL.rotation.x = opposite * 0.72;
    limbs.upperArmR.rotation.x = swing * 0.72;
    limbs.foreArmL.rotation.x = -opposite * 0.25;
    limbs.foreArmR.rotation.x = -swing * 0.25;
  }

  function update(dt) {
    for (const npc of npcs) updateNPC(npc, dt);
  }

  function createAll() {
    for (let i = 0; i < config.npcCount; i++) createNPC(i);
  }

  function getAll() {
    return npcs;
  }

  return { createAll, update, getAll };
}

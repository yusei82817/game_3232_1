/*
 * WASTELAND // PLAYER
 *
 * プレイヤー専用の処理をgame.jsから分離したモジュールです。
 * Rapierが内部の物理状態を管理し、このモジュールはその状態に対して
 * 移動・ジャンプ・水中挙動を適用し、Three.jsのモデルへ見た目を反映します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { createDynamicCapsule, RAPIER } from "./physics.js";

const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpMove = new THREE.Vector3();

export function createPlayerController({
  scene,
  config,
  physicsWorld,
  terrainHeightAt,
  mapState,
  createModel,
  getCameraYaw,
  isDown
}) {
  let playerBody = null;
  let playerCollider = null;
  let playerModel = null;
  let jumpLatch = false;

  function movementInput() {
    const cameraYaw = getCameraYaw?.() ?? Math.PI;
    const forward = tmpForward.set(Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    const right = tmpRight.set(Math.cos(cameraYaw), 0, Math.sin(cameraYaw));
    const move = tmpMove.set(0, 0, 0);

    if (isDown("KeyW", "ArrowUp")) move.add(forward);
    if (isDown("KeyS", "ArrowDown")) move.sub(forward);
    if (isDown("KeyD", "ArrowRight")) move.add(right);
    if (isDown("KeyA", "ArrowLeft")) move.sub(right);

    if (move.lengthSq() > 1) move.normalize();
    return move;
  }

  function isGrounded() {
    const translation = playerBody.translation();
    const velocity = playerBody.linvel();
    if (velocity.y > 1.0) return false;

    const ray = new RAPIER.Ray(
      { x: translation.x, y: translation.y - config.playerHalfHeight, z: translation.z },
      { x: 0, y: -1, z: 0 }
    );
    const hit = physicsWorld.castRay(
      ray,
      config.groundProbeLength,
      true,
      undefined,
      undefined,
      playerCollider.handle
    );
    return hit !== null;
  }

  function getWaterInfo() {
    if (!mapState || !playerBody) {
      return { isWater: false, surfaceY: 0, depth: 0, shoreFactor: 0 };
    }
    const position = playerBody.translation();
    return mapState.getWaterInfoAt(position.x, position.z);
  }

  function playerMassSafe() {
    return Math.max(1, config.playerMass);
  }

  function applyWaterPhysics(dt, waterInfo) {
    if (!waterInfo.isWater) {
      playerModel.userData.inWater = false;
      playerModel.userData.submerged = 0;
      playerModel.userData.waterSurfaceY = waterInfo.surfaceY ?? 0;
      return;
    }

    const position = playerBody.translation();
    const velocity = playerBody.linvel();
    const capsuleBottom = position.y - config.playerHalfHeight;
    const capsuleHeight = config.playerHalfHeight * 2;
    const submerged = THREE.MathUtils.clamp(
      (waterInfo.surfaceY - capsuleBottom) / capsuleHeight,
      0,
      1
    );

    if (submerged <= 0) {
      playerModel.userData.inWater = false;
      playerModel.userData.submerged = 0;
      playerModel.userData.waterSurfaceY = waterInfo.surfaceY;
      return;
    }

    const buoyancyImpulse = config.playerMass * 9.81 * config.waterBuoyancy * submerged * dt;
    playerBody.applyImpulse({ x: 0, y: buoyancyImpulse, z: 0 }, true);

    if (velocity.y < -1.8) {
      playerBody.setLinvel({
        x: velocity.x,
        y: velocity.y * 0.72,
        z: velocity.z
      }, true);
    }

    if (isDown("Space")) {
      const verticalDelta = config.swimUpSpeed - velocity.y;
      const change = THREE.MathUtils.clamp(verticalDelta, -2.0, 2.0) * dt;
      playerBody.applyImpulse({
        x: 0,
        y: change * playerMassSafe(),
        z: 0
      }, true);
    }

    const drag = Math.max(0, 1 - 2.2 * submerged * dt);
    const currentVelocity = playerBody.linvel();
    playerBody.setLinvel({
      x: velocity.x * drag,
      y: currentVelocity.y,
      z: velocity.z * drag
    }, true);

    playerModel.userData.inWater = true;
    playerModel.userData.submerged = submerged;
    playerModel.userData.waterSurfaceY = waterInfo.surfaceY;
  }

  function update(dt) {
    const move = movementInput();
    const waterInfo = getWaterInfo();
    const inWater = waterInfo.isWater && waterInfo.depth > 0.35;
    const grounded = isGrounded() && !inWater;
    const running = isDown("KeyZ") && isDown("KeyW") && !inWater;

    const targetSpeed = inWater
      ? config.swimSpeed
      : (running ? config.runSpeed : config.walkSpeed);
    const targetVX = move.x * targetSpeed;
    const targetVZ = move.z * targetSpeed;
    const velocity = playerBody.linvel();

    const acceleration = inWater
      ? config.swimAcceleration
      : (grounded ? config.groundAcceleration : config.airAcceleration);
    const braking = inWater ? config.swimBraking : config.groundBraking;
    const hasInput = move.lengthSq() > 0.001;
    const rate = hasInput ? acceleration : braking;
    const maxChange = rate * dt;
    const changeX = THREE.MathUtils.clamp(targetVX - velocity.x, -maxChange, maxChange);
    const changeZ = THREE.MathUtils.clamp(targetVZ - velocity.z, -maxChange, maxChange);

    playerBody.applyImpulse({
      x: changeX * config.playerMass,
      y: 0,
      z: changeZ * config.playerMass
    }, true);

    if (!inWater && isDown("Space") && grounded && !jumpLatch) {
      const currentVelocity = playerBody.linvel();
      playerBody.setLinvel({
        x: currentVelocity.x,
        y: config.jumpSpeed,
        z: currentVelocity.z
      }, true);
      jumpLatch = true;
    }
    if (!isDown("Space")) jumpLatch = false;

    applyWaterPhysics(dt, waterInfo);

    animateHumanoid(
      playerModel,
      Math.hypot(velocity.x, velocity.z),
      grounded,
      running,
      dt,
      inWater,
      config
    );
  }

  function syncVisual() {
    if (!playerBody || !playerModel) return;
    const position = playerBody.translation();
    playerModel.position.set(position.x, position.y - 1.10, position.z);
  }

  function create() {
    const physics = createDynamicCapsule({
      x: 0,
      y: terrainHeightAt(0, 0) + 2.4,
      z: 0,
      radius: config.playerRadius,
      halfHeight: config.playerHalfHeight,
      mass: config.playerMass,
      friction: 0.82,
      damping: 0.8
    });

    playerBody = physics.body;
    playerCollider = physics.collider;
    playerModel = createModel({ shirt: 0x536a78, pants: 0x34383e });
    scene.add(playerModel);
  }

  return {
    create,
    update,
    syncVisual,
    getWaterInfo,
    getBody: () => playerBody,
    getCollider: () => playerCollider,
    getModel: () => playerModel
  };
}

export function animateHumanoid(model, speed, grounded, running, dt, inWater = false, config = null) {
  const limbs = model?.userData?.limbs;
  if (!limbs) return;

  const runSpeed = config?.runSpeed ?? 7.4;
  const walkSpeed = config?.walkSpeed ?? 4.0;

  model.userData.phase += dt * (speed > 0.15 ? (running ? 10 : 7) : 1.5);
  const intensity = Math.min(speed / (running ? runSpeed : walkSpeed), 1);

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

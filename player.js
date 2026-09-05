/*
 * WASTELAND // PLAYER
 *
 * プレイヤー専用の処理をgame.jsから分離したモジュールです。
 * Rapierが内部の物理状態を管理し、このモジュールはその状態に対して
 * 移動・ジャンプ・水中挙動を適用し、Three.jsのモデルへ見た目を反映します。
 *
 * 物理計算そのものはphysics.jsを司令塔として利用し、gravity.js・speed.js・touch.jsへ分担します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import {
  createDynamicCapsule,
  applyHorizontalSpeed,
  applyWaterSpeedDrag,
  applyWaterBuoyancy,
  dampWaterFall,
  checkGrounded
} from "./physics.js";
import { animateHumanoid } from "./animation.js";

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
    return checkGrounded(playerBody, playerCollider, {
      halfHeight: config.playerHalfHeight,
      probeLength: config.groundProbeLength
    });
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

    // 浮力はgravity.js、水による水平抵抗はspeed.jsへphysics.js経由で委譲します。
    applyWaterBuoyancy(playerBody, {
      mass: config.playerMass,
      submerged,
      buoyancy: config.waterBuoyancy,
      gravityMagnitude: 9.81,
      dt
    });
    dampWaterFall(playerBody);

    if (isDown("Space")) {
      const velocity = playerBody.linvel();
      const verticalDelta = config.swimUpSpeed - velocity.y;
      const change = THREE.MathUtils.clamp(verticalDelta, -2.0, 2.0) * dt;
      playerBody.applyImpulse({
        x: 0,
        y: change * playerMassSafe(),
        z: 0
      }, true);
    }

    applyWaterSpeedDrag(playerBody, {
      submerged,
      drag: 2.2,
      dt
    });

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

    const acceleration = inWater
      ? config.swimAcceleration
      : (grounded ? config.groundAcceleration : config.airAcceleration);
    const braking = inWater ? config.swimBraking : config.groundBraking;

    // speed.jsへ速度差からの加速・減速を委譲します。
    applyHorizontalSpeed(playerBody, {
      targetX: targetVX,
      targetZ: targetVZ,
      acceleration,
      braking,
      mass: config.playerMass,
      dt
    });

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

    // 移動している方向へ胴体を滑らかに向けます。
    // 物理Bodyそのものは回転させず、見た目のモデルだけを向けることで
    // lockRotations()を使っているプレイヤーの物理姿勢を壊さないようにします。
    const currentVelocity = playerBody.linvel();
    const horizontalSpeed = Math.hypot(currentVelocity.x, currentVelocity.z);
    if (horizontalSpeed > 0.12) {
      const targetYaw = Math.atan2(currentVelocity.x, currentVelocity.z);
      const currentYaw = playerModel.rotation.y;
      const yawDelta = Math.atan2(
        Math.sin(targetYaw - currentYaw),
        Math.cos(targetYaw - currentYaw)
      );
      const turnRate = inWater ? 7.0 : 10.0;
      playerModel.rotation.y += yawDelta * Math.min(1, turnRate * dt);
    }

    // アニメーションにはこのフレームで計算された現在速度を渡します。
    animateHumanoid(
      playerModel,
      horizontalSpeed,
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

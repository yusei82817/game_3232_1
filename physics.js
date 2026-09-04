/*
 * WASTELAND // PHYSICS COMMANDER
 *
 * ゲーム内の物理システムを統括する司令塔です。
 * gravity.jsは重力、speed.jsは速度、touch.jsは接触判定を担当し、
 * このファイルはRapier Worldの初期化と各物理モジュールへの橋渡しを担当します。
 *
 * 位置・速度・衝突解決の最終結果はRapierを正とします。
 */

import RAPIER from "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.0/+esm";
import { configureGravity, applyBuoyancy, dampFallingVelocity } from "./gravity.js";
import { accelerateHorizontal, applyWaterDrag, clampHorizontalSpeed } from "./speed.js";
import { isGrounded, groundDistance, castTouchRay } from "./touch.js";

let world = null;

/**
 * Rapierを初期化し、gravity.jsへ標準重力の設定を委譲します。
 * Rapier 0.19.xのcompat版では、初期化オプションを渡さずに呼び出します。
 */
export async function initPhysics() {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  configureGravity(world, -9.81);
  return world;
}

export function getWorld() {
  if (!world) throw new Error("Physics world has not been initialized.");
  return world;
}

/**
 * 動的カプセルを生成します。
 * 重力や移動速度そのものは各物理モジュールが担当し、ここでは物理Bodyの器だけを作ります。
 */
export function createDynamicCapsule({ x, y, z, radius, halfHeight, mass, friction = 0.8, damping = 1.0 }) {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(damping)
      .setAngularDamping(12)
      .lockRotations()
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(halfHeight, radius)
      .setMass(mass)
      .setFriction(friction)
      .setRestitution(0),
    body
  );
  return { body, collider };
}

export function createFixedHeightfield({ rows, cols, heights, scale }) {
  // Rapierのheightfieldは「頂点数」ではなく分割数を受け取ります。
  // Three.js側はsegments+1個の頂点を作るため、rows/colsにはsegmentsを渡します。
  const rapierScale = new RAPIER.Vector3(scale.x, scale.y, scale.z);
  return world.createCollider(
    RAPIER.ColliderDesc.heightfield(rows, cols, heights, rapierScale)
  );
}

export function createFixedBall({ x, y, z, radius, friction = 0.9, restitution = 0.08 }) {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z)
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.ball(radius)
      .setFriction(friction)
      .setRestitution(restitution),
    body
  );
  return { body, collider };
}

/**
 * speed.jsへ水平加速・減速を委譲します。
 * 目標速度ではなく速度差からImpulseを作るため、Rapierの質量を考慮した運動になります。
 */
export function applyHorizontalSpeed(body, options) {
  return accelerateHorizontal(body, options);
}

/**
 * speed.jsへ水中抵抗を委譲します。
 */
export function applyWaterSpeedDrag(body, options) {
  return applyWaterDrag(body, options);
}

/**
 * speed.jsの速度上限処理を委譲します。
 */
export function limitHorizontalSpeed(body, maxSpeed) {
  return clampHorizontalSpeed(body, maxSpeed);
}

/**
 * gravity.jsへ浮力を委譲します。
 */
export function applyWaterBuoyancy(body, options) {
  return applyBuoyancy(body, options);
}

/**
 * gravity.jsへ落下速度の水中減衰を委譲します。
 */
export function dampWaterFall(body, maximumDownwardSpeed = -1.8, factor = 0.72) {
  return dampFallingVelocity(body, maximumDownwardSpeed, factor);
}

/**
 * touch.jsへ接地判定を委譲します。
 */
export function checkGrounded(body, collider, options) {
  return isGrounded(world, body, collider?.handle, options);
}

/**
 * touch.jsへ地面との距離判定を委譲します。
 */
export function getGroundDistance(body, collider, options) {
  return groundDistance(world, body, collider?.handle, options);
}

/**
 * touch.jsへ任意方向のRay接触判定を委譲します。
 */
export function raycastTouch(origin, direction, maxToi, excludeColliderHandle = undefined) {
  return castTouchRay(world, origin, direction, maxToi, excludeColliderHandle);
}

/**
 * Rapierの物理シミュレーションを1ステップ進めます。
 * 呼び出し側が「更新→step→表示同期」の順序を維持することで、Rapierを物理状態の正本にします。
 */
export function stepPhysics() {
  world.step();
}

export { RAPIER };

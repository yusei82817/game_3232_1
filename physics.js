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
 * CCDを有効にして高速移動時の地面すり抜けを防ぎます。
 */
export function createDynamicCapsule({ x, y, z, radius, halfHeight, mass, friction = 0.8, damping = 1.0 }) {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(damping)
      .setAngularDamping(12)
      .setCcdEnabled(true)
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
  // Rapierのheightfieldは分割数を受け取り、height配列は分割数+1の頂点を使用します。
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

export function applyHorizontalSpeed(body, options) {
  return accelerateHorizontal(body, options);
}

export function applyWaterSpeedDrag(body, options) {
  return applyWaterDrag(body, options);
}

export function limitHorizontalSpeed(body, maxSpeed) {
  return clampHorizontalSpeed(body, maxSpeed);
}

export function applyWaterBuoyancy(body, options) {
  return applyBuoyancy(body, options);
}

export function dampWaterFall(body, maximumDownwardSpeed = -1.8, factor = 0.72) {
  return dampFallingVelocity(body, maximumDownwardSpeed, factor);
}

export function checkGrounded(body, collider, options) {
  return isGrounded(world, body, collider?.handle, options);
}

export function getGroundDistance(body, collider, options) {
  return groundDistance(world, body, collider?.handle, options);
}

export function raycastTouch(origin, direction, maxToi, excludeColliderHandle = undefined) {
  return castTouchRay(world, origin, direction, maxToi, excludeColliderHandle);
}

/**
 * Rapierの物理シミュレーションを1ステップ進めます。
 */
export function stepPhysics() {
  world.step();
}

export { RAPIER };

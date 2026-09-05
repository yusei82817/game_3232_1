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
 * CCDを有効にして、高速移動時にも地形をすり抜けにくくします。
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

/**
 * Three.jsの地形と同じ頂点・三角形から固定Meshコリジョンを作ります。
 * 表示メッシュと同じデータを使うので、地面の見た目と物理面を一致させられます。
 */
export function createFixedTrimesh({ vertices, indices }) {
  const vertexData = vertices instanceof Float32Array ? vertices : new Float32Array(vertices);
  const indexData = indices instanceof Uint32Array ? indices : new Uint32Array(indices);
  return world.createCollider(
    RAPIER.ColliderDesc.trimesh(vertexData, indexData)
      .setFriction(0.9)
      .setRestitution(0)
  );
}

/** Heightfield生成API。別の地形で利用できるよう残しています。 */
export function createFixedHeightfield({ rows, cols, heights, scale }) {
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
 * チャンクがアンロードされるとき、対応するRapier物体も削除します。
 * これを行わないと見えない遠方の地形や岩が物理世界に残り続けます。
 */
export function removePhysicsObject(object) {
  if (!world || !object) return;

  if (object.body) {
    world.removeRigidBody(object.body.handle);
    return;
  }

  if (object.collider) {
    world.removeCollider(object.collider.handle, true);
  } else if (typeof object.handle === "number") {
    world.removeCollider(object.handle, true);
  }
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

/** Rapierの物理シミュレーションを1ステップ進めます。 */
export function stepPhysics() {
  world.step();
}

export { RAPIER };

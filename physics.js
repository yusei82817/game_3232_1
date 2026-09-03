/*
 * 物理ワールド担当。
 *
 * game.jsからRapierの細かなAPIを切り離し、「物理状態が正本」という設計を保ちます。
 * プレイヤーやNPCの位置・速度はRapier側を正本とし、Three.jsはその結果を表示します。
 */

import RAPIER from "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.0/+esm";

let world = null;

export async function initPhysics() {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  return world;
}

export function getWorld() {
  if (!world) throw new Error("Physics world has not been initialized.");
  return world;
}

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
  // Three.jsと同じ高さ配列を使うことで、表示メッシュと衝突面を一致させます。
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

export function stepPhysics() {
  world.step();
}

export { RAPIER };

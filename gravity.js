/*
 * WASTELAND // GRAVITY
 *
 * 重力系の処理だけを担当します。
 * Rapier Worldの標準重力はここで設定し、物体ごとに必要な浮力もここへ集約します。
 * 実際の位置・速度はRapierが保持し、このモジュールは力を加える役割に限定します。
 */

const DEFAULT_GRAVITY = -9.81;

/**
 * Rapier Worldへ標準重力を設定します。
 * gravityYを変更するとゲーム全体の重力の強さが変わります。
 */
export function configureGravity(world, gravityY = DEFAULT_GRAVITY) {
  world.gravity = { x: 0, y: gravityY, z: 0 };
}

/**
 * 水中の物体へ浮力を加えます。
 * submergedは0～1で、1に近いほどカプセルが深く水中へ入っています。
 */
export function applyBuoyancy(body, { mass, submerged, buoyancy = 1.0, gravityMagnitude = 9.81, dt }) {
  if (!body || submerged <= 0 || dt <= 0) return;

  const impulse = mass * gravityMagnitude * buoyancy * submerged * dt;
  body.applyImpulse({ x: 0, y: impulse, z: 0 }, true);
}

/**
 * 水中で急激に落下している場合だけ、縦方向の速度を少し減衰させます。
 * 水そのものの抵抗計算はspeed.jsに任せ、ここでは重力方向の補助だけを扱います。
 */
export function dampFallingVelocity(body, maximumDownwardSpeed = -1.8, factor = 0.72) {
  const velocity = body.linvel();
  if (velocity.y >= maximumDownwardSpeed) return;

  body.setLinvel({
    x: velocity.x,
    y: velocity.y * factor,
    z: velocity.z
  }, true);
}

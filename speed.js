/*
 * WASTELAND // SPEED
 *
 * 速度・加速度・減速の計算を担当します。
 * 座標を直接変更することはせず、「現在速度から目標速度へどれだけ近づけるか」を計算して
 * physics.js経由でRapierのBodyへImpulseを適用します。
 */

/**
 * 水平方向の速度を目標速度へ近づけます。
 * accelerationは入力中、brakingは入力がないときの速度変化率です。
 * massを掛けたImpulseを返すため、質量の違う物体でも同じ加速度を作れます。
 */
export function accelerateHorizontal(body, {
  targetX = 0,
  targetZ = 0,
  acceleration,
  braking = acceleration,
  mass = 1,
  dt
}) {
  const velocity = body.linvel();
  const hasTarget = Math.abs(targetX) > 0.001 || Math.abs(targetZ) > 0.001;
  const rate = hasTarget ? acceleration : braking;
  const maxChange = Math.max(0, rate) * Math.max(0, dt);

  const changeX = clamp(targetX - velocity.x, -maxChange, maxChange);
  const changeZ = clamp(targetZ - velocity.z, -maxChange, maxChange);

  body.applyImpulse({
    x: changeX * mass,
    y: 0,
    z: changeZ * mass
  }, true);

  return body.linvel();
}

/**
 * 水中の水平速度を水抵抗で減衰させます。
 * submergedは0～1で、深く潜るほど抵抗が強くなります。
 */
export function applyWaterDrag(body, { submerged, drag = 2.2, dt }) {
  if (submerged <= 0 || dt <= 0) return body.linvel();

  const velocity = body.linvel();
  const factor = Math.max(0, 1 - drag * submerged * dt);

  body.setLinvel({
    x: velocity.x * factor,
    y: velocity.y,
    z: velocity.z * factor
  }, true);

  return body.linvel();
}

/**
 * 速度を指定した上限へ収めます。
 * 必要な場面だけ使い、物理エンジンの自然な衝突速度を不必要に潰さないようにします。
 */
export function clampHorizontalSpeed(body, maxSpeed) {
  if (maxSpeed <= 0) return body.linvel();

  const velocity = body.linvel();
  const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
  if (horizontalSpeed <= maxSpeed || horizontalSpeed < 0.0001) return velocity;

  const factor = maxSpeed / horizontalSpeed;
  body.setLinvel({
    x: velocity.x * factor,
    y: velocity.y,
    z: velocity.z * factor
  }, true);

  return body.linvel();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

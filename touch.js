/*
 * WASTELAND // TOUCH
 *
 * 物理接触を担当します。
 * 接地・地面までの距離・指定Colliderの除外など、Rapierの接触判定をここへ集約します。
 * 実際の衝突解決はRapier自身に任せ、このモジュールは「接触状態を読む」ことに専念します。
 */

import RAPIER from "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.0/+esm";

/**
 * Bodyの足元から下方向へRayを飛ばし、地面へ接触しているかを調べます。
 * excludeColliderHandleには自分自身のColliderを渡すことで自己ヒットを防ぎます。
 */
export function isGrounded(world, body, excludeColliderHandle, { halfHeight, probeLength }) {
  const translation = body.translation();
  const velocity = body.linvel();

  // 上昇中はRayが地面へ届いても「接地」と扱わないようにします。
  if (velocity.y > 1.0) return false;

  const ray = new RAPIER.Ray(
    { x: translation.x, y: translation.y - halfHeight, z: translation.z },
    { x: 0, y: -1, z: 0 }
  );

  const hit = world.castRay(
    ray,
    probeLength,
    true,
    undefined,
    undefined,
    excludeColliderHandle
  );

  return hit !== null;
}

/**
 * Bodyの足元から最も近い物理面までの接触距離を取得します。
 * 接触していない場合はnullを返します。
 */
export function groundDistance(world, body, excludeColliderHandle, { halfHeight, probeLength }) {
  const translation = body.translation();
  const ray = new RAPIER.Ray(
    { x: translation.x, y: translation.y - halfHeight, z: translation.z },
    { x: 0, y: -1, z: 0 }
  );

  const hit = world.castRay(
    ray,
    probeLength,
    true,
    undefined,
    undefined,
    excludeColliderHandle
  );

  return hit ? hit.timeOfImpact : null;
}

/**
 * 任意方向のRay接触を調べます。
 * NPCの障害物回避など、複数システムから同じ判定方式を使えるようにします。
 */
export function castTouchRay(world, origin, direction, maxToi, excludeColliderHandle = undefined) {
  const ray = new RAPIER.Ray(origin, direction);
  return world.castRay(
    ray,
    maxToi,
    true,
    undefined,
    undefined,
    excludeColliderHandle
  );
}

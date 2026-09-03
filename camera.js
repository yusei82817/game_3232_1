/*
 * 三人称カメラ担当。
 *
 * カメラの回転・追従・地形/物理コリジョンによるめり込み防止を
 * game.jsから分離します。
 * 入力判定はgame.jsのdown()を受け取り、プレイヤーと物理ワールドを参照します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { RAPIER } from "./physics.js";

export function createCameraController({ camera, config, physicsWorld, playerBody, playerCollider, isDown }) {
  let cameraYaw = Math.PI;
  let cameraPitch = 0.22;

  function update(dt) {
    if (!camera || !playerBody) return;

    const playerPosition = playerBody.translation();

    cameraYaw += (isDown("KeyQ") ? config.cameraYawSpeed : 0) * dt;
    cameraYaw -= (isDown("KeyE") ? config.cameraYawSpeed : 0) * dt;
    if (isDown("ArrowLeft")) cameraYaw += config.cameraYawSpeed * dt;
    if (isDown("ArrowRight")) cameraYaw -= config.cameraYawSpeed * dt;
    if (isDown("ArrowUp")) cameraPitch += config.cameraPitchSpeed * dt;
    if (isDown("ArrowDown")) cameraPitch -= config.cameraPitchSpeed * dt;
    cameraPitch = THREE.MathUtils.clamp(cameraPitch, config.cameraPitchMin, config.cameraPitchMax);

    const horizontal = Math.cos(cameraPitch) * config.cameraDistance;
    const desired = new THREE.Vector3(
      playerPosition.x - Math.sin(cameraYaw) * horizontal,
      playerPosition.y + config.cameraHeight + Math.sin(cameraPitch) * config.cameraDistance,
      playerPosition.z + Math.cos(cameraYaw) * horizontal
    );
    const target = new THREE.Vector3(
      playerPosition.x,
      playerPosition.y + config.cameraLookHeight,
      playerPosition.z
    );

    const direction = desired.clone().sub(target);
    const length = direction.length();
    if (length > 0.001 && physicsWorld && playerCollider) {
      direction.normalize();
      const ray = new RAPIER.Ray(
        { x: target.x, y: target.y, z: target.z },
        { x: direction.x, y: direction.y, z: direction.z }
      );
      const hit = physicsWorld.castRay(
        ray,
        length,
        true,
        undefined,
        undefined,
        playerCollider.handle
      );
      if (hit) {
        const safeLength = Math.max(1.0, hit.timeOfImpact - config.cameraCollisionPadding);
        desired.copy(target).addScaledVector(direction, Math.min(length, safeLength));
      }
    }

    camera.position.lerp(desired, 1 - Math.exp(-config.cameraSmoothing * dt));
    camera.lookAt(target);
  }

  function getYaw() {
    return cameraYaw;
  }

  function getPitch() {
    return cameraPitch;
  }

  return { update, getYaw, getPitch };
}

/*
 * WASTELAND // CREATE
 *
 * 非生物のワールドオブジェクトを生成するモジュールです。
 * map.jsは「どこに置くか」、create.jsは「どう作るか」を担当します。
 *
 * 生物・キャラクターはentity.js、時間や更新処理は各担当モジュールで管理します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

function makeMaterial(color, roughness = 0.86) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 });
}

/**
 * 岩を生成します。
 * コリジョン生成関数を外から受け取ることで、物理システムをcreate.jsへ直接依存させません。
 */
export function createRock({
  scene,
  terrainHeightAt,
  createCollider,
  x,
  z,
  scale = 1
}) {
  const y = terrainHeightAt(x, z) + 0.65 * scale;
  const mesh = new THREE.Mesh(
    new THREE.DodecahedronGeometry(1, 1),
    makeMaterial(0x5f625e)
  );

  mesh.scale.set(1.25 * scale, 0.75 * scale, 0.95 * scale);
  mesh.rotation.set(Math.random(), Math.random(), Math.random());
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  createCollider?.({
    x,
    y,
    z,
    radius: 0.95 * scale
  });

  return mesh;
}

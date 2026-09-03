/*
 * マップ担当。
 *
 * 地形の見た目と地形コリジョンをここでまとめて生成します。
 * game.jsは「ゲーム進行」、physics.jsは「物理API」、map.jsは「世界の地形」を担当します。
 *
 * 重要なのは、Three.js用の高さ配列とRapier用の高さ配列を同じデータから作ることです。
 * これにより、見た目の地面と実際に歩ける地面の位置がずれません。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { createFixedHeightfield, createFixedBall } from "./physics.js";

function makeMaterial(color, roughness = 0.86) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 });
}

function createTerrainHeightFunction() {
  return (x, z) => {
    // 大きな起伏 + 細かな起伏 + 尾根を組み合わせて、平坦すぎない荒野を作ります。
    const broad = Math.sin(x * 0.045) * 2.2 + Math.cos(z * 0.052) * 1.6;
    const detail = Math.sin((x + z) * 0.11) * 0.65 + Math.cos((x - z) * 0.075) * 0.45;
    const ridge = Math.max(0, Math.sin(x * 0.018 + z * 0.031)) * 1.3;
    return broad + detail + ridge - 0.6;
  };
}

function buildTerrain(scene, config, terrainHeightAt) {
  const size = config.worldSize;
  const segments = config.terrainSegments;
  const count = (segments + 1) ** 2;
  const positions = new Float32Array(count * 3);
  const heights = new Float32Array(count);
  const indices = [];

  for (let iz = 0; iz <= segments; iz++) {
    for (let ix = 0; ix <= segments; ix++) {
      const i = iz * (segments + 1) + ix;
      const x = -size / 2 + (ix / segments) * size;
      const z = -size / 2 + (iz / segments) * size;
      const y = terrainHeightAt(x, z);
      heights[i] = y;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }
  }

  for (let z = 0; z < segments; z++) {
    for (let x = 0; x < segments; x++) {
      const a = z * (segments + 1) + x;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, makeMaterial(0x5b5747));
  mesh.receiveShadow = true;
  scene.add(mesh);

  // 表示と物理で同じheight配列を使い、足元の見た目と衝突面を一致させます。
  createFixedHeightfield({
    rows: segments + 1,
    cols: segments + 1,
    heights,
    scale: { x: size / segments, y: 1, z: size / segments }
  });

  return { mesh, heights };
}

function addRock(scene, terrainHeightAt, x, z, scale = 1) {
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
  createFixedBall({ x, y, z, radius: 0.95 * scale });
}

function buildNaturalObjects(scene, config, terrainHeightAt) {
  // 岩はマップの固定自然物です。プレイヤーの初期位置付近を避けて配置します。
  const rocks = [
    [-18, -12, 1.25], [15, -17, 0.9], [29, 7, 1.5], [-34, 18, 1.15],
    [42, 28, 0.8], [-48, -31, 1.4], [8, 39, 1.0], [-7, -43, 0.75],
    [52, -5, 1.2], [-55, 9, 0.95], [22, 46, 1.3], [-25, 34, 0.85]
  ];

  for (const [x, z, scale] of rocks) {
    if (Math.hypot(x, z) < 7) continue;
    addRock(scene, terrainHeightAt, x, z, scale);
  }

  // 追加の小石は決定的な座標で散らし、毎回同じマップになるようにします。
  for (let i = 0; i < Math.min(28, Math.floor(config.worldSize / 5)); i++) {
    const angle = i * 2.399963;
    const radius = 18 + (i * 17.37) % (config.worldSize * 0.43);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const scale = 0.28 + (i % 4) * 0.09;
    if (Math.hypot(x, z) < 9) continue;
    addRock(scene, terrainHeightAt, x, z, scale);
  }
}

export function buildMap(scene, config) {
  // terrainHeightAtを返し、プレイヤーやNPCの初期位置計算にも同じ地形関数を使えるようにします。
  const terrainHeightAt = createTerrainHeightFunction();
  const terrain = buildTerrain(scene, config, terrainHeightAt);
  buildNaturalObjects(scene, config, terrainHeightAt);

  return {
    terrainHeightAt,
    terrainMesh: terrain.mesh,
    terrainHeights: terrain.heights
  };
}

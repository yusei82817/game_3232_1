/*
 * マップ担当。
 *
 * 地形の見た目、地形コリジョン、水域、自然物をここでまとめて生成します。
 * game.jsは「ゲーム進行」、physics.jsは「物理API」、map.jsは「世界の地形」を担当します。
 *
 * 重要なのは、Three.js用の高さ配列とRapier用の高さ配列を同じデータから作ることです。
 * これにより、見た目の地面と実際に歩ける地面の位置がずれません。
 * 水面は地面とは別物です。水面そのものに歩行用コリジョンを付けず、
 * game.js側で水中状態を判定して泳ぎ・減速・浮力を処理します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { createFixedHeightfield, createFixedBall } from "./physics.js";

function makeMaterial(color, roughness = 0.86) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 });
}

function createTerrainHeightFunction() {
  return (x, z) => {
    // 大きな起伏 + 細かな起伏 + 尾根を組み合わせて、平坦すぎない荒野を作ります。
    const natural =
      Math.sin(x * 0.045) * 2.2 +
      Math.cos(z * 0.052) * 1.6 +
      Math.sin((x + z) * 0.11) * 0.65 +
      Math.cos((x - z) * 0.075) * 0.45 +
      Math.max(0, Math.sin(x * 0.018 + z * 0.031)) * 1.3 - 0.6;

    // 湖の中央だけをなだらかに掘り下げます。
    // waterLevelより十分低い海底を作ることで、水面と地面が同じ高さになる問題を防ぎます。
    const lake = getLakeShape(x, z);
    if (lake <= 0) return natural;

    const smooth = lake * lake * (3 - 2 * lake);
    return natural - smooth * CONFIG_INTERNAL.lakeDepth;
  };
}

const CONFIG_INTERNAL = {
  waterLevel: -1.15,
  lakeCenterX: -34,
  lakeCenterZ: 26,
  lakeRadiusX: 31,
  lakeRadiusZ: 23,
  lakeDepth: 3.0,
  waterSegments: 56,
  waveAmplitude: 0.045,
  waveLength: 0.32,
  waveSpeed: 0.9
};

function getLakeShape(x, z) {
  const dx = (x - CONFIG_INTERNAL.lakeCenterX) / CONFIG_INTERNAL.lakeRadiusX;
  const dz = (z - CONFIG_INTERNAL.lakeCenterZ) / CONFIG_INTERNAL.lakeRadiusZ;
  const distance = Math.hypot(dx, dz);
  // 0.78より内側は完全な水域、1.0付近でなだらかに岸へ移行します。
  return THREE.MathUtils.clamp((1.0 - distance) / 0.22, 0, 1);
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

  // Rapierはsegmentsを分割数として受け取り、height配列はsegments+1頂点分を使用します。
  // Three.jsと同じheight配列を使うことで、表示メッシュと衝突面を一致させます。
  createFixedHeightfield({
    rows: segments,
    cols: segments,
    heights,
    scale: { x: size / segments, y: 1, z: size / segments }
  });

  return { mesh, heights };
}

function buildWater(scene) {
  const segments = CONFIG_INTERNAL.waterSegments;
  const count = segments + 1;
  const positions = new Float32Array(count * count * 3);
  const indices = [];

  // 楕円状の湖面をグリッド化し、湖の外側は頂点を透明化するのではなく三角形自体を作りません。
  // そのため巨大な水面Planeが荒野全体を覆うことはありません。
  for (let iz = 0; iz <= segments; iz++) {
    for (let ix = 0; ix <= segments; ix++) {
      const u = ix / segments * 2 - 1;
      const v = iz / segments * 2 - 1;
      const i = iz * count + ix;
      positions[i * 3] = CONFIG_INTERNAL.lakeCenterX + u * CONFIG_INTERNAL.lakeRadiusX;
      positions[i * 3 + 1] = CONFIG_INTERNAL.waterLevel;
      positions[i * 3 + 2] = CONFIG_INTERNAL.lakeCenterZ + v * CONFIG_INTERNAL.lakeRadiusZ;
    }
  }

  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * count + ix;
      const b = a + 1;
      const c = a + count;
      const d = c + 1;
      const cx = (positions[a * 3] + positions[d * 3]) * 0.5;
      const cz = (positions[a * 3 + 2] + positions[d * 3 + 2]) * 0.5;
      const shape = getLakeShape(cx, cz);
      if (shape > 0) indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x2f6f78,
    transparent: true,
    opacity: 0.72,
    roughness: 0.18,
    metalness: 0.12,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);

  // 波の更新に必要な元座標を保存します。毎フレーム全頂点を大きく動かさず、穏やかに揺らします。
  mesh.userData.waterBasePositions = positions.slice();
  mesh.userData.waterTime = 0;
  mesh.userData.updateWater = (dt) => {
    mesh.userData.waterTime += dt * CONFIG_INTERNAL.waveSpeed;
    const time = mesh.userData.waterTime;
    const position = geometry.attributes.position;
    const base = mesh.userData.waterBasePositions;

    for (let i = 0; i < position.count; i++) {
      const x = base[i * 3];
      const z = base[i * 3 + 2];
      const wave =
        Math.sin(x * CONFIG_INTERNAL.waveLength + time) * CONFIG_INTERNAL.waveAmplitude +
        Math.cos(z * CONFIG_INTERNAL.waveLength * 0.83 - time * 0.8) * CONFIG_INTERNAL.waveAmplitude * 0.7;
      position.setY(i, CONFIG_INTERNAL.waterLevel + wave);
    }
    position.needsUpdate = true;
  };

  return mesh;
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
  const waterMesh = buildWater(scene);
  buildNaturalObjects(scene, config, terrainHeightAt);

  return {
    terrainHeightAt,
    terrainMesh: terrain.mesh,
    terrainHeights: terrain.heights,
    waterMesh,
    waterLevel: CONFIG_INTERNAL.waterLevel,
    isWaterAt(x, z) {
      const shape = getLakeShape(x, z);
      return shape > 0 && terrainHeightAt(x, z) < CONFIG_INTERNAL.waterLevel + 0.12;
    },
    getWaterInfoAt(x, z) {
      const shape = getLakeShape(x, z);
      const active = shape > 0 && terrainHeightAt(x, z) < CONFIG_INTERNAL.waterLevel + 0.12;
      return {
        isWater: active,
        surfaceY: CONFIG_INTERNAL.waterLevel,
        depth: active ? Math.max(0, CONFIG_INTERNAL.waterLevel - terrainHeightAt(x, z)) : 0,
        shoreFactor: shape
      };
    },
    update(dt) {
      waterMesh.userData.updateWater(dt);
    }
  };
}

/*
 * WASTELAND // WATER
 *
 * 水域に関する処理をまとめるモジュールです。
 * map.jsは地形、water.jsは水域そのものを担当します。
 *
 * ここでは湖の形状、水面メッシュ、水面アニメーション、
 * 水域判定、水深・水面高度の取得を管理します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

const WATER_CONFIG = {
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

/**
 * 指定座標が湖のどの位置にあるかを0～1で返します。
 * 1に近いほど湖の中心、0に近いほど湖の外縁です。
 */
function getLakeShape(x, z) {
  const dx = (x - WATER_CONFIG.lakeCenterX) / WATER_CONFIG.lakeRadiusX;
  const dz = (z - WATER_CONFIG.lakeCenterZ) / WATER_CONFIG.lakeRadiusZ;
  const distance = Math.hypot(dx, dz);
  return THREE.MathUtils.clamp((1.0 - distance) / 0.22, 0, 1);
}

function buildWaterMesh(scene) {
  const segments = WATER_CONFIG.waterSegments;
  const count = segments + 1;
  const positions = new Float32Array(count * count * 3);
  const indices = [];

  for (let iz = 0; iz <= segments; iz++) {
    for (let ix = 0; ix <= segments; ix++) {
      const u = ix / segments * 2 - 1;
      const v = iz / segments * 2 - 1;
      const i = iz * count + ix;
      positions[i * 3] = WATER_CONFIG.lakeCenterX + u * WATER_CONFIG.lakeRadiusX;
      positions[i * 3 + 1] = WATER_CONFIG.waterLevel;
      positions[i * 3 + 2] = WATER_CONFIG.lakeCenterZ + v * WATER_CONFIG.lakeRadiusZ;
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

  mesh.userData.waterBasePositions = positions.slice();
  mesh.userData.waterTime = 0;

  return mesh;
}

function updateWaterMesh(mesh, dt) {
  mesh.userData.waterTime += dt * WATER_CONFIG.waveSpeed;
  const time = mesh.userData.waterTime;
  const position = mesh.geometry.attributes.position;
  const base = mesh.userData.waterBasePositions;

  for (let i = 0; i < position.count; i++) {
    const x = base[i * 3];
    const z = base[i * 3 + 2];
    const wave =
      Math.sin(x * WATER_CONFIG.waveLength + time) * WATER_CONFIG.waveAmplitude +
      Math.cos(z * WATER_CONFIG.waveLength * 0.83 - time * 0.8) * WATER_CONFIG.waveAmplitude * 0.7;
    position.setY(i, WATER_CONFIG.waterLevel + wave);
  }

  position.needsUpdate = true;
}

/**
 * 水域システムを生成します。
 * terrainHeightAtを受け取り、水深の計算だけ地形側へ依存します。
 */
export function createWaterController({ scene, terrainHeightAt }) {
  const waterMesh = buildWaterMesh(scene);

  function isWaterAt(x, z) {
    const shape = getLakeShape(x, z);
    return shape > 0 && terrainHeightAt(x, z) < WATER_CONFIG.waterLevel + 0.12;
  }

  function getWaterInfoAt(x, z) {
    const shape = getLakeShape(x, z);
    const active = shape > 0 && terrainHeightAt(x, z) < WATER_CONFIG.waterLevel + 0.12;

    return {
      isWater: active,
      surfaceY: WATER_CONFIG.waterLevel,
      depth: active ? Math.max(0, WATER_CONFIG.waterLevel - terrainHeightAt(x, z)) : 0,
      shoreFactor: shape
    };
  }

  return {
    waterMesh,
    waterLevel: WATER_CONFIG.waterLevel,
    isWaterAt,
    getWaterInfoAt,
    update(dt) {
      updateWaterMesh(waterMesh, dt);
    }
  };
}

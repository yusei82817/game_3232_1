/*
 * WASTELAND // MAP
 *
 * 地形とマップ配置を担当するモジュールです。
 * game.jsはゲーム進行、physics.jsは物理API、map.jsは世界の地形、
 * water.jsは水域、create.jsは非生物のワールドオブジェクトを担当します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { createFixedTrimesh, createFixedBall } from "./physics.js";
import { createWaterController } from "./water.js";

function makeMaterial(color, roughness = 0.86) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 });
}

const CONFIG_INTERNAL = {
  lakeDepth: 3.0,
  waterLevel: -1.15,
  lakeCenterX: -34,
  lakeCenterZ: 26,
  lakeRadiusX: 31,
  lakeRadiusZ: 23
};

function waterShapeAt(x, z) {
  const dx = (x - CONFIG_INTERNAL.lakeCenterX) / CONFIG_INTERNAL.lakeRadiusX;
  const dz = (z - CONFIG_INTERNAL.lakeCenterZ) / CONFIG_INTERNAL.lakeRadiusZ;
  const distance = Math.hypot(dx, dz);
  return THREE.MathUtils.clamp((1.0 - distance) / 0.22, 0, 1);
}

function createTerrainHeightFunction() {
  return (x, z) => {
    const natural =
      Math.sin(x * 0.045) * 2.2 +
      Math.cos(z * 0.052) * 1.6 +
      Math.sin((x + z) * 0.11) * 0.65 +
      Math.cos((x - z) * 0.075) * 0.45 +
      Math.max(0, Math.sin(x * 0.018 + z * 0.031)) * 1.3 - 0.6;

    const lake = waterShapeAt(x, z);
    if (lake <= 0) return natural;

    const smooth = lake * lake * (3 - 2 * lake);
    return natural - smooth * CONFIG_INTERNAL.lakeDepth;
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

  // 表示メッシュと同じ頂点・三角形をRapierへ渡します。
  createFixedTrimesh({ vertices: positions, indices });

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
  const rocks = [
    [-18, -12, 1.25], [15, -17, 0.9], [29, 7, 1.5], [-34, 18, 1.15],
    [42, 28, 0.8], [-48, -31, 1.4], [8, 39, 1.0], [-7, -43, 0.75],
    [52, -5, 1.2], [-55, 9, 0.95], [22, 46, 1.3], [-25, 34, 0.85]
  ];

  for (const [x, z, scale] of rocks) {
    if (Math.hypot(x, z) < 7) continue;
    addRock(scene, terrainHeightAt, x, z, scale);
  }

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
  const terrainHeightAt = createTerrainHeightFunction();
  const terrain = buildTerrain(scene, config, terrainHeightAt);
  const waterState = createWaterController({ scene, terrainHeightAt });
  buildNaturalObjects(scene, config, terrainHeightAt);

  return {
    terrainHeightAt,
    terrainMesh: terrain.mesh,
    terrainHeights: terrain.heights,
    waterMesh: waterState.waterMesh,
    waterLevel: waterState.waterLevel,
    isWaterAt: waterState.isWaterAt,
    getWaterInfoAt: waterState.getWaterInfoAt,
    update(dt) {
      waterState.update(dt);
    }
  };
}

/*
 * WASTELAND // MAP
 *
 * 地形とマップ配置を担当するモジュールです。
 * 巨大な世界そのものはchunk.jsが管理し、map.jsはワールド座標からの地形形状と
 * 水域システムを接続します。これにより世界を無限方向へ拡張できます。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { createWaterController } from "./water.js";
import { createChunkManager } from "./chunk.js";

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

/**
 * ワールド座標から地形高度を直接求めます。
 * チャンクごとに別の乱数を使わないため、チャンク境界でも高さが完全につながります。
 */
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

export function buildMap(scene, config) {
  const terrainHeightAt = createTerrainHeightFunction();
  const chunkManager = createChunkManager({
    scene,
    config,
    terrainHeightAt
  });
  const waterState = createWaterController({ scene, terrainHeightAt });

  return {
    terrainHeightAt,
    waterMesh: waterState.waterMesh,
    waterLevel: waterState.waterLevel,
    isWaterAt: waterState.isWaterAt,
    getWaterInfoAt: waterState.getWaterInfoAt,
    update(dt, playerPosition = null) {
      waterState.update(dt);
      if (playerPosition) {
        chunkManager.sync(playerPosition.x, playerPosition.z);
      }
    },
    dispose() {
      chunkManager.disposeAll();
    },
    get loadedChunkCount() {
      return chunkManager.loadedCount;
    }
  };
}

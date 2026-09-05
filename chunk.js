/*
 * WASTELAND // CHUNK SYSTEM
 *
 * 巨大な世界を60m四方のチャンクへ分割して管理します。
 * プレイヤー周辺だけを表示・物理ロードするため、世界全体を一度に生成しません。
 * 地形の高さはワールド座標から決定するので、チャンク境界でも地形が途切れません。
 *
 * チャンクの生成・破棄は1フレームに少しずつ行います。
 * 境界を越えた瞬間に大量のGeometry/Rapierを同期生成すると、GLB表示時の負荷と重なって
 * メインスレッドが停止しやすいためです。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { createFixedTrimesh, createFixedBall, removePhysicsObject } from "./physics.js";
import { createRock } from "./create.js";

function makeMaterial(color, roughness = 0.86) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 });
}

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

function createChunkTerrain(scene, config, terrainHeightAt, cx, cz, withPhysics) {
  const size = config.chunkSize;
  const segments = config.chunkTerrainSegments;
  const count = (segments + 1) ** 2;
  const positions = new Float32Array(count * 3);
  const indices = [];
  const originX = cx * size;
  const originZ = cz * size;

  for (let iz = 0; iz <= segments; iz++) {
    for (let ix = 0; ix <= segments; ix++) {
      const i = iz * (segments + 1) + ix;
      const x = originX - size / 2 + (ix / segments) * size;
      const z = originZ - size / 2 + (iz / segments) * size;
      const y = terrainHeightAt(x, z);
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

  const collider = withPhysics ? createFixedTrimesh({ vertices: positions, indices }) : null;
  return { mesh, collider };
}

function createColliderFromTerrainMesh(mesh) {
  const positionAttribute = mesh.geometry.getAttribute("position");
  const indexAttribute = mesh.geometry.index;
  if (!positionAttribute || !indexAttribute) return null;

  return createFixedTrimesh({
    vertices: positionAttribute.array,
    indices: indexAttribute.array
  });
}

function addChunkObjects(scene, config, terrainHeightAt, cx, cz) {
  const objects = [];
  const baseX = cx * config.chunkSize;
  const baseZ = cz * config.chunkSize;

  let seed = Math.abs((cx * 374761393 + cz * 668265263) | 0) + 1;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) | 0;
    return ((seed >>> 0) / 4294967296);
  };

  const count = 2 + Math.floor(random() * 3);
  for (let i = 0; i < count; i++) {
    const x = baseX - config.chunkSize / 2 + random() * config.chunkSize;
    const z = baseZ - config.chunkSize / 2 + random() * config.chunkSize;
    if (Math.hypot(x, z) < 9) continue;

    const scale = 0.35 + random() * 1.05;
    const rock = createRock({
      scene,
      terrainHeightAt,
      createCollider: createFixedBall,
      x,
      z,
      scale
    });
    objects.push(rock);
  }

  return objects;
}

function createChunk(scene, config, terrainHeightAt, cx, cz, withPhysics) {
  const terrain = createChunkTerrain(scene, config, terrainHeightAt, cx, cz, withPhysics);
  const objects = withPhysics
    ? addChunkObjects(scene, config, terrainHeightAt, cx, cz)
    : [];

  return {
    key: chunkKey(cx, cz),
    cx,
    cz,
    mesh: terrain.mesh,
    collider: terrain.collider,
    objects
  };
}

function disposeChunk(chunk) {
  if (chunk.collider) removePhysicsObject(chunk.collider);
  for (const object of chunk.objects) {
    removePhysicsObject(object.userData.physics);
    object.geometry.dispose();
    object.material.dispose();
    object.removeFromParent();
  }

  chunk.mesh.geometry.dispose();
  chunk.mesh.material.dispose();
  chunk.mesh.removeFromParent();
}

export function createChunkManager({ scene, config, terrainHeightAt }) {
  const chunks = new Map();
  const pending = new Set();
  let lastCenterX = null;
  let lastCenterZ = null;

  function getCenter(playerX, playerZ) {
    const size = config.chunkSize;
    return {
      x: Math.floor((playerX + size / 2) / size),
      z: Math.floor((playerZ + size / 2) / size)
    };
  }

  function wantedFor(centerX, centerZ) {
    const wanted = new Set();
    for (let dz = -config.chunkRenderRadius; dz <= config.chunkRenderRadius; dz++) {
      for (let dx = -config.chunkRenderRadius; dx <= config.chunkRenderRadius; dx++) {
        wanted.add(chunkKey(centerX + dx, centerZ + dz));
      }
    }
    return wanted;
  }

  function enqueueMissing(wanted, centerX, centerZ) {
    const entries = [];
    for (const key of wanted) {
      if (chunks.has(key)) continue;
      const [cx, cz] = key.split(",").map(Number);
      const dx = Math.abs(cx - centerX);
      const dz = Math.abs(cz - centerZ);
      const needsPhysics = dx <= config.chunkPhysicsRadius && dz <= config.chunkPhysicsRadius;
      entries.push({ key, cx, cz, priority: (dx + dz) + (needsPhysics ? -20 : 0) });
    }

    entries.sort((a, b) => a.priority - b.priority);
    for (const entry of entries) pending.add(entry.key);
  }

  function processOne(centerX, centerZ, wanted) {
    // 古いチャンクを1つずつ破棄。境界越えで大量disposeしない。
    for (const [key, chunk] of chunks) {
      if (!wanted.has(key)) {
        disposeChunk(chunk);
        chunks.delete(key);
        return true;
      }
    }

    if (!pending.size) return false;

    let bestKey = null;
    let bestPriority = Infinity;
    for (const key of pending) {
      const [cx, cz] = key.split(",").map(Number);
      const dx = Math.abs(cx - centerX);
      const dz = Math.abs(cz - centerZ);
      const needsPhysics = dx <= config.chunkPhysicsRadius && dz <= config.chunkPhysicsRadius;
      const priority = dx + dz + (needsPhysics ? -20 : 0);
      if (priority < bestPriority) {
        bestPriority = priority;
        bestKey = key;
      }
    }

    if (!bestKey) return false;

    const [cx, cz] = bestKey.split(",").map(Number);
    const dx = Math.abs(cx - centerX);
    const dz = Math.abs(cz - centerZ);
    const needsPhysics = dx <= config.chunkPhysicsRadius && dz <= config.chunkPhysicsRadius;

    chunks.set(bestKey, createChunk(scene, config, terrainHeightAt, cx, cz, needsPhysics));
    pending.delete(bestKey);
    return true;
  }

  function sync(playerX, playerZ) {
    const center = getCenter(playerX, playerZ);

    if (center.x !== lastCenterX || center.z !== lastCenterZ) {
      lastCenterX = center.x;
      lastCenterZ = center.z;

      const wanted = wantedFor(center.x, center.z);
      enqueueMissing(wanted, center.x, center.z);

      // 現在位置から外れた予約は捨てます。高速移動時に古い方向の生成を続けないためです。
      for (const key of pending) {
        if (!wanted.has(key)) pending.delete(key);
      }
    }

    const wanted = wantedFor(lastCenterX, lastCenterZ);
    processOne(lastCenterX, lastCenterZ, wanted);
  }

  function disposeAll() {
    for (const chunk of chunks.values()) disposeChunk(chunk);
    chunks.clear();
    pending.clear();
    lastCenterX = null;
    lastCenterZ = null;
  }

  return {
    sync,
    disposeAll,
    get loadedCount() {
      return chunks.size;
    }
  };
}

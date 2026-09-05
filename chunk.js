/*
 * WASTELAND // CHUNK SYSTEM
 *
 * 巨大な世界を60m四方のチャンクへ分割して管理します。
 * プレイヤー周辺だけを表示・物理ロードするため、世界全体を一度に生成しません。
 * 地形の高さはワールド座標から決定するので、チャンク境界でも地形が途切れません。
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

  // 物理はプレイヤーに近いチャンクだけ作ります。
  const collider = withPhysics ? createFixedTrimesh({ vertices: positions, indices }) : null;
  return { mesh, collider };
}

function addChunkObjects(scene, config, terrainHeightAt, cx, cz) {
  const objects = [];
  const baseX = cx * config.chunkSize;
  const baseZ = cz * config.chunkSize;

  // チャンク座標から決まる疑似乱数を使い、再ロードしても同じ場所に岩が出ます。
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
  for (const object of chunk.objects) removePhysicsObject(object);

  chunk.mesh.geometry.dispose();
  chunk.mesh.material.dispose();
  chunk.mesh.removeFromParent();
}

export function createChunkManager({ scene, config, terrainHeightAt }) {
  const chunks = new Map();

  function sync(playerX, playerZ) {
    const size = config.chunkSize;
    const centerX = Math.floor((playerX + size / 2) / size);
    const centerZ = Math.floor((playerZ + size / 2) / size);
    const wanted = new Set();

    // 表示用チャンクは広めに残し、遠景まで見渡せるようにします。
    for (let dz = -config.chunkRenderRadius; dz <= config.chunkRenderRadius; dz++) {
      for (let dx = -config.chunkRenderRadius; dx <= config.chunkRenderRadius; dx++) {
        wanted.add(chunkKey(centerX + dx, centerZ + dz));
      }
    }

    for (let dz = -config.chunkRenderRadius; dz <= config.chunkRenderRadius; dz++) {
      for (let dx = -config.chunkRenderRadius; dx <= config.chunkRenderRadius; dx++) {
        const cx = centerX + dx;
        const cz = centerZ + dz;
        const key = chunkKey(cx, cz);
        const needsPhysics = Math.abs(dx) <= config.chunkPhysicsRadius && Math.abs(dz) <= config.chunkPhysicsRadius;
        const current = chunks.get(key);

        if (!current) {
          chunks.set(key, createChunk(scene, config, terrainHeightAt, cx, cz, needsPhysics));
        } else if (needsPhysics && !current.collider) {
          // 表示済みチャンクが物理範囲へ入ったら、同じ地形から衝突面を追加します。
          const terrain = createChunkTerrain(scene, config, terrainHeightAt, cx, cz, true);
          current.mesh.geometry.dispose();
          current.mesh.material.dispose();
          current.mesh.removeFromParent();
          current.mesh = terrain.mesh;
          current.collider = terrain.collider;
          current.objects = addChunkObjects(scene, config, terrainHeightAt, cx, cz);
        }
      }
    }

    for (const [key, chunk] of chunks) {
      if (!wanted.has(key)) {
        disposeChunk(chunk);
        chunks.delete(key);
      }
    }
  }

  function disposeAll() {
    for (const chunk of chunks.values()) disposeChunk(chunk);
    chunks.clear();
  }

  return {
    sync,
    disposeAll,
    get loadedCount() {
      return chunks.size;
    }
  };
}

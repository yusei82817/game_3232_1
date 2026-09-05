/*
 * WASTELAND // MOB DATA // COW
 *
 * 牛の個体データとThree.jsモデルを定義します。
 * 行動制御はmob.jsへ任せ、ここでは牛の形状と基礎能力だけを持たせます。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

function material(color, roughness = 0.88) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

export const cowData = {
  id: "cow",
  name: "Cow",
  mass: 430,
  radius: 0.55,
  halfHeight: 0.72,
  speed: 1.8,
  acceleration: 4.2,
  fleeSpeedMultiplier: 1.35,
  scale: 1.05,
  createModel() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.0, 2.05), material(0x6d5542));
    body.position.y = 1.05;
    body.scale.set(1, 0.92, 1);
    group.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.82), material(0x80634d));
    head.position.set(0, 1.42, 1.18);
    group.add(head);

    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.3), material(0x9a7660));
    muzzle.position.set(0, 1.28, 1.62);
    group.add(muzzle);

    const hornMaterial = material(0xd8d0bd);
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.32, 7), hornMaterial);
      horn.rotation.z = side * -0.45;
      horn.position.set(side * 0.28, 1.82, 1.12);
      group.add(horn);
    }

    const eyeMaterial = material(0x171717, 0.45);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), eyeMaterial);
      eye.position.set(side * 0.29, 1.52, 1.56);
      group.add(eye);
    }

    const legs = [];
    for (const x of [-0.46, 0.46]) {
      for (const z of [-0.62, 0.62]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.82, 8), material(0x4e4035));
        leg.position.set(x, 0.42, z);
        group.add(leg);
        legs.push(leg);
      }
    }

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.55, 7), material(0x5c4739));
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, 1.34, -1.12);
    group.add(tail);

    group.userData.limbs = { legs };
    group.userData.species = "cow";
    return group;
  }
};

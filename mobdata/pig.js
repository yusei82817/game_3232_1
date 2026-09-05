/*
 * WASTELAND // MOB DATA // PIG
 *
 * 豚の個体データとThree.jsモデルを定義します。
 * 行動制御はmob.jsが担当し、このファイルは豚の見た目と能力値を担当します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

function material(color, roughness = 0.84) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

export const pigData = {
  id: "pig",
  name: "Pig",
  mass: 110,
  radius: 0.4,
  halfHeight: 0.48,
  speed: 2.0,
  acceleration: 5.2,
  fleeSpeedMultiplier: 1.55,
  scale: 0.9,
  createModel() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.72, 12, 8), material(0xd18f92));
    body.scale.set(1.1, 0.82, 1.35);
    body.position.y = 0.82;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.43, 12, 8), material(0xd99a9d));
    head.scale.set(0.95, 0.92, 1.05);
    head.position.set(0, 0.9, 0.9);
    group.add(head);

    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 6), material(0xe2aeb0));
    snout.scale.set(1.15, 0.7, 0.72);
    snout.position.set(0, 0.82, 1.27);
    group.add(snout);

    const nostrilMaterial = material(0x5f3439, 0.5);
    for (const side of [-1, 1]) {
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.035, 7, 5), nostrilMaterial);
      nostril.position.set(side * 0.09, 0.86, 1.46);
      group.add(nostril);
    }

    const eyeMaterial = material(0x171717, 0.45);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), eyeMaterial);
      eye.position.set(side * 0.3, 1.05, 1.13);
      group.add(eye);
    }

    const ears = [];
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.34, 5), material(0xc57f84));
      ear.rotation.z = side * 0.55;
      ear.position.set(side * 0.3, 1.35, 0.78);
      group.add(ear);
      ears.push(ear);
    }

    const legs = [];
    for (const x of [-0.42, 0.42]) {
      for (const z of [-0.48, 0.48]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.55, 8), material(0xb87378));
        leg.position.set(x, 0.28, z);
        group.add(leg);
        legs.push(leg);
      }
    }

    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 6, 10, Math.PI * 1.5), material(0xd99a9d));
    tail.rotation.y = Math.PI / 2;
    tail.position.set(0, 1.0, -0.92);
    group.add(tail);

    group.userData.limbs = { legs, ears };
    group.userData.species = "pig";
    return group;
  }
};

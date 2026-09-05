/*
 * WASTELAND // MOB DATA // CHICKEN
 *
 * 鶏の個体データとThree.jsモデルを定義します。
 * 行動制御そのものはmob.jsが担当し、このファイルは「鶏とは何か」に集中します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

function material(color, roughness = 0.82) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

export const chickenData = {
  id: "chicken",
  name: "Chicken",
  mass: 2.2,
  radius: 0.22,
  halfHeight: 0.28,
  speed: 1.45,
  acceleration: 7.0,
  fleeSpeedMultiplier: 1.8,
  scale: 0.72,
  createModel() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), material(0xe8e5dc));
    body.scale.set(1.15, 0.9, 1.35);
    body.position.y = 0.72;
    group.add(body);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 0.38, 8), material(0xe8e5dc));
    neck.position.set(0, 1.05, 0.28);
    group.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.29, 12, 8), material(0xf0eee7));
    head.position.set(0, 1.31, 0.34);
    group.add(head);

    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.25, 6), material(0xd29b32));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 1.28, 0.62);
    group.add(beak);

    const comb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), material(0xb83c34));
    comb.scale.set(0.8, 1.35, 0.65);
    comb.position.set(0, 1.56, 0.31);
    group.add(comb);

    const eyeMaterial = material(0x171717, 0.5);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyeMaterial);
      eye.position.set(side * 0.18, 1.37, 0.55);
      group.add(eye);
    }

    const legs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.42, 6), material(0xd29b32));
      leg.position.set(side * 0.2, 0.36, 0.03);
      group.add(leg);
      legs.push(leg);
    }

    group.userData.limbs = { legs };
    group.userData.species = "chicken";
    return group;
  }
};

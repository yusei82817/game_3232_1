/*
 * WASTELAND // ENTITY
 *
 * 生物・キャラクターの見た目を生成するモジュールです。
 * プレイヤーやNPCの制御は担当せず、「生物そのものをどう組み立てるか」だけを扱います。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

function makeMaterial(color, roughness = 0.86) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 });
}

/**
 * NPCとプレイヤーで共有する人型モデルを生成します。
 * 腕と脚は「上腕→肘→前腕」「太腿→膝→脛」の親子構造にします。
 * こうしておくと、上腕を動かしたときに前腕だけが置き去りにならず、
 * 肘を軸に自然な二関節の動きを作れます。
 */
export function createHumanoid(options = {}) {
  const group = new THREE.Group();
  const skin = makeMaterial(options.skin ?? 0xb98468);
  const shirt = makeMaterial(options.shirt ?? 0x536a78);
  const pants = makeMaterial(options.pants ?? 0x34383e);
  const shoe = makeMaterial(0x202225);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.62, 5, 10), shirt);
  torso.position.y = 1.18;
  group.add(torso);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.16, 8), skin);
  neck.position.y = 1.75;
  group.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.29, 14, 10), skin);
  head.position.y = 2.03;
  group.add(head);

  function limb(radius, length, material, x, y) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), material);
    mesh.position.y = -length * 0.5;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  }

  // 上腕の先端が肘になります。前腕は上腕とは別の子Pivotとして肘に接続します。
  function arm(radius, upperLength, foreLength, upperMaterial, foreMaterial, x, shoulderY) {
    const shoulder = new THREE.Group();
    shoulder.position.set(x, shoulderY, 0);
    group.add(shoulder);

    const upper = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius, upperLength, 4, 8),
      upperMaterial
    );
    upper.position.y = -upperLength * 0.5;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.set(0, -upperLength, 0);
    shoulder.add(elbow);

    const elbowJoint = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.02, 8, 6),
      foreMaterial
    );
    elbow.add(elbowJoint);

    const fore = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius * 0.9, foreLength, 4, 8),
      foreMaterial
    );
    fore.position.y = -foreLength * 0.5;
    elbow.add(fore);

    return { shoulder, elbow };
  }

  const leftArm = arm(0.105, 0.42, 0.40, shirt, skin, -0.43, 1.48);
  const rightArm = arm(0.105, 0.42, 0.40, shirt, skin, 0.43, 1.48);

  const thighL = limb(0.14, 0.48, pants, -0.19, 0.76);
  const thighR = limb(0.14, 0.48, pants, 0.19, 0.76);
  const shinL = limb(0.105, 0.52, pants, -0.19, 0.28);
  const shinR = limb(0.105, 0.52, pants, 0.19, 0.28);

  const footL = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.12, 0.34), shoe);
  footL.position.set(-0.19, 0.05, 0.08);
  group.add(footL);
  const footR = footL.clone();
  footR.position.x = 0.19;
  group.add(footR);

  // animation.jsから直接操作するのは各関節Pivotです。
  // foreArmはelbowの子なので、上腕と前腕の向きが同じでも必ず肘で連結されます。
  group.userData.limbs = {
    upperArmL: leftArm.shoulder,
    upperArmR: rightArm.shoulder,
    foreArmL: leftArm.elbow,
    foreArmR: rightArm.elbow,
    thighL, thighR, shinL, shinR
  };
  group.userData.phase = Math.random() * Math.PI * 2;
  return group;
}

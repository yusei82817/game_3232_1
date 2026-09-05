/*
 * WASTELAND // HUMAN BODY
 *
 * 人間の身体モデルそのものを生成するモジュールです。
 * entity.jsはEntityの入口、animation.jsは動作、player.js / npc.jsは制御を担当し、
 * このファイルでは「人間の身体がどういう部品と関節でできているか」だけを扱います。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

function makeMaterial(color, roughness = 0.86) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 });
}

/**
 * 人間の頭部を作ります。
 * 顔パーツはすべてheadの子にします。モデルの正面は+Z側として統一します。
 */
function createHead(skin, options) {
  const head = new THREE.Group();
  head.position.y = 2.03;

  // 完全な球体ではなく、少し縦長で人間らしい頭部にします。
  const face = new THREE.Mesh(
    new THREE.SphereGeometry(0.30, 20, 16),
    skin
  );
  face.scale.set(0.94, 1.08, 0.96);
  head.add(face);

  const hair = makeMaterial(options.hair ?? 0x25211f, 0.9);
  const eyeWhite = makeMaterial(0xf4f1e8, 0.45);
  const eyeColor = makeMaterial(options.eye ?? 0x3b2a22, 0.4);
  const mouthMat = makeMaterial(0x4a2424, 0.75);

  // 頭頂部から後頭部を覆う髪。
  const hairCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.314, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62),
    hair
  );
  hairCap.scale.set(0.96, 1.02, 0.98);
  hairCap.position.set(0, 0.025, -0.045);
  hairCap.rotation.x = Math.PI;
  head.add(hairCap);

  // 頭頂部に髪の厚みを追加し、球体の頭が露出しないようにします。
  const topHair = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 16, 10),
    hair
  );
  topHair.scale.set(1.18, 0.42, 1.02);
  topHair.position.set(0, 0.245, -0.015);
  head.add(topHair);

  // 前髪は球体3個ではなく、細長い毛束として配置します。
  const bangData = [
    { x: -0.13, y: 0.185, z: 0.245, rot: -0.12, scale: [0.55, 1.35, 0.48] },
    { x: 0.00, y: 0.205, z: 0.255, rot: 0.00, scale: [0.58, 1.48, 0.50] },
    { x: 0.13, y: 0.185, z: 0.245, rot: 0.12, scale: [0.55, 1.35, 0.48] }
  ];

  for (const bangInfo of bangData) {
    const bang = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.065, 0.12, 4, 8),
      hair
    );
    bang.position.set(bangInfo.x, bangInfo.y, bangInfo.z);
    bang.rotation.z = bangInfo.rot;
    bang.scale.set(...bangInfo.scale);
    head.add(bang);
  }

  // 側頭部の髪。前髪だけが浮いて見えないようにします。
  for (const x of [-0.285, 0.285]) {
    const sideHair = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.065, 0.18, 4, 8),
      hair
    );
    sideHair.position.set(x, 0.08, -0.005);
    sideHair.scale.set(0.78, 1.15, 0.72);
    head.add(sideHair);
  }

  // 耳は頭の左右に配置します。
  for (const x of [-0.292, 0.292]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), skin);
    ear.scale.set(0.55, 1, 0.72);
    ear.position.set(x, 0.01, 0);
    head.add(ear);
  }

  // 目は白目＋小さめの瞳。巨大な球体目にならないように薄くします。
  for (const x of [-0.105, 0.105]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.068, 12, 8), eyeWhite);
    eye.scale.set(1.05, 0.88, 0.28);
    eye.position.set(x, 0.055, 0.276);
    head.add(eye);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 8), eyeColor);
    pupil.scale.set(0.82, 1.0, 0.20);
    pupil.position.set(x, 0.052, 0.298);
    head.add(pupil);
  }

  // 眉も顔の正面に固定します。
  for (const x of [-0.105, 0.105]) {
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.075, 3, 6), hair);
    brow.rotation.z = x < 0 ? 0.12 : -0.12;
    brow.position.set(x, 0.145, 0.29);
    head.add(brow);
  }

  // 鼻は目より少し前へ出して立体感を付けます。
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), skin);
  nose.scale.set(0.8, 0.9, 0.8);
  nose.position.set(0, -0.015, 0.303);
  head.add(nose);

  // 口も顔の正面へ置きます。
  const mouth = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.075, 3, 6), mouthMat);
  mouth.rotation.z = Math.PI * 0.5;
  mouth.position.set(0, -0.115, 0.285);
  head.add(mouth);

  return head;
}

/**
 * NPCとプレイヤーで共有する人型モデルを生成します。
 * 腕と脚は「上腕→肘→前腕」「太腿→膝→脛→足首→足」の親子構造です。
 */
export function createHumanBody(options = {}) {
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

  const head = createHead(skin, options);
  group.add(head);

  function leg(radius, thighLength, shinLength, x, hipY) {
    const hip = new THREE.Group();
    hip.position.set(x, hipY, 0);
    group.add(hip);

    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, thighLength, 4, 8), pants);
    thigh.position.y = -thighLength * 0.5;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.set(0, -thighLength, 0);
    hip.add(knee);

    const kneeJoint = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.02, 8, 6), pants);
    knee.add(kneeJoint);

    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(radius * 0.78, shinLength, 4, 8), pants);
    shin.position.y = -shinLength * 0.5;
    knee.add(shin);

    const ankle = new THREE.Group();
    ankle.position.set(0, -shinLength, 0);
    knee.add(ankle);

    const ankleJoint = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.72, 8, 6), skin);
    ankle.add(ankleJoint);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.12, 0.34), shoe);
    foot.position.set(0, -0.045, 0.08);
    ankle.add(foot);

    return { hip, knee, ankle };
  }

  function arm(radius, upperLength, foreLength, upperMaterial, foreMaterial, x, shoulderY) {
    const shoulder = new THREE.Group();
    shoulder.position.set(x, shoulderY, 0);
    group.add(shoulder);

    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(radius, upperLength, 4, 8), upperMaterial);
    upper.position.y = -upperLength * 0.5;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.set(0, -upperLength, 0);
    shoulder.add(elbow);

    const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.02, 8, 6), foreMaterial);
    elbow.add(elbowJoint);

    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(radius * 0.9, foreLength, 4, 8), foreMaterial);
    fore.position.y = -foreLength * 0.5;
    elbow.add(fore);

    return { shoulder, elbow };
  }

  const leftArm = arm(0.105, 0.42, 0.40, shirt, skin, -0.43, 1.48);
  const rightArm = arm(0.105, 0.42, 0.40, shirt, skin, 0.43, 1.48);
  const leftLeg = leg(0.14, 0.48, 0.52, -0.19, 0.76);
  const rightLeg = leg(0.14, 0.48, 0.52, 0.19, 0.76);

  group.userData.limbs = {
    head,
    upperArmL: leftArm.shoulder,
    upperArmR: rightArm.shoulder,
    foreArmL: leftArm.elbow,
    foreArmR: rightArm.elbow,
    thighL: leftLeg.hip,
    thighR: rightLeg.hip,
    shinL: leftLeg.knee,
    shinR: rightLeg.knee,
    ankleL: leftLeg.ankle,
    ankleR: rightLeg.ankle
  };
  group.userData.phase = Math.random() * Math.PI * 2;
  return group;
}

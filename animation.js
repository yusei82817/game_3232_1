/*
 * WASTELAND // ANIMATION
 *
 * GLB人型モデルの内蔵アニメーションをAnimationMixerで再生します。
 * クリップ名はモデルごとに違うため、名前のキーワードから状態を推測します。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

function findClip(clips, keywords) {
  if (!clips?.length) return null;
  const normalized = clips.map((clip) => ({
    clip,
    name: (clip.name ?? "").toLowerCase()
  }));

  for (const keyword of keywords) {
    const found = normalized.find(({ name }) => name.includes(keyword));
    if (found) return found.clip;
  }
  return null;
}

function chooseClip(model, speed, grounded, running, inWater) {
  const clips = model.userData.animationClips ?? [];
  if (!clips.length) return null;

  if (inWater) {
    return findClip(clips, ["swim", "swimming", "float"])
      ?? findClip(clips, ["idle", "stand"])
      ?? clips[0];
  }

  if (!grounded) {
    return findClip(clips, ["jump", "fall", "air"])
      ?? findClip(clips, ["idle", "stand"])
      ?? clips[0];
  }

  if (speed > 0.15) {
    if (running) {
      return findClip(clips, ["run", "running", "sprint"])
        ?? findClip(clips, ["walk", "walking"])
        ?? clips[0];
    }
    return findClip(clips, ["walk", "walking"])
      ?? findClip(clips, ["run", "running"])
      ?? clips[0];
  }

  return findClip(clips, ["idle", "stand", "breath"])
    ?? clips[0];
}

function playClip(model, clip) {
  const mixer = model.userData.mixer;
  if (!mixer || !clip) return;
  if (model.userData.activeAnimationName === clip.name) return;

  const nextAction = mixer.clipAction(clip);
  const previousAction = model.userData.activeAction;

  nextAction.reset();
  nextAction.enabled = true;
  nextAction.setLoop(THREE.LoopRepeat, Infinity);
  nextAction.fadeIn(0.16).play();

  if (previousAction && previousAction !== nextAction) {
    previousAction.fadeOut(0.16);
  }

  model.userData.activeAction = nextAction;
  model.userData.activeAnimationName = clip.name;
}

export function triggerPunch(model) {
  if (!model) return false;

  const mixer = model.userData?.mixer;
  const clips = model.userData?.animationClips ?? [];
  if (!mixer || !clips.length) return false;

  const punchClip = findClip(clips, ["punch", "attack"])
    ?? findClip(clips, ["hit"]);

  if (!punchClip) {
    console.warn("Punch animation clip was not found.", clips.map((clip) => clip.name));
    return false;
  }

  const currentPunch = model.userData.punchAction;
  if (currentPunch?.isRunning()) return false;

  const nextAction = mixer.clipAction(punchClip);
  const previousAction = model.userData.activeAction;

  nextAction.reset();
  nextAction.enabled = true;
  nextAction.clampWhenFinished = true;
  nextAction.setLoop(THREE.LoopOnce, 1);
  nextAction.fadeIn(0.08).play();

  if (previousAction && previousAction !== nextAction) {
    previousAction.fadeOut(0.08);
  }

  model.userData.activeAction = nextAction;
  model.userData.activeAnimationName = punchClip.name;
  model.userData.punchAction = nextAction;
  model.userData.punchAnimationName = punchClip.name;

  if (!model.userData.punchFinishHandler) {
    model.userData.punchFinishHandler = (event) => {
      if (event.action !== model.userData.punchAction) return;
      model.userData.punchAction = null;
      model.userData.activeAction = null;
      model.userData.activeAnimationName = null;
    };
    mixer.addEventListener("finished", model.userData.punchFinishHandler);
  }

  return true;
}

export function animateHumanoid(model, speed, grounded, running, dt, inWater = false, config = null) {
  if (!model) return;

  const mixer = model.userData?.mixer;
  const clips = model.userData?.animationClips ?? [];

  if (mixer && clips.length) {
    mixer.update(dt);

    // パンチ中は歩行・走行・ジャンプの自動切り替えで上書きしない。
    if (model.userData.punchAction?.isRunning()) return;

    const clip = chooseClip(model, speed, grounded, running, inWater);
    playClip(model, clip);
    return;
  }

  // GLBにアニメーションがない場合でも、旧式モデルを壊さないための互換処理。
  const limbs = model.userData?.limbs;
  if (!limbs) return;

  const runSpeed = config?.runSpeed ?? 7.4;
  const walkSpeed = config?.walkSpeed ?? 4.0;
  model.userData.phase += dt * (speed > 0.15 ? (running ? 10 : 7) : 1.5);
  const intensity = Math.min(speed / (running ? runSpeed : walkSpeed), 1);

  if (!grounded && !inWater) {
    limbs.thighL.rotation.x = -0.18;
    limbs.thighR.rotation.x = 0.18;
    limbs.shinL.rotation.x = 0.18;
    limbs.shinR.rotation.x = 0.18;
    limbs.upperArmL.rotation.x = -0.28;
    limbs.upperArmR.rotation.x = -0.28;
    limbs.foreArmL.rotation.x = -0.12;
    limbs.foreArmR.rotation.x = -0.12;
    return;
  }

  if (inWater) {
    const swim = Math.sin(model.userData.phase) * 0.55;
    limbs.thighL.rotation.x = swim;
    limbs.thighR.rotation.x = -swim;
    limbs.shinL.rotation.x = -swim * 0.55;
    limbs.shinR.rotation.x = swim * 0.55;
    limbs.upperArmL.rotation.x = -swim * 1.35;
    limbs.upperArmR.rotation.x = swim * 1.35;
    limbs.foreArmL.rotation.x = -swim * 0.8;
    limbs.foreArmR.rotation.x = swim * 0.8;
    return;
  }

  const swing = Math.sin(model.userData.phase) * 0.55 * intensity;
  const opposite = -swing;
  limbs.thighL.rotation.x = swing;
  limbs.thighR.rotation.x = opposite;
  limbs.shinL.rotation.x = Math.max(0, -swing) * 0.5;
  limbs.shinR.rotation.x = Math.max(0, -opposite) * 0.5;
  limbs.upperArmL.rotation.x = opposite * 0.72;
  limbs.upperArmR.rotation.x = swing * 0.72;
  limbs.foreArmL.rotation.x = -opposite * 0.25;
  limbs.foreArmR.rotation.x = -swing * 0.25;
}

/*
 * WASTELAND // ENTITY
 *
 * 生物・キャラクターの共通入口です。
 * 人間の身体構造そのものはh-body.jsへ分離し、ここではEntityとして扱うための生成を担当します。
 */

import { createHumanBody } from "./h-body.js";

/**
 * NPCとプレイヤーで共有する人型Entityを生成します。
 * 身体・顔・髪・関節の構造はh-body.jsへ委譲します。
 */
export function createHumanoid(options = {}) {
  return createHumanBody(options);
}

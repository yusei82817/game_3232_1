/*
 * WASTELAND // INPUT
 *
 * キーボード入力を一元管理するモジュールです。
 * ゲーム側には「現在このキーが押されているか」だけを公開し、
 * プレイヤーやカメラが入力イベントそのものへ依存しない構成にします。
 *
 * 同時押しはSetで管理するため、W+Zなど複数キーを同時に保持できます。
 */

const keys = new Set();

const PREVENT_DEFAULT_CODES = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space"
]);

export function createInputController() {
  function onKeyDown(event) {
    keys.add(event.code);
    if (PREVENT_DEFAULT_CODES.has(event.code)) {
      event.preventDefault();
    }
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  function onBlur() {
    keys.clear();
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  function isDown(...codes) {
    return codes.some((code) => keys.has(code));
  }

  function clear() {
    keys.clear();
  }

  return {
    isDown,
    clear
  };
}

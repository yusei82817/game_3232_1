/*
 * フィールド環境担当。
 *
 * 時間の進行、太陽の位置、昼夜による光量・空の変化、
 * 天候サイクル、雨、霧、HUDの時刻表示をgame.jsから分離します。
 *
 * game.jsからは createFieldController(...).update(dt) を呼ぶだけです。
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

const WEATHER = ["CLEAR", "CLOUDY", "RAIN", "FOG"];

export function createFieldController({
  scene,
  config,
  sunLight,
  sunMesh,
  hemiLight,
  getPlayerPosition
}) {
  let gameHours = config.startTimeHours;
  let weatherIndex = Math.floor(gameHours / config.weatherCycleHours) % WEATHER.length;
  let weatherBlend = 0;

  const skyColor = new THREE.Color();
  const rainGeometry = new THREE.BufferGeometry();
  const rainCount = config.rainCount ?? 700;
  const rainPositions = new Float32Array(rainCount * 3);
  const rainVelocity = new Float32Array(rainCount);

  for (let i = 0; i < rainCount; i += 1) {
    const index = i * 3;
    rainPositions[index] = (Math.random() - 0.5) * 34;
    rainPositions[index + 1] = Math.random() * 18;
    rainPositions[index + 2] = (Math.random() - 0.5) * 34;
    rainVelocity[i] = 12 + Math.random() * 8;
  }

  rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
  const rainMaterial = new THREE.PointsMaterial({
    color: 0xb9c9d2,
    size: 0.075,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });
  const rain = new THREE.Points(rainGeometry, rainMaterial);
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);

  function getWeatherIndex(hours) {
    const cycle = Math.max(0.1, config.weatherCycleHours ?? 6);
    return Math.floor(hours / cycle) % WEATHER.length;
  }

  function updateWeatherTransition(dt) {
    const nextIndex = getWeatherIndex(gameHours);
    if (nextIndex !== weatherIndex) {
      weatherIndex = nextIndex;
      weatherBlend = 0;
    }
    weatherBlend = Math.min(1, weatherBlend + dt / Math.max(0.1, config.weatherTransitionSeconds ?? 8));
  }

  function weatherFactors() {
    const type = WEATHER[weatherIndex];
    if (type === "CLOUDY") return { light: 0.72, fog: 1.12, saturation: 0.85, rain: 0 };
    if (type === "RAIN") return { light: 0.55, fog: 1.35, saturation: 0.72, rain: 1 };
    if (type === "FOG") return { light: 0.62, fog: 2.5, saturation: 0.65, rain: 0 };
    return { light: 1, fog: 1, saturation: 1, rain: 0 };
  }

  function updateRain(dt, active) {
    rain.visible = active;
    rainMaterial.opacity = active ? 0.42 : 0;
    if (!active) return;

    const player = getPlayerPosition?.();
    if (player) rain.position.set(player.x, player.y + 5, player.z);

    const positions = rainGeometry.attributes.position.array;
    for (let i = 0; i < rainCount; i += 1) {
      const index = i * 3;
      positions[index + 1] -= rainVelocity[i] * dt;
      if (positions[index + 1] < -2) {
        positions[index] = (Math.random() - 0.5) * 34;
        positions[index + 1] = 16 + Math.random() * 8;
        positions[index + 2] = (Math.random() - 0.5) * 34;
      }
    }
    rainGeometry.attributes.position.needsUpdate = true;
  }

  function update(dt) {
    gameHours = (gameHours + (dt / config.dayLengthSeconds) * 24) % 24;
    updateWeatherTransition(dt);

    const sunAngle = (gameHours - 6) / 24 * Math.PI * 2;
    const altitude = Math.sin(sunAngle);
    const azimuth = sunAngle * 0.42;
    const horizontal = Math.cos(sunAngle);
    const distance = 95;
    const sunY = altitude * distance;
    const sunX = Math.cos(azimuth) * horizontal * distance;
    const sunZ = Math.sin(azimuth) * horizontal * distance;

    sunLight.position.set(sunX, Math.max(4, sunY), sunZ);
    sunLight.target.position.set(0, 0, 0);
    sunMesh.position.copy(sunLight.position);

    const daylight = THREE.MathUtils.clamp((altitude + 0.12) / 0.75, 0, 1);
    const weather = weatherFactors();
    sunLight.intensity = config.sunIntensity * (0.08 + daylight * 0.92) * weather.light;
    hemiLight.intensity = THREE.MathUtils.lerp(
      config.ambientNightIntensity,
      config.ambientDayIntensity,
      daylight
    ) * weather.light;

    skyColor.setHSL(
      0.56,
      (0.18 + daylight * 0.2) * weather.saturation,
      0.18 + daylight * 0.48 * weather.light
    );
    scene.background.copy(skyColor);
    scene.fog.color.copy(skyColor);
    scene.fog.near = weather.fog > 1.5 ? 28 : 55;
    scene.fog.far = Math.max(70, 180 / weather.fog);

    updateRain(dt, weather.rain === 1);

    const clockElement = document.getElementById("clock");
    if (clockElement) {
      const hour = Math.floor(gameHours);
      const minute = Math.floor((gameHours - hour) * 60);
      clockElement.textContent = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  function getTime() {
    return gameHours;
  }

  function getWeather() {
    return WEATHER[weatherIndex];
  }

  function getWeatherLabel() {
    return WEATHER[weatherIndex];
  }

  return { update, getTime, getWeather, getWeatherLabel };
}

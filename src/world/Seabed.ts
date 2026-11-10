// 해저 지형 메시: 산호 모래, 잔해(rubble), 암반, 산호 군락 기반부
import * as THREE from 'three';
import { heightAt, coralDensity, seagrass, dropFactor, WORLD_SIZE } from './terrain';
import { patchWater, reefShadow } from '../water/WaterShading';
import { vnoise } from '../core/math';

export function buildSeabed(scene: THREE.Scene, segments: number) {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  for (let i = 0; i < n; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(n * 3), sand = new Float32Array(n);
  const cSand = new THREE.Color(0.64, 0.59, 0.47), cDeepSand = new THREE.Color(0.6, 0.58, 0.52);
  const cRubble = new THREE.Color(0.6, 0.54, 0.46), cRock = new THREE.Color(0.4, 0.38, 0.36);
  const cReef = new THREE.Color(0.52, 0.42, 0.42), cGrass = new THREE.Color(0.55, 0.6, 0.42);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const s = dropFactor(x, z), cd = coralDensity(x, z), g = seagrass(x, z);
    c.copy(cSand).lerp(cDeepSand, s);
    const rub = THREE.MathUtils.smoothstep(vnoise(x * 0.3, z * 0.3) + cd * 0.8, 0.3, 0.9);
    c.lerp(cRubble, rub * 0.7);
    c.lerp(cReef, cd * 0.75);
    c.lerp(cGrass, g * 0.5);
    const steep = 1 - THREE.MathUtils.smoothstep(nrm.getY(i), 0.6, 0.9);
    c.lerp(cRock, steep * 0.85);
    const v = 0.92 + vnoise(x * 1.7, z * 1.7) * 0.08;
    col[i * 3] = c.r * v; col[i * 3 + 1] = c.g * v; col[i * 3 + 2] = c.b * v;
    sand[i] = (1 - cd) * (1 - steep) * (1 - rub * 0.6);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSand', new THREE.BufferAttribute(sand, 1));

  const mat = patchWater(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), {
    key: 'seabed',
    extend: (sh) => {
      Object.assign(sh.uniforms, reefShadow);
      sh.fragmentShader = '#define CAUSTIC_MASK reefSh\n' + sh.fragmentShader;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSand; varying float vSand;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSand = aSand;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vSand; uniform sampler2D uReefShadow; uniform vec4 uReefShadowRect;\nfloat sh21(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float reefSh = 1.0;
          {
            // 산호 아래 접촉 그림자 (주변광 차폐 + 커스틱 감소)
            vec2 suv = (vWPos.xz - uReefShadowRect.xy) / uReefShadowRect.zw;
            if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) reefSh = 1.0 - texture2D(uReefShadow, suv).r * 0.85;
            diffuseColor.rgb *= mix(0.45, 1.0, reefSh);
            // 해류가 만든 모래 물결 + 알갱이
            vec2 p = vWPos.xz;
            float w = sin(dot(p, vec2(0.83, 0.55)) * 5.5 + sin(p.x * 0.7) * 1.4 + sin(p.y * 0.45) * 1.8);
            float grain = sh21(floor(p * 40.0)) - 0.5;
            diffuseColor.rgb *= 1.0 + (w * 0.07 + grain * 0.06) * vSand;
          }`);
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  scene.add(mesh);
  return mesh;
}

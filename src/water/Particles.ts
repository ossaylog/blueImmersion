// 부유 입자 (마린 스노우 / 플랑크톤): 카메라 주변 래핑, 햇빛 받을 때 반짝임
import * as THREE from 'three';
import { waterUniforms, WATER_GLSL_COMMON } from './WaterShading';
import { mulberry32 } from '../core/math';

export class Particles {
  points: THREE.Points;
  constructor(scene: THREE.Scene, count: number, pixelRatio: number) {
    const r = mulberry32(9);
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = r() * 26; pos[i * 3 + 1] = r() * 26; pos[i * 3 + 2] = r() * 26;
      seed[i] = r();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...waterUniforms, uPR: { value: pixelRatio } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform float uPR;
        varying float vA; varying vec3 vWPos; varying float vSeed;
        void main() {
          float S = 26.0;
          vec3 p = position;
          // 느린 해류 + 개별 흔들림
          p += vec3(uTime * 0.12, sin(uTime * 0.3 + aSeed * 30.0) * 0.15 - uTime * 0.015, uTime * 0.05);
          p.x += sin(uTime * 0.4 + aSeed * 50.0) * 0.12;
          vec3 c = cameraPosition - S * 0.5;
          p = c + mod(p - c, S);
          vWPos = p; vSeed = aSeed;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          float size = (0.012 + aSeed * aSeed * 0.035);
          gl_PointSize = clamp(size * 900.0 * uPR / d, 1.0, 9.0 * uPR);
          vA = smoothstep(0.3, 1.6, d) * (1.0 - smoothstep(S * 0.3, S * 0.5, d));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying vec3 vWPos; varying float vSeed;
        ${WATER_GLSL_COMMON}
        void main() {
          if (uUnderwater < 0.5 || vWPos.y > -0.1) discard;
          vec2 q = gl_PointCoord - 0.5;
          float m = smoothstep(0.5, 0.0, length(q));
          float depth = -vWPos.y;
          // 햇빛 받은 입자만 순간적으로 반짝임
          float tw = pow(max(sin(uTime * (0.8 + vSeed * 2.0) + vSeed * 80.0), 0.0), 18.0);
          float lit = exp(-depth * 0.06);
          vec3 base = waterColor(depth) * 1.6 + vec3(0.12, 0.16, 0.15) * lit;
          vec3 c = base + uSunColor * tw * lit * 1.4;
          gl_FragColor = vec4(c * m * vA * 0.5, 1.0);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }
}

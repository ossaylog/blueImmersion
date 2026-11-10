// 수면을 통과해 내려오는 빛줄기 (God rays)
//  - 넓고 부드러운 가우시안 단면 + 길이 방향 노이즈 → 점선/계단 없는 연속적인 빛
//  - 모든 거듭제곱 연산은 음수 입력을 막아 NaN(검은 점) 발생 방지
//  - GPU에서 카메라 주변으로 래핑 → CPU 비용 0
import * as THREE from 'three';
import { waterUniforms, WATER_GLSL_COMMON } from './WaterShading';
import { mulberry32 } from '../core/math';

export class LightShafts {
  mesh: THREE.Mesh;
  constructor(scene: THREE.Scene, count: number) {
    const base = new THREE.PlaneGeometry(1, 1, 1, 24);
    base.translate(0, -0.5, 0); // 위(0) → 아래(-1)
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    const r = mulberry32(77);
    const off = new Float32Array(count * 3), prm = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      off[i * 3] = (r() - 0.5) * 60; off[i * 3 + 1] = -0.1; off[i * 3 + 2] = (r() - 0.5) * 60;
      prm[i * 4] = 1.6 + r() * 4.5;   // 폭
      prm[i * 4 + 1] = 18 + r() * 26; // 길이
      prm[i * 4 + 2] = r() * 100;     // 위상
      prm[i * 4 + 3] = 0.5 + r() * 0.5;
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
    geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(prm, 4));
    geo.instanceCount = count;

    const mat = new THREE.ShaderMaterial({
      uniforms: { ...waterUniforms, uStrength: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute vec3 aOffset; attribute vec4 aParams;
        uniform vec3 uSunDir; uniform float uTime;
        varying float vAlong; varying float vU; varying float vI; varying vec3 vWPos; varying float vEdge; varying float vSeed; varying float vFacing;
        void main() {
          float R = 30.0;
          vec3 b = aOffset;
          b.x = cameraPosition.x + mod(aOffset.x - cameraPosition.x + R, 2.0 * R) - R;
          b.z = cameraPosition.z + mod(aOffset.z - cameraPosition.z + R, 2.0 * R) - R;
          vec2 rel = (b.xz - cameraPosition.xz) / R;
          vEdge = 1.0 - smoothstep(0.55, 0.95, max(abs(rel.x), abs(rel.y)));
          b.x += sin(uTime * 0.04 + aParams.z) * 1.2;
          b.z += cos(uTime * 0.035 + aParams.z * 1.7) * 1.2;
          vec3 axis = -normalize(vec3(uSunDir.x * 0.45, 1.0, uSunDir.z * 0.45));
          float along = clamp(-position.y, 0.0, 1.0);
          vec3 P = b + axis * along * aParams.y;
          vec3 toCam = cameraPosition - P;
          vec3 side = cross(axis, toCam);
          float sl = length(side);
          side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
          // 카메라가 빛줄기 축 방향에서 볼수록 얇은 판이 드러나므로 흐리게
          vFacing = clamp(sl / max(length(toCam), 1e-3), 0.0, 1.0);
          P += side * position.x * aParams.x * (1.0 + along * 0.9);
          vAlong = along; vU = uv.x; vWPos = P; vSeed = aParams.z;
          vI = aParams.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlong; varying float vU; varying float vI; varying vec3 vWPos; varying float vEdge; varying float vSeed; varying float vFacing;
        uniform float uStrength;
        ${WATER_GLSL_COMMON}
        float h1(float n){ return fract(sin(n) * 43758.5453); }
        float n1(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
        void main() {
          if (uUnderwater < 0.5) discard;
          float x = clamp(vU, 0.0, 1.0) * 2.0 - 1.0;
          float along = clamp(vAlong, 0.0, 1.0);
          // 가우시안 단면 (가장자리에서 정확히 0으로 수렴, 음수 없음)
          float prof = exp(-x * x * 4.5) - exp(-4.5);
          prof = max(prof, 0.0);
          // 줄기 내부의 가는 결 (수면 파도가 만든 빛의 다발)
          float strands = 0.65 + 0.35 * n1(x * 6.0 + vSeed + uTime * 0.25) * n1(x * 11.0 - vSeed * 0.7 - uTime * 0.18);
          float top = smoothstep(0.0, 0.05, along);
          float bottom = (1.0 - along) * (1.0 - along);
          // 수면 파도에 따라 시간적으로 일렁임 (느리게)
          float flicker = 0.55 + 0.45 * n1(uTime * 0.35 + vSeed * 3.0);
          float dist = length(vWPos - cameraPosition);
          float nearFade = smoothstep(1.5, 7.0, dist);
          float farFade = exp(-dist * 0.03);
          float depthFade = exp(-max(-vWPos.y, 0.0) * 0.04);
          float a = prof * strands * top * bottom * flicker * nearFade * farFade * depthFade * vI * vEdge * (0.35 + 0.65 * vFacing);
          vec3 c = mix(vec3(0.55, 0.92, 0.9), vec3(0.35, 0.68, 0.9), along) * uSunColor;
          gl_FragColor = vec4(c * max(a, 0.0) * 0.14 * uStrength, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }
}

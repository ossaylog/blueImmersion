// 하늘 돔 (수면 위) + 끝없는 물 배경 (수면 아래)
import * as THREE from 'three';
import { waterUniforms, WATER_GLSL_COMMON } from './WaterShading';

// 수면 반사와 하늘 돔이 같은 함수를 공유
export const SKY_GLSL = /* glsl */ `
vec3 skyColor(vec3 d) {
  d = normalize(d);
  float y = max(d.y, 0.0);
  float sd = max(dot(d, uSunDir), 0.0);
  // 열대 한낮: 수평선은 습한 대기로 하얗게, 위로 갈수록 짙은 코발트
  vec3 zenith = vec3(0.035, 0.17, 0.58);
  vec3 mid = vec3(0.16, 0.44, 0.86);
  vec3 horizon = vec3(0.70, 0.84, 0.95);
  vec3 c = mix(horizon, mid, smoothstep(0.0, 0.2, y));
  c = mix(c, zenith, smoothstep(0.15, 0.9, y));
  // 태양 쪽 대기 산란 (수평선 부근이 더 밝고 따뜻함)
  c += vec3(1.0, 0.9, 0.72) * pow(sd, 4.0) * 0.22 * (1.0 - y * 0.7);
  c += uSunColor * (pow(sd, 12.0) * 0.22 + pow(sd, 220.0) * 0.9);
  return c;
}
float sky_h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sky_n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sky_h(i), sky_h(i + vec2(1, 0)), f.x), mix(sky_h(i + vec2(0, 1)), sky_h(i + vec2(1, 1)), f.x), f.y); }
float sky_fbm5(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * sky_n(p); p = p * 2.07 + 1.3; a *= 0.5; } return s; }
float sky_fbm3(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * sky_n(p); p = p * 2.07 + 1.3; a *= 0.5; } return s / 0.875; }
// 적운 + 수평선 구름띠 + 높은 새털구름. rgb = 색, a = 덮임 (hq: 하늘 돔용 고품질)
vec4 skyClouds(vec3 d, bool hq) {
  d = normalize(d);
  if (d.y <= 0.0) return vec4(0.0);
  float sd = max(dot(d, uSunDir), 0.0);
  vec2 uv = d.xz / (d.y + 0.1) * 0.85 + vec2(uTime * 0.0035, uTime * 0.0012);
  float base = hq ? sky_fbm5(uv) : sky_fbm3(uv);
  float cov = smoothstep(0.5, 0.74, base);
  // 태양 쪽으로 조금 옮긴 지점의 밀도와 비교 → 태양을 향한 면은 밝고, 반대쪽 아랫면은 회청색 그늘
  vec2 sdir = normalize(uSunDir.xz + 1e-4) * 0.09;
  float toward = hq ? sky_fbm5(uv + sdir) : sky_fbm3(uv + sdir);
  float lit = clamp(0.55 + (base - toward) * 5.0, 0.0, 1.0);
  float thick = smoothstep(0.55, 0.9, base);
  vec3 sunlit = vec3(1.0, 0.985, 0.95) * 1.3;
  vec3 shade = vec3(0.5, 0.58, 0.7);
  vec3 col = mix(shade, sunlit, lit * (1.0 - thick * 0.45));
  // 태양 근처 구름 가장자리의 은빛 테두리
  col += uSunColor * pow(sd, 6.0) * (1.0 - thick) * 1.4;
  float a = cov * smoothstep(0.0, 0.16, d.y);
  // 수평선의 뭉게구름 띠 (먼 섬 위로 피어오르는 적운)
  float az = atan(d.z, d.x);
  float bankN = sky_fbm3(vec2(az * 7.0, d.y * 18.0) + 4.0);
  float bank = smoothstep(0.42, 0.7, bankN) * smoothstep(0.11, 0.015, d.y) * smoothstep(0.0, 0.012, d.y);
  vec3 bankCol = mix(vec3(0.72, 0.78, 0.86), vec3(1.02, 1.0, 0.97), smoothstep(0.0, 0.08, d.y) * 0.8 + pow(sd, 3.0) * 0.4);
  col = mix(col, bankCol, bank * (1.0 - a));
  a = max(a, bank * 0.9);
  if (hq) {
    // 아주 높은 새털구름 (얇은 결)
    vec2 cu = uv * vec2(0.35, 2.6) + vec2(uTime * 0.002, 0.0);
    float cir = smoothstep(0.55, 0.85, sky_fbm3(cu * 0.8)) * smoothstep(0.15, 0.5, d.y) * 0.35;
    col = mix(col, vec3(1.0), cir * (1.0 - a));
    a = max(a, cir);
  }
  return vec4(col, a);
}
`;

export class Sky {
  mesh: THREE.Mesh;
  constructor(scene: THREE.Scene) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...waterUniforms },
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        ${WATER_GLSL_COMMON}
        ${SKY_GLSL}
        void main() {
          vec3 d = normalize(vDir);
          if (uUnderwater < 0.5) {
            vec3 c = skyColor(d);
            float sd = max(dot(d, uSunDir), 0.0);
            // 태양 원반 + 코로나
            c += uSunColor * (smoothstep(0.99935, 0.9997, sd) * 22.0 + pow(sd, 900.0) * 3.0);
            vec4 cl = skyClouds(d, true);
            // 구름이 태양을 가리면 원반이 흐려짐
            c = mix(c, cl.rgb, cl.a * 0.92);
            // 수평선 아래(먼 바다 너머)는 수평선 색으로 채움
            if (d.y < 0.0) c = mix(skyColor(vec3(d.x, 0.0, d.z)) * 0.9, c, smoothstep(-0.02, 0.0, d.y));
            gl_FragColor = vec4(c, 1.0);
          } else {
            // 물속 무한 배경: 안개와 같은 산란 함수 → 경계 없이 녹아듦
            float camD = max(-cameraPosition.y, 0.0);
            vec3 c = inscatter(d, camD * 0.6 + (camD + 14.0) * 0.4);
            gl_FragColor = vec4(c, 1.0);
          }
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }
  update(camera: THREE.Camera) { this.mesh.position.copy(camera.position); }
}

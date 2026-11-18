// ★ 물 표현의 핵심: 모든 수중 머티리얼에 공통으로 주입되는 셰이더 패치
//  1) 태양광 수심 흡수 (빨강 → 초록 → 파랑 순으로 사라짐)
//  2) 시선 경로 산란 (수심별 물색으로 녹아듦)
//  3) 커스틱 (수면 파도가 만든 빛 무늬)
//  4) 수면 위에서 볼 때는 수중 구간 경로만 계산
import * as THREE from 'three';

export const waterUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.35, 0.86, 0.36).normalize() },
  uSunColor: { value: new THREE.Color(1.0, 0.96, 0.88) },
  uUnderwater: { value: 0 },
  uAbsorb: { value: new THREE.Vector3(0.075, 0.026, 0.018) },
  uExtinct: { value: new THREE.Vector3(0.072, 0.047, 0.042) },
  uW0: { value: new THREE.Color(0.018, 0.33, 0.42) },   //  0m  밝은 에메랄드/청록
  uW1: { value: new THREE.Color(0.008, 0.21, 0.36) },  //  8m  청록 → 코발트
  uW2: { value: new THREE.Color(0.004, 0.105, 0.25) },  // 18m  코발트 블루
  uW3: { value: new THREE.Color(0.002, 0.035, 0.11) }, // 35m  깊은 남색
  uCaustic: { value: 1.15 },
  uAirFogColor: { value: new THREE.Color(0.62, 0.8, 0.95) },
  uAirFog: { value: 0.0009 },
};

export const WATER_GLSL_COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uUnderwater;
uniform vec3 uAbsorb;
uniform vec3 uExtinct;
uniform vec3 uW0; uniform vec3 uW1; uniform vec3 uW2; uniform vec3 uW3;
uniform float uCaustic;
uniform vec3 uAirFogColor;
uniform float uAirFog;

vec3 waterColor(float d) {
  vec3 c = mix(uW0, uW1, smoothstep(0.0, 8.0, d));
  c = mix(c, uW2, smoothstep(8.0, 18.0, d));
  c = mix(c, uW3, smoothstep(18.0, 36.0, d));
  return c;
}

// 타일링 가능한 절차적 커스틱 (얇게 빛나는 그물 무늬)
float causticTile(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 7.0);
}
float caustics(vec3 wp, float t) {
  vec2 uv = wp.xz - uSunDir.xz / max(uSunDir.y, 0.2) * wp.y;
  float a = causticTile(uv * 0.105, t * 0.5);
  float b = causticTile(uv * 0.162 + 0.37, t * 0.43 + 1.7);
  return a * 0.65 + b * 0.55;
}

// 카메라 → 프래그먼트 경로 중 물속 구간 길이
float underwaterPath(vec3 wp) {
  float dist = length(wp - cameraPosition);
  float camD = -cameraPosition.y;
  float fragD = -wp.y;
  if (uUnderwater > 0.5) {
    if (fragD >= 0.0) return dist;
    return dist * camD / max(camD - fragD, 1e-3);
  }
  if (fragD <= 0.0) return 0.0;
  return dist * fragD / max(fragD - camD, 1e-3);
}

// 물속 산란광: 위를 볼수록 밝고, 굴절된 태양 쪽으로 강한 전방 산란(헤니-그린스타인)
vec3 inscatter(vec3 dir, float d) {
  vec3 base = waterColor(d);
  vec3 sunW = normalize(vec3(uSunDir.x * 0.45, 1.0, uSunDir.z * 0.45));
  float mu = clamp(dot(dir, sunW), -1.0, 1.0);
  float g = 0.72;
  float hg = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * mu, 1e-3), 1.5);
  float up = clamp(dir.y, -1.0, 1.0);
  vec3 c = base * mix(0.55, 1.0, smoothstep(-0.9, 0.15, up)) * (0.85 + 0.4 * max(up, 0.0));
  c += base * hg * 0.055 * exp(-d * 0.045) * vec3(0.9, 1.05, 1.0);
  return c;
}

vec3 applyWaterView(vec3 col, vec3 wp) {
  float path = underwaterPath(wp);
  if (path > 0.0) {
    float d = max(0.0, mix(-wp.y, -cameraPosition.y, uUnderwater * 0.5));
    vec3 T = exp(-uExtinct * path);
    vec3 dir = normalize(wp - cameraPosition + vec3(0.0, 1e-4, 0.0));
    vec3 fogc = uUnderwater > 0.5 ? inscatter(dir, max(-cameraPosition.y, 0.0) * 0.6 + d * 0.4) : waterColor(d);
    col = mix(fogc, col, T);
  }
  if (uUnderwater < 0.5 && wp.y > -0.05) {
    float dist = length(wp - cameraPosition);
    col = mix(col, uAirFogColor, 1.0 - exp(-uAirFog * dist));
  }
  return col;
}

// 큰·희귀 생물: 멀리서는 색 대신 '물빛보다 어두운 그림자 덩어리'로 보이다가, 가까워질수록 본래 색이 드러남
//  실제 바닷속에서 커다란 생물이 푸른 물 너머에서 먼저 실루엣으로 나타나는 모습
vec3 applyWaterSilhouette(vec3 col, vec3 wp) {
  float path = underwaterPath(wp);
  if (uUnderwater < 0.5 || path <= 0.0) return applyWaterView(col, wp);
  float dist = length(wp - cameraPosition);
  float d = max(0.0, mix(-wp.y, -cameraPosition.y, 0.5));
  vec3 dir = normalize(wp - cameraPosition + vec3(0.0, 1e-4, 0.0));
  vec3 fogc = inscatter(dir, max(-cameraPosition.y, 0.0) * 0.6 + d * 0.4);
  vec3 nearC = mix(fogc, col, exp(-uExtinct * path));
  // 그림자는 물에 덜 묻혀 더 멀리서도 보임 · 등장 거리(약 70m) 직전에는 서서히 나타남
  float keep = exp(-0.047 * path * 0.5) * (1.0 - smoothstep(56.0, 70.0, dist));
  vec3 shadowC = mix(fogc, fogc * vec3(0.34, 0.4, 0.46), keep);
  return mix(nearC, shadowC, smoothstep(10.0, 26.0, dist));
}
`;

/** 산호가 해저에 드리우는 접촉 그림자 (CoralReef가 생성, Seabed가 사용) */
export const reefShadow = {
  uReefShadow: { value: null as THREE.Texture | null },
  uReefShadowRect: { value: new THREE.Vector4(-80, -125, 160, 180) }, // x0, z0, w, h
};

export interface WaterPatchOptions {
  caustics?: boolean;
  /** 추가 셰이더 수정 (물고기 꼬리 파동, 산호 흔들림 등) — 워터 패치 전에 실행 */
  extend?: (shader: THREE.WebGLProgramParametersWithUniforms) => void;
  key?: string;
}

/** MeshStandardMaterial 계열에 물 셰이딩 주입 */
export function patchWater<T extends THREE.Material>(mat: T, opts: WaterPatchOptions = {}): T {
  const caustics = opts.caustics !== false;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waterUniforms);
    opts.extend?.(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 bwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          bwp = instanceMatrix * bwp;
        #endif
        vWPos = (modelMatrix * bwp).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\n' + WATER_GLSL_COMMON)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        {
          vec3 col = gl_FragColor.rgb;
          float fd = -vWPos.y;
          float causticMask = 1.0;
          #ifdef CAUSTIC_MASK
            causticMask = CAUSTIC_MASK;
          #endif
          if (fd > 0.0) {
            vec3 att = exp(-uAbsorb * fd);
            ${caustics ? `
            vec3 wn = inverseTransformDirection(normal, viewMatrix);
            float up = clamp(wn.y * 0.8 + 0.2, 0.0, 1.0);
            float cf = exp(-fd * 0.075) * smoothstep(0.05, 0.8, fd) * causticMask;
            col += diffuseColor.rgb * uSunColor * caustics(vWPos, uTime) * up * cf * uCaustic;` : ''}
            col *= att;
            // 물에 산란된 주변광 (그늘도 완전히 검지 않게)
            col += diffuseColor.rgb * waterColor(fd) * 0.08;
          }
          #ifdef WATER_SILHOUETTE
            gl_FragColor.rgb = applyWaterSilhouette(col, vWPos);
          #else
            gl_FragColor.rgb = applyWaterView(col, vWPos);
          #endif
        }`);
  };
  mat.customProgramCacheKey = () => 'water_' + (opts.key ?? '') + (caustics ? 'c' : '') + (mat.defines?.WATER_SILHOUETTE !== undefined ? 's' : '');
  return mat;
}

/** 이 재질을 '멀리서는 그림자로 다가오는' 큰·희귀 생물용으로 */
export function markSilhouette(root: THREE.Object3D | THREE.Material) {
  const apply = (m: THREE.Material) => {
    if (!m.defines) m.defines = {};
    if (m.defines.WATER_SILHOUETTE !== undefined) return;
    m.defines.WATER_SILHOUETTE = '';
    m.needsUpdate = true;
  };
  if ((root as THREE.Material).isMaterial) { apply(root as THREE.Material); return; }
  (root as THREE.Object3D).traverse((o) => {
    const mm = (o as THREE.Mesh).material;
    if (!mm) return;
    for (const m of Array.isArray(mm) ? mm : [mm]) if (m.customProgramCacheKey().startsWith('water_')) apply(m);
  });
}

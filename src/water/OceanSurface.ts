// 수면: Gerstner 파도 (GPU 정점 + 프래그먼트 법선, CPU 동일 함수로 배/스노클러 부력)
//  - 위에서: 프레넬 반사 + 리프 위 청록 투과 (지형 깊이 텍스처)
//  - 아래에서: 스넬의 창(≈48.6°) 안쪽은 하늘과 태양, 바깥은 전반사
import * as THREE from 'three';
import { waterUniforms, WATER_GLSL_COMMON } from './WaterShading';
import { heightAt, WORLD_SIZE } from '../world/terrain';
import { SKY_GLSL } from './Sky';

interface Wave { dir: number; len: number; amp: number }
// 잔잔한 열대 바다 (풍속 약함)
const GEO_WAVES: Wave[] = [
  { dir: 0.35, len: 24, amp: 0.22 }, { dir: 1.05, len: 15, amp: 0.13 }, { dir: -0.55, len: 9.5, amp: 0.08 },
  { dir: 2.1, len: 6.2, amp: 0.05 }, { dir: 0.85, len: 3.9, amp: 0.028 },
];
const RIPPLES: Wave[] = [
  { dir: -1.3, len: 2.3, amp: 0.016 }, { dir: 0.45, len: 1.45, amp: 0.009 }, { dir: 2.6, len: 0.9, amp: 0.006 },
  { dir: -2.3, len: 0.6, amp: 0.004 }, { dir: 1.6, len: 0.37, amp: 0.0025 },
];
const G = 9.81;

function waveGLSL(list: Wave[], name: string) {
  const lines = list.map((w) => {
    const k = (2 * Math.PI) / w.len, om = Math.sqrt(G * k);
    const dx = Math.cos(w.dir).toFixed(4), dz = Math.sin(w.dir).toFixed(4);
    return `{ vec2 d = vec2(${dx}, ${dz}); float f = ${k.toFixed(4)} * dot(d, p) - ${om.toFixed(4)} * t;
      h += ${w.amp.toFixed(4)} * sin(f); g += ${(w.amp * k).toFixed(5)} * cos(f) * d; }`;
  });
  return `void ${name}(vec2 p, float t, inout float h, inout vec2 g) { ${lines.join('\n')} }`;
}

export function waveHeight(x: number, z: number, t: number): number {
  let h = 0;
  for (const w of GEO_WAVES) {
    const k = (2 * Math.PI) / w.len, om = Math.sqrt(G * k);
    h += w.amp * Math.sin(k * (Math.cos(w.dir) * x + Math.sin(w.dir) * z) - om * t);
  }
  return h;
}
export function waveSlope(x: number, z: number, t: number): [number, number] {
  let gx = 0, gz = 0;
  for (const w of GEO_WAVES) {
    const k = (2 * Math.PI) / w.len, om = Math.sqrt(G * k);
    const c = w.amp * k * Math.cos(k * (Math.cos(w.dir) * x + Math.sin(w.dir) * z) - om * t);
    gx += c * Math.cos(w.dir); gz += c * Math.sin(w.dir);
  }
  return [gx, gz];
}

function buildDepthTexture() {
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i / (N - 1) - 0.5) * WORLD_SIZE, z = (j / (N - 1) - 0.5) * WORLD_SIZE;
    const d = -heightAt(x, z);
    const shallow = 1 - Math.min(1, Math.max(0, (d - 1.5) / 26));
    const o = (j * N + i) * 4;
    data[o] = Math.round(shallow * 255); data[o + 1] = Math.round(Math.min(1, d / 40) * 255); data[o + 2] = 0; data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return tex;
}

export class OceanSurface {
  near: THREE.Mesh;
  far: THREE.Mesh;
  material: THREE.ShaderMaterial;
  cell: number;

  constructor(scene: THREE.Scene, segments: number) {
    const uniforms = {
      ...waterUniforms,
      uDepthTex: { value: buildDepthTexture() },
      uWorldSize: { value: WORLD_SIZE },
      uDisplace: { value: 1 },
      uCenter: { value: new THREE.Vector2() },
      uClip: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uDisplace;
        varying vec3 vWPos;
        ${waveGLSL(GEO_WAVES, 'geoWaves')}
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float h = 0.0; vec2 g = vec2(0.0);
          geoWaves(wp.xz, uTime, h, g);
          wp.y += h * uDisplace;
          vWPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vWPos;
        uniform sampler2D uDepthTex; uniform float uWorldSize;
        uniform vec2 uCenter; uniform float uClip;
        ${WATER_GLSL_COMMON}
        ${SKY_GLSL}
        ${waveGLSL(GEO_WAVES, 'geoWaves')}
        ${waveGLSL(RIPPLES, 'ripples')}
        void main() {
          float rc = length(vWPos.xz - uCenter);
          if (uClip * (rc - 159.0) > 0.0) discard;
          float h = 0.0; vec2 g = vec2(0.0);
          geoWaves(vWPos.xz, uTime, h, g);
          float dist = length(vWPos - cameraPosition);
          float rippleFade = exp(-dist * 0.025);
          float h2 = 0.0; vec2 g2 = vec2(0.0);
          ripples(vWPos.xz, uTime, h2, g2);
          g += g2 * rippleFade;
          vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 V = normalize(cameraPosition - vWPos);

          if (cameraPosition.y >= vWPos.y - 0.02 && uUnderwater < 0.5) {
            // ── 위에서 본 수면 ──
            float ndv = clamp(dot(N, V), 0.0, 1.0);
            float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
            vec3 R = reflect(-V, N); R.y = abs(R.y);
            vec3 refl = skyColor(R);
            // 하늘의 구름까지 수면에 비침 (가까울수록 일렁여 흐트러짐)
            vec4 rcl = skyClouds(R, false);
            refl = mix(refl, rcl.rgb, rcl.a * 0.85);
            vec3 Hh = normalize(V + uSunDir);
            float spec = pow(max(dot(N, Hh), 0.0), 900.0) * 60.0 + pow(max(dot(N, Hh), 0.0), 90.0) * 0.6;
            // 윤슬: 잔물결 하나하나가 햇빛을 반짝 튕김
            vec2 gn = vec2(sky_n(vWPos.xz * 3.1 + uTime * 0.8), sky_n(vWPos.zx * 3.4 - uTime * 0.7)) - 0.5;
            vec3 Ns = normalize(N + vec3(gn.x, 0.0, gn.y) * 0.3);
            spec += pow(max(dot(Ns, Hh), 0.0), 2600.0) * 160.0 * (0.25 + rippleFade);
            vec2 tuv = vWPos.xz / uWorldSize + 0.5;
            float inside = step(0.0, tuv.x) * step(tuv.x, 1.0) * step(0.0, tuv.y) * step(tuv.y, 1.0);
            float shallow = texture2D(uDepthTex, clamp(tuv, 0.0, 1.0)).r * inside;
            // 깊은 바다 몸색 (산란광): 짙은 코발트 → 리프 위는 밝은 청록
            float sunUp = max(uSunDir.y, 0.0);
            vec3 deepBody = vec3(0.004, 0.05, 0.12) * (0.4 + sunUp);
            vec3 reefBody = vec3(0.03, 0.36, 0.40) * (0.5 + sunUp);
            vec3 body = mix(deepBody, reefBody, shallow);
            // 파도 마루 아래 빛 투과(서브서피스)
            float sss = pow(max(dot(V, -uSunDir + N * 0.6), 0.0), 3.0) * clamp(h * 2.0 + 0.4, 0.0, 1.0);
            body += vec3(0.02, 0.18, 0.16) * sss * 0.8;
            vec3 col = mix(body, refl, F) + uSunColor * spec;
            // 파도 마루의 잔잔한 흰 물거품 (가까운 곳에서만 보임)
            float fn = sky_n(vWPos.xz * 0.9 + vec2(uTime * 0.12, -uTime * 0.05)) * 0.6 + sky_n(vWPos.xz * 3.7 - uTime * 0.2) * 0.4;
            float foam = smoothstep(0.24, 0.42, h + (fn - 0.5) * 0.3) * smoothstep(0.45, 0.75, fn) * exp(-dist * 0.012);
            col = mix(col, vec3(0.92, 0.97, 1.0) * (0.55 + sunUp * 0.5), foam * 0.75);
            // 리프 위에서는 바닥이 비쳐 보이도록 투과
            float alpha = max(mix(1.0, 0.5 + F * 0.5, shallow), foam * 0.8);
            col = mix(col, uAirFogColor, 1.0 - exp(-uAirFog * dist));
            gl_FragColor = vec4(col, alpha);
          } else {
            // ── 물속에서 올려다본 수면 ──
            vec3 I = -V;                 // 카메라에서 위로 향하는 광선
            vec3 Nd = -N;                // 물 쪽을 향하는 법선
            vec3 T = refract(I, Nd, 1.333);
            vec3 col;
            float camD = max(-cameraPosition.y, 0.0);
            vec3 tir = waterColor(1.0) * 0.55;
            if (dot(T, T) < 1e-4) {
              col = tir;                 // 전반사: 물속이 거울처럼 비침
            } else {
              float ct = clamp(dot(-I, Nd), 0.0, 1.0);
              float F = 0.02 + 0.98 * pow(1.0 - ct, 5.0);
              vec3 sky = skyColor(normalize(T)) * 1.15;
              vec4 tcl = skyClouds(normalize(T), false);
              sky = mix(sky, tcl.rgb * 1.1, tcl.a * 0.8);
              float sun = pow(max(dot(normalize(T), uSunDir), 0.0), 220.0) * 30.0
                        + pow(max(dot(normalize(T), uSunDir), 0.0), 18.0) * 1.2;
              col = mix(sky + uSunColor * sun, tir, clamp(F * 1.6, 0.0, 1.0));
              // 스넬의 창 가장자리: 밝은 테두리
              col += vec3(0.25, 0.45, 0.5) * smoothstep(0.75, 1.0, F) * 0.4;
            }
            // 카메라 수심만큼 흡수
            col *= exp(-uAbsorb * camD * 0.9);
            vec3 Tr = exp(-uExtinct * dist);
            col = mix(inscatter(-V, camD * 0.6), col, Tr);
            gl_FragColor = vec4(col, 1.0);
          }
        }`,
    });

    const nearGeo = new THREE.PlaneGeometry(320, 320, segments, segments);
    nearGeo.rotateX(-Math.PI / 2);
    this.cell = 320 / segments;
    this.near = new THREE.Mesh(nearGeo, this.material);
    this.near.frustumCulled = false;
    this.near.renderOrder = 2;

    // 원경: 링 형태로 근경 바깥만 덮음 (겹침 방지)
    const farGeo = new THREE.RingGeometry(158, 7000, 64, 4);
    farGeo.rotateX(-Math.PI / 2);
    const farMat = this.material.clone();
    farMat.uniforms = { ...this.material.uniforms, uDisplace: { value: 0 }, uClip: { value: -1 } };
    this.far = new THREE.Mesh(farGeo, farMat);
    this.far.frustumCulled = false;
    this.far.renderOrder = 2;
    scene.add(this.near, this.far);
  }

  update(camera: THREE.Camera) {
    // 근경 메시를 카메라 주변 격자에 스냅 (파도는 월드 좌표 기준이라 흔들림 없음)
    const cell = this.cell;
    const x = Math.round(camera.position.x / cell) * cell;
    const z = Math.round(camera.position.z / cell) * cell;
    this.near.position.set(x, 0, z);
    this.far.position.set(x, 0, z);
    this.material.uniforms.uCenter.value.set(x, z);
  }
}

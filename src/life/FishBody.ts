// 종별 체형 파라미터 → 물고기 지오메트리 + 꼬리 파동/무늬 셰이더
// 좌표: 길이 1 기준, +z 가 머리(0.5), -z 가 꼬리 끝(-0.5)
import * as THREE from 'three';
import { patchWater, waterUniforms } from '../water/WaterShading';

export interface BodyDef {
  h: number; w: number; tail: 'fork' | 'lunate' | 'truncate' | 'round' | 'shark'; tailSize: number;
  dorsal: [number, number, number]; anal: [number, number, number]; pect: number;
  snout?: number; streamer?: number; hump?: number; spiky?: number; shark?: number;
  cetacean?: number; hammer?: number;
}

class Builder {
  pos: number[] = []; body: number[] = []; pat: number[] = []; fin: number[] = []; idx: number[] = [];
  v(x: number, y: number, z: number, u: number, pv: number, f: number) {
    this.pos.push(x, y, z); this.body.push(u); this.pat.push(u, pv); this.fin.push(f);
    return this.pos.length / 3 - 1;
  }
  grid(rows: number, cols: number, fn: (i: number, j: number) => [number, number, number, number, number, number]) {
    const base = this.pos.length / 3;
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) { const a = fn(i / rows, j / cols); this.v(...a); }
    const W = cols + 1;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = base + i * W + j, b = a + 1, c = a + W, d = c + 1;
      this.idx.push(a, c, b, b, c, d);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aBody', new THREE.Float32BufferAttribute(this.body, 1));
    g.setAttribute('aPat', new THREE.Float32BufferAttribute(this.pat, 2));
    g.setAttribute('aFin', new THREE.Float32BufferAttribute(this.fin, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const Z0 = -0.3, Z1 = 0.5; // 몸통 구간 (꼬리자루 ~ 주둥이)

/** det: 세부 단계 (1 = 원본, 작을수록 같은 모양의 저폴리곤 · 멀리 있는 물고기용) */
export function fishGeometry(b: BodyDef, det = 1) {
  const B = new Builder();
  const snout = b.snout ?? 0;
  const env = (t: number) => {
    if (t < 0.45) return 0.16 + 0.84 * Math.sin((t / 0.45) * Math.PI * 0.5) ** (b.shark ? 0.9 : 1.3);
    const u = (t - 0.45) / 0.55;
    return Math.max(0.02, Math.cos(u * Math.PI * 0.5) ** (0.6 - snout * 0.35));
  };
  const halfH = (t: number, top: boolean) => {
    let h = (b.h / 2) * env(t);
    if (top && b.hump) h *= 1 + 0.35 * Math.exp(-((t - 0.78) ** 2) / 0.006);
    return top ? h : h * 0.92;
  };
  const halfW = (t: number) => {
    let w = (b.w / 2) * (0.25 + 0.75 * env(t));
    if (b.hammer) w += b.hammer * 0.5 * THREE.MathUtils.smoothstep(t, 0.86, 0.95) * (1 - THREE.MathUtils.smoothstep(t, 0.985, 1.0) * 0.6);
    return w;
  };
  const zt = (t: number) => Z0 + (Z1 - Z0) * t;

  // 몸통 (타원 단면, 배는 약간 납작)
  const NL = Math.max(6, Math.round(20 * det)), NR = Math.max(6, Math.round(14 * det));
  B.grid(NL, NR, (i, j) => {
    const t = i, a = j * Math.PI * 2;
    const s = Math.sin(a), c = Math.cos(a);
    let y = s > 0 ? s * halfH(t, true) : s * halfH(t, false);
    if (b.hammer && t > 0.86) y *= 1 - 0.55 * THREE.MathUtils.smoothstep(t, 0.86, 0.95) * Math.abs(c);
    const x = c * halfW(t) * (s < 0 ? 0.9 : 1);
    const z = zt(t) - (b.shark ? 0 : 0.02 * (1 - Math.abs(s)) * (t > 0.95 ? 1 : 0));
    return [x, y, z, (z + 0.5), s, 0];
  });

  // 꼬리지느러미
  const tl = b.tailSize, h0 = halfH(0, true);
  const Ht = b.h * (b.shark ? 0.55 : 0.62) * (b.tail === 'round' ? 0.8 : 1);
  if (b.cetacean) {
    // 고래류: 수평 꼬리지느러미 (위아래로 침)
    B.grid(6, 10, (i, j) => {
      const s = i, v = j * 2 - 1;
      const span = (b.h * 0.25 + b.h * 1.05 * Math.pow(s, 0.7));
      const len = tl * (1 - 0.45 * s * (1 - Math.abs(v)) ** 1.5) * (1 - 0.25 * Math.abs(v));
      const z = Z0 - len * s;
      return [v * span * 0.5, 0, z, z + 0.5, 1.2 + s * 0.6, 1];
    });
  } else B.grid(6, 10, (i, j) => {
    const s = i;                        // 꼬리자루 → 끝
    const v = j * 2 - 1;                // 아래 → 위
    let notch = 0;
    if (b.tail === 'fork') notch = 0.7; else if (b.tail === 'lunate') notch = 0.45; else if (b.tail === 'round') notch = -0.35; else if (b.tail === 'shark') notch = 0.55;
    let top = h0 + (Ht - h0) * Math.pow(s, 0.8);
    let vv = v;
    if (b.tail === 'shark') { vv = v > 0 ? v * 1.35 : v * 0.6; }
    const len = tl * (1 - notch * s * (1 - Math.abs(v)) ** 1.5);
    const z = Z0 - len * s - (b.tail === 'lunate' ? 0.04 * Math.abs(v) * s : 0);
    const y = vv * top + (b.tail === 'shark' ? s * 0.05 * (v + 0.3) : 0);
    return [0, y, z, z + 0.5, 1.2 + s * 0.6, 1];
  });

  // 등지느러미 / 뒷지느러미
  const fin = (t0: number, t1: number, hgt: number, top: boolean) => {
    B.grid(10, 4, (i, j) => {
      const t = t0 + (t1 - t0) * i;
      let shape = Math.sin(i * Math.PI) ** 0.5;
      if (b.shark) shape = i < 0.35 ? i / 0.35 : Math.pow(1 - (i - 0.35) / 0.65, 0.6) * (1 - 0.5 * j);
      if (b.spiky && top) shape *= 0.55 + 0.45 * Math.abs(Math.sin(i * Math.PI * 7));
      if (b.streamer && top) shape = i < 0.3 ? 1 : Math.pow(1 - (i - 0.3) / 0.7, 1.5);
      const base = top ? halfH(t, true) : -halfH(t, false);
      const sweep = (b.shark ? 0.06 : b.streamer && top ? 0.2 : 0.03) * j;
      const z = zt(t) - sweep;
      const y = base + (top ? 1 : -1) * hgt * shape * j;
      return [0, y, z, z + 0.5, (top ? 1 : -1) * (1.05 + j), 1];
    });
  };
  fin(b.dorsal[0], b.dorsal[1], b.dorsal[2], true);
  if (b.anal[2] > 0) fin(b.anal[0], b.anal[1], b.anal[2], false);
  if (b.streamer) {
    // 무어리시 아이돌의 긴 등지느러미 실
    B.grid(14, 1, (i, j) => {
      const t = b.dorsal[0] + 0.03;
      const base = halfH(t, true) + b.dorsal[2] * 0.9;
      const z = zt(t) - i * 0.6 - j * 0.015;
      const y = base + i * 0.35 - i * i * 0.45;
      return [0, y, z, z + 0.5, 2.0, 1];
    });
  }
  // 가슴지느러미 (좌우)
  for (const side of [-1, 1]) {
    const t = b.cetacean ? 0.72 : 0.66, z0 = zt(t), y0 = -halfH(t, false) * (b.cetacean ? 0.55 : 0.15), x0 = halfW(t) * side * 0.9;
    const L = b.pect;
    B.grid(b.cetacean ? 8 : 4, 6, (i, j) => {
      if (b.cetacean) {
        // 고래·돌고래 가슴지느러미: 옆·아래·뒤로 뻗은 긴 노
        const r = L * i, w = (b.h * 0.12 + L * 0.12) * (1 - i * 0.75) * (j - 0.5);
        const x = x0 + side * r * 0.75, y = y0 - r * 0.45, z = z0 - r * 0.35 + w;
        return [x, y, z, z + 0.5, 1.1 + i, 2];
      }
      const a = (j - 0.5) * (b.spiky ? 2.2 : 1.1);
      const r = L * i;
      const x = x0 + side * r * 0.45;
      const z = z0 - r * Math.cos(a) * 0.9;
      const y = y0 + r * Math.sin(a) * 0.6;
      return [x, y, z, z + 0.5, 1.1 + i, 2];
    });
  }
  return B.build();
}

const GLSL_PATTERNS = /* glsl */ `
uniform float uPattern; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uC4; uniform float uH;
varying vec2 vPat; varying float vFin;
float bandF(float u, float c, float w, float e) { return 1.0 - smoothstep(w, w + e, abs(u - c)); }
float fh(vec2 p){ return fract(sin(dot(p, vec2(41.7, 289.3))) * 43758.5453); }
float spots(vec2 q, float r) { vec2 i = floor(q), f = fract(q) - 0.5; vec2 o = vec2(fh(i), fh(i + 7.1)) - 0.5; return 1.0 - smoothstep(r * 0.7, r, length(f - o * 0.5)); }
vec3 extraPattern(float u, float v, bool fin, float P) {
  vec3 c = mix(uC2, uC1, smoothstep(-0.45, 0.4, v));
  if (P < 12.5) {                                   // 12 고래상어: 흰 점 + 가로세로 줄
    c = mix(uC2, uC1, smoothstep(-0.55, -0.2, v));
    float sp = spots(vec2(u * 34.0, v * 7.0), 0.28) * smoothstep(-0.35, -0.1, v);
    float ln = (smoothstep(0.04, 0.0, abs(fract(u * 17.0) - 0.5) - 0.44) + smoothstep(0.03, 0.0, abs(fract(v * 3.5) - 0.5) - 0.46)) * smoothstep(-0.2, 0.1, v) * step(u, 0.8);
    c = mix(c, uC3, clamp(sp + ln * 0.6, 0.0, 1.0));
    if (fin) c = mix(uC1, uC3, spots(vec2(u * 30.0, v * 3.0), 0.25));
  } else if (P < 13.5) {                            // 13 바라쿠다: 은빛 + 갈매기 무늬
    c = mix(uC2, uC1, smoothstep(0.1, 0.7, v));
    float ch = smoothstep(0.75, 0.95, sin((u * 2.0 + abs(v) * 0.25) * 55.0)) * smoothstep(-0.1, 0.4, v) * step(0.15, u);
    c = mix(c, uC3, ch * 0.7);
    if (fin) c = uC3;
  } else if (P < 14.5) {                            // 14 정어리·전갱이: 은빛 + 진한 등
    c = mix(uC2, uC1, smoothstep(0.2, 0.6, v));
    c = mix(c, uC3, smoothstep(0.03, 0.0, abs(v - 0.18)) * 0.4);
    c += vec3(0.15) * smoothstep(0.6, 1.0, sin(u * 120.0 + v * 30.0)) * (1.0 - smoothstep(0.2, 0.6, v));
    if (fin) c = mix(uC3, uC2, 0.3);
  } else if (P < 15.5) {                            // 15 황제엔젤피시: 청·황 사선 줄무늬 + 검은 가면
    float st = smoothstep(-0.3, 0.3, sin((u * 1.0 + v * 0.35) * 60.0));
    c = mix(uC1, uC2, st);
    c = mix(c, uC3, bandF(u + v * 0.12, 0.79, 0.04, 0.01));
    c = mix(c, uC4, bandF(u, 0.7, 0.03, 0.01) * step(v, 0.1));
    if (u < 0.16) c = uC2;
    if (fin) c = mix(uC1, uC2, 0.5);
  } else if (P < 16.5) {                            // 16 단색 (옐로탱·가리발디)
    c = mix(uC1 * 0.85, uC1 * 1.05, smoothstep(-0.6, 0.6, v));
    if (fin) c = uC3;
  } else if (P < 17.5) {                            // 17 퀸 엔젤피시
    c = mix(uC1, uC2, smoothstep(0.75, 0.2, u) * 0.6 + 0.2);
    c = mix(c, uC3, smoothstep(0.05, 0.0, abs(length(vec2((u - 0.8) * 3.0, v - 0.75)) - 0.12)));
    if (fin) c = mix(uC2, uC3, smoothstep(1.5, 1.9, abs(v)));
    if (u < 0.14) c = uC2;
  } else if (P < 18.5) {                            // 18 박쥐고기: 은빛 + 검은 세로띠
    c = uC1;
    c = mix(c, uC3, bandF(u, 0.84, 0.035, 0.01)); c = mix(c, uC3, bandF(u, 0.62, 0.04, 0.02) * 0.85);
    if (fin) c = mix(uC2, uC3, 0.4);
  } else if (P < 19.5) {                            // 19 고래류: 역그늘 (등 어둡고 배 밝음)
    c = mix(uC2, uC1, smoothstep(-0.55, 0.1, v));
    c = mix(c, uC3, smoothstep(0.4, 0.6, v) * 0.4);
    if (fin) c = mix(uC1, uC2, step(1.5, abs(v)) * uC4.x);
  } else if (P < 20.5) {                            // 20 개복치: 얼룩덜룩한 은회색
    float m = fh(floor(vec2(u * 14.0, v * 6.0)));
    c = mix(uC1, uC2, 0.4 + 0.4 * m * smoothstep(-0.8, 0.8, -v));
    if (fin) c = uC1 * 0.9;
  } else if (P < 21.5) {                            // 21 얼룩말상어/표범상어: 황갈색 + 검은 반점
    c = mix(uC2, uC1, smoothstep(-0.6, 0.0, v));
    c = mix(c, uC3, spots(vec2(u * 26.0, v * 5.0), 0.3));
    if (fin) c = mix(uC1, uC3, spots(vec2(u * 22.0, v * 3.0), 0.3));
  } else {                                          // 22 리갈 엔젤피시: 주황 몸에 남색 테두리의 흰 세로띠, 남색 등지느러미, 노란 꼬리
    c = uC1;
    float ph = fract((u + v * 0.06) * 8.5);
    float bar = 1.0 - smoothstep(0.12, 0.16, abs(ph - 0.5));
    float edge = (1.0 - smoothstep(0.2, 0.25, abs(ph - 0.5))) - bar;
    float on = smoothstep(0.18, 0.24, u) * step(u, 0.84);
    c = mix(c, uC3, edge * on); c = mix(c, uC2, bar * on);
    if (u > 0.84) c = mix(uC1, uC4, 0.35);
    if (u < 0.16) c = uC4;
    if (fin) {
      c = v > 0.0 ? uC3 : mix(uC4, uC3, 0.35);
      c = mix(c, uC2, spots(vec2(u * 30.0, v * 4.0), 0.22) * step(0.0, v) * 0.8);
      if (u < 0.16) c = uC4;
    }
  }
  return c;
}
vec3 fishPattern() {
  float u = vPat.x;          // 0 꼬리 끝 → 1 주둥이
  float v = vPat.y;          // -1 배 → 1 등 (지느러미는 |v|>1)
  bool fin = vFin > 0.5;
  float P = uPattern;
  vec3 c = mix(uC2, uC1, smoothstep(-0.45, 0.55, v));
  if (P < 0.5) {                                    // 0 크로미스: 무지개빛 청록
    c = mix(uC2, uC1, smoothstep(-0.6, 0.5, v));
    if (fin) c = uC3 * 0.9;
  } else if (P < 1.5) {                             // 1 흰동가리
    c = uC1;
    float b1 = bandF(u + v * 0.03, 0.735, 0.045, 0.006);
    float b2 = bandF(u - v * v * 0.04, 0.47, 0.04, 0.006);
    float b3 = bandF(u, 0.115, 0.02, 0.006);
    float bl = max(max(bandF(u + v * 0.03, 0.735, 0.058, 0.004), bandF(u - v * v * 0.04, 0.47, 0.053, 0.004)), bandF(u, 0.115, 0.032, 0.004));
    c = mix(c, uC3, bl); c = mix(c, uC2, max(max(b1, b2), b3));
    if (fin) { c = mix(uC1, uC3, smoothstep(1.55, 1.75, abs(v))); c = mix(c, uC2, smoothstep(1.85, 1.95, abs(v))); }
  } else if (P < 2.5) {                             // 2 무어리시 아이돌
    c = uC1;
    c = mix(c, uC2, smoothstep(0.42, 0.5, u) * (1.0 - smoothstep(0.62, 0.66, u)) * smoothstep(-0.2, 0.4, v));
    c = mix(c, uC2, bandF(u, 0.17, 0.07, 0.02));
    c = mix(c, uC3, bandF(u - v * 0.05, 0.72, 0.075, 0.01));
    c = mix(c, uC3, bandF(u + v * 0.04, 0.335, 0.075, 0.01));
    if (u > 0.93 && v > 0.0) c = mix(c, uC4, 0.8);
    if (u < 0.12) c = mix(uC3, uC1, smoothstep(0.02, 0.0, u));
    if (fin && abs(v) > 1.9) c = uC1;
  } else if (P < 3.5) {                             // 3 블루탱
    c = uC1;
    float line = 0.2 + 0.45 * (1.0 - u);
    float pal = (1.0 - smoothstep(0.25, 0.3, abs(v - line))) * smoothstep(0.18, 0.25, u) * (1.0 - smoothstep(0.84, 0.88, u));
    float hole = 1.0 - smoothstep(0.08, 0.1, length(vec2((u - 0.52) * 1.6, (v - 0.22) * uH)));
    c = mix(c, uC2, pal * (1.0 - hole));
    if (u < 0.22) c = mix(c, uC3, smoothstep(0.22, 0.12, u) * (1.0 - smoothstep(0.6, 1.4, abs(v))));
    if (fin && abs(v) > 1.6) c = mix(c, uC2, 0.8);
  } else if (P < 4.5) {                             // 4 앵무고기: 비늘 테두리가 분홍
    vec2 cell = fract(vec2(u * 26.0, v * 4.5 + u * 13.0));
    float edge = smoothstep(0.32, 0.48, max(abs(cell.x - 0.5), abs(cell.y - 0.5)));
    c = mix(uC1, uC2, edge * 0.55);
    if (u > 0.82) c = mix(c, uC2 * 1.1, smoothstep(0.82, 0.95, u) * 0.6);
    if (fin) c = mix(uC3, uC4, smoothstep(1.4, 1.9, abs(v)));
  } else if (P < 5.5) {                             // 5 안티아스
    c = mix(uC2, uC1, smoothstep(-0.8, 0.2, v));
    c = mix(c, uC4, bandF(v + (u - 0.8) * 4.0, -0.15, 0.06, 0.04) * step(0.7, u) * step(u, 0.88));
    if (fin) c = mix(uC3, uC4, smoothstep(1.5, 1.9, abs(v)));
  } else if (P < 6.5) {                             // 6 나비고기
    c = mix(uC2, uC1, smoothstep(0.35, 0.6, u));
    float chev = smoothstep(0.85, 0.95, sin((u * 1.3 + v * 0.35) * 70.0)) * smoothstep(0.3, 0.6, u);
    c = mix(c, uC4 * 0.8, chev * 0.6);
    c = mix(c, uC3, bandF(u - v * 0.02, 0.87, 0.022, 0.006));
    if (fin) c = uC2;
    if (fin && v > 1.1 && u > 0.26 && u < 0.36) c = mix(c, uC3, 1.0 - smoothstep(0.03, 0.04, length(vec2(u - 0.31, (v - 1.6) * 0.05))));
  } else if (P < 7.5) {                             // 7 상어: 역그늘 + 지느러미 끝
    c = mix(uC2, uC1, smoothstep(-0.25, 0.15, v));
    if (fin) { c = uC1; c = mix(c, uC3, smoothstep(1.55, 1.85, abs(v))); }
    if (u < 0.06) c = mix(c, uC3, 0.7);
    c = mix(c, uC4, bandF(u, 0.76, 0.003, 0.002) * step(-0.2, v) * step(v, 0.4) * 0.6);
  } else if (P < 8.5) {                             // 8 라이온피시
    float s = smoothstep(-0.25, 0.25, sin(u * 95.0 + v * 1.2));
    c = mix(uC2, uC1, s);
    if (fin) c = mix(uC2, uC3, smoothstep(-0.2, 0.2, sin(abs(v) * 28.0 + u * 30.0)));
  } else if (P < 9.5) {                             // 9 나폴레옹피시
    float l = smoothstep(0.55, 0.75, sin(u * 110.0 + sin(v * 18.0) * 2.0));
    c = mix(uC1, uC2, l * 0.6);
    if (u > 0.8) c = mix(c, uC2, smoothstep(0.6, 0.9, sin((u + v * 0.3) * 160.0)) * 0.7);
    if (fin) c = mix(uC3, uC4, smoothstep(1.4, 1.9, abs(v)));
  } else if (P < 10.5) {                            // 10 퓨질리어
    c = mix(uC3, uC1, smoothstep(-0.5, 0.0, v));
    c = mix(c, uC2, smoothstep(0.35, 0.5, v) * (1.0 - smoothstep(0.55, 0.65, u)));
    if (u < 0.2) c = mix(c, uC2, smoothstep(0.2, 0.12, u));
    if (fin) c = u < 0.2 ? uC2 : uC3;
  } else if (P > 11.5) {
    c = extraPattern(u, v, fin, P);
  } else {                                          // 11 블루스트라이프 스내퍼
    c = uC1;
    float st = 0.0;
    for (int k = 0; k < 4; k++) { float y0 = 0.6 - float(k) * 0.33; st = max(st, bandF(v + (u - 0.5) * 0.25, y0, 0.05, 0.02)); }
    c = mix(c, uC4, max(st * 1.2 - 0.2, 0.0)); c = mix(c, uC2, st);
    c = mix(c, uC3, smoothstep(-0.55, -0.8, v));
    if (fin) c = uC1;
  }
  // 눈
  if (!fin) {
    float ue = P > 6.5 && P < 7.5 ? 0.86 : 0.88;
    vec2 e = vec2(u - ue, (v - 0.28) * uH * 0.5);
    float r = length(e);
    float rad = P > 6.5 && P < 7.5 ? 0.012 : 0.032;
    c = mix(c, mix(uC4, vec3(0.9, 0.75, 0.3), 0.4), 1.0 - smoothstep(rad, rad + 0.004, r));
    c = mix(c, vec3(0.01), 1.0 - smoothstep(rad * 0.6, rad * 0.6 + 0.004, r));
  }
  return c;
}
`;

export function fishMaterial(colors: string[], pattern: number, body: BodyDef, swimAmp: number) {
  const cols = colors.map((h) => new THREE.Color(h));
  const uniforms = {
    uPattern: { value: pattern }, uC1: { value: cols[0] }, uC2: { value: cols[1] }, uC3: { value: cols[2] }, uC4: { value: cols[3] },
    uH: { value: body.h }, uAmp: { value: swimAmp }, uWaveK: { value: body.shark || body.cetacean ? 4.5 : 6.5 }, uAxis: { value: body.cetacean ? 1 : 0 },
    // 재질감: 은빛 무리 물고기는 금속광·무지갯빛, 상어·고래는 매끈한 가죽, 산호초 물고기는 젖은 광택
    uIrid: { value: 0 }, uRough: { value: 0.3 }, uMetal: { value: 0.1 }, uSmooth: { value: body.shark || body.cetacean ? 1 : 0 },
  };
  {
    const hsl = { h: 0, s: 0, l: 0 };
    cols[0].getHSL(hsl);
    const silver = THREE.MathUtils.clamp((1 - hsl.s * 1.6) * THREE.MathUtils.smoothstep(hsl.l, 0.25, 0.65), 0, 1);
    uniforms.uIrid.value = body.shark || body.cetacean ? 0.08 : 0.25 + silver * 0.75;
    uniforms.uMetal.value = body.shark || body.cetacean ? 0.02 : 0.08 + silver * 0.4;
    uniforms.uRough.value = body.cetacean ? 0.38 : body.shark ? 0.45 : 0.28 - silver * 0.08;
  }
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.42, metalness: 0.12 });
  patchWater(mat, {
    key: 'fish',
    extend: (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.uniforms.uTime = waterUniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aBody; attribute vec2 aPat; attribute float aFin; attribute float aPhase; attribute float aSwim;
          uniform float uAmp; uniform float uWaveK; uniform float uAxis;
          varying vec2 vPat; varying float vFin;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vPat = aPat; vFin = aFin > 0.5 ? 1.0 : 0.0;
            float tailw = pow(1.0 - aBody, 1.6) + 0.06;
            float wave = sin(aBody * uWaveK - aPhase);
            float strength = 0.25 + 0.75 * aSwim;
            float lat = wave * uAmp * strength * tailw;
            // 꼬리지느러미는 더 유연하게 휨
            if (aFin > 0.5 && aBody < 0.2) lat += sin(aBody * uWaveK * 2.0 - aPhase - 1.2) * uAmp * 0.4 * strength * (0.2 - aBody) * 5.0;
            if (uAxis > 0.5) transformed.y += lat; else transformed.x += lat;
            // 가슴지느러미 노 젓기 (멈춰 있어도 살랑)
            if (aFin > 1.5) {
              float f = sin(aPhase * 0.7 + position.x * 3.0) * (1.2 - aSwim * 0.6);
              transformed.x += sign(position.x) * f * 0.03;
              transformed.y += f * 0.01;
            }
          }`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uIrid; uniform float uRough; uniform float uMetal; uniform float uSmooth;\n' + GLSL_PATTERNS)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = vFin > 0.5 ? 0.55 : uRough;`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          metalnessFactor = vFin > 0.5 ? 0.0 : uMetal;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb = fishPattern();
          {
            // 선명한 발색 (물속에서 바래 보이지 않게 채도 보정)
            float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            diffuseColor.rgb = max(mix(vec3(lum), diffuseColor.rgb, 1.18), 0.0);
            if (vFin < 0.5) {
              // 역그늘(카운터셰이딩): 등은 짙게, 배는 밝게 — 실제 물고기의 입체감
              diffuseColor.rgb *= mix(1.12, 0.84, smoothstep(-0.65, 0.85, vPat.y));
              if (uSmooth < 0.5) {
                // 아가미 뚜껑 경계 + 옆줄
                float gx = 0.8 + 0.035 * vPat.y * vPat.y;
                float gill = 1.0 - smoothstep(0.0, 0.006, abs(vPat.x - gx));
                diffuseColor.rgb *= 1.0 - gill * 0.28 * step(abs(vPat.y), 0.85);
                float ll = 1.0 - smoothstep(0.0, 0.025, abs(vPat.y - (0.38 - 0.12 * (vPat.x - 0.5))));
                diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.18 + 0.02, ll * 0.35 * step(0.2, vPat.x) * step(vPat.x, 0.78));
              }
            }
          }
          // 비늘 결 (빛 각도에 따라 반짝)
          if (vFin < 0.5) {
            float sc = sin(vPat.x * 220.0 + vPat.y * 18.0) * sin(vPat.x * 160.0 - vPat.y * 26.0);
            diffuseColor.rgb *= 0.95 + 0.07 * sc;
          } else {
            // 지느러미 줄기(ray) + 끝으로 갈수록 반투명하게 밝아짐
            float ray = 0.5 + 0.5 * sin(vPat.x * 260.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.8, ray * 0.25);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb + 0.06, smoothstep(1.4, 2.0, abs(vPat.y)));
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            // 가장자리 산란광 (얇은 지느러미·몸통 테두리가 물빛을 받아 은은히 빛남)
            float rim = pow(clamp(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0, 1.0), 2.5);
            totalEmissiveRadiance += diffuseColor.rgb * rim * 0.18 + vec3(0.02, 0.06, 0.07) * rim * vFin;
            vec3 Vv = normalize(vViewPosition);
            vec3 Nn = normalize(vNormal);
            vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
            float depthK = exp(min(vWPos.y, 0.0) * 0.06);
            // 역광 투과: 해를 등지고 보면 얇은 지느러미가 빛을 머금어 반투명하게 빛남
            float back = pow(max(0.0, dot(-Vv, sunV)), 4.0);
            totalEmissiveRadiance += diffuseColor.rgb * back * (vFin * 0.6 + 0.06) * depthK;
            // 비늘의 무지갯빛 (보는 각도에 따라 청록·보라·금색으로 변함)
            float fres = pow(1.0 - abs(dot(Nn, Vv)), 1.4);
            vec3 film = 0.5 + 0.5 * cos(6.2832 * (fres * 1.1 + vPat.x * 0.7 + vPat.y * 0.15 + vec3(0.0, 0.33, 0.67)));
            totalEmissiveRadiance += film * fres * uIrid * (vFin > 0.5 ? 0.04 : 0.14) * (0.5 + 0.5 * depthK);
            // 젖은 몸의 햇빛 반짝임
            vec3 Hh = normalize(sunV + Vv);
            float glint = pow(max(0.0, dot(Nn, Hh)), uSmooth > 0.5 ? 40.0 : 90.0) * (1.0 - vFin);
            totalEmissiveRadiance += vec3(1.0, 0.97, 0.9) * glint * (0.25 + uIrid * 0.35) * depthK;
            // 눈: 촉촉한 각막 하이라이트 (생기 있는 눈빛)
            if (vFin < 0.5) {
              float P = uPattern;
              float ue = P > 6.5 && P < 7.5 ? 0.86 : 0.88;
              float rad = P > 6.5 && P < 7.5 ? 0.012 : 0.032;
              vec2 e = vec2(vPat.x - ue, (vPat.y - 0.28) * uH * 0.5);
              float hl = 1.0 - smoothstep(rad * 0.18, rad * 0.3, length(e - vec2(rad * 0.3, rad * 0.35)));
              float iris = (1.0 - smoothstep(rad * 0.6, rad * 0.95, length(e))) * smoothstep(rad * 0.55, rad * 0.62, length(e));
              totalEmissiveRadiance += vec3(0.95) * hl * 0.9 + diffuseColor.rgb * iris * 0.25;
            }
          }`);
    },
  });
  return mat;
}

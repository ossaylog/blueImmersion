// 다이브 사이트 지형: 전 세계 바다 생물이 모이는 하나의 열대 리프
//  - 배(원점) 주변: 수심 3~6m 리프 플랫, 산호 봄미(bommie)가 1.5m까지 솟음  → 스노클링
//  - 우현(+x) 쪽: 모래 채널과 해초밭
//  - 선미(-z) 너머: 드롭오프 경사 → 30m 이상 깊은 모래 바닥, 중간 수심 피너클 → 스쿠버
import { fbm, vnoise, smoothstep, lerp } from '../core/math';

export const WORLD_SIZE = 280; // 해저 메시 한 변 (m)

interface Mound { x: number; z: number; r: number; h: number }
const BOMMIES: Mound[] = [
  { x: 9, z: 6, r: 3.6, h: 2.6 }, { x: 15, z: -4, r: 4.5, h: 2.9 }, { x: 4, z: 18, r: 5, h: 2.4 },
  { x: -11, z: 9, r: 4.2, h: 2.8 }, { x: -6, z: -12, r: 3.4, h: 2.2 }, { x: 22, z: 14, r: 5.5, h: 3.0 },
  { x: 26, z: -16, r: 4, h: 2.2 }, { x: -20, z: -4, r: 5, h: 2.5 }, { x: -16, z: 24, r: 4, h: 2.0 },
  { x: 12, z: 30, r: 6, h: 2.8 }, { x: 34, z: 4, r: 4, h: 2.3 }, { x: -30, z: 16, r: 5, h: 2.6 },
  { x: 2, z: -2, r: 2.6, h: 1.0 },
  // 경사면 피너클 (스쿠버 중간 수심)
  { x: -8, z: -58, r: 9, h: 12 }, { x: 18, z: -70, r: 7, h: 9 }, { x: -30, z: -48, r: 6, h: 6 },
];

export function dropFactor(x: number, z: number) {
  const warp = fbm(x * 0.011 + 5, z * 0.011) * 16;
  return smoothstep(-24, -82, z + warp);
}

function channel(x: number, z: number) {
  const c = 1 - Math.abs(vnoise(x * 0.021 + 3.1, z * 0.024 - 7.3));
  return smoothstep(0.8, 0.96, c);
}

export function heightAt(x: number, z: number): number {
  const s = dropFactor(x, z);
  let reef = -5.3 + fbm(x * 0.035, z * 0.035) * 1.5 + fbm(x * 0.13, z * 0.13, 3) * 0.35;
  reef -= channel(x, z) * 1.9 * (1 - s);
  let mound = 0;
  for (const b of BOMMIES) {
    const dx = x - b.x, dz = z - b.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > b.r * b.r * 9) continue;
    const n = 0.75 + 0.35 * vnoise(x * 0.4 + b.x, z * 0.4 + b.z);
    mound += b.h * Math.exp(-d2 / (2 * b.r * b.r)) * n;
  }
  const deep = -33 + fbm(x * 0.02 + 9, z * 0.02) * 2.5;
  let h = lerp(reef, deep, s);
  // 경사면 단차(테라스)와 암반 요철
  h += s * (1 - s) * 4 * (fbm(x * 0.07, z * 0.07) * 3.2);
  h += mound;
  // 배 바로 아래는 최소 수심 확보
  return Math.min(h, -1.4);
}

export function normalAt(x: number, z: number): [number, number, number] {
  const e = 0.5;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}

/** 산호 밀도 0~1 (서식지 판정과 산호 배치에 공통 사용) */
export function coralDensity(x: number, z: number): number {
  const s = dropFactor(x, z);
  const h = heightAt(x, z);
  let mound = 0;
  for (const b of BOMMIES) {
    const d = Math.hypot(x - b.x, z - b.z);
    mound = Math.max(mound, 1 - smoothstep(b.r * 0.6, b.r * 1.7, d));
  }
  const patch = smoothstep(-0.25, 0.45, fbm(x * 0.05 + 11, z * 0.05 - 4));
  let d = (0.42 + 0.58 * patch) * (1 - channel(x, z) * 0.9);
  d = Math.max(d, mound);
  if (s > 0.85) d *= 0.35;          // 깊은 모래 바닥: 부채산호·해면 위주로 드문드문
  if (-h < 1.6) d *= 0.6;           // 너무 얕은 곳
  if (Math.hypot(x, z) < 3.2) d *= 0.2; // 배 앵커 지점
  return Math.min(1, d);
}

export function seagrass(x: number, z: number): number {
  if (dropFactor(x, z) > 0.2) return 0;
  const region = smoothstep(20, 32, x) * (1 - smoothstep(55, 70, x));
  const n = smoothstep(0.0, 0.35, fbm(x * 0.06 - 20, z * 0.06 + 3));
  return region * n * (1 - coralDensity(x, z));
}

export type Habitat = 'reef' | 'sand' | 'seagrass' | 'open' | 'wall';

/** 주어진 위치의 서식지 적합도 */
export function habitatAt(x: number, y: number, z: number): Record<Habitat, number> {
  const floor = heightAt(x, z);
  const above = y - floor;
  const s = dropFactor(x, z);
  const c = coralDensity(x, z);
  const g = seagrass(x, z);
  const open = smoothstep(5, 14, above);
  return {
    reef: c * (1 - open),
    sand: (1 - c) * (1 - g) * (1 - open),
    seagrass: g * (1 - open),
    wall: s * (1 - s) * 4 * (1 - open),
    open: Math.max(open, 0.25),
  };
}

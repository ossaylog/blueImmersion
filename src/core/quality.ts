// 기기에 따른 품질 티어 자동 결정
export interface Quality {
  tier: 'low' | 'mid' | 'high';
  isTouch: boolean;
  pixelRatio: number;
  msaa: number;
  particles: number;
  shafts: number;
  coralDensity: number;
  /** 이 거리(m) 안의 산호만 원본 폴리곤 (밖은 같은 모양의 저폴리곤) */
  coralNear: number;
  /** 이 거리(m) 밖 산호는 그리지 않음 (물빛에 거의 묻히는 거리) */
  coralFar: number;
  fishScale: number;       // 군집 크기 배율
  terrainSegments: number;
  surfaceSegments: number;
}

export function detectQuality(): Quality {
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const small = Math.min(innerWidth, innerHeight) < 600;
  const forced = new URLSearchParams(location.search).get('q') as Quality['tier'] | null;
  const dpr = devicePixelRatio || 1;
  // 모바일도 최근 기기(메모리 4GB+ 또는 6코어+, iOS)는 'mid': 산호는 거의 PC 수준으로, 대신 해상도·입자를 줄임
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory ?? 4, cores = navigator.hardwareConcurrency || 4;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mobile = isTouch || small;
  let tier: Quality['tier'] = forced === 'low' || forced === 'mid' || forced === 'high' ? forced
    : !mobile ? 'high' : ios || (mem >= 4 && cores >= 6) ? 'mid' : 'low';
  // 이 탭에서 그래픽(WebGL)이 한 번 끊겼다면 한 단계 낮춰서 다시 시작 (같은 문제 반복 방지)
  if (!forced && lostBefore()) tier = tier === 'high' ? 'mid' : 'low';
  if (tier === 'high') return { tier, isTouch, pixelRatio: Math.min(dpr, 1.75), msaa: 4, particles: 3600, shafts: 40, coralDensity: 1, coralNear: 24, coralFar: Infinity, fishScale: 1, terrainSegments: 230, surfaceSegments: 220 };
  if (tier === 'mid') return { tier, isTouch, pixelRatio: Math.min(dpr, 1.35), msaa: 0, particles: 1600, shafts: 26, coralDensity: 1, coralNear: 14, coralFar: Infinity, fishScale: 0.75, terrainSegments: 170, surfaceSegments: 150 };
  return { tier, isTouch, pixelRatio: Math.min(dpr, 1.2), msaa: 0, particles: 1100, shafts: 18, coralDensity: 0.9, coralNear: 11, coralFar: 36, fishScale: 0.6, terrainSegments: 140, surfaceSegments: 120 };
}

const LOST_KEY = 'bi_gfx_lost';
function lostBefore() { try { return sessionStorage.getItem(LOST_KEY) === '1'; } catch { return false; } }
/** 그래픽이 끊긴 사실을 기록 → 새로고침 시 화질을 한 단계 낮춤 */
export function markGraphicsLost() { try { sessionStorage.setItem(LOST_KEY, '1'); } catch { /* 저장 불가 */ } }
export function wasGraphicsLost() { return lostBefore(); }

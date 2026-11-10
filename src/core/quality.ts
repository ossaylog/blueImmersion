// 기기에 따른 품질 티어 자동 결정
export interface Quality {
  tier: 'low' | 'high';
  isTouch: boolean;
  pixelRatio: number;
  msaa: number;
  particles: number;
  shafts: number;
  coralDensity: number;
  fishScale: number;       // 군집 크기 배율
  terrainSegments: number;
  surfaceSegments: number;
}

export function detectQuality(): Quality {
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const small = Math.min(innerWidth, innerHeight) < 600;
  const forced = new URLSearchParams(location.search).get('q');
  const low = forced ? forced === 'low' : isTouch || small;
  const dpr = devicePixelRatio || 1;
  return low
    ? { tier: 'low', isTouch, pixelRatio: Math.min(dpr, 1.5), msaa: 0, particles: 1400, shafts: 22, coralDensity: 0.45, fishScale: 0.6, terrainSegments: 150, surfaceSegments: 140 }
    : { tier: 'high', isTouch, pixelRatio: Math.min(dpr, 1.75), msaa: 4, particles: 3600, shafts: 40, coralDensity: 1, fishScale: 1, terrainSegments: 230, surfaceSegments: 220 };
}

// 나만의 바다 생물 컬렉션: 처음 만난 날 · 만난 횟수 · 가장 깊이 만난 수심 (브라우저에 저장)
import { CODEX, tierOf, type Tier } from '../data/codex';
import type { SpeciesDef } from './types';

const KEY = 'bi-collection-v1';
const PHOTO_KEY = 'bi-collection-photos-v1';

export interface Found { first: number; count: number; depth: number }

export class Collection {
  found: Record<string, Found> = {};
  /** 처음 만났을 때 내 시야로 찍힌 사진 (JPEG data URL) */
  photos: Record<string, string> = {};
  /** 도감에 실릴 모든 종 (등급 → 이름 순) */
  all: SpeciesDef[];

  constructor(species: SpeciesDef[]) {
    const seen = new Set<string>();
    this.all = species.filter((s) => CODEX[s.id] && !seen.has(s.id) && seen.add(s.id))
      .sort((a, b) => tierOf(b.id) - tierOf(a.id) || a.nameKo.localeCompare(b.nameKo, 'ko'));
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const data = JSON.parse(raw) as Record<string, Found>;
        for (const id in data) if (CODEX[id] && data[id] && typeof data[id].first === 'number') this.found[id] = data[id];
      }
    } catch { /* 저장소를 쓸 수 없는 환경 (사생활 보호 모드 등): 이번 세션에서만 기록 */ }
    try {
      const raw = localStorage.getItem(PHOTO_KEY);
      if (raw) { const data = JSON.parse(raw) as Record<string, string>; for (const id in data) if (CODEX[id] && typeof data[id] === 'string' && data[id].startsWith('data:image/')) this.photos[id] = data[id]; }
    } catch { /* 무시 */ }
  }

  setPhoto(id: string, url: string) {
    this.photos[id] = url;
    try { localStorage.setItem(PHOTO_KEY, JSON.stringify(this.photos)); }
    catch { /* 저장 공간 부족: 이번 세션에서만 보임 */ }
  }

  has(id: string) { return !!this.found[id]; }
  get total() { return this.all.length; }
  get count() { return this.all.filter((s) => this.found[s.id]).length; }
  countTier(t: Tier) { const l = this.all.filter((s) => tierOf(s.id) === t); return [l.filter((s) => this.found[s.id]).length, l.length] as const; }

  /** 만남 기록. 처음 만난 종이면 true */
  record(sp: SpeciesDef, depth: number): boolean {
    if (!CODEX[sp.id]) return false;
    const f = this.found[sp.id];
    const isNew = !f;
    if (f) { f.count++; f.depth = Math.max(f.depth, depth); }
    else this.found[sp.id] = { first: Date.now(), count: 1, depth };
    try { localStorage.setItem(KEY, JSON.stringify(this.found)); } catch { /* 저장 실패는 무시 */ }
    return isNew;
  }
}

// 공유 생태계 스케줄: '언제, 어디에, 어떤 생물이' 나타나 '어떤 길로' 움직이는지를
//  공유 시계(worldNow)와 시드 난수만으로 계산 → 같은 바다에 있는 모든 사람에게 같은 생물이 같은 시각·위치에 보임.
//  - 서버나 호스트가 생물을 정해 보내지 않음 (끊김·지연·백그라운드 탭에 영향 없음, 늦게 들어와도 같은 장면)
//  - 무리 단위의 위치·경로(Plan)는 결정적, 무리 속 개체의 미세한 움직임과 '나'에 대한 반응(피하기·호기심)은 각자 화면에서 계산
//  - 크기 등급별 '슬롯 스트림': 슬롯마다 한 무리가 정해진 시각에 태어나 정해진 시간 동안 머문 뒤 바깥으로 떠남
//  - 희귀(2)·전설(3) 등급: 정해진 시간 창마다 확률적으로, 판툰 주변 핫스팟을 가로지르는 길로 등장 (모두가 함께 목격)
import * as THREE from 'three';
import { mulberry32, clamp, type RNG } from '../core/math';
import { heightAt, habitatAt, type Habitat } from '../world/terrain';
import { tierOf } from '../data/codex';
import type { SpeciesDef, SizeClass } from './types';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const WORLD_SEED = 0x5ea_2026;
const AREA_R = 82;            // 생물이 태어나는 반경 (체험 경계 95m 안쪽)
const EXIT_T = 32;            // 머문 뒤 바깥으로 떠나는 시간

/** 정수 해시 (32bit) */
export function hashInts(...n: number[]) {
  let h = 0x811c9dc5 ^ WORLD_SEED;
  for (const v of n) {
    let k = Math.floor(v) | 0;
    k = Math.imul(k ^ (k >>> 16), 0x7feb352d); k = Math.imul(k ^ (k >>> 15), 0x846ca68b); k ^= k >>> 16;
    h = Math.imul(h ^ k, 0x01000193); h ^= h >>> 13;
  }
  return h >>> 0;
}
export const seeded = (...n: number[]): RNG => mulberry32(hashInts(...n));
export const h01 = (...n: number[]) => hashInts(...n) / 4294967296;
const rr = (r: RNG, a: number, b: number) => a + (b - a) * r();

// ───────── 경로: 시각별 키 위치를 에르미트 곡선으로 부드럽게 ─────────
export interface Key { t: number; p: THREE.Vector3; still?: boolean; tag?: string }
const _b = V3(), _m0 = V3(), _m1 = V3();
export class Path {
  constructor(public keys: Key[]) {}
  private seg(t: number) {
    const k = this.keys;
    if (t <= k[0].t) return 0;
    if (t >= k[k.length - 1].t) return k.length - 2;
    let lo = 0, hi = k.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (k[mid].t <= t) lo = mid; else hi = mid; }
    return lo;
  }
  private tan(i: number, out: THREE.Vector3) {
    const k = this.keys;
    if (k[i].still) return out.set(0, 0, 0);
    const a = k[Math.max(0, i - 1)], b = k[Math.min(k.length - 1, i + 1)];
    return out.subVectors(b.p, a.p).divideScalar(Math.max(b.t - a.t, 1e-3));
  }
  at(t: number, out = V3()) {
    const k = this.keys;
    if (k.length === 1) return out.copy(k[0].p);
    const i = this.seg(t), A = k[i], B = k[i + 1];
    const h = Math.max(B.t - A.t, 1e-3), u = clamp((t - A.t) / h, 0, 1);
    this.tan(i, _m0).multiplyScalar(h); this.tan(i + 1, _m1).multiplyScalar(h);
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01_ = -2 * u3 + 3 * u2, h11 = u3 - u2;
    return out.set(
      A.p.x * h00 + _m0.x * h10 + B.p.x * h01_ + _m1.x * h11,
      A.p.y * h00 + _m0.y * h10 + B.p.y * h01_ + _m1.y * h11,
      A.p.z * h00 + _m0.z * h10 + B.p.z * h01_ + _m1.z * h11);
  }
  vel(t: number, out = V3()) {
    const e = 0.15;
    this.at(t + e, _b); this.at(t - e, out);
    return out.subVectors(_b, out).divideScalar(2 * e);
  }
  /** 지금 머무는 구간의 표시 (먹이 먹기·숨쉬기·쉬기) */
  tagAt(t: number) { const k = this.keys; const i = this.seg(t); return k[i].still && k[i + 1]?.still ? k[i].tag : undefined; }
}

/**
 * 맞춤 출현 이벤트: 한 사람이 '지루해질 만한 순간'(판툰에서 멀어짐·접속 5분 등)에 부른 희귀·전설 생물
 *  이 값만 주고받으면 모든 사람이 같은 경로를 계산 → 근처의 다른 사람에게도 같은 생물이 같은 곳에 보임
 */
export interface EcoEvent {
  k: string;            // 고유 키
  sp: string;           // 종 id
  tier: 2 | 3;
  T: number;            // 출발 시각 (공유 시계)
  x: number; y: number; z: number;   // 다이버 옆을 지나는 지점
  ax: number; az: number;            // 다가오는 방향 (단위 벡터, 출발점 → 지나는 지점)
}

export interface Plan {
  key: string;
  sp: SpeciesDef;
  seed: number;
  born: number; end: number; gone: number;
  n: number;
  path: Path;
  tier: number;
}

// ───────── 경로 생성기 ─────────
/** 수심 범위 안의 높이 (바닥·수면에서 떨어지게) */
function yRange(sp: SpeciesDef, x: number, z: number, above = 0.6): [number, number] {
  const floor = heightAt(x, z);
  const lo = Math.max(floor + above, -sp.depth[1]);
  const hi = Math.min(-sp.depth[0], -0.5);
  return [lo, Math.max(lo, hi)];
}
/** 판툰 부력체·플랫폼 속으로 들어가지 않게 */
function clearOfPontoon(p: THREE.Vector3) {
  if (Math.abs(p.x) < 11 && Math.abs(p.z) < 20.5 && p.y > -3.6) p.y = Math.min(p.y, -3.6);
  const fl = heightAt(p.x, p.z) + 0.5;
  if (p.y < fl) p.y = fl;
}
function exitLeg(keys: Key[], end: number, gone: number, speed: number) {
  const last = keys[keys.length - 1].p;
  const dir = V3(last.x, 0, last.z);
  if (dir.lengthSq() < 1) dir.set(1, 0, 0);
  dir.normalize();
  const d = Math.min(40, Math.max(18, speed * (gone - end)));
  const p = last.clone().addScaledVector(dir, d);
  p.y = clamp(last.y, heightAt(p.x, p.z) + 1.5, -1);
  keys.push({ t: gone, p });
  void end;
}

/** 근처를 천천히 돌아다니는 무리 (리프 물고기·무리 고기·해파리) */
function roamPath(r: RNG, sp: SpeciesDef, p0: THREE.Vector3, born: number, end: number, gone: number, radius: number, seg: number, above: number): Path {
  const keys: Key[] = [{ t: born, p: p0.clone() }];
  const home = p0.clone();
  const vmax = Math.max(0.05, sp.speed[1] * 0.55);
  let prev = p0.clone();
  for (let t = born + seg; t < end; t += seg) {
    const a = r() * Math.PI * 2, d = radius * Math.sqrt(r());
    const q = V3(home.x + Math.sin(a) * d, 0, home.z + Math.cos(a) * d);
    // 한 구간에 갈 수 있는 거리 제한
    const step = q.clone().sub(prev).setY(0);
    const lim = vmax * seg;
    if (step.length() > lim) q.copy(prev).add(step.setLength(lim));
    const [lo, hi] = yRange(sp, q.x, q.z, above);
    q.y = clamp(prev.y + rr(r, -1.2, 1.2), lo, hi);
    clearOfPontoon(q);
    keys.push({ t, p: q });
    prev = q;
  }
  keys.push({ t: end, p: prev.clone() });
  exitLeg(keys, end, gone, Math.max(sp.speed[1], 0.3));
  return new Path(keys);
}

/** 멀리 순찰하듯 지나가는 대형종 (상어·거북 등) · 거북은 바닥에서 먹이·수면에서 숨쉬기 */
function transitPath(r: RNG, sp: SpeciesDef, p0: THREE.Vector3, born: number, end: number, gone: number, turtle: boolean): Path {
  const keys: Key[] = [{ t: born, p: p0.clone() }];
  const v = (sp.speed[0] + sp.speed[1]) * 0.5;
  let h = r() * Math.PI * 2;
  let p = p0.clone();
  let t = born;
  let k = 0;
  while (t < end) {
    // 바깥으로 너무 나가면 판툰 쪽으로 방향을 틈
    const outward = Math.hypot(p.x, p.z) > 62;
    const toC = Math.atan2(-p.x, -p.z);
    h += outward ? clamp(Math.atan2(Math.sin(toC - h), Math.cos(toC - h)), -0.9, 0.9) : rr(r, -0.7, 0.7);
    if (turtle && k > 0 && k % 2 === 0) {
      // 거북: 바닥으로 내려가 해면·해초를 뜯거나, 수면으로 올라가 숨을 쉼
      const breathe = -p.y < 14 && r() < 0.45;
      const q = p.clone(); q.y = breathe ? -0.35 : heightAt(q.x, q.z) + 0.35;
      const tagT = breathe ? 4 : rr(r, 9, 14);
      const go = Math.max(4, Math.abs(q.y - p.y) / 0.25);
      t += go; keys.push({ t, p: q.clone(), still: true, tag: breathe ? 'breathe' : 'feed' });
      t += tagT; keys.push({ t, p: q.clone(), still: true, tag: breathe ? 'breathe' : 'feed' });
      p = q; k++;
      continue;
    }
    const seg = rr(r, 10, 16);
    const q = p.clone().add(V3(Math.sin(h), 0, Math.cos(h)).multiplyScalar(v * seg));
    const [lo, hi] = yRange(sp, q.x, q.z, turtle ? 1.0 : 1.2);
    q.y = clamp(p.y + rr(r, -2, 2), lo, hi);
    clearOfPontoon(q);
    t += seg; keys.push({ t, p: q }); p = q; k++;
  }
  exitLeg(keys, end, gone, v * 1.2);
  return new Path(keys);
}

/** 원을 그리며 선회 (만타·독수리가오리) */
function orbitPath(r: RNG, sp: SpeciesDef, c: THREE.Vector3, born: number, end: number, gone: number): Path {
  const keys: Key[] = [];
  const R = sp.behavior === 'eagle' ? rr(r, 8, 11) : rr(r, 8, 12);
  const dir = r() < 0.5 ? 1 : -1;
  const w = dir * sp.speed[0] / R;
  const a0 = r() * Math.PI * 2;
  const [lo, hi] = yRange(sp, c.x, c.z, 2.5);
  for (let t = born; t <= end + 0.01; t += 2) {
    const a = a0 + w * (t - born);
    const q = V3(c.x + Math.sin(a) * R, 0, c.z + Math.cos(a) * R);
    const [l2, h2] = yRange(sp, q.x, q.z, 2.5);
    q.y = clamp(c.y + 2.6 * Math.cos(t * 0.07 + a), Math.max(lo, l2), Math.min(hi, h2) + 0.01);
    clearOfPontoon(q);
    keys.push({ t, p: q });
  }
  exitLeg(keys, end, gone, sp.speed[1]);
  return new Path(keys);
}

/** 모래 위에서 쉬다가 가끔 자리를 옮김 (가오리) */
function restPath(r: RNG, p0: THREE.Vector3, born: number, end: number, gone: number): Path {
  const keys: Key[] = [];
  let p = p0.clone(); p.y = heightAt(p.x, p.z) + 0.03;
  let t = born;
  while (t < end) {
    keys.push({ t, p: p.clone(), still: true, tag: 'rest' });
    t += rr(r, 18, 40);
    keys.push({ t, p: p.clone(), still: true, tag: 'rest' });
    const a = r() * Math.PI * 2, d = rr(r, 3, 7);
    const q = V3(p.x + Math.sin(a) * d, 0, p.z + Math.cos(a) * d); q.y = heightAt(q.x, q.z) + 0.03;
    t += d / 0.35;
    p = q;
  }
  keys.push({ t: end, p: p.clone(), still: true, tag: 'rest' });
  exitLeg(keys, end, gone, 0.6);
  return new Path(keys);
}

/** 해류를 따라 떠다님 (해파리) */
function driftPath(r: RNG, p0: THREE.Vector3, born: number, end: number, gone: number): Path {
  const keys: Key[] = [];
  const cur = V3(rr(r, -0.05, 0.08), 0, rr(r, -0.05, 0.05));
  for (let t = born; t <= gone + 0.01; t += 10) {
    const q = p0.clone().addScaledVector(cur, t - born);
    q.y = clamp(p0.y + Math.sin((t - born) * 0.03) * 1.2, heightAt(q.x, q.z) + 2, -1.2);
    keys.push({ t, p: q });
  }
  return new Path(keys);
}

function makePath(r: RNG, sp: SpeciesDef, p0: THREE.Vector3, born: number, end: number, gone: number): Path {
  switch (sp.behavior) {
    case 'school': return roamPath(r, sp, p0, born, end, gone, 12, 9, 1.2);
    case 'mill': return roamPath(r, sp, p0, born, end, gone, 4, 18, 2.5);
    case 'hoverSchool': return roamPath(r, sp, p0, born, end, gone, 0.8, 20, 0.6);
    case 'hover': return roamPath(r, sp, p0, born, end, gone, 0.6, 15, 0.5);
    case 'wander': case 'graze': return roamPath(r, sp, p0, born, end, gone, sp.sizeClass === 'large' ? 9 : 5, 14, 0.5);
    case 'cruise': return transitPath(r, sp, p0, born, end, gone, false);
    case 'turtle': return transitPath(r, sp, p0, born, end, gone, true);
    case 'manta': case 'eagle': return orbitPath(r, sp, p0, born, end, gone);
    case 'stingray': return restPath(r, p0, born, end, gone);
    case 'jelly': return driftPath(r, p0, born, end, gone);
    default: return new Path([{ t: born, p: p0.clone() }, { t: gone, p: p0.clone() }]);
  }
}

// ───────── 출현 스케줄 ─────────
interface Stream { id: number; cls: Exclude<SizeClass, 'resident'>; count: number; slot: number; maxLife: number; pool: SpeciesDef[] }
const RARE = {
  2: { win: 160, p: 0.8 },   // 희귀: 약 2.7분 창마다 80%
  3: { win: 400, p: 0.65 },  // 전설: 약 6.7분 창마다 65%
} as const;

export class Ecology {
  private streams: Stream[] = [];
  private rarePool: Record<2 | 3, SpeciesDef[]> = { 2: [], 3: [] };
  private cache = new Map<string, Plan | null>();
  private list: Plan[] = [];
  private events: Plan[] = [];
  private byId = new Map<string, SpeciesDef>();

  constructor(species: SpeciesDef[], lowTier: boolean) {
    // 동시에 바다 전체(반경 82m)에 있는 무리 수 — 저사양은 조금 적게 (같은 서버의 모든 기기가 같은 값을 써야 하므로 등급과 무관하게 고정)
    void lowTier;
    // 흔함·보통 등급을 쉽게 만날 수 있도록 작은·중간 무리를 넉넉히 (예전 22·44)
    const targets: Record<Exclude<SizeClass, 'resident'>, number> = { small: 30, medium: 56, large: 10, mega: 2.4 };
    let id = 1;
    for (const cls of ['small', 'medium', 'large', 'mega'] as const) {
      const pool = species.filter((s) => s.sizeClass === cls && s.weight > 0 && tierOf(s.id) < 2);
      if (!pool.length) continue;
      const avg = pool.reduce((a, s) => a + (s.stay[0] + s.stay[1]) / 2, 0) / pool.length;
      const maxLife = Math.max(...pool.map((s) => s.stay[1]));
      this.streams.push({ id: id++, cls, count: targets[cls], slot: avg / targets[cls], maxLife, pool });
    }
    for (const s of species) this.byId.set(s.id, s);
    for (const s of species) { const t = tierOf(s.id); if ((t === 2 || t === 3) && s.weight > 0 && s.sizeClass !== 'resident') this.rarePool[t].push(s); }
  }

  /** 시각 T에 바다에 있는 모든 무리 계획 (태어남 ≤ T ≤ 떠남) */
  alive(T: number): Plan[] {
    this.list.length = 0;
    for (const st of this.streams) {
      const k0 = Math.floor((T - st.maxLife - EXIT_T) / st.slot), k1 = Math.floor(T / st.slot);
      for (let k = k0; k <= k1; k++) {
        const key = `${st.id}:${k}`;
        let p = this.cache.get(key);
        if (p === undefined) { p = this.planSlot(st, k); this.cache.set(key, p); }
        if (p && p.born <= T && T <= p.gone) this.list.push(p);
      }
    }
    for (const tier of [2, 3] as const) {
      const W = RARE[tier].win;
      const w1 = Math.floor(T / W);
      for (let w = w1 - 2; w <= w1; w++) {
        const key = `r${tier}:${w}`;
        let p = this.cache.get(key);
        if (p === undefined) { p = this.planRare(tier, w); this.cache.set(key, p); }
        if (p && p.born <= T && T <= p.gone) this.list.push(p);
      }
    }
    // 맞춤 출현 이벤트
    for (const p of this.events) if (p.born <= T && T <= p.gone) this.list.push(p);
    if (this.events.length && this.events[0].gone < T - 30) this.events = this.events.filter((p) => p.gone >= T - 30);
    // 오래된 계획 정리
    if (this.cache.size > 900) for (const [k, p] of this.cache) if (!p || p.gone < T - 30) this.cache.delete(k);
    return this.list;
  }

  /** 희귀·전설 후보 (등급별) */
  rareSpecies(tier: 2 | 3) { return this.rarePool[tier]; }

  /** 이 종이 이 지점(x,z) 근처에서 살 수 있는 수심 범위 (없으면 null) */
  depthRange(sp: SpeciesDef, x: number, z: number): [number, number] | null {
    const [lo, hi] = yRange(sp, x, z, 1.2);
    return lo > hi + 1e-3 ? null : [lo, hi];
  }

  /** 지금 pos 근처(R m)에 있는 희귀·전설 무리 수 */
  rareNear(T: number, pos: THREE.Vector3, R: number) {
    let n = 0;
    for (const p of this.alive(T)) {
      if (p.tier < 2 || T > p.end) continue;
      const q = p.path.at(T, _b);
      if (Math.hypot(q.x - pos.x, q.z - pos.z) < R) n++;
    }
    return n;
  }

  /** 맞춤 출현 이벤트를 계획으로 (같은 값 → 모든 사람에게 같은 경로) */
  addEvent(e: EcoEvent): Plan | null {
    if (this.events.some((p) => p.key === e.k)) return null;
    const sp = this.byId.get(e.sp);
    if (!sp || (e.tier !== 2 && e.tier !== 3)) return null;
    const vals = [e.T, e.x, e.y, e.z, e.ax, e.az];
    if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v)) || Math.hypot(e.x, e.z) > 120) return null;
    const r = seeded(7777, Math.round(e.T * 10), Math.round(e.x * 100), Math.round(e.z * 100));
    const seed = hashInts(e.T * 1000, e.x * 100, e.z * 100, e.k.length);
    const pr = mulberry32(seed);
    const n = Math.max(1, Math.round(rr(pr, sp.group[0], sp.group[1])));
    const hot = V3(e.x, e.y, e.z);
    const dir = V3(e.ax, 0, e.az);
    if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
    dir.normalize();
    const { path, end, gone } = eventPath(r, sp, hot, dir, e.T);
    const plan: Plan = { key: e.k, sp, seed, born: e.T, end, gone, n, path, tier: e.tier };
    this.events.push(plan);
    this.events.sort((a, b) => a.gone - b.gone);
    return plan;
  }

  /** 슬롯 하나: 후보 위치 몇 곳 × 종별 (기본 가중치 × 서식지 적합도) 중 하나 */
  private planSlot(st: Stream, k: number): Plan | null {
    const r = seeded(st.id, k);
    const born = k * st.slot + r() * st.slot * 0.5;
    const cands: { sp: SpeciesDef; p: THREE.Vector3; w: number }[] = [];
    for (let c = 0; c < 6; c++) {
      // 다이버가 주로 머무는 리프 중심 쪽에 조금 더 모이게 (예전 지수 0.7)
      const a = r() * Math.PI * 2, d = AREA_R * Math.pow(r(), 0.95);
      const x = Math.sin(a) * d, z = Math.cos(a) * d;
      const yu = r();
      for (const sp of st.pool) {
        const [lo, hi] = yRange(sp, x, z);
        if (lo > hi + 1e-3) continue;
        const y = hi - (hi - lo) * Math.pow(yu, 1.4);   // 얕은 쪽을 조금 더
        const hab = habitatAt(x, y, z);
        let h = 0;
        for (const key in sp.habitats) h = Math.max(h, sp.habitats[key as Habitat] * hab[key as Habitat]);
        if (h < 0.08) continue;
        cands.push({ sp, p: V3(x, y, z), w: sp.weight * h * (tierOf(sp.id) === 1 ? 0.9 : 1) });
      }
    }
    if (!cands.length) return null;
    let sum = 0; for (const c of cands) sum += c.w;
    let x = r() * sum, pick = cands[0];
    for (const c of cands) { x -= c.w; if (x <= 0) { pick = c; break; } }
    return this.build(`${st.id}:${k}`, pick.sp, pick.p, born, r, 0);
  }

  /** 희귀·전설: 시간 창마다 확률로, 판툰 주변(15~40m)을 가로지르는 길 */
  private planRare(tier: 2 | 3, w: number): Plan | null {
    const pool = this.rarePool[tier];
    if (!pool.length) return null;
    const r = seeded(900 + tier, w);
    if (r() > RARE[tier].p) return null;
    // 직전 창과 같은 종은 피함
    const prev = seeded(900 + tier, w - 1); prev();
    const prevSp = pool[Math.floor(prev() * pool.length)];
    let sp = pool[Math.floor(r() * pool.length)];
    if (sp === prevSp && pool.length > 1) sp = pool[(pool.indexOf(sp) + 1 + Math.floor(r() * (pool.length - 1))) % pool.length];
    const born = w * RARE[tier].win + r() * RARE[tier].win * 0.4;
    for (let tries = 0; tries < 8; tries++) {
      const a = r() * Math.PI * 2, d = rr(r, 12, 40);
      const x = Math.sin(a) * d, z = Math.cos(a) * d;
      const [lo, hi] = yRange(sp, x, z, 1.5);
      if (lo > hi + 1e-3) continue;
      const p = V3(x, hi - (hi - lo) * r() * 0.7, z);
      clearOfPontoon(p);
      return this.build(`r${tier}:${w}`, sp, p, born, r, tier);
    }
    return null;
  }

  private build(key: string, sp: SpeciesDef, p0: THREE.Vector3, born: number, r: RNG, tier: number): Plan {
    const life = rr(r, sp.stay[0], sp.stay[1]) * (tier >= 2 ? 1.2 : 1);
    const end = born + life, gone = end + EXIT_T;
    const seed = hashInts(born * 1000, p0.x * 100, p0.z * 100, key.length);
    const pr = mulberry32(seed);
    const n = Math.max(1, Math.round(rr(pr, sp.group[0], sp.group[1])));
    // 대형 순찰종: 판툰 쪽 핫스팟을 지나도록 출발점을 바깥에 둠
    let start = p0;
    if (tier >= 2 && (sp.behavior === 'cruise' || sp.behavior === 'turtle')) {
      const dir = V3(rr(pr, -1, 1), 0, rr(pr, -1, 1)).normalize();
      start = p0.clone().addScaledVector(dir, -Math.min(45, sp.speed[1] * life * 0.35));
      const [lo, hi] = yRange(sp, start.x, start.z, 1.5); start.y = clamp(start.y, lo, hi);
    }
    const path = tier >= 2 && sp.behavior === 'cruise' ? passPath(pr, sp, start, p0, born, end, gone) : makePath(pr, sp, start, born, end, gone);
    return { key, sp, seed, born, end, gone, n, path, tier };
  }
}

/** 희귀 대형종: 멀리서 핫스팟을 지나 반대편으로 */
function passPath(r: RNG, sp: SpeciesDef, a: THREE.Vector3, hot: THREE.Vector3, born: number, end: number, gone: number): Path {
  const keys: Key[] = [];
  const dir = hot.clone().sub(a).setY(0);
  const total = dir.length() * 2;
  dir.normalize();
  const side = V3(dir.z, 0, -dir.x);
  const n = Math.max(4, Math.round((end - born) / 10));
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const q = a.clone().addScaledVector(dir, total * u).addScaledVector(side, Math.sin(u * Math.PI * 2 + r() * 0.5) * 4);
    const [lo, hi] = yRange(sp, q.x, q.z, 1.2);
    q.y = clamp(hot.y + Math.sin(u * 5) * 1.5, lo, hi);
    clearOfPontoon(q);
    keys.push({ t: born + (end - born) * u, p: q });
  }
  exitLeg(keys, end, gone, sp.speed[1]);
  return new Path(keys);
}

/**
 * 맞춤 출현 경로: 멀리(약 32m)서 그림자로 다가와 다이버 옆 지점(hot)을 지나감
 *  - 순항형(상어·고래·돌고래): 그대로 옆을 스쳐 반대편으로
 *  - 선회형(만타·독수리가오리·정어리 떼): 다이버 앞에서 한동안 원을 그리며 머묾
 *  - 머무는 형(거북·나폴레옹·혹등머리): 가까이 와서 천천히 맴돌며 먹이를 찾다가 떠남
 */
function eventPath(r: RNG, sp: SpeciesDef, hot: THREE.Vector3, dir: THREE.Vector3, born: number) {
  const keys: Key[] = [];
  const v = clamp((sp.speed[0] + sp.speed[1]) * 0.5, 0.45, 2.2);
  const side = V3(dir.z, 0, -dir.x);
  const D = 32;
  const fix = (q: THREE.Vector3, y: number) => {
    const [lo, hi] = yRange(sp, q.x, q.z, 1.2);
    q.y = clamp(y, lo, Math.max(lo, hi));
    clearOfPontoon(q);
    return q;
  };
  // 1) 다가오기
  const tA = D / v;
  const nA = Math.max(4, Math.round(tA / 6));
  for (let i = 0; i <= nA; i++) {
    const u = i / nA;
    const q = hot.clone().addScaledVector(dir, -D * (1 - u)).addScaledVector(side, Math.sin(u * Math.PI) * rr(r, -2.5, 2.5));
    keys.push({ t: born + tA * u, p: fix(q, hot.y + (1 - u) * rr(r, -1.5, 1.5)) });
  }
  let t = born + tA;
  const kind = sp.behavior === 'manta' || sp.behavior === 'eagle' || sp.id === 'sardine' ? 'circle'
    : sp.behavior === 'turtle' || sp.behavior === 'graze' || sp.behavior === 'wander' ? 'linger' : 'pass';
  if (kind === 'circle') {
    // 다이버 앞에서 선회 (반지름 6~8m, 정어리 떼는 작은 소용돌이)
    const R = sp.id === 'sardine' ? 4 : rr(r, 6, 8);
    const c = hot.clone().addScaledVector(side, R);
    const w = Math.max(0.12, v / R) * (r() < 0.5 ? 1 : -1);
    const a0 = Math.atan2(hot.x - c.x, hot.z - c.z);
    const dur = rr(r, 35, 50);
    for (let s = 2; s <= dur; s += 2) {
      const a = a0 + w * s;
      const q = V3(c.x + Math.sin(a) * R, 0, c.z + Math.cos(a) * R);
      keys.push({ t: t + s, p: fix(q, hot.y + Math.sin(s * 0.15) * 1.2) });
    }
    t += dur;
  } else if (kind === 'linger') {
    // 가까이 와서 천천히 맴돌기
    const dur = rr(r, 28, 40);
    let prev = keys[keys.length - 1].p;
    for (let s = 7; s <= dur; s += 7) {
      const a = r() * Math.PI * 2;
      const q = hot.clone().add(V3(Math.sin(a) * 3, 0, Math.cos(a) * 3));
      const step = q.clone().sub(prev).setY(0);
      if (step.length() > v * 7) q.copy(prev).add(step.setLength(v * 7));
      keys.push({ t: t + s, p: fix(q, hot.y + rr(r, -0.8, 0.8)) });
      prev = q;
    }
    t += dur;
  }
  // 2) 지나가며 멀어지기 (다가온 방향 그대로 반대편으로)
  const last = keys[keys.length - 1].p;
  const out = kind === 'pass' ? dir.clone() : dir.clone().applyAxisAngle(V3(0, 1, 0), rr(r, -0.8, 0.8));
  const tB = D / v;
  const nB = Math.max(3, Math.round(tB / 6));
  for (let i = 1; i <= nB; i++) {
    const u = i / nB;
    const q = last.clone().addScaledVector(out, D * u).addScaledVector(side, Math.sin(u * Math.PI) * rr(r, -2, 2));
    keys.push({ t: t + tB * u, p: fix(q, last.y + u * rr(r, -2, 1)) });
  }
  const end = t + tB;
  const gone = end + EXIT_T;
  exitLeg(keys, end, gone, v);
  return { path: new Path(keys), end, gone };
}

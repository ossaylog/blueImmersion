// 해양 생물 출현 관리
//  '어떤 생물이 언제 어디에'는 공유 생태계(Ecology)가 공유 시계로 정함 → 모든 접속자에게 같은 생물이 같은 시각·위치에.
//  이 클래스는 그 계획 중 내 카메라 가까이(약 50m) 있는 것만 실제 3D 생물로 만들어 움직이고, 멀어지면 정리.
//  발견 알림(이름 표시·컬렉션)은 각자 화면에 실제로 보인 생물만.
import * as THREE from 'three';
import type { SpeciesDef, DiverInfo, Creature } from './types';
import { FishSystem, FishGroup } from './FishSystem';
import { Turtle, Manta, Stingray, JellySwarm, withSeed } from './Megafauna';
import { markSilhouette } from '../water/WaterShading';
import { isGrand, tierOf } from '../data/codex';
import { Ecology, type Plan } from './Ecology';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _frustum = new THREE.Frustum();

/** 생물 이름 표시(토스트) 타이밍 */
const SEEN_DWELL = 0.35;   // 이 시간 이상 연속으로 화면에 보여야 '발견'
const TOAST_MIN = 2.5;     // 최소 표시 시간
const TOAST_MAX = 6;       // 최대 표시 시간
const LOST_GRACE = 1.0;    // 시야에서 벗어난 뒤 이 시간이 지나면 숨김
const SPECIES_REPEAT = 60; // 같은 종은 60초 안에 다시 알리지 않음
/** 이 거리 안에 들어온 계획만 실제 생물로 만듦 (물속 가시거리보다 넉넉히) */
const SPAWN_R = 48, DROP_R = 58;
/** 큰·희귀 생물은 더 멀리서부터 (그림자로) 보이기 시작 */
const SPAWN_R_GRAND = 70, DROP_R_GRAND = 80;

type Watch = { vis: number; lastVis: number; seen: boolean };
type Mover = Turtle | Manta | Stingray | JellySwarm;

export class SpawnDirector {
  active: Creature[] = [];
  private movers: Mover[] = [];
  /** 계획 키 → 내 화면의 생물 */
  private inst = new Map<string, Creature[]>();
  private clock = 0;
  private lastSeen = new Map<string, number>();    // 종별 마지막 조우 시각
  eco: Ecology;
  onEncounter?: (sp: SpeciesDef, c: Creature) => void;
  onEncounterEnd?: () => void;
  onSpawn?: (sp: SpeciesDef) => void;
  /** 직접 스폰하지 않지만 발견 알림 대상인 생물 (바닥 생물 등) */
  extra: Creature[] = [];
  private watch = new Map<Creature, Watch>();
  private queue: Creature[] = [];
  /** 생물이 처음 화면에 충분히 보였을 때 (컬렉션 기록용 · 알림과 별개로 즉시) */
  onSighted?: (sp: SpeciesDef, c: Creature) => void;
  private shown: { c: Creature; at: number } | null = null;
  /** 도감에 아직 없는 종이면 60초 반복 제한 없이 알림 (첫 만남을 놓치지 않도록) */
  isCollected?: (id: string) => boolean;
  /** 희귀·전설 생물이 가까이 나타났을 때 (연출용) */
  onRareSpawn?: (sp: SpeciesDef, tier: 2 | 3) => void;

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, private fish: FishSystem, species: SpeciesDef[], lowTier: boolean) {
    this.eco = new Ecology(species, lowTier);
  }

  /** T: 공유 시각 · cam: 내 카메라 위치 · d: 내 다이버 (물속일 때만 encounter) */
  private lastT = -1;
  update(dt: number, t: number, T: number, d: DiverInfo, cam: THREE.Vector3) {
    this.clock += dt;
    // 탭이 백그라운드였거나 화면이 오래 멈췄다 돌아오면: 생물을 지금 있어야 할 자리에 다시 놓음 (다른 사람과 어긋나지 않게)
    if (this.lastT > 0 && (T - this.lastT > 2 || T < this.lastT - 1)) for (const k of [...this.inst.keys()]) this.drop(k);
    this.lastT = T;
    this.sync(T, cam, d);
    for (const m of this.movers) { m.T = T; m.update(dt, t, d); }
    this.movers = this.movers.filter((m) => m.alive);
    this.active = this.active.filter((c) => c.alive);
    if (d.active) this.updateEncounters(dt);
  }

  /** 공유 계획 ↔ 내 화면의 생물 맞추기 */
  private sync(T: number, cam: THREE.Vector3, d: DiverInfo) {
    const plans = this.eco.alive(T);
    const live = new Set<string>();
    for (const p of plans) {
      live.add(p.key);
      const at = p.path.at(T, _v);
      const dist = Math.hypot(at.x - cam.x, at.z - cam.z, (at.y - cam.y) * 0.6);
      const have = this.inst.get(p.key);
      const grand = isGrand(p.sp);
      if (!have && dist < (grand ? SPAWN_R_GRAND : SPAWN_R) && T < p.end) this.create(p, T, d);
      else if (have && dist > (grand ? DROP_R_GRAND : DROP_R)) this.drop(p.key);
    }
    for (const k of [...this.inst.keys()]) if (!live.has(k)) this.drop(k);
  }

  private create(p: Plan, T: number, d: DiverInfo) {
    const sp = p.sp;
    const list: Creature[] = [];
    const at = p.path.at(T, new THREE.Vector3());
    withSeed(p.seed, () => {
      if (sp.behavior === 'turtle') { const m = new Turtle(sp, this.scene, at, null).attach(p, T); this.movers.push(m); list.push(m); }
      else if (sp.behavior === 'manta') { const m = new Manta(sp, this.scene, at, null).attach(p, T); this.movers.push(m); list.push(m); }
      else if (sp.behavior === 'eagle') {
        // 독수리가오리는 같은 경로를 차선만 달리해 나란히
        for (let i = 0; i < p.n; i++) {
          const m = new Manta(sp, this.scene, at, null, 'eagle');
          m.lane = i;
          const gap = sp.length * 1.3;
          m.attach(p, T, (i % 2 ? 1 : -1) * Math.ceil(i / 2) * gap, -i * 0.9);
          this.movers.push(m); list.push(m);
        }
      }
      else if (sp.behavior === 'jelly') { const m = new JellySwarm(sp, this.scene, at).attach(p, T); this.movers.push(m); list.push(m); }
      else if (sp.behavior === 'stingray') { const m = new Stingray(sp, this.scene, at).attach(p, T); this.movers.push(m); list.push(m); }
      else list.push(this.fish.spawnPlan(p, T));
    });
    // 큰·희귀 생물: 멀리서는 물빛보다 어두운 실루엣으로 다가오다 가까워지면 색이 드러남
    if (isGrand(sp)) for (const c of list) { const r = (c as { root?: THREE.Object3D }).root; if (r) markSilhouette(r); }
    this.inst.set(p.key, list);
    this.active.push(...list);
    this.onSpawn?.(sp);
    if (p.tier >= 2) this.onRareSpawn?.(sp, p.tier as 2 | 3);
    void d;
  }

  private drop(key: string) {
    const list = this.inst.get(key);
    if (!list) return;
    for (const c of list) {
      if (c instanceof FishGroup) c.alive = false;
      else (c as Mover).dispose();
    }
    this.inst.delete(key);
  }

  // ───────── 발견 알림: 실제로 화면에 보이는 생물만, 보이는 동안만 ─────────
  /** 카메라 시야(절두체) 안 + 물속 가시거리 안에 생물이 보이는지 */
  private visible(c: Creature): boolean {
    const cam = this.camera;
    const sp = c.sp;
    // 흔함·보통 등급은 작은 생물이라도 7m 안에서 보이면 인정 (바닥 생물을 바로 위에서 지나쳐야만 기록되던 문제)
    const maxD = Math.max(sp.seeDist ?? THREE.MathUtils.clamp(sp.length * 6, 5, 18), tierOf(sp.id) <= 1 ? 7 : 0);
    const test = (p: THREE.Vector3) => cam.position.distanceTo(p) < maxD && _frustum.containsPoint(p);
    if (c instanceof FishGroup) {
      for (const a of c.agents) if (test(a.pos)) return true;
      return false;
    }
    return test(c.center());
  }

  private updateEncounters(dt: number) {
    this.camera.updateMatrixWorld();
    _m.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_m);
    // 프러스텀 가장자리(화면 끝에 살짝 걸친 것)는 제외하도록 조금 좁힘
    for (const pl of _frustum.planes) pl.constant -= 0.3;

    const all = this.extra.length ? this.active.concat(this.extra) : this.active;
    for (const c of all) {
      if (c.sp.sizeClass === 'resident') continue;
      let w = this.watch.get(c);
      if (!w) { w = { vis: 0, lastVis: -1e9, seen: false }; this.watch.set(c, w); }
      if (c.alive && this.visible(c)) { w.vis += dt; w.lastVis = this.clock; }
      else w.vis = 0;
      if (!w.seen && w.vis >= SEEN_DWELL) {
        w.seen = true;
        c.encountered = true;
        // 컬렉션 기록은 보이는 즉시 (이름 알림 차례를 기다리다 시야에서 사라지면 기록이 안 되던 문제)
        this.onSighted?.(c.sp, c);
        const last = this.lastSeen.get(c.sp.id) ?? -1e9;
        this.lastSeen.set(c.sp.id, this.clock);
        const dup = this.queue.some((q) => q.sp.id === c.sp.id) || this.shown?.c.sp.id === c.sp.id;
        const fresh = this.isCollected ? !this.isCollected(c.sp.id) : false;
        if ((last < this.clock - SPECIES_REPEAT || fresh) && !dup) this.queue.push(c);
      }
    }
    for (const [c] of this.watch) if (!all.includes(c)) this.watch.delete(c);

    const stillVisible = (c: Creature) => c.alive && this.clock - (this.watch.get(c)?.lastVis ?? -1e9) < LOST_GRACE;
    // 대기 중 시야에서 이미 사라진 생물은 알리지 않음 (늦게 뜨는 이름 방지)
    this.queue = this.queue.filter(stillVisible);
    if (this.shown) {
      const age = this.clock - this.shown.at;
      const gone = !stillVisible(this.shown.c);
      if (age >= TOAST_MAX || (age >= TOAST_MIN && (gone || this.queue.length > 0)) || (gone && age >= 1.2)) {
        this.shown = null;
        this.onEncounterEnd?.();
      }
    }
    if (!this.shown && this.queue.length) {
      // 여럿이 대기 중이면 지금 가장 가까이 보이는 생물부터
      const cp = this.camera.position;
      this.queue.sort((a, b) => a.center().distanceTo(cp) - b.center().distanceTo(cp));
      const c = this.queue.shift()!;
      this.shown = { c, at: this.clock };
      this.onEncounter?.(c.sp, c);
    }
  }

  /** 체험 종료 시: 발견 알림 상태만 정리 (바다의 생물은 모두가 공유하므로 그대로) */
  clear() {
    for (const c of this.extra) { const w = this.watch.get(c); if (w) w.vis = 0; }
    this.watch.clear();
    this.queue = [];
    if (this.shown) { this.shown = null; this.onEncounterEnd?.(); }
  }

  debug() {
    return this.active.map((c) => c.sp.id + (c.leaving ? '(leaving)' : '')).join(', ');
  }
}

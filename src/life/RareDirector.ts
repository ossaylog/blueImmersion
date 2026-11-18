// 희귀·전설 생물 '만남 연출': 지루해질 만한 순간에 1~2마리씩, 내 앞쪽 멀리서 그림자로 다가오게 함
//  기본 바다(Ecology)의 희귀·전설 시간표와 별개로, 각자의 체험 흐름에 맞춰 부름
//   · 판툰에서 처음 멀리 나갔을 때 (28m → 희귀, 52m → 전설)
//   · 스쿠버로 처음 깊이 내려갔을 때 (14m → 희귀)
//   · 접속 5분 · 15분이 지났을 때 (전설)
//   · 한동안 희귀·전설을 못 봤을 때 (2분 반 → 희귀, 6분 넘게 전설을 못 봤으면 전설)
//  한꺼번에 몰리지 않게: 연출 사이 최소 75초, 내 주변 60m에 희귀·전설은 최대 2무리
//  부른 생물은 서버로 공유되어 근처의 다른 사람에게도 같은 자리·같은 경로로 보임
import * as THREE from 'three';
import type { Ecology, EcoEvent } from './Ecology';
import type { SpeciesDef } from './types';

const COOLDOWN = 75;
const MAX_NEAR = 2;
const QUIET_RARE = 150;
const QUIET_LEGEND = 360;

export interface RareCtx {
  swimming: boolean;          // 물속 체험 중
  pos: THREE.Vector3;         // 내 위치 (월드, 1인칭이면 카메라)
  fwd: THREE.Vector3;         // 바라보는 방향 (수평)
  depth: number;
  T: number;                  // 공유 시각
  snorkel: boolean;
}

type Reason = 'far' | 'farther' | 'deep' | 'time5' | 'time15' | 'quiet';

export class RareDirector {
  /** 이벤트를 만들었을 때 (서버로 공유) */
  onEvent?: (e: EcoEvent, reason: Reason) => void;
  /** 도감에 이미 있는 종인지 (없는 종을 먼저 보여 줌) */
  isCollected?: (id: string) => boolean;
  private done = new Set<Reason>();
  private session = 0;          // 접속 후 시간
  private swimT = 0;            // 물속에 있던 시간
  private sinceRare = 0;        // 마지막으로 희귀·전설을 본(또는 부른) 뒤 물속 시간
  private sinceLegend = 0;
  private lastEvent = -1e9;     // 마지막 연출 시각 (session 기준)
  private recent: string[] = [];
  private seq = 0;
  private checkT = 0;

  constructor(private eco: Ecology, private idOf: () => string) {}

  /** 희귀·전설을 실제로 화면에서 봤을 때 (연출이든 바다 시간표든) */
  noteSeen(tier: number) {
    if (tier >= 2) this.sinceRare = 0;
    if (tier >= 3) this.sinceLegend = 0;
  }

  update(dt: number, c: RareCtx) {
    this.session += dt;
    if (!c.swimming) return;
    this.swimT += dt; this.sinceRare += dt; this.sinceLegend += dt;
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = 1;
    // 물에 들어가자마자는 아님 (입수 연출·적응 시간)
    if (this.swimT < 20) return;
    if (this.session - this.lastEvent < COOLDOWN) return;
    if (this.eco.rareNear(c.T, c.pos, 60) >= MAX_NEAR) return;

    const far = Math.hypot(c.pos.x, c.pos.z);
    // 조건 순서 = 우선순위 (한 번만 쓰는 조건들 → 오래 못 봤을 때)
    const rules: [Reason, boolean, 2 | 3][] = [
      ['farther', far >= 52, 3],
      ['far', far >= 28, 2],
      ['deep', !c.snorkel && c.depth >= 14, 2],
      ['time15', this.session >= 900, 3],
      ['time5', this.session >= 300, 3],
      ['quiet', this.sinceRare >= QUIET_RARE, this.sinceLegend >= QUIET_LEGEND ? 3 : 2],
    ];
    const hit = rules.find(([r, cond]) => cond && (r === 'quiet' || !this.done.has(r)));
    if (!hit) return;
    const [reason, , tier] = hit;

    const e = this.make(tier, c) ?? (tier === 3 ? this.make(2, c) : null);
    if (!e) return;
    if (reason !== 'quiet') this.done.add(reason);
    // '멀리 나감'은 더 먼 조건을 채우면 가까운 조건도 채운 것으로
    if (reason === 'farther') this.done.add('far');
    if (reason === 'time15') this.done.add('time5');
    this.lastEvent = this.session;
    this.sinceRare = 0;
    if (e.tier === 3) this.sinceLegend = 0;
    this.eco.addEvent(e);
    this.onEvent?.(e, reason);
  }

  /** 종 고르기 + 내 앞쪽에서 다가와 옆을 지나가는 길 */
  private make(tier: 2 | 3, c: RareCtx): EcoEvent | null {
    const fwd = c.fwd.clone().setY(0);
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
    fwd.normalize();
    const cands: { sp: SpeciesDef; w: number; e: EcoEvent }[] = [];
    for (const sp of this.eco.rareSpecies(tier)) {
      const e = this.place(sp, tier, c, fwd);
      if (!e) continue;
      let w = sp.weight;
      if (this.isCollected && !this.isCollected(sp.id)) w *= 3;       // 아직 못 만난 종 먼저
      if (this.recent.includes(sp.id)) w *= 0.15;                     // 최근에 본 종은 드물게
      cands.push({ sp, w, e });
    }
    if (!cands.length) return null;
    let sum = 0; for (const k of cands) sum += k.w;
    let x = Math.random() * sum, pick = cands[0];
    for (const k of cands) { x -= k.w; if (x <= 0) { pick = k; break; } }
    this.recent.push(pick.sp.id); if (this.recent.length > 4) this.recent.shift();
    return pick.e;
  }

  private place(sp: SpeciesDef, tier: 2 | 3, c: RareCtx, fwd: THREE.Vector3): EcoEvent | null {
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const big = Math.min(sp.length, 13);
    // 큰 생물일수록 조금 더 앞·옆으로 비켜 지나가게 (부딪히지 않게, 전체 모습이 보이게)
    const ahead = 9 + big * 0.45, off = (Math.random() < 0.5 ? -1 : 1) * (2.5 + big * 0.5);
    const hot = c.pos.clone().addScaledVector(fwd, ahead).addScaledVector(side, off);
    // 체험 경계(95m) 안쪽으로
    const r = Math.hypot(hot.x, hot.z);
    if (r > 82) hot.multiplyScalar(82 / r);
    const range = this.eco.depthRange(sp, hot.x, hot.z);
    if (!range) return null;
    const [lo, hi] = range;
    // 스노클은 수면에서 내려다보므로 얕은 쪽, 스쿠버는 내 깊이 근처
    const want = c.snorkel ? -1.5 - big * 0.15 : c.pos.y - 0.5;
    const y = THREE.MathUtils.clamp(want, lo, hi);
    if (c.snorkel && y < -9) return null;          // 스노클에서 너무 깊으면 안 보임
    if (!c.snorkel && Math.abs(y - c.pos.y) > 9) return null;
    // 앞쪽에서(±35°) 다가오게: 다가오는 방향 = 출발점 → 지나는 지점
    const a = (Math.random() - 0.5) * 1.2;
    const from = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
    const k = `e:${this.idOf()}:${++this.seq}:${Math.floor(Math.random() * 1e6).toString(36)}`;
    const round = (v: number, n = 100) => Math.round(v * n) / n;
    return { k, sp: sp.id, tier, T: round(c.T + 0.3, 10), x: round(hot.x), y: round(y), z: round(hot.z), ax: round(-from.x, 1000), az: round(-from.z, 1000) };
  }

  /** 디버그: 지금 상태 */
  debug() { return { session: Math.round(this.session), swim: Math.round(this.swimT), sinceRare: Math.round(this.sinceRare), sinceLegend: Math.round(this.sinceLegend), done: [...this.done] }; }
  /** 디버그: 바로 하나 부르기 */
  force(tier: 2 | 3, c: RareCtx) { const e = this.make(tier, c); if (e) { this.eco.addEvent(e); this.onEvent?.(e, 'quiet'); } return e; }
}

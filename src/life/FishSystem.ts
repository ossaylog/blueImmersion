// 물고기: 종별 InstancedMesh + 종마다 다른 행동
//  무리의 위치·경로는 공유 생태계 계획(Plan, 공유 시계 기준)을 따르고,
//  개체의 '다음 목표(어느 산호를 쪼을지 등)'도 (시드, 개체 번호, 공유 시각 구간)으로 정해 모든 접속자에게 같게 보임.
//  다이버를 피하거나 호기심에 다가오는 반응만 각자 화면에서 계산 (지나가면 다시 같은 자리로 수렴).
import * as THREE from 'three';
import { fishGeometry, fishMaterial } from './FishBody';
import type { SpeciesDef, DiverInfo, Creature } from './types';
import { heightAt } from '../world/terrain';
import type { CoralReef, CoralInfo } from '../world/CoralReef';
import { rand, clamp, mulberry32, type RNG } from '../core/math';
import { seeded, h01, type Plan } from './Ecology';

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ'), tmpM = new THREE.Matrix4(), tmpS = new THREE.Vector3();
const _p = new THREE.Vector3(), _w = new THREE.Vector3();

/**
 * 산호를 쪼아 먹는 종의 먹는 방식
 *  scrape: 앵무고기류 — 부리 이빨로 산호 표면을 강하게 긁어냄 (머리를 크게 숙이고, 물 때마다 고개를 흔들고 산호 가루가 날림)
 *  pick:   나비고기·엔젤피시·무어리시 아이돌 — 산호 폴립·해면을 콕콕 정확히 쪼고 잠깐 멈춰 둘러봄
 *  nibble: 쥐치·탱류 — 해조류를 빠르게 연달아 뜯음
 *  probe:  나폴레옹피시 — 두툼한 입술로 산호 잔해 틈을 들추며 먹이를 찾음
 */
type FeedStyle = 'scrape' | 'pick' | 'nibble' | 'probe';
const FEED: Record<string, { style: FeedStyle; rate: number; amp: number; p: number }> = {
  parrotfish: { style: 'scrape', rate: 1.3, amp: 0.035, p: 0.8 },
  bumphead: { style: 'scrape', rate: 1.0, amp: 0.05, p: 0.75 },
  butterfly: { style: 'pick', rate: 3.2, amp: 0.018, p: 0.8 },
  idol: { style: 'pick', rate: 2.6, amp: 0.02, p: 0.7 },
  regalangel: { style: 'pick', rate: 2.3, amp: 0.02, p: 0.75 },
  emperor: { style: 'pick', rate: 2.0, amp: 0.022, p: 0.65 },
  queenangel: { style: 'pick', rate: 2.0, amp: 0.022, p: 0.65 },
  tang: { style: 'nibble', rate: 3.6, amp: 0.016, p: 0.75 },
  yellowtang: { style: 'nibble', rate: 3.8, amp: 0.015, p: 0.8 },
  garibaldi: { style: 'nibble', rate: 2.6, amp: 0.016, p: 0.5 },
  wrasse: { style: 'probe', rate: 0.9, amp: 0.06, p: 0.6 },
};

interface Agent {
  pos: THREE.Vector3; vel: THREE.Vector3; dir: THREE.Vector3;
  offset: THREE.Vector3; target: THREE.Vector3;
  phase: number; swim: number; scale: number; roll: number; yaw: number;
  curious: boolean;
  /** 지금 시각 구간 번호 (공유 시각 기준) */
  seg: number;
  /** 산호를 쪼는 지점(주둥이가 닿는 곳)과 다가가는 방향(바깥쪽 단위 벡터) */
  feedP: THREE.Vector3 | null; feedOut: THREE.Vector3;
  feeding: number;   // 0~1 먹는 자세로 들어간 정도
  bite: number;      // 이번 프레임 물기 동작 (주둥이 쪽으로 밀어 넣는 거리)
  biteWas: number;
  local: number;     // 호기심으로 다가가는 등 '나만의' 행동 남은 시간
  face: boolean;     // 흰동가리: 침입자를 마주봄
}

/** 대형 회유종 편대 슬롯 (리더 기준 로컬 좌표: +x 옆, +z 앞) — 몸길이에 비례한 간격 */
function cruiseSlot(sp: SpeciesDef, i: number, r: () => number) {
  const rank = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
  const lateral = Math.max(sp.length * 0.95, 1.8) * rank * side;
  const back = sp.length * (0.45 + 0.15 * r()) * rank;
  const up = (r() - 0.4) * Math.min(sp.length * 0.25, 2);
  return new THREE.Vector3(lateral, up, -back);
}
function rotY(v: THREE.Vector3, yaw: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return v.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

export class FishGroup implements Creature {
  alive = true; leaving = false; encountered = false; life: number;
  agents: Agent[] = [];
  home = new THREE.Vector3(); target = new THREE.Vector3();
  /** 공유 생태계 계획 (없으면 판툰 주변 정주 무리: 흰동가리 등) */
  plan: Plan | null = null;
  /** 공유 시각 (초) — 매 프레임 갱신 */
  T = 0;
  constructor(public sp: SpeciesDef, life: number, public seed: number) { this.life = life; }
  center() { return this.agents.length ? this.agents[0].pos : this.home; }
  leave() { if (this.sp.behavior !== 'anemone') this.leaving = true; }
}

class SpeciesRenderer {
  mesh: THREE.InstancedMesh; phase: THREE.InstancedBufferAttribute; swim: THREE.InstancedBufferAttribute;
  constructor(scene: THREE.Scene, sp: SpeciesDef, public capacity: number) {
    const geo = fishGeometry(sp.body!);
    this.phase = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.swim = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.phase.setUsage(THREE.DynamicDrawUsage); this.swim.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPhase', this.phase); geo.setAttribute('aSwim', this.swim);
    const mat = fishMaterial(sp.colors, sp.pattern ?? 0, sp.body!, sp.swim?.amp ?? 0.07);
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
}

/** 앵무고기가 산호를 긁을 때 날리는 산호 가루 (작은 입자, 천천히 가라앉으며 사라짐) */
class ReefDust {
  private N = 220;
  private pos: Float32Array; private life: Float32Array; private vel: Float32Array;
  private geo = new THREE.BufferGeometry();
  private i = 0;
  points: THREE.Points;
  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(this.N * 3).fill(-9999);
    this.life = new Float32Array(this.N);
    this.vel = new Float32Array(this.N * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `attribute float aLife; varying float vL; void main(){ vL = aLife; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (0.05 + (1.0 - aLife) * 0.05) * 600.0 / -mv.z; }`,
      fragmentShader: `varying float vL; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; gl_FragColor = vec4(0.93, 0.92, 0.86, (1.0 - smoothstep(0.15, 0.5, d)) * vL * 0.55); }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    scene.add(this.points);
  }
  burst(p: THREE.Vector3, out: THREE.Vector3, n: number, r: RNG) {
    for (let k = 0; k < n; k++) {
      const i = this.i; this.i = (this.i + 1) % this.N;
      this.pos[i * 3] = p.x + (r() - 0.5) * 0.04; this.pos[i * 3 + 1] = p.y + (r() - 0.5) * 0.04; this.pos[i * 3 + 2] = p.z + (r() - 0.5) * 0.04;
      this.vel[i * 3] = out.x * 0.06 + (r() - 0.5) * 0.08; this.vel[i * 3 + 1] = out.y * 0.05 + r() * 0.03; this.vel[i * 3 + 2] = out.z * 0.06 + (r() - 0.5) * 0.08;
      this.life[i] = 1;
    }
  }
  update(dt: number) {
    let any = false;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] = Math.max(0, this.life[i] - dt / 2.2);
      this.vel[i * 3 + 1] -= dt * 0.025;
      const k = Math.exp(-1.6 * dt);
      for (let a = 0; a < 3; a++) { this.vel[i * 3 + a] *= k; this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt; }
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -9999;
    }
    if (any) { (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true; (this.geo.attributes.aLife as THREE.BufferAttribute).needsUpdate = true; }
  }
}

export class FishSystem {
  groups: FishGroup[] = [];
  renderers = new Map<string, SpeciesRenderer>();
  private r = Math.random;
  private grid = new Map<number, CoralInfo[]>();
  private dust: ReefDust;
  private camPos = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private reef: CoralReef, species: SpeciesDef[], private fishScale: number) {
    for (const sp of species) {
      if (!sp.body) continue;
      const cap = Math.ceil(sp.group[1] * (sp.sizeClass === 'small' ? 5 : sp.sizeClass === 'resident' ? 40 : 6));
      this.renderers.set(sp.id, new SpeciesRenderer(scene, sp, cap));
    }
    // 산호 위치 격자 (2m 칸) — 쪼을 산호를 빨리 찾기
    for (const c of reef.points) {
      const k = this.cell(Math.floor(c.x / 2), Math.floor(c.z / 2));
      let l = this.grid.get(k); if (!l) this.grid.set(k, (l = []));
      l.push(c);
    }
    this.dust = new ReefDust(scene);
  }
  private cell(i: number, j: number) { return (i + 512) * 4096 + (j + 512); }
  /** (x, z) 가까이의 산호 (없으면 null) */
  private coralAt(x: number, z: number, radius: number): CoralInfo | null {
    let best: CoralInfo | null = null, bd = radius * radius;
    const i0 = Math.floor((x - radius) / 2), i1 = Math.floor((x + radius) / 2), j0 = Math.floor((z - radius) / 2), j1 = Math.floor((z + radius) / 2);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = this.grid.get(this.cell(i, j)); if (!l) continue;
      for (const c of l) { const d = (c.x - x) ** 2 + (c.z - z) ** 2; if (d < bd) { bd = d; best = c; } }
    }
    return best;
  }

  private makeAgent(sp: SpeciesDef, pos: THREE.Vector3, ang: number, r: RNG): Agent {
    return {
      pos, vel: new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)).multiplyScalar(sp.speed[0] + 0.05),
      dir: new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)),
      offset: new THREE.Vector3(rand(r, -1, 1), rand(r, 0.15, 1), rand(r, -1, 1)),
      target: pos.clone(), phase: rand(r, 0, 100), swim: 0.3, scale: sp.length * rand(r, 0.85, 1.15), roll: 0, yaw: ang,
      curious: r() < sp.curious, seg: -1, feedP: null, feedOut: new THREE.Vector3(0, 1, 0), feeding: 0, bite: 0, biteWas: 0, local: 0, face: false,
    };
  }

  /** 정주 무리 (흰동가리 등): 판툰 주변 고정 위치, seed로 모든 접속자에게 같은 움직임 */
  spawn(sp: SpeciesDef, at: THREE.Vector3, count?: number, home?: THREE.Vector3, seed = 0): FishGroup {
    const rend = this.renderers.get(sp.id)!;
    const r = mulberry32(seed || Math.floor(this.r() * 1e9));
    const g = new FishGroup(sp, rand(r, sp.stay[0], sp.stay[1]) || 1e9, seed);
    let n = count ?? Math.round(rand(r, sp.group[0], sp.group[1]) * (sp.sizeClass === 'small' ? this.fishScale : 1));
    const used = this.groups.filter((x) => x.sp === sp).reduce((a, x) => a + x.agents.length, 0);
    n = Math.max(1, Math.min(n, rend.capacity - used));
    g.home.copy(home ?? at); g.target.copy(at);
    for (let i = 0; i < n; i++) {
      const a = this.makeAgent(sp, at.clone().add(new THREE.Vector3(rand(r, -1, 1), rand(r, -0.5, 0.5), rand(r, -1, 1)).multiplyScalar(0.25)), rand(r, 0, Math.PI * 2), r);
      if (sp.behavior === 'anemone') {
        // 가장 큰 개체가 암컷, 나머지는 작은 수컷·어린 개체
        a.scale = sp.length * (i === 0 ? 1.18 : rand(r, 0.66, 0.92));
        a.offset.set(rand(r, -0.2, 0.2), rand(r, 0.08, 0.25), rand(r, -0.2, 0.2));
      }
      g.agents.push(a);
    }
    this.groups.push(g);
    return g;
  }

  /** 공유 생태계 계획으로 무리를 만듦 — 늦게 들어와도 지금 시각에 있어야 할 자리에서 시작 */
  spawnPlan(plan: Plan, T: number): FishGroup {
    const sp = plan.sp;
    const rend = this.renderers.get(sp.id)!;
    const r = mulberry32(plan.seed);
    const g = new FishGroup(sp, plan.end - T, plan.seed);
    g.plan = plan; g.T = T;
    let n = sp.sizeClass === 'small' ? Math.round(plan.n * this.fishScale) : plan.n;
    const used = this.groups.filter((x) => x.sp === sp).reduce((a, x) => a + x.agents.length, 0);
    n = Math.max(1, Math.min(n, rend.capacity - used));
    const at = plan.path.at(T, new THREE.Vector3());
    const v = plan.path.vel(T, new THREE.Vector3());
    g.home.copy(at); g.target.copy(at);
    const groupAng = v.lengthSq() > 1e-4 ? Math.atan2(v.x, v.z) : rand(r, 0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const spread = sp.sizeClass === 'small' ? 2.5 : 1.2;
      let pos = at.clone().add(new THREE.Vector3(rand(r, -1, 1), rand(r, -0.5, 0.5), rand(r, -1, 1)).multiplyScalar(spread));
      const ang = sp.behavior === 'cruise' || sp.behavior === 'school' ? groupAng : rand(r, 0, Math.PI * 2);
      const slot = sp.behavior === 'cruise' && i > 0 ? cruiseSlot(sp, i, r) : null;
      if (slot) pos = at.clone().add(rotY(slot.clone(), ang));
      const a = this.makeAgent(sp, pos, ang, r);
      if (sp.behavior === 'hoverSchool') a.offset.multiply(new THREE.Vector3(2.2, 1.6, 2.2));
      if (sp.behavior === 'mill') a.offset.set(rand(r, -1, 1), rand(r, -1, 1), rand(r, -1, 1));
      if (slot) a.offset.copy(slot);
      g.agents.push(a);
    }
    // 리프 물고기는 지금 먹고 있어야 할 산호 앞에서 바로 시작
    if (sp.behavior === 'wander' || sp.behavior === 'graze' || sp.behavior === 'hover') {
      g.agents.forEach((a, i) => { this.schedule(g, a, i, T, null); a.pos.copy(a.target); if (a.feedP) a.feeding = 1; });
    }
    this.groups.push(g);
    return g;
  }

  update(dt: number, t: number, diver: DiverInfo, T: number, cam: THREE.Vector3) {
    dt = Math.min(dt, 0.05);
    this.camPos.copy(cam);
    for (const g of this.groups) {
      g.T = T;
      if (g.plan) { g.life = g.plan.end - T; if (T > g.plan.end) g.leaving = true; }
      else { g.life -= dt; if (g.life <= 0 && !g.leaving) g.leave(); }
      this.updateGroup(g, dt, t, diver);
    }
    this.groups = this.groups.filter((g) => g.alive);
    this.dust.update(dt);
    this.writeInstances();
  }

  /**
   * 리프 물고기 개체의 다음 목표: (무리 시드, 개체 번호, 공유 시각 구간)으로 정해짐 → 모두에게 같은 산호를 같은 때에 쪼음
   */
  private schedule(g: FishGroup, a: Agent, i: number, T: number, diver: DiverInfo | null) {
    const sp = g.sp;
    const P = (sp.behavior === 'hover' ? 9 : 5.5) + 5 * h01(g.seed, i, 1);
    const off = h01(g.seed, i, 2) * P;
    const j = Math.floor((T + off) / P);
    if (j === a.seg) return;
    a.seg = j;
    const r = seeded(g.seed, i, j);
    const t0 = j * P - off;
    const home = g.plan ? g.plan.path.at(t0, _p) : _p.copy(g.home);
    if (diver && a.curious && diver.idleTime > 4 && diver.active && diver.pos.distanceTo(a.pos) < 10) {
      // 다이버가 가만히 있으면 슬며시 다가와 앞을 지나감 (나에게만 보이는 행동 · 다음 구간에 다시 원래대로)
      a.target.copy(diver.pos).addScaledVector(diver.forward, diver.fp ? 1.05 : 1.7).add(tmpV2.set(rand(r, -0.8, 0.8), rand(r, -0.3, 0.6), rand(r, -0.8, 0.8)));
      a.feedP = null; a.local = P;
      return;
    }
    const feed = FEED[sp.id];
    if (sp.behavior === 'hover') {
      a.target.copy(home).add(tmpV2.set(rand(r, -0.6, 0.6), rand(r, 0, 0.5), rand(r, -0.6, 0.6)));
      a.feedP = null;
      return;
    }
    const ang = r() * Math.PI * 2, d = (sp.sizeClass === 'large' ? 3 : 4) * Math.sqrt(r());
    let x = home.x + Math.sin(ang) * d, z = home.z + Math.cos(ang) * d;
    if (feed && r() < feed.p) {
      // 산호 쪼기: 가까운 산호 꼭대기 근처 표면, 바깥 위쪽에서 비스듬히 주둥이를 댐
      const c = this.coralAt(x, z, 1.6);
      const oa = r() * Math.PI * 2;
      a.feedOut.set(Math.sin(oa) * 0.8, feed.style === 'scrape' ? 0.75 : 0.55, Math.cos(oa) * 0.8).normalize();
      let y: number;
      if (c) {
        const k = 0.25 + r() * 0.2;
        x = c.x + Math.sin(oa) * c.size * k; z = c.z + Math.cos(oa) * c.size * k;
        y = c.y + c.size * (0.38 + r() * 0.2);
      } else y = heightAt(x, z) + 0.04;   // 산호가 없으면 바위의 조류(藻類)를 뜯음
      a.feedP = (a.feedP ?? new THREE.Vector3()).set(x, y, z);
      a.target.copy(a.feedP).addScaledVector(a.feedOut, a.scale * 0.5 + 0.03);
    } else {
      a.feedP = null;
      const fl = heightAt(x, z);
      a.target.set(x, clamp(fl + rand(r, 0.4, 1.8), fl + 0.3, -0.6), z);
    }
  }

  private updateGroup(g: FishGroup, dt: number, t: number, diver: DiverInfo) {
    const sp = g.sp;
    const [vMin, vMax] = sp.speed;
    const lead = g.agents[0];
    if (!lead) { g.alive = false; return; }
    const T = g.T;
    const plan = g.plan;

    // ── 무리 단위 목표 (공유 경로) ──
    if (plan) {
      if (sp.behavior === 'school' || g.leaving) plan.path.at(T + 1.5, g.target);
      if (sp.behavior !== 'school') plan.path.at(T, g.home);
    }
    const dDiverHome = diver.active ? diver.pos.distanceTo(g.home) : 99;

    for (let i = 0; i < g.agents.length; i++) {
      const a = g.agents[i];
      const desired = tmpV.set(0, 0, 0);
      let speedCap = vMax;
      a.bite = 0; a.face = false;
      switch (sp.behavior) {
        case 'mill': {
          // 토네이도처럼 한 지점을 맴도는 무리 (바라쿠다·트레발리)
          const rel = tmpV2.subVectors(a.pos, g.home); rel.y = 0;
          const r = Math.max(rel.length(), 1e-3);
          const rT = 2.2 + Math.abs(a.offset.x) * 2.2 + sp.length * 2;
          const tan = new THREE.Vector3(-rel.z / r, 0, rel.x / r).multiplyScalar(vMax * 0.75);
          desired.copy(tan).addScaledVector(rel.normalize(), (rT - r) * 0.6);
          desired.y = (g.home.y + a.offset.y * 1.8 - a.pos.y) * 0.6;
          const sepV = new THREE.Vector3();
          for (const b of g.agents) {
            if (b === a) continue;
            sepV.subVectors(a.pos, b.pos);
            const d = sepV.length(), r0 = a.scale * 1.6;
            if (d < r0 && d > 1e-4) desired.addScaledVector(sepV, (r0 - d) / d * 2);
          }
          if (g.leaving) desired.copy(tmpV2.subVectors(g.target, a.pos).setLength(vMax));
          break;
        }
        case 'school': case 'hoverSchool': {
          // 분리·정렬·응집
          const sep = new THREE.Vector3(), ali = new THREE.Vector3(), coh = new THREE.Vector3();
          let nAli = 0;
          const sepR = a.scale * 2.2, aliR = a.scale * 9;
          for (let j = 0; j < g.agents.length; j++) {
            if (j === i) continue;
            const b = g.agents[j];
            tmpV2.subVectors(a.pos, b.pos);
            const d = tmpV2.length();
            if (d < sepR && d > 1e-4) sep.addScaledVector(tmpV2, (sepR - d) / (d * sepR));
            if (d < aliR) { ali.add(b.vel); coh.add(b.pos); nAli++; }
          }
          if (nAli) { ali.divideScalar(nAli); coh.divideScalar(nAli).sub(a.pos); }
          if (sp.behavior === 'hoverSchool' && !g.leaving) {
            // 산호 위에 구름처럼 떠 있다가, 다이버가 가까우면 가지 사이로 숨음
            const hide = dDiverHome < sp.shy + 1.2 ? 0.25 : 1;
            const tgt = tmpV2.copy(a.offset).multiplyScalar(hide).add(g.home);
            tgt.x += Math.sin(t * 0.3 + a.phase) * 0.4; tgt.y += Math.sin(t * 0.5 + a.phase * 1.3) * 0.15;
            desired.addScaledVector(tgt.sub(a.pos), 0.9);
            desired.addScaledVector(sep, 1.4).addScaledVector(ali, 0.3);
            speedCap = hide < 1 ? vMax : vMax * 0.5;
          } else {
            const goal = tmpV2.subVectors(g.target, a.pos);
            const gl = goal.length();
            desired.addScaledVector(goal, Math.min(1, gl) / Math.max(gl, 1e-3) * vMax * 0.8);
            desired.addScaledVector(sep, 2.0).addScaledVector(ali, 0.9).addScaledVector(coh, 0.35);
          }
          break;
        }
        case 'anemone': {
          // 흰동가리: 말미잘 촉수 위를 까딱이며 맴돌고, 자주 촉수 사이로 파고들어 몸을 비빔(점액 적응)
          //  누가 가까이 오면 촉수 깊숙이 숨어 침입자를 마주봄 (큰 암컷은 조금 앞으로 나와 지킴)
          const P = 1.4 + 1.8 * h01(g.seed, i, 1), off = h01(g.seed, i, 2) * P;
          const j = Math.floor((T + off) / P);
          if (j !== a.seg) {
            a.seg = j;
            const r = seeded(g.seed, i, j);
            const dip = r() < 0.28;
            a.offset.set(rand(r, -0.2, 0.2), dip ? rand(r, 0.015, 0.06) : rand(r, 0.09, 0.3), rand(r, -0.2, 0.2));
          }
          const near = diver.active && dDiverHome < sp.shy + 0.9;
          a.target.copy(a.offset);
          if (near) { a.target.x *= i === 0 ? 0.6 : 0.35; a.target.z *= i === 0 ? 0.6 : 0.35; a.target.y = i === 0 ? 0.1 : 0.035; a.face = true; }
          a.target.add(g.home);
          a.target.y += Math.sin(t * 2.4 + a.phase) * 0.025; // 위아래로 까딱
          const goal = tmpV2.subVectors(a.target, a.pos), gl = goal.length();
          desired.copy(goal).multiplyScalar(Math.min(vMax, gl * 1.6) / Math.max(gl, 1e-3));
          if (near) speedCap = vMax * 1.6;
          for (const b of g.agents) {
            if (b === a) continue;
            tmpV2.subVectors(a.pos, b.pos);
            const d = tmpV2.length(), r0 = Math.max(a.scale, b.scale) * 0.9;
            if (d < r0 && d > 1e-4) desired.addScaledVector(tmpV2, (r0 - d) / d);
          }
          break;
        }
        case 'wander': case 'graze': case 'hover': {
          const follower = i > 0 && sp.group[0] >= 2 && sp.behavior !== 'hover'; // 나비고기처럼 짝을 지어 다님
          if (a.local > 0) a.local -= dt;
          if (follower) {
            if (lead.feedP && lead.feeding > 0.5) {
              // 짝도 바로 옆 산호를 함께 쪼음
              if (!a.feedP) a.feedP = new THREE.Vector3();
              a.feedP.copy(lead.feedP).add(tmpV2.set(Math.sin(a.phase) * 0.18, 0.02, Math.cos(a.phase) * 0.18));
              a.feedOut.copy(lead.feedOut);
              a.target.copy(a.feedP).addScaledVector(a.feedOut, a.scale * 0.5 + 0.03);
            } else {
              a.feedP = null;
              a.target.copy(lead.pos).add(tmpV2.set(Math.sin(a.phase * 0.3) * 0.35, 0.05, Math.cos(a.phase * 0.3) * 0.35));
            }
          } else this.schedule(g, a, i, T, diver);
          if (g.leaving) { a.target.copy(g.target); a.feedP = null; }
          const goal = tmpV2.subVectors(a.target, a.pos);
          const gl = goal.length();
          // 도착 감속 (arrive)
          const want = Math.min(vMax, gl * 0.6);
          desired.copy(goal).multiplyScalar(want / Math.max(gl, 1e-3));
          // 산호 앞에 도착하면 먹는 자세: 주둥이를 산호에 대고 물기
          const atFeed = !!a.feedP && gl < 0.18 + a.scale * 0.3;
          a.feeding = clamp(a.feeding + (atFeed ? dt * 1.6 : -dt * 3), 0, 1);
          if (a.feeding > 0.05 && a.feedP) {
            const f = FEED[sp.id] ?? FEED.butterfly;
            const b = T * f.rate + i * 0.37;
            let pulse: number;
            if (f.style === 'scrape' || f.style === 'probe') pulse = Math.pow(Math.max(0, Math.sin(b * Math.PI * 2)), 3);   // 크게 물고 → 뒤로 빼며 씹음
            else if (f.style === 'pick') pulse = Math.pow(Math.max(0, Math.sin(b * Math.PI * 2)), 6) * (Math.sin(b * 0.45) > -0.35 ? 1 : 0); // 콕콕 · 가끔 멈춰 둘러봄
            else pulse = Math.pow(Math.abs(Math.sin(b * Math.PI * 2)), 4);                                                   // 연달아 뜯음
            a.bite = pulse * f.amp * a.feeding * (1 + a.scale * 2);
            desired.multiplyScalar(1 - a.feeding * 0.85);
            // 앵무고기: 물 때마다 고개를 흔들고 산호 가루가 날림
            if (f.style === 'scrape' && pulse > 0.85 && a.biteWas <= 0.85 && this.camPos.distanceTo(a.pos) < 16) this.dust.burst(a.feedP, a.feedOut, 4 + Math.floor(Math.random() * 4), Math.random);
            a.biteWas = pulse;
          }
          // 같은 무리끼리 겹치지 않게
          for (const b of g.agents) {
            if (b === a) continue;
            tmpV2.subVectors(a.pos, b.pos);
            const d = tmpV2.length();
            const r0 = Math.max(a.scale, b.scale) * 1.1;
            if (d < r0 && d > 1e-4) desired.addScaledVector(tmpV2, (r0 - d) / d * 1.5);
          }
          break;
        }
        case 'cruise': {
          if (i === 0) {
            if (plan) {
              // 공유 경로를 그대로 따라감 (경로 속도 + 어긋난 만큼 보정)
              plan.path.at(T, _p); plan.path.vel(T, _w);
              desired.copy(_w).addScaledVector(_p.sub(a.pos), 0.8);
              speedCap = vMax * 1.6;
            } else {
              const goal = tmpV2.subVectors(g.target, a.pos);
              desired.copy(goal).setLength(vMax);
            }
            desired.x += Math.sin(t * 0.4 + a.phase) * 0.08;
          } else {
            // 짝/무리: 리더 기준 편대 위치를 유지 (리더 진행 방향으로 회전)
            const slotW = rotY(tmpV2.copy(a.offset), lead.yaw).add(lead.pos);
            slotW.y += Math.sin(t * 0.25 + a.phase) * sp.length * 0.04;
            desired.subVectors(slotW, a.pos).multiplyScalar(0.6).add(lead.vel);
            speedCap = vMax * 1.4;
          }
          // 대형 개체끼리는 몸길이만큼 떨어지도록 분리
          for (const b of g.agents) {
            if (b === a) continue;
            const sep = tmpS.subVectors(a.pos, b.pos);
            const dd = sep.length(), r0 = Math.max(a.scale, b.scale) * 0.9;
            if (dd < r0 && dd > 1e-4) desired.addScaledVector(sep, (r0 - dd) / dd * 1.2);
          }
          break;
        }
      }

      // 다이버 회피 (가까이 오면 조금 물러남) — 먹는 중엔 덜 예민함
      if (diver.active && sp.behavior !== 'anemone') {
        tmpV2.subVectors(a.pos, diver.pos);
        const d = tmpV2.length();
        const moving = diver.vel.length();
        const shy = sp.shy * (0.8 + moving * 0.8) * (diver.fp ? 0.6 : 1) * (1 - a.feeding * 0.35);
        if (d < shy && !(a.curious && moving < 0.15)) {
          desired.addScaledVector(tmpV2.normalize(), (1 - d / shy) * vMax * 2.5);
          speedCap = vMax * 1.8;
          a.feeding *= 0.9;
        }
      }
      // 바닥/수면 회피
      const floor = heightAt(a.pos.x, a.pos.z) + a.scale * 0.35 + 0.08;
      const feedingNow = a.feeding > 0.3;
      if (!feedingNow && sp.behavior !== 'anemone' && a.pos.y < floor + 0.25) desired.y += (floor + 0.25 - a.pos.y) * 3;
      if (a.pos.y > -0.35) desired.y -= (a.pos.y + 0.35) * 3;

      // 조향 (관성) — 큰 생물일수록 천천히 반응
      const agility = sp.sizeClass === 'small' ? 3.2 : sp.sizeClass === 'large' ? 0.9 : sp.sizeClass === 'resident' ? 4 : 2.0;
      a.vel.lerp(desired, 1 - Math.exp(-agility * dt));
      const sp2 = a.vel.length();
      if (sp2 > speedCap) a.vel.multiplyScalar(speedCap / sp2);
      if (sp.behavior !== 'anemone' && sp.behavior !== 'hover' && !feedingNow && a.local <= 0 && sp2 < vMin && !(a.feedP && sp.behavior !== 'cruise')) a.vel.addScaledVector(a.dir, (vMin - sp2));
      a.pos.addScaledVector(a.vel, dt);
      if (a.pos.y < floor - (sp.behavior === 'anemone' ? 0.2 : 0)) a.pos.y = floor - (sp.behavior === 'anemone' ? 0.2 : 0);
      if (a.pos.y > -0.25) a.pos.y = -0.25;

      // 방향·기울기
      const sp3 = a.vel.length();
      if (a.feeding > 0.05 && a.feedP) {
        // 주둥이를 산호 쪽으로: 바깥 방향의 반대 (앵무고기는 머리를 크게 숙임)
        tmpV2.copy(a.feedOut).negate();
        const st = FEED[sp.id]?.style;
        tmpV2.y = clamp(tmpV2.y, st === 'scrape' ? -0.8 : -0.62, 0.2);
        a.dir.lerp(tmpV2.normalize(), 1 - Math.exp(-4 * a.feeding * dt)).normalize();
      } else if (a.face && diver.active) {
        tmpV2.subVectors(diver.pos, a.pos).setY(0).normalize();
        a.dir.lerp(tmpV2, 1 - Math.exp(-5 * dt)).normalize();
      } else if (sp3 > 0.02) {
        tmpV2.copy(a.vel).divideScalar(sp3);
        tmpV2.y = clamp(tmpV2.y, -0.6, 0.6);
        a.dir.lerp(tmpV2, 1 - Math.exp(-(sp.sizeClass === 'small' || sp.sizeClass === 'resident' ? 6 : 2.5) * dt)).normalize();
      }
      const newYaw = Math.atan2(a.dir.x, a.dir.z);
      let dy = newYaw - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      // 긁어먹을 때는 물 때마다 고개를 좌우로 흔듦
      const shake = a.feeding > 0.05 && FEED[sp.id]?.style === 'scrape' ? Math.sin(T * 9 + i) * 0.22 * (a.bite > 0.003 ? 1 : 0.3) : 0;
      a.roll = THREE.MathUtils.lerp(a.roll, clamp(-dy / Math.max(dt, 1e-3) * 0.08, -0.5, 0.5) + shake, 1 - Math.exp(-6 * dt));
      a.yaw = newYaw;
      // 꼬리 박동: 속도에 비례 (먹는 중엔 지느러미로 자세만 잡음)
      a.swim = clamp(sp3 / Math.max(vMax, 0.05), a.feeding > 0.3 ? 0.18 : 0, 1.4);
      if (sp.behavior === 'anemone') a.swim = Math.max(a.swim, 0.45); // 흰동가리 특유의 뒤뚱이는 헤엄
      a.phase += dt * (sp.swim?.freq ?? 4) * (0.35 + 1.1 * a.swim);

      if (diver.active && !g.encountered && a.pos.distanceTo(diver.pos) < Math.max(4, sp.length * 4)) g.encountered = true;
    }
  }

  private writeInstances() {
    for (const [, r] of this.renderers) r.mesh.count = 0;
    for (const g of this.groups) {
      const r = this.renderers.get(g.sp.id)!;
      for (const a of g.agents) {
        const i = r.mesh.count;
        if (i >= r.capacity) break;
        tmpE.set(-Math.asin(clamp(a.dir.y, -0.9, 0.9)), a.yaw, a.roll);
        tmpQ.setFromEuler(tmpE);
        tmpS.setScalar(a.scale);
        // 물기 동작: 주둥이 쪽으로 살짝 밀어 넣음
        _p.copy(a.pos);
        if (a.bite > 0 && a.feedP) _p.addScaledVector(a.feedOut, -a.bite);
        tmpM.compose(_p, tmpQ, tmpS);
        r.mesh.setMatrixAt(i, tmpM);
        r.phase.setX(i, a.phase); r.swim.setX(i, a.swim);
        r.mesh.count = i + 1;
      }
    }
    for (const [, r] of this.renderers) {
      r.mesh.instanceMatrix.needsUpdate = true; r.phase.needsUpdate = true; r.swim.needsUpdate = true;
    }
  }

  setVisible(v: boolean) { for (const [, r] of this.renderers) r.mesh.visible = v; }
}

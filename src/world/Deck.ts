// 판툰 위 자유 이동: 걸을 수 있는 바닥(1층·계단·2층) + 가구 충돌 + 발 디딤(IK용 발자국)
//  - 1층 메인 데크는 어디든 걸어 다님 (카페·테이블·랙 등은 피해서)
//  - 선수 쪽 계단(14단)을 한 칸씩 밟아 2층 전망 데크로 올라감
//  - 2층 선베드 옆에서 상호작용(F)하면 누워서 쉼
//  - 우현 스노클 존 / 선미 다이빙 데크에 들어가면 체험(시점) 선택
//  좌표는 모두 판툰 로컬 (원점 = 판툰 중앙 수면, +z = 선수, +x = 우현)
import * as THREE from 'three';
import { HIP_STAND, HIP_STAIR } from '../character/Diver';
import { MD, UD } from './Pontoon';
import { clamp, damp, dampAngle } from '../core/math';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
type Box = [number, number, number, number]; // x0, x1, z0, z1
type Circle = [number, number, number];      // x, z, r

const R = 0.27;               // 몸 반지름
const HIP = HIP_STAND;
const FOOT_W = 0.078;

/** 계단: x 3.6~4.8, 위(2층 가장자리) z 9.05 → 아래 z 12.83, 14단 */
const ST_X0 = 3.6, ST_X1 = 4.8, ST_Z0 = 9.05, ST_RUN = 0.27, ST_N = 14;
const ST_Z1 = ST_Z0 + ST_N * ST_RUN;
const stairY = (z: number) => {
  if (z < ST_Z0) return UD;
  const k = clamp(Math.floor((z - ST_Z0) / ST_RUN), 0, ST_N - 1);
  return UD - (k + 1) * ((UD - MD) / ST_N);
};
const stairCenterZ = (z: number) => ST_Z0 + (clamp(Math.floor((z - ST_Z0) / ST_RUN), 0, ST_N - 1) + 0.5) * ST_RUN;

/** 1층 장애물 (가구) */
const MAIN_BOX: Box[] = [
  [-5.8, 1.75, 6.72, 9.2],            // 리프 카페 매점
  [-5.65, -4.75, 0.35, 3.65],         // 뷔페 테이블
  [5.45, 6.2, 4.5, 8.5],              // 스노클 장비 랙
  [5.3, 6.2, 9.5, 12.7],              // 스팅어 슈트 걸이
  [ST_X0 - 0.05, ST_X1 + 0.05, 8.9, ST_Z1 - 0.3], // 계단 옆·아래 (아래쪽 끝에서만 올라감)
  [2.15, 3.65, -3.65, -2.35],         // 수중 전망대 입구
  [-6.2, -4.45, -13.95, -7.25],       // 다이빙 벤치 + 탱크 랙
  [5.6, 6.2, -10.95, -9.05],          // 브리핑 보드
  [3.9, 4.9, -13.95, -13.25],         // 카메라 헹굼 통
  [5.2, 5.9, -14.5, -14.1],           // 산소 키트
];
for (const tx of [-3.9, -1.1]) for (const tz of [4.4, 1.9, -0.6]) MAIN_BOX.push([tx - 1.2, tx + 1.2, tz - 0.6, tz + 0.6]);
const MAIN_CIRC: Circle[] = [
  [-3.8, 11.4, 1.05], [-1.0, 12.9, 1.05], [-3.8, 13.9, 1.05], // 파라솔 테이블
  [5.6, -0.8, 0.1],                                           // 샤워 기둥
  [-4.6, 6.35, 0.2], [-3.6, 6.35, 0.2], [-2.6, 6.35, 0.2], [-1.6, 6.35, 0.2], // 바 스툴
];
for (const x of [-5.63, 5.63]) for (const z of [-3.2, 2.7, 8.8]) MAIN_CIRC.push([x, z, 0.14]); // 2층 기둥

/** 2층 선베드 */
export interface Lounger { x: number; z: number; i: number }
export const LOUNGERS: Lounger[] = [[-3.8, -1.6], [-2.2, -1.6], [2.2, -1.6], [3.8, -1.6], [-3.8, 1.4], [3.8, 1.4]].map(([x, z], i) => ({ x, z, i }));
/** 선베드 옆에 서는 자리 (통로 쪽) */
export const loungerSide = (l: Lounger) => V3(l.x + (Math.abs(l.x) > 3 ? Math.sign(l.x) : -Math.sign(l.x)) * 0.62, UD, l.z + 0.2);
/** 누웠을 때 골반 위치 · 머리는 등받이(+z) 쪽, 발은 -z */
export const loungerLie = (l: Lounger) => V3(l.x, UD + 0.5, l.z + 0.5);
const UP_BOX: Box[] = LOUNGERS.map((l) => [l.x - 0.4, l.x + 0.4, l.z - 1.0, l.z + 1.05] as Box);
const UP_CIRC: Circle[] = [[-5.3, -0.6, 0.1], [5.3, -0.6, 0.1], [-5.3, 7.0, 0.1], [5.3, 7.0, 0.1], [0, 3.2, 0.1]];

export type ZoneId = 'snorkel' | 'scuba';
/** 체험 존 (1층) */
export const ZONES: Record<ZoneId, Box> = {
  snorkel: [4.1, 6.0, -0.5, 8.8],      // 우현: 스노클 장비 랙 + 입수 계단 입구
  scuba: [-6.0, 6.0, -15.0, -6.9],     // 선미: 다이빙 데크
};

export type DeckLevel = 'main' | 'stairs' | 'upper';

function pushBox(p: THREE.Vector3, b: Box, r: number) {
  const cx = clamp(p.x, b[0], b[1]), cz = clamp(p.z, b[2], b[3]);
  let dx = p.x - cx, dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return;
  if (d2 < 1e-8) {
    // 상자 안: 가장 가까운 면으로
    const pen = [p.x - b[0], b[1] - p.x, p.z - b[2], b[3] - p.z];
    const k = pen.indexOf(Math.min(...pen));
    if (k === 0) p.x = b[0] - r; else if (k === 1) p.x = b[1] + r; else if (k === 2) p.z = b[2] - r; else p.z = b[3] + r;
    return;
  }
  const d = Math.sqrt(d2); dx /= d; dz /= d;
  p.x = cx + dx * r; p.z = cz + dz * r;
}
function pushCircle(p: THREE.Vector3, c: Circle, r: number) {
  const dx = p.x - c[0], dz = p.z - c[1], d = Math.hypot(dx, dz), rr = c[2] + r;
  if (d >= rr || d < 1e-6) return;
  p.x = c[0] + (dx / d) * rr; p.z = c[1] + (dz / d) * rr;
}

/**
 * 판툰 위를 걷는 사람 (로컬 좌표)
 *  pos: 발 아래 바닥점(xz) · hip: 골반 높이 · feet: 두 발바닥 위치 [hipL쪽, hipR쪽]
 */
export class DeckMover {
  pos = V3();
  vel = V3();
  yaw = 0;
  level: DeckLevel = 'main';
  hipY = MD + HIP;
  feet: [THREE.Vector3, THREE.Vector3] = [V3(), V3()];
  /** 지금 움직이는 발 (−1 = 둘 다 딛고 서 있음) */
  private swing = -1;
  private from = V3(); private to = V3();
  private u = 0; private dur = 0.4;
  /** 이번 발걸음의 착지점이 고정됨 (계단) */
  private fixedTo = false;
  speed = 0;

  place(p: THREE.Vector3, yaw: number, level: DeckLevel = 'main') {
    this.pos.set(p.x, 0, p.z); this.yaw = yaw; this.level = level; this.vel.set(0, 0, 0);
    const y = this.floorAt(this.pos.x, this.pos.z);
    this.pos.y = y; this.hipY = y + HIP;
    this.restFeet(this.feet);
    this.swing = -1;
  }

  get onStairs() { return this.level === 'stairs'; }

  floorAt(x: number, z: number) {
    if (this.level === 'upper') return UD;
    if (this.level === 'stairs') return stairY(z);
    void x;
    return MD;
  }

  /** 두 발을 몸 아래 나란히 */
  private restFeet(out: [THREE.Vector3, THREE.Vector3]) {
    const lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw);
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? -1 : 1;
      out[k].set(this.pos.x + lx * FOOT_W * s, 0, this.pos.z + lz * FOOT_W * s);
      if (this.level === 'stairs') out[k].z = stairCenterZ(out[k].z);
      out[k].y = this.floorAt(out[k].x, out[k].z);
    }
  }

  /** 지금 있는 체험 존 (1층에서만) */
  zone(): ZoneId | null {
    if (this.level !== 'main') return null;
    for (const k of Object.keys(ZONES) as ZoneId[]) {
      const b = ZONES[k];
      if (this.pos.x >= b[0] && this.pos.x <= b[1] && this.pos.z >= b[2] && this.pos.z <= b[3]) return k;
    }
    return null;
  }

  /** 가장 가까운 선베드 (2층에서 1.2m 안) */
  nearLounger(): Lounger | null {
    if (this.level !== 'upper') return null;
    let best: Lounger | null = null, bd = 1.25;
    for (const l of LOUNGERS) {
      const s = loungerSide(l);
      const d = Math.hypot(s.x - this.pos.x, s.z - this.pos.z);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  /**
   * want: 원하는 이동 속도 (로컬 xz, m/s) · faceYaw: 1인칭이면 카메라 방향을 바라봄
   */
  update(dt: number, want: THREE.Vector3, faceYaw: number | null) {
    const stairs = this.level === 'stairs';
    const maxV = stairs ? 0.5 : 1.45;
    const wl = Math.hypot(want.x, want.z);
    if (wl > maxV) want.multiplyScalar(maxV / wl);
    this.vel.x = damp(this.vel.x, want.x, wl > 0.01 ? 7 : 10, dt);
    this.vel.z = damp(this.vel.z, want.z, wl > 0.01 ? 7 : 10, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;

    // 층 전환 + 충돌
    const p = this.pos;
    const prevLevel = this.level;
    if (this.level === 'main') {
      // 계단 맨 아래에서 계단 쪽(−z)으로 걸으면 계단에 올라섬
      if (p.x > ST_X0 + 0.12 && p.x < ST_X1 - 0.12 && p.z < ST_Z1 + 0.12 && p.z > ST_Z1 - 0.6 && this.vel.z < -0.05) this.level = 'stairs';
      else {
        for (const b of MAIN_BOX) pushBox(p, b, R);
        for (const c of MAIN_CIRC) pushCircle(p, c, R);
        p.x = clamp(p.x, -5.72 + R, 5.72 - R); p.z = clamp(p.z, -14.72 + R, 14.72 - R);
      }
    }
    if (this.level === 'stairs') {
      p.x = clamp(p.x, ST_X0 + 0.2, ST_X1 - 0.2);
      if (p.z > ST_Z1 + 0.05) this.level = 'main';
      else if (p.z < 8.35) this.level = 'upper';     // 계단 윗단 앞 착지 공간(z 8.35~9.05)은 2층 높이
    } else if (this.level === 'upper') {
      if (p.x > ST_X0 + 0.12 && p.x < ST_X1 - 0.12 && p.z > 8.42 && this.vel.z > 0.05) this.level = 'stairs';
      else {
        for (const b of UP_BOX) pushBox(p, b, R);
        for (const c of UP_CIRC) pushCircle(p, c, R);
        p.x = clamp(p.x, -5.6 + R, 5.6 - R); p.z = clamp(p.z, -3.25 + R, 8.82 - R);
      }
    }
    // 층이 바뀌는 순간 공중에 있던 발걸음은 몸 아래 디딤판으로 다시 조준 (계단 입구에서 발이 뒤로 가는 현상 방지)
    if (this.level !== prevLevel && this.swing >= 0 && !this.fixedTo) {
      const f = this.feet[this.swing];
      if (this.level === 'stairs') {
        const z = clamp(this.pos.z, ST_Z0 + 0.01, ST_Z1 - 0.03);
        this.to.set(clamp(f.x, ST_X0 + 0.12, ST_X1 - 0.12), stairY(z), stairCenterZ(z));
      } else this.to.set(f.x, this.level === 'upper' ? UD : MD, this.pos.z);
      this.fixedTo = true;
    }
    // 밀려난 만큼 실제 속도도 줄임 (벽에 미끄러짐)
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (faceYaw !== null) this.yaw = dampAngle(this.yaw, faceYaw, 8, dt);
    else if (this.speed > 0.08) this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), stairs ? 5 : 8, dt);
    p.y = this.floorAt(p.x, p.z);
    this.stepFeet(dt);
  }

  /** 발자국: 지지발은 그대로, 스윙발은 몸보다 조금 앞의 실제 바닥에 내려앉음 · 계단은 stairStep()이 한 칸씩 번갈아 */
  private stepFeet(dt: number) {
    const sp = this.speed, stairs = this.level === 'stairs';
    const lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw);
    const sideOf = (k: number) => (k === 0 ? -1 : 1);
    const target = (k: number, out: THREE.Vector3) => {
      const lead = sp > 0.05 ? clamp(sp * 0.2, 0.07, 0.27) : 0;
      const n = sp > 0.05 ? 1 / sp : 0;
      out.set(this.pos.x + this.vel.x * n * lead + lx * FOOT_W * sideOf(k), 0, this.pos.z + this.vel.z * n * lead + lz * FOOT_W * sideOf(k));
      out.y = this.floorAt(out.x, out.z);
      return out;
    };
    if (this.swing < 0) {
      if (stairs) this.stairStep();
      else {
        // 몸이 지지발에서 멀어지면 다음 발을 뗌
        const tA = target(0, this.to), dA = Math.hypot(tA.x - this.feet[0].x, tA.z - this.feet[0].z) + Math.abs(tA.y - this.feet[0].y) * 2;
        const tB = target(1, V3()), dB = Math.hypot(tB.x - this.feet[1].x, tB.z - this.feet[1].z) + Math.abs(tB.y - this.feet[1].y) * 2;
        const need = sp > 0.05 ? 0.12 : 0.05;
        if (Math.max(dA, dB) > need) {
          this.swing = dA >= dB ? 0 : 1;
          this.from.copy(this.feet[this.swing]);
          this.u = 0; this.fixedTo = false;
          this.dur = sp > 0.05 ? clamp(0.5 - sp * 0.13, 0.3, 0.46) : 0.32;
        }
      }
    }
    if (this.swing >= 0) {
      this.u = Math.min(1, this.u + dt / this.dur);
      // 계단 발걸음은 착지점을 처음에 정해 둠 (몸이 움직여도 발이 미끄러지지 않게)
      const to = this.fixedTo ? this.to : target(this.swing, this.to);
      const e = this.u * this.u * (3 - 2 * this.u);
      const f = this.feet[this.swing];
      f.x = this.from.x + (to.x - this.from.x) * e;
      f.z = this.from.z + (to.z - this.from.z) * e;
      const dy = to.y - this.from.y;
      // 올라갈 땐 발을 먼저 들어 계단 코를 넘고 앞으로, 내려갈 땐 앞으로 내밀었다가 내려 디딤
      const vy = dy > 0.02 ? Math.min(1, this.u * 1.8) : dy < -0.02 ? Math.max(0, (this.u - 0.45) / 0.55) : this.u;
      const lift = this.fixedTo ? 0.05 + Math.max(0, dy) * 0.25 : 0.055;
      f.y = this.from.y + dy * (vy * vy * (3 - 2 * vy)) + Math.sin(Math.PI * this.u) * lift;
      if (this.u >= 1) { f.copy(to); this.swing = -1; this.fixedTo = false; }
    }
    // 골반: 두 발 높이의 평균 위 (계단에선 조금 낮춰 무릎을 굽힘) + 걸음마다 살짝 출렁
    const fy = (this.feet[0].y + this.feet[1].y) / 2;
    const base = Math.max(fy, this.floorAt(this.pos.x, this.pos.z) - 0.05);
    const bob = this.swing >= 0 ? Math.sin(Math.PI * this.u) * 0.018 : 0;
    this.hipY = damp(this.hipY, base + (stairs ? HIP_STAIR : HIP) + bob, 12, dt);
  }

  /**
   * 계단 걸음: 두 발이 번갈아 한 칸씩 (앞선 발보다 한 칸 더 위/아래 디딤판 가운데에)
   *  몸이 앞선 발 위까지 오면 뒷발을 뗌 → 일정한 리듬으로 한 칸씩 오르내림
   */
  private stairStep() {
    const v = this.vel.z;
    if (Math.abs(v) < 0.15) return;   // 확실히 오르거나 내려갈 때만 (방향을 트는 순간엔 기다림)
    const dir = v < 0 ? -1 : 1;                 // -1: 올라감(디딤판 번호 감소) · +1: 내려감
    const idx = (z: number) => z < ST_Z0 ? -1 : z > ST_Z1 - 0.02 ? ST_N : Math.floor((z - ST_Z0) / ST_RUN);
    const i0 = idx(this.feet[0].z), i1 = idx(this.feet[1].z);
    // 진행 방향으로 더 앞선 발 = 지지발, 뒤에 있는 발을 옮김
    const ahead = (dir < 0 ? i0 <= i1 : i0 >= i1) ? 0 : 1;
    const back = 1 - ahead;
    const leadIdx = ahead === 0 ? i0 : i1, lead = this.feet[ahead];
    // 몸이 앞선 발 위(조금 앞)까지 와야 다음 발을 뗌
    if ((this.pos.z - lead.z) * dir < -0.04) return;
    const ti = leadIdx + dir;
    const lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw), side = back === 0 ? -1 : 1;
    const x = clamp(this.pos.x + lx * FOOT_W * side, ST_X0 + 0.12, ST_X1 - 0.12);
    if (ti < 0) this.to.set(x, UD, ST_Z0 - 0.16);                 // 2층 착지
    else if (ti >= ST_N) this.to.set(x, MD, ST_Z1 + 0.16);        // 1층 바닥
    else this.to.set(x, stairY(ST_Z0 + (ti + 0.5) * ST_RUN), ST_Z0 + (ti + 0.5) * ST_RUN);
    void lz;
    // 몸보다 뒤쪽(지나온 칸)으로는 딛지 않음
    if ((this.to.z - this.pos.z) * dir < -0.12) return;
    // 이미 그 자리에 있으면 (계단 끝 착지면에 두 발이 다 있음) 제자리걸음 하지 않음
    if (Math.hypot(this.to.x - this.feet[back].x, this.to.z - this.feet[back].z) < 0.06 && Math.abs(this.to.y - this.feet[back].y) < 0.03) return;
    this.swing = back; this.from.copy(this.feet[back]);
    this.u = 0; this.fixedTo = true;
    this.dur = 0.42;
  }
}

/** 지도용: 판툰 구획 (로컬 xz 사각형) */
export const PLAN = {
  main: [-6, 6, -15, 15] as Box,
  upper: [-5.75, 5.75, -3.4, 9.0] as Box,
  cafe: [-5.6, 1.6, 6.9, 9.0] as Box,
  dining: [-6.0, 1.4, -2.3, 7.3] as Box,
  snorkelPlat: [6.0, 9.5, -2.0, 4.5] as Box,
  divePlat: [-3.0, 3.0, -18.2, -15.0] as Box,
  diveDeck: [-6, 6, -14.8, -5.8] as Box,
  stairs: [ST_X0, ST_X1, ST_Z0, ST_Z1] as Box,
};

// ───────── 탭/클릭 이동: 층별 격자 A* + 계단 경유 ─────────
export interface DeckGoal { x: number; z: number; level: 'main' | 'upper' }
export interface DeckWaypoint { x: number; z: number; final?: boolean }

const GRID = 0.2;
interface Grid { x0: number; z0: number; nx: number; nz: number; free: Uint8Array }
function buildGrid(bounds: Box, boxes: Box[], circles: Circle[], pad: number): Grid {
  const [x0, x1, z0, z1] = bounds;
  const nx = Math.ceil((x1 - x0) / GRID), nz = Math.ceil((z1 - z0) / GRID);
  const free = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) * GRID, z = z0 + (j + 0.5) * GRID;
    let ok = true;
    for (const b of boxes) { const cx = clamp(x, b[0], b[1]), cz = clamp(z, b[2], b[3]); if ((x - cx) ** 2 + (z - cz) ** 2 < pad * pad) { ok = false; break; } }
    if (ok) for (const c of circles) if (Math.hypot(x - c[0], z - c[1]) < c[2] + pad) { ok = false; break; }
    free[j * nx + i] = ok ? 1 : 0;
  }
  return { x0, z0, nx, nz, free };
}
const PAD = R + 0.06;
let gMain: Grid | null = null, gUp: Grid | null = null;
const gridOf = (lv: 'main' | 'upper') => lv === 'main'
  ? (gMain ??= buildGrid([-5.72 + R, 5.72 - R, -14.72 + R, 14.72 - R], MAIN_BOX, MAIN_CIRC, PAD))
  : (gUp ??= buildGrid([-5.6 + R, 5.6 - R, -3.25 + R, 8.82 - R], UP_BOX, UP_CIRC, PAD));

const cellOf = (g: Grid, x: number, z: number): [number, number] => [clamp(Math.floor((x - g.x0) / GRID), 0, g.nx - 1), clamp(Math.floor((z - g.z0) / GRID), 0, g.nz - 1)];
const isFree = (g: Grid, i: number, j: number) => i >= 0 && j >= 0 && i < g.nx && j < g.nz && g.free[j * g.nx + i] === 1;
/** 막힌 칸이면 가장 가까운 빈 칸 */
function nearestFree(g: Grid, i: number, j: number): [number, number] | null {
  if (isFree(g, i, j)) return [i, j];
  for (let r = 1; r < 14; r++) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !isFree(g, i + di, j + dj)) continue;
      const d = di * di + dj * dj; if (d < bd) { bd = d; best = [i + di, j + dj]; }
    }
    if (best) return best;
  }
  return null;
}
function lineFree(g: Grid, ax: number, az: number, bx: number, bz: number) {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (GRID * 0.5));
  for (let k = 0; k <= n; k++) { const u = k / Math.max(n, 1); const [i, j] = cellOf(g, ax + (bx - ax) * u, az + (bz - az) * u); if (!isFree(g, i, j)) return false; }
  return true;
}
/** 같은 층 안에서 a → b 경로 (끝점 포함, 직선으로 펴진 꼭짓점들) · 못 가면 null */
function gridPath(lv: 'main' | 'upper', ax: number, az: number, bx: number, bz: number): { x: number; z: number }[] | null {
  const g = gridOf(lv);
  const s = nearestFree(g, ...cellOf(g, ax, az)), t = nearestFree(g, ...cellOf(g, bx, bz));
  if (!s || !t) return null;
  const end = { x: g.x0 + (t[0] + 0.5) * GRID, z: g.z0 + (t[1] + 0.5) * GRID };
  // 목표 칸이 원래 비어 있으면 누른 지점 그대로
  const [ti, tj] = cellOf(g, bx, bz);
  if (ti === t[0] && tj === t[1]) { end.x = bx; end.z = bz; }
  if (lineFree(g, ax, az, end.x, end.z)) return [end];
  const N = g.nx * g.nz, cost = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const si = s[1] * g.nx + s[0], tIdx = t[1] * g.nx + t[0];
  const open: number[] = [si]; cost[si] = 0;
  const hx = (k: number) => Math.hypot((k % g.nx) - t[0], Math.floor(k / g.nx) - t[1]);
  while (open.length) {
    // 작은 격자(~9000칸)라 선형 탐색으로 충분
    let bi = 0, bf = Infinity;
    for (let k = 0; k < open.length; k++) { const f = cost[open[k]] + hx(open[k]); if (f < bf) { bf = f; bi = k; } }
    const c = open[bi]; open[bi] = open[open.length - 1]; open.pop();
    if (done[c]) continue; done[c] = 1;
    if (c === tIdx) break;
    const ci = c % g.nx, cj = Math.floor(c / g.nx);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (!isFree(g, ni, nj) || (di && dj && (!isFree(g, ci + di, cj) || !isFree(g, ci, cj + dj)))) continue;
      const n = nj * g.nx + ni, nc = cost[c] + (di && dj ? Math.SQRT2 : 1);
      if (nc < cost[n]) { cost[n] = nc; prev[n] = c; open.push(n); }
    }
  }
  if (prev[tIdx] < 0 && tIdx !== si) return null;
  const cells: { x: number; z: number }[] = [];
  for (let k = tIdx; k >= 0 && k !== si; k = prev[k]) cells.push({ x: g.x0 + ((k % g.nx) + 0.5) * GRID, z: g.z0 + (Math.floor(k / g.nx) + 0.5) * GRID });
  cells.reverse(); cells[cells.length - 1] = end;
  // 줄 당기기: 보이는 가장 먼 꼭짓점으로 건너뜀
  const out: { x: number; z: number }[] = [];
  let cx = ax, cz = az, k = 0;
  while (k < cells.length) {
    let far = k;
    for (let m = cells.length - 1; m > k; m--) if (lineFree(g, cx, cz, cells[m].x, cells[m].z)) { far = m; break; }
    out.push(cells[far]); cx = cells[far].x; cz = cells[far].z; k = far + 1;
  }
  return out;
}

const ST_MX = (ST_X0 + ST_X1) / 2;
/** 계단 아래 입구(1층) · 위 착지(2층) */
const ST_FOOT = { x: ST_MX, z: ST_Z1 + 0.45 }, ST_HEAD = { x: ST_MX, z: 8.3 };

/** 지금 위치·층에서 목표까지 웨이포인트 (계단은 디딤판 가운데 줄을 따라) */
export function planDeckPath(m: DeckMover, goal: DeckGoal): DeckWaypoint[] | null {
  const p = m.pos;
  let from: 'main' | 'upper' = m.level === 'upper' ? 'upper' : 'main';
  const pre: DeckWaypoint[] = [];
  if (m.level === 'stairs') {
    // 계단 위: 목표 층 쪽 끝까지 먼저 걸음
    if (goal.level === 'upper') { pre.push({ x: ST_MX, z: ST_Z0 + 0.1 }, ST_HEAD); from = 'upper'; }
    else { pre.push({ x: ST_MX, z: ST_Z1 + 0.35 }); from = 'main'; }
  }
  const sx = pre.length ? pre[pre.length - 1].x : p.x, sz = pre.length ? pre[pre.length - 1].z : p.z;
  let path: DeckWaypoint[] | null;
  if (from === goal.level) path = gridPath(goal.level, sx, sz, goal.x, goal.z);
  else if (from === 'main') {
    const a = gridPath('main', sx, sz, ST_FOOT.x, ST_FOOT.z);
    const b = gridPath('upper', ST_HEAD.x, ST_HEAD.z, goal.x, goal.z);
    path = a && b ? [...a, { x: ST_MX, z: ST_Z1 - 0.2 }, { x: ST_MX, z: ST_Z0 + 0.1 }, ST_HEAD, ...b] : null;
  } else {
    const a = gridPath('upper', sx, sz, ST_HEAD.x, 8.4);
    const b = gridPath('main', ST_FOOT.x, ST_FOOT.z, goal.x, goal.z);
    path = a && b ? [...a, { x: ST_MX, z: 9.3 }, { x: ST_MX, z: ST_Z1 + 0.35 }, ...b] : null;
  }
  if (!path) return null;
  const all = [...pre, ...path];
  all[all.length - 1] = { ...all[all.length - 1], final: true };
  return all;
}

/** 탭한 판툰 로컬 지점 → 걸어갈 목표 (선베드를 누르면 그 선베드) */
export function deckGoalAt(x: number, y: number, z: number): { goal: DeckGoal; lounger: Lounger | null } | null {
  if (Math.abs(x) > 6.3 || Math.abs(z) > 15.2) return null;
  const upper = y > UD - 0.25 && x > -5.75 && x < 5.75 && z > -3.4 && z < 9.0;
  if (upper) {
    for (const l of LOUNGERS) if (Math.abs(x - l.x) < 0.5 && z > l.z - 1.1 && z < l.z + 1.15) { const s = loungerSide(l); return { goal: { x: s.x, z: s.z, level: 'upper' }, lounger: l }; }
    return { goal: { x, z, level: 'upper' }, lounger: null };
  }
  // 계단을 누르면 2층으로
  if (x > ST_X0 - 0.1 && x < ST_X1 + 0.1 && z > ST_Z0 && z < ST_Z1 && y > MD + 0.15) return { goal: { x: ST_HEAD.x, z: ST_HEAD.z - 0.4, level: 'upper' }, lounger: null };
  if (y > UD - 0.6) return null; // 2층 난간 바깥·지붕 등
  return { goal: { x, z, level: 'main' }, lounger: null };
}

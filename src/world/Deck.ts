// 판툰 위 자유 이동: 걸을 수 있는 바닥(1층·계단·2층) + 가구 충돌 + 발 디딤(IK용 발자국)
//  - 1층 메인 데크는 어디든 걸어 다님 (카페·테이블·랙 등은 피해서)
//  - 선수 쪽 계단(14단)을 한 칸씩 밟아 2층 전망 데크로 올라감
//  - 2층 선베드 옆에서 상호작용(F)하면 누워서 쉼
//  - 우현 스노클 존 / 선미 다이빙 데크에 들어가면 체험(시점) 선택
//  좌표는 모두 판툰 로컬 (원점 = 판툰 중앙 수면, +z = 선수, +x = 우현)
import * as THREE from 'three';
import { MD, UD } from './Pontoon';
import { clamp, damp, dampAngle } from '../core/math';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
type Box = [number, number, number, number]; // x0, x1, z0, z1
type Circle = [number, number, number];      // x, z, r

const R = 0.27;               // 몸 반지름
const HIP = 0.9, HIP_STAIR = 0.87;
const FOOT_W = 0.1;

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
    const maxV = stairs ? 0.62 : 1.45;
    const wl = Math.hypot(want.x, want.z);
    if (wl > maxV) want.multiplyScalar(maxV / wl);
    this.vel.x = damp(this.vel.x, want.x, wl > 0.01 ? 7 : 10, dt);
    this.vel.z = damp(this.vel.z, want.z, wl > 0.01 ? 7 : 10, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;

    // 층 전환 + 충돌
    const p = this.pos;
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
    // 밀려난 만큼 실제 속도도 줄임 (벽에 미끄러짐)
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (faceYaw !== null) this.yaw = dampAngle(this.yaw, faceYaw, 8, dt);
    else if (this.speed > 0.08) this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), stairs ? 5 : 8, dt);
    p.y = this.floorAt(p.x, p.z);
    this.stepFeet(dt);
  }

  /** 발자국: 지지발은 그대로, 스윙발은 몸보다 조금 앞의 실제 바닥(계단은 디딤판 가운데)에 내려앉음 */
  private stepFeet(dt: number) {
    const sp = this.speed, stairs = this.level === 'stairs';
    const lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw);
    const sideOf = (k: number) => (k === 0 ? -1 : 1);
    const target = (k: number, out: THREE.Vector3) => {
      const lead = sp > 0.05 ? (stairs ? 0.17 : clamp(sp * 0.26, 0.08, 0.36)) : 0;
      const n = sp > 0.05 ? 1 / sp : 0;
      out.set(this.pos.x + this.vel.x * n * lead + lx * FOOT_W * sideOf(k), 0, this.pos.z + this.vel.z * n * lead + lz * FOOT_W * sideOf(k));
      if (stairs) { out.x = clamp(out.x, ST_X0 + 0.12, ST_X1 - 0.12); out.z = stairCenterZ(out.z); }
      out.y = this.floorAt(out.x, out.z);
      // 계단 위/아래 끝에서 층이 바뀌는 발은 그 층 높이
      if (stairs && out.z >= ST_Z1 - 0.02) out.y = MD;
      return out;
    };
    if (this.swing < 0) {
      // 몸이 지지발에서 멀어지면 다음 발을 뗌
      const tA = target(0, this.to), dA = Math.hypot(tA.x - this.feet[0].x, tA.z - this.feet[0].z) + Math.abs(tA.y - this.feet[0].y) * 2;
      const tB = target(1, V3()), dB = Math.hypot(tB.x - this.feet[1].x, tB.z - this.feet[1].z) + Math.abs(tB.y - this.feet[1].y) * 2;
      const need = sp > 0.05 ? (stairs ? 0.12 : 0.16) : 0.06;
      if (Math.max(dA, dB) > need) {
        this.swing = dA >= dB ? 0 : 1;
        this.from.copy(this.feet[this.swing]);
        this.u = 0;
        this.dur = stairs ? 0.44 : sp > 0.05 ? clamp(0.5 - sp * 0.13, 0.3, 0.46) : 0.32;
      }
    }
    if (this.swing >= 0) {
      this.u = Math.min(1, this.u + dt / this.dur);
      const to = target(this.swing, this.to);
      const e = this.u * this.u * (3 - 2 * this.u);
      const f = this.feet[this.swing];
      f.x = this.from.x + (to.x - this.from.x) * e;
      f.z = this.from.z + (to.z - this.from.z) * e;
      const dy = to.y - this.from.y;
      const vy = dy < 0 ? Math.pow(this.u, 2.2) : Math.sqrt(this.u);   // 내려갈 땐 앞으로 먼저, 올라갈 땐 위로 먼저
      f.y = this.from.y + dy * vy + Math.sin(Math.PI * this.u) * (stairs ? 0.08 : 0.055);
      if (this.u >= 1) { f.copy(to); this.swing = -1; }
    }
    // 골반: 두 발 높이의 평균 위 (계단에선 조금 낮춰 무릎을 굽힘) + 걸음마다 살짝 출렁
    const fy = (this.feet[0].y + this.feet[1].y) / 2;
    const base = Math.max(fy, this.floorAt(this.pos.x, this.pos.z) - 0.05);
    const bob = this.swing >= 0 ? Math.sin(Math.PI * this.u) * 0.018 : 0;
    this.hipY = damp(this.hipY, base + (stairs ? HIP_STAIR : HIP) + bob, 12, dt);
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

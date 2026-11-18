// 발자국 기반 걷기: 경로를 발 디딤 지점으로 나눠 한 발씩 실제 바닥(계단 디딤판)에 딛게 함
//  - 평지: 약 0.26m 간격으로 번갈아 디딤 (아담한 체형 기준)
//  - 계단: 디딤판 하나에 한 발씩 (step-over-step), 내려갈 때는 발이 먼저 앞으로 나간 뒤 아래로 내려앉음
//  - 경로 점마다 기준 좌표계(배·판툰)를 가져서, 흔들리는 배 → 현문 사다리 → 판툰으로 이어 걸어도 발이 미끄러지지 않음
import * as THREE from 'three';
import { HIP_STAND, HIP_STAIR } from '../character/Diver';
import { dampAngle } from '../core/math';

export interface WayPt { frame: THREE.Object3D; p: THREE.Vector3 }
interface Step { seg: number; t: number; stair: boolean }

// 짧은 다리에 맞춘 보폭 (한 걸음 0.26m · 약 0.95m/s)
const FLAT = 0.26, FLAT_T = 0.27, STAIR_T = 0.5;
const HIP_FLAT = HIP_STAND;
const FOOT_W = 0.078;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const ease = (u: number) => u * u * (3 - 2 * u);

export class Walker {
  private steps: Step[] = [];
  private i = 1;
  private u = 0;
  done = false;
  /** 이번 프레임 결과 (월드) */
  pos = new THREE.Vector3();
  yaw = 0;
  feet: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  onStairs = false;
  /** 지금 디디는(지지하는) 경로 구간 — 어느 좌표계 위에 서 있는지 판단용 */
  seg = 0;
  speed = 1;

  constructor(private pts: WayPt[], yaw: number) {
    this.yaw = yaw;
    // 거의 같은 점은 제거
    const clean: WayPt[] = [];
    for (const p of pts) { const last = clean[clean.length - 1]; if (!last || this.w(last, _a).distanceTo(this.w(p, _b)) > 0.04) clean.push(p); }
    this.pts = clean;
    this.steps.push({ seg: 0, t: 0, stair: false });
    for (let k = 0; k < clean.length - 1; k++) {
      const A = this.w(clean[k], _a), B = this.w(clean[k + 1], _b);
      const h = Math.hypot(B.x - A.x, B.z - A.z), dy = B.y - A.y;
      if (Math.abs(dy) > 0.06 && h < 0.6) { this.steps.push({ seg: k, t: 1, stair: true }); continue; }
      const n = Math.max(1, Math.round(h / FLAT));
      for (let j = 1; j <= n; j++) this.steps.push({ seg: k, t: j / n, stair: false });
    }
    // 마지막엔 두 발을 나란히 모음
    const last = this.steps[this.steps.length - 1];
    this.steps.push({ ...last });
    if (this.steps.length < 3) this.done = true;
    this.update(0);
  }

  private w(p: WayPt, out: THREE.Vector3) { return out.copy(p.p).applyMatrix4(p.frame.matrixWorld); }

  /** 발자국 중심 (월드) */
  private center(j: number, out: THREE.Vector3) {
    const s = this.steps[Math.max(0, Math.min(j, this.steps.length - 1))];
    const A = this.w(this.pts[s.seg], _c);
    if (s.seg + 1 >= this.pts.length) return out.copy(A);
    const B = this.w(this.pts[s.seg + 1], _d);
    return out.copy(A).lerp(B, s.t);
  }
  /** 그 발자국이 놓인 진행 방향 */
  private dirAt(j: number) {
    const s = this.steps[Math.max(0, Math.min(j, this.steps.length - 1))];
    const k = Math.min(s.seg, this.pts.length - 2);
    if (k < 0) return this.yaw;
    const A = this.w(this.pts[k], _c), B = this.w(this.pts[k + 1], _d);
    return Math.atan2(B.x - A.x, B.z - A.z);
  }
  /** j번째 발자국의 실제 발 위치: 왼발(짝수)·오른발(홀수)을 진행 방향 좌우로 벌림 */
  private foot(j: number, out: THREE.Vector3) {
    const jj = Math.max(-1, j);
    this.center(Math.max(0, jj), out);
    const yaw = this.dirAt(Math.max(0, jj));
    const side = ((jj % 2) + 2) % 2 === 0 ? -1 : 1; // 짝수 = feet[0] = 캐릭터의 hipL 쪽 (로컬 -x)
    out.x += Math.cos(yaw) * FOOT_W * side;
    out.z += -Math.sin(yaw) * FOOT_W * side;
    return out;
  }

  update(dt: number) {
    const N = this.steps.length;
    if (!this.done) {
      const st = this.steps[Math.min(this.i, N - 1)];
      const dur = (st.stair ? STAIR_T : FLAT_T) / this.speed;
      this.u += dt / dur;
      while (this.u >= 1 && !this.done) {
        this.u -= 1; this.i++;
        if (this.i >= N) { this.i = N - 1; this.u = 1; this.done = true; }
      }
    }
    const i = this.i, u = this.done ? 1 : this.u;
    const st = this.steps[i];
    this.onStairs = st.stair || this.steps[Math.max(0, i - 1)].stair || (this.steps[i + 1]?.stair ?? false);
    this.seg = this.steps[Math.max(0, i - 1)].seg;
    // 디딤발(지지)·스윙발
    const swing = ((i % 2) + 2) % 2;            // 0 = 왼발이 움직이는 중
    const sup = 1 - swing;
    this.foot(i - 1, this.feet[sup]);
    const from = this.foot(i - 2, new THREE.Vector3()), to = this.foot(i, new THREE.Vector3());
    const ue = ease(u);
    const f = this.feet[swing];
    f.x = from.x + (to.x - from.x) * ue;
    f.z = from.z + (to.z - from.z) * ue;
    const dy = to.y - from.y;
    // 올라갈 땐 발을 먼저 들어 디딤판 코를 넘고, 내려갈 땐 앞으로 내밀었다가 내려 디딤
    const vr = dy > 0.02 ? Math.min(1, u * 1.8) : dy < -0.02 ? Math.max(0, (u - 0.45) / 0.55) : u;
    const vy = vr * vr * (3 - 2 * vr);
    const lift = (st.stair ? 0.05 + Math.max(0, dy) * 0.25 : 0.045) * Math.sin(Math.PI * u) * (from.distanceTo(to) > 0.05 ? 1 : 0);
    f.y = from.y + dy * vy + lift;
    // 골반: 디딤발 위 → 다음 발자국 위로 이동 (계단에선 부드럽게 가라앉음)
    const c0 = this.center(i - 1, new THREE.Vector3()), c1 = this.center(i, new THREE.Vector3());
    const k = st.stair ? ue : u;
    this.pos.lerpVectors(c0, c1, k);
    const hip = st.stair || this.onStairs ? HIP_STAIR : HIP_FLAT;
    this.pos.y = c0.y + (c1.y - c0.y) * ue + hip + Math.cos(u * Math.PI * 2) * 0.012;
    const hx = c1.x - c0.x, hz = c1.z - c0.z;
    if (hx * hx + hz * hz > 1e-4) this.yaw = dampAngle(this.yaw, Math.atan2(hx, hz), 7, Math.max(dt, 0.016));
  }
}

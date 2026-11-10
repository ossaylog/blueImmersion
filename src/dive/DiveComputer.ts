// 다이브 컴퓨터 시뮬레이션 (가상 체험용 — 실제 다이빙 계획에 사용 불가)
//  수심 = 캐릭터 실제 y, 잔압 = SAC 기반 소모, NDL = 8구획 Bühlmann ZHL-16C(질소) 단순화 모델
export interface DiveReadout {
  depth: number; maxDepth: number; time: number; pressure: number; temp: number;
  rate: number;           // m/min, + 상승
  ndl: number;            // 분
  heading: number;        // 도
  safetyStop: number;     // 남은 초 (-1: 해당 없음)
  safetyDone: boolean;
  lowAir: boolean;
  fastAscent: boolean;
}

const HT = [5, 8, 12.5, 18.5, 27, 38.3, 54.3, 77];
const A = [1.1696, 1.0, 0.8618, 0.7562, 0.62, 0.5043, 0.441, 0.4];
const B = [0.5578, 0.6514, 0.7222, 0.7825, 0.8126, 0.8434, 0.8693, 0.891];
const GF = 0.85;
const WV = 0.0627; // 폐포 수증기압 (bar)

export class DiveComputer {
  r: DiveReadout = this.fresh();
  private tissues = HT.map(() => 0.79 * (1 - WV));
  private lastDepth = 0;
  private rateSmoothed = 0;
  private safetyLeft = 180;
  private tankL = 12;     // 12L 알루미늄 탱크
  private sac = 15;       // 표면 공기 소비율 L/min (편안한 다이버)

  private fresh(): DiveReadout {
    return { depth: 0, maxDepth: 0, time: 0, pressure: 200, temp: 27.5, rate: 0, ndl: 99, heading: 0, safetyStop: -1, safetyDone: false, lowAir: false, fastAscent: false };
  }
  reset() { this.r = this.fresh(); this.tissues = HT.map(() => 0.79 * (1 - WV)); this.safetyLeft = 180; this.lastDepth = 0; this.rateSmoothed = 0; }

  update(dt: number, depth: number, headingRad: number) {
    const r = this.r;
    depth = Math.max(0, depth);
    r.depth = depth;
    r.maxDepth = Math.max(r.maxDepth, depth);
    if (depth > 0.8 || r.time > 0) r.time += dt;
    const P = 1 + depth / 10;
    // 공기 소모: 수심이 깊을수록 압축 공기를 더 많이 사용
    r.pressure = Math.max(30, r.pressure - (this.sac * P / this.tankL) * dt / 60);
    r.lowAir = r.pressure < 70;
    r.temp = 27.5 - Math.min(depth, 40) * 0.08;
    // 상승 속도
    const inst = ((this.lastDepth - depth) / Math.max(dt, 1e-3)) * 60;
    this.lastDepth = depth;
    this.rateSmoothed += (inst - this.rateSmoothed) * Math.min(1, dt * 2);
    r.rate = this.rateSmoothed;
    r.fastAscent = r.rate > 23;
    // 조직 질소 포화
    const pin = 0.79 * (P - WV);
    let ndl = 99;
    for (let i = 0; i < HT.length; i++) {
      const k = Math.LN2 / HT[i];
      this.tissues[i] = pin + (this.tissues[i] - pin) * Math.exp(-k * dt / 60);
      const M = (1 / B[i] + A[i] - 1) * GF + 1; // 수면(1 bar)에서 허용 분압 (GF 적용)
      if (pin > M) {
        const p0 = this.tissues[i];
        const t = p0 >= M ? 0 : -Math.log((M - pin) / (p0 - pin)) / k;
        ndl = Math.min(ndl, t);
      }
    }
    r.ndl = Math.max(0, Math.min(99, ndl));
    // 위에서 볼 때 시계 방향으로 커지는 실제 나침반 (판툰 선수 쪽 +z = 북, 지도와 같은 방향)
    r.heading = ((-headingRad * 180 / Math.PI) % 360 + 360) % 360;
    // 안전 정지: 10m 이상 내려갔다면 5m(3~6.5m)에서 3분
    if (r.maxDepth >= 10 && !r.safetyDone) {
      if (depth >= 3 && depth <= 6.5) {
        this.safetyLeft -= dt;
        if (this.safetyLeft <= 0) { r.safetyDone = true; r.safetyStop = 0; }
        else r.safetyStop = this.safetyLeft;
      } else r.safetyStop = depth < 3 ? -1 : this.safetyLeft;
    } else if (!r.safetyDone) r.safetyStop = -1;
    return r;
  }
}

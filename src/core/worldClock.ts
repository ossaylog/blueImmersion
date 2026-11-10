// 모든 접속자가 공유하는 '바다 시계' (초)
//  기기마다 Date.now()가 조금씩 다르므로, 멀티 서버에 접속하면 서버 시각과의 차이(오프셋)를 재서 보정.
//  같은 시계 + 같은 규칙(시드 난수) → 모든 사람이 같은 시각, 같은 위치에서 같은 생물을 봄.
const EPOCH = 1767225600; // 2026-01-01 UTC (값을 작게 유지해 소수점 정밀도 확보)
let offsetMs = 0;
let bestRtt = Infinity;
let synced = false;

/** 서버 시각 표본: c = 보낸 시각(로컬), s = 서버 시각, now = 받은 시각(로컬). RTT가 가장 짧은 표본을 신뢰 */
export function clockSample(c: number, s: number, now = Date.now()) {
  const rtt = now - c;
  if (rtt < 0 || rtt > 5000) return;
  // 오래된 최적 표본은 조금씩 신뢰를 낮춤 (네트워크 경로가 바뀌는 경우)
  bestRtt = Math.min(bestRtt * 1.15 + 5, 5000);
  if (rtt <= bestRtt) {
    const next = s + rtt / 2 - now;
    // 큰 점프는 즉시, 작은 차이는 부드럽게
    offsetMs = !synced || Math.abs(next - offsetMs) > 400 ? next : offsetMs + (next - offsetMs) * 0.5;
    bestRtt = rtt; synced = true;
  }
}

/** 공유 바다 시각 (초) */
export function worldNow() { return (Date.now() + offsetMs) / 1000 - EPOCH; }
export function clockInfo() { return { offsetMs: Math.round(offsetMs), rtt: Math.round(bestRtt), synced }; }

// 지도: 화면 오른쪽 작은 원형 미니맵 + 눌러서 여는 전체 지도(리프 전체 · 판툰 안내도)
//  방향: 위 = 북(판툰 선수, +z) · 오른쪽 = 동(−x) — 캐릭터가 북쪽을 볼 때 오른쪽에 있는 것이 지도에서도 오른쪽
import { heightAt, coralDensity, seagrass } from '../world/terrain';
import { PLAN, LOUNGERS, ZONES } from '../world/Deck';

export interface MapMark { x: number; z: number; yaw?: number; nick?: string; hue?: number; mode?: string; under?: boolean; upper?: boolean }
export interface MapState {
  me: MapMark & { yaw: number; depth: number; onPontoon: boolean };
  peers: MapMark[];
  boat: { x: number; z: number; yaw: number } | null;
}

const WORLD_R = 100;          // 전체 지도 반경 (m)
const BOUND_R = 95;           // 체험 경계
const MINI_R = 32;            // 미니맵 반경 (m)

type Box = [number, number, number, number];

function depthColor(d: number): [number, number, number] {
  // 얕은 청록 → 깊은 남색
  const stops: [number, [number, number, number]][] = [
    [0, [150, 232, 220]], [3, [92, 208, 214]], [8, [46, 166, 196]], [15, [22, 112, 160]], [25, [12, 66, 116]], [40, [6, 32, 70]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [d0, c0] = stops[i], [d1, c1] = stops[i + 1];
    if (d <= d1) { const u = Math.max(0, (d - d0) / (d1 - d0)); return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u]; }
  }
  return stops[stops.length - 1][1];
}

/** 바닥 수심 + 산호·해초 + 5m 등심선을 한 번만 그려 둔 배경 */
function buildBase(px: number) {
  const cv = document.createElement('canvas'); cv.width = cv.height = px;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(px, px);
  const dep = new Float32Array(px * px);
  for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
    const x = -((i + 0.5) / px * 2 - 1) * WORLD_R, z = -((j + 0.5) / px * 2 - 1) * WORLD_R;
    dep[j * px + i] = -heightAt(x, z);
  }
  for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
    const x = -((i + 0.5) / px * 2 - 1) * WORLD_R, z = -((j + 0.5) / px * 2 - 1) * WORLD_R;
    const d = dep[j * px + i];
    let [r, gg, b] = depthColor(d);
    const c = coralDensity(x, z), s = seagrass(x, z);
    // 산호: 따뜻한 점묘 · 해초: 초록빛
    const speck = ((i * 73856093) ^ (j * 19349663)) & 7;
    if (c > 0.45 && d < 28 && speck < 3) { const k = Math.min(1, (c - 0.45) * 2) * 0.55; r += (236 - r) * k; gg += (150 - gg) * k; b += (120 - b) * k; }
    if (s > 0.25) { const k = Math.min(1, s) * 0.5; r += (70 - r) * k; gg += (160 - gg) * k; b += (90 - b) * k; }
    // 등심선 (5m 간격)
    const band = Math.floor(d / 5);
    const nb = i + 1 < px ? Math.floor(dep[j * px + i + 1] / 5) : band, nd = j + 1 < px ? Math.floor(dep[(j + 1) * px + i] / 5) : band;
    if (band !== nb || band !== nd) { r = r * 0.78 + 255 * 0.22; gg = gg * 0.78 + 255 * 0.22; b = b * 0.78 + 255 * 0.22; }
    const o = (j * px + i) * 4;
    img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return cv;
}

export class MapView {
  mini: HTMLCanvasElement;
  overlay: HTMLDivElement;
  private big: HTMLCanvasElement;
  private plan: HTMLCanvasElement;
  private base: HTMLCanvasElement | null = null;
  private last: MapState | null = null;
  private miniT = 0;
  isOpen = false;

  constructor(hudRoot: HTMLElement, uiRoot: HTMLElement) {
    this.mini = document.createElement('canvas');
    this.mini.id = 'minimap'; this.mini.className = 'pe'; this.mini.title = '지도 열기 (M)';
    hudRoot.appendChild(this.mini);
    this.mini.addEventListener('click', () => this.open());
    this.overlay = document.createElement('div');
    this.overlay.id = 'mapView';
    this.overlay.innerHTML = `<div class="panel glass">
      <header><div><div class="k">REEF MAP</div><h3>리프 지도</h3></div><button class="btn small" data-close>닫기</button></header>
      <div class="maps"><figure><canvas class="world"></canvas><figcaption>리프 전체 · 위쪽이 북(판툰 선수)</figcaption></figure>
      <figure><canvas class="plan"></canvas><figcaption>판툰 안내도 · 1층 / 2층</figcaption></figure></div>
      <ul class="legend">
        <li><i class="me"></i>나</li><li><i class="peer"></i>다른 다이버</li><li><i class="sn"></i>스노클 존</li><li><i class="sc"></i>다이빙 데크</li>
        <li><i class="coral"></i>산호</li><li><i class="grass"></i>해초</li><li><i class="line"></i>등심선 5m</li><li><i class="bound"></i>체험 범위</li>
      </ul></div>`;
    uiRoot.appendChild(this.overlay);
    this.big = this.overlay.querySelector('canvas.world')!;
    this.plan = this.overlay.querySelector('canvas.plan')!;
    this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay || (e.target as HTMLElement).closest('[data-close]')) this.close(); });
  }

  private ensureBase() { if (!this.base) this.base = buildBase(220); return this.base; }

  open() { this.isOpen = true; this.overlay.classList.add('show'); this.draw(); }
  close() { this.isOpen = false; this.overlay.classList.remove('show'); }
  toggle() { if (this.isOpen) this.close(); else this.open(); }
  setMiniVisible(v: boolean) { this.mini.classList.toggle('show', v); }

  update(st: MapState, dt: number) {
    this.last = st;
    this.miniT -= dt;
    if (this.miniT <= 0 && this.mini.classList.contains('show')) { this.miniT = 0.12; this.drawMini(); }
    if (this.isOpen) this.draw();
  }

  // ───────── 그리기 공통 ─────────
  /** 월드(x, z) → 캔버스 픽셀 (오른쪽 = −x, 위 = +z) */
  private proj(cx: number, cz: number, scale: number, w: number, h: number) {
    return (x: number, z: number): [number, number] => [w / 2 - (x - cx) * scale, h / 2 - (z - cz) * scale];
  }
  private rect(g: CanvasRenderingContext2D, P: (x: number, z: number) => [number, number], b: Box) {
    const [ax, ay] = P(b[0], b[3]), [bx, by] = P(b[1], b[2]);
    g.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
  }
  private pontoon(g: CanvasRenderingContext2D, P: (x: number, z: number) => [number, number], detail: boolean) {
    const fill = (b: Box, c: string) => { g.beginPath(); this.rect(g, P, b); g.fillStyle = c; g.fill(); };
    fill(PLAN.snorkelPlat, '#f2d15a'); fill(PLAN.divePlat, '#6fa8dc');
    fill(PLAN.main, '#f4f4ef');
    if (detail) {
      fill(PLAN.diveDeck, '#bcd6de'); fill(PLAN.dining, '#d9c3a3'); fill(PLAN.cafe, '#2f8f96');
    }
    g.beginPath(); this.rect(g, P, PLAN.upper); g.strokeStyle = 'rgba(20,50,80,0.55)'; g.lineWidth = 1; g.setLineDash([3, 2]); g.stroke(); g.setLineDash([]);
  }
  private arrow(g: CanvasRenderingContext2D, x: number, y: number, yaw: number, size: number, color: string) {
    // yaw: atan2(dx, dz) · 화면에서 +z = 위, +x = 왼쪽
    const a = Math.atan2(-Math.sin(yaw), Math.cos(yaw)); // 화면 각 (위=0, 시계방향 +)
    g.save(); g.translate(x, y); g.rotate(a);
    g.beginPath(); g.moveTo(0, -size); g.lineTo(size * 0.7, size * 0.75); g.lineTo(0, size * 0.35); g.lineTo(-size * 0.7, size * 0.75); g.closePath();
    g.fillStyle = color; g.fill(); g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,20,30,0.85)'; g.stroke();
    g.restore();
  }
  private dot(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = color; g.fill(); g.lineWidth = 1.2; g.strokeStyle = 'rgba(0,20,30,0.8)'; g.stroke();
  }
  private label(g: CanvasRenderingContext2D, text: string, x: number, y: number, size = 11, color = '#fff') {
    g.font = `600 ${size}px "Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,25,40,0.75)'; g.strokeText(text, x, y);
    g.fillStyle = color; g.fillText(text, x, y);
  }
  private sizeCanvas(cv: HTMLCanvasElement) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { w, h, dpr };
  }
  private peerColor(p: MapMark) { return `hsl(${Math.round((p.hue ?? 0.1) * 360)},80%,62%)`; }

  // ───────── 미니맵 ─────────
  private drawMini() {
    const st = this.last; if (!st) return;
    const { w, h, dpr } = this.sizeCanvas(this.mini);
    const g = this.mini.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.save();
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2); g.clip();
    const s = (w / 2) / MINI_R;
    const base = this.ensureBase();
    const bs = base.width / (2 * WORLD_R);
    // 배경을 내 위치 중심으로 잘라 그림
    const cxPx = (-st.me.x + WORLD_R) * bs, czPx = (-st.me.z + WORLD_R) * bs;
    const half = MINI_R * bs;
    g.imageSmoothingEnabled = true;
    g.drawImage(base, cxPx - half, czPx - half, half * 2, half * 2, 0, 0, w, h);
    const P = this.proj(st.me.x, st.me.z, s, w, h);
    // 체험 경계
    g.beginPath(); const [ox, oy] = P(0, 0); g.arc(ox, oy, BOUND_R * s, 0, Math.PI * 2); g.setLineDash([4 * dpr, 4 * dpr]); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.2 * dpr; g.stroke(); g.setLineDash([]);
    if (st.boat) this.boatShape(g, P, st.boat, s);
    this.pontoon(g, P, false);
    for (const p of st.peers) { const [x, y] = P(p.x, p.z); this.dot(g, x, y, 3.6 * dpr, this.peerColor(p)); }
    const [mx, my] = P(st.me.x, st.me.z);
    this.arrow(g, mx, my, st.me.yaw, 7 * dpr, '#5fe0e6');
    g.restore();
    // 테두리 + 북쪽 표시
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.5 * dpr; g.stroke();
    this.label(g, 'N', w / 2, 9 * dpr, 10 * dpr, '#ffd36b');
    // 판툰까지 거리 (멀리 있을 때)
    const dist = Math.hypot(st.me.x, st.me.z);
    if (!st.me.onPontoon && dist > MINI_R * 0.85) {
      const dx = -(0 - st.me.x), dz = 0 - st.me.z; // 화면 방향: 오른쪽 = −x
      const l = Math.hypot(dx, dz);
      const ex = w / 2 + (dx / l) * (w / 2 - 12 * dpr), ey = h / 2 - (dz / l) * (h / 2 - 12 * dpr);
      this.label(g, '⛵', ex, ey, 12 * dpr);
    }
    this.label(g, st.me.onPontoon ? '판툰' : st.me.depth > 0.4 ? `${st.me.depth.toFixed(1)}m · 판툰 ${Math.round(dist)}m` : `판툰 ${Math.round(dist)}m`, w / 2, h - 11 * dpr, 9.5 * dpr);
  }
  private boatShape(g: CanvasRenderingContext2D, P: (x: number, z: number) => [number, number], b: { x: number; z: number; yaw: number }, s: number) {
    const c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
    const pts: [number, number][] = [[0, 7], [1.9, 4], [2.1, -6.5], [-2.1, -6.5], [-1.9, 4]];
    g.beginPath();
    pts.forEach(([lx, lz], i) => { const x = b.x + lx * c + lz * sn, z = b.z - lx * sn + lz * c; const [px, py] = P(x, z); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
    g.closePath(); g.fillStyle = '#e9eef0'; g.fill(); g.lineWidth = Math.max(1, s * 0.15); g.strokeStyle = '#2b5f86'; g.stroke();
  }

  // ───────── 전체 지도 ─────────
  private draw() {
    const st = this.last; if (!st) return;
    this.drawWorld(st);
    this.drawPlan(st);
  }
  private drawWorld(st: MapState) {
    const { w, h, dpr } = this.sizeCanvas(this.big);
    const g = this.big.getContext('2d')!;
    const s = Math.min(w, h) / (2 * WORLD_R);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#05203a'; g.fillRect(0, 0, w, h);
    const base = this.ensureBase();
    const side = 2 * WORLD_R * s;
    g.drawImage(base, w / 2 - side / 2, h / 2 - side / 2, side, side);
    const P = this.proj(0, 0, s, w, h);
    // 수심 숫자 몇 곳
    for (const [x, z] of [[0, 40], [0, -45], [40, 0], [-40, 0], [60, 60], [-60, -60], [60, -60], [-60, 60], [0, 80], [0, -80]] as [number, number][]) {
      const [px, py] = P(x, z); this.label(g, `${Math.round(-heightAt(x, z))}m`, px, py, 9.5 * dpr, 'rgba(255,255,255,0.75)');
    }
    g.beginPath(); const [ox, oy] = P(0, 0); g.arc(ox, oy, BOUND_R * s, 0, Math.PI * 2);
    g.setLineDash([6 * dpr, 5 * dpr]); g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.4 * dpr; g.stroke(); g.setLineDash([]);
    { const [lx, ly] = P(0, -BOUND_R + 4); this.label(g, '체험 범위 95m', lx, ly, 10 * dpr, 'rgba(255,255,255,0.8)'); }
    // 계류 체인
    g.strokeStyle = 'rgba(40,40,40,0.6)'; g.lineWidth = 1 * dpr;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const [a, b] = P(sx * 5.7, sz * 14.5), [c, d] = P(sx * 20, sz * 32); g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); this.dot(g, c, d, 2 * dpr, '#888'); }
    if (st.boat) this.boatShape(g, P, st.boat, s);
    this.pontoon(g, P, true);
    { const [lx, ly] = P(0, 21); this.label(g, '리프 판툰', lx, ly, 12 * dpr); }
    { const [lx, ly] = P(9, 1); this.label(g, '스노클 입수', lx - 26 * dpr, ly, 10 * dpr, '#ffe28a'); }
    { const [lx, ly] = P(0, -19.5); this.label(g, '다이빙 플랫폼', lx, ly + 8 * dpr, 10 * dpr, '#cfe6ff'); }
    for (const p of st.peers) {
      const [x, y] = P(p.x, p.z); this.dot(g, x, y, 4.5 * dpr, this.peerColor(p));
      if (p.nick) this.label(g, p.nick, x, y - 12 * dpr, 10 * dpr);
    }
    const [mx, my] = P(st.me.x, st.me.z);
    this.arrow(g, mx, my, st.me.yaw, 9 * dpr, '#5fe0e6');
    this.label(g, '나', mx, my - 15 * dpr, 11 * dpr, '#5fe0e6');
    // 나침반 + 축척
    this.label(g, 'N ▲', w - 26 * dpr, 18 * dpr, 12 * dpr, '#ffd36b');
    const bar = 20 * s;
    g.fillStyle = '#fff'; g.fillRect(14 * dpr, h - 18 * dpr, bar, 3 * dpr);
    this.label(g, '20m', 14 * dpr + bar / 2, h - 28 * dpr, 10 * dpr);
  }
  /** 판툰 안내도: 왼쪽 1층(메인 데크), 오른쪽 2층(전망 데크) */
  private drawPlan(st: MapState) {
    const { w, h, dpr } = this.sizeCanvas(this.plan);
    const g = this.plan.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0b3554'; g.fillRect(0, 0, w, h);
    const colW = w / 2;
    const s = Math.min((colW - 20 * dpr) / 21, (h - 40 * dpr) / 38);
    const floors: { name: string; cx: number; upper: boolean }[] = [{ name: '1층 메인 데크', cx: colW / 2, upper: false }, { name: '2층 전망 데크', cx: colW * 1.5, upper: true }];
    for (const f of floors) {
      const P = (x: number, z: number): [number, number] => [f.cx - x * s, h / 2 + 8 * dpr - z * s];
      const fill = (b: Box, c: string, stroke = false) => { g.beginPath(); this.rect(g, P, b); g.fillStyle = c; g.fill(); if (stroke) { g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; g.stroke(); } };
      this.label(g, f.name, f.cx, 14 * dpr, 12 * dpr);
      if (!f.upper) {
        fill(PLAN.snorkelPlat, '#f2d15a'); fill(PLAN.divePlat, '#6fa8dc');
        fill(PLAN.main, '#f4f4ef', true);
        fill(ZONES.scuba, 'rgba(111,168,220,0.55)'); fill(ZONES.snorkel, 'rgba(242,209,90,0.6)');
        fill(PLAN.dining, '#d9c3a3'); fill(PLAN.cafe, '#2f8f96'); fill(PLAN.stairs, '#9aa9b0');
        const L = (t: string, x: number, z: number, c = '#13304f', sz = 10) => { const [px, py] = P(x, z); g.font = `700 ${sz * dpr}px "Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = c; g.fillText(t, px, py); };
        L('카페', -2, 8, '#fff'); L('식당', -2.3, 2.5); L('스노클', 5.1, 4, '#5a4300', 9); L('존', 5.1, 2.8, '#5a4300', 9);
        L('다이빙 데크', 0, -10.5, '#0d3a66'); L('계단↑', 4.2, 11, '#253238', 9); L('현문', -4.2, -4.1, '#7a5a00', 9);
        L('입수', 7.8, 0.5, '#5a4300', 9); L('입수', 0, -17, '#0d3a66', 9);
        L('파라솔', -2.6, 12.6, '#5b4a35', 9);
      } else {
        fill(PLAN.main, 'rgba(244,244,239,0.18)');
        fill(PLAN.upper, '#eef1ef', true);
        fill(PLAN.stairs, '#9aa9b0');
        for (const l of LOUNGERS) fill([l.x - 0.35, l.x + 0.35, l.z - 0.95, l.z + 0.95], '#20607f');
        const [px, py] = P(0, 5.6); this.label(g, '선베드 · 전망', px, py, 10 * dpr, '#13304f');
        const [qx, qy] = P(4.2, 11); this.label(g, '계단↓', qx, qy, 9 * dpr, '#cfe6ff');
      }
      // 판툰 위 사람들
      for (const p of st.peers) if (Math.abs(p.x) < 12 && Math.abs(p.z) < 22 && !p.under && !!p.upper === f.upper) { const [x, y] = P(p.x, p.z); this.dot(g, x, y, 4 * dpr, this.peerColor(p)); }
      if (st.me.onPontoon && !!st.me.upper === f.upper) { const [x, y] = P(st.me.x, st.me.z); this.arrow(g, x, y, st.me.yaw, 8 * dpr, '#5fe0e6'); }
    }
    g.strokeStyle = 'rgba(255,255,255,0.15)'; g.beginPath(); g.moveTo(colW, 26 * dpr); g.lineTo(colW, h - 8 * dpr); g.stroke();
  }
}

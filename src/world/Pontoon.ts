// 리프 판툰 (Reef Pontoon)
//  호주 그레이트배리어리프의 대형 계류 판툰처럼 리프 한가운데 체인으로 고정된 2층 부유 시설.
//  배는 판툰 좌현에 계류하고, 현문 사다리(갱웨이)를 걸쳐 넘어옴. 모든 유저는 같은 판툰에서 대기·장비 착용·입수.
//   - 메인 데크(MD): 카페·식당(테이블), 스노클 장비 랙, 다이빙 데크(탱크 랙·벤치), 수중 전망대 입구
//   - 상부 데크(UD): 선베드·그늘막 (전망)
//   - 우현: 넓은 계단 → 스노클 플랫폼 → 물속까지 이어지는 입수 계단 (손잡이 3줄)
//   - 선미: 다이빙 플랫폼 (계단 + 사다리 + 자이언트 스트라이드 입수 지점)
//  좌표는 판툰 로컬 (원점 = 판툰 중앙 수면, +z = 선수, +x = 우현)
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchWater } from '../water/WaterShading';
import { heightAt } from './terrain';

export const MD = 1.1;    // 메인 데크 바닥 높이
export const UD = 3.9;    // 상부 데크 바닥 높이
export const SP = 0.3;    // 스노클·다이빙 플랫폼 높이
const HX = 6, HZ = 15;    // 메인 데크 반폭·반길이
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export interface Seat { c: THREE.Vector3; yaw: number; lane: number }
export interface Spot { p: THREE.Vector3; yaw: number }

/** 갑판 통로 (가구를 피해 걷는 길) */
export const WALK_X = 0.9;       // 식당 동쪽 가운데 통로
export const STAR_X = 4.95;      // 우현 통로 (스노클 장비 랙 앞)
export const MAIN_LANE = -4.1;   // 현문(좌현) ↔ 우현을 가로지르는 통로
/** 현문 사다리가 걸리는 판툰 쪽 경첩 */
export const HINGE = V3(-5.85, MD, MAIN_LANE);

const TABLE_X = [-3.9, -1.1], TABLE_Z = [4.4, 1.9, -0.6];
/** 식당 의자 (대기 자리): c = 의자 중심 바닥점, yaw = 앉아서 보는 방향(테이블 쪽), lane = 의자로 들어오는 통로 z */
export const SEATS: Seat[] = [];
for (const tx of TABLE_X) for (const tz of TABLE_Z) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  SEATS.push({ c: V3(tx + sx * 0.95, MD, tz + sz * 0.35), yaw: sx < 0 ? Math.PI / 2 : -Math.PI / 2, lane: tz + sz * 1.25 });
}
/** 스노클 장비 랙 앞 (마스크·스노클 착용) */
export const SNORKEL_SPOTS: Spot[] = [5.3, 6.5, 7.7].map((z) => ({ p: V3(STAR_X, MD, z), yaw: Math.PI / 2 }));
/** 다이빙 데크 벤치 앞 (슈트·BCD·탱크 착용) */
export const SCUBA_SPOTS: Spot[] = [-9.0, -10.6, -12.2].map((z) => ({ p: V3(-4.05, MD, z), yaw: -Math.PI / 2 }));
/** 스노클 입수 계단의 두 레인 (가운데 손잡이 양쪽) */
export const SNORKEL_LANES = [0.9, 2.1];
/** 다이빙 플랫폼 계단의 두 레인 */
export const SCUBA_LANES = [-0.5, 0.5];

// ───────── 경로 (판툰 로컬 바닥점) ─────────
/** 스노클: 장비 랙 → 우현 계단 3단 → 플랫폼 → 물속 계단 2단 (정강이까지 물) */
export function routeSnorkelEntry(sp: Spot, lz: number) {
  return [sp.p.clone(), V3(STAR_X, MD, lz), V3(5.8, MD, lz),
    V3(6.15, 0.9, lz), V3(6.45, 0.7, lz), V3(6.75, 0.5, lz), V3(7.1, SP, lz),
    V3(8.4, SP, lz), V3(8.75, 0.05, lz), V3(9.05, -0.2, lz)];
}
/** 물속 계단에 앉는 자리 (오리발 착용) */
export const snorkelSeat = (lz: number) => ({ root: V3(8.8, 0.17, lz), feet: V3(9.33, -0.45, lz) });
export const snorkelFloat = (lz: number) => V3(11.2, -0.2, lz);
/** 스쿠버: 벤치 → 선미 계단 3단 → 다이빙 플랫폼 끝 */
export function routeScubaEntry(sp: Spot, lx: number) {
  return [sp.p.clone(), V3(-3.3, MD, sp.p.z), V3(lx, MD, -14.7),
    V3(lx, 0.9, -15.15), V3(lx, 0.7, -15.45), V3(lx, 0.5, -15.75), V3(lx, SP, -16.15), V3(lx, SP, -17.75)];
}
export const scubaEntry = (lx: number) => V3(lx, -0.6, -19.5);

// ───────── 지오메트리 묶음 (재질별로 합쳐 드로 콜 절약) ─────────
const Y = new THREE.Vector3(0, 1, 0);
class Batch {
  private map = new Map<THREE.Material, THREE.BufferGeometry[]>();
  base = new THREE.Matrix4();
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  put(g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, q?: THREE.Quaternion) {
    if (q) this.q.copy(q); else this.q.setFromEuler(this.e.set(rx, ry, rz));
    this.m.compose(V3(x, y, z), this.q, V3(1, 1, 1)).premultiply(this.base);
    g.applyMatrix4(this.m);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.index) g = toIndexed(g);
    let l = this.map.get(mat); if (!l) this.map.set(mat, (l = []));
    l.push(g);
  }
  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) { this.put(new THREE.BoxGeometry(w, h, d), mat, x, y, z, 0, ry, 0); }
  cyl(mat: THREE.Material, r: number, h: number, x: number, y: number, z: number, seg = 12, rTop = r) { this.put(new THREE.CylinderGeometry(rTop, r, h, seg), mat, x, y, z); }
  /** 두 점을 잇는 원기둥 (기둥·난간·사다리) */
  rod(mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8) {
    const d = b.clone().sub(a); const len = d.length();
    if (len < 1e-3) return;
    const q = new THREE.Quaternion().setFromUnitVectors(Y, d.divideScalar(len));
    const mid = a.clone().add(b).multiplyScalar(0.5);
    this.put(new THREE.CylinderGeometry(r, r, len, seg, 1, true), mat, mid.x, mid.y, mid.z, 0, 0, 0, q);
  }
  tube(mat: THREE.Material, pts: THREE.Vector3[], r: number, seg = 6) {
    this.put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(4, pts.length * 6), r, seg), mat);
  }
  flush(parent: THREE.Object3D) {
    for (const [mat, list] of this.map) {
      const g = mergeGeometries(list, false);
      if (!g) continue;
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      parent.add(mesh);
      for (const x of list) x.dispose();
    }
    this.map.clear();
  }
}
function toIndexed(g: THREE.BufferGeometry) {
  const n = g.attributes.position.count;
  g.setIndex([...Array(n).keys()]);
  return g;
}

/** 캔버스 글씨 간판 */
function signTex(lines: { t: string; s: number; c?: string; b?: boolean }[], W: number, H: number, bg: string, fg: string) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = Math.max(3, H * 0.03); g.strokeRect(H * 0.05, H * 0.05, W - H * 0.1, H - H * 0.1);
  const total = lines.reduce((s, l) => s + l.s * 1.25, 0);
  let y = (H - total) / 2;
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (const l of lines) {
    g.font = `${l.b === false ? 500 : 800} ${l.s}px "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif`;
    g.fillStyle = l.c ?? fg;
    g.fillText(l.t, W / 2, y + l.s * 0.1);
    y += l.s * 1.25;
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

/** 파라솔·차양 줄무늬 */
function stripeTex(a: string, b: string, n = 8) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 16;
  const g = cv.getContext('2d')!;
  for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect((i * 256) / n, 0, 256 / n + 1, 16); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Pontoon {
  root = new THREE.Group();
  /** 현문 사다리 (판툰 경첩에서 배 갑판까지 걸침) */
  gangway = new THREE.Group();
  private gwLen = 1.6;
  /** 0 = 세워 둠(배 없음) → 1 = 배에 걸침 */
  gangwayU = 0;
  private gwEnd = V3();
  private tmp = V3();

  constructor(scene: THREE.Scene) {
    this.build();
    this.buildGangway();
    this.root.add(this.gangway);
    scene.add(this.root);
    this.root.updateMatrixWorld(true);
  }

  private mat(color: string, rough = 0.6, metal = 0, opts: THREE.MeshStandardMaterialParameters = {}) {
    return patchWater(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...opts }), { key: 'pontoon', caustics: true });
  }

  private build() {
    const B = new Batch();
    const white = this.mat('#f3f4f1', 0.5), navy = this.mat('#17344f', 0.6), stripe = this.mat('#1d7fb0', 0.45), boot = this.mat('#a8382c', 0.7);
    const deckGrey = this.mat('#c9cfcd', 0.9), deckBlue = this.mat('#8fb4bf', 0.9), timber = this.mat('#9c7650', 0.85);
    const steel = this.mat('#c8cdd2', 0.25, 0.85), dark = this.mat('#2a2e32', 0.7), grate = this.mat('#d8d2bf', 0.85);
    const teal = this.mat('#1f9ea3', 0.55), tableTop = this.mat('#f1efe8', 0.4), chairC = this.mat('#2a8c95', 0.5);
    const cushion = this.mat('#20607f', 0.85), fabric = this.mat('#f4f2ea', 0.9, 0, { side: THREE.DoubleSide });
    const orange = this.mat('#f06a1f', 0.6), yellow = this.mat('#efc31f', 0.45, 0.2), red = this.mat('#d23a2f', 0.6);
    const chain = this.mat('#3b3d3c', 0.8, 0.5), concrete = this.mat('#7a7a72', 0.95);
    const glass = this.mat('#9fd0dc', 0.08, 0.1, { transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
    const glow = this.mat('#ffe6b8', 0.5, 0, { emissive: '#ffcf8a', emissiveIntensity: 0.55 });
    const winGlow = this.mat('#9ad7e6', 0.2, 0, { emissive: '#6cc6dd', emissiveIntensity: 0.5 });

    // ── 부력체(플로트) 2개 + 수중 전망대 ──
    for (const sx of [-1, 1]) {
      B.box(navy, 3.2, 2.0, 2 * HZ - 1.2, sx * 4.2, -0.5, 0);
      for (const sz of [-1, 1]) B.put(new THREE.CylinderGeometry(1.6, 1.6, 2.0, 18, 1, false, 0, Math.PI), navy, sx * 4.2, -0.5, sz * (HZ - 0.6), 0, sz > 0 ? 0 : Math.PI, 0);
      B.box(boot, 3.24, 0.26, 2 * HZ - 1.1, sx * 4.2, 0.05, 0);
    }
    // 가로 보 (플로트 연결)
    for (let z = -13; z <= 13; z += 3.25) B.box(navy, 5.2, 0.35, 0.3, 0, 0.35, z);
    // 수중 전망대: 두 플로트 사이 물속 방, 양옆에 둥근 창
    B.box(navy, 4.6, 3.4, 6.4, 0, -1.6, -3.0);
    for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) for (const wy of [-2.4, -1.3]) {
      B.put(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 18), winGlow, sx * 2.32, wy, -5.4 + k * 1.6, 0, 0, Math.PI / 2);
    }

    // ── 메인 데크 ──
    B.box(white, 2 * HX + 0.2, 0.6, 2 * HZ + 0.2, 0, MD - 0.31, 0);
    B.box(stripe, 2 * HX + 0.24, 0.12, 2 * HZ + 0.24, 0, MD - 0.36, 0);
    B.box(deckGrey, 2 * HX, 0.02, 2 * HZ, 0, MD - 0.005, 0);
    // 식당 구역은 목재 데크, 다이빙 데크는 미끄럼 방지 파란 데크
    B.box(timber, 7.4, 0.02, 9.6, -2.3, MD + 0.006, 2.5);
    B.box(deckBlue, 2 * HX - 0.4, 0.02, 9.0, 0, MD + 0.006, -10.3);
    // 데크 가장자리 고무 범퍼
    for (const sx of [-1, 1]) B.box(dark, 0.18, 0.22, 2 * HZ + 0.3, sx * (HX + 0.18), MD - 0.45, 0);

    // ── 난간 (현문·스노클 계단·다이빙 계단 자리는 비움) ──
    const railH = MD + 1.0;
    const rail = (a: THREE.Vector3, b: THREE.Vector3, y0 = MD, h = 1.0) => {
      const top = (p: THREE.Vector3) => V3(p.x, y0 + h, p.z), mid = (p: THREE.Vector3) => V3(p.x, y0 + h * 0.5, p.z);
      B.rod(steel, top(a), top(b), 0.028);
      B.rod(steel, mid(a), mid(b), 0.018);
      const n = Math.max(1, Math.round(a.distanceTo(b) / 1.5));
      for (let i = 0; i <= n; i++) { const p = a.clone().lerp(b, i / n); B.rod(steel, V3(p.x, y0, p.z), V3(p.x, y0 + h, p.z), 0.022); }
    };
    const P = (x: number, z: number) => V3(x, 0, z);
    rail(P(-HX + 0.05, -HZ + 0.05), P(-HX + 0.05, -4.65));
    rail(P(-HX + 0.05, -3.55), P(-HX + 0.05, HZ - 0.05));
    rail(P(HX - 0.05, -HZ + 0.05), P(HX - 0.05, 0.25));
    rail(P(HX - 0.05, 2.75), P(HX - 0.05, HZ - 0.05));
    rail(P(-HX + 0.05, HZ - 0.05), P(HX - 0.05, HZ - 0.05));
    rail(P(-HX + 0.05, -HZ + 0.05), P(-1.3, -HZ + 0.05));
    rail(P(1.3, -HZ + 0.05), P(HX - 0.05, -HZ + 0.05));
    // 현문 게이트 기둥 (노란 안전 띠)
    for (const z of [-4.65, -3.55]) { B.rod(yellow, V3(-HX + 0.05, MD, z), V3(-HX + 0.05, railH + 0.1, z), 0.045); }
    // 구명 튜브
    for (const [x, z, ry] of [[-HX + 0.02, 7.5, Math.PI / 2], [HX - 0.02, -6.8, Math.PI / 2], [-HX + 0.02, -11.5, Math.PI / 2], [2.5, HZ - 0.02, 0]] as const) {
      B.put(new THREE.TorusGeometry(0.3, 0.075, 8, 20), orange, x, MD + 0.62, z, 0, ry, 0);
    }
    // 펜더 (배가 닿는 좌현)
    for (const z of [-11.2, -7.0, -1.2]) B.put(new THREE.CylinderGeometry(0.38, 0.38, 1.7, 14), dark, -HX - 0.42, 0.55, z, Math.PI / 2, 0, 0);

    // ── 상부 데크 (그늘이 지는 식당 위) ──
    const UZ0 = -3.4, UZ1 = 9.0, UX = 5.75;
    B.box(white, 2 * UX + 0.1, 0.24, UZ1 - UZ0, 0, UD - 0.12, (UZ0 + UZ1) / 2);
    B.box(stripe, 2 * UX + 0.14, 0.1, UZ1 - UZ0 + 0.04, 0, UD - 0.2, (UZ0 + UZ1) / 2);
    B.box(deckGrey, 2 * UX - 0.1, 0.02, UZ1 - UZ0 - 0.1, 0, UD + 0.005, (UZ0 + UZ1) / 2);
    for (const x of [-UX + 0.12, UX - 0.12]) for (const z of [UZ0 + 0.2, 2.7, UZ1 - 0.2]) B.cyl(white, 0.12, UD - MD - 0.24, x, (MD + UD - 0.24) / 2, z, 14);
    // 상부 데크 난간 (유리 패널 + 손잡이)
    const urail = (a: THREE.Vector3, b: THREE.Vector3) => {
      B.rod(steel, V3(a.x, UD + 1.05, a.z), V3(b.x, UD + 1.05, b.z), 0.03);
      const n = Math.max(1, Math.round(a.distanceTo(b) / 1.6));
      for (let i = 0; i <= n; i++) { const p = a.clone().lerp(b, i / n); B.rod(steel, V3(p.x, UD, p.z), V3(p.x, UD + 1.05, p.z), 0.025); }
      const len = a.distanceTo(b), mid = a.clone().add(b).multiplyScalar(0.5);
      B.put(new THREE.PlaneGeometry(len, 0.9), glass, mid.x, UD + 0.5, mid.z, 0, Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2, 0);
    };
    urail(P(-UX, UZ0), P(UX, UZ0)); urail(P(-UX, UZ0), P(-UX, UZ1)); urail(P(UX, UZ0), P(UX, 7.6)); urail(P(-UX, UZ1), P(3.4, UZ1));
    // 선베드
    for (const [x, z] of [[-3.8, -1.6], [-2.2, -1.6], [2.2, -1.6], [3.8, -1.6], [-3.8, 1.4], [3.8, 1.4]]) {
      B.box(white, 0.7, 0.08, 1.9, x, UD + 0.3, z);
      B.put(new THREE.BoxGeometry(0.66, 0.06, 0.7), cushion, x, UD + 0.55, z + 0.82, -0.9, 0, 0);
      B.box(cushion, 0.66, 0.06, 1.25, x, UD + 0.37, z - 0.25);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl(steel, 0.02, 0.28, x + sx * 0.3, UD + 0.14, z + sz * 0.85, 6);
    }
    // 그늘막 돛 (상부 데크 위 두 장) + 돛대
    for (const [cx, tilt] of [[-2.6, 0.12], [2.6, -0.12]] as const) {
      const sail = new THREE.PlaneGeometry(4.6, 7.4);
      B.put(sail, fabric, cx, UD + 2.9, 3.2, -Math.PI / 2 + 0.08, 0, tilt);
    }
    for (const [x, z, h] of [[-5.3, -0.6, 3.4], [5.3, -0.6, 3.1], [-5.3, 7.0, 3.1], [5.3, 7.0, 3.4], [0, 3.2, 3.6]]) B.cyl(steel, 0.06, h, x, UD + h / 2, z, 10);
    // 상부 데크 계단 (메인 데크 선수 쪽에서 올라감)
    {
      const n = 14, x0 = 3.6, x1 = 4.8, zTop = 9.05, run = 0.27;
      for (let k = 0; k < n; k++) {
        const y = UD - (k + 1) * ((UD - MD) / (n + 0)), z = zTop + (k + 0.5) * run;
        B.box(white, x1 - x0, 0.05, run + 0.03, (x0 + x1) / 2, y, z);
      }
      for (const x of [x0, x1]) {
        B.rod(white, V3(x, UD - 0.1, zTop), V3(x, MD, zTop + n * run), 0.06);
        B.rod(steel, V3(x, UD + 1.0, zTop), V3(x, MD + 1.0, zTop + n * run), 0.026);
        for (let k = 0; k <= n; k += 4) { const z = zTop + k * run, y = UD - k * ((UD - MD) / n); B.rod(steel, V3(x, y, z), V3(x, y + 1.0, z), 0.02); }
      }
    }

    // ── 리프 카페 (상부 데크 아래 선수 쪽 매점) ──
    {
      const x0 = -5.6, x1 = 1.6, z0 = 6.9, z1 = 9.0, top = MD + 2.4;
      const cx = (x0 + x1) / 2, w = x1 - x0;
      B.box(white, w, top - MD, 0.12, cx, (MD + top) / 2, z1);             // 뒷벽
      for (const x of [x0, x1]) B.box(white, 0.12, top - MD, z1 - z0, x, (MD + top) / 2, (z0 + z1) / 2);
      B.box(white, w, 1.0, 0.12, cx, MD + 0.5, z0);                          // 카운터 앞판
      B.box(teal, w + 0.02, 0.16, 0.13, cx, MD + 0.86, z0 - 0.002);
      B.box(timber, w + 0.1, 0.06, 0.62, cx, MD + 1.03, z0 + 0.15);          // 카운터 상판
      B.box(white, w, 0.42, 0.12, cx, top - 0.21, z0);                       // 위쪽 간판대
      B.box(dark, w - 0.3, 0.9, 0.5, cx, MD + 0.45, z1 - 0.35);              // 뒤 작업대
      B.box(timber, w - 0.3, 0.05, 0.55, cx, MD + 0.92, z1 - 0.35);
      for (let k = 0; k < 3; k++) B.box(timber, w - 0.6, 0.04, 0.3, cx, MD + 1.45 + k * 0.32, z1 - 0.2);  // 선반
      // 커피 머신, 블렌더, 유리 냉장고(조명), 컵
      B.box(steel, 0.7, 0.45, 0.4, -3.6, MD + 1.17, z1 - 0.4);
      B.box(dark, 0.6, 0.06, 0.32, -3.6, MD + 1.42, z1 - 0.4);
      B.cyl(dark, 0.08, 0.3, -2.5, MD + 1.1, z1 - 0.4, 10);
      B.box(glow, 0.9, 1.9, 0.6, 0.85, MD + 0.95, z1 - 0.4);
      for (let k = 0; k < 6; k++) B.cyl(white, 0.04, 0.1, -1.6 + k * 0.12, MD + 1.11, z0 + 0.25, 10);
      // 진열 쇼케이스 (빵·샌드위치)
      B.put(new THREE.PlaneGeometry(1.4, 0.3), glass, -1.2, MD + 1.22, z0 + 0.12, -0.6, 0, 0);
      B.box(this.mat('#d9a05b', 0.8), 1.2, 0.08, 0.3, -1.2, MD + 1.1, z0 + 0.22);
      // 바 스툴
      for (const x of [-4.6, -3.6, -2.6, -1.6]) { B.cyl(chairC, 0.17, 0.06, x, MD + 0.72, z0 - 0.55, 14); B.cyl(steel, 0.025, 0.7, x, MD + 0.36, z0 - 0.55, 6); B.cyl(steel, 0.18, 0.02, x, MD + 0.01, z0 - 0.55, 14); }
    }

    // ── 식당 테이블 + 의자 ──
    for (const tx of TABLE_X) for (const tz of TABLE_Z) {
      B.box(tableTop, 0.8, 0.04, 1.3, tx, MD + 0.74, tz);
      B.cyl(steel, 0.04, 0.72, tx, MD + 0.36, tz, 8);
      B.box(steel, 0.5, 0.02, 0.8, tx, MD + 0.01, tz);
    }
    for (const s of SEATS) this.chair(B, s.c, s.yaw, chairC, steel);
    // 뷔페 테이블 (점심 시간용)
    B.box(tableTop, 0.8, 0.05, 3.2, -5.2, MD + 0.82, 2.0);
    B.box(white, 0.76, 0.8, 3.1, -5.2, MD + 0.4, 2.0);
    for (let k = 0; k < 5; k++) B.put(new THREE.CylinderGeometry(0.2, 0.17, 0.08, 16), steel, -5.2, MD + 0.89, 0.7 + k * 0.65);

    // ── 선수 야외 테이블 + 파라솔 ──
    const umbMat = this.mat('#ffffff', 0.8, 0, { map: stripeTex('#f4f1e8', '#1f8fb3'), side: THREE.DoubleSide });
    for (const [x, z] of [[-3.8, 11.4], [-1.0, 12.9], [-3.8, 13.9]]) {
      B.cyl(tableTop, 0.45, 0.04, x, MD + 0.74, z, 18);
      B.cyl(steel, 0.03, 2.3, x, MD + 1.15, z, 8);
      B.put(new THREE.ConeGeometry(1.35, 0.45, 8, 1, true), umbMat, x, MD + 2.35, z);
      for (const a of [0.4, 2.0, 3.6, 5.2]) this.chair(B, V3(x - Math.sin(a) * 0.75, MD, z - Math.cos(a) * 0.75), a, chairC, steel);
    }

    // ── 스노클 장비 랙 (마스크·스노클·오리발) + 스팅어 슈트 걸이 ──
    {
      const x = 5.72, z0 = 4.6, z1 = 8.4;
      for (const z of [z0, (z0 + z1) / 2, z1]) B.rod(steel, V3(x, MD, z), V3(x, MD + 1.8, z), 0.03);
      for (let k = 0; k < 4; k++) B.box(timber, 0.38, 0.03, z1 - z0, x, MD + 0.25 + k * 0.45, (z0 + z1) / 2);
      const finCols = ['#ff8a2a', '#1fa2c8', '#efc31f', '#e2463c', '#26b37a'].map((c) => this.mat(c, 0.5));
      let i = 0;
      for (let k = 0; k < 2; k++) for (let z = z0 + 0.2; z < z1 - 0.1; z += 0.26, i++) {
        const fm = finCols[i % finCols.length];
        B.put(new THREE.BoxGeometry(0.32, 0.02, 0.18), fm, x - 0.02, MD + 0.29 + k * 0.45, z, 0, 0, 0.1);
      }
      for (let z = z0 + 0.25; z < z1 - 0.1; z += 0.32) {
        B.put(new THREE.TorusGeometry(0.07, 0.017, 6, 14), finCols[1], x - 0.12, MD + 1.25, z, 0, Math.PI / 2, 0);
        B.rod(finCols[1], V3(x - 0.1, MD + 1.13, z + 0.08), V3(x - 0.1, MD + 1.5, z + 0.08), 0.012, 6);
      }
      // 스팅어 슈트(해파리 보호복) 걸이
      B.rod(steel, V3(5.55, MD + 1.85, 9.6), V3(5.55, MD + 1.85, 12.6), 0.025);
      for (const z of [9.6, 12.6]) B.rod(steel, V3(5.55, MD, z), V3(5.55, MD + 1.85, z), 0.025);
      const suitMats = [this.mat('#1b2a4a', 0.8), this.mat('#2c2f8a', 0.8), this.mat('#151517', 0.8)];
      for (let k = 0; k < 9; k++) B.box(suitMats[k % 3], 0.1, 1.2, 0.34, 5.55, MD + 1.2, 9.85 + k * 0.32);
    }

    // ── 우현 스노클 입수 시설: 계단 3단 → 플랫폼 → 물속 계단 4단 ──
    {
      const z0 = 0.3, z1 = 2.7, w = z1 - z0, zc = (z0 + z1) / 2;
      for (let k = 0; k < 3; k++) B.box(grate, 0.3, 0.06, w, 6.15 + k * 0.3, 0.87 - k * 0.2, zc);
      for (const z of [z0 - 0.03, z1 + 0.03]) B.put(new THREE.BoxGeometry(1.0, 0.14, 0.05), white, 6.45, 0.62, z, 0, 0, -0.58);
      // 플랫폼 (부력체 위 그레이팅)
      B.box(grate, 1.7, 0.1, 6.5, 7.75, SP - 0.05, 1.25);
      B.box(navy, 1.6, 0.7, 6.3, 7.75, -0.25, 1.25);
      B.box(boot, 1.64, 0.18, 6.34, 7.75, 0.0, 1.25);
      // 물속 계단 (플랫폼 바깥 → 수심 1m)
      for (let k = 0; k < 4; k++) B.box(grate, 0.3, 0.05, w, 8.75 + k * 0.3, 0.025 - k * 0.25, zc);
      B.box(grate, 0.6, 0.05, w, 10.05, -0.975, zc);
      for (const z of [z0, zc, z1]) {
        B.put(new THREE.BoxGeometry(1.95, 0.12, 0.05), steel, 9.55, -0.42, z, 0, 0, -0.62);
        // 손잡이: 플랫폼에서 물속 계단 끝까지 (위쪽은 구스넥처럼 굽음)
        B.tube(steel, [V3(8.0, SP + 0.02, z), V3(8.05, SP + 0.95, z), V3(8.55, SP + 0.98, z), V3(9.6, 0.2, z), V3(10.3, -0.55, z)], 0.028);
      }
      // 메인 계단 손잡이
      for (const z of [z0, z1]) B.tube(steel, [V3(5.95, MD + 1.0, z), V3(6.1, MD + 0.95, z), V3(6.95, SP + 1.0, z), V3(7.2, SP + 0.98, z)], 0.026);
      // 플랫폼 난간 (계단 자리는 비움)
      rail(P(6.95, -1.95), P(8.55, -1.95), SP, 0.95);
      rail(P(6.95, 4.45), P(8.55, 4.45), SP, 0.95);
      rail(P(8.55, -1.95), P(8.55, z0 - 0.05), SP, 0.95);
      rail(P(8.55, z1 + 0.05), P(8.55, 4.45), SP, 0.95);
      // 그늘 차양
      const canopy = this.mat('#1f8fb3', 0.85, 0, { side: THREE.DoubleSide });
      for (const [x, z] of [[7.05, -1.8], [8.45, -1.8], [7.05, 4.3], [8.45, 4.3]]) B.cyl(steel, 0.04, 2.6, x, SP + 1.3, z, 8);
      B.put(new THREE.PlaneGeometry(1.7, 6.4), canopy, 7.75, SP + 2.6, 1.25, -Math.PI / 2, 0, 0.06);
      // 인명구조 감시탑 (높은 의자 + 구조 튜브)
      const lx = 8.0, lz = -1.3;
      for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) B.rod(white, V3(lx + dx * 1.3, SP, lz + dz * 1.3), V3(lx + dx, SP + 1.5, lz + dz), 0.03);
      B.box(white, 0.6, 0.05, 0.6, lx, SP + 1.5, lz);
      B.box(red, 0.56, 0.5, 0.05, lx, SP + 1.78, lz - 0.28);
      for (let k = 0; k < 5; k++) B.rod(white, V3(lx - 0.25, SP + 0.3 * k, lz + 0.42), V3(lx + 0.25, SP + 0.3 * k, lz + 0.42), 0.015);
      B.put(new THREE.CapsuleGeometry(0.07, 0.6, 4, 8), red, lx + 0.35, SP + 0.6, lz + 0.35, 0, 0, 0.2);
      // 민물 샤워
      B.rod(steel, V3(5.6, MD, -0.8), V3(5.6, MD + 2.2, -0.8), 0.03);
      B.rod(steel, V3(5.6, MD + 2.2, -0.8), V3(5.3, MD + 2.2, -0.8), 0.02);
      B.cyl(steel, 0.09, 0.04, 5.3, MD + 2.16, -0.8, 12);
    }

    // ── 다이빙 데크: 탱크 랙 + 벤치 + 브리핑 보드 + 헹굼 통 ──
    {
      B.box(white, 0.5, 0.45, 5.6, -4.75, MD + 0.225, -10.6);
      B.box(cushion, 0.5, 0.05, 5.6, -4.75, MD + 0.47, -10.6);
      B.box(steel, 0.12, 0.9, 6.4, -5.55, MD + 0.45, -10.6);
      for (let k = 0; k < 14; k++) {
        const z = -13.6 + k * 0.45;
        B.cyl(k % 3 ? this.mat('#e8c22a', 0.35, 0.4) : this.mat('#d8dde0', 0.3, 0.6), 0.09, 0.68, -5.4, MD + 0.95, z, 14);
        B.cyl(dark, 0.025, 0.08, -5.4, MD + 1.33, z, 6);
      }
      B.box(white, 0.06, 1.1, 1.8, 5.75, MD + 1.35, -10.0);
      for (const z of [-10.85, -9.15]) B.rod(steel, V3(5.75, MD, z), V3(5.75, MD + 0.8, z), 0.025);
      B.box(this.mat('#2a7fb8', 0.5), 0.9, 0.6, 0.6, 4.4, MD + 0.3, -13.6);
      B.box(this.mat('#5fd0e0', 0.1, 0, { transparent: true, opacity: 0.6 }), 0.82, 0.02, 0.52, 4.4, MD + 0.56, -13.6);
      B.box(red, 0.5, 0.4, 0.3, 5.5, MD + 0.2, -14.3);
      // 다이빙 깃발 (국제 신호기 A) 깃대
      B.cyl(steel, 0.04, 3.2, 2.8, SP + 1.6, -17.9, 8);
    }
    // ── 선미 다이빙 플랫폼 ──
    {
      for (let k = 0; k < 3; k++) B.box(grate, 2.4, 0.06, 0.3, 0, 0.87 - k * 0.2, -15.15 - k * 0.3);
      for (const x of [-1.25, 1.25]) {
        B.put(new THREE.BoxGeometry(0.05, 0.14, 1.05), white, x, 0.62, -15.45, 0.58, 0, 0);
        B.tube(steel, [V3(x, MD + 1.0, -14.95), V3(x, MD + 0.95, -15.1), V3(x, SP + 1.0, -15.95), V3(x, SP + 0.98, -16.3)], 0.026);
      }
      B.box(grate, 6.0, 0.1, 2.3, 0, SP - 0.05, -17.05);
      B.box(navy, 5.9, 0.7, 2.2, 0, -0.25, -17.05);
      B.box(boot, 5.94, 0.18, 2.24, 0, 0.0, -17.05);
      rail(P(-2.95, -15.95), P(-2.95, -18.15), SP, 0.95);
      rail(P(2.95, -15.95), P(2.95, -18.15), SP, 0.95);
      rail(P(-2.95, -18.15), P(-1.6, -18.15), SP, 0.95);
      rail(P(1.6, -18.15), P(2.95, -18.15), SP, 0.95);
      // 다이빙 사다리 (물속 2m까지, 수영장 사다리처럼 위가 굽은 손잡이)
      for (const lx of [-2.2, 2.2]) {
        for (const x of [lx - 0.28, lx + 0.28]) B.tube(steel, [V3(x, SP + 0.9, -17.8), V3(x, SP + 0.95, -18.15), V3(x, SP, -18.3), V3(x, -2.0, -18.35)], 0.026);
        for (let k = 0; k < 5; k++) B.rod(steel, V3(lx - 0.28, 0.0 - k * 0.4, -18.33), V3(lx + 0.28, 0.0 - k * 0.4, -18.33), 0.02);
      }
    }
    // ── 수중 전망대 입구 (계단 하우스) ──
    {
      const x0 = 2.2, x1 = 3.6, z0 = -3.6, z1 = -2.4;
      B.box(white, x1 - x0, 1.0, 0.08, (x0 + x1) / 2, MD + 0.5, z0);
      B.box(white, 0.08, 1.0, z1 - z0, x1, MD + 0.5, (z0 + z1) / 2);
      B.box(white, 0.08, 1.0, z1 - z0, x0, MD + 0.5, (z0 + z1) / 2);
      B.box(dark, x1 - x0 - 0.1, 0.02, z1 - z0 - 0.1, (x0 + x1) / 2, MD + 0.01, (z0 + z1) / 2);
      B.rod(steel, V3(x0, MD + 1.0, z1), V3(x1, MD + 1.0, z1), 0.025);
    }
    // ── 계류 체인 (네 모서리 → 해저 앵커 블록) ──
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const a = V3(sx * (HX - 0.3), -0.6, sz * (HZ - 0.5));
      const bx = sx * 20, bz = sz * 32, by = heightAt(bx, bz);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const u = i / 10;
        const p = a.clone().lerp(V3(bx, by + 0.2, bz), u);
        p.y -= Math.sin(u * Math.PI) * 1.8 * (1 - u * 0.4);
        p.y = Math.max(p.y, heightAt(p.x, p.z) + 0.15);
        pts.push(p);
      }
      B.tube(chain, pts, 0.05, 5);
      B.box(concrete, 1.2, 0.8, 1.2, bx, by + 0.3, bz);
    }

    B.flush(this.root);
    void glass;

    // ── 간판 (캔버스 글씨) ──
    const signs: [THREE.Texture, number, number, THREE.Vector3, number][] = [
      [signTex([{ t: 'REEF PONTOON', s: 92 }, { t: '리프 판툰 · 그레이트 리프 정박 시설', s: 46, b: false }], 1024, 256, '#1d6fa0', '#ffffff'), 5.2, 1.3, V3(-UX - 0.07, UD - 0.85, 2.7), -Math.PI / 2],
      [signTex([{ t: 'REEF PONTOON', s: 92 }, { t: '리프 판툰', s: 54, b: false }], 1024, 256, '#1d6fa0', '#ffffff'), 4.4, 1.1, V3(0, UD - 0.8, UZ1 + 0.07), 0],
      [signTex([{ t: 'REEF CAFÉ  리프 카페', s: 62 }, { t: '아메리카노 · 라떼 · 생과일 스무디 · 아이스크림', s: 34, b: false }, { t: '점심 뷔페 12:00 – 13:30', s: 34, b: false, c: '#ffe08a' }], 1024, 256, '#123b52', '#ffffff'), 4.6, 1.15, V3(-2.0, MD + 2.1, 6.83), Math.PI],
      [signTex([{ t: '스노클링 입수 ▶', s: 66 }, { t: 'SNORKEL ENTRY · 오리발은 계단에 앉아서', s: 30, b: false }], 768, 192, '#f2c81e', '#13304f'), 1.6, 0.4, V3(5.9, MD + 1.45, 3.05), -Math.PI / 2],
      [signTex([{ t: '스노클 장비', s: 70 }, { t: 'MASK · SNORKEL · FINS', s: 34, b: false }], 768, 192, '#1f9ea3', '#ffffff'), 1.6, 0.4, V3(5.69, MD + 2.0, 6.5), -Math.PI / 2],
      [signTex([{ t: '다이빙 플랫폼', s: 70 }, { t: 'DIVE PLATFORM · 자이언트 스트라이드', s: 32, b: false }], 768, 192, '#13304f', '#ffffff'), 1.8, 0.45, V3(0, MD + 1.55, -14.98), 0],
      [signTex([{ t: '수중 전망대 ↓', s: 64 }, { t: 'UNDERWATER OBSERVATORY', s: 30, b: false }], 768, 192, '#0f4c68', '#ffffff'), 1.3, 0.33, V3(2.9, MD + 1.3, -3.66), Math.PI],
      [signTex([{ t: 'DIVE BRIEFING', s: 48 }, { t: '최대 수심 18m · 잔압 50bar에 상승', s: 30, b: false }, { t: '안전 정지 5m 3분 · 버디와 함께', s: 30, b: false }, { t: '산호를 만지지 마세요', s: 30, b: false, c: '#ffd36b' }], 512, 320, '#20343f', '#ffffff'), 1.7, 1.06, V3(5.71, MD + 1.35, -10.0), -Math.PI / 2],
      [signTex([{ t: 'LIFEGUARD', s: 60 }], 512, 128, '#d23a2f', '#ffffff'), 0.54, 0.14, V3(8.0, SP + 1.78, -1.32), Math.PI],
    ];
    for (const [tex, w, h, p, ry] of signs) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.mat('#ffffff', 0.7, 0, { map: tex }));
      m.position.copy(p); m.rotation.y = ry;
      this.root.add(m);
    }
    // 다이빙 깃발 (흰색/파란색 제비꼬리)
    const flagShape = new THREE.Shape();
    flagShape.moveTo(0, 0); flagShape.lineTo(0.9, 0); flagShape.lineTo(0.65, 0.3); flagShape.lineTo(0.9, 0.6); flagShape.lineTo(0, 0.6);
    const flag = new THREE.Group();
    flag.add(new THREE.Mesh(new THREE.ShapeGeometry(flagShape), this.mat('#1a4fb0', 0.8, 0, { side: THREE.DoubleSide })));
    const fw = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.6), this.mat('#f5f5f5', 0.8, 0, { side: THREE.DoubleSide })); fw.position.set(0.2, 0.3, 0.002); flag.add(fw);
    flag.position.set(2.84, SP + 2.55, -17.9); flag.rotation.y = -Math.PI / 2;
    this.root.add(flag);
  }

  /** 식당 의자: c = 의자 중심 바닥점, yaw = 앉은 사람이 보는 방향 */
  private chair(B: Batch, c: THREE.Vector3, yaw: number, seat: THREE.Material, leg: THREE.Material) {
    B.base.compose(c, new THREE.Quaternion().setFromAxisAngle(Y, yaw), V3(1, 1, 1));
    B.box(seat, 0.44, 0.05, 0.44, 0, 0.45, 0);
    B.put(new THREE.BoxGeometry(0.44, 0.4, 0.04), seat, 0, 0.7, -0.22, -0.12, 0, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.rod(leg, V3(sx * 0.19, 0, sz * 0.19), V3(sx * 0.19, 0.44, sz * 0.19), 0.015, 6);
    B.base.identity();
  }

  // ───────── 현문 사다리 (갱웨이) ─────────
  private buildGangway() {
    const steel = this.mat('#c8cdd2', 0.25, 0.85), tread = this.mat('#b9b39f', 0.85), yellow = this.mat('#efc31f', 0.5);
    // 길이 1 기준 모델 (+z 방향으로 뻗음) → 매 프레임 길이만큼 z 스케일
    const W = 0.95;
    const body = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, 1), tread); deck.position.set(0, -0.02, 0.5); body.add(deck);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 1), steel); side.position.set(s * W / 2, 0.03, 0.5); body.add(side);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 8), steel); top.rotation.x = Math.PI / 2; top.position.set(s * W / 2, 0.95, 0.5); body.add(top);
      const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1, 6), steel); mid.rotation.x = Math.PI / 2; mid.position.set(s * W / 2, 0.5, 0.5); body.add(mid);
    }
    // 미끄럼 방지 가로대
    for (let k = 1; k < 8; k++) { const c = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, 0.025, 0.03), yellow); c.position.set(0, 0.015, k / 8); body.add(c); }
    this.gangway.add(body);
    // 손잡이 기둥 (스케일 영향 없는 별도 그룹)
    const posts = new THREE.Group();
    this.gangway.userData.posts = posts;
    for (const s of [-1, 1]) for (const z of [0, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.95, 8), steel);
      p.position.set(s * W / 2, 0.47, 0); p.userData.z = z; posts.add(p);
    }
    this.gangway.add(posts);
    this.gangway.userData.body = body;
    this.gangway.position.copy(HINGE);
    this.setGangway(null);
  }

  /** 사다리 끝을 배 갑판 위 한 점(월드)에 걸침. null이면 세워 둠 (gangwayU로 보간) */
  setGangway(boatPointWorld: THREE.Vector3 | null) {
    const body = this.gangway.userData.body as THREE.Group, posts = this.gangway.userData.posts as THREE.Group;
    let yaw = -Math.PI / 2, pitch = -1.25, len = this.gwLen;
    if (boatPointWorld) {
      const e = this.root.worldToLocal(this.gwEnd.copy(boatPointWorld)).sub(HINGE);
      const h = Math.hypot(e.x, e.z);
      len = Math.hypot(h, e.y); this.gwLen = len;
      const y1 = Math.atan2(e.x, e.z), p1 = -Math.atan2(e.y, h);
      const u = this.gangwayU * this.gangwayU * (3 - 2 * this.gangwayU);
      yaw = y1; pitch = THREE.MathUtils.lerp(-1.25, p1, u);
    }
    this.gangway.rotation.set(pitch, yaw, 0, 'YXZ');
    body.scale.set(1, 1, len);
    for (const p of posts.children) p.position.z = (p.userData.z as number) * len;
  }

  /** 판툰은 체인으로 단단히 계류되어 아주 조금만 흔들림 */
  update(t: number) {
    this.root.position.y = Math.sin(t * 0.55) * 0.025 + Math.sin(t * 0.31 + 1) * 0.015;
    this.root.rotation.set(Math.sin(t * 0.4) * 0.0025, 0, Math.sin(t * 0.47 + 2) * 0.003);
    this.root.updateMatrixWorld(true);
  }

  toWorld(v: THREE.Vector3, out = new THREE.Vector3()) { return out.copy(v).applyMatrix4(this.root.matrixWorld); }
  toLocal(v: THREE.Vector3, out = new THREE.Vector3()) { return this.root.worldToLocal(out.copy(v)); }

  /** 물속에서 수영하는 사람이 판툰 부력체·플랫폼을 뚫고 지나가지 않도록 밀어냄 (월드 좌표, 반지름 r) */
  collide(p: THREE.Vector3, r: number) {
    const l = this.toLocal(p, this.tmp);
    let moved = false;
    for (const b of COLLIDERS) {
      if (l.x < b[0] - r || l.x > b[1] + r || l.z < b[4] - r || l.z > b[5] + r || l.y < b[2] - r || l.y > b[3] + r) continue;
      // 가장 얕게 파고든 방향으로 밀어냄 (아래로는 밀지 않음: 수면 쪽 사람이 아래로 끌려가지 않게)
      const pen = [l.x - (b[0] - r), b[1] + r - l.x, l.z - (b[4] - r), b[5] + r - l.z, l.y - (b[2] - r)];
      let k = 0;
      for (let i = 1; i < 5; i++) if (pen[i] < pen[k]) k = i;
      if (k === 0) l.x = b[0] - r; else if (k === 1) l.x = b[1] + r; else if (k === 2) l.z = b[4] - r; else if (k === 3) l.z = b[5] + r; else l.y = b[2] - r;
      moved = true;
    }
    if (moved) p.copy(this.toWorld(l));
    return moved;
  }
}

/** 충돌 상자 [x0, x1, y0, y1, z0, z1] (판툰 로컬) */
const COLLIDERS: [number, number, number, number, number, number][] = [
  [-HX - 0.4, HX + 0.1, -1.55, 4.5, -HZ - 0.1, HZ + 0.1],   // 본체 + 부력체
  [-2.35, 2.35, -3.35, 0, -6.2, 0.2],                      // 수중 전망대
  [6.0, 8.6, -0.6, 3, -2.0, 4.5],                          // 스노클 플랫폼
  [8.6, 10.35, -1.05, -0.5, 0.25, 2.75],                   // 물속 계단 아래쪽
  [-3.0, 3.0, -0.6, 3, -18.2, -15.0],                      // 다이빙 플랫폼
];

// 산호초: 7계열 절차 생성 + 수심/서식지 기반 배치 + 해류 흔들림
//  가지형(스태그혼/디지테이트) · 뇌산호/포리테스 · 탁상형 · 접시형 · 연산호(사코파이톤/카네이션/시눌라리아)
//  · 부채산호 · 해면(튜브/배럴/꽃병) · 채찍산호 · 암반(석회조류)
import * as THREE from 'three';
import { mulberry32, rand, pick, vnoise3, type RNG } from '../core/math';
import { heightAt, normalAt, coralDensity, dropFactor } from './terrain';
import { paint, merge, segment, hex } from './geo';
import { patchWater, waterUniforms, reefShadow } from '../water/WaterShading';

type Kind = 'staghorn' | 'digitate' | 'table' | 'brain' | 'porites' | 'plate' | 'sarcophyton' | 'dendro' | 'sinularia' | 'fan' | 'tube' | 'barrel' | 'vase' | 'whip' | 'rock';

interface Variant { kind: Kind; geo: THREE.BufferGeometry; tints: THREE.Color[]; scale: [number, number] }

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ───────── 생성기 ─────────
function staghorn(r: RNG, base: THREE.Color, tip: THREE.Color, digitate = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunks = digitate ? 6 + Math.floor(r() * 4) : 5 + Math.floor(r() * 3);
  const maxDepth = digitate ? 1 : 2;
  const grow = (a: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
    const b = a.clone().addScaledVector(dir, len);
    const tipEnd = depth >= maxDepth;
    const g = segment(a, b, rad, tipEnd ? rad * 0.62 : rad * 0.8, 6, false);
    paint(g, (p) => base.clone().lerp(tip, (1 - THREE.MathUtils.smoothstep(p.distanceTo(b), 0, len)) * (tipEnd ? 1 : 0.35)));
    parts.push(g);
    if (tipEnd) {
      // 둥근 가지 끝 (축 폴립)
      const c = b.clone().addScaledVector(dir, rad * 0.55);
      const cap = segment(b, c, rad * 0.62, rad * 0.12, 6, true);
      paint(cap, tip.clone().multiplyScalar(1.12));
      parts.push(cap);
      return;
    }
    const kids = 2 + (r() < 0.15 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const nd = dir.clone().add(V3(rand(r, -0.7, 0.7), rand(r, -0.1, 0.5), rand(r, -0.7, 0.7))).normalize();
      grow(b, nd, len * rand(r, 0.6, 0.85), rad * 0.72, depth + 1);
    }
  };
  for (let i = 0; i < trunks; i++) {
    const ang = (i / trunks) * Math.PI * 2 + r();
    const tilt = digitate ? rand(r, 0.05, 0.35) : rand(r, 0.25, 0.8);
    const dir = V3(Math.cos(ang) * tilt, 1, Math.sin(ang) * tilt).normalize();
    const start = V3(Math.cos(ang) * rand(r, 0, 0.15), 0, Math.sin(ang) * rand(r, 0, 0.15));
    grow(start, dir, digitate ? rand(r, 0.12, 0.22) : rand(r, 0.26, 0.38), digitate ? 0.042 : 0.05, 0);
  }
  return merge(parts);
}

function brain(r: RNG, groove: THREE.Color, ridge: THREE.Color, freq = 7, lumpy = 0.12, detail = 12): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g = mergeVerts(g);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = V3();
  const vals = new Float32Array(pos.count);
  const o = r() * 100;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const n = p.clone().normalize();
    // 꾸불꾸불한 골 (메안드로이드)
    const w = vnoise3(n.x * 2.2 + o, n.y * 2.2, n.z * 2.2) * 2.5;
    const m = Math.abs(Math.sin((n.x * 1.3 + n.z * 0.7 + w) * freq));
    const lump = 1 + vnoise3(n.x * 1.5 - o, n.y * 1.5, n.z * 1.5) * lumpy;
    const rr = lump * (1 - (1 - m) * 0.05);
    vals[i] = m;
    let y = n.y * rr * 0.72;
    if (y < -0.05) y = -0.05 + (y + 0.05) * 0.15;
    pos.setXYZ(i, n.x * rr, y + 0.05, n.z * rr);
  }
  g.computeVertexNormals();
  paint(g, (_p, _n, i) => groove.clone().lerp(ridge, vals[i]));
  return g;
}

function brainLow(r: RNG, groove: THREE.Color, ridge: THREE.Color, freq: number, lumpy: number) {
  return brain(r, groove, ridge, freq, lumpy, 6);
}

function mergeVerts(g: THREE.BufferGeometry) {
  // PolyhedronGeometry는 비인덱스 → 정점 공유 인덱스로 변환
  const pos = g.attributes.position;
  const map = new Map<string, number>();
  const verts: number[] = [], idx: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let id = map.get(k);
    if (id === undefined) { id = verts.length / 3; map.set(k, id); verts.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
    idx.push(id);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setIndex(idx);
  return out;
}

/** 극좌표 격자 판 (탁상형·접시형·버섯 갓 공용) */
function polarSheet(rad: number, a0: number, a1: number, rings: number, segs: number, fn: (r: number, a: number) => [number, number, number]) {
  const verts: number[] = [], idx: number[] = [];
  for (let i = 0; i <= rings; i++) for (let j = 0; j <= segs; j++) {
    const rr = (i / rings) * rad, a = a0 + (a1 - a0) * (j / segs);
    verts.push(...fn(rr, a));
  }
  const W = segs + 1;
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function table(r: RNG, body: THREE.Color, rim: THREE.Color) {
  const R = 1, H = rand(r, 0.25, 0.4);
  const o = r() * 50;
  const disc = polarSheet(R, 0, Math.PI * 2, 9, 56, (rr, a) => {
    const edge = R * (0.82 + 0.18 * vnoise3(Math.cos(a) * 2 + o, Math.sin(a) * 2, 0));
    const rad = rr * edge / R;
    const y = H + 0.06 * (1 - (rr / R) ** 2) + vnoise3(Math.cos(a) * rad * 6, Math.sin(a) * rad * 6, o) * 0.015;
    return [Math.cos(a) * rad, y, Math.sin(a) * rad];
  });
  paint(disc, (p) => {
    const d = Math.hypot(p.x, p.z);
    const ridges = 0.85 + 0.15 * Math.sin(Math.atan2(p.z, p.x) * 90);
    return body.clone().multiplyScalar(ridges).lerp(rim, THREE.MathUtils.smoothstep(d, 0.65, 0.98));
  });
  const stem = segment(V3(0, 0, 0), V3(0.03, H, 0), 0.14, 0.07, 8);
  paint(stem, body.clone().multiplyScalar(0.7));
  return merge([disc, stem]);
}

function plate(r: RNG, body: THREE.Color, rim: THREE.Color) {
  const parts: THREE.BufferGeometry[] = [];
  const n = 3 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const a0 = rand(r, 0, Math.PI * 2), span = rand(r, 1.1, 2.0);
    const R = rand(r, 0.35, 0.65), y0 = rand(r, 0.05, 0.35), curl = rand(r, 0.3, 0.8);
    const g = polarSheet(R, a0, a0 + span, 6, 18, (rr, a) => {
      const wav = Math.sin(a * 7 + i) * 0.03 * (rr / R);
      return [Math.cos(a) * rr, y0 + curl * rr * rr + wav, Math.sin(a) * rr];
    });
    paint(g, (p) => body.clone().lerp(rim, THREE.MathUtils.smoothstep(Math.hypot(p.x, p.z), R * 0.6, R)));
    parts.push(g);
  }
  return merge(parts);
}

function sarcophyton(r: RNG, cap: THREE.Color) {
  const R = rand(r, 0.35, 0.5), H = rand(r, 0.18, 0.3), folds = 5 + Math.floor(r() * 5);
  const top = polarSheet(R, 0, Math.PI * 2, 8, 64, (rr, a) => [Math.cos(a) * rr, H + Math.sin(a * folds) * 0.09 * (rr / R) ** 2, Math.sin(a) * rr]);
  paint(top, (p) => cap.clone().multiplyScalar(0.85 + 0.15 * Math.sin(p.x * 80) * Math.sin(p.z * 80)), (p) => p.y * 0.6);
  const stalk = segment(V3(), V3(0, H, 0), R * 0.55, R * 0.4, 12);
  paint(stalk, cap.clone().lerp(hex('#e8e0c8'), 0.5), (p) => p.y * 0.4);
  return merge([top, stalk]);
}

function dendro(r: RNG, polyp: THREE.Color) {
  const parts: THREE.BufferGeometry[] = [];
  const trunkC = hex('#f2dfe8');
  const ball = new THREE.IcosahedronGeometry(1, 0);
  const tree = (a: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, d: number) => {
    const b = a.clone().addScaledVector(dir, len);
    const s = segment(a, b, rad, rad * 0.7, 5);
    paint(s, trunkC, (p) => Math.max(0, p.y) ** 1.3 * 1.6);
    parts.push(s);
    if (d >= 3) {
      for (let k = 0; k < 2; k++) {
        const bb = mergeVerts(ball.clone());
        const sc = rand(r, 0.07, 0.1);
        bb.scale(sc, sc, sc);
        bb.translate(b.x + rand(r, -0.06, 0.06), b.y + rand(r, -0.03, 0.06), b.z + rand(r, -0.06, 0.06));
        paint(bb, polyp.clone().multiplyScalar(rand(r, 0.85, 1.1)), (p) => Math.max(0, p.y) ** 1.3 * 1.6);
        parts.push(bb);
      }
      return;
    }
    for (let k = 0; k < 3; k++) {
      const nd = dir.clone().add(V3(rand(r, -0.8, 0.8), rand(r, 0, 0.4), rand(r, -0.8, 0.8))).normalize();
      tree(b, nd, len * 0.72, rad * 0.65, d + 1);
    }
  };
  tree(V3(), V3(0, 1, 0), rand(r, 0.25, 0.35), 0.06, 0);
  return merge(parts);
}

function sinularia(r: RNG, c: THREE.Color) {
  const parts: THREE.BufferGeometry[] = [];
  const n = 6 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const a = rand(r, 0, Math.PI * 2), d = rand(r, 0, 0.25);
    const base = V3(Math.cos(a) * d, 0, Math.sin(a) * d);
    const top = base.clone().add(V3(rand(r, -0.08, 0.08), rand(r, 0.2, 0.42), rand(r, -0.08, 0.08)));
    const s = segment(base, top, rand(r, 0.05, 0.08), 0.035, 7, true);
    paint(s, c.clone().multiplyScalar(rand(r, 0.85, 1.1)), (p) => Math.max(0, p.y) * 1.2);
    parts.push(s);
  }
  return merge(parts);
}

function seaFan(r: RNG) {
  const parts: THREE.BufferGeometry[] = [];
  const grow = (a: THREE.Vector3, ang: number, len: number, rad: number, d: number) => {
    const b = a.clone().add(V3(Math.sin(ang) * len, Math.cos(ang) * len, rand(r, -0.015, 0.015)));
    const s = segment(a, b, rad, rad * 0.8, 4);
    paint(s, hex('#ffffff'), (p) => Math.max(0, p.y) ** 1.5 * 0.5);
    parts.push(s);
    if (d >= 6 || len < 0.04) return;
    const spread = rand(r, 0.25, 0.55);
    grow(b, ang - spread, len * rand(r, 0.72, 0.88), rad * 0.78, d + 1);
    grow(b, ang + spread, len * rand(r, 0.72, 0.88), rad * 0.78, d + 1);
  };
  grow(V3(), rand(r, -0.1, 0.1), 0.22, 0.03, 0);
  return merge(parts);
}

function tubes(r: RNG) {
  const parts: THREE.BufferGeometry[] = [];
  const n = 3 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const a = rand(r, 0, Math.PI * 2), d = rand(r, 0, 0.18);
    const h = rand(r, 0.3, 0.9), rad = rand(r, 0.05, 0.09);
    const base = V3(Math.cos(a) * d, 0, Math.sin(a) * d);
    const top = base.clone().add(V3(rand(r, -0.1, 0.1), h, rand(r, -0.1, 0.1)));
    const outer = segment(base, top, rad * 0.8, rad, 14);
    paint(outer, (p) => new THREE.Color(1, 1, 1).multiplyScalar(0.8 + 0.2 * Math.sin(p.y * 60)), (p) => Math.max(0, p.y) * 0.15);
    const inner = segment(base.clone().add(V3(0, h * 0.3, 0)), top, rad * 0.62, rad * 0.86, 14);
    inner.scale(1, 1, 1);
    paint(inner, new THREE.Color(0.25, 0.22, 0.25), (p) => Math.max(0, p.y) * 0.15);
    parts.push(outer, inner);
  }
  return merge(parts);
}

function lathe(r: RNG, profile: [number, number][], ribs: number, c: THREE.Color) {
  const pts = profile.map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 28);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = V3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const a = Math.atan2(p.z, p.x);
    const k = 1 + Math.abs(Math.sin(a * ribs)) * 0.06 + vnoise3(p.x * 4, p.y * 4, p.z * 4) * 0.04;
    pos.setXYZ(i, p.x * k, p.y, p.z * k);
  }
  g.computeVertexNormals();
  paint(g, (pp) => c.clone().multiplyScalar(0.75 + 0.25 * Math.abs(Math.sin(Math.atan2(pp.z, pp.x) * ribs))));
  void r;
  return g;
}

function whip(r: RNG) {
  const pts: THREE.Vector3[] = [];
  const h = rand(r, 1.0, 1.8), tw = rand(r, 2, 5);
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push(V3(Math.sin(t * tw) * 0.12 * t, t * h, Math.cos(t * tw) * 0.12 * t - 0.12 * t));
  }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.012, 5, false);
  paint(g, hex('#ffffff'), (p) => (p.y / h) ** 1.5 * 1.2);
  return g;
}

function rock(r: RNG, size: number) {
  let g: THREE.BufferGeometry = mergeVerts(new THREE.IcosahedronGeometry(1, 6));
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = V3(), o = r() * 100;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const k = 1 + vnoise3(p.x * 1.4 + o, p.y * 1.4, p.z * 1.4) * 0.35 + vnoise3(p.x * 4, p.y * 4 + o, p.z * 4) * 0.1;
    let y = p.y * k * 0.6;
    if (y < 0) y *= 0.3;
    pos.setXYZ(i, p.x * k, y, p.z * k);
  }
  g.computeVertexNormals();
  const coralline = hex('#b07a9a'), turf = hex('#7d7a58'), stone = hex('#8a8178');
  paint(g, (pp, n) => {
    const t = vnoise3(pp.x * 2.5 + o, pp.y * 2.5, pp.z * 2.5);
    const c = stone.clone().lerp(turf, Math.max(0, n.y) * 0.6).lerp(coralline, THREE.MathUtils.smoothstep(t, 0.0, 0.5) * 0.8);
    return c;
  });
  g.scale(size, size, size);
  return g;
}

// ───────── 팔레트 (전 세계 산호초 수중 사진 기반, 형광 과장 없이) ─────────
const C = (...h: string[]) => h.map(hex);
const PAL = {
  acroBase: C('#8a6a48', '#7a5f86', '#8c7350', '#5f73a8', '#9a7a52'),
  acroTip: C('#9fd6f5', '#d08cf0', '#ff9ec6', '#f0dca0', '#7fe0c0', '#c2f060', '#8fb0ff', '#ffb070'),
  tableBody: C('#7c8a5d', '#8d7b5b', '#6f908b', '#857a9a'),
  tableRim: C('#e8dfc2', '#bcdcea', '#d9eab0'),
  brainG: C('#5f6a38', '#6b4a32', '#3f6457', '#7a3434', '#5a5a78'),
  brainR: C('#c9c06e', '#d6a26f', '#a8e2c2', '#e47c5c', '#b7b7ef'),
  porites: C('#b89a6a', '#a07a9a', '#9aa86a', '#c2a46e', '#a6b46a'),
  plate: C('#6a5a8c', '#8a6a4a', '#9fa04e', '#5d7f9e', '#b07090'),
  plateRim: C('#ddd0f2', '#e8d8b8', '#e6f2a8'),
  sarco: C('#cbb982', '#9db382', '#d3a3b3', '#b8c8a0'),
  dendro: C('#e3405f', '#f283b3', '#a453c4', '#f39043', '#ffd0e0'),
  sinu: C('#a39a7a', '#c1b9a1', '#93a08a'),
  fan: C('#d04131', '#e98232', '#e8c442', '#9542a4', '#e85a8a'),
  tube: C('#9a6ac8', '#e2a332', '#c752a3', '#5182cb', '#e86f3c'),
  barrel: C('#8a4a3a', '#a2615a', '#7e5a4a'),
  vase: C('#3f88e3', '#8a5ae2', '#56b8d8'),
  whip: C('#d7d24a', '#9bd04a', '#e98b3a'),
  white: C('#ffffff', '#f2f2f2', '#e6e6e6'),
};

function buildVariants(r: RNG): Variant[] {
  const v: Variant[] = [];
  const add = (kind: Kind, geo: THREE.BufferGeometry, tints: THREE.Color[], scale: [number, number]) => v.push({ kind, geo, tints, scale });
  for (let i = 0; i < 5; i++) add('staghorn', staghorn(r, pick(r, PAL.acroBase), pick(r, PAL.acroTip)), PAL.white, [1.2, 2.2]);
  for (let i = 0; i < 3; i++) add('digitate', staghorn(r, pick(r, PAL.acroBase), pick(r, PAL.acroTip), true), PAL.white, [1.0, 1.7]);
  for (let i = 0; i < 4; i++) add('table', table(r, PAL.tableBody[i % 4], pick(r, PAL.tableRim)), PAL.white, [0.8, 1.7]);
  for (let i = 0; i < 4; i++) add('brain', brain(r, PAL.brainG[i], PAL.brainR[i], rand(r, 6, 10)), PAL.white, [0.45, 1.05]);
  for (let i = 0; i < 2; i++) add('porites', brainLow(r, hex('#d0d0d0'), hex('#ffffff'), 30, 0.3), PAL.porites, [0.45, 1.1]);
  for (let i = 0; i < 4; i++) add('plate', plate(r, PAL.plate[i], pick(r, PAL.plateRim)), PAL.white, [1.0, 2.0]);
  for (let i = 0; i < 2; i++) add('sarcophyton', sarcophyton(r, hex('#ffffff')), PAL.sarco, [0.9, 1.7]);
  for (let i = 0; i < 3; i++) add('dendro', dendro(r, hex('#ffffff')), PAL.dendro, [0.8, 1.5]);
  for (let i = 0; i < 2; i++) add('sinularia', sinularia(r, hex('#ffffff')), PAL.sinu, [1.0, 1.7]);
  for (let i = 0; i < 3; i++) add('fan', seaFan(r), PAL.fan, [1.2, 3.0]);
  for (let i = 0; i < 2; i++) add('tube', tubes(r), PAL.tube, [0.8, 1.5]);
  add('barrel', lathe(r, [[0.0, 0], [0.35, 0], [0.45, 0.2], [0.55, 0.6], [0.6, 0.95], [0.48, 1.0], [0.4, 0.75], [0.0, 0.7]], 12, hex('#ffffff')), PAL.barrel, [0.6, 1.4]);
  add('vase', lathe(r, [[0.0, 0], [0.08, 0], [0.12, 0.2], [0.25, 0.5], [0.38, 0.7], [0.33, 0.72], [0.2, 0.52], [0.0, 0.45]], 5, hex('#ffffff')), PAL.vase, [0.6, 1.2]);
  for (let i = 0; i < 2; i++) add('whip', whip(r), PAL.whip, [0.8, 1.2]);
  for (let i = 0; i < 4; i++) add('rock', rock(r, 1), PAL.white, [0.4, 1.4]);
  for (const it of v) bakeSurface(it.geo, it.kind);
  return v;
}

// 표면 디테일 종류 (프래그먼트에서 픽셀 단위 요철로 그림)
const PATTERN: Record<Kind, number> = {
  staghorn: 2, digitate: 2, porites: 2, brain: 1, table: 3, plate: 3, sarcophyton: 4, dendro: 4, sinularia: 4,
  whip: 4, fan: 5, tube: 6, barrel: 6, vase: 6, rock: 7,
};

/** 높이·중심 거리 기반 앰비언트 오클루전을 정점색에 굽고, 표면 패턴 ID 부여 */
function bakeSurface(g: THREE.BufferGeometry, kind: Kind) {
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const H = Math.max(bb.max.y - bb.min.y, 1e-3);
  const R = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.5 + 1e-3;
  const pos = g.attributes.position, col = g.attributes.color as THREE.BufferAttribute;
  const n = pos.count;
  const pat = new Float32Array(n).fill(PATTERN[kind]);
  const bushy = kind === 'staghorn' || kind === 'digitate' || kind === 'dendro' || kind === 'sinularia' || kind === 'fan';
  for (let i = 0; i < n; i++) {
    const y = (pos.getY(i) - bb.min.y) / H;
    const rr = Math.hypot(pos.getX(i), pos.getZ(i)) / R;
    let ao = 0.42 + 0.58 * THREE.MathUtils.smoothstep(y, 0, 0.75);
    if (bushy) ao *= 0.7 + 0.3 * THREE.MathUtils.smoothstep(rr, 0.1, 0.8);
    if (kind === 'table' || kind === 'plate') ao = pos.getY(i) < bb.max.y - H * 0.3 ? 0.55 : 1.0;
    col.setXYZ(i, col.getX(i) * ao, col.getY(i) * ao, col.getZ(i) * ao);
  }
  g.setAttribute('aPat', new THREE.BufferAttribute(pat, 1));
}

const CORAL_GLSL = /* glsl */ `
varying vec3 vLoc; varying float vPat;
float ch3(vec3 p){ return fract(sin(dot(mod(p, 289.0), vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float cn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ch3(i), ch3(i + vec3(1,0,0)), f.x), mix(ch3(i + vec3(0,1,0)), ch3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(ch3(i + vec3(0,0,1)), ch3(i + vec3(1,0,1)), f.x), mix(ch3(i + vec3(0,1,1)), ch3(i + vec3(1,1,1)), f.x), f.y), f.z); }
// 산호 표면 미세 높이 (0~1) + 주파수(앨리어싱 페이드용) + 범프 세기
vec3 coralH(vec3 p, float k) {
  if (k < 0.5) return vec3(0.0);
  if (k < 1.5) { float w = cn3(p * 3.0) * 3.0 + cn3(p * 8.0) * 0.7; return vec3(1.0 - abs(sin((p.x * 1.2 + p.z * 0.8 + p.y * 0.5 + w) * 9.0)), 30.0, 0.022); }
  if (k < 2.5) { float n = cn3(p * 52.0); return vec3(smoothstep(0.5, 0.85, n) * 0.7 + cn3(p * 15.0) * 0.3, 52.0, 0.0022); }
  if (k < 3.5) { float a = atan(p.z, p.x); return vec3((0.5 + 0.5 * sin(a * 70.0 + cn3(p * 8.0) * 8.0)) * 0.35 + cn3(p * 35.0) * 0.65, 35.0, 0.0012); }
  if (k < 4.5) { return vec3(cn3(p * 70.0) * 0.65 + cn3(p * 22.0) * 0.35, 70.0, 0.004); }
  if (k < 5.5) { return vec3(cn3(p * 60.0), 60.0, 0.002); }
  if (k < 6.5) { return vec3(1.0 - smoothstep(0.62, 0.82, cn3(p * 26.0)) * 0.8, 26.0, 0.005); }
  return vec3(cn3(p * 6.0) * 0.6 + cn3(p * 21.0) * 0.4, 21.0, 0.02);
}
`;

// 수심대별 산호 구성 비율
function weights(depth: number, steep: number): Partial<Record<Kind, number>> {
  if (depth < 8) return { staghorn: 0.26, digitate: 0.1, table: 0.14, brain: 0.1, porites: 0.05, plate: 0.08, sarcophyton: 0.09, sinularia: 0.07, dendro: 0.03, tube: 0.03, rock: 0.05 };
  if (depth < 18) return { staghorn: 0.1, digitate: 0.03, table: 0.04, brain: 0.09, porites: 0.12, plate: 0.15, sarcophyton: 0.05, sinularia: 0.05, dendro: 0.1, fan: 0.08 + steep * 0.1, tube: 0.08, barrel: 0.04, vase: 0.04, rock: 0.05 };
  return { fan: 0.24, dendro: 0.15, barrel: 0.14, tube: 0.12, vase: 0.08, whip: 0.1, plate: 0.05, porites: 0.05, rock: 0.07 };
}

function chooseKind(r: RNG, w: Partial<Record<Kind, number>>): Kind {
  let s = 0;
  for (const k in w) s += w[k as Kind]!;
  let x = r() * s;
  for (const k in w) { x -= w[k as Kind]!; if (x <= 0) return k as Kind; }
  return 'rock';
}

export interface CoralInfo { x: number; y: number; z: number; kind: Kind; size: number }

export class CoralReef {
  group = new THREE.Group();
  cells: { center: THREE.Vector3; meshes: THREE.InstancedMesh[] }[] = [];
  /** 생물들이 참고하는 산호 위치 (앵무고기 섭식, 군집 회유 등) */
  points: CoralInfo[] = [];
  material: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, density: number) {
    const r = mulberry32(2024);
    const variants = buildVariants(r);
    this.material = patchWater(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0, side: THREE.DoubleSide }), {
      key: 'coral',
      extend: (sh) => {
        sh.uniforms.uTime = waterUniforms.uTime;
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\n' + CORAL_GLSL)
          .replace('#include <color_fragment>', `#include <color_fragment>
            // 카메라에 너무 가까운 산호는 디더링으로 사라짐 (카메라가 산호 속으로 파고드는 장면 방지)
            {
              float camD = length(vWPos - cameraPosition);
              float dith = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
              if (camD < 0.3 + dith * 0.35) discard;
            }
            vec3 cHd = coralH(vLoc, vPat);
            float cPx = length(fwidth(vLoc)) * cHd.y;
            float cFade = 1.0 - smoothstep(0.25, 0.9, cPx);
            float cH = mix(0.5, cHd.x, cFade);
            diffuseColor.rgb *= 0.86 + 0.24 * cH;
            if (vPat > 3.5 && vPat < 4.5) diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.35 + 0.04, smoothstep(0.7, 0.9, cH) * cFade);`)
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
            {
              vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
              float hx = dFdx(cH), hy = dFdy(cH);
              vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
              float det = dot(dpx, r1);
              if (abs(det) > 1e-12) {
                vec3 grad = sign(det) * (hx * r1 + hy * r2);
                normal = normalize(abs(det) * normal - grad * cHd.z * cFade * 25.0);
              }
            }`);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aSway; attribute float aPat; uniform float uTime; varying vec3 vLoc; varying float vPat;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vLoc = position; vPat = aPat;
            {
              #ifdef USE_INSTANCING
                vec2 ip = instanceMatrix[3].xz;
              #else
                vec2 ip = vec2(0.0);
              #endif
              float ph = dot(ip, vec2(0.11, 0.07));
              // 파도가 만드는 왕복 서지(surge) + 잔잔한 흔들림
              float s = sin(uTime * 0.85 + ph) * 0.7 + sin(uTime * 1.9 + ph * 1.7) * 0.3;
              transformed.x += s * aSway * 0.09;
              transformed.z += cos(uTime * 0.6 + ph * 1.3) * aSway * 0.035;
            }`);
      },
    });

    // 배치
    const CELL = 36;
    const buckets = new Map<string, { v: number; m: THREE.Matrix4; c: THREE.Color }[]>();
    const step = 1.05 / Math.sqrt(density);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), s = V3(), m = new THREE.Matrix4();
    const up = V3(0, 1, 0), nrm = V3();
    for (let x = -72; x < 72; x += step) for (let z = -118; z < 48; z += step) {
      const px = x + rand(r, -0.5, 0.5) * step, pz = z + rand(r, -0.5, 0.5) * step;
      const d = coralDensity(px, pz);
      if (r() > d * 1.15) continue;
      const h = heightAt(px, pz);
      const depth = -h;
      const [nx, ny, nz] = normalAt(px, pz);
      nrm.set(nx, ny, nz);
      const steep = 1 - ny;
      const kind = chooseKind(r, weights(depth, steep));
      const opts = variants.filter((v) => v.kind === kind);
      const vi = variants.indexOf(pick(r, opts));
      const va = variants[vi];
      let sc = rand(r, va.scale[0], va.scale[1]);
      if (kind === 'fan' && depth < 12) sc *= 0.6;
      if (depth < 2.5) sc *= 0.6; // 수면 가까이는 작게
      // 경사면에서는 바닥 법선 쪽으로 기울어짐 (부채산호는 해류에 수직으로 서 있음)
      const tiltTo = kind === 'fan' || kind === 'whip' ? up : up.clone().lerp(nrm, 0.6).normalize();
      q.setFromUnitVectors(up, tiltTo);
      const yaw = kind === 'fan' ? Math.PI / 2 + rand(r, -0.3, 0.3) : rand(r, 0, Math.PI * 2);
      q.multiply(new THREE.Quaternion().setFromEuler(e.set(0, yaw, 0)));
      s.set(sc, sc * (kind === 'rock' ? rand(r, 0.6, 1.2) : rand(r, 0.85, 1.15)), sc);
      m.compose(V3(px, h - 0.04 * sc, pz), q, s);
      const tint = pick(r, va.tints).clone().multiplyScalar(rand(r, 0.82, 1.08));
      const key = `${Math.floor(px / CELL)},${Math.floor(pz / CELL)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push({ v: vi, m: m.clone(), c: tint });
      // 가지형 산호는 군락(thicket)을 이룸
      if ((kind === 'staghorn' || kind === 'digitate' || kind === 'sinularia') && depth < 14) {
        const extra = Math.floor(r() * (density < 0.8 ? 1.6 : 2.6));
        for (let k = 0; k < extra; k++) {
          const ox = px + rand(r, -0.9, 0.9) * sc, oz = pz + rand(r, -0.9, 0.9) * sc;
          const oh = heightAt(ox, oz);
          const q2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(r, -0.15, 0.15), rand(r, 0, 6.28), rand(r, -0.15, 0.15)));
          const s2 = sc * rand(r, 0.7, 1.05);
          const v2 = variants.indexOf(pick(r, opts));
          buckets.get(key)!.push({ v: v2, m: new THREE.Matrix4().compose(V3(ox, oh - 0.03, oz), q2, V3(s2, s2, s2)), c: tint.clone().multiplyScalar(rand(r, 0.9, 1.1)) });
        }
      }
      if (kind !== 'rock') this.points.push({ x: px, y: h, z: pz, kind, size: sc });
    }

    // 해저 접촉 그림자 텍스처
    const SN = 512, rect = reefShadow.uReefShadowRect.value;
    const acc = new Float32Array(SN * SN);
    const pv = new THREE.Vector3(), ps = new THREE.Vector3();
    for (const [, list] of buckets) for (const it of list) {
      it.m.decompose(pv, q, ps);
      const kind = variants[it.v].kind;
      const foot = (kind === 'table' ? 1.0 : kind === 'fan' || kind === 'whip' ? 0.25 : kind === 'rock' ? 0.9 : 0.6) * ps.x;
      const cx = ((pv.x - rect.x) / rect.z) * SN, cz = ((pv.z - rect.y) / rect.w) * SN;
      const rp = Math.max(1.2, (foot / rect.z) * SN * 1.6);
      for (let y = Math.floor(cz - rp); y <= cz + rp; y++) for (let x = Math.floor(cx - rp); x <= cx + rp; x++) {
        if (x < 0 || y < 0 || x >= SN || y >= SN) continue;
        const d2 = ((x - cx) ** 2 + (y - cz) ** 2) / (rp * rp);
        if (d2 < 1) acc[y * SN + x] += (1 - d2) ** 2 * (kind === 'table' ? 0.9 : 0.6);
      }
    }
    const sdata = new Uint8Array(SN * SN * 4);
    for (let i = 0; i < SN * SN; i++) { const v = Math.min(1, acc[i]) * 255; sdata[i * 4] = v; sdata[i * 4 + 3] = 255; }
    const stex = new THREE.DataTexture(sdata, SN, SN, THREE.RGBAFormat);
    stex.magFilter = THREE.LinearFilter; stex.minFilter = THREE.LinearFilter; stex.needsUpdate = true;
    reefShadow.uReefShadow.value = stex;

    for (const [key, list] of buckets) {
      const [cx, cz] = key.split(',').map(Number);
      const meshes: THREE.InstancedMesh[] = [];
      const byV = new Map<number, typeof list>();
      for (const it of list) { if (!byV.has(it.v)) byV.set(it.v, []); byV.get(it.v)!.push(it); }
      for (const [vi, items] of byV) {
        const im = new THREE.InstancedMesh(variants[vi].geo, this.material, items.length);
        im.userData.kind = variants[vi].kind;
        items.forEach((it, i) => { im.setMatrixAt(i, it.m); im.setColorAt(i, it.c); });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        meshes.push(im);
        this.group.add(im);
      }
      this.cells.push({ center: V3((cx + 0.5) * CELL, -8, (cz + 0.5) * CELL), meshes });
    }
    scene.add(this.group);
    void dropFactor;
  }

  /** 안개 너머 셀은 아예 그리지 않음 */
  update(camera: THREE.Camera, maxDist: number) {
    const cp = camera.position;
    for (const c of this.cells) {
      const d = Math.hypot(c.center.x - cp.x, c.center.z - cp.z);
      const vis = d < maxDist + 26;
      for (const m of c.meshes) m.visible = vis;
    }
  }

  stats() {
    let inst = 0, verts = 0;
    for (const c of this.cells) for (const m of c.meshes) { inst += m.count; verts += m.count * m.geometry.attributes.position.count; }
    return { inst, verts, draws: this.cells.reduce((a, c) => a + c.meshes.length, 0) };
  }
}

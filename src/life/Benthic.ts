// 바닥을 기어다니는 생물 (저서생물)
//  비단닭새우 · 볼록산호게 · 소라게 · 문 가리비 · 나팔고둥
//  종마다 InstancedMesh 1개 (드로우콜 최소화) — 다리·더듬이·집게·껍데기 움직임은 버텍스 셰이더에서,
//  위치·방향·행동(걷기/도망/숨기/헤엄)은 CPU에서 개체별 상태머신으로 처리
import * as THREE from 'three';
import { patchWater, waterUniforms } from '../water/WaterShading';
import { heightAt, normalAt, coralDensity, dropFactor } from '../world/terrain';
import { mulberry32, rand, vnoise3, clamp, dampAngle, type RNG } from '../core/math';
import { seeded, h01 } from './Ecology';
import type { SpeciesDef, DiverInfo, Creature } from './types';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const C = (h: string) => new THREE.Color(h);

type Kind = 0 | 1 | 2 | 3 | 4; // 닭새우, 게, 소라게, 가리비, 나팔고둥
// 부위 코드 (셰이더 aPart)
const BODY = 0, LEG = 1, ANT = 2, CLAW = 3, FAN = 4, VALVE = 5, SOFT = 6, FOOT = 8, MANTLE = 9;

// ───────── 지오메트리 도구 ─────────
type ColFn = (p: THREE.Vector3, w: number) => THREE.Color;
interface PartOpts { part?: number; ph?: number; root?: THREE.Vector3; w?: (p: THREE.Vector3, uv: THREE.Vector2) => number }

function part(geo: THREE.BufferGeometry, color: THREE.Color | ColFn, o: PartOpts = {}) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position as THREE.BufferAttribute, uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  const n = pos.count;
  const col = new Float32Array(n * 3), pa = new Float32Array(n), ph = new Float32Array(n), w = new Float32Array(n), root = new Float32Array(n * 3);
  const p = V3(), u = new THREE.Vector2();
  const r = o.root ?? V3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    if (uv) u.fromBufferAttribute(uv, i); else u.set(0, 0);
    const wi = o.w ? o.w(p, u) : 0;
    const c = typeof color === 'function' ? color(p, wi) : color;
    col.set([c.r, c.g, c.b], i * 3);
    pa[i] = o.part ?? BODY; ph[i] = o.ph ?? 0; w[i] = wi;
    root.set([r.x, r.y, r.z], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aPart', new THREE.BufferAttribute(pa, 1));
  geo.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  geo.setAttribute('aW', new THREE.BufferAttribute(w, 1));
  geo.setAttribute('aRoot', new THREE.BufferAttribute(root, 3));
  return geo;
}

const ATTRS: [string, number][] = [['position', 3], ['normal', 3], ['color', 3], ['aPart', 1], ['aPh', 1], ['aW', 1], ['aRoot', 3]];
function mergeParts(list: THREE.BufferGeometry[]) {
  let total = 0, ti = 0;
  for (const g of list) { total += g.attributes.position.count; ti += g.index ? g.index.count : g.attributes.position.count; }
  const out = ATTRS.map(([, s]) => new Float32Array(total * s));
  const idx = new Uint32Array(ti);
  let vo = 0, io = 0;
  for (const g of list) {
    ATTRS.forEach(([k, s], a) => out[a].set((g.attributes[k] as THREE.BufferAttribute).array as Float32Array, vo * s));
    const c = g.attributes.position.count;
    if (g.index) { const ia = g.index.array; for (let i = 0; i < ia.length; i++) idx[io++] = ia[i] + vo; }
    else for (let i = 0; i < c; i++) idx[io++] = i + vo;
    vo += c;
  }
  const geo = new THREE.BufferGeometry();
  ATTRS.forEach(([k, s], a) => geo.setAttribute(k, new THREE.BufferAttribute(out[a], s)));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

function ellipsoid(r: THREE.Vector3, at: THREE.Vector3, seg = 18, rings = 12) {
  const g = new THREE.SphereGeometry(1, seg, rings);
  g.scale(r.x, r.y, r.z); g.translate(at.x, at.y, at.z);
  return g;
}
function tube(pts: THREE.Vector3[], r0: number, r1: number, seg = 10, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  // 반지름을 길이에 따라 가늘게 (uv.x = 0 → 1)
  const pos = g.attributes.position, uv = g.attributes.uv, nrm = g.attributes.normal;
  const c = V3(), p = V3(), n = V3();
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i);
    curve.getPointAt(Math.min(u, 1), c);
    p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nrm, i);
    const rr = THREE.MathUtils.lerp(r0, r1, u);
    p.copy(c).addScaledVector(n, rr);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  return g;
}
const alongW = (_p: THREE.Vector3, uv: THREE.Vector2) => uv.x;

/** 나선 고둥 껍데기: 꼭지(apex)에서 입구까지 점점 커지는 구를 나선으로 이어 붙임 */
function spiralShell(len: number, rad: number, turns: number, color: (t: number, ang: number, p: THREE.Vector3) => THREE.Color, apex: THREE.Vector3, base: THREE.Vector3, N = 26, taper = 1.25, elong = 1.15) {
  const parts: THREE.BufferGeometry[] = [];
  const axis = base.clone().sub(apex).normalize();
  const side = V3(0, 1, 0).cross(axis).normalize(), up = axis.clone().cross(side).normalize();
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const size = rad * (0.08 + 0.92 * t ** taper);
    const ang = t * turns * Math.PI * 2;
    const c = apex.clone().lerp(base, t ** 0.85).addScaledVector(side, Math.cos(ang) * size * 0.55).addScaledVector(up, Math.sin(ang) * size * 0.45);
    const g = ellipsoid(V3(size, size * 0.9, size * elong), V3(), 14, 10);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), axis);
    g.applyQuaternion(q); g.translate(c.x, c.y, c.z);
    parts.push(part(g, (p) => color(t, ang, p)));
  }
  void len;
  return parts;
}

// ───────── 종별 형태 ─────────
function lobsterGeo() {
  // Panulirus versicolor: 청록 갑각에 흰·검정 줄, 분홍빛 더듬이 기부, 흰 줄무늬 다리
  const P: THREE.BufferGeometry[] = [];
  const cara = (p: THREE.Vector3) => {
    const n = vnoise3(p.x * 60, p.y * 60, p.z * 60);
    const band = Math.abs(Math.sin(p.z * 70)) > 0.93 ? 1 : 0;
    return C('#2c6e7e').lerp(C('#163a4c'), 0.5 + n * 0.5).lerp(C('#e8f0f0'), band * 0.7);
  };
  P.push(part(ellipsoid(V3(0.068, 0.056, 0.13), V3(0, 0.08, 0.07)), cara));
  // 갑각 가시
  for (let i = 0; i < 10; i++) {
    const s = i % 2 ? 1 : -1, z = 0.02 + Math.floor(i / 2) * 0.03;
    const g = new THREE.ConeGeometry(0.006, 0.022, 5); g.rotateX(-0.6); g.rotateZ(-s * 0.5); g.translate(s * 0.04, 0.13, z);
    P.push(part(g, C('#f0a070')));
  }
  // 앞쪽 큰 뿔 한 쌍
  for (const s of [-1, 1]) { const g = new THREE.ConeGeometry(0.012, 0.05, 6); g.rotateX(Math.PI / 2 - 0.5); g.translate(s * 0.03, 0.12, 0.19); P.push(part(g, C('#f2c090'))); }
  // 꼬리 마디 6개: 짙은 남색 + 마디 끝 흰 띠
  for (let i = 0; i < 6; i++) {
    const k = 1 - i * 0.05, z = -0.035 - i * 0.042;
    const g = ellipsoid(V3(0.062 * k, 0.045 * k, 0.03), V3(0, 0.07 - i * 0.004, z), 16, 10);
    P.push(part(g, (p) => (p.z < z - 0.018 ? C('#f2f4f0') : C('#1d2f62').lerp(C('#0f1c40'), vnoise3(p.x * 80, p.y * 80, p.z * 80) * 0.5 + 0.5)), { part: FAN, root: V3(0, 0.07, -0.02), w: (p) => clamp((-0.02 - p.z) / 0.3, 0, 1) * 0.6 }));
  }
  // 꼬리 부채 5장
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.38;
    const g = new THREE.CircleGeometry(0.05, 12); g.rotateX(-Math.PI / 2); g.scale(0.42, 1, 1); g.translate(0, 0, -0.045);
    g.rotateY(a); g.translate(0, 0.055, -0.29);
    P.push(part(g, (p) => C('#2a4a8a').lerp(C('#f0e6c0'), clamp((-0.31 - p.z) * 20, 0, 1) * 0.6), { part: FAN, root: V3(0, 0.07, -0.02), w: () => 1 }));
  }
  // 긴 더듬이 (두껍고 가시가 있는 기부 → 가늘게)
  for (const s of [-1, 1]) {
    const pts = [V3(s * 0.025, 0.1, 0.19), V3(s * 0.08, 0.16, 0.34), V3(s * 0.2, 0.2, 0.52), V3(s * 0.34, 0.2, 0.66)];
    const g = tube(pts, 0.013, 0.002, 24, 7);
    P.push(part(g, (_p, w) => C('#e7a2c0').lerp(C('#f6efe8'), clamp(w * 2, 0, 1)).lerp(C('#6a3a50'), Math.sin(w * 90) > 0.7 ? 0.4 : 0), { part: ANT, ph: s > 0 ? 0 : 2.1, w: alongW }));
    // 짧은 제1더듬이 (두 갈래)
    for (const f of [-1, 1]) {
      const g2 = tube([V3(s * 0.012, 0.09, 0.2), V3(s * 0.02, 0.11, 0.27), V3(s * 0.03 + f * 0.01, 0.13, 0.33)], 0.004, 0.0015, 8, 5);
      P.push(part(g2, C('#f0e0e8'), { part: ANT, ph: 1 + f, w: (p, uv) => uv.x * 0.5 }));
    }
    // 눈
    P.push(part(ellipsoid(V3(0.012, 0.012, 0.012), V3(s * 0.028, 0.115, 0.185), 10, 8), C('#050505')));
  }
  // 걷는 다리 5쌍: 흰-보라 줄무늬
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) {
    const z = 0.13 - i * 0.04;
    const pts = [V3(s * 0.05, 0.06, z), V3(s * 0.12, 0.1, z + 0.01), V3(s * 0.17, 0.05, z + 0.02 - i * 0.01), V3(s * 0.19, 0.0, z + 0.03 - i * 0.015)];
    const g = tube(pts, 0.008, 0.004, 14, 6);
    P.push(part(g, (_p, w) => (Math.sin(w * 26) > 0.2 ? C('#f4f0ea') : C('#4a3e7a')), { part: LEG, ph: i * 1.25 + (s > 0 ? Math.PI : 0), w: alongW }));
  }
  return mergeParts(P);
}

function crabGeo() {
  // Carpilius convexus: 매끈한 붉은 갑각 + 짙은 반점, 끝이 검은 집게
  const P: THREE.BufferGeometry[] = [];
  const shell = (p: THREE.Vector3) => {
    const n = vnoise3(p.x * 70 + 3, p.y * 70, p.z * 70);
    return C('#d2482a').lerp(C('#8a1e12'), n > 0.35 ? 0.75 : 0).lerp(C('#f0a070'), clamp((0.05 - p.y) * 25, 0, 1) * 0.5);
  };
  const g = ellipsoid(V3(0.085, 0.038, 0.062), V3(0, 0.055, 0), 22, 12); P.push(part(g, shell));
  P.push(part(ellipsoid(V3(0.075, 0.02, 0.055), V3(0, 0.035, 0)), C('#f0c8a0')));
  for (const s of [-1, 1]) {
    // 눈자루
    P.push(part(tube([V3(s * 0.02, 0.07, 0.05), V3(s * 0.024, 0.088, 0.058)], 0.004, 0.004, 3, 5), C('#c03a20')));
    P.push(part(ellipsoid(V3(0.007, 0.007, 0.007), V3(s * 0.024, 0.092, 0.06), 8, 6), C('#080808')));
    // 집게: 팔 + 손 + 두 손가락 (검은 끝)
    const root = V3(s * 0.06, 0.05, 0.045);
    const arm = tube([root, V3(s * 0.09, 0.06, 0.08), V3(s * 0.085, 0.065, 0.105)], 0.012, 0.012, 8, 7);
    const claw = (p: THREE.Vector3, w: number) => (w > 0.85 ? C('#151010') : shell(p));
    P.push(part(arm, claw, { part: CLAW, root, w: (p) => p.distanceTo(root) / 0.11 }));
    const hand = ellipsoid(V3(0.022, 0.02, 0.035), V3(s * 0.075, 0.065, 0.13), 12, 10);
    P.push(part(hand, claw, { part: CLAW, root, w: (p) => p.distanceTo(root) / 0.13 * 0.8 }));
    for (const f of [0, 1]) {
      const fg = new THREE.ConeGeometry(0.008, 0.035, 6); fg.rotateX(Math.PI / 2); fg.translate(s * 0.068 + (f ? s * 0.01 : 0), 0.06 + (f ? 0.008 : -0.006), 0.17);
      P.push(part(fg, C('#120c0c'), { part: CLAW, root, w: () => 1 }));
    }
    // 걷는 다리 4쌍 (옆으로 걷는 게 다리 각도)
    for (let j = 0; j < 4; j++) {
      const z = 0.02 - j * 0.024, back = j * 0.012;
      const pts = [V3(s * 0.075, 0.045, z), V3(s * 0.14, 0.075, z - back), V3(s * 0.18, 0.03, z - back * 1.6), V3(s * 0.19, 0.0, z - back * 2)];
      P.push(part(tube(pts, 0.007, 0.003, 12, 6), (_p, w) => C('#c8402a').lerp(C('#f0b090'), w * 0.4), { part: LEG, ph: j * 1.6 + (s > 0 ? Math.PI : 0), w: alongW }));
    }
  }
  return mergeParts(P);
}

function hermitGeo() {
  // Dardanus megistos: 흰 점(검은 테두리)이 있는 붉은 몸 + 커다란 빈 고둥 껍데기
  const P: THREE.BufferGeometry[] = [];
  const shellCol = (t: number, ang: number, p: THREE.Vector3) => C('#e6d6b4').lerp(C('#6a4426'), (Math.sin(ang * 3 + t * 26) > 0.35 ? 0.7 : 0) + vnoise3(p.x * 70, p.y * 70, p.z * 70) * 0.2);
  P.push(...spiralShell(0.14, 0.046, 3.2, shellCol, V3(0, 0.11, -0.1), V3(0, 0.052, 0.02), 44));
  const red = (p: THREE.Vector3) => {
    const n = vnoise3(p.x * 120, p.y * 120, p.z * 120);
    return n > 0.45 ? C('#f6f2ea') : n > 0.36 ? C('#151010') : C('#c22a1c');
  };
  const ap = V3(0, 0.05, 0.05); // 껍데기 입구 (숨을 때 모이는 지점)
  P.push(part(ellipsoid(V3(0.035, 0.03, 0.03), V3(0, 0.055, 0.07)), red, { part: SOFT, root: ap }));
  for (const s of [-1, 1]) {
    P.push(part(tube([V3(s * 0.012, 0.075, 0.09), V3(s * 0.016, 0.1, 0.105)], 0.003, 0.003, 3, 5), C('#e8d070'), { part: SOFT, root: ap }));
    P.push(part(ellipsoid(V3(0.005, 0.005, 0.005), V3(s * 0.016, 0.103, 0.107), 8, 6), C('#050505'), { part: SOFT, root: ap }));
    // 비대칭 집게 (왼쪽이 더 큼)
    const k = s < 0 ? 1.45 : 1.05;
    P.push(part(ellipsoid(V3(0.022 * k, 0.028 * k, 0.034 * k), V3(s * 0.032, 0.05, 0.105)), red, { part: SOFT, root: ap }));
    const fg = new THREE.ConeGeometry(0.008 * k, 0.03 * k, 6); fg.rotateX(Math.PI / 2); fg.translate(s * 0.032, 0.046, 0.14 + 0.01 * k);
    P.push(part(fg, C('#f2ece0'), { part: SOFT, root: ap }));
    for (let j = 0; j < 2; j++) {
      const z = 0.075 - j * 0.02;
      const pts = [V3(s * 0.03, 0.05, z), V3(s * 0.08, 0.06, z + 0.02), V3(s * 0.11, 0.0, z + 0.03 - j * 0.02)];
      P.push(part(tube(pts, 0.007, 0.004, 10, 6), (p, w) => (Math.sin(w * 20) > 0.6 ? C('#f2ece0') : red(p)), { part: LEG, ph: j * 2.2 + (s > 0 ? Math.PI : 0), w: alongW, root: ap }));
    }
    P.push(part(tube([V3(s * 0.01, 0.07, 0.09), V3(s * 0.05, 0.1, 0.16), V3(s * 0.08, 0.1, 0.22)], 0.002, 0.001, 10, 4), C('#d06040'), { part: ANT, ph: s, w: alongW, root: ap }));
  }
  return mergeParts(P);
}

function scallopGeo() {
  // Amusium pleuronectes: 매끈한 원반형 껍데기 (위 적갈색, 아래 흰색) + 외투막 가장자리의 푸른 눈들
  const P: THREE.BufferGeometry[] = [];
  const hinge = V3(0, 0.02, -0.06);
  const valve = (top: boolean) => {
    const g = new THREE.SphereGeometry(0.07, 28, 8, 0, Math.PI * 2, 0, Math.PI * 0.32);
    g.scale(1, 0.55, 1);
    if (!top) g.rotateX(Math.PI);
    g.translate(0, top ? -0.004 : 0.04, 0);
    // 경첩 쪽 귀 (스캘럽 특유의 날개)
    return g;
  };
  const rib = (p: THREE.Vector3) => Math.sin(Math.atan2(p.x, p.z + 0.06) * 22) * 0.5 + 0.5;
  const top = valve(true); top.translate(0, 0.0, 0);
  P.push(part(top, (p) => C('#a8503a').lerp(C('#e0a080'), rib(p) * 0.45).lerp(C('#5a2a20'), vnoise3(p.x * 60, 0, p.z * 60) > 0.4 ? 0.3 : 0), { part: VALVE, root: hinge }));
  const bot = valve(false); bot.translate(0, -0.006, 0);
  P.push(part(bot, (p) => C('#f4eee2').lerp(C('#d8c8b0'), rib(p) * 0.3)));
  for (const s of [-1, 1]) {
    const ear = new THREE.CircleGeometry(0.02, 3); ear.rotateX(-Math.PI / 2); ear.translate(s * 0.02, 0.025, -0.062);
    P.push(part(ear, C('#b86a50'), { part: VALVE, root: hinge }));
  }
  // 외투막 테두리 + 푸른 눈 (실제 가리비는 수십 개의 눈이 있음)
  const ring = new THREE.TorusGeometry(0.058, 0.0045, 6, 48); ring.rotateX(Math.PI / 2); ring.translate(0, 0.015, 0);
  P.push(part(ring, C('#e8d0a8'), { part: MANTLE, root: hinge }));
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    if (Math.cos(a) < -0.8) continue;
    const e = ellipsoid(V3(0.0035, 0.0035, 0.0035), V3(Math.sin(a) * 0.06, 0.017, Math.cos(a) * 0.06), 6, 4);
    P.push(part(e, C('#3ab8ff'), { part: MANTLE, root: hinge }));
  }
  return mergeParts(P);
}

function tritonGeo() {
  // Charonia tritonis: 크림색 바탕에 갈색 초승달 무늬가 있는 긴 나선 껍데기 + 주황 반점 발
  const P: THREE.BufferGeometry[] = [];
  const col = (t: number, ang: number, p: THREE.Vector3) => {
    const cres = Math.sin(ang * 1.0 + t * 40) > 0.2 && Math.sin(t * 90) > -0.3;
    return C('#efe2c4').lerp(C('#6a3a1e'), cres ? 0.75 : 0.05).lerp(C('#b07040'), vnoise3(p.x * 40, p.y * 40, p.z * 40) * 0.3);
  };
  P.push(...spiralShell(0.36, 0.06, 6, col, V3(0, 0.14, -0.25), V3(0, 0.075, 0.07), 80, 1.5, 1.9));
  const foot = (p: THREE.Vector3) => (vnoise3(p.x * 90, 0, p.z * 90) > 0.35 ? C('#3a2010') : C('#e07a30'));
  P.push(part(ellipsoid(V3(0.06, 0.02, 0.16), V3(0, 0.02, 0.02), 18, 8), foot, { part: FOOT }));
  P.push(part(tube([V3(0, 0.06, 0.12), V3(0, 0.08, 0.18), V3(0, 0.09, 0.22)], 0.012, 0.009, 6, 8), C('#d86a28'), { part: SOFT }));
  for (const s of [-1, 1]) P.push(part(tube([V3(s * 0.025, 0.035, 0.15), V3(s * 0.05, 0.04, 0.2)], 0.004, 0.002, 4, 5), C('#e09050'), { part: ANT, ph: s, w: alongW }));
  return mergeParts(P);
}

// ───────── 셰이더 ─────────
function benthicMaterial(kind: Kind) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: kind === 3 || kind === 4 ? 0.32 : 0.42, metalness: 0.04 });
  patchWater(mat, {
    key: 'benthic' + kind,
    extend: (sh) => {
      sh.uniforms.uTime = waterUniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          #define KIND ${kind}
          uniform float uTime;
          attribute float aPart; attribute float aPh; attribute float aW; attribute vec3 aRoot; attribute vec4 aInst;
          varying float vPartB;
          vec3 rotX(vec3 p, vec3 o, float a) { vec3 r = p - o; float c = cos(a), s = sin(a); return o + vec3(r.x, r.y * c + r.z * s, -r.y * s + r.z * c); }`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            float gait = aInst.x, mv = aInst.y, st = aInst.z, sd = aInst.w;
            vPartB = aPart;
            if (aPart > 0.5 && aPart < 1.5) {
              // 다리: 걸음 주기에 맞춰 앞뒤로 딛고 들어 올림 (게는 옆걸음)
              float s = sin(gait + aPh), lift = max(0.0, cos(gait + aPh));
              vec3 dir = KIND == 1 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
              transformed += dir * s * 0.028 * aW * mv;
              transformed.y += lift * 0.022 * aW * mv;
              transformed.y += sin(uTime * 2.3 + aPh * 3.0 + sd * 7.0) * 0.002 * aW;
            } else if (aPart > 1.5 && aPart < 2.5) {
              // 더듬이: 물살에 흔들리며 주변을 더듬음
              float k = aW * aW;
              transformed.x += sin(uTime * 1.1 + sd * 5.0 + aPh + aW * 2.5) * 0.07 * k;
              transformed.y += cos(uTime * 0.8 + sd * 3.0 + aPh * 1.7) * 0.04 * k;
            } else if (aPart > 2.5 && aPart < 3.5) {
              // 집게: 위협할 때 치켜듦 + 평소 살짝 오므렸다 폄
              transformed = rotX(transformed, aRoot, (st * 0.9 + sin(uTime * 1.7 + sd * 4.0) * 0.06) * aW);
            } else if (aPart > 3.5 && aPart < 4.5) {
              // 닭새우 꼬리: 도망칠 때 배 밑으로 강하게 말아 뒤로 튐
              transformed = rotX(transformed, aRoot, st * 1.3 * (0.4 + aW));
            } else if (aPart > 4.5 && aPart < 5.5) {
              // 가리비 위 껍데기: 경첩 기준으로 열림
              transformed = rotX(transformed, aRoot, st * 0.42);
            } else if (aPart > 7.5 && aPart < 8.5) {
              transformed.y += sin(position.z * 70.0 - uTime * 3.0) * 0.003 * (0.3 + mv);
            } else if (aPart > 8.5) {
              transformed = rotX(transformed, aRoot, st * 0.21);
            }
            #if KIND == 2
              // 소라게: 놀라면 몸 전체가 껍데기 안으로 쏙
              if (aPart > 0.5) transformed = mix(transformed, aRoot, st * 0.9);
            #endif
          }`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vPartB;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            // 젖은 갑각의 가장자리 반사 + 가리비 눈의 푸른 반짝임
            float rim = pow(clamp(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0, 1.0), 3.0);
            totalEmissiveRadiance += diffuseColor.rgb * rim * 0.22;
            if (vPartB > 8.5 && diffuseColor.b > 0.8) totalEmissiveRadiance += vec3(0.1, 0.45, 0.8) * 0.5;
          }`);
      // 인스턴스 셰이더에도 aInst 기본값이 필요 → 지오메트리에 InstancedBufferAttribute로 제공
    },
  });
  return mat;
}

// ───────── 종 정보 (발견 알림용) ─────────
const mk = (id: string, nameKo: string, nameEn: string, sci: string, length: number, seeDist: number) =>
  ({ id, nameKo, nameEn, sci, length, seeDist, sizeClass: 'small', behavior: 'wander' }) as unknown as SpeciesDef;
export const BENTHIC_SPECIES: SpeciesDef[] = [
  mk('lobster', '비단닭새우', 'Painted spiny lobster', 'Panulirus versicolor', 0.35, 4.2),
  mk('reefcrab', '볼록산호게', 'Convex reef crab', 'Carpilius convexus', 0.15, 3),
  mk('hermit', '흰점박이 소라게', 'White-spotted hermit crab', 'Dardanus megistos', 0.15, 2.8),
  mk('scallop', '문 가리비', 'Asian moon scallop', 'Amusium pleuronectes', 0.12, 2.4),
  mk('triton', '나팔고둥', "Triton's trumpet", 'Charonia tritonis', 0.36, 3.6),
];

interface CritterCfg { geo: () => THREE.BufferGeometry; count: [number, number]; depth: [number, number]; coral: [number, number]; area: [number, number, number, number]; scale: [number, number]; near?: number }
const CFG: Record<Kind, CritterCfg> = {
  0: { geo: lobsterGeo, count: [8, 14], depth: [2.5, 26], coral: [0.35, 1], area: [-45, 45, -80, 35], scale: [0.85, 1.25], near: 4 },
  1: { geo: crabGeo, count: [10, 18], depth: [1.8, 22], coral: [0.15, 0.8], area: [-40, 40, -70, 35], scale: [0.8, 1.3], near: 6 },
  2: { geo: hermitGeo, count: [10, 18], depth: [1.6, 28], coral: [0, 0.55], area: [-45, 45, -100, 35], scale: [0.9, 1.4], near: 6 },
  3: { geo: scallopGeo, count: [8, 16], depth: [2.5, 32], coral: [0, 0.5], area: [-50, 50, -110, 35], scale: [0.9, 1.3], near: 4 },
  4: { geo: tritonGeo, count: [2, 3], depth: [6, 26], coral: [0.3, 0.8], area: [-40, 40, -80, 10], scale: [0.85, 1.15] },
};

class Critter implements Creature {
  alive = true; leaving = false; encountered = false; life = 1e9;
  pos = V3(); home = V3(); target = V3(); yaw = 0;
  gait = 0; move = 0; st = 0; stTarget = 0; seed: number;
  timer = 0; mode: 'idle' | 'walk' | 'flee' | 'hide' | 'swim' = 'idle';
  hopY = 0; vel = V3(); fleeT = 0; segJ = -1;
  constructor(public sp: SpeciesDef, public kind: Kind, public idx: number, public scale: number, p: THREE.Vector3, r: RNG) {
    this.pos.copy(p); this.home.copy(p); this.target.copy(p); this.yaw = rand(r, 0, Math.PI * 2); this.seed = r();
    this.timer = rand(r, 0, 6);
    if (kind === 3) this.st = this.stTarget = 0.55;
  }
  center() { return this.pos; }
  leave() {}
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = V3(), _n = V3(), _p = V3();
const UP = V3(0, 1, 0);

export class Benthic {
  creatures: Critter[] = [];
  private meshes = new Map<Kind, { mesh: THREE.InstancedMesh; inst: THREE.InstancedBufferAttribute }>();
  private r = Math.random;

  constructor(scene: THREE.Scene, lowTier: boolean) {
    const r = mulberry32(91);
    for (const k of [0, 1, 2, 3, 4] as Kind[]) {
      const cfg = CFG[k];
      const want = lowTier ? cfg.count[0] : cfg.count[1];
      const spots: THREE.Vector3[] = [];
      // 일부는 배 근처 얕은 곳에 (스노클링에서도 만날 수 있게)
      for (let i = 0; i < want * 80 && spots.length < want; i++) {
        const nearBoat = spots.length < (cfg.near ?? 0);
        const x = nearBoat ? rand(r, -16, 16) : rand(r, cfg.area[0], cfg.area[1]);
        const z = nearBoat ? rand(r, -16, 16) : rand(r, cfg.area[2], cfg.area[3]);
        const d = -heightAt(x, z), cd = coralDensity(x, z);
        if (d < cfg.depth[0] || d > (nearBoat ? 6.5 : cfg.depth[1])) continue;
        if (cd < cfg.coral[0] || cd > cfg.coral[1]) continue;
        if (k === 0 && dropFactor(x, z) > 0.9) continue;
        if (Math.hypot(x, z) < 3) continue;
        if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 1.5)) continue;
        spots.push(V3(x, -d, z));
      }
      if (!spots.length) continue;
      const geo = cfg.geo();
      const inst = new THREE.InstancedBufferAttribute(new Float32Array(spots.length * 4), 4);
      inst.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aInst', inst);
      const mesh = new THREE.InstancedMesh(geo, benthicMaterial(k), spots.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes.set(k, { mesh, inst });
      spots.forEach((p, i) => this.creatures.push(new Critter(BENTHIC_SPECIES[k], k, i, rand(r, cfg.scale[0], cfg.scale[1]), p, r)));
    }
    this.write();
  }

  private T = 0;
  update(dt: number, t: number, d: DiverInfo, T: number) {
    dt = Math.min(dt, 0.05);
    this.T = T;
    for (const c of this.creatures) this.step(c, dt, t, d);
    this.write();
  }

  /** 공유 시각 구간이 바뀌었는지 (새 구간마다 다음 장소로 걸어감) */
  private newSeg(c: Critter) {
    const P = 7 + 6 * h01(c.kind, c.idx, 1);
    const j = Math.floor((this.T + h01(c.kind, c.idx, 2) * P) / P);
    if (j === c.segJ) return false;
    c.segJ = j; return true;
  }
  /** 다음 걸어갈 곳: (개체 번호, 공유 시각 구간)으로 정함 → 모든 접속자에게 같은 길로 걸음 */
  private pickTarget(c: Critter, radius: number) {
    const P = 7 + 6 * h01(c.kind, c.idx, 1);
    const j = Math.floor((this.T + h01(c.kind, c.idx, 2) * P) / P);
    const r = seeded(c.kind, c.idx, j);
    for (let k = 0; k < 6; k++) {
      const a = r() * Math.PI * 2, rr = radius * (0.3 + 0.7 * r());
      const x = c.home.x + Math.sin(a) * rr, z = c.home.z + Math.cos(a) * rr;
      const dd = -heightAt(x, z);
      if (dd > 1.4 && dd < 34) { c.target.set(x, -dd, z); return; }
    }
    c.target.copy(c.home);
  }

  private step(c: Critter, dt: number, t: number, d: DiverInfo) {
    const dist = d.active ? c.pos.distanceTo(d.pos) : 99;
    const moving = d.vel.length();
    const threat = d.active && dist < (c.kind === 2 ? 1.4 : 1.9) + moving * 1.2;
    c.timer -= dt;
    let speed = 0;
    switch (c.kind) {
      case 0: { // 닭새우: 산호 아래 은신, 가끔 더듬이를 내밀고 걸어 나옴 → 위협 시 꼬리를 쳐서 뒤로 튐
        if (threat && c.mode !== 'flee') {
          c.mode = 'flee'; c.fleeT = 0.9;
          const back = V3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
          c.vel.copy(back).multiplyScalar(1.6);
        }
        if (c.mode === 'flee') {
          c.fleeT -= dt; c.stTarget = c.fleeT > 0.45 ? 1 : 0;
          c.pos.addScaledVector(c.vel, dt); c.vel.multiplyScalar(Math.exp(-3 * dt));
          c.hopY = Math.sin(clamp(1 - c.fleeT / 0.9, 0, 1) * Math.PI) * 0.12;
          if (c.fleeT <= 0) { c.mode = 'idle'; c.timer = rand(this.r, 6, 12); }
        } else {
          c.stTarget = 0; c.hopY = 0;
          if (c.mode === 'idle' && this.newSeg(c)) { this.pickTarget(c, 1.6); c.mode = 'walk'; }
          if (c.mode === 'walk') speed = 0.08;
        }
        break;
      }
      case 1: { // 게: 짧게 옆걸음 → 멈춤, 위협 시 집게를 치켜들었다가 옆으로 재빨리 도망
        if (threat) {
          c.stTarget = 1;
          if (c.mode !== 'flee') { c.mode = 'flee'; c.fleeT = 2.2; const away = c.pos.clone().sub(d.pos).setY(0).normalize(); c.target.copy(c.pos).addScaledVector(away, 1.4); }
        } else c.stTarget = 0;
        if (c.mode === 'flee') { speed = 0.34; c.fleeT -= dt; if (c.fleeT <= 0) { c.mode = 'idle'; c.timer = rand(this.r, 2, 5); } }
        else if (c.mode === 'idle' && this.newSeg(c)) { this.pickTarget(c, 2.2); c.mode = 'walk'; }
        else if (c.mode === 'walk') speed = 0.13;
        break;
      }
      case 2: { // 소라게: 껍데기를 끌며 천천히 → 가까이 오면 껍데기 속으로 숨고 한동안 꼼짝 않음
        if (threat) { c.mode = 'hide'; c.timer = rand(this.r, 3, 5); }
        if (c.mode === 'hide') { c.stTarget = 1; if (c.timer <= 0) { c.mode = 'idle'; c.timer = rand(this.r, 1, 3); } }
        else {
          c.stTarget = 0;
          if (c.mode === 'idle' && this.newSeg(c)) { this.pickTarget(c, 2.5); c.mode = 'walk'; }
          if (c.mode === 'walk') speed = 0.045;
        }
        break;
      }
      case 3: { // 가리비: 입을 벌린 채 쉼 → 놀라면 껍데기를 여닫으며 물을 뿜어 퐁퐁 헤엄쳐 달아남
        if (threat && c.mode !== 'swim') {
          c.mode = 'swim'; c.fleeT = rand(this.r, 1.6, 2.4);
          const away = c.pos.clone().sub(d.pos).setY(0).normalize();
          c.vel.copy(away).multiplyScalar(0.9); c.yaw = Math.atan2(away.x, away.z); // 벌어진 입 쪽으로 물을 밀어내며 나아감
        }
        if (c.mode === 'swim') {
          c.fleeT -= dt;
          c.stTarget = 0.5 + 0.5 * Math.sin(t * 22);
          c.pos.addScaledVector(c.vel, dt);
          c.hopY = Math.min(0.7, c.hopY + dt * 0.6) * (c.fleeT > 0.4 ? 1 : c.fleeT / 0.4);
          if (c.fleeT <= 0) { c.mode = 'idle'; c.hopY = 0; c.timer = 6; }
        } else c.stTarget = 0.55 + Math.sin(t * 0.4 + c.seed * 9) * 0.1;
        break;
      }
      case 4: { // 나팔고둥: 아주 천천히 기어 다님
        if (c.mode === 'idle' && this.newSeg(c)) { this.pickTarget(c, 3); c.mode = 'walk'; }
        if (c.mode === 'walk') speed = 0.018;
        break;
      }
    }
    // 목표 지점으로 걷기
    if (speed > 0) {
      _p.subVectors(c.target, c.pos).setY(0);
      const l = _p.length();
      if (l < 0.08) { if (c.mode === 'walk') { c.mode = 'idle'; c.timer = rand(this.r, 3, 9); } }
      else {
        const want = Math.atan2(_p.x, _p.z);
        if (c.kind === 1) {
          // 옆걸음: 몸은 이동 방향의 수직을 바라봄
          const side = c.yaw + Math.PI / 2;
          let diff = want - side; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          const face = Math.abs(diff) < Math.PI / 2 ? want - Math.PI / 2 : want + Math.PI / 2;
          c.yaw = dampAngle(c.yaw, face, 2, dt);
        } else c.yaw = dampAngle(c.yaw, want, c.kind === 4 ? 0.4 : 2.2, dt);
        c.pos.addScaledVector(_p.normalize(), Math.min(speed * dt, l));
      }
    }
    c.move += ((speed > 0 ? 1 : 0) - c.move) * (1 - Math.exp(-6 * dt));
    c.gait += dt * speed * (c.kind === 1 ? 70 : c.kind === 0 ? 55 : 80);
    c.st += (c.stTarget - c.st) * (1 - Math.exp(-(c.kind === 3 ? 14 : c.kind === 2 ? 10 : 6) * dt));
    // 바닥 붙이기
    c.pos.y = heightAt(c.pos.x, c.pos.z) + c.hopY;
  }

  private write() {
    for (const [k, { mesh, inst }] of this.meshes) {
      for (const c of this.creatures) {
        if (c.kind !== k) continue;
        const [nx, ny, nz] = normalAt(c.pos.x, c.pos.z);
        _n.set(nx, ny, nz);
        _q.setFromAxisAngle(UP, c.yaw);
        _q2.setFromUnitVectors(UP, _n.lerp(UP, c.hopY > 0.05 ? 0.8 : 0.3).normalize());
        _q.premultiply(_q2);
        _s.setScalar(c.scale);
        _m.compose(_p.copy(c.pos).add(V3(0, -0.005, 0)), _q, _s);
        mesh.setMatrixAt(c.idx, _m);
        inst.setXYZW(c.idx, c.gait, c.move, c.st, c.seed);
      }
      mesh.instanceMatrix.needsUpdate = true; inst.needsUpdate = true;
    }
  }
}

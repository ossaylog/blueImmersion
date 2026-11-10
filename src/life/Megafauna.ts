// 대형 생물 전용 형태·움직임
//  바다거북(푸른/매부리) · 만타가오리 · 점박이 독수리가오리 · 블루스팟 가오리 · 해파리
//  모든 형태는 매끈한 파라메트릭 곡면 + 픽셀 단위 무늬 셰이더(등딱지 인갑, 피부 비늘, 만타 어깨무늬)
import * as THREE from 'three';
import type { SpeciesDef, DiverInfo, Creature } from './types';
import { patchWater, waterUniforms, WATER_GLSL_COMMON } from '../water/WaterShading';
import { heightAt } from '../world/terrain';
import { rand, clamp, dampAngle, disposeTree, mulberry32, type RNG } from '../core/math';
import type { Plan } from './Ecology';

/** 생김새·무늬 난수: 생태계 계획의 시드를 쓰면 모든 접속자에게 같은 개체로 보임 */
let R: RNG = Math.random;
export function withSeed<T>(seed: number, fn: () => T): T { const prev = R; R = mulberry32(seed); try { return fn(); } finally { R = prev; } }
const _pp = new THREE.Vector3(), _pv = new THREE.Vector3();
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

abstract class Mover implements Creature {
  alive = true; leaving = false; encountered = false; life: number;
  root = new THREE.Group();
  pos = new THREE.Vector3(); vel = new THREE.Vector3();
  yaw = 0; pitch = 0; roll = 0; phase = 0;
  target = new THREE.Vector3();
  /** 공유 생태계 계획 · 공유 시각 */
  plan: Plan | null = null;
  T = 0;
  /** 무리 비행 차선 (경로 옆으로 떨어진 거리, m) */
  side = 0; ahead = 0;
  constructor(public sp: SpeciesDef, scene: THREE.Scene, at: THREE.Vector3) {
    this.life = rand(R, sp.stay[0], sp.stay[1]);
    this.pos.copy(at); scene.add(this.root);
  }
  /** 계획을 붙이고 지금 있어야 할 자리에서 시작 */
  attach(plan: Plan, T: number, side = 0, ahead = 0) {
    this.plan = plan; this.T = T; this.side = side; this.ahead = ahead;
    this.planAt(T, this.pos);
    this.planVel(T, this.vel);
    if (this.vel.lengthSq() > 1e-4) this.yaw = Math.atan2(this.vel.x, this.vel.z);
    this.life = plan.end - T;
    return this;
  }
  protected planAt(T: number, out: THREE.Vector3) {
    const p = this.plan!.path;
    p.at(T + this.ahead, out);
    if (this.side) { p.vel(T + this.ahead, _pv).setY(0); const l = _pv.length(); if (l > 1e-3) out.add(_pp.set(_pv.z / l, 0, -_pv.x / l).multiplyScalar(this.side)); }
    return out;
  }
  protected planVel(T: number, out: THREE.Vector3) { return this.plan!.path.vel(T + this.ahead, out); }
  /** 공유 경로를 따라감: 경로 속도 + 어긋난 만큼 보정 (관성 있게) */
  protected follow(dt: number, agility: number, bank = 0.9) {
    this.planAt(this.T, this.target);
    this.planVel(this.T, _pv);
    const want = _pv.clone().addScaledVector(_pp.subVectors(this.target, this.pos), 0.6);
    this.vel.lerp(want, 1 - Math.exp(-agility * dt));
    this.pos.addScaledVector(this.vel, dt);
    this.orient(dt, bank);
    this.life = this.plan!.end - this.T;
    this.leaving = this.T > this.plan!.end;
  }
  center() { return this.pos; }
  leave() { this.leaving = true; }
  abstract update(dt: number, t: number, d: DiverInfo): void;
  protected steer(dt: number, speed: number, agility: number, bank = 0.9) {
    const to = this.target.clone().sub(this.pos);
    const dist = to.length();
    const want = to.setLength(Math.min(speed, dist * 0.5 + 0.05));
    this.vel.lerp(want, 1 - Math.exp(-agility * dt));
    this.pos.addScaledVector(this.vel, dt);
    this.orient(dt, bank);
    return dist;
  }
  protected orient(dt: number, bank: number) {
    const v = this.vel.length();
    if (v > 0.03) {
      const ny = Math.atan2(this.vel.x, this.vel.z);
      const prev = this.yaw;
      this.yaw = dampAngle(this.yaw, ny, 1.2, dt);
      let dy = this.yaw - prev;
      while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      this.roll = THREE.MathUtils.lerp(this.roll, clamp(-dy / Math.max(dt, 1e-3) * bank, -0.7, 0.7), 1 - Math.exp(-1.5 * dt));
      this.pitch = THREE.MathUtils.lerp(this.pitch, clamp(-Math.asin(clamp(this.vel.y / v, -1, 1)), -0.5, 0.5), 1 - Math.exp(-1.5 * dt));
    }
  }
  protected apply() {
    this.root.position.copy(this.pos);
    this.root.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }
  /** 강제 정리 (오래 머문 퇴장 생물) */
  dispose() { if (!this.alive && !this.root.parent) return; this.alive = false; disposeTree(this.root); }
  protected despawnIfFar(d: DiverInfo) {
    if (this.plan) { if (!this.encountered && d.active && this.pos.distanceTo(d.pos) < 7) this.encountered = true; return; }
    if (this.leaving && this.pos.distanceTo(d.pos) > 46) { this.alive = false; disposeTree(this.root); }
    if (!this.encountered && this.pos.distanceTo(d.pos) < 7) this.encountered = true;
  }
  protected exitTarget(d: DiverInfo) {
    this.target.copy(this.pos).sub(d.pos).setY(0).normalize().multiplyScalar(52).add(d.pos);
    this.target.y = clamp(this.pos.y, heightAt(this.target.x, this.target.z) + 2, -1);
  }
  protected passTarget(d: DiverInfo, near: number) {
    const side = V3(-(d.pos.z - this.pos.z), 0, d.pos.x - this.pos.x).normalize();
    this.target.copy(d.pos).addScaledVector(d.forward, rand(R, 0.5, 2.5)).addScaledVector(side, near * (R() < 0.5 ? 1 : -1));
  }
}

// ───────── 공용 GLSL: 지터 보로노이 (비늘·인갑·반점) ─────────
const VORO = /* glsl */ `
vec2 vh2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
// x: 가장 가까운 셀까지 거리, y: 경계까지 거리, z: 셀 해시
vec3 voro(vec2 p) {
  vec2 n = floor(p), f = fract(p);
  float md = 8.0; vec2 mr = vec2(0.0); vec2 mg = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec2 o = vh2(n + g); vec2 r = g + o - f; float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  float bd = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j)); vec2 o = vh2(n + g); vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 1e-5) bd = min(bd, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return vec3(sqrt(md), bd, vh2(n + mg).x);
}
`;

/** 국소 좌표 기반 무늬 머티리얼 */
function patternMat(key: string, uniforms: Record<string, { value: unknown }>, body: string, opts: { rough?: number; vertex?: string; normalVertex?: string } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: opts.rough ?? 0.6, metalness: 0, side: THREE.DoubleSide });
  return patchWater(mat, {
    key,
    extend: (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.uniforms.uTime = waterUniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vL;\n' + Object.keys(uniforms).map((k) => `uniform ${glslType(uniforms[k].value)} ${k};`).join('\n') + '\nattribute vec3 aUVW;\nvarying vec3 vUVW;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + (opts.normalVertex ?? ''))
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvL = position; vUVW = aUVW;\n' + (opts.vertex ?? ''));
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vL; varying vec3 vUVW;\n' + Object.keys(uniforms).map((k) => `uniform ${glslType(uniforms[k].value)} ${k};`).join('\n') + '\n' + VORO)
        .replace('#include <color_fragment>', '#include <color_fragment>\n{\n' + body + '\n}');
    },
  });
}
function glslType(v: unknown) {
  if (v instanceof THREE.Color || v instanceof THREE.Vector3) return 'vec3';
  if (v instanceof THREE.Vector2) return 'vec2';
  return 'float';
}

/** 단면 링을 따라 로프트한 닫힌 곡면 (aUVW = 길이u, 둘레v, 0) */
function loft(nu: number, nv: number, fn: (u: number, v: number) => [number, number, number]) {
  const pos: number[] = [], uvw: number[] = [], idx: number[] = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = i / nu, v = j / nv;
    pos.push(...fn(u, v)); uvw.push(u, v, 0);
  }
  const W = nv + 1;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aUVW', new THREE.Float32BufferAttribute(uvw, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ───────── 바다거북 ─────────
// 지느러미: 길이 s(어깨→끝), 단면 타원(폭=코드, 두께) — 뒤로 휘어진 노 모양
function flipperGeo(len: number, chord: number, s0: number, s1: number, sweep: number) {
  return loft(14, 10, (u, v) => {
    const s = s0 + (s1 - s0) * u;
    const c = chord * Math.pow(Math.max(1 - s, 0.02), 0.45) * (0.55 + 0.45 * Math.sin(Math.min(1, s * 3 + 0.25) * Math.PI * 0.5));
    const th = chord * 0.16 * (1 - s * 0.85);
    const a = v * Math.PI * 2;
    const x = (s - s0) * len;
    const zc = -sweep * s * s * len;
    return [x, Math.sin(a) * th * 0.5, zc + Math.cos(a) * c * 0.5 - c * 0.15];
  });
}

export class Turtle extends Mover {
  flF: { root: THREE.Group; tip: THREE.Group }[] = []; flR: THREE.Group[] = []; head: THREE.Group;
  mode: 'pass' | 'breathe' | 'feed' | 'exit' = 'pass';
  timer = 0;
  constructor(sp: SpeciesDef, scene: THREE.Scene, at: THREE.Vector3, d: DiverInfo | null) {
    super(sp, scene, at);
    const L = sp.length;
    const cs = sp.colors.map((c) => new THREE.Color(c));
    const body = new THREE.Group(); body.scale.setScalar(L); this.root.add(body);
    // 등딱지: 극좌표 돔 + 중앙 용골 + 뒤쪽 가장자리 톱니
    const shell = loft(22, 56, (u, v) => {
      const th = v * Math.PI * 2, r = u;
      const back = Math.cos(th) < 0;
      const serr = 1 + 0.035 * Math.max(0, -Math.cos(th)) * Math.abs(Math.sin(th * 11));
      const rr = r * serr;
      const x = Math.sin(th) * 0.4 * rr * (1 - 0.15 * Math.max(0, -Math.cos(th)));
      const z = Math.cos(th) * (back ? 0.53 : 0.47) * rr;
      const y = 0.17 * Math.pow(Math.max(0, 1 - r * r), 0.5) + 0.012 * Math.exp(-(x * x) / 0.004) * (1 - r);
      return [x, y, z];
    });
    const shellMat = patternMat('turtleShell', { uC1: { value: cs[0] }, uC2: { value: cs[1] }, uC3: { value: cs[2] }, uSeed: { value: R() * 10 } }, `
      vec2 p = vL.xz;
      float r = vUVW.x;
      // 인갑 배치: 척추판 5, 늑판 좌우 4, 가장자리 연판
      vec2 sites[13];
      sites[0]=vec2(0.0,0.33); sites[1]=vec2(0.0,0.16); sites[2]=vec2(0.0,0.0); sites[3]=vec2(0.0,-0.16); sites[4]=vec2(0.0,-0.32);
      sites[5]=vec2(0.2,0.22); sites[6]=vec2(0.23,0.06); sites[7]=vec2(0.23,-0.1); sites[8]=vec2(0.19,-0.26);
      sites[9]=vec2(-0.2,0.22); sites[10]=vec2(-0.23,0.06); sites[11]=vec2(-0.23,-0.1); sites[12]=vec2(-0.19,-0.26);
      float d1 = 9.0, d2 = 9.0; vec2 cc = vec2(0.0); float id = 0.0;
      for (int i = 0; i < 13; i++) { float dd = length((p - sites[i]) * vec2(1.0, 0.9)); if (dd < d1) { d2 = d1; d1 = dd; cc = sites[i]; id = float(i); } else if (dd < d2) d2 = dd; }
      float edge = d2 - d1;
      float marg = smoothstep(0.84, 0.88, r);
      float ang = atan(p.y, p.x);
      float mseg = abs(fract(ang / 6.2831 * 26.0) - 0.5);
      float border = marg > 0.5 ? smoothstep(0.03, 0.0, mseg * 0.1) : smoothstep(0.012, 0.002, edge);
      border = max(border, smoothstep(0.008, 0.0, abs(r - 0.86)) * 1.0);
      // 각 인갑 안의 방사형 줄무늬
      vec2 rel = p - cc;
      float rad = atan(rel.y, rel.x);
      float streak = 0.5 + 0.5 * sin(rad * 9.0 + sin(length(rel) * 40.0 + id) * 2.0 + uSeed);
      float blot = voro(p * 22.0 + uSeed).x;
      vec3 c = mix(uC1, uC2, streak * smoothstep(0.0, 0.08, length(rel)) * 0.8);
      c = mix(c, uC3, smoothstep(0.35, 0.1, blot) * 0.35);
      c = mix(c, uC1 * 0.55, smoothstep(0.02, 0.1, length(rel)) * (1.0 - smoothstep(0.0, 0.05, edge)) * 0.4);
      c = mix(c, vec3(0.85, 0.8, 0.62), border * 0.7);
      diffuseColor.rgb = c;`, { rough: 0.45 });
    body.add(new THREE.Mesh(shell, shellMat));
    // 배딱지
    const plast = loft(10, 40, (u, v) => {
      const th = v * Math.PI * 2;
      return [Math.sin(th) * 0.38 * u, -0.045 * Math.pow(Math.max(0, 1 - u * u), 0.7), Math.cos(th) * 0.47 * u];
    });
    body.add(new THREE.Mesh(plast, patternMat('turtlePlast', { uC4: { value: cs[3] } }, `
      vec3 v = voro(vL.xz * vec2(6.0, 9.0)); diffuseColor.rgb = mix(uC4 * 0.75, uC4, smoothstep(0.0, 0.06, v.y));`, { rough: 0.6 })));

    // 피부 (비늘 보로노이 + 밝은 경계)
    const skin = patternMat('turtleSkin', { uS1: { value: cs[2] }, uS2: { value: cs[3] } }, `
      vec2 q = vL.xz * 34.0 + vL.y * 20.0;
      vec3 v = voro(q);
      float b = smoothstep(0.0, 0.09, v.y);
      vec3 c = mix(uS2 * 0.95, uS1 * (0.75 + 0.35 * v.z), b);
      diffuseColor.rgb = c;`, { rough: 0.7 });
    // 목 + 머리 (부리 모양으로 좁아짐)
    const neck = loft(8, 16, (u, v) => {
      const a = v * Math.PI * 2, r = 0.075 - u * 0.01;
      return [Math.cos(a) * r, Math.sin(a) * r * 0.8 - 0.01, 0.38 + u * 0.14];
    });
    body.add(new THREE.Mesh(neck, skin));
    this.head = new THREE.Group(); this.head.position.set(0, -0.005, 0.5); body.add(this.head);
    const head = loft(16, 20, (u, v) => {
      const a = v * Math.PI * 2;
      const prof = Math.sin(Math.min(1, u * 1.25 + 0.1) * Math.PI) ** 0.6;
      const w = 0.085 * prof * (1 - 0.35 * Math.max(0, u - 0.6) / 0.4);
      const h = 0.07 * prof * (1 + 0.15 * Math.sin(u * Math.PI));
      const y = Math.sin(a) * h + (Math.sin(a) > 0 ? 0.01 * u : 0) - 0.012 * u * u;
      return [Math.cos(a) * w, y, u * 0.2];
    });
    this.head.add(new THREE.Mesh(head, skin));
    const eyeM = patchWater(new THREE.MeshStandardMaterial({ color: '#0a0806', roughness: 0.1 }), { key: 'eye' });
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), eyeM); e.position.set(s * 0.058, 0.022, 0.12); this.head.add(e); }

    for (const s of [-1, 1]) {
      const root = new THREE.Group(); root.position.set(s * 0.3, -0.01, 0.24); root.scale.x = s;
      const prox = new THREE.Mesh(flipperGeo(0.62, 0.22, 0, 0.36, 0.55), skin);
      root.add(prox);
      const tip = new THREE.Group();
      const sweepAt = -0.55 * 0.36 * 0.36 * 0.62;
      tip.position.set(0.36 * 0.62, 0, sweepAt);
      const dist = new THREE.Mesh(flipperGeo(0.62, 0.22, 0.36, 1, 0.55), skin);
      dist.position.set(-0.36 * 0.62, 0, -sweepAt);
      tip.add(dist); root.add(tip);
      body.add(root); this.flF.push({ root, tip });
      const rr = new THREE.Group(); rr.position.set(s * 0.22, -0.02, -0.36); rr.scale.x = s;
      const rear = new THREE.Mesh(flipperGeo(0.2, 0.15, 0, 1, -0.6), skin);
      rear.rotation.y = -0.9;
      rr.add(rear); body.add(rr); this.flR.push(rr);
    }
    if (d) { this.planPass(d); this.yaw = Math.atan2(this.target.x - at.x, this.target.z - at.z); }
    else this.target.copy(at);
  }
  planPass(d: DiverInfo) {
    this.passTarget(d, d.fp ? rand(R, 1.3, 2.0) : rand(R, 2.4, 3.6));
    this.target.y = clamp(d.pos.y + rand(R, -0.6, 0.6), heightAt(this.target.x, this.target.z) + 1, -0.8);
    this.mode = 'pass';
  }
  update(dt: number, t: number, d: DiverInfo) {
    let speed = this.sp.speed[1];
    let stroke = 1;
    if (this.plan) {
      // 공유 경로: 바닥에서 먹이(feed) · 수면에서 숨쉬기(breathe) 구간은 경로에 정해져 있음
      const tag = this.plan.path.tagAt(this.T);
      this.mode = tag === 'feed' ? 'feed' : tag === 'breathe' ? 'breathe' : this.T > this.plan.end ? 'exit' : 'pass';
      const close = this.pos.distanceTo(this.planAt(this.T, _pp)) < 0.6;
      if (this.mode === 'feed') { stroke = close ? 0.08 : 0.35; this.head.rotation.x = close ? 0.3 + Math.sin(t * 2) * 0.15 : 0; }
      else { this.head.rotation.x = 0; if (this.mode === 'breathe') stroke = close ? 0.15 : 0.6; }
      this.follow(dt, 0.8, 0.6);
    } else {
    this.life -= dt;
    if (this.life <= 0 && !this.leaving) { this.leave(); this.exitTarget(d); this.mode = 'exit'; }
    if (this.mode === 'pass') {
      if (this.pos.distanceTo(this.target) < 1.5) {
        if (-this.pos.y < 14 && R() < 0.5) { this.mode = 'breathe'; this.target.set(this.pos.x + this.vel.x * 8, -0.35, this.pos.z + this.vel.z * 8); }
        else {
          this.mode = 'feed';
          const fx = this.pos.x + this.vel.x * 6, fz = this.pos.z + this.vel.z * 6;
          this.target.set(fx, heightAt(fx, fz) + 0.35, fz); this.timer = rand(R, 8, 14);
        }
      }
    } else if (this.mode === 'breathe') {
      speed = 0.3;
      if (this.pos.y > -0.6) { this.timer += dt; stroke = 0.15; if (this.timer > 3.5) { this.timer = 0; this.planPass(d); } }
    } else if (this.mode === 'feed') {
      speed = 0.15; stroke = 0.35;
      if (this.pos.distanceTo(this.target) < 0.6) {
        this.timer -= dt; stroke = 0.08;
        this.head.rotation.x = 0.3 + Math.sin(t * 2) * 0.15;
        if (this.timer <= 0) { this.head.rotation.x = 0; this.planPass(d); }
      }
    }
    if (this.leaving) speed = this.sp.speed[1];
    this.steer(dt, speed, 0.6, 0.6);
    }
    const fl = heightAt(this.pos.x, this.pos.z) + 0.3;
    if (this.pos.y < fl) this.pos.y = fl;
    if (this.pos.y > -0.3) this.pos.y = -0.3;
    // 수중 비행: 앞지느러미 상하 스트로크 + 페더링(비틀기) + 끝마디 지연, 스트로크 사이 활공
    const v = this.vel.length();
    this.phase += dt * (0.75 + v * 1.6) * Math.max(stroke, 0.2);
    const ph = this.phase * 2.0;
    const amp = 0.2 + 0.6 * stroke;
    const up = Math.sin(ph);
    for (const f of this.flF) {
      f.root.rotation.set(Math.cos(ph) * 0.45 * stroke, Math.cos(ph) * 0.3 * stroke - 0.15, -up * amp + 0.1, 'YXZ');
      f.tip.rotation.set(0, -0.15 * stroke, -Math.sin(ph - 0.7) * amp * 0.5);
    }
    for (const r of this.flR) r.rotation.set(0, Math.sin(this.phase) * 0.12, Math.sin(this.phase * 1.3) * 0.1);
    this.head.rotation.y = Math.sin(t * 0.4) * 0.12;
    // 스트로크에 따라 몸이 살짝 떠오름
    this.root.position.copy(this.pos);
    this.root.position.y += Math.cos(ph) * 0.015 * stroke * this.sp.length;
    this.root.rotation.set(this.pitch + Math.sin(ph) * 0.02 * stroke, this.yaw, this.roll, 'YXZ');
    this.despawnIfFar(d);
  }
}

// ───────── 가오리류 ─────────
type RayKind = 'manta' | 'eagle' | 'sting';
function rayGeometry(kind: RayKind) {
  const NU = 48, NV = 22;
  return loft(NU, NV, (uu, vv) => {
    // u: -1 왼쪽 날개 끝 → 1 오른쪽, 중앙에 정점 집중
    const u = Math.sin((uu * 2 - 1) * Math.PI * 0.5);
    const a = Math.abs(u);
    let zL: number, zT: number, tmax: number;
    if (kind === 'manta') {
      zL = 0.36 - 0.5 * Math.pow(a, 1.1) - 0.05 * (1 - THREE.MathUtils.smoothstep(a, 0, 0.12));
      zT = -0.3 + 0.08 * a - 0.12 * THREE.MathUtils.smoothstep(a, 0.7, 1);
      tmax = 0.12 * Math.pow(1 - a, 1.9) + 0.006;
    } else if (kind === 'eagle') {
      zL = 0.42 * (1 - THREE.MathUtils.smoothstep(a, 0, 0.14)) + 0.25 - 0.45 * Math.pow(a, 1.0);
      zT = -0.32 + 0.1 * a - 0.15 * THREE.MathUtils.smoothstep(a, 0.65, 1);
      tmax = 0.13 * Math.pow(1 - a, 2.2) + 0.005;
    } else {
      const c = Math.sqrt(Math.max(0.0001, 1 - a * a));
      zL = 0.55 * c; zT = -0.45 * c; tmax = 0.11 * Math.pow(1 - a, 1.2) + 0.004;
    }
    // v: 0→0.5 윗면(뒤→앞), 0.5→1 아랫면(앞→뒤)
    const top = vv < 0.5;
    const s = top ? vv * 2 : (1 - vv) * 2;
    const z = zT + (zL - zT) * s;
    const th = tmax * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, s * 0.98 + 0.01))), 0.6);
    const span = kind === 'sting' ? 0.5 : 1;
    return [u * span, (top ? 1 : -0.55) * th, z];
  });
}

function rayMaterial(sp: SpeciesDef, kind: RayKind, u: { uPhase: { value: number }; uAmp: { value: number } }) {
  const cs = sp.colors.map((c) => new THREE.Color(c));
  const flap = kind === 'sting'
    ? `float ax = abs(vUVW.x * 2.0 - 1.0); float sg = sin(uPhase * 2.0 - ax * 7.0 - vUVW.y * 4.0) * uAmp * pow(ax, 1.6);`
    : `float ax = abs(position.x); float sg = sin(uPhase - ax * 1.25) * uAmp * pow(ax, 1.35) + cos(uPhase - ax * 1.25) * uAmp * 0.25 * ax * (position.z * 2.0);`;
  const body = kind === 'manta' ? `
      bool top = vUVW.y < 0.5;
      float ax = abs(vL.x);
      vec3 c;
      if (top) {
        c = uC1 * (0.8 + 0.3 * smoothstep(0.0, 1.0, ax));
        // 리프 만타: 머리 뒤 흰 어깨무늬 (개체마다 모양이 다름)
        float n = voro(vL.xz * 14.0 + uSeed).x;
        float d = length(vec2((ax - 0.25) / 0.17, (vL.z - 0.07) / 0.11)) + (n - 0.5) * 0.35;
        float sh = smoothstep(1.0, 0.75, d);
        c = mix(c, uC3, sh * 0.9);
        c *= 0.92 + 0.08 * voro(vL.xz * 60.0).y * 4.0;
      } else {
        c = uC2;
        c = mix(c, uC1 * 1.3, smoothstep(0.78, 0.95, ax) + smoothstep(-0.24, -0.3, vL.z) * smoothstep(0.3, 0.6, ax));
        // 아가미 틈 5쌍
        float gx = ax - 0.13;
        float gill = 0.0;
        for (int i = 0; i < 5; i++) { float z0 = 0.2 - float(i) * 0.045; gill = max(gill, smoothstep(0.006, 0.0, abs(vL.z - z0 - gx * 0.3)) * step(0.0, gx) * step(gx, 0.07)); }
        c = mix(c, uC1 * 0.6, gill * 0.9);
        // 배의 고유한 검은 반점
        vec3 v = voro(vL.xz * 18.0 + uSeed * 3.0);
        c = mix(c, uC1 * 0.9, step(0.8, v.z) * smoothstep(0.22, 0.12, v.x) * step(ax, 0.35) * step(-0.15, vL.z));
      }
      diffuseColor.rgb = c;`
    : kind === 'eagle' ? `
      bool top = vUVW.y < 0.5;
      vec3 c = top ? uC1 : uC2;
      if (top) { vec3 v = voro(vL.xz * 24.0 + uSeed); c = mix(c, uC3, (1.0 - smoothstep(0.16, 0.26, v.x)) * step(0.25, v.z)); }
      diffuseColor.rgb = c;`
    : `
      bool top = vUVW.y < 0.5;
      vec3 c = top ? uC1 : uC3;
      if (top) { vec3 v = voro(vL.xz * 30.0 + uSeed); c = mix(c, uC2 * 1.3, (1.0 - smoothstep(0.14, 0.24, v.x)) * step(0.35, v.z)); c *= 0.9 + 0.1 * v.y * 5.0; }
      diffuseColor.rgb = c;`;
  return patternMat('ray' + kind, { ...u, uC1: { value: cs[0] }, uC2: { value: cs[1] }, uC3: { value: cs[2] }, uSeed: { value: R() * 20 } }, body, {
    rough: 0.5,
    vertex: `{ ${flap} transformed.y += sg; }`,
    normalVertex: kind === 'sting' ? '' : `{ float ax0 = abs(position.x); float sl = uAmp * (1.35 * pow(max(ax0, 1e-3), 0.35) * sin(uPhase - ax0 * 1.25) - 1.25 * pow(ax0, 1.35) * cos(uPhase - ax0 * 1.25)); objectNormal = normalize(objectNormal + vec3(-sign(position.x) * sl * objectNormal.y, 0.0, 0.0)); }`,
  });
}

export class Manta extends Mover {
  u = { uPhase: { value: 0 }, uAmp: { value: 0.3 } };
  orbitC = new THREE.Vector3(); orbitR = 9; orbitA = 0; orbitDir = 1;
  /** 무리 비행 시 개체별 차선 (반지름·높이 오프셋) — 같은 궤도를 겹쳐 날지 않도록 */
  lane = 0;
  private get laneR() { return this.lane === 0 ? 0 : (this.lane % 2 ? 1 : -1) * Math.ceil(this.lane / 2) * Math.max(2.2, this.sp.length * 1.2); }
  ceph: THREE.Mesh[] = [];
  private flapT = 0; private gliding = false;
  constructor(sp: SpeciesDef, scene: THREE.Scene, at: THREE.Vector3, d: DiverInfo | null, public kind: 'manta' | 'eagle' = 'manta', orbitOffset = 0) {
    super(sp, scene, at);
    const half = sp.length / 2;
    const g = new THREE.Group(); g.scale.setScalar(half); this.root.add(g);
    g.add(new THREE.Mesh(rayGeometry(kind), rayMaterial(sp, kind, this.u)));
    const dark = patchWater(new THREE.MeshStandardMaterial({ color: new THREE.Color(sp.colors[0]), roughness: 0.55 }), { key: 'rayTail' });
    if (kind === 'manta') {
      // 말린 두악(cephalic fin) 한 쌍
      for (const s of [-1, 1]) {
        const c = new THREE.Mesh(loft(10, 12, (u, v) => {
          const a = v * Math.PI * 1.6 - 0.3;
          const rr = 0.028 * (1 - u * 0.4);
          return [s * (0.085 + Math.cos(a) * rr), Math.sin(a) * rr - 0.005, 0.3 + u * 0.13];
        }), dark);
        g.add(c); this.ceph.push(c);
      }
    }
    const tl = kind === 'eagle' ? 2.2 : 0.55;
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.022, tl, 6), dark);
    tail.rotation.x = Math.PI / 2; tail.position.set(0, 0, -0.3 - tl / 2);
    g.add(tail);
    this.orbitC.copy(d ? d.pos : at).add(V3(rand(R, -3, 3), 0, rand(R, -3, 3)));
    this.orbitA = Math.atan2(at.x - this.orbitC.x, at.z - this.orbitC.z) + orbitOffset;
    this.orbitDir = R() < 0.5 ? 1 : -1;
    this.orbitR = kind === 'eagle' ? 7 : 9;
    if (kind === 'eagle') this.u.uAmp.value = 0.22;
  }
  update(dt: number, t: number, d: DiverInfo) {
    if (this.plan) {
      this.follow(dt, 0.6, 1.4);
      // 날갯짓 ↔ 활공 리듬도 공유 시각 기준
      const gl = Math.sin(this.T * 0.45 + this.lane * 0.7 + (this.plan.seed % 100)) > 0.25;
      if (gl !== this.gliding) this.gliding = gl;
      this.flapT = 1;
    } else {
    this.life -= dt;
    if (this.life <= 0 && !this.leaving) {
      this.leave(); this.exitTarget(d);
      const side = V3(this.target.z - this.pos.z, 0, -(this.target.x - this.pos.x)).normalize();
      this.target.addScaledVector(side, this.laneR);
    }
    if (!this.leaving) {
      // 다이버 주위를 크게 선회하며 위에서 아래로 지나감
      this.orbitR = THREE.MathUtils.lerp(this.orbitR, d.fp ? 4 : 6.5, dt * 0.04);
      this.orbitA += this.orbitDir * dt * this.sp.speed[0] / this.orbitR;
      const yOff = 3.2 * Math.cos(t * 0.07 + this.orbitA) + 1.0 + (this.lane % 2 ? 0.9 : -0.6) * Math.min(this.lane, 1) * Math.ceil(this.lane / 2);
      const R = Math.max(2.5, this.orbitR + this.laneR);
      this.target.set(this.orbitC.x + Math.sin(this.orbitA + this.orbitDir * 0.5) * R, 0, this.orbitC.z + Math.cos(this.orbitA + this.orbitDir * 0.5) * R);
      this.target.y = clamp(d.pos.y + yOff, heightAt(this.target.x, this.target.z) + 2.5, -1.2);
    }
    this.steer(dt, this.sp.speed[1], 0.45, 1.4);
    // 몇 번 날갯짓한 뒤 활공 (실제 만타의 리듬)
    this.flapT -= dt;
    if (this.flapT <= 0) { this.gliding = !this.gliding; this.flapT = this.gliding ? rand(R, 2, 4) : rand(R, 4, 7); }
    }
    const ampT = this.gliding ? 0.06 : this.kind === 'eagle' ? 0.24 : 0.32;
    this.u.uAmp.value = THREE.MathUtils.lerp(this.u.uAmp.value, ampT, 1 - Math.exp(-1.2 * dt));
    this.phase += dt * (this.gliding ? 0.6 : 1.5);
    this.u.uPhase.value = this.phase;
    for (const c of this.ceph) c.rotation.x = Math.sin(t * 0.5) * 0.08;
    this.apply();
    this.despawnIfFar(d);
  }
}

export class Stingray extends Mover {
  u = { uPhase: { value: 0 }, uAmp: { value: 0.015 } };
  resting = true;
  constructor(sp: SpeciesDef, scene: THREE.Scene, at: THREE.Vector3) {
    super(sp, scene, at);
    const g = new THREE.Group(); g.scale.setScalar(sp.length); this.root.add(g);
    g.add(new THREE.Mesh(rayGeometry('sting'), rayMaterial(sp, 'sting', this.u)));
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.03, 0.9, 6), patchWater(new THREE.MeshStandardMaterial({ color: new THREE.Color(sp.colors[1]), roughness: 0.5 }), { key: 'rayTail' }));
    tail.rotation.x = Math.PI / 2; tail.position.set(0, 0.01, -0.85);
    g.add(tail);
    this.pos.y = heightAt(at.x, at.z) + 0.03;
    this.target.copy(this.pos);
    this.yaw = rand(R, 0, Math.PI * 2);
  }
  /** 다이버가 너무 가까이 와서 잠깐 비켜난 거리 (나에게만 · 서서히 원래 자리로) */
  private flee = V3(); private fleeT = 0;
  update(dt: number, _t: number, d: DiverInfo) {
    if (this.plan) {
      const tag = this.plan.path.tagAt(this.T);
      if (d.active && this.fleeT <= 0 && this.pos.distanceTo(d.pos) < this.sp.shy) { this.flee.copy(this.pos).sub(d.pos).setY(0).setLength(rand(R, 2.5, 4)); this.fleeT = 9; }
      this.fleeT -= dt;
      if (this.fleeT <= 0) this.flee.multiplyScalar(Math.exp(-0.25 * dt));
      this.planAt(this.T, this.target).add(this.flee);
      this.target.y = heightAt(this.target.x, this.target.z) + 0.03;
      const dist = this.target.distanceTo(this.pos);
      this.resting = tag === 'rest' && dist < 0.4 && this.fleeT < 7;
      if (!this.resting) {
        this.target.y += 0.2;
        this.steer(dt, Math.max(this.sp.speed[0], Math.min(this.sp.speed[1], dist * 0.6)), 1.5);
        this.u.uAmp.value = 0.05; this.phase += dt * 4;
      } else {
        this.vel.multiplyScalar(0.9);
        this.pos.x = THREE.MathUtils.lerp(this.pos.x, this.target.x, dt * 0.5); this.pos.z = THREE.MathUtils.lerp(this.pos.z, this.target.z, dt * 0.5);
        this.pos.y = THREE.MathUtils.lerp(this.pos.y, heightAt(this.pos.x, this.pos.z) + 0.03, dt * 1.5);
        this.pitch = THREE.MathUtils.lerp(this.pitch, 0, dt); this.roll = THREE.MathUtils.lerp(this.roll, 0, dt);
        this.u.uAmp.value = 0.01; this.phase += dt * 0.8;
      }
      this.life = this.plan.end - this.T; this.leaving = this.T > this.plan.end;
      this.u.uPhase.value = this.phase;
      this.apply();
      this.despawnIfFar(d);
      return;
    }
    this.life -= dt;
    if (this.life <= 0 && !this.leaving) { this.leave(); this.exitTarget(d); this.resting = false; }
    if (this.resting && d.active && this.pos.distanceTo(d.pos) < this.sp.shy) {
      this.resting = false;
      const away = this.pos.clone().sub(d.pos).setY(0).normalize();
      this.target.copy(this.pos).addScaledVector(away, rand(R, 3, 6)).add(V3(rand(R, -1, 1), 0, rand(R, -1, 1)));
    }
    if (!this.resting) {
      this.target.y = heightAt(this.target.x, this.target.z) + 0.25;
      const dist = this.steer(dt, this.sp.speed[1], 1.5);
      this.u.uAmp.value = 0.05; this.phase += dt * 4;
      if (dist < 0.3 && !this.leaving) this.resting = true;
    } else {
      this.vel.multiplyScalar(0.9);
      this.pos.y = THREE.MathUtils.lerp(this.pos.y, heightAt(this.pos.x, this.pos.z) + 0.03, dt * 1.5);
      this.pitch = THREE.MathUtils.lerp(this.pitch, 0, dt); this.roll = THREE.MathUtils.lerp(this.roll, 0, dt);
      this.u.uAmp.value = 0.01; this.phase += dt * 0.8;
    }
    this.u.uPhase.value = this.phase;
    this.apply();
    this.despawnIfFar(d);
  }
}

// ───────── 해파리 무리 (보름달물해파리 / 태평양 쐐기해파리) ─────────
export class JellySwarm implements Creature {
  alive = true; leaving = false; encountered = false; life: number;
  private mesh: THREE.InstancedMesh; private tent: THREE.InstancedMesh;
  dispose() { this.alive = false; if (this.mesh.parent) disposeTree(this.mesh); if (this.tent.parent) disposeTree(this.tent); }
  private items: { p: THREE.Vector3; ph: number; s: number; v: THREE.Vector3; tilt: number }[] = [];
  private home = new THREE.Vector3();
  private m = new THREE.Matrix4();
  private phases: THREE.InstancedBufferAttribute; private phases2: THREE.InstancedBufferAttribute;
  /** 공유 생태계 계획 · 공유 시각 (계획이 있으면 무리 중심이 해류를 따라 모두에게 같게 떠다님) */
  plan: Plan | null = null;
  T = 0;
  private base: THREE.Vector3[] = [];
  constructor(public sp: SpeciesDef, scene: THREE.Scene, at: THREE.Vector3) {
    this.life = rand(R, sp.stay[0], sp.stay[1]);
    this.home.copy(at);
    const n = Math.round(rand(R, sp.group[0], sp.group[1]));
    const cs = sp.colors.map((c) => new THREE.Color(c));
    const nettle = sp.id === 'seanettle';
    // 종 모양 갓
    const bell = new THREE.LatheGeometry(Array.from({ length: 16 }, (_, i) => {
      const t = i / 15; const a = t * Math.PI * 0.5;
      return new THREE.Vector2(Math.sin(a) * 0.5 * (1 + 0.06 * t), Math.cos(a) * (nettle ? 0.42 : 0.24) - (nettle ? 0.12 : 0.05) * t * t);
    }), 40);
    // 촉수 + 구완(口腕)
    const tg: number[] = [], tu: number[] = [];
    const ribbons = nettle ? 24 : 40;
    for (let k = 0; k < ribbons + 4; k++) {
      const oral = k >= ribbons;
      const a = oral ? (k - ribbons) * Math.PI / 2 + 0.4 : (k / ribbons) * Math.PI * 2;
      const r0 = oral ? 0.06 : 0.49;
      const len = oral ? (nettle ? 2.2 : 0.35) : (nettle ? 3.2 : 0.25);
      const w = oral ? (nettle ? 0.06 : 0.05) : 0.006;
      const segs = 14;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs, t1 = (i + 1) / segs;
        const px = Math.cos(a) * r0, pz = Math.sin(a) * r0;
        const tx = -Math.sin(a) * w, tz = Math.cos(a) * w;
        const quad = [[px - tx, -t0 * len, pz - tz, t0], [px + tx, -t0 * len, pz + tz, t0], [px - tx, -t1 * len, pz - tz, t1], [px + tx, -t1 * len, pz + tz, t1]];
        for (const id of [0, 2, 1, 1, 2, 3]) { tg.push(quad[id][0], quad[id][1] - (oral ? 0.02 : 0.0), quad[id][2]); tu.push(quad[id][3], oral ? 1 : 0, a); }
      }
    }
    const tgeo = new THREE.BufferGeometry();
    tgeo.setAttribute('position', new THREE.Float32BufferAttribute(tg, 3));
    tgeo.setAttribute('aT', new THREE.Float32BufferAttribute(tu, 3));
    this.phases = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.phases2 = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    bell.setAttribute('aPh', this.phases); tgeo.setAttribute('aPh', this.phases2);
    const common = { ...waterUniforms, uC1: { value: cs[0] }, uC2: { value: cs[1] }, uC3: { value: cs[2] } };
    const pulse = `float pl = pow(max(sin(aPh), 0.0), 2.0);`;
    const bellMat = new THREE.ShaderMaterial({
      uniforms: common, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `attribute float aPh; varying vec3 vN; varying vec3 vW; varying vec3 vL;
        void main(){ ${pulse} vec3 p = position; float rr = length(p.xz);
          p.xz *= 1.0 - 0.22 * pl * smoothstep(0.1, 0.5, rr); p.y *= 1.0 + 0.18 * pl; vL = position;
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `varying vec3 vN; varying vec3 vW; varying vec3 vL; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
        ${WATER_GLSL_COMMON}
        void main(){ vec3 V = normalize(cameraPosition - vW); float f = pow(clamp(1.0 - abs(dot(normalize(vN), V)), 0.0, 1.0), 1.6);
          float r = length(vL.xz); float ang = atan(vL.z, vL.x);
          // 보름달물해파리의 네 잎 생식선 / 방사관
          float gon = ${nettle ? '0.0' : 'smoothstep(0.03, 0.0, abs(length(vec2(r - 0.18, 0.0)) * (1.0 + 0.6 * cos(ang * 4.0)) - 0.06)) * step(r, 0.3)'};
          float canal = smoothstep(0.012, 0.0, abs(fract(ang / 6.2831 * 16.0) - 0.5) * r * 0.7) * smoothstep(0.1, 0.45, r);
          float rim = smoothstep(0.44, 0.5, r);
          vec3 c = uC1 * (0.35 + f * 1.4) + uC2 * gon * 0.9 + uC3 * (canal * 0.35 + rim * 0.5);
          c *= 0.6 + 0.6 * exp(-max(-vW.y, 0.0) * 0.05);
          float a = clamp(0.12 + f * 0.55 + gon * 0.5 + rim * 0.25, 0.0, 0.85);
          vec3 T = exp(-uExtinct * length(vW - cameraPosition)); a *= dot(T, vec3(0.333));
          gl_FragColor = vec4(c, a); }`,
    });
    const tentMat = new THREE.ShaderMaterial({
      uniforms: common, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `attribute vec3 aT; attribute float aPh; varying float vT; varying float vOral; varying vec3 vW; uniform float uTime;
        void main(){ ${pulse} vec3 p = position; float t = aT.x; vT = t; vOral = aT.y;
          float sway = sin(uTime * 0.9 + aT.z * 3.0 + t * 4.0 + aPh * 0.3) * 0.12 * t;
          p.x += sway * (0.5 + aT.y); p.z += cos(uTime * 0.7 + aT.z * 2.0 + t * 3.0) * 0.08 * t;
          p.xz *= 1.0 - 0.15 * pl * (1.0 - t);
          p.y -= pl * 0.05 * t;
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `varying float vT; varying float vOral; varying vec3 vW; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
        ${WATER_GLSL_COMMON}
        void main(){ vec3 c = mix(uC3, uC2, vOral) * (0.8 + 0.4 * (1.0 - vT)); float a = (1.0 - vT) * (vOral > 0.5 ? 0.5 : 0.35);
          vec3 T = exp(-uExtinct * length(vW - cameraPosition)); a *= dot(T, vec3(0.333)); gl_FragColor = vec4(c, a); }`,
    });
    this.mesh = new THREE.InstancedMesh(bell, bellMat, n);
    this.tent = new THREE.InstancedMesh(tgeo, tentMat, n);
    this.mesh.frustumCulled = false; this.tent.frustumCulled = false;
    this.mesh.renderOrder = 8; this.tent.renderOrder = 8;
    for (let i = 0; i < n; i++) {
      this.items.push({ p: at.clone().add(V3(rand(R, -5, 5), rand(R, -2.5, 2.5), rand(R, -5, 5))), ph: rand(R, 0, 6.28), s: sp.length * rand(R, 0.6, 1.2), v: V3(), tilt: rand(R, -0.3, 0.3) });
    }
    scene.add(this.mesh, this.tent);
    this.base = this.items.map((it) => it.p.clone().sub(at));
  }
  attach(plan: Plan, T: number) { this.plan = plan; this.T = T; plan.path.at(T, this.home); for (let i = 0; i < this.items.length; i++) this.items[i].p.copy(this.home).add(this.base[i]); return this; }
  center() { return this.home; }
  leave() { this.leaving = true; }
  update(dt: number, _t: number, d: DiverInfo) {
    const q = new THREE.Quaternion(), sc = V3();
    if (this.plan) {
      // 공유 시각으로 맥동 · 무리 중심은 해류 경로를 따라감
      this.plan.path.at(this.T, this.home);
      this.life = this.plan.end - this.T; this.leaving = this.T > this.plan.end;
      this.items.forEach((it, i) => {
        it.ph = this.T * 1.6 + i * 1.7;
        const b = this.base[i];
        it.p.set(this.home.x + b.x + Math.sin(this.T * 0.05 + i) * 0.6, this.home.y + b.y + Math.sin(this.T * 0.21 + i * 2.1) * 0.5, this.home.z + b.z + Math.cos(this.T * 0.04 + i) * 0.6);
        const floor = heightAt(it.p.x, it.p.z) + 1.5;
        if (it.p.y < floor) it.p.y = floor;
        if (it.p.y > -0.8) it.p.y = -0.8;
        q.setFromEuler(new THREE.Euler(it.tilt + Math.sin(it.ph * 0.3) * 0.08, 0, it.tilt * 0.5));
        sc.setScalar(it.s);
        this.m.compose(it.p, q, sc);
        this.mesh.setMatrixAt(i, this.m); this.tent.setMatrixAt(i, this.m);
        this.phases.setX(i, it.ph); this.phases2.setX(i, it.ph);
      });
      this.mesh.instanceMatrix.needsUpdate = true; this.tent.instanceMatrix.needsUpdate = true;
      this.phases.needsUpdate = true; this.phases2.needsUpdate = true;
      if (!this.encountered && d.active && this.home.distanceTo(d.pos) < 8) this.encountered = true;
      return;
    }
    this.life -= dt;
    if (this.life <= 0) this.leaving = true;
    this.items.forEach((it, i) => {
      const before = Math.sin(it.ph);
      it.ph += dt * 1.6;
      // 갓이 수축할 때마다 위로 살짝 밀려 올라감, 이완 중엔 천천히 가라앉음
      const pulse = Math.max(0, Math.sin(it.ph)) ** 2;
      it.v.y += (pulse * 0.25 - 0.04) * dt;
      it.v.multiplyScalar(Math.exp(-0.9 * dt));
      it.p.addScaledVector(it.v, dt);
      it.p.x += 0.05 * dt; // 해류에 떠밀림
      const floor = heightAt(it.p.x, it.p.z) + 1.5;
      if (it.p.y < floor) it.v.y += 0.2 * dt;
      if (it.p.y > -0.8) it.v.y -= 0.3 * dt;
      void before;
      q.setFromEuler(new THREE.Euler(it.tilt + Math.sin(it.ph * 0.3) * 0.08, 0, it.tilt * 0.5));
      sc.setScalar(it.s);
      this.m.compose(it.p, q, sc);
      this.mesh.setMatrixAt(i, this.m); this.tent.setMatrixAt(i, this.m);
      this.phases.setX(i, it.ph); this.phases2.setX(i, it.ph);
    });
    this.mesh.instanceMatrix.needsUpdate = true; this.tent.instanceMatrix.needsUpdate = true;
    this.phases.needsUpdate = true; this.phases2.needsUpdate = true;
    const dist = this.home.distanceTo(d.pos);
    if (!this.encountered && dist < 8) this.encountered = true;
    if ((this.leaving && dist > 40) || dist > 70) { this.dispose(); }
  }
}

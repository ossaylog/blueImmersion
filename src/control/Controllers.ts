// 스노클링 / 스쿠버다이빙 이동 컨트롤러 — 두 체험의 조작감이 완전히 다르게
import * as THREE from 'three';
import type { InputState } from './Input';
import type { Diver } from '../character/Diver';
import { heightAt } from '../world/terrain';
import { waveHeight, waveSlope } from '../water/OceanSurface';
import { clamp, damp, dampAngle } from '../core/math';

const BOUND_R = 95; // 판툰에서 이 이상 멀어지지 않도록 부드럽게 제한

/** 수영하는 몸이 뚫고 지나가면 안 되는 물체(판툰·배)를 밀어내는 함수들 (월드 좌표, 몸 반지름) */
export const colliders: ((p: THREE.Vector3, r: number) => boolean)[] = [];
function collide(p: THREE.Vector3, vel: THREE.Vector3, r: number) {
  for (const c of colliders) {
    const bx = p.x, bz = p.z;
    if (c(p, r)) {
      // 밀려난 방향의 속도는 없앰 (벽에 부딪혀 멈춤)
      const dx = p.x - bx, dz = p.z - bz, l = Math.hypot(dx, dz);
      if (l > 1e-5) { const nx = dx / l, nz = dz / l; const vn = vel.x * nx + vel.z * nz; if (vn < 0) { vel.x -= vn * nx; vel.z -= vn * nz; } }
    }
  }
}

function moveVector(inp: InputState, yaw: number, out: THREE.Vector3) {
  const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const r = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
  out.set(0, 0, 0).addScaledVector(f, inp.move.y).addScaledVector(r, inp.move.x);
  const l = out.length();
  if (l > 1) out.divideScalar(l);
  return out;
}

export interface ControllerOut { hint?: string }

/** 몸이 향한 방향 기준으로 '뒤로' 가려는 입력인지 (후진은 몸을 돌리지 않고 백킥·스컬링) */
function backing(want: THREE.Vector3, yaw: number) {
  const l = Math.hypot(want.x, want.z);
  if (l < 0.05) return false;
  return (want.x * Math.sin(yaw) + want.z * Math.cos(yaw)) / l < -0.6;
}
/** 진행 방향으로 몸을 돌려도 되는지 (뒤로 미끄러지는 중이면 돌지 않음) */
function forwardish(vel: THREE.Vector3, yaw: number) {
  const hs = Math.hypot(vel.x, vel.z);
  return (vel.x * Math.sin(yaw) + vel.z * Math.cos(yaw)) > -0.3 * hs;
}

export class SnorkelController {
  pos = new THREE.Vector3(); vel = new THREE.Vector3(); yaw = 0;
  diving = false; idle = 0;
  /** 숨 (1 = 가득) — 잠수 중 줄어들고 수면에서 회복 */
  breath = 1;
  /** 5m 한계 또는 숨이 차서 수면으로 올라가는 중 */
  mustSurface = false;
  readonly maxDepth = 4.75; // 머리 기준 약 5m
  private limitT = 0;
  private breathT = 0;
  private wasUnder = false;
  onBreath?: (inhale: boolean) => void;
  onNeedAir?: (reason: 'depth' | 'breath') => void;
  onSurfaceBreath?: () => void;
  readonly maxSpeed = 0.8;
  fp = false;
  /** 수면에서 고개를 들고 선헤엄 (물 위를 둘러봄) */
  headUp = false;
  private upWas = false;
  onHeadUp?: (up: boolean) => void;

  start(p: THREE.Vector3, yaw: number) { this.pos.copy(p); this.vel.set(0, 0, 0); this.yaw = yaw; this.diving = false; this.breath = 1; this.mustSurface = false; this.headUp = false; }

  private setHeadUp(v: boolean) { if (this.headUp !== v) { this.headUp = v; this.onHeadUp?.(v); } }

  update(dt: number, t: number, inp: InputState, camYaw: number, diver: Diver): ControllerOut {
    // 수면에 떠 있을 때 '수면(↑)'을 누르면 고개를 들고, 다시 누르거나 잠수하면 엎드림
    const upEdge = inp.up && !this.upWas; this.upWas = inp.up;
    const nearTop = this.pos.y > waveHeight(this.pos.x, this.pos.z, t) - 0.5;
    if (inp.down) this.setHeadUp(false);
    else if (upEdge && !this.diving && (this.headUp || nearTop)) this.setHeadUp(!this.headUp);
    const want = moveVector(inp, camYaw, new THREE.Vector3()).multiplyScalar(this.maxSpeed * (this.headUp ? 0.55 : 1));
    // 뒤로: 오리발로는 후진이 어려워 손 스컬링으로 천천히
    const back = !this.fp && !this.headUp && inp.move.y < -0.3 && backing(want, this.yaw);
    if (back) want.multiplyScalar(0.3);
    const wave = waveHeight(this.pos.x, this.pos.z, t);
    const surfY = wave - 0.2;
    // 고개를 들면 골반이 더 깊이 (머리만 물 밖)
    const restY = this.headUp ? wave - 0.74 : surfY;
    // 잠수 버튼을 누르는 동안 덕다이브, 놓으면 그 깊이에서 유지 (최대 5m)
    const limitY = surfY - this.maxDepth;
    const floor = Math.max(heightAt(this.pos.x, this.pos.z) + 0.75, limitY);
    const down = inp.down && !this.mustSurface;
    if (down) { this.diving = true; want.y = -0.75; }
    // 잠수 버튼을 놓으면 그 깊이에서 머무름 (생물 관찰) · 수면 버튼(↑)이나 숨이 차면 올라감
    else if (this.diving) { want.y = this.mustSurface ? 1.25 : inp.up ? 1.15 : 0; }
    if (this.diving && this.pos.y >= surfY - 0.05 && !down) this.diving = false;
    // 5m 한계에서 계속 내려가려 하면 → 숨 쉬러 올라감
    if (down && this.pos.y <= limitY + 0.05) {
      this.limitT += dt;
      if (this.limitT > 0.7) { this.mustSurface = true; this.onNeedAir?.('depth'); }
    } else this.limitT = 0;
    const under = !this.headUp && this.pos.y < surfY - 0.4;
    if (under) {
      this.breath = Math.max(0, this.breath - dt / 38);
      if (this.breath <= 0.12 && !this.mustSurface) { this.mustSurface = true; this.onNeedAir?.('breath'); }
    } else {
      if (this.wasUnder) this.onSurfaceBreath?.();
      this.breath = Math.min(1, this.breath + dt / 4);
      if (this.breath > 0.6) this.mustSurface = false;
    }
    this.wasUnder = under;
    // 물의 저항: 서서히 가속·감속
    this.vel.x = damp(this.vel.x, want.x, 1.6, dt);
    this.vel.z = damp(this.vel.z, want.z, 1.6, dt);
    this.vel.y = damp(this.vel.y, this.diving || down ? want.y : 0, want.y > 0 ? 3.2 : 2.2, dt);
    this.pos.addScaledVector(this.vel, dt);
    // 경계
    const d = Math.hypot(this.pos.x, this.pos.z);
    if (d > BOUND_R) { this.pos.x *= BOUND_R / d; this.pos.z *= BOUND_R / d; }
    if (this.pos.y < floor) { this.pos.y = floor; this.vel.y = Math.max(0, this.vel.y); }
    if (!this.diving) this.pos.y = damp(this.pos.y, restY, 4, dt);
    if (this.pos.y > surfY) this.pos.y = surfY;
    collide(this.pos, this.vel, 0.45);

    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.fp) this.yaw = dampAngle(this.yaw, camYaw, 6, dt);
    else if (hs > 0.08 && !back && forwardish(this.vel, this.yaw)) this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 2.4, dt);
    this.idle = hs < 0.1 && Math.abs(this.vel.y) < 0.1 ? this.idle + dt : 0;
    diver.motion = back ? 'back' : hs > 0.1 ? 'fwd' : 'idle';

    // 캐릭터: 수면에 엎드려 떠 있음 → 파도에 따라 몸이 흔들림
    diver.root.position.copy(this.pos);
    diver.root.rotation.order = 'YXZ';
    const [gx, gz] = waveSlope(this.pos.x, this.pos.z, t);
    const atSurface = !this.diving;
    diver.root.rotation.set(atSurface ? -gz * 0.5 : 0, this.yaw, atSurface ? gx * 0.5 : 0);
    diver.pose = this.headUp && !this.diving ? 'tread' : this.diving && this.vel.y < -0.2 ? 'duck' : hs > 0.12 || this.diving ? 'swim' : 'float';
    diver.speed = clamp(hs / this.maxSpeed + (this.diving ? 0.4 : 0), 0, 1);

    // 스노클 호흡 (수면에서만)
    if (atSurface && !this.headUp) {
      this.breathT += dt;
      if (this.breathT > 4.2) { this.breathT = 0; this.onBreath?.(true); setTimeout(() => this.onBreath?.(false), 1700); }
    }
    return { hint: this.diving ? '' : undefined };
  }
  get depth() { return this.headUp && !this.diving ? 0 : Math.min(5, Math.max(0, -this.pos.y - 0.2)); }
}

export class ScubaController {
  pos = new THREE.Vector3(); vel = new THREE.Vector3(); yaw = 0; idle = 0;
  private breathT = 0; private inhaling = true;
  onInhale?: () => void; onExhale?: () => void;
  readonly maxSpeed = 0.9;
  readonly ascentMax = 0.36;  // 약 21 m/min (체험 템포에 맞춘 상승 속도)
  readonly descentMax = 0.45;
  breathOffset = 0;
  fp = false;
  /** 수면 위로 머리를 내놓고 떠 있음 (BCD 부력) */
  surfaced = false;
  private upHold = 0;
  private turnRate = 0;
  onSurface?: (up: boolean) => void;

  start(p: THREE.Vector3, yaw: number) { this.pos.copy(p); this.vel.set(0, 0, 0); this.yaw = yaw; this.surfaced = false; this.upHold = 0; }

  update(dt: number, t: number, inp: InputState, camYaw: number, diver: Diver): ControllerOut {
    if (this.surfaced) return this.updateSurface(dt, t, inp, camYaw, diver);
    const want = moveVector(inp, camYaw, new THREE.Vector3()).multiplyScalar(this.maxSpeed);
    // 뒤로: 몸을 돌리지 않고 백킥으로 천천히 후진 (실제 다이버도 백킥은 느림)
    const back = inp.move.y < -0.3 && backing(want, this.yaw);   // 후진 키(S)일 때만
    if (back) want.multiplyScalar(0.38);
    let vy = 0;
    if (inp.up) vy = this.ascentMax;
    if (inp.down) vy = -this.descentMax;
    if (inp.stop) { want.set(0, 0, 0); vy = 0; }
    // 수직: 버튼을 놓으면 중성부력으로 정지
    this.vel.y = damp(this.vel.y, vy, vy === 0 ? 1.8 : vy > 0 ? 2.2 : 1.2, dt);
    if (!back && !this.fp) {
      const wl = Math.hypot(want.x, want.z);
      if (wl > 0.05) {
        const al = (want.x * Math.sin(this.yaw) + want.z * Math.cos(this.yaw)) / wl;
        want.multiplyScalar(THREE.MathUtils.clamp(0.35 + al * 0.65, 0.25, 1));
      }
    }
    this.vel.x = damp(this.vel.x, want.x, 1.2, dt);
    this.vel.z = damp(this.vel.z, want.z, 1.2, dt);
    this.pos.addScaledVector(this.vel, dt);
    const d = Math.hypot(this.pos.x, this.pos.z);
    if (d > BOUND_R) { this.pos.x *= BOUND_R / d; this.pos.z *= BOUND_R / d; }
    const floor = heightAt(this.pos.x, this.pos.z) + 0.65;
    if (this.pos.y < floor) { this.pos.y = floor; this.vel.y = Math.max(0, this.vel.y); }
    collide(this.pos, this.vel, 0.55);
    const surf = waveHeight(this.pos.x, this.pos.z, t) - 0.45;
    if (this.pos.y > surf) { this.pos.y = surf; this.vel.y = Math.min(0, this.vel.y); }
    // 수면에 닿은 채 계속 상승하면 물 밖으로 머리를 내밀고 뜸
    if (inp.up && this.pos.y >= surf - 0.08) {
      this.upHold += dt;
      if (this.upHold > 0.35) { this.surfaced = true; this.upHold = 0; this.onSurface?.(true); }
    } else this.upHold = 0;

    const hs = Math.hypot(this.vel.x, this.vel.z);
    const prevYaw = this.yaw;
    if (this.fp) this.yaw = dampAngle(this.yaw, camYaw, 6, dt);
    else if (hs > 0.08 && !back && forwardish(this.vel, this.yaw)) {
      // 진행 방향과 차이가 크면 먼저 제자리에서 돌고(헬리콥터 턴) 그다음 앞으로
      const target = Math.atan2(this.vel.x, this.vel.z);
      this.yaw = dampAngle(this.yaw, target, 2.2, dt);
    }
    let dy = this.yaw - prevYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.turnRate = damp(this.turnRate, dy / Math.max(dt, 1e-4), 6, dt);
    this.idle = hs < 0.08 && Math.abs(this.vel.y) < 0.05 ? this.idle + dt : 0;
    diver.motion = back ? 'back' : Math.abs(this.turnRate) > 0.45 && hs < 0.45 ? (this.turnRate > 0 ? 'turnL' : 'turnR') : hs > 0.1 ? 'fwd' : 'idle';

    // 호흡 주기: 들이쉬면 폐 부력으로 살짝 떠오르고, 내쉬면 가라앉음
    this.breathT += dt;
    const period = this.inhaling ? 2.0 : 2.6;
    if (this.breathT > period) {
      this.breathT = 0; this.inhaling = !this.inhaling;
      if (this.inhaling) this.onInhale?.(); else this.onExhale?.();
    }
    const target = this.inhaling ? (this.breathT / 2.0) * 0.04 : (1 - this.breathT / 2.6) * 0.04;
    this.breathOffset = damp(this.breathOffset, target, 3, dt);

    diver.root.position.copy(this.pos); diver.root.position.y += this.breathOffset;
    diver.root.rotation.order = 'YXZ';
    // 상승 시 머리가 살짝 들리고, 하강 시 머리부터
    const tilt = clamp(-this.vel.y * 0.8, -0.35, 0.35);
    diver.root.rotation.set(tilt, this.yaw, 0);
    diver.pose = hs > 0.12 || diver.motion === 'turnL' || diver.motion === 'turnR' ? 'swim' : 'hover';
    diver.speed = clamp(hs / this.maxSpeed, 0, 1);
    return {};
  }
  /** 수면 선헤엄: 파도를 따라 오르내리며 천천히 이동, 하강 입력 시 다시 잠수 */
  private updateSurface(dt: number, t: number, inp: InputState, camYaw: number, diver: Diver): ControllerOut {
    const want = moveVector(inp, camYaw, new THREE.Vector3()).multiplyScalar(this.maxSpeed * 0.5);
    if (inp.stop) want.set(0, 0, 0);
    this.vel.x = damp(this.vel.x, want.x, 1.4, dt);
    this.vel.z = damp(this.vel.z, want.z, 1.4, dt);
    this.vel.y = 0;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    collide(this.pos, this.vel, 0.5);
    const d = Math.hypot(this.pos.x, this.pos.z);
    if (d > BOUND_R) { this.pos.x *= BOUND_R / d; this.pos.z *= BOUND_R / d; }
    const wave = waveHeight(this.pos.x, this.pos.z, t);
    this.pos.y = damp(this.pos.y, wave - 0.74, 5, dt);
    if (inp.down) {
      this.surfaced = false; this.vel.y = -0.15; this.pos.y = Math.min(this.pos.y, wave - 0.5);
      this.onSurface?.(false);
    }
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.fp) this.yaw = dampAngle(this.yaw, camYaw, 6, dt);
    else if (hs > 0.06) this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 2.2, dt);
    this.idle = hs < 0.08 ? this.idle + dt : 0;
    this.breathOffset = 0;
    diver.root.position.copy(this.pos);
    diver.root.rotation.order = 'YXZ';
    const [gx, gz] = waveSlope(this.pos.x, this.pos.z, t);
    diver.root.rotation.set(-gz * 0.4, this.yaw, gx * 0.4);
    diver.pose = 'tread';
    diver.motion = hs > 0.08 ? 'fwd' : 'idle';
    diver.speed = clamp(hs / (this.maxSpeed * 0.5), 0, 1);
    return {};
  }

  get depth() { return this.surfaced ? 0 : Math.max(0, -this.pos.y); }
}

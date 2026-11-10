// 3인칭 오빗 카메라 (+ 연출용 시네마틱 모드). 1인칭은 dist→0 + 마스크 비네트로 확장 예정
import * as THREE from 'three';
import type { InputState } from './Input';
import { heightAt } from '../world/terrain';
import { waveHeight } from '../water/OceanSurface';
import { clamp, damp, dampAngle } from '../core/math';

export class CameraRig {
  yaw = 0; pitch = 0.25; dist = 3.6;
  private yawT = 0; private pitchT = 0.25; private distT = 3.6;
  mode: 'orbit' | 'cine' | 'fp' = 'cine';
  cinePos = new THREE.Vector3(); cineLook = new THREE.Vector3();
  private look = new THREE.Vector3();
  pitchRange: [number, number] = [-1.1, 1.1];
  distRange: [number, number] = [1.6, 9];
  sensitivity = 1;
  cineLambda = 1.6;
  /** 수면 위로 머리를 내민 상태: 카메라도 물 밖에서 수평선·하늘·배를 봄 */
  surfaceMode = false;
  /** 판툰 위: 2층 데크 아래에서 천장을 뚫지 않게 · 바닥 아래로 내려가지 않게 (월드 y) */
  ceil: number | undefined;
  minY: number | undefined;

  /** 목표 시선 각도·거리만 부드럽게 바꿈 */
  aim(pitch?: number, dist?: number) {
    if (pitch !== undefined) this.pitchT = clamp(pitch, this.pitchRange[0], this.pitchRange[1]);
    if (dist !== undefined) this.distT = clamp(dist, this.distRange[0], this.distRange[1]);
  }

  constructor(public camera: THREE.PerspectiveCamera) {}

  setCine(pos: THREE.Vector3, look: THREE.Vector3, lambda = 1.6) { this.mode = 'cine'; this.cinePos.copy(pos); this.cineLook.copy(look); this.cineLambda = lambda; }

  /** 현재 카메라 위치에서 끊김 없이 오빗으로 전환 */
  toOrbit(focus: THREE.Vector3, dist?: number, pitch?: number) {
    const d = this.camera.position.clone().sub(focus);
    const len = d.length();
    this.yaw = this.yawT = Math.atan2(-d.x, -d.z);
    this.pitch = this.pitchT = pitch ?? Math.asin(clamp(d.y / Math.max(len, 1e-3), -1, 1));
    this.dist = len; this.distT = dist ?? clamp(len, this.distRange[0], this.distRange[1]);
    this.look.copy(focus);
    this.mode = 'orbit';
  }

  /** 1인칭으로 전환: 현재 보는 방향 유지 */
  toFP(eye: THREE.Vector3, yaw?: number, pitch?: number) {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.yaw = this.yawT = yaw ?? Math.atan2(dir.x, dir.z);
    this.pitch = this.pitchT = pitch ?? -Math.asin(clamp(dir.y, -1, 1));
    this.look.copy(eye);
    this.mode = 'fp';
  }

  /** 입력 → 목표 각도 */
  handleInput(inp: InputState, isTouch: boolean) {
    const k = (isTouch ? 0.0065 : 0.0045) * this.sensitivity;
    this.yawT -= inp.look.x * k;
    this.pitchT = clamp(this.pitchT + inp.look.y * k * 0.8, this.pitchRange[0], this.pitchRange[1]);
    this.distT = clamp(this.distT + inp.zoom * 0.5, this.distRange[0], this.distRange[1]);
  }

  update(dt: number, focus: THREE.Vector3, t: number, underwater: boolean) {
    const cam = this.camera;
    if (this.mode === 'cine') {
      const a = 1 - Math.exp(-this.cineLambda * dt);
      cam.position.lerp(this.cinePos, a);
      this.look.lerp(this.cineLook, a);
      cam.lookAt(this.look);
      return;
    }
    // 급격한 회전 방지: 목표 각도로 감쇠
    this.yaw = dampAngle(this.yaw, this.yawT, 10, dt);
    this.pitch = damp(this.pitch, this.pitchT, 10, dt);
    if (this.mode === 'fp') {
      // 1인칭: 마스크 위치에서 바라봄 (머리 흔들림은 몸 움직임을 그대로 따름)
      this.look.lerp(focus, 1 - Math.exp(-25 * dt));
      const pos = this.look.clone();
      if (this.surfaceMode) { const top = waveHeight(pos.x, pos.z, t) + 0.12; if (pos.y < top) pos.y = top; }
      else if (underwater) { const surf = waveHeight(pos.x, pos.z, t) - 0.12; if (pos.y > surf) pos.y = surf; }
      const fl = heightAt(pos.x, pos.z) + 0.25;
      if (pos.y < fl) pos.y = fl;
      const cp = Math.cos(this.pitch);
      cam.position.copy(pos);
      cam.lookAt(pos.clone().add(new THREE.Vector3(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp)));
      return;
    }
    this.dist = damp(this.dist, this.distT, 6, dt);
    this.look.lerp(focus, 1 - Math.exp(-8 * dt));
    const cp = Math.cos(this.pitch);
    const off = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).multiplyScalar(this.dist);
    const pos = this.look.clone().add(off);
    // 지형 아래로 파고들지 않게
    const floor = heightAt(pos.x, pos.z) + 0.45;
    if (pos.y < floor) pos.y = floor;
    if (!underwater && !this.surfaceMode) {
      if (this.minY !== undefined && pos.y < this.minY) pos.y = this.minY;
      if (this.ceil !== undefined && pos.y > this.ceil) {
        // 천장 아래: 높이를 누르는 만큼 뒤로 물러나 시야 확보
        pos.y = this.ceil;
        if (this.look.y > this.ceil - 0.2) this.look.y = this.ceil - 0.2;
      }
    }
    // 수중 체험 중에는 카메라가 수면 위로 나가지 않음 (스노클은 수면 바로 아래에서 내려다봄)
    if (this.surfaceMode) {
      // 물 밖: 파도에 잠기지 않도록 수면 위 일정 높이 유지
      const top = waveHeight(pos.x, pos.z, t) + 0.4;
      if (pos.y < top) pos.y = top;
    } else if (underwater) {
      const surf = waveHeight(pos.x, pos.z, t) - 0.28;
      if (pos.y > surf) pos.y = surf;
    }
    cam.position.copy(pos);
    cam.lookAt(this.look);
  }

  /** 이동 기준 방향 (카메라 수평 yaw) */
  get heading() { return this.yaw; }
}

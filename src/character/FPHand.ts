// 1인칭 손 인사: 내 몸은 1인칭에서 숨겨지므로, 시야 오른쪽 아래에서 팔뚝과 손이 올라와 흔들고 다시 내려감
//  카메라를 따라다니는 작은 팔 (캐릭터와 같은 재질 → 스노클은 맨팔, 스쿠버는 슈트 소매)
//  화면 비율·시야각에 맞춰 위치를 잡아 세로 폰에서도 손이 화면 안쪽에 자연스럽게 보임
import * as THREE from 'three';
import type { Diver } from './Diver';

const ease = (u: number) => u * u * (3 - 2 * u);
const DIST = 0.5;           // 카메라에서 손까지 거리 (m)
const FORE = 0.24;           // 팔뚝 길이

export class FPHand {
  private root = new THREE.Group();     // 카메라 위치·방향
  private elbow = new THREE.Group();    // 팔꿈치 (화면 아래 가장자리 밖)
  private sleeve: THREE.Mesh;
  private skinArm: THREE.Mesh;
  private t = -1;                       // 진행 시간 (−1 = 쉬는 중)
  private dur = 2.4;

  constructor(scene: THREE.Scene, private diver: Diver, private camera: THREE.PerspectiveCamera) {
    const { skin, suit } = diver.mats;
    // 팔뚝: 팔꿈치에서 +y로 뻗는 둥근 원기둥 (양 끝 반구)
    const arm = (mat: THREE.Material, r0: number, r1: number) => {
      const g = new THREE.CapsuleGeometry((r0 + r1) / 2, FORE, 6, 14);
      g.translate(0, FORE / 2, 0);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) { const y = pos.getY(i), k = THREE.MathUtils.clamp(y / FORE, 0, 1); const s = (r0 + (r1 - r0) * k) / ((r0 + r1) / 2); pos.setX(i, pos.getX(i) * s); pos.setZ(i, pos.getZ(i) * s); }
      g.computeVertexNormals();
      return new THREE.Mesh(g, mat);
    };
    this.skinArm = arm(skin, 0.042, 0.036);
    this.sleeve = arm(suit, 0.047, 0.041);
    this.elbow.add(this.skinArm, this.sleeve);
    // 손바닥: 납작한 둥근 손 + 엄지 (손바닥이 앞을 향함)
    const hand = new THREE.Group(); hand.position.y = FORE + 0.045; this.elbow.add(hand);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.05, 18, 14), skin); palm.scale.set(1, 1.12, 0.62); hand.add(palm);
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.03, 4, 8), skin); thumb.position.set(-0.046, 0.0, 0.004); thumb.rotation.z = 0.55; hand.add(thumb);
    this.root.add(this.elbow);
    this.root.visible = false;
    this.root.traverse((o) => { o.frustumCulled = false; o.renderOrder = 2; });
    scene.add(this.root);
  }

  start(dur = 2.4) { if (this.t < 0 || this.t > this.dur - 0.45) this.t = 0; this.dur = dur; }
  stop() { this.t = -1; this.root.visible = false; }

  /** 카메라 갱신 뒤에 호출 */
  update(dt: number, active: boolean) {
    if (!active || this.t < 0) { this.root.visible = false; if (!active) this.t = -1; return; }
    this.t += dt;
    const T = this.t, D = this.dur;
    if (T >= D) { this.stop(); return; }
    // 올리기 0.35초 → 흔들기 → 내리기 0.4초
    const up = T < 0.35 ? ease(T / 0.35) : T > D - 0.4 ? 1 - ease((T - (D - 0.4)) / 0.4) : 1;
    const cam = this.camera;
    this.root.position.copy(cam.position);
    this.root.quaternion.copy(cam.quaternion);
    // 화면 크기 (DIST 거리에서 보이는 반폭·반높이)
    const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * DIST;
    const halfW = halfH * cam.aspect;
    // 팔꿈치는 화면 아래 가장자리 밖 오른쪽, 손은 화면 오른쪽 아래 1/3 지점
    //  세로 화면은 폭이 좁아 팔을 더 오른쪽에 세워 시야 가운데를 가리지 않게
    const narrow = cam.aspect < 1;
    const ex = Math.min(halfW * (narrow ? 0.9 : 0.72), 0.46), ey = -halfH * 1.12;
    const lift = (1 - up) * (FORE + 0.14);       // 내려간 상태 = 화면 아래로 숨김
    const tilt = (narrow ? 0.14 : 0.32) + (1 - up) * 0.25;          // 팔뚝이 화면 가운데 쪽으로 기울어짐
    const wag = Math.sin(Math.max(0, T - 0.25) * 10.5) * 0.36 * up;
    this.elbow.position.set(ex, ey - lift, -DIST);
    this.elbow.rotation.set(-0.18, -0.25, tilt + wag);
    // 스쿠버 슈트를 입었으면 소매, 아니면 맨팔
    const suit = this.diver.suitOn;
    this.sleeve.visible = suit; this.skinArm.visible = !suit;
    this.root.visible = true;
  }
}

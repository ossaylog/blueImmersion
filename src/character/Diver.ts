// 캐릭터: 관절 계층 + 절차적 포즈 + 장비 슬롯
//  기본 외형 = 수영복(래시가드 상의 + 무릎길이 수영 반바지). 스노클/스쿠버 장비는 슬롯에 부착·탈착.
//  최종 에셋(GLB 스킨드 메시)으로 교체 시: 같은 Bone 이름(joints)과 슬롯 이름을 유지하면 로직 재사용 가능
import * as THREE from 'three';
import { patchWater } from '../water/WaterShading';
import { damp, clamp } from '../core/math';

export type Motion = 'idle' | 'fwd' | 'back' | 'turnL' | 'turnR';
export type Pose = 'stand' | 'walk' | 'swim' | 'float' | 'hover' | 'stride' | 'duck' | 'gearUp' | 'tread'
  | 'steps'      // 발자국 걷기 (계단 포함, 다리는 IK로 실제 디딤판에)
  | 'sit'        // 의자·계단에 앉음 (다리 IK)
  | 'sitFins'    // 앉아서 몸을 숙여 오리발을 신음
  | 'lie';       // 선베드에 등을 기대고 누움
/** 장비 이름 순서 (멀티유저 동기화 비트마스크) */
export const GEAR_ORDER = ['mask', 'snorkel', 'bcd', 'tank', 'hose', 'regulator', 'weights', 'computer', 'finL', 'finR'];
const IK_POSES = new Set<Pose>(['steps', 'sit', 'sitFins']);
const L1 = 0.43, L2 = 0.42;
const _t = new THREE.Vector3();
export type GearSet = 'none' | 'snorkel' | 'scuba';

const LEG_JOINTS = new Set(['hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR']);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const m = (c: string, r = 0.6, metal = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
  patchWater(new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: metal, ...extra }), { key: 'diver' });

function limb(len: number, r0: number, r1: number, mat: THREE.Material) {
  // 관절에서 -y 방향으로 뻗는 테이퍼 캡슐
  const g = new THREE.CapsuleGeometry((r0 + r1) / 2, len - (r0 + r1) / 2, 4, 12);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp((y + len / 2) / len, 0, 1); // 0 아래 → 1 위
    const k = THREE.MathUtils.lerp(r1, r0, t) / ((r0 + r1) / 2);
    pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  g.translate(0, -len / 2, 0);
  return new THREE.Mesh(g, mat);
}

interface Slot { obj: THREE.Object3D; t: number; from: THREE.Vector3; target: THREE.Vector3; remove: boolean }

export class Diver {
  root = new THREE.Group();   // 월드 위치 + yaw
  body = new THREE.Group();   // 몸 전체 기울기 (서기 ↔ 엎드림)
  j: Record<string, THREE.Group> = {};
  private angles: Record<string, THREE.Euler> = {};
  private targets: Record<string, [number, number, number]> = {};
  pose: Pose = 'stand';
  bodyPitch = 0;               // 0 서기, π/2 엎드림
  speed = 0;                   // 0~1 추진 강도
  /** 이동 방식: 앞으로 / 뒤로(백킥·스컬링) / 제자리 회전(헬리콥터 턴) */
  motion: Motion = 'idle';
  private kickPh = 0;          // 개구리차기·백킥 주기 (0~1)
  private sharpLegs = false;   // 킥의 파워 구간은 빠르게 따라가도록
  phase = 0;
  /** 발자국 걷기·앉기에서 두 발바닥이 놓일 월드 좌표 [hipL 쪽, hipR 쪽] */
  feetW: [THREE.Vector3, THREE.Vector3] | null = null;
  /** 계단 손잡이를 잡고 있음 */
  rail = false;
  /** 상체 앞 숙임 (앉기 동작 중) */
  lean = 0;
  /** 발 내려다보기 (계단) */
  lookDown = 0;
  /** 오리발을 신는 쪽 다리 (sitFins): 0 = hipL, 1 = hipR */
  finLeg = 0;
  gearSet: GearSet = 'none';
  private slots = new Map<string, Slot>();
  private suitParts: { mesh: THREE.Mesh; rank: number }[] = [];
  suitProgress = 0;
  private suitTarget = 0;
  finTips: THREE.Group[] = [];
  bubbleOrigin = new THREE.Object3D();
  mats = {
    skin: m('#d9a888', 0.65), hair: m('#2a1f1a', 0.8), rash: m('#173a5e', 0.7), rashAccent: m('#2bb3b1', 0.6),
    shorts: m('#0f2440', 0.75), suit: m('#15181c', 0.55), suitAccent: m('#1f6fd0', 0.5),
  };

  constructor(scene: THREE.Scene) {
    this.build();
    this.root.add(this.body);
    scene.add(this.root);
  }

  private joint(name: string, parent: THREE.Object3D, pos: THREE.Vector3) {
    const g = new THREE.Group(); g.position.copy(pos); parent.add(g);
    this.j[name] = g; this.angles[name] = new THREE.Euler(); this.targets[name] = [0, 0, 0];
    return g;
  }

  private build() {
    const { skin, hair, rash, rashAccent, shorts, suit, suitAccent } = this.mats;
    const pelvis = this.joint('pelvis', this.body, V3());
    const hipMesh = limb(0.22, 0.17, 0.155, shorts); hipMesh.position.y = 0.1; hipMesh.scale.set(1.12, 1, 0.82); pelvis.add(hipMesh);
    const spine = this.joint('spine', pelvis, V3(0, 0.1, 0));
    const chest = this.joint('chest', spine, V3(0, 0.22, 0));
    const torso = limb(0.42, 0.17, 0.15, rash); torso.position.y = 0.3; torso.scale.set(1.18, 1, 0.78); chest.add(torso);
    const panel = limb(0.36, 0.172, 0.152, rashAccent); panel.position.y = 0.27; panel.scale.set(1.19, 1, 0.5); panel.position.z = -0.005; chest.add(panel);
    const neck = this.joint('neck', chest, V3(0, 0.33, 0.01));
    const neckMesh = limb(0.12, 0.055, 0.06, skin); neckMesh.position.y = 0.1; neck.add(neckMesh);
    const head = this.joint('head', neck, V3(0, 0.1, 0.0));
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 18), skin); skull.scale.set(0.92, 1.12, 1.02); skull.position.set(0, 0.1, 0.01); head.add(skull);
    const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair); hairM.scale.set(0.96, 1.1, 1.06); hairM.position.set(0, 0.115, -0.005); hairM.rotation.x = -0.25; head.add(hairM);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), skin); nose.position.set(0, 0.085, 0.11); head.add(nose);

    for (const s of [-1, 1]) {
      const L = s < 0 ? 'L' : 'R';
      const sh = this.joint('shoulder' + L, chest, V3(s * 0.2, 0.27, 0));
      const sleeve = limb(0.14, 0.058, 0.052, rash); sh.add(sleeve);
      const ua = limb(0.28, 0.048, 0.04, skin); sh.add(ua);
      const el = this.joint('elbow' + L, sh, V3(0, -0.28, 0));
      el.add(limb(0.25, 0.04, 0.032, skin));
      const hand = this.joint('hand' + L, el, V3(0, -0.25, 0));
      const hm = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin); hm.scale.set(0.6, 1.3, 0.9); hm.position.y = -0.05; hand.add(hm);

      const hip = this.joint('hip' + L, pelvis, V3(s * 0.095, -0.02, 0));
      const shortLeg = limb(0.3, 0.082, 0.07, shorts); hip.add(shortLeg);
      hip.add(limb(0.43, 0.075, 0.052, skin));
      const knee = this.joint('knee' + L, hip, V3(0, -0.43, 0));
      knee.add(limb(0.42, 0.05, 0.034, skin));
      const ankle = this.joint('ankle' + L, knee, V3(0, -0.42, 0));
      const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.14, 4, 8), skin); foot.rotation.x = Math.PI / 2; foot.position.set(0, -0.03, 0.06); ankle.add(foot);

      // 다이빙 슈트 오버레이 (스쿠버 선택 시 발끝부터 순서대로 덮임)
      const suitAdd = (rank: number, parent: THREE.Object3D, len: number, r0: number, r1: number, mat: THREE.Material, y = 0) => {
        const mesh = limb(len, r0, r1, mat); mesh.position.y = y; mesh.visible = false; parent.add(mesh); this.suitParts.push({ mesh, rank }); return mesh;
      };
      suitAdd(0, ankle, 0.08, 0.042, 0.04, suit, 0.02);
      suitAdd(1, knee, 0.43, 0.056, 0.04, suit);
      suitAdd(2, hip, 0.44, 0.088, 0.058, suit);
      suitAdd(5, sh, 0.29, 0.062, 0.046, suit);
      suitAdd(6, el, 0.25, 0.046, 0.037, suit);
      void L;
    }
    const st = limb(0.24, 0.182, 0.165, suit); st.position.y = 0.11; st.scale.set(1.12, 1, 0.84); st.visible = false; pelvis.add(st); this.suitParts.push({ mesh: st, rank: 3 });
    const sc = limb(0.44, 0.18, 0.162, suit); sc.position.y = 0.31; sc.scale.set(1.19, 1, 0.82); sc.visible = false; chest.add(sc); this.suitParts.push({ mesh: sc, rank: 4 });
    const sa = limb(0.3, 0.184, 0.164, suitAccent); sa.position.set(0, 0.28, 0); sa.scale.set(1.2, 1, 0.3); sa.visible = false; chest.add(sa); this.suitParts.push({ mesh: sa, rank: 4.3 });
    // 스노클 마스크/레귤레이터 기포 원점
    this.bubbleOrigin.position.set(0, 0.06, 0.16); head.add(this.bubbleOrigin);
  }

  // ───────── 장비 ─────────
  private makeGear(name: string): { obj: THREE.Object3D; parent: THREE.Object3D } {
    const black = m('#16191c', 0.5), frameC = this.gearSet === 'snorkel' ? m('#1fa2c8', 0.4) : m('#1d1f22', 0.45);
    const glass = m('#a9d4e0', 0.05, 0.1, { transparent: true, opacity: 0.35 });
    const g = new THREE.Group();
    switch (name) {
      case 'mask': {
        const frame = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 8, 24), frameC); frame.scale.set(1.25, 0.72, 1); g.add(frame);
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.075, 24), glass); lens.scale.set(1.25, 0.72, 1); lens.position.z = 0.008; g.add(lens);
        const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.09, 0.05, 20, 1, true), m('#5b6b75', 0.4, 0, { transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
        skirt.rotation.x = Math.PI / 2; skirt.scale.set(1.15, 1, 0.72); skirt.position.z = -0.025; g.add(skirt);
        const strap = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 6, 32, Math.PI * 1.25), black); strap.rotation.set(0, Math.PI / 2, Math.PI * 0.625 + Math.PI / 2); strap.rotation.order = 'YXZ';
        strap.rotation.set(Math.PI / 2, 0, -Math.PI * 0.125 - Math.PI / 2); strap.position.set(0, 0, -0.1); g.add(strap);
        g.position.set(0, 0.125, 0.1);
        return { obj: g, parent: this.j.head };
      }
      case 'snorkel': {
        const pts = [V3(0, -0.05, 0.08), V3(0.0, -0.06, 0.02), V3(0, 0.04, -0.01), V3(0, 0.22, -0.03), V3(0, 0.32, -0.06)];
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.012, 8), m('#1fa2c8', 0.4));
        g.add(tube);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.015, 0.06, 10), m('#f07a1a', 0.5)); top.position.set(0, 0.32, -0.06); g.add(top);
        const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.025), black); mouth.position.set(-0.05, -0.05, 0.08); g.add(mouth);
        g.position.set(-0.11, 0.1, 0.03);
        return { obj: g, parent: this.j.head };
      }
      case 'finL': case 'finR': {
        const snork = this.gearSet === 'snorkel';
        const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.2), black); pocket.position.set(0, -0.03, 0.08); g.add(pocket);
        const tipG = new THREE.Group(); tipG.position.set(0, -0.03, 0.18);
        const len = snork ? 0.42 : 0.55;
        const bladeGeo = new THREE.BoxGeometry(1, 0.012, 1, 1, 1, 4);
        const pos = bladeGeo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) { const z = pos.getZ(i) + 0.5; pos.setX(i, pos.getX(i) * (0.11 + z * 0.1)); pos.setZ(i, z * len); }
        bladeGeo.computeVertexNormals();
        const blade = new THREE.Mesh(bladeGeo, snork ? m('#ff8a2a', 0.45) : m('#1f6fd0', 0.4));
        tipG.add(blade);
        const rails = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.025, 0.02), black); rails.position.z = len; tipG.add(rails);
        g.add(tipG);
        this.finTips.push(tipG);
        return { obj: g, parent: name === 'finL' ? this.j.ankleL : this.j.ankleR };
      }
      case 'tank': {
        const cyl = new THREE.Mesh(new THREE.CapsuleGeometry(0.088, 0.48, 6, 18), m('#d8dde0', 0.25, 0.7)); g.add(cyl);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.05, 18), m('#e8c22a', 0.4)); band.position.y = 0.18; g.add(band);
        const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.08, 10), m('#b8bec4', 0.2, 0.9)); valve.position.y = 0.36; g.add(valve);
        const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12), black); knob.rotation.z = Math.PI / 2; knob.position.set(0.05, 0.37, 0); g.add(knob);
        g.position.set(0, 0.24, -0.25);
        return { obj: g, parent: this.j.chest };
      }
      case 'bcd': {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.46, 0.05), black); plate.position.set(0, 0.24, -0.17); g.add(plate);
        for (const s of [-1, 1]) {
          const wing = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.3, 4, 10), m('#202427', 0.6)); wing.position.set(s * 0.17, 0.26, -0.08); wing.scale.set(0.8, 1, 1.3); g.add(wing);
          const strap = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 6, 16, Math.PI), m('#1f6fd0', 0.5)); strap.rotation.set(0, Math.PI / 2, 0); strap.position.set(s * 0.11, 0.42, -0.02); g.add(strap);
          const front = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.03), black); front.position.set(s * 0.11, 0.22, 0.14); g.add(front);
        }
        const cummer = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.03, 6, 24), black); cummer.rotation.x = Math.PI / 2; cummer.scale.set(1.15, 0.8, 1); cummer.position.y = 0.06; g.add(cummer);
        const inflator = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(-0.14, 0.44, -0.08), V3(-0.18, 0.5, 0.06), V3(-0.15, 0.3, 0.16)]), 12, 0.012, 6), black); g.add(inflator);
        return { obj: g, parent: this.j.chest };
      }
      case 'regulator': {
        const second = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.045, 14), black); second.rotation.x = Math.PI / 2; second.position.set(0, 0, 0.03); g.add(second);
        const purge = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.01, 12), m('#1f6fd0', 0.4)); purge.rotation.x = Math.PI / 2; purge.position.set(0, 0, 0.057); g.add(purge);
        const exh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.03), black); exh.position.set(0, -0.035, 0.03); g.add(exh);
        g.position.set(0, 0.05, 0.1);
        return { obj: g, parent: this.j.head };
      }
      case 'hose': {
        // 탱크 밸브 → 오른쪽 어깨 → 입 (가슴 공간 기준)
        const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(0.03, 0.6, -0.25), V3(0.16, 0.66, -0.12), V3(0.16, 0.6, 0.06), V3(0.07, 0.56, 0.15), V3(0.02, 0.5, 0.13)]), 24, 0.011, 6), black);
        g.add(hose);
        const spg = new THREE.Group();
        const sh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(-0.03, 0.6, -0.25), V3(-0.2, 0.45, -0.12), V3(-0.22, 0.05, 0.05)]), 16, 0.011, 6), black);
        spg.add(sh);
        const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16), m('#2a2d30', 0.4)); gauge.rotation.x = Math.PI / 2; gauge.position.set(-0.22, 0.04, 0.06); spg.add(gauge);
        const oct = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.045, 12), m('#f2c81e', 0.4)); oct.position.set(0.12, 0.3, 0.17); spg.add(oct);
        g.add(spg);
        return { obj: g, parent: this.j.chest };
      }
      case 'computer': {
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.02, 0.05), m('#1d1f22', 0.3)); g.add(c);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.035), m('#39d0e0', 0.2, 0, { emissive: '#1a8090', emissiveIntensity: 1.2 })); scr.rotation.x = -Math.PI / 2; scr.position.y = 0.011; g.add(scr);
        g.position.set(0.0, -0.2, 0.04); g.rotation.x = Math.PI / 2;
        return { obj: g, parent: this.j.elbowL };
      }
      case 'weights': {
        const belt = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.012, 4, 28), black); belt.rotation.x = Math.PI / 2; belt.scale.set(1.12, 0.82, 4); g.add(belt);
        for (const a of [-0.9, -0.5, 0.5, 0.9]) {
          const w = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.03), m('#5a5e63', 0.4, 0.6)); w.position.set(Math.sin(a) * 0.2, 0, Math.cos(a) * 0.15); w.rotation.y = a; g.add(w);
        }
        const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.015), m('#c8cdd2', 0.2, 0.9)); buckle.position.set(0, 0, 0.15); g.add(buckle);
        g.position.y = 0.04;
        return { obj: g, parent: this.j.pelvis };
      }
    }
    return { obj: g, parent: this.j.chest };
  }

  /** 장비 하나를 부착 (날아와 붙는 연출) */
  attach(name: string) {
    if (this.slots.has(name)) return;
    const { obj, parent } = this.makeGear(name);
    const target = obj.position.clone();
    const from = target.clone().add(V3(0, 0.25, 0.35));
    obj.position.copy(from); obj.scale.setScalar(0.01);
    parent.add(obj);
    this.slots.set(name, { obj, t: 0, from, target, remove: false });
  }

  setSuit(on: boolean, instant = false) {
    this.suitTarget = on ? 1 : 0;
    if (instant) this.suitProgress = this.suitTarget;
  }

  /** 모든 장비 해제 → 기본 수영복 */
  clearGear() {
    for (const [, s] of this.slots) s.obj.removeFromParent();
    this.slots.clear();
    this.finTips = [];
    this.setSuit(false, true);
    this.gearSet = 'none';
  }

  hasGear(name: string) { return this.slots.has(name); }
  /** 장비 하나만 떼기 */
  detach(name: string) {
    const s = this.slots.get(name);
    if (!s) return;
    s.obj.removeFromParent();
    this.slots.delete(name);
    if (name === 'finL' || name === 'finR') this.finTips = this.finTips.filter((f) => f.parent && f.parent.parent);
  }
  get gearMask() { let m = 0; GEAR_ORDER.forEach((n, i) => { if (this.slots.has(n)) m |= 1 << i; }); return m; }
  get suitOn() { return this.suitTarget > 0.5; }

  private setT(name: string, x: number, y = 0, z = 0) { this.targets[name] = [x, y, z]; }

  update(dt: number, t: number) {
    // 장비 부착 애니메이션
    for (const [, s] of this.slots) {
      if (s.t < 1) {
        s.t = Math.min(1, s.t + dt / 0.75);
        const e = 1 - Math.pow(1 - s.t, 3);
        s.obj.position.lerpVectors(s.from, s.target, e);
        s.obj.scale.setScalar(0.01 + 0.99 * Math.min(1, e * 1.4));
      }
    }
    // 슈트: 발 → 다리 → 몸통 → 팔 순서로 덮임
    this.suitProgress = damp(this.suitProgress, this.suitTarget, 1.4, dt);
    for (const { mesh, rank } of this.suitParts) {
      const a = THREE.MathUtils.clamp(this.suitProgress * 8 - rank, 0, 1);
      mesh.visible = a > 0.01;
      mesh.scale.y = a;
    }

    // ── 포즈 ──
    const sp = this.speed;
    const P = this.pose;
    let pitchT = 0;
    this.phase += dt * (P === 'walk' ? 5.5 : P === 'stride' ? 0 : 2.2 + sp * 3.5);
    const ph = this.phase;
    const breath = Math.sin(t * 1.25);
    for (const k in this.targets) this.targets[k] = [0, 0, 0];

    if (P === 'stand' || P === 'gearUp') {
      this.setT('shoulderL', 0.05, 0, -0.12); this.setT('shoulderR', 0.05, 0, 0.12);
      this.setT('elbowL', -0.2); this.setT('elbowR', -0.2);
      this.setT('spine', breath * 0.01);
      this.setT('neck', -0.05 + Math.sin(t * 0.4) * 0.04, Math.sin(t * 0.23) * 0.15);
      if (P === 'gearUp') { this.setT('elbowL', -0.5); this.setT('shoulderL', -0.3, 0, -0.2); }
    } else if (P === 'walk') {
      const s = Math.sin(ph);
      this.setT('hipL', s * 0.45); this.setT('hipR', -s * 0.45);
      this.setT('kneeL', Math.max(0, -Math.sin(ph - 0.6)) * 0.7 + 0.05); this.setT('kneeR', Math.max(0, Math.sin(ph - 0.6)) * 0.7 + 0.05);
      this.setT('shoulderL', -s * 0.3, 0, -0.1); this.setT('shoulderR', s * 0.3, 0, 0.1);
      this.setT('elbowL', -0.3); this.setT('elbowR', -0.3);
      this.setT('ankleL', 0.1); this.setT('ankleR', 0.1);
      this.setT('spine', 0.03);
    } else if (P === 'stride') {
      // 자이언트 스트라이드: 한 손은 마스크·레귤레이터, 한 다리는 크게 앞으로
      this.setT('hipR', -1.0); this.setT('kneeR', 0.15); this.setT('ankleR', 0.4);
      this.setT('hipL', 0.15); this.setT('kneeL', 0.1);
      this.setT('shoulderR', -2.5, 0, 0.25); this.setT('elbowR', -2.0);
      this.setT('shoulderL', -1.1, 0, -0.2); this.setT('elbowL', -1.3);
      this.setT('neck', 0.1);
    } else if (P === 'steps') {
      // 다리는 아래 IK에서 디딤판에 맞춤. 팔: 계단에선 손잡이, 평지에선 반대쪽 다리와 엇갈려 흔듦
      if (this.rail) {
        this.setT('shoulderL', -0.32, 0, -0.42); this.setT('shoulderR', -0.32, 0, 0.42);
        this.setT('elbowL', -0.55); this.setT('elbowR', -0.55);
      } else if (this.feetW) {
        const zl = this.root.worldToLocal(_t.copy(this.feetW[0])).z, zr = this.root.worldToLocal(_t.copy(this.feetW[1])).z;
        const sw = clamp((zl - zr) * 0.9, -0.45, 0.45);
        this.setT('shoulderL', sw, 0, -0.1); this.setT('shoulderR', -sw, 0, 0.1);
        this.setT('elbowL', -0.3); this.setT('elbowR', -0.3);
      }
      this.setT('neck', 0.05 + this.lookDown * 0.35); this.setT('head', this.lookDown * 0.15);
      this.setT('spine', 0.03 + this.lookDown * 0.06);
      pitchT = this.lean;
    } else if (P === 'sit' || P === 'sitFins') {
      pitchT = this.lean;
      if (P === 'sit') {
        // 테이블에 손을 올리고 쉬는 자세 · 고개는 천천히 주변을 둘러봄
        this.setT('shoulderL', -0.55, 0, -0.12); this.setT('shoulderR', -0.55, 0, 0.12);
        this.setT('elbowL', -0.95); this.setT('elbowR', -0.95);
        this.setT('spine', -0.04 + breath * 0.01);
        this.setT('neck', Math.sin(t * 0.21) * 0.06, Math.sin(t * 0.17) * 0.45);
      } else {
        // 몸을 숙여 두 손으로 오리발 뒤꿈치 끈을 당김
        this.setT('spine', 0.5); this.setT('chest', 0.15);
        const sideZ = this.finLeg === 0 ? -0.15 : 0.15;
        this.setT('shoulderL', -1.25, 0, -0.05 + sideZ); this.setT('shoulderR', -1.25, 0, 0.05 + sideZ);
        this.setT('elbowL', -0.25 - Math.max(0, Math.sin(t * 3)) * 0.2); this.setT('elbowR', -0.25 - Math.max(0, Math.sin(t * 3 + 1)) * 0.2);
        this.setT('neck', 0.25); this.setT('head', 0.15);
      }
    } else if (P === 'lie') {
      // 선베드: 등받이에 상체를 기대고(약 35°) 다리는 쿠션 위로 곧게, 한 손은 머리 뒤 · 한 손은 배 위
      pitchT = -(Math.PI / 2 - 0.62);
      this.setT('hipL', -0.6, 0, -0.03); this.setT('hipR', -0.56, 0, 0.05);
      this.setT('kneeL', 0.08); this.setT('kneeR', 0.22);
      this.setT('ankleL', 0.55); this.setT('ankleR', 0.5);
      this.setT('shoulderL', -2.65, 0, -0.55); this.setT('elbowL', -2.25);
      this.setT('shoulderR', -0.45, 0, 0.32); this.setT('elbowR', -1.3);
      this.setT('spine', -0.06 + breath * 0.012); this.setT('chest', -0.04);
      this.setT('neck', 0.28 + Math.sin(t * 0.13) * 0.05, Math.sin(t * 0.09) * 0.35); this.setT('head', 0.08);
    } else if (P === 'tread') {
      // 수면에서 머리를 내놓고 선헤엄: 다리는 천천히 에그비터 킥, 팔은 옆으로 물을 저음
      pitchT = 0.22 + sp * 0.35;
      const k = Math.sin(ph * 1.3), k2 = Math.cos(ph * 1.3);
      this.setT('hipL', -0.55 + k * 0.25, 0, -0.18); this.setT('hipR', -0.55 - k * 0.25, 0, 0.18);
      this.setT('kneeL', 0.95 + k2 * 0.3); this.setT('kneeR', 0.95 - k2 * 0.3);
      this.setT('ankleL', 0.9); this.setT('ankleR', 0.9);
      const scull = Math.sin(t * 2.4);
      this.setT('shoulderL', -0.35, scull * 0.35, -1.05); this.setT('shoulderR', -0.35, -scull * 0.35, 1.05);
      this.setT('elbowL', -0.45); this.setT('elbowR', -0.45);
      this.setT('spine', breath * 0.02);
      this.setT('neck', -0.12 - pitchT * 0.6, Math.sin(t * 0.3) * 0.12); this.setT('head', -0.05);
    } else {
      // 수중 유영 (엎드린 자세)
      pitchT = Math.PI / 2;
      const scuba = this.gearSet === 'scuba';
      const mo = this.motion;
      this.sharpLegs = false;
      if (scuba && P !== 'duck') this.scubaKick(dt, t, P, mo, sp);
      else if (!scuba && mo === 'back') {
        // 스노클: 오리발로는 뒤로 갈 수 없어 손으로 물을 앞으로 밀어내며(스컬링) 천천히 후진, 다리는 가볍게 떠 있음
        const k = Math.sin(ph * 1.2);
        this.setT('hipL', k * 0.05, 0, -0.05); this.setT('hipR', -k * 0.05, 0, 0.05);
        this.setT('kneeL', 0.2); this.setT('kneeR', 0.2);
        this.setT('ankleL', 1.2); this.setT('ankleR', 1.2);
      } else {
        // 스노클 플러터 킥: 엉덩이에서 시작하는 길고 곧은 다리 차기, 무릎은 살짝만 · 발목은 펴서 오리발이 다리 연장선
        //  수면에서는 오리발이 물 밖으로 튀지 않도록 진폭을 작게, 잠수 중엔 크게
        const amp = P === 'float' ? 0.1 + sp * 0.22 : 0.14 + sp * 0.3;
        const k = Math.sin(ph * 1.6);
        this.setT('hipL', k * amp, 0, -0.04); this.setT('hipR', -k * amp, 0, 0.04);
        this.setT('kneeL', 0.12 + Math.max(0, Math.sin(ph * 1.6 + 0.9)) * amp * 1.2); this.setT('kneeR', 0.12 + Math.max(0, -Math.sin(ph * 1.6 + 0.9)) * amp * 1.2);
        this.setT('ankleL', 1.3 + k * 0.12); this.setT('ankleR', 1.3 - k * 0.12);
      }
      if (this.gearSet === 'scuba') {
        // 팔은 가슴 앞에 모으고 (실제 다이버처럼 팔로 젓지 않음)
        this.setT('shoulderL', -0.9, 0, -0.35); this.setT('shoulderR', -0.9, 0, 0.35);
        this.setT('elbowL', -1.7); this.setT('elbowR', -1.7);
        this.setT('neck', -0.55); this.setT('head', -0.25);
      } else {
        if (this.motion === 'back' && P !== 'duck') {
          // 스컬링: 팔을 앞으로 뻗어 손바닥으로 물을 앞쪽으로 8자로 밀어냄
          const sc = Math.sin(t * 3.2);
          this.setT('shoulderL', -1.25 + sc * 0.15, sc * 0.4, -0.35); this.setT('shoulderR', -1.25 - sc * 0.15, -sc * 0.4, 0.35);
          this.setT('elbowL', -0.5); this.setT('elbowR', -0.5);
        } else {
          // 스노클: 팔은 몸 옆에 편하게
          this.setT('shoulderL', 0.15 + Math.sin(t * 0.5) * 0.05, 0, -0.18); this.setT('shoulderR', 0.15 + Math.sin(t * 0.5 + 1) * 0.05, 0, 0.18);
          this.setT('elbowL', -0.35); this.setT('elbowR', -0.35);
        }
        this.setT('neck', P === 'duck' ? -0.1 : -0.35); this.setT('head', -0.1);
      }
      this.setT('spine', breath * 0.015 + (P === 'duck' ? 0.4 : 0));
      if (P === 'duck') pitchT = Math.PI / 2 + 0.75;
    }
    this.bodyPitch = damp(this.bodyPitch, pitchT, P === 'stride' ? 1.5 : IK_POSES.has(P) ? 6 : P === 'lie' ? 2.2 : 3, dt);
    this.body.rotation.set(this.bodyPitch, 0, 0);
    for (const k in this.targets) {
      const e = this.angles[k], tg = this.targets[k];
      const rate = this.sharpLegs && LEG_JOINTS.has(k) ? 16 : P === 'lie' ? 3.5 : 8;
      e.x = damp(e.x, tg[0], rate, dt);
      e.y = damp(e.y, tg[1], rate, dt); e.z = damp(e.z, tg[2], rate, dt);
      this.j[k].rotation.copy(e);
    }
    if (IK_POSES.has(P) && this.feetW) this.solveLegs();
    // 오리발 끝의 탄성 (발목 움직임보다 늦게 따라옴)
    // 개구리차기·백킥 중에는 킥 주기에 맞춰 오리발 끝이 휨 (파워 구간에 크게)
    const frogFlex = this.gearSet === 'scuba' && P !== 'tread' && P !== 'duck' && this.bodyPitch > 1;
    const flex = frogFlex ? Math.sin(this.kickPh * Math.PI * 2 - 1.2) * (0.1 + sp * 0.3) : Math.sin(ph * 1.6 - 1.1) * (0.12 + sp * 0.35) * (P === 'hover' ? 0.3 : 1);
    this.finTips.forEach((f, i) => { f.rotation.x = (i === 0 ? 1 : -1) * flex * (this.gearSet === 'none' ? 0 : 1); });
  }

  /** 두 발바닥을 feetW에 정확히 딛도록 다리 관절을 계산 (2관절 IK, 발은 바닥과 평행) */
  private solveLegs() {
    this.root.updateMatrixWorld(true);
    const pelvis = this.j.pelvis;
    (['L', 'R'] as const).forEach((side, i) => {
      const hip = this.j['hip' + side];
      const d = pelvis.worldToLocal(_t.copy(this.feetW![i]));
      // 발바닥 → 발목 (발목은 발바닥보다 6.5cm 위, 발 중심보다 6cm 뒤)
      d.y += 0.065; d.z -= 0.06;
      d.sub(hip.position);
      const D = clamp(Math.hypot(d.y, d.z), 0.25, L1 + L2 - 0.003);
      const aLine = Math.atan2(-d.z, -d.y);
      const alpha = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
      const hx = aLine - alpha;
      const kn = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1));
      const hz = Math.asin(clamp(d.x / Math.max(0.05, d.length()), -0.45, 0.45));
      const an = -(this.bodyPitch + hx + kn);
      this.j['hip' + side].rotation.set(hx, 0, hz); this.angles['hip' + side].set(hx, 0, hz);
      this.j['knee' + side].rotation.set(kn, 0, 0); this.angles['knee' + side].set(kn, 0, 0);
      this.j['ankle' + side].rotation.set(an, 0, 0); this.angles['ankle' + side].set(an, 0, 0);
    });
  }

  /**
   * 스쿠버 킥 (실제 다이빙 기술 기반)
   *  - 개구리차기(frog kick): 무릎을 굽혀 오리발을 위·바깥으로 모았다가 → 발바닥 면으로 뒤로 밀며 다리를 모으고 → 미끄러지듯 활주
   *    바닥 모래를 차지 않아 산호초 다이빙의 기본
   *  - 백킥(back kick): 오리발을 직각으로 세운 채 다리를 뻗었다가 무릎을 당기며 물을 앞으로 밀어 뒤로 이동
   *  - 헬리콥터 턴: 한쪽 오리발만 옆으로 쓸어 제자리에서 회전
   *  - 호버링: 프로그 포지션(무릎 90°, 오리발 위)에서 아주 작은 스컬링
   */
  private scubaKick(dt: number, t: number, P: Pose, mo: Motion, sp: number) {
    type Leg = [number, number, number, number, number]; // hipX, hipY(바깥 회전), hipZ(벌림), knee, ankle
    const lerpLeg = (a: Leg, b: Leg, u: number): Leg => a.map((v, i) => v + (b[i] - v) * u) as Leg;
    const ease = (u: number) => u * u * (3 - 2 * u);
    const apply = (L: Leg, R: Leg) => {
      this.setT('hipL', L[0], -L[1], -L[2]); this.setT('hipR', R[0], R[1], R[2]);
      this.setT('kneeL', L[3]); this.setT('kneeR', R[3]);
      this.setT('ankleL', L[4]); this.setT('ankleR', R[4]);
    };
    const FROG: Leg = [-0.2, 0.55, 0.32, 1.45, 0.75];    // 프로그 포지션: 무릎 굽혀 오리발을 위로, 발끝은 바깥
    const SPREAD: Leg = [0.05, 0.15, 0.2, 0.2, 1.2];      // 파워 끝: 다리를 뻗으며 벌어진 상태
    const GLIDE: Leg = [0.0, 0.0, 0.04, 0.12, 1.3];       // 활주: 곧게 모은 다리
    if (mo === 'back') {
      // 백킥: 1) 무릎을 당기며 오리발 면으로 물을 앞쪽으로 끌어옴(추진) 2) 오리발을 세운 채 천천히 다리를 뻗음 3) 잠깐 멈춤
      this.kickPh = (this.kickPh + dt * (0.42 + sp * 0.2)) % 1;
      const u = this.kickPh;
      const OUT: Leg = [0.0, 0.7, 0.32, 0.25, 0.15];      // 다리 뻗고 오리발 직각·바깥
      const IN: Leg = [-0.45, 0.35, 0.16, 1.6, 0.35];     // 무릎을 가슴 쪽으로 당김
      const L = u < 0.35 ? lerpLeg(OUT, IN, ease(u / 0.35)) : u < 0.85 ? lerpLeg(IN, OUT, ease((u - 0.35) / 0.5)) : OUT;
      this.sharpLegs = u < 0.35;
      apply(L, L);
      return;
    }
    if (mo === 'turnL' || mo === 'turnR') {
      // 헬리콥터 턴: 회전 방향 반대쪽 다리 하나만 무릎 90°로 옆을 쓸고, 다른 다리는 프로그 포지션 유지
      this.kickPh = (this.kickPh + dt * 0.7) % 1;
      const u = this.kickPh;
      const sweep = u < 0.4 ? ease(u / 0.4) : 1 - ease((u - 0.4) / 0.6);
      const active: Leg = [-0.25, 0.3 + sweep * 0.5, 0.15 + sweep * 0.55, 1.4, 0.4 + sweep * 0.3];
      this.sharpLegs = u < 0.4;
      if (mo === 'turnL') apply(FROG, active); else apply(active, FROG);
      return;
    }
    if (P === 'hover' || mo === 'idle') {
      // 호버링: 프로그 포지션에서 오리발 끝만 아주 작게 스컬링
      const s = Math.sin(t * 1.4) * 0.06;
      apply([FROG[0], FROG[1] + s, FROG[2], FROG[3] - 0.1, FROG[4] + s], [FROG[0], FROG[1] - s, FROG[2], FROG[3] - 0.1, FROG[4] - s]);
      this.kickPh = 0;
      return;
    }
    // 개구리차기: 리커버리(천천히 접기) → 파워(빠르게 뒤로 밀며 뻗기) → 모으기 → 활주
    this.kickPh = (this.kickPh + dt * (0.38 + sp * 0.32)) % 1;
    const u = this.kickPh;
    let L: Leg;
    if (u < 0.3) L = lerpLeg(GLIDE, FROG, ease(u / 0.3));
    else if (u < 0.38) L = FROG;
    else if (u < 0.52) L = lerpLeg(FROG, SPREAD, ease((u - 0.38) / 0.14));
    else if (u < 0.64) L = lerpLeg(SPREAD, GLIDE, ease((u - 0.52) / 0.12));
    else L = GLIDE;
    this.sharpLegs = u >= 0.38 && u < 0.64;
    apply(L, L);
  }

  /** 엎드렸을 때 몸 중심 (카메라 타깃) */
  chestWorld(out = new THREE.Vector3()) { return this.j.chest.getWorldPosition(out); }
  headWorld(out = new THREE.Vector3()) { return this.j.head.getWorldPosition(out); }
}

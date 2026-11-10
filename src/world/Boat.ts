// 리프 셔틀 보트 (약 15m) — 항구에서 리프 판툰까지 손님을 실어 나르는 배
//  - 우현(+x) 승하선 게이트: 판툰에 계류하면 판툰의 현문 사다리가 이 게이트 위에 걸쳐짐
//  - 선미(-z): 수영 플랫폼 + 사다리 (실제 다이빙 보트처럼 계단 2단 + 물속까지 이어지는 사다리)
//  - 입수는 배가 아니라 판툰에서 함 (판툰 → src/world/Pontoon.ts)
import * as THREE from 'three';
import { patchWater } from '../water/WaterShading';
import { waveHeight, waveSlope } from '../water/OceanSurface';
import { damp } from '../core/math';

export const DECK_Y = 1.3;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export interface BoatConfig { id: string; capacity: number; region: string }

function halfWidth(z: number) {
  if (z > 1.5) return 2.35 * Math.sqrt(Math.max(0, 1 - ((z - 1.5) / 6.2) ** 2));
  if (z < -6.6) return 2.25;
  return 2.35 - Math.max(0, -z - 3) * 0.03;
}
function keelDepth(z: number) {
  if (z > 3) return -0.9 + ((z - 3) / 4.7) ** 1.6 * 1.6;
  return -0.9 + Math.max(0, -z - 5) * 0.12;
}

export class Boat {
  root = new THREE.Group();     // 위치·흔들림
  model = new THREE.Group();
  config: BoatConfig = { id: 'reef-explorer-1', capacity: 12, region: 'world' };
  heading = 0;
  speed = 0;
  drive = false; // true: speed로 직접 이동, false: 외부에서 위치 지정 (연출)
  private pitch = 0; private roll = 0; private heave = 0;
  wake: Wake;
  /** 항해 중 서 있는 자리 (선체 로컬) */
  deckSpot = V3(0.0, DECK_Y, -2.2);
  /** 우현 승하선 게이트 (현문 사다리가 걸리는 점) */
  gate = V3(2.1, DECK_Y, 3.6);
  /** 갑판 자리 → 게이트까지 선실 옆 좁은 통로 */
  disembarkPath = [V3(0.0, DECK_Y, -2.2), V3(0.9, DECK_Y, -1.0), V3(1.92, DECK_Y, -0.3), V3(1.92, DECK_Y, 3.6), V3(2.1, DECK_Y, 3.6)];

  constructor(scene: THREE.Scene) {
    this.build();
    this.root.add(this.model);
    scene.add(this.root);
    this.wake = new Wake(scene);
  }

  private mat(color: string, rough = 0.6, metal = 0, opts: THREE.MeshStandardMaterialParameters = {}) {
    return patchWater(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...opts }), { key: 'boat', caustics: true });
  }

  private build() {
    const white = this.mat('#f4f5f2', 0.45), navy = this.mat('#14325a', 0.5), stripe = this.mat('#1d7fb0', 0.4);
    const teak = this.mat('#a77b4f', 0.8), steel = this.mat('#c8cdd2', 0.25, 0.85), glass = this.mat('#1d2b38', 0.1, 0.3);
    const rubber = this.mat('#2a2d30', 0.9), cushion = this.mat('#2a6f8f', 0.8);

    // ── 선체 로프트 ──
    const ZN = 40, SN = 9;
    const verts: number[] = [], idx: number[] = [], cols: number[] = [];
    const cWhite = new THREE.Color('#f4f5f2'), cNavy = new THREE.Color('#13304f'), cStripe = new THREE.Color('#1d7fb0'), cBoot = new THREE.Color('#c23a2a');
    for (let i = 0; i <= ZN; i++) {
      const z = -7 + (14.7 * i) / ZN;
      const w = halfWidth(z), k = keelDepth(z);
      for (let s = -SN; s <= SN; s++) {
        const u = Math.abs(s) / SN; // 0 용골 → 1 현측 상단
        const side = Math.sign(s) || 1;
        const chineU = 0.55;
        let x: number, y: number;
        if (u < chineU) { const t = u / chineU; x = w * 0.82 * t; y = k + (-0.25 - k) * t * t * 0.9 + (k * 0.1) * t; }
        else { const t = (u - chineU) / (1 - chineU); x = w * (0.82 + 0.18 * Math.sin(t * Math.PI / 2)); y = -0.25 + (DECK_Y + 0.15) * t; }
        verts.push(x * side, y, z);
        const c = y < -0.05 ? cNavy : y < 0.12 ? cBoot : y > 0.85 && y < 1.02 ? cStripe : cWhite;
        cols.push(c.r, c.g, c.b);
      }
    }
    const W = SN * 2 + 1;
    for (let i = 0; i < ZN; i++) for (let j = 0; j < W - 1; j++) {
      const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const hull = new THREE.BufferGeometry();
    hull.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    hull.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    hull.setIndex(idx); hull.computeVertexNormals();
    const hullMat = patchWater(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, side: THREE.DoubleSide }), { key: 'hull' });
    this.model.add(new THREE.Mesh(hull, hullMat));
    // 트랜섬
    const tr = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 2.1), white);
    tr.position.set(0, 0.35, -7); tr.rotation.y = Math.PI;
    this.model.add(tr);

    // ── 갑판 ──
    const deckShape = new THREE.Shape();
    deckShape.moveTo(-halfWidth(-7) + 0.08, 7);
    for (let z = -7; z <= 7.7; z += 0.35) deckShape.lineTo(-halfWidth(z) + 0.08, -z);
    for (let z = 7.7; z >= -7; z -= 0.35) deckShape.lineTo(halfWidth(z) - 0.08, -z);
    const deck = new THREE.Mesh(new THREE.ShapeGeometry(deckShape, 4), teak);
    deck.rotation.x = -Math.PI / 2; deck.position.y = DECK_Y;
    this.model.add(deck);

    // 난간 (우현 계단 입구와 선미 게이트는 비워둠)
    const rail = (pts: THREE.Vector3[], r = 0.025) => {
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 6, r, 6);
      this.model.add(new THREE.Mesh(g, steel));
    };
    const railH = DECK_Y + 0.75;
    const sideRail = (side: number, z0: number, z1: number) => {
      const pts: THREE.Vector3[] = [];
      for (let z = z0; z <= z1 + 1e-3; z += 0.5) pts.push(V3(side * (halfWidth(z) - 0.06), railH, z));
      rail(pts);
      for (let z = z0; z <= z1 + 1e-3; z += 1.5) rail([V3(side * (halfWidth(z) - 0.06), DECK_Y, z), V3(side * (halfWidth(z) - 0.06), railH, z)], 0.02);
    };
    sideRail(-1, -6.8, 6.5);
    sideRail(1, -6.8, 3.0);
    sideRail(1, 4.2, 6.5);
    // 승하선 게이트: 노란 안전 기둥 + 발판
    for (const z of [3.0, 4.2]) rail([V3(halfWidth(z) - 0.06, DECK_Y, z), V3(halfWidth(z) - 0.06, railH + 0.08, z)], 0.04);
    const gateStep = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 1.2), teak);
    gateStep.position.set(halfWidth(3.6) - 0.15, DECK_Y + 0.02, 3.6); this.model.add(gateStep);

    // ── 선실 ──
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.3, 1.9, 4.6), white);
    cabin.position.set(0, DECK_Y + 0.95, 2.6);
    this.model.add(cabin);
    const win = new THREE.Mesh(new THREE.BoxGeometry(3.32, 0.55, 3.8), glass);
    win.position.set(0, DECK_Y + 1.3, 2.7); this.model.add(win);
    const wf = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.6, 0.05), glass);
    wf.position.set(0, DECK_Y + 1.35, 4.92); wf.rotation.x = -0.35; this.model.add(wf);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.12, 6.4), white);
    roof.position.set(0, DECK_Y + 1.95, 1.6); this.model.add(roof);
    for (const [x, z] of [[-1.8, -1.4], [1.8, -1.4]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 8), steel);
      post.position.set(x, DECK_Y + 0.95, z); this.model.add(post);
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.2, 8), steel);
    mast.position.set(0, DECK_Y + 3.0, 3.2); this.model.add(mast);
    // 다이빙 중 깃발 (국제 신호기 A: 흰색/파란색 제비꼬리)
    const flagShape = new THREE.Shape();
    flagShape.moveTo(0, 0); flagShape.lineTo(0.9, 0); flagShape.lineTo(0.65, 0.3); flagShape.lineTo(0.9, 0.6); flagShape.lineTo(0, 0.6);
    const flagB = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), this.mat('#1a4fb0', 0.8, 0, { side: THREE.DoubleSide }));
    const flagW = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.6), this.mat('#f5f5f5', 0.8, 0, { side: THREE.DoubleSide }));
    flagW.position.set(0.2, 0.3, 0.002);
    const flag = new THREE.Group(); flag.add(flagB, flagW);
    flag.position.set(0.04, DECK_Y + 3.4, 3.2); flag.rotation.y = -Math.PI / 2;
    this.model.add(flag);

    // ── 장비 점검 구역: 벤치 + 탱크 랙 ──
    for (const side of [-1, 1]) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 4.4), cushion);
      bench.position.set(side * 1.7, DECK_Y + 0.22, -3.6); this.model.add(bench);
      for (let k = 0; k < 5; k++) {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.68, 14), this.mat(k % 2 ? '#d8dcdf' : '#e8c22a', 0.3, 0.6));
        tank.position.set(side * 2.02, DECK_Y + 0.62, -5.3 + k * 0.8); this.model.add(tank);
      }
    }

    // ── 선미 다이빙 플랫폼 ──
    const plat = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 1.25), teak);
    plat.position.set(0, 0.36, -7.6); this.model.add(plat);
    // 갑판 → 플랫폼 계단 2단 (양옆 옆판으로 받침)
    for (let k = 0; k < 2; k++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.35), teak);
      st.position.set(0.3, 1.0 - k * 0.32, -7.1 - k * 0.1); this.model.add(st);
    }
    for (const x of [-0.32, 0.92]) {
      const sg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.5), white);
      sg.position.set(x, 0.83, -7.18); sg.rotation.x = -0.25; this.model.add(sg);
    }
    // 안전 손잡이 (플랫폼 양 끝)
    for (const x of [-1.9, 1.9]) rail([V3(x, 0.42, -7.05), V3(x, 1.4, -7.1), V3(x, 1.4, -7.9), V3(x, 0.42, -8.05)], 0.028);
    // 수중 사다리 (수영장 깊은 곳 사다리처럼)
    for (const x of [-1.2, -0.6]) rail([V3(x, 1.25, -8.0), V3(x, 0.42, -8.15), V3(x, -1.5, -8.2)], 0.025);
    for (let k = 0; k < 4; k++) rail([V3(-1.2, 0.0 - k * 0.38, -8.18), V3(-0.6, 0.0 - k * 0.38, -8.18)], 0.02);

    // 펜더(부이)
    for (const z of [-4, 0.5, 5]) {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.45, 4, 10), rubber);
      f.position.set(-halfWidth(z) - 0.1, 0.55, z); this.model.add(f);
    }
    void navy; void stripe;
  }

  /** 파도에 따른 자연스러운 흔들림 + 항해 */
  update(dt: number, t: number) {
    const p = this.root.position;
    const f = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    if (this.drive) p.addScaledVector(f, this.speed * dt);
    const r = new THREE.Vector3(f.z, 0, -f.x);
    const samples = [[0, 0], [5, 0], [-5, 0], [0, 1.8], [0, -1.8]];
    let h = 0, hb = 0, hs = 0, hp = 0, hsb = 0;
    for (const [a, b] of samples) {
      const x = p.x + f.x * a + r.x * b, z = p.z + f.z * a + r.z * b;
      const w = waveHeight(x, z, t);
      h += w;
      if (a > 0) hb = w; if (a < 0) hs = w; if (b > 0) hsb = w; if (b < 0) hp = w;
    }
    h /= samples.length;
    const tp = Math.atan2(hb - hs, 10) * 0.8 - Math.min(this.speed, 8) * 0.008;
    const trl = Math.atan2(hsb - hp, 3.6) * 0.8;
    this.heave = damp(this.heave, h * 0.75, 2.2, dt);
    this.pitch = damp(this.pitch, tp, 1.8, dt);
    this.roll = damp(this.roll, trl, 1.6, dt);
    p.y = this.heave;
    this.root.rotation.set(-this.pitch, this.heading, this.roll, 'YXZ');
    this.root.updateMatrixWorld(true);
    // 항적과 물보라
    if (this.speed > 0.5) {
      const stern = this.toWorld(V3(0, 0, -7.2));
      this.wake.emit(stern, f, this.speed, dt, 1);
      const bow = this.toWorld(V3(0, 0, 6.5));
      this.wake.emit(bow, f, this.speed, dt, 0.35);
    }
    this.wake.update(dt);
    void waveSlope;
  }

  toWorld(v: THREE.Vector3) { return v.clone().applyMatrix4(this.root.matrixWorld); }

  /** 수영하는 사람이 선체를 뚫지 않도록 밀어냄 (계류 중일 때만 의미 있음) */
  collide(p: THREE.Vector3, r: number) {
    const l = this.root.worldToLocal(p.clone());
    const x0 = -2.45 - r, x1 = 2.45 + r, z0 = -8.3 - r, z1 = 7.8 + r, y0 = -1.0 - r;
    if (l.x < x0 || l.x > x1 || l.z < z0 || l.z > z1 || l.y < y0 || l.y > 3) return false;
    const pen = [l.x - x0, x1 - l.x, l.z - z0, z1 - l.z, l.y - y0];
    let k = 0;
    for (let i = 1; i < 5; i++) if (pen[i] < pen[k]) k = i;
    if (k === 0) l.x = x0; else if (k === 1) l.x = x1; else if (k === 2) l.z = z0; else if (k === 3) l.z = z1; else l.y = y0;
    p.copy(l.applyMatrix4(this.root.matrixWorld));
    return true;
  }
}

/** 항적·물보라 (수면 위 거품 입자) */
class Wake {
  points: THREE.Points;
  private n = 500;
  private pos: Float32Array; private age: Float32Array; private vel: Float32Array; private life: Float32Array;
  private head = 0;
  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(this.n * 3); this.age = new Float32Array(this.n).fill(99);
    this.vel = new Float32Array(this.n * 3); this.life = new Float32Array(this.n).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `attribute float aAge; attribute float aLife; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); float k = aAge / aLife;
          vA = (1.0 - k) * step(k, 1.0); gl_PointSize = (40.0 + k * 220.0) / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ vec2 q = gl_PointCoord - 0.5; float d = length(q);
        float a = smoothstep(0.5, 0.15, d) * vA * 0.55; if (a < 0.01) discard; gl_FragColor = vec4(vec3(0.95,0.98,1.0), a); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }
  emit(at: THREE.Vector3, f: THREE.Vector3, speed: number, dt: number, rate: number) {
    const count = Math.ceil(speed * dt * 14 * rate);
    for (let k = 0; k < count; k++) {
      const i = this.head; this.head = (this.head + 1) % this.n;
      const side = (Math.random() - 0.5) * 2;
      this.pos[i * 3] = at.x + f.z * side * 1.6; this.pos[i * 3 + 1] = 0.08; this.pos[i * 3 + 2] = at.z - f.x * side * 1.6;
      this.vel[i * 3] = -f.x * speed * 0.15 + f.z * side * 1.2; this.vel[i * 3 + 1] = rate < 1 ? 1.5 * Math.random() : 0;
      this.vel[i * 3 + 2] = -f.z * speed * 0.15 - f.x * side * 1.2;
      this.age[i] = 0; this.life[i] = rate < 1 ? 0.9 : 4 + Math.random() * 3;
    }
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] > this.life[i]) continue;
      this.age[i] += dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] -= 4 * dt;
      if (this.pos[i * 3 + 1] < 0.06) { this.pos[i * 3 + 1] = 0.06; this.vel[i * 3 + 1] = 0; }
      this.vel[i * 3] *= 0.98; this.vel[i * 3 + 2] *= 0.98;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.aAge as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
  }
}

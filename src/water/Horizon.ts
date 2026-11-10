// 수면 위 풍경: 수평선의 먼 열대 섬들 + 배 위를 맴도는 바닷새
//  - 섬은 대기 원근(멀수록 수평선 색으로 흐려짐)으로 수백 m 밖에 있는 느낌
//  - 물속에서는 수면에 가려 보이지 않으므로 그리지 않음
import * as THREE from 'three';
import { waterUniforms, WATER_GLSL_COMMON } from './WaterShading';
import { SKY_GLSL } from './Sky';
import { mulberry32, vnoise3 } from '../core/math';

const n01 = (x: number, y: number, z: number) => vnoise3(x, y, z) * 0.5 + 0.5;

interface IslandDef { x: number; z: number; r: number; h: number; seed: number; stretch: number; rot: number }
const ISLANDS: IslandDef[] = [
  { x: -720, z: 360, r: 210, h: 58, seed: 3, stretch: 1.9, rot: 0.4 },
  { x: -470, z: -640, r: 110, h: 30, seed: 7, stretch: 1.4, rot: -0.7 },
  { x: 860, z: -280, r: 160, h: 44, seed: 11, stretch: 2.3, rot: 1.2 },
  { x: 610, z: 690, r: 70, h: 18, seed: 19, stretch: 1.3, rot: 0.1 },
];

function islandGeo(def: IslandDef) {
  const rings = 22, segs = 72;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const sand = new THREE.Color('#e3d6ae'), rock = new THREE.Color('#6d6656'), jungle = new THREE.Color('#2c5a2a'), jungleHi = new THREE.Color('#4f7d34');
  const c = new THREE.Color();
  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      // 가장자리를 불규칙하게 (만·곶)
      const edge = 1 + (n01(Math.cos(a) * 2 + def.seed, Math.sin(a) * 2, def.seed) - 0.5) * 0.5;
      const rr = u * def.r * edge;
      const x = Math.cos(a) * rr * def.stretch, z = Math.sin(a) * rr;
      // 봉우리 여러 개 + 해안의 완만한 모래사장
      const ridge = n01(x * 0.012 + def.seed, z * 0.02, def.seed * 0.7);
      let y = def.h * Math.pow(Math.max(0, 1 - u), 1.5) * (0.65 + ridge * 0.7);
      y += (n01(x * 0.05, z * 0.05, def.seed) - 0.5) * def.h * 0.08 * (1 - u);
      if (u > 0.9) y = THREE.MathUtils.lerp(y, -3, (u - 0.9) / 0.1);
      pos.push(x, y, z);
      const beach = 1 - THREE.MathUtils.smoothstep(y, 0.4, 2.5);
      const steep = THREE.MathUtils.smoothstep(ridge, 0.75, 0.95) * (1 - u);
      c.copy(jungle).lerp(jungleHi, n01(x * 0.04, y * 0.1, z * 0.04));
      c.lerp(rock, steep * 0.7).lerp(sand, beach);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * segs + j, b = i * segs + (j + 1) % segs, cc = (i + 1) * segs + j, d = (i + 1) * segs + (j + 1) % segs;
    if (i === 0) { idx.push(a, cc, d); continue; }
    idx.push(a, cc, b, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class Horizon {
  private islands = new THREE.Group();
  private birds: { g: THREE.Group; wl: THREE.Object3D; wr: THREE.Object3D; r: number; h: number; w: number; ph: number }[] = [];
  private birdRoot = new THREE.Group();

  constructor(scene: THREE.Scene) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...waterUniforms },
      vertexColors: true,
      vertexShader: /* glsl */ `
        varying vec3 vWPos; varying vec3 vN; varying vec3 vCol;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWPos = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vCol = color;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vWPos; varying vec3 vN; varying vec3 vCol;
        ${WATER_GLSL_COMMON}
        ${SKY_GLSL}
        void main() {
          vec3 N = normalize(vN);
          float diff = max(dot(N, uSunDir), 0.0);
          vec3 c = vCol * (vec3(0.32, 0.42, 0.55) + uSunColor * diff * 0.95);
          // 대기 원근: 멀리 있을수록 푸르스름한 수평선 색으로 녹아듦
          vec3 V = vWPos - cameraPosition;
          float dist = length(V);
          vec3 hz = skyColor(normalize(vec3(V.x, 0.015, V.z)));
          float k = 1.0 - exp(-dist * 0.0011);
          c = mix(c, hz * 0.95, clamp(k + 0.05, 0.0, 0.62));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    for (const d of ISLANDS) {
      const m = new THREE.Mesh(islandGeo(d), mat);
      m.position.set(d.x, 0, d.z); m.rotation.y = d.rot;
      m.frustumCulled = false;
      this.islands.add(m);
    }
    scene.add(this.islands);

    // 바닷새 (갈매기·제비갈매기): 몸통 + 양 날개, 대부분 활공하다 가끔 날갯짓
    const r = mulberry32(77);
    const body = new THREE.CapsuleGeometry(0.06, 0.32, 3, 8); body.rotateX(Math.PI / 2);
    const head = new THREE.SphereGeometry(0.055, 8, 6); head.translate(0, 0.03, 0.22);
    const wing = new THREE.BufferGeometry();
    // 날개 (몸 쪽 → 끝): 뒤로 젖혀진 가는 날개
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.08, 0, 0, -0.1, 0.38, 0.02, -0.02, 0.38, 0.02, -0.02, 0, 0, -0.1, 0.72, 0.0, -0.2], 3));
    wing.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 0.92, 0.93, 0.95, 0.92, 0.93, 0.95, 1, 1, 1, 0.2, 0.2, 0.22], 3));
    wing.computeVertexNormals();
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#f2f3f4', roughness: 0.8 });
    const wingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    const beakMat = new THREE.MeshStandardMaterial({ color: '#e7a63a', roughness: 0.6 });
    const beak = new THREE.ConeGeometry(0.018, 0.08, 6); beak.rotateX(Math.PI / 2); beak.translate(0, 0.02, 0.3);
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(body, bodyMat), new THREE.Mesh(head, bodyMat), new THREE.Mesh(beak, beakMat));
      const wl = new THREE.Group(), wr = new THREE.Group();
      wl.add(new THREE.Mesh(wing, wingMat));
      const wrm = new THREE.Mesh(wing, wingMat); wrm.scale.x = -1; wr.add(wrm);
      wl.position.x = 0.04; wr.position.x = -0.04;
      g.add(wl, wr);
      g.scale.setScalar(0.9 + r() * 0.35);
      this.birdRoot.add(g);
      this.birds.push({ g, wl, wr, r: 14 + r() * 22, h: 12 + r() * 16, w: (r() < 0.5 ? -1 : 1) * (0.1 + r() * 0.08), ph: r() * Math.PI * 2 });
    }
    scene.add(this.birdRoot);
  }

  /** center: 새들이 맴도는 중심 (배) */
  update(t: number, center: THREE.Vector3, cameraUnder: boolean) {
    this.islands.visible = !cameraUnder;
    this.birdRoot.visible = !cameraUnder;
    if (cameraUnder) return;
    for (const b of this.birds) {
      const th = b.ph + t * b.w;
      const wob = Math.sin(t * 0.21 + b.ph) * 4;
      const x = center.x + Math.cos(th) * (b.r + wob), z = center.z + Math.sin(th) * (b.r + wob);
      const y = b.h + Math.sin(t * 0.33 + b.ph * 2) * 2.2;
      b.g.position.set(x, y, z);
      // 진행 방향(원의 접선)을 바라보고 안쪽으로 기울여 선회
      const dx = -Math.sin(th) * b.w, dz = Math.cos(th) * b.w;
      b.g.rotation.set(0, Math.atan2(dx, dz), 0, 'YXZ');
      b.g.rotation.z = -Math.sign(b.w) * 0.32;
      const flapping = Math.max(0, Math.sin(t * 0.37 + b.ph * 3) - 0.35) / 0.65;
      const flap = Math.sin(t * 8.5 + b.ph) * 0.65 * flapping + 0.1;
      b.wl.rotation.z = flap; b.wr.rotation.z = -flap;
    }
  }
}

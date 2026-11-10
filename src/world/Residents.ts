// 정주 생물: 말미잘+흰동가리, 자이언트 클램, 성게, 해삼, 파란 불가사리, 해초, 곰치
import * as THREE from 'three';
import { mulberry32, rand, vnoise3, type RNG } from '../core/math';
import { heightAt, normalAt, coralDensity, seagrass, dropFactor } from './terrain';
import { paint, merge, segment, hex } from './geo';
import { patchWater, waterUniforms } from '../water/WaterShading';
import type { CoralReef } from './CoralReef';
import type { FishSystem } from '../life/FishSystem';
import type { SpeciesDef } from '../life/types';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function findSpot(r: RNG, test: (x: number, z: number, d: number) => boolean, area: [number, number, number, number], tries = 400) {
  for (let i = 0; i < tries; i++) {
    const x = rand(r, area[0], area[1]), z = rand(r, area[2], area[3]);
    const d = -heightAt(x, z);
    if (test(x, z, d)) return V3(x, -d, z);
  }
  return null;
}

function anemoneGeo(r: RNG) {
  const parts: THREE.BufferGeometry[] = [];
  const col = segment(V3(0, -0.05, 0), V3(0, 0.08, 0), 0.24, 0.3, 18);
  paint(col, hex('#8e2f55'));
  parts.push(col);
  const disc = new THREE.CircleGeometry(0.3, 24); disc.rotateX(-Math.PI / 2); disc.translate(0, 0.08, 0);
  paint(disc, hex('#c9b88a'));
  parts.push(disc);
  const n = 150;
  const tip = hex('#b6e07a'), base = hex('#d7c79a');
  for (let i = 0; i < n; i++) {
    const a = rand(r, 0, Math.PI * 2), d = Math.sqrt(r()) * 0.32;
    const p = V3(Math.cos(a) * d, 0.08, Math.sin(a) * d);
    const dir = V3(Math.cos(a) * (0.3 + d * 1.2), 1, Math.sin(a) * (0.3 + d * 1.2)).normalize();
    const len = rand(r, 0.09, 0.15);
    const g = segment(p, p.clone().addScaledVector(dir, len), 0.014, 0.008, 5, true);
    paint(g, (q) => base.clone().lerp(tip, THREE.MathUtils.clamp((q.y - 0.08) / len, 0, 1) ** 2), (q) => Math.max(0, q.y - 0.07) * 9);
    parts.push(g);
  }
  return merge(parts);
}

function urchinGeo(r: RNG) {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.SphereGeometry(0.07, 12, 8); body.translate(0, 0.06, 0);
  paint(body, hex('#1a1420')); parts.push(body);
  for (let i = 0; i < 70; i++) {
    const d = V3(rand(r, -1, 1), rand(r, -0.1, 1), rand(r, -1, 1)).normalize();
    const p = d.clone().multiplyScalar(0.06).add(V3(0, 0.06, 0));
    const g = segment(p, p.clone().addScaledVector(d, rand(r, 0.18, 0.32)), 0.004, 0.001, 3, true);
    paint(g, hex('#120e16'), (q) => Math.max(0, q.y) * 0.4); parts.push(g);
  }
  return merge(parts);
}

function starGeo() {
  const shape = new THREE.Shape();
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2, rr = i % 2 === 0 ? 0.16 : 0.025;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2);
  paint(g, hex('#2f6fe0'));
  return g;
}

function cucumberGeo() {
  const g = new THREE.CapsuleGeometry(0.06, 0.32, 6, 10);
  g.rotateX(Math.PI / 2); g.scale(1, 0.75, 1); g.translate(0, 0.045, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + vnoise3(x * 40, y * 40, z * 40) * 0.12;
    pos.setXYZ(i, x * k, y, z);
  }
  g.computeVertexNormals();
  paint(g, (p) => hex('#c4502a').multiplyScalar(0.8 + 0.4 * Math.max(0, vnoise3(p.x * 50, p.y * 50, p.z * 50))));
  return g;
}

function bladeGeo() {
  const g = new THREE.PlaneGeometry(0.02, 1, 1, 4);
  g.translate(0, 0.5, 0);
  paint(g, (p) => hex('#4f7a3a').lerp(hex('#9bbf5a'), p.y), (p) => p.y * p.y * 2.2);
  return g;
}

function clamGeo(r: RNG) {
  // 물결 모양 주름이 있는 두 장의 껍데기
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const verts: number[] = [], idx: number[] = [];
    const NU = 18, NV = 8;
    for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) {
      const u = i / NU, v = j / NV;
      const x = (u - 0.5) * 0.9;
      const ridge = Math.abs(Math.sin(u * Math.PI * 5)) * 0.04 * v;
      const h = Math.sin(v * Math.PI * 0.5) * 0.28 * Math.sin(u * Math.PI) ** 0.4;
      const out = (0.06 + Math.sin(v * Math.PI) * 0.12 + ridge) * Math.sin(u * Math.PI) ** 0.5;
      verts.push(x, h, side * out);
      void r;
    }
    const W = NV + 1;
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
      const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
      if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx); g.computeVertexNormals();
    paint(g, (p) => hex('#cfc6b0').multiplyScalar(0.75 + 0.25 * Math.abs(Math.sin((p.x + 0.45) * Math.PI * 5))));
    parts.push(g);
  }
  return merge(parts);
}

export class Residents {
  anemones: THREE.Vector3[] = [];
  /** 도감 발견용: 정주 생물 위치 */
  spots: { id: string; pos: THREE.Vector3 }[] = [];
  private clams: { mantle: THREE.Mesh; base: number }[] = [];
  private morays: { jaw: THREE.Object3D; body: THREE.Object3D; ph: number }[] = [];
  mantleMat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, reef: CoralReef, fish: FishSystem, species: SpeciesDef[], lowTier: boolean) {
    const r = mulberry32(55);
    const mat = reef.material;
    const place = (geo: THREE.BufferGeometry, list: { p: THREE.Vector3; s: number; c?: THREE.Color; yaw?: number; tilt?: boolean }[]) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      list.forEach((it, i) => {
        q.setFromEuler(new THREE.Euler(0, it.yaw ?? rand(r, 0, 6.28), 0));
        if (it.tilt) { const [nx, ny, nz] = normalAt(it.p.x, it.p.z); q.premultiply(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), V3(nx, ny, nz))); }
        m.compose(it.p, q, V3(it.s, it.s, it.s));
        im.setMatrixAt(i, m);
        im.setColorAt(i, it.c ?? new THREE.Color(1, 1, 1));
      });
      im.computeBoundingSphere();
      scene.add(im);
      return im;
    };

    // 말미잘 + 흰동가리: 배 주변 얕은 리프 (스노클링에서 바로 보이게)
    const anList: { p: THREE.Vector3; s: number; c: THREE.Color }[] = [];
    const anTints = [hex('#ffffff'), hex('#f0d0e0'), hex('#d8f0c8'), hex('#f3e0b0')];
    const forced = [[6, 4], [12, -2], [-8, 7], [3, 14], [-4, -9], [18, 10], [-14, -2], [9, 22]];
    for (const [fx, fz] of forced) {
      const p = findSpot(r, (x, z, d) => d > 2.2 && d < 7 && coralDensity(x, z) > 0.3, [fx - 4, fx + 4, fz - 4, fz + 4], 60);
      if (!p) continue;
      p.y += 0.0;
      anList.push({ p, s: rand(r, 0.9, 1.4), c: anTints[anList.length % 4] });
      this.anemones.push(p.clone().add(V3(0, 0.12, 0)));
    }
    place(anemoneGeo(r), anList);
    for (const a of this.anemones) this.spots.push({ id: 'clownfish', pos: a.clone().add(V3(0, 0.2, 0)) });
    const clown = species.find((s) => s.id === 'clownfish');
    if (clown) this.anemones.forEach((a, k) => fish.spawn(clown, a.clone().add(V3(0, 0.15, 0)), Math.floor(rand(r, 2, 4.99)), a, 7000 + k));

    // 성게: 산호 틈과 암반
    const urList: { p: THREE.Vector3; s: number; c: THREE.Color }[] = [];
    for (let i = 0; i < (lowTier ? 24 : 45); i++) {
      const p = findSpot(r, (x, z, d) => d > 2 && d < 24 && coralDensity(x, z) > 0.25, [-50, 50, -80, 40], 50);
      if (p) urList.push({ p, s: rand(r, 0.8, 1.3), c: hex('#ffffff').multiplyScalar(rand(r, 0.6, 1)) });
    }
    place(urchinGeo(r), urList);
    for (const u of urList) this.spots.push({ id: 'urchin', pos: u.p.clone().add(V3(0, 0.1, 0)) });

    // 파란 불가사리 (Linckia laevigata): 얕은 잔해 지대
    const stList: { p: THREE.Vector3; s: number; c: THREE.Color; tilt: boolean }[] = [];
    for (let i = 0; i < 24; i++) {
      const p = findSpot(r, (x, z, d) => d > 2 && d < 10 && coralDensity(x, z) < 0.5, [-40, 40, -30, 40], 50);
      if (p) stList.push({ p: p.add(V3(0, 0.01, 0)), s: rand(r, 0.8, 1.3), c: hex('#ffffff').lerp(hex('#9ec0ff'), r() * 0.4), tilt: true });
    }
    place(starGeo(), stList);
    for (const u of stList) this.spots.push({ id: 'starfish', pos: u.p.clone() });

    // 해삼: 모래 바닥
    const cuList: { p: THREE.Vector3; s: number; c: THREE.Color; tilt: boolean }[] = [];
    for (let i = 0; i < 26; i++) {
      const p = findSpot(r, (x, z, d) => d > 3 && d < 33 && coralDensity(x, z) < 0.25, [-60, 60, -110, 40], 50);
      if (p) cuList.push({ p, s: rand(r, 1.2, 2.2), c: [hex('#ffffff'), hex('#3a3030'), hex('#8a7060')][i % 3], tilt: true });
    }
    place(cucumberGeo(), cuList);
    for (const u of cuList) this.spots.push({ id: 'cucumber', pos: u.p.clone().add(V3(0, 0.05, 0)) });

    // 해초밭 (거북이가 찾아오는 곳)
    const blades: { p: THREE.Vector3; s: number; c: THREE.Color }[] = [];
    const target = lowTier ? 3500 : 9000;
    for (let i = 0; i < target * 4 && blades.length < target; i++) {
      const x = rand(r, 15, 72), z = rand(r, -25, 45);
      if (r() > seagrass(x, z)) continue;
      blades.push({ p: V3(x, heightAt(x, z) - 0.02, z), s: rand(r, 0.25, 0.55), c: hex('#ffffff').multiplyScalar(rand(r, 0.7, 1.1)) });
    }
    if (blades.length) place(bladeGeo(), blades);

    // 자이언트 클램: 껍데기 + 무지갯빛 외투막
    this.mantleMat = patchWater(new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.0 }), {
      key: 'mantle',
      extend: (sh) => {
        sh.uniforms.uTime = waterUniforms.uTime;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMP;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMP = position;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vMP;\nfloat mh(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5);}')
          .replace('#include <color_fragment>', `#include <color_fragment>
            {
              // Tridacna 외투막: 보는 각도와 빛에 따라 청록·코발트·보라·금색이 살아남
              vec2 g = vMP.xz * vec2(30.0, 14.0);
              vec2 f = fract(g) - 0.5;
              float spot = (1.0 - smoothstep(0.15, 0.32, length(f))) * step(0.35, mh(floor(g)));
              float wav = sin(vMP.x * 40.0 + sin(vMP.z * 25.0) * 2.0) * 0.5 + 0.5;
              vec3 V = normalize(vViewPosition);
              float ir = pow(clamp(1.0 - abs(dot(normalize(vNormal), -V)), 0.0, 1.0), 1.5);
              vec3 a = diffuseColor.rgb;
              vec3 b = vec3(0.1, 0.85, 0.85);
              vec3 c = mix(a, b, wav * 0.45);
              c = mix(c, vec3(0.55, 0.3, 0.95), ir * 0.6);
              c += vec3(0.2, 0.9, 1.0) * spot * (0.6 + 0.4 * sin(uTime * 1.3 + vMP.x * 20.0));
              diffuseColor.rgb = c;
            }`);
      },
    });
    const shell = clamGeo(r);
    const shellMat = mat;
    const mantleTints = [hex('#1f4fd8'), hex('#16a0a8'), hex('#7a3ad0'), hex('#c8a030'), hex('#2a70e8')];
    for (let i = 0; i < (lowTier ? 7 : 12); i++) {
      const p = findSpot(r, (x, z, d) => d > 1.8 && d < 9 && dropFactor(x, z) < 0.2 && coralDensity(x, z) > 0.15, i < 4 ? [-12, 14, -10, 14] : [-40, 40, -25, 40], 80);
      if (!p) continue;
      const s = rand(r, 0.6, 1.4);
      const g = new THREE.Group();
      g.position.copy(p).add(V3(0, -0.04, 0)); g.rotation.y = rand(r, 0, 6.28); g.scale.setScalar(s);
      const shellMesh = new THREE.Mesh(shell, shellMat);
      g.add(shellMesh);
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.mantleMat.clone());
      (m.material as THREE.MeshStandardMaterial).color = mantleTints[i % mantleTints.length].clone();
      (m.material as THREE.MeshStandardMaterial).onBeforeCompile = this.mantleMat.onBeforeCompile;
      (m.material as THREE.MeshStandardMaterial).customProgramCacheKey = this.mantleMat.customProgramCacheKey;
      m.scale.set(0.82, 0.12, 0.2); m.position.y = 0.2;
      g.add(m);
      scene.add(g);
      this.clams.push({ mantle: m, base: rand(r, 0, 6) });
      this.spots.push({ id: 'giantclam', pos: p.clone().add(V3(0, 0.2 * s, 0)) });
    }

    // 곰치: 봄미 바위 틈에서 머리를 내밀고 입을 벌렸다 닫음 (호흡)
    const morayMat = patchWater(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), { key: 'moray' });
    for (const [mx, mz] of [[15, -4], [-11, 9], [-8, -58]]) {
      const h = heightAt(mx, mz);
      const p = V3(mx + 1.6, 0, mz + 0.5); p.y = heightAt(p.x, p.z) + 0.35;
      const g = new THREE.Group(); g.position.copy(p); g.lookAt(V3(mx + 4, h + 0.8, mz + 1));
      const spots = (q: THREE.Vector3) => hex('#6a5a2a').lerp(hex('#1e1a10'), vnoise3(q.x * 30, q.y * 30, q.z * 30) > 0.2 ? 0.85 : 0);
      const body = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(0, -0.1, -0.7), V3(0, -0.05, -0.35), V3(0, 0, 0)]), 12, 0.1, 10);
      paint(body, spots);
      const head = new THREE.SphereGeometry(0.1, 14, 10); head.scale(0.9, 1.05, 1.7); head.translate(0, 0.02, 0.1);
      paint(head, spots);
      const bodyG = new THREE.Group();
      bodyG.add(new THREE.Mesh(merge([body, head]), morayMat));
      const jawG = new THREE.Group(); jawG.position.set(0, -0.03, 0.02);
      const jawGeo = new THREE.SphereGeometry(0.07, 10, 6); jawGeo.scale(1, 0.4, 2.4); jawGeo.translate(0, -0.015, 0.12);
      paint(jawGeo, hex('#5a4a22'));
      jawG.add(new THREE.Mesh(jawGeo, morayMat));
      bodyG.add(jawG);
      g.add(bodyG);
      scene.add(g);
      this.morays.push({ jaw: jawG, body: bodyG, ph: r() * 6 });
      this.spots.push({ id: 'moray', pos: p.clone() });
    }
  }

  update(t: number) {
    for (const c of this.clams) {
      // 천천히 숨 쉬듯 외투막이 부풀었다 가라앉음
      const k = 1 + Math.sin(t * 0.35 + c.base) * 0.15;
      c.mantle.scale.y = 0.12 * k;
    }
    for (const m of this.morays) {
      m.jaw.rotation.x = 0.12 + Math.max(0, Math.sin(t * 1.4 + m.ph)) * 0.32;
      m.body.rotation.y = Math.sin(t * 0.3 + m.ph) * 0.18;
      m.body.position.z = Math.sin(t * 0.21 + m.ph) * 0.06;
    }
  }
}

// 절차 지오메트리 공용 도구: 색/흔들림 속성 부여 + 병합
import * as THREE from 'three';

export type ColorFn = (p: THREE.Vector3, n: THREE.Vector3, i: number) => THREE.Color;

/** 위치/법선/색/흔들림(aSway)만 갖도록 정리 */
export function paint(geo: THREE.BufferGeometry, color: THREE.Color | ColorFn, sway: number | ((p: THREE.Vector3) => number) = 0) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const n = pos.count;
  const col = new Float32Array(n * 3), sw = new Float32Array(n);
  const p = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i); nn.fromBufferAttribute(nrm, i);
    const c = typeof color === 'function' ? color(p, nn, i) : color;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    sw[i] = typeof sway === 'function' ? sway(p) : sway;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color', 'aSway'].includes(k)) geo.deleteAttribute(k);
  return geo;
}

/** 위치/법선/색/aSway 기준으로 단순 병합 (인덱스 유무 혼합 가능) */
export function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'color', 'aSway'];
  let total = 0, totalIdx = 0;
  for (const g of list) { total += g.attributes.position.count; totalIdx += g.index ? g.index.count : g.attributes.position.count; }
  const out: Record<string, Float32Array> = {};
  for (const k of names) out[k] = new Float32Array(total * (k === 'aSway' ? 1 : 3));
  const idx = total > 65535 ? new Uint32Array(totalIdx) : new Uint16Array(totalIdx);
  let vo = 0, io = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    for (const k of names) {
      const a = g.attributes[k] as THREE.BufferAttribute;
      const size = k === 'aSway' ? 1 : 3;
      if (a) out[k].set(a.array as Float32Array, vo * size);
      else if (k === 'color') out[k].fill(1, vo * 3, (vo + c) * 3);
    }
    if (g.index) { const ia = g.index.array; for (let i = 0; i < ia.length; i++) idx[io++] = ia[i] + vo; }
    else for (let i = 0; i < c; i++) idx[io++] = i + vo;
    vo += c;
  }
  const geo = new THREE.BufferGeometry();
  for (const k of names) geo.setAttribute(k, new THREE.BufferAttribute(out[k], k === 'aSway' ? 1 : 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

const UP = new THREE.Vector3(0, 1, 0);
/** a→b 를 잇는 원뿔대 (가지/줄기) */
export function segment(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, radial = 6, capped = false) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, !capped);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

export const hex = (h: string) => new THREE.Color(h);

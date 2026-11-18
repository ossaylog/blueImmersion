// 움직이지 않는 구조물(판툰·보트)의 부품을 재질별로 하나의 메시로 합침
//  → 그리기 호출 수가 부품 수(수십 개)에서 재질 종류 수로 줄어듦 · 화면 결과는 동일
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function signature(m: THREE.Material) {
  const s = m as THREE.MeshStandardMaterial;
  return [m.type, s.color?.getHexString(), s.emissive?.getHexString(), s.emissiveIntensity, s.roughness, s.metalness, m.side, s.vertexColors,
    s.map?.uuid, s.flatShading, m.customProgramCacheKey()].join('|');
}

/** root 아래 정적 메시를 합침 (keep에 든 하위 트리·투명·인스턴스·다중 재질은 그대로 둠) · 줄어든 메시 수 반환 */
export function mergeStatic(root: THREE.Object3D, keep: THREE.Object3D[] = []): number {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const kept = new Set<THREE.Object3D>();
  for (const k of keep) k.traverse((o) => kept.add(o));
  const groups = new Map<string, { mat: THREE.Material; meshes: THREE.Mesh[] }>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || kept.has(m) || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
    const mat = m.material as THREE.Material;
    if (mat.transparent || !m.visible || !m.geometry.attributes.position) return;
    const key = signature(mat);
    if (!groups.has(key)) groups.set(key, { mat, meshes: [] });
    groups.get(key)!.meshes.push(m);
  });
  let removed = 0;
  const local = new THREE.Matrix4();
  for (const { mat, meshes } of groups.values()) {
    if (meshes.length < 2) continue;
    const s = mat as THREE.MeshStandardMaterial;
    const need = ['position', 'normal', ...(s.map ? ['uv'] : []), ...(s.vertexColors ? ['color'] : [])];
    const geos: THREE.BufferGeometry[] = [];
    let ok = true;
    for (const mesh of meshes) {
      let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      for (const k of Object.keys(g.attributes)) if (!need.includes(k)) g.deleteAttribute(k);
      if (need.some((k) => !g.attributes[k])) { ok = false; break; }
      g.morphAttributes = {};
      local.multiplyMatrices(inv, mesh.matrixWorld);
      g.applyMatrix4(local);
      geos.push(g);
    }
    if (!ok) continue;
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const out = new THREE.Mesh(merged, mat);
    out.castShadow = meshes[0].castShadow; out.receiveShadow = meshes[0].receiveShadow;
    out.name = 'merged';
    for (const mesh of meshes) { mesh.removeFromParent(); mesh.geometry.dispose(); }
    root.add(out);
    removed += meshes.length - 1;
  }
  return removed;
}

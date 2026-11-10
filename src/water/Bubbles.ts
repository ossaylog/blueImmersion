// 기포: 레귤레이터 호기, 입수, 덕다이브. 올라갈수록 커지고(압력 감소) 흔들리며 수면에서 사라짐
import * as THREE from 'three';
import { waterUniforms, WATER_GLSL_COMMON } from './WaterShading';

export class Bubbles {
  mesh: THREE.InstancedMesh;
  private n = 260;
  private p: THREE.Vector3[] = []; private d0: number[] = []; private v: number[] = []; private s: number[] = []; private age: number[] = []; private alive: boolean[] = [];
  private head = 0;
  private m = new THREE.Matrix4();
  constructor(scene: THREE.Scene) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...waterUniforms },
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vWPos; varying vec3 vV;
        void main(){ vec4 wp = modelMatrix * instanceMatrix * vec4(position,1.0); vWPos = wp.xyz;
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `varying vec3 vN; varying vec3 vWPos; varying vec3 vV;
        ${WATER_GLSL_COMMON}
        void main(){ float f = pow(clamp(1.0 - abs(dot(normalize(vN), vV)), 0.0, 1.0), 2.2);
          float hl = pow(max(dot(reflect(-vV, normalize(vN)), normalize(vec3(uSunDir.x*0.4, 1.0, uSunDir.z*0.4))), 0.0), 30.0);
          vec3 c = mix(waterColor(-vWPos.y) * 2.2, vec3(0.85, 0.97, 1.0), f) + hl * 1.5;
          float a = clamp(f * 0.85 + hl + 0.06, 0.0, 0.9);
          vec3 T = exp(-uExtinct * length(vWPos - cameraPosition));
          a *= dot(T, vec3(0.333));
          gl_FragColor = vec4(c, a); }`,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), mat, this.n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 7; this.mesh.count = 0;
    for (let i = 0; i < this.n; i++) { this.p.push(new THREE.Vector3()); this.d0.push(0); this.v.push(0); this.s.push(0); this.age.push(0); this.alive.push(false); }
    scene.add(this.mesh);
  }

  burst(at: THREE.Vector3, count: number, spread = 0.05, size = 1) {
    for (let k = 0; k < count; k++) {
      const i = this.head; this.head = (this.head + 1) % this.n;
      this.p[i].copy(at).add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread));
      this.d0[i] = Math.max(0, -at.y);
      this.s[i] = (0.004 + Math.random() ** 2.5 * 0.022) * size;
      this.v[i] = 0.25 + this.s[i] * 22 + Math.random() * 0.1;
      this.age[i] = -k * 0.02 - Math.random() * 0.15;
      this.alive[i] = true;
    }
  }

  update(dt: number, t: number) {
    let c = 0;
    const sc = new THREE.Vector3(), q = new THREE.Quaternion();
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      this.age[i] += dt;
      if (this.age[i] < 0) continue;
      const p = this.p[i];
      p.y += this.v[i] * dt;
      p.x += Math.sin(t * 9 + i) * 0.12 * dt; p.z += Math.cos(t * 7 + i * 1.3) * 0.12 * dt;
      if (p.y > -0.05 || this.age[i] > 40) { this.alive[i] = false; continue; }
      // 보일 법칙: 상승할수록 부피 증가
      const r = this.s[i] * Math.cbrt((1 + this.d0[i] / 10) / (1 + Math.max(0, -p.y) / 10));
      const wob = 1 + Math.sin(t * 20 + i) * 0.15;
      sc.set(r * wob, r * (0.75 + (r > 0.012 ? 0 : 0.25)), r / wob);
      this.m.compose(p, q, sc);
      this.mesh.setMatrixAt(c++, this.m);
    }
    this.mesh.count = c;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

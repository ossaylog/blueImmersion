// 렌더러 + 후처리 (톤매핑 · 수중 미세 굴절 · 비네트)
import * as THREE from 'three';
import type { Quality } from './quality';

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  rt: THREE.WebGLRenderTarget;
  private post: THREE.Mesh;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  postU = {
    tScene: { value: null as THREE.Texture | null }, uTime: { value: 0 }, uUnder: { value: 0 },
    uExposure: { value: 1.0 }, uFade: { value: 0 }, uMask: { value: 0 }, uFadeColor: { value: new THREE.Color(0.01, 0.05, 0.09) }, uAspect: { value: 1 },
    /** 물 밖으로 나온 직후 렌즈의 물기 (1 → 0) */
    uWet: { value: 0 },
    /** 화면 속 태양 (xy: 0~1 화면 좌표, z: 세기) */
    uSun: { value: new THREE.Vector3() },
  };
  private clock = new THREE.Clock();
  onFrame?: (dt: number, t: number) => void;
  /** 이번 프레임을 그린 직후 한 번 실행 (화면 캡처용: 그린 직후여야 캔버스 내용이 남아 있음) */
  afterRender?: () => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  fps = 60;

  constructor(canvas: HTMLCanvasElement, public q: Quality) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(q.pixelRatio);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 2400);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa, depthBuffer: true });
    this.postU.tScene.value = this.rt.texture;
    this.post = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: this.postU, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene; uniform float uTime; uniform float uUnder; uniform float uExposure; uniform float uFade; uniform vec3 uFadeColor; uniform float uAspect; uniform float uMask;
        uniform float uWet; uniform vec3 uSun;
        varying vec2 vUv;
        vec3 aces(vec3 x) { const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0); }
        vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        // 렌즈의 물방울 한 층: 열마다 다른 속도로 흘러내리고, 물기가 마르며 하나씩 사라짐
        vec2 dropLayer(vec2 uv, float scale, float speed, float seed, inout float m, inout float rim) {
          vec2 p = uv * vec2(uAspect, 1.0) * scale;
          float col = floor(p.x);
          float cs = h(vec2(col, seed));
          p.y += uTime * speed * (0.25 + cs) * (0.4 + uWet) + cs * 13.0;
          vec2 id = floor(p);
          vec2 f = fract(p) - 0.5;
          if (h(id + seed) > 0.6) return vec2(0.0);
          if (h(id + seed + 9.1) > uWet * 1.15) return vec2(0.0);
          vec2 c = (vec2(h(id + 7.3), h(id + 11.7)) - 0.5) * 0.45;
          vec2 d = f - c; d.y *= 1.25;
          float r = 0.1 + 0.22 * h(id + 5.9);
          float l = length(d);
          float drop = smoothstep(r, r * 0.6, l);
          // 방울 위로 남는 가는 물줄기 자국
          float trail = smoothstep(0.035, 0.0, abs(f.x - c.x)) * step(c.y, f.y) * (1.0 - smoothstep(0.0, 0.45, f.y - c.y)) * 0.5;
          m = max(m, max(drop, trail * uWet));
          rim = max(rim, drop * smoothstep(r * 0.55, r, l));
          return d / r * drop + vec2(0.0, -0.3) * trail;
        }
        void main() {
          vec2 uv = vUv;
          // 물 밖으로 나온 직후: 마스크·렌즈에 맺힌 물방울이 빛을 굴절
          float wetM = 0.0, wetRim = 0.0;
          if (uWet > 0.001 && uUnder < 0.5) {
            vec2 o = dropLayer(vUv, 9.0, 0.06, 1.0, wetM, wetRim) * 0.022
                   + dropLayer(vUv, 17.0, 0.03, 4.0, wetM, wetRim) * 0.012
                   + dropLayer(vUv, 4.5, 0.11, 8.0, wetM, wetRim) * 0.035;
            uv -= o;
            // 전체가 살짝 젖어 번짐
            uv += vec2(sin(vUv.y * 40.0 + uTime), cos(vUv.x * 33.0 - uTime)) * 0.0015 * uWet;
          }
          // 물속 미세 굴절 (아주 약하게 — 멀미 방지)
          uv += uUnder * vec2(sin(uv.y * 23.0 + uTime * 1.3), cos(uv.x * 19.0 + uTime * 1.1)) * 0.0011;
          vec3 c = texture2D(tScene, uv).rgb;
          // NaN/Inf 방어 (어떤 셰이더든 검은 점이 생기지 않도록)
          if (any(isnan(c)) || any(isinf(c))) c = texture2D(tScene, uv + vec2(0.003, 0.002)).rgb;
          if (any(isnan(c)) || any(isinf(c))) c = vec3(0.02, 0.18, 0.24);
          c = max(c, vec3(0.0));
          // 가장자리 약한 색수차 (물속에서만)
          if (uUnder > 0.5) {
            vec2 d = (uv - 0.5) * 0.0025;
            c.r = mix(c.r, texture2D(tScene, uv + d).r, 0.6);
            c.b = mix(c.b, texture2D(tScene, uv - d).b, 0.6);
          }
          if (wetM > 0.0) c = c * (1.0 + wetM * 0.12) - wetRim * 0.06 * c;
          // 태양 눈부심: 부드러운 헤일로 + 화면 중심을 지나는 희미한 렌즈 고스트
          if (uSun.z > 0.001) {
            vec2 a = vec2(uAspect, 1.0);
            vec2 ds = (vUv - uSun.xy) * a;
            float dl = length(ds);
            vec3 glare = vec3(1.0, 0.92, 0.78) * (exp(-dl * 9.0) * 1.2 + exp(-dl * 2.6) * 0.22);
            float ang = atan(ds.y, ds.x);
            glare += vec3(1.0, 0.95, 0.85) * exp(-dl * 5.0) * pow(abs(cos(ang * 3.0)), 40.0) * 0.35;
            vec2 axis = vec2(0.5) - uSun.xy;
            for (int k = 1; k <= 4; k++) {
              float fk = float(k);
              vec2 gp = uSun.xy + axis * (0.55 * fk);
              float gr = 0.025 + 0.022 * fk;
              float g = smoothstep(gr, gr * 0.75, length((vUv - gp) * a));
              glare += mix(vec3(0.3, 0.6, 1.0), vec3(1.0, 0.6, 0.35), fract(fk * 0.37)) * g * 0.05;
            }
            c += glare * uSun.z;
          }
          c = aces(c * uExposure);
          if (uMask > 0.001) {
            // 1인칭 다이빙 마스크: 넓은 렌즈 윤곽 + 아래 중앙 코 주머니 + 반투명 실리콘 스커트
            vec2 mq = (vUv - 0.5) * vec2(uAspect, 1.0);
            vec2 hs = vec2(uAspect * 0.5 * 0.95, 0.5 * 0.92);
            vec2 dq = abs(mq) - hs + 0.22;
            float sd = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0) - 0.22;
            float nose = length((mq - vec2(0.0, -0.55)) * vec2(1.0, 0.8)) - 0.115;
            sd = max(sd, -nose);
            float frame = smoothstep(-0.015, 0.035, sd);
            float inner = smoothstep(-0.16, 0.0, sd);
            c *= 1.0 - inner * 0.3 * uMask;
            c = mix(c, c * vec3(0.16, 0.26, 0.29) + vec3(0.0, 0.012, 0.018), frame * uMask);
            // 렌즈 위쪽의 아주 옅은 반사광 (선이 아닌 넓은 그라데이션)
            float refl = smoothstep(0.1, 0.45, mq.y) * smoothstep(-0.2, 0.6, mq.x) * 0.025;
            c += refl * uMask * (1.0 - frame);
          }
          vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
          float vig = smoothstep(1.25, 0.35, length(q) * (1.0 + uUnder * 0.25));
          c *= mix(1.0, vig, 0.55 + uUnder * 0.2);
          c = toSRGB(c);
          c += (h(vUv * 800.0 + uTime) - 0.5) / 255.0;
          c = mix(c, uFadeColor, uFade);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
    this.post.frustumCulled = false;
    this.postScene.add(this.post);
    addEventListener('resize', () => this.resize());
    // 모바일에서 GPU 메모리가 부족하면 WebGL 컨텍스트가 사라질 수 있음 → 멈춘 화면 대신 복구 시도
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.onContextLost?.(); });
    canvas.addEventListener('webglcontextrestored', () => this.onContextRestored?.());
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.fov = w / h < 1 ? 76 : 62; this.camera.updateProjectionMatrix();
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt.setSize(s.x, s.y);
    this.postU.uAspect.value = w / h;
  }

  start() {
    const loop = () => {
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const t = this.clock.elapsedTime;
      this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
      this.onFrame?.(dt, t);
      this.postU.uTime.value = t;
      this.renderer.setRenderTarget(this.rt);
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.postScene, this.postCam);
      if (this.afterRender) { const f = this.afterRender; this.afterRender = undefined; f(); }
    };
    this.renderer.setAnimationLoop(loop);
  }
}

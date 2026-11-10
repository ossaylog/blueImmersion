// 절차적 사운드 (Web Audio): 에셋 없이 바다 공간감을 만든다.
//  채널: 전체 / 환경음 / 생물 효과음 / 장비 소리 / 배경음악(기본 꺼짐)
//  최종 단계에서 녹음 에셋으로 교체할 때 같은 채널·같은 트리거 함수 유지
import type { AudioSettings } from '../core/store';

export type AudioScene = 'air' | 'cruise' | 'snorkel' | 'scuba' | 'silent';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode; private ch!: Record<'ambient' | 'creature' | 'gear' | 'music', GainNode>;
  private noise!: AudioBuffer; private brown!: AudioBuffer;
  private layers: Record<string, { gain: GainNode; target: number }> = {};
  private underFilter!: BiquadFilterNode;
  private engineGain!: GainNode; private engineOsc!: OscillatorNode;
  private crackleTimer = 0; private gullTimer = 4; private musicTimer = 0;
  scene: AudioScene = 'silent';
  private musicNodes: OscillatorNode[] = [];

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    this.ch = { ambient: ctx.createGain(), creature: ctx.createGain(), gear: ctx.createGain(), music: ctx.createGain() };
    for (const k in this.ch) this.ch[k as keyof typeof this.ch].connect(this.master);
    // 노이즈 버퍼
    const len = ctx.sampleRate * 4;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.noise.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { w[i] = Math.random() * 2 - 1; last = (last + 0.02 * w[i]) / 1.02; b[i] = last * 3.5; }

    // ── 수면 위 ──
    this.loop('waves', this.brown, [['lowpass', 520, 0.7]], 'ambient', 0.03);
    this.loop('wind', this.noise, [['bandpass', 900, 0.4]], 'ambient', 0.05);
    this.loop('slap', this.noise, [['bandpass', 380, 1.2]], 'ambient', 0.08);
    // ── 수중 ──
    this.underFilter = ctx.createBiquadFilter(); this.underFilter.type = 'lowpass'; this.underFilter.frequency.value = 380;
    this.loop('under', this.brown, [['lowpass', 160, 0.5]], 'ambient', 0.11);
    this.loop('surfaceMuffled', this.brown, [['lowpass', 260, 1]], 'ambient', 0.04);
    // ── 엔진 ──
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 280;
    this.engineOsc = ctx.createOscillator(); this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 46;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 23.2;
    const og = ctx.createGain(); og.gain.value = 0.3;
    this.engineOsc.connect(lp); o2.connect(og).connect(lp);
    lp.connect(this.engineGain).connect(this.ch.ambient);
    this.engineOsc.start(); o2.start();
    // 파도·바람에 느린 LFO
    this.lfo(this.layers.waves.gain.gain, 0.09, 0.4);
    this.lfo(this.layers.wind.gain.gain, 0.05, 0.5);
  }

  private loop(name: string, buf: AudioBuffer, filters: [BiquadFilterType, number, number][], channel: keyof AudioEngine['ch'], _base: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.loopStart = Math.random();
    let node: AudioNode = src;
    for (const [type, f, q] of filters) { const bq = ctx.createBiquadFilter(); bq.type = type; bq.frequency.value = f; bq.Q.value = q; node.connect(bq); node = bq; }
    const gain = ctx.createGain(); gain.gain.value = 0;
    node.connect(gain).connect(this.ch[channel]);
    src.start(0, Math.random() * 3);
    this.layers[name] = { gain, target: 0 };
    void _base;
  }

  private lfo(param: AudioParam, freq: number, depth: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = depth * 0.05;
    o.connect(g).connect(param); o.start();
  }

  applySettings(s: AudioSettings, muted: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(muted ? 0 : s.master, t, 0.1);
    this.ch.ambient.gain.setTargetAtTime(s.ambient, t, 0.1);
    this.ch.creature.gain.setTargetAtTime(s.creature, t, 0.1);
    this.ch.gear.gain.setTargetAtTime(s.gear, t, 0.1);
    this.ch.music.gain.setTargetAtTime(s.music * 0.6, t, 0.3);
  }

  setScene(scene: AudioScene) { this.scene = scene; }

  /** 매 프레임: 장면/수심에 맞춰 레이어 크로스페이드 */
  update(dt: number, depth: number, engine: number) {
    if (!this.ctx) return;
    const S = this.scene;
    const air = S === 'air' || S === 'cruise';
    const under = S === 'snorkel' || S === 'scuba';
    const set = (k: string, v: number) => { const l = this.layers[k]; if (l) l.gain.gain.setTargetAtTime(v, this.ctx!.currentTime, 0.6); };
    set('waves', air ? 0.32 : 0);
    set('wind', air ? (S === 'cruise' ? 0.22 : 0.1) : 0);
    set('slap', air ? 0.06 : 0);
    // 수중: 깊어질수록 낮고 넓은 공간감, 수면에서 멀어질수록 바깥 소리 약해짐
    set('under', under ? 0.5 + Math.min(depth, 30) * 0.01 : 0);
    set('surfaceMuffled', under ? 0.35 * Math.exp(-depth * 0.35) : 0);
    this.engineGain.gain.setTargetAtTime(engine * 0.11, this.ctx.currentTime, 0.4);
    this.engineOsc.frequency.setTargetAtTime(42 + engine * 14, this.ctx.currentTime, 0.5);

    // 딱총새우 크래클: 산호초 수중 음향의 핵심
    if (under) {
      this.crackleTimer -= dt;
      const density = 22 * Math.exp(-depth * 0.03);
      while (this.crackleTimer < 0) { this.click(0.05 + Math.random() * 0.12); this.crackleTimer += Math.random() * 2 / density; }
    }
    if (air) {
      this.gullTimer -= dt;
      if (this.gullTimer < 0) { this.gull(); this.gullTimer = 6 + Math.random() * 14; }
    }
    // 배경음악 (선택)
    this.musicTimer -= dt;
    if (this.musicTimer < 0) { this.musicTimer = 9; if (this.ch.music.gain.value > 0.01) this.pad(); }
  }

  private env(g: GainNode, a: number, peak: number, d: number) {
    const t = this.ctx!.currentTime;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private burst(dur: number, type: BiquadFilterType, f: number, q: number, peak: number, ch: keyof AudioEngine['ch'], attack = 0.005, offset = 0) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const bq = ctx.createBiquadFilter(); bq.type = type; bq.frequency.value = f; bq.Q.value = q;
    const g = ctx.createGain();
    src.connect(bq).connect(g).connect(this.ch[ch]);
    const t = ctx.currentTime + offset;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    src.start(t, Math.random() * 3, attack + dur + 0.05);
    return bq;
  }

  click(v: number) { if (this.ctx) this.burst(0.012, 'highpass', 2500 + Math.random() * 3000, 0.7, v * 0.5, 'ambient', 0.001); }

  gull() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) {
      const o = ctx.createOscillator(); o.type = 'triangle';
      const g = ctx.createGain(); const t = ctx.currentTime + k * 0.32;
      o.frequency.setValueAtTime(1500, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.25);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.025, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g).connect(this.ch.creature); o.start(t); o.stop(t + 0.3);
    }
  }

  /** 입수 첨벙 */
  splash(big = 1) {
    if (!this.ctx) return;
    this.burst(0.9 * big, 'lowpass', 1800, 0.5, 0.5 * big, 'ambient', 0.01);
    this.burst(1.6, 'lowpass', 400, 0.8, 0.35, 'ambient', 0.05, 0.1);
    for (let i = 0; i < 14; i++) this.blub(0.05 + Math.random() * 0.06, Math.random() * 1.2);
  }

  /** 기포 한 방울 */
  blub(v: number, offset = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    const g = ctx.createGain(); const t = ctx.currentTime + offset;
    const f = 280 + Math.random() * 700;
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 2.2, t + 0.06);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(this.ch.gear); o.start(t); o.stop(t + 0.1);
  }

  /** 레귤레이터 흡기: 쉬익 */
  inhale(depth: number) {
    if (!this.ctx) return;
    const bq = this.burst(1.25, 'bandpass', 1700, 1.2, 0.11, 'gear', 0.25);
    bq.frequency.setValueAtTime(1500, this.ctx.currentTime); bq.frequency.linearRampToValueAtTime(2100 - depth * 8, this.ctx.currentTime + 1.2);
  }
  /** 호기: 레귤레이터 배기 + 기포 소리 */
  exhale() {
    if (!this.ctx) return;
    this.burst(1.3, 'lowpass', 700, 1, 0.12, 'gear', 0.08);
    for (let i = 0; i < 18; i++) this.blub(0.03 + Math.random() * 0.05, 0.1 + Math.random() * 1.4);
  }
  /** 스노클 숨소리 (튜브 통과) */
  snorkelBreath(inhale: boolean) {
    if (!this.ctx) return;
    this.burst(inhale ? 1.0 : 0.9, 'bandpass', inhale ? 900 : 650, 2.5, 0.06, 'gear', inhale ? 0.3 : 0.1);
  }
  /** 물고기가 스쳐 지나가는 미세한 물소리 */
  swish(v: number) { if (this.ctx) this.burst(0.35, 'bandpass', 520, 0.9, 0.06 * v, 'creature', 0.08); }
  /** 귀 압력 평형 */
  pop() {
    if (!this.ctx) return;
    const ctx = this.ctx; const o = ctx.createOscillator(); const g = ctx.createGain(); const t = ctx.currentTime;
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.08);
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(this.ch.gear); o.start(t); o.stop(t + 0.15);
  }
  /** 스노클: 수면에 올라와 튜브의 물을 뿜고 크게 숨을 들이쉼 */
  surfaceBreath() {
    if (!this.ctx) return;
    this.burst(0.35, 'bandpass', 1200, 1.2, 0.14, 'gear', 0.01);
    this.burst(0.9, 'highpass', 2200, 0.6, 0.06, 'ambient', 0.02, 0.05);
    this.burst(1.2, 'bandpass', 850, 2.0, 0.08, 'gear', 0.35, 0.45);
  }
  /** 혹등고래 노래 (멀리서 들리는 낮은 울음) */
  whaleSong() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let k = 0; k < 4; k++) {
      const t = ctx.currentTime + 1 + k * 3.2 + Math.random();
      const o = ctx.createOscillator(); o.type = 'sine';
      const o2 = ctx.createOscillator(); o2.type = 'sine';
      const g = ctx.createGain(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const f0 = 140 + Math.random() * 260, f1 = f0 * (0.5 + Math.random() * 1.4);
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + 2.2);
      o2.frequency.setValueAtTime(f0 * 1.5, t); o2.frequency.exponentialRampToValueAtTime(f1 * 1.5, t + 2.2);
      const g2 = ctx.createGain(); g2.gain.value = 0.25;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.6); g.gain.linearRampToValueAtTime(0.0001, t + 2.6);
      o.connect(lp); o2.connect(g2).connect(lp); lp.connect(g).connect(this.ch.creature);
      o.start(t); o2.start(t); o.stop(t + 2.8); o2.stop(t + 2.8);
    }
  }
  /** 컬렉션 등록 알림: 흔함=짧은 두 음, 희귀=세 음 아르페지오, 전설=맑은 화음 */
  chime(tier: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const notes = tier >= 3 ? [523.3, 659.3, 784, 1046.5, 1318.5] : tier >= 2 ? [587.3, 740, 880, 1174.7] : [880, 1174.7];
    const step = tier >= 2 ? 0.11 : 0.08;
    const vol = tier >= 2 ? 0.05 : 0.025;
    notes.forEach((f, i) => {
      const t = ctx.currentTime + 0.02 + i * step;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain();
      const len = tier >= 3 ? 2.4 : tier >= 2 ? 1.6 : 0.7;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(this.ch.creature); o.start(t); o.stop(t + len + 0.05);
    });
  }
  /** 수면 통과 */
  whoosh() { if (this.ctx) this.burst(0.7, 'lowpass', 900, 0.6, 0.25, 'ambient', 0.05); }

  private pad() {
    const ctx = this.ctx!;
    for (const n of this.musicNodes) try { n.stop(); } catch { /* */ }
    this.musicNodes = [];
    const roots = [[220, 277.2, 329.6], [196, 246.9, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
    const chord = roots[Math.floor(Math.random() * roots.length)];
    const t = ctx.currentTime;
    for (const f of chord) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f / 2;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 3); g.gain.linearRampToValueAtTime(0, t + 9.5);
      o.connect(g).connect(this.ch.music); o.start(t); o.stop(t + 10);
      this.musicNodes.push(o);
    }
  }
}

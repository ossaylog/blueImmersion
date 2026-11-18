// 멀티유저: 같은 바다에 들어온 다른 다이버를 보여주고, 머리 위에 닉네임 표시
//  전송: 웹소켓 릴레이(/mp, server/relay.js) — 서버가 없으면(file:// 등) 같은 브라우저의 다른 탭끼리 BroadcastChannel
//  상태는 10Hz로 보내고, 받는 쪽은 약간 지연된 시점으로 보간해 부드럽게 움직임
//  위치는 모두 '판툰 기준 좌표'로 주고받음 → 판툰 위 의자·장비 랙·계단에서 모두가 같은 자리에 정확히 보임
import * as THREE from 'three';
import { Diver, GEAR_ORDER, type Pose, type GearSet, type Motion } from '../character/Diver';
import type { Bubbles } from '../water/Bubbles';
import { disposeTree } from '../core/math';
import { clockSample } from '../core/worldClock';
import { checkChat } from '../../server/chatFilter.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const ADJ = ['느긋한', '반짝이는', '용감한', '졸린', '호기심 많은', '수줍은', '신나는', '차분한', '날쌘', '엉뚱한', '다정한', '푸른', '산뜻한', '배고픈', '느릿느릿한', '꿈꾸는', '씩씩한', '명랑한', '수다쟁이', '노래하는', '헤엄치는', '빛나는', '말랑한', '부지런한', '장난꾸러기', '든든한', '포근한', '반가운', '조용한', '깜찍한', '용맹한', '여유로운', '산들산들', '보송보송한', '행복한', '느릿한'];
const NOUN = ['해마', '돌고래', '거북이', '흰동가리', '만타', '해파리', '문어', '고래상어', '나비고기', '가오리', '소라게', '불가사리', '앵무고기', '혹등고래', '닭새우', '가리비', '바다사자', '복어', '해달', '물범', '오징어', '꼴뚜기', '성게', '해삼', '산호', '말미잘', '곰치', '고등어', '참치', '쥐치', '도미', '전복', '소라', '꽃게', '새우', '청새치', '개복치', '바다표범', '펭귄', '갈매기'];

export function randomNick() {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  // 숫자 없이 한글로만: '형용사 + 바다 생물'
  return `${pick(ADJ)} ${pick(NOUN)}`;
}

/** 주고받는 상태 (짧은 키로 대역폭 절약) */
export interface NetState {
  m: 'snorkel' | 'scuba' | null; // 체험 종류 (장비 세트)
  w: 0 | 1;                       // 판툰 위 또는 물속이라 다른 사람에게 보여야 함 (배를 타고 오는 중엔 0)
  p: [number, number, number];    // 캐릭터 루트 위치 (판툰 로컬)
  r: [number, number, number];    // 루트 회전 (x, y, z)
  po: Pose;
  sp: number;
  mo?: Motion;                    // 킥 종류 (앞으로/백킥/헬리콥터 턴)
  ft?: number[];                  // 두 발바닥 위치 (판툰 로컬, 걷기·앉기 IK용) [Lx,Ly,Lz,Rx,Ry,Rz]
  g?: number;                     // 착용한 장비 비트마스크 (GEAR_ORDER)
  su?: 0 | 1;                     // 다이빙 슈트
  rl?: 0 | 1;                     // 손잡이 잡음
  wv?: number;                    // 손 인사 횟수 (바뀌면 받는 쪽에서 손을 흔듦)
}

/** 채팅 한 줄 */
export interface ChatMsg { id: string; nick: string; x: string; at: number; mine: boolean; hue: number }

interface Snap { at: number; s: NetState }
interface Peer {
  id: string; nick: string; snaps: Snap[]; last: number;
  diver: Diver | null; gear: GearSet; gmask: number; tag: HTMLDivElement; hue: number; bubbleT: number;
  wv: number | null; waveQ: boolean; sayT: number;
}

const SEND_HZ = 10, DELAY = 0.14, TIMEOUT = 6;
const _p = V3(), _a = V3(), _b = V3();

function hashHue(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return (h % 360) / 360; }
function lerpAngle(a: number, b: number, u: number) { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * u; }

export class Multiplayer {
  nick: string;
  id = 'local-' + Math.random().toString(36).slice(2, 8);
  peers = new Map<string, Peer>();
  online = false;
  mode: 'ws' | 'local' | 'off' = 'off';
  onPeersChanged?: () => void;
  onNotice?: (text: string) => void;
  /** 새 채팅 (history = 접속할 때 받은 최근 대화) */
  onChat?: (m: ChatMsg, history: boolean) => void;
  /** 내가 보낸 말이 거절됨 */
  onChatRefused?: (why: string) => void;
  /** 다른 사람이 손을 흔듦 (월드 위치) */
  onWave?: (nick: string, at: THREE.Vector3) => void;
  chatLog: ChatMsg[] = [];
  private mySayT = 0;
  private ws: WebSocket | null = null;
  private bc: BroadcastChannel | null = null;
  private sendT = 0;
  private retry = 1500;
  private everOpened = false;
  private clock = 0;
  private timeT = 0;
  private tagLayer: HTMLDivElement;
  private myTag: HTMLDivElement;

  /** 판툰 위 의자에 이미 다른 사람이 앉아 있는지 등 (판툰 로컬 위치 목록) */
  peerLocalPositions() { const out: THREE.Vector3[] = []; for (const p of this.peers.values()) { const s = p.snaps[p.snaps.length - 1]?.s; if (s?.w) out.push(V3(...s.p)); } return out; }

  /** 지도 표시용: 보이는 다른 다이버들 (판툰 로컬 xz) */
  peerMarks() {
    const out: { x: number; z: number; yaw: number; nick: string; hue: number; mode: string; under: boolean; upper: boolean }[] = [];
    for (const p of this.peers.values()) {
      const s = p.snaps[p.snaps.length - 1]?.s;
      if (!s?.w) continue;
      out.push({ x: s.p[0], z: s.p[2], yaw: s.r[1], nick: p.nick, hue: p.hue, mode: s.m ?? 'none', under: s.p[1] < 0, upper: s.p[1] > 3.3 });
    }
    return out;
  }

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, private bubbles: Bubbles, uiRoot: HTMLElement, private frame: THREE.Object3D) {
    let nick = '';
    try { nick = sessionStorage.getItem('bi-nick-ko') ?? ''; } catch { /* 저장소 사용 불가 */ }
    if (!nick || /[0-9]/.test(nick)) { nick = randomNick(); try { sessionStorage.setItem('bi-nick-ko', nick); } catch { /* 무시 */ } }
    this.nick = nick;
    this.tagLayer = document.createElement('div');
    this.tagLayer.id = 'tags';
    uiRoot.prepend(this.tagLayer);
    this.myTag = this.makeTag(nick, true);
    this.connect();
    addEventListener('pagehide', () => this.bc?.postMessage({ t: 'bye', id: this.id }));
  }

  private makeTag(nick: string, me = false) {
    const el = document.createElement('div');
    el.className = 'ntag' + (me ? ' me' : '');
    el.innerHTML = `<em class="say"></em><i></i><span></span>`;
    (el.querySelector('span') as HTMLElement).textContent = nick;
    this.tagLayer.appendChild(el);
    return el;
  }

  // ───────── 연결 ─────────
  private wsUrl() {
    const qs = new URLSearchParams(location.search).get('mp');
    if (qs) return qs;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/mp`;
  }

  private connect() {
    const url = this.wsUrl();
    if (!url) { this.useLocal(); return; }
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { this.useLocal(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.everOpened = true; this.retry = 1500;
      this.closeLocal();
      ws.send(JSON.stringify({ t: 'hello', nick: this.nick }));
      // 서버 시계와 맞추기: 처음엔 빠르게 몇 번, 이후 20초마다 (생물이 모두에게 같은 시각·위치에 보이도록)
      let n = 0;
      const ping = () => { if (this.ws === ws && ws.readyState === 1) { ws.send(JSON.stringify({ t: 'time', c: Date.now() })); n++; this.timeT = window.setTimeout(ping, n < 5 ? 400 : 20000); } };
      clearTimeout(this.timeT); ping();
    };
    ws.onmessage = (e) => { try { this.onMsg(JSON.parse(String(e.data))); } catch { /* 잘못된 메시지 무시 */ } };
    ws.onclose = () => {
      const was = this.online;
      this.online = false; this.ws = null;
      for (const id of [...this.peers.keys()]) this.removePeer(id, true);
      if (was) this.onNotice?.('멀티 서버 연결이 끊겼어요 · 다시 연결하는 중');
      if (!this.everOpened) this.useLocal(); // 서버가 없으면 같은 브라우저 탭끼리라도
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 1.6, 15000);
      this.onPeersChanged?.();
    };
  }

  private useLocal() {
    if (this.bc || typeof BroadcastChannel === 'undefined') { if (!this.bc) this.mode = 'off'; return; }
    this.bc = new BroadcastChannel('blue-immersion-mp');
    this.bc.onmessage = (e) => {
      const m = e.data;
      if (!m || m.id === this.id) return;
      if (m.t === 'bye') { this.removePeer(m.id); return; }
      if (m.t === 'chat') { const r = checkChat(m.x); if (r.ok) this.addChat(m.id, m.nick, r.text, m.at); return; }
      if (m.t === 'state') {
        if (!this.peers.has(m.id)) { this.addPeer(m.id, m.nick); this.onNotice?.(`${m.nick} 님이 접속했어요`); }
        this.pushState(m.id, m.s);
      }
    };
    this.mode = 'local';
    this.onPeersChanged?.();
  }
  private closeLocal() { if (this.bc) { this.bc.postMessage({ t: 'bye', id: this.id }); this.bc.close(); this.bc = null; } }

  private onMsg(m: { t: string; id?: string; nick?: string; s?: NetState | number; c?: number; peers?: { id: string; nick: string; s: NetState | null }[]; chat?: { id: string; nick: string; x: string; at: number }[]; x?: unknown; at?: number; why?: string }) {
    if (m.t === 'time') { if (typeof m.c === 'number' && typeof m.s === 'number') clockSample(m.c, m.s); return; }
    if (m.t === 'welcome') {
      this.online = true; this.mode = 'ws';
      if (m.id) this.id = m.id;
      if (m.nick && m.nick !== this.nick) { this.nick = m.nick; (this.myTag.querySelector('span') as HTMLElement).textContent = m.nick; }
      for (const p of m.peers ?? []) { this.addPeer(p.id, p.nick); if (p.s) this.pushState(p.id, p.s); }
      // 접속 전 최근 대화 (다시 연결된 경우 이미 받은 것은 건너뜀)
      const seen = new Set(this.chatLog.map((c) => `${c.at}|${c.x}`));
      for (const c of (m.chat ?? [])) if (!seen.has(`${c.at}|${c.x}`)) this.addChat(c.id, c.nick, c.x, c.at, true);
      this.onPeersChanged?.();
    } else if (m.t === 'join' && m.id) {
      this.addPeer(m.id, m.nick ?? '다이버');
      this.onNotice?.(`${m.nick} 님이 접속했어요`);
    } else if (m.t === 'state' && m.id && m.s && typeof m.s === 'object') {
      if (!this.peers.has(m.id)) this.addPeer(m.id, '다이버');
      this.pushState(m.id, m.s);
    } else if (m.t === 'leave' && m.id) this.removePeer(m.id);
    else if (m.t === 'chat' && m.id && typeof m.x === 'string') this.addChat(m.id, m.nick ?? '다이버', m.x, m.at ?? Date.now());
    else if (m.t === 'chatNo') this.onChatRefused?.(String(m.why ?? 'bad'));
  }

  // ───────── 채팅 ─────────
  /** 보내기 전 같은 필터로 미리 확인 → 거절 사유를 바로 안내 (최종 판정은 서버) */
  sendChat(raw: string): boolean {
    const r = checkChat(raw);
    if (!r.ok) { this.onChatRefused?.(r.why); return false; }
    if (this.ws && this.online && this.ws.readyState === 1) { this.ws.send(JSON.stringify({ t: 'chat', x: r.text })); return true; }
    // 서버 없음: 같은 브라우저의 다른 탭끼리 (또는 혼자)
    const at = Date.now();
    this.bc?.postMessage({ t: 'chat', id: this.id, nick: this.nick, x: r.text, at });
    this.addChat(this.id, this.nick, r.text, at);
    return true;
  }
  private addChat(id: string, nick: string, x: string, at: number, history = false) {
    const mine = id === this.id;
    const peer = this.peers.get(id);
    const c: ChatMsg = { id, nick, x, at, mine, hue: peer?.hue ?? hashHue(id + nick) };
    this.chatLog.push(c);
    if (this.chatLog.length > 120) this.chatLog.shift();
    // 머리 위 말풍선 (최근 접속 전 대화는 띄우지 않음)
    if (!history) {
      const tag = mine ? this.myTag : peer?.tag;
      if (tag) { (tag.querySelector('.say') as HTMLElement).textContent = x; tag.classList.add('saying'); }
      if (mine) this.mySayT = 6; else if (peer) peer.sayT = 6;
    }
    this.onChat?.(c, history);
  }

  private addPeer(id: string, nick: string) {
    if (this.peers.has(id)) return;
    this.peers.set(id, { id, nick, snaps: [], last: this.clock, diver: null, gear: 'none', gmask: 0, tag: this.makeTag(nick), hue: hashHue(id + nick), bubbleT: Math.random() * 4, wv: null, waveQ: false, sayT: 0 });
    this.onPeersChanged?.();
  }

  private removePeer(id: string, silent = false) {
    const p = this.peers.get(id);
    if (!p) return;
    if (p.diver) disposeTree(p.diver.root);
    p.tag.remove();
    this.peers.delete(id);
    if (!silent) { this.onNotice?.(`${p.nick} 님이 나갔어요`); this.onPeersChanged?.(); }
  }

  private pushState(id: string, s: NetState) {
    const p = this.peers.get(id);
    if (!p || !s || !Array.isArray(s.p)) return;
    p.last = this.clock;
    // 손 인사: 처음 받은 값은 기준으로만 (접속 직후 예전 인사를 다시 재생하지 않게)
    const wv = typeof s.wv === 'number' ? s.wv : 0;
    if (p.wv === null) p.wv = wv; else if (wv !== p.wv) { p.wv = wv; p.waveQ = true; }
    p.snaps.push({ at: this.clock, s });
    if (p.snaps.length > 12) p.snaps.shift();
  }

  // ───────── 매 프레임 ─────────
  update(dt: number, t: number, local: NetState) {
    this.clock += dt;
    // 말풍선 시간
    if (this.mySayT > 0 && (this.mySayT -= dt) <= 0) this.myTag.classList.remove('saying');
    for (const p of this.peers.values()) if (p.sayT > 0 && (p.sayT -= dt) <= 0) p.tag.classList.remove('saying');
    // 보내기 (10Hz)
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / SEND_HZ;
      const s: NetState = { ...local, p: local.p.map((v) => Math.round(v * 100) / 100) as NetState['p'], r: local.r.map((v) => Math.round(v * 1000) / 1000) as NetState['r'], sp: Math.round(local.sp * 100) / 100 };
      if (local.ft) s.ft = local.ft.map((v) => Math.round(v * 100) / 100);
      if (this.ws && this.online && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'state', s }));
      else if (this.bc) this.bc.postMessage({ t: 'state', id: this.id, nick: this.nick, s });
    }
    // 원격 다이버
    for (const p of [...this.peers.values()]) {
      if (this.clock - p.last > TIMEOUT && this.mode === 'local') { this.removePeer(p.id); continue; }
      this.updatePeer(p, dt, t);
    }
  }

  private updatePeer(p: Peer, dt: number, t: number) {
    const snaps = p.snaps;
    if (!snaps.length) return;
    const latest = snaps[snaps.length - 1].s;
    const want: GearSet = latest.m ?? 'none';
    if (!latest.w) { if (p.diver) p.diver.root.visible = false; return; }
    if (!p.diver) {
      p.diver = new Diver(this.scene);
      // 사람마다 래시가드·슈트 포인트 색을 다르게 → 멀리서도 구분
      p.diver.mats.rashAccent.color.setHSL(p.hue, 0.65, 0.5);
      p.diver.mats.suitAccent.color.setHSL(p.hue, 0.7, 0.48);
      p.diver.mats.rash.color.setHSL(p.hue, 0.45, 0.22);
    }
    const d = p.diver;
    if (p.gear !== want) { this.equip(d, want, 0); p.gear = want; p.gmask = 0; }
    // 장비는 하나씩 착용하는 모습 그대로 (판툰에서 장비를 입는 다른 사람이 보임)
    const gm = latest.g ?? (want === 'none' ? 0 : (1 << GEAR_ORDER.length) - 1);
    if (gm !== p.gmask) { this.equip(d, want, gm, p.gmask); p.gmask = gm; }
    d.setSuit(latest.su !== undefined ? latest.su === 1 : want === 'scuba');
    d.root.visible = true;
    // 보간: DELAY 만큼 과거 시점을 두 스냅샷 사이에서 계산
    const rt = this.clock - DELAY;
    let a = snaps[0], b = snaps[snaps.length - 1];
    for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].at <= rt && snaps[i + 1].at >= rt) { a = snaps[i]; b = snaps[i + 1]; break; }
    const u = b.at > a.at ? THREE.MathUtils.clamp((rt - a.at) / (b.at - a.at), 0, 1) : 1;
    _a.fromArray(a.s.p); _b.fromArray(b.s.p);
    _p.lerpVectors(_a, _b, u);
    // 순간이동(입수·복귀 등)은 보간하지 않음
    if (_a.distanceTo(_b) > 6) _p.copy(_b);
    _p.applyMatrix4(this.frame.matrixWorld);
    d.root.position.copy(_p);
    // 발 디딤 (걷기·계단·앉기): 판툰 로컬 → 월드
    const fa = a.s.ft, fb = b.s.ft;
    if (fb && fb.length === 6) {
      const fu = fa && fa.length === 6 ? u : 1;
      const src = fa && fa.length === 6 ? fa : fb;
      const feet: [THREE.Vector3, THREE.Vector3] = d.feetW ?? [V3(), V3()];
      for (let k = 0; k < 2; k++) feet[k].set(src[k * 3] + (fb[k * 3] - src[k * 3]) * fu, src[k * 3 + 1] + (fb[k * 3 + 1] - src[k * 3 + 1]) * fu, src[k * 3 + 2] + (fb[k * 3 + 2] - src[k * 3 + 2]) * fu).applyMatrix4(this.frame.matrixWorld);
      d.feetW = feet;
    } else d.feetW = null;
    d.rail = b.s.rl === 1;
    d.root.rotation.order = 'YXZ';
    d.root.rotation.set(lerpAngle(a.s.r[0], b.s.r[0], u), lerpAngle(a.s.r[1], b.s.r[1], u), lerpAngle(a.s.r[2], b.s.r[2], u));
    d.pose = b.s.po; d.motion = b.s.mo ?? 'fwd'; d.speed = THREE.MathUtils.lerp(a.s.sp, b.s.sp, u);
    if (p.waveQ) { p.waveQ = false; d.startWave(); this.onWave?.(p.nick, d.root.position); }
    d.update(dt, t);
    // 스쿠버 다이버는 레귤레이터 기포를 주기적으로 내뿜음 (서로 위치를 알아보기 쉽게)
    if (want === 'scuba' && d.root.position.y < -0.8) {
      p.bubbleT -= dt;
      if (p.bubbleT <= 0) { p.bubbleT = 4.2 + Math.random() * 1.2; this.bubbles.burst(d.bubbleOrigin.getWorldPosition(V3()), 14, 0.06); }
    }
  }

  /** mask: 착용할 장비 비트, prev: 이미 착용 중인 비트 (새로 생긴 장비만 붙는 연출) */
  private equip(d: Diver, set: GearSet, mask: number, prev = 0) {
    if (d.gearSet !== set) { d.clearGear(); d.gearSet = set; prev = 0; }
    GEAR_ORDER.forEach((n, i) => {
      const on = (mask >> i) & 1, was = (prev >> i) & 1;
      if (on && !d.hasGear(n)) d.attach(n);
      else if (!on && was) d.detach(n);
    });
    if (set === 'none') d.clearGear();
  }

  /** 닉네임 태그를 머리 위에 투영 (카메라 갱신 후 호출) */
  updateTags(localHead: THREE.Vector3 | null, showMine: boolean) {
    const cam = this.camera as THREE.PerspectiveCamera;
    const W = innerWidth, H = innerHeight;
    const place = (el: HTMLDivElement, head: THREE.Vector3 | null, visible: boolean) => {
      if (!visible || !head) { el.style.opacity = '0'; return; }
      _p.copy(head).add(_a.set(0, 0.42, 0));
      const dist = _p.distanceTo(cam.position);
      _p.project(cam);
      if (_p.z > 1 || _p.z < -1 || Math.abs(_p.x) > 1.2 || Math.abs(_p.y) > 1.2 || dist > 45) { el.style.opacity = '0'; return; }
      const x = (_p.x * 0.5 + 0.5) * W, y = (-_p.y * 0.5 + 0.5) * H;
      const k = THREE.MathUtils.clamp(1.15 - dist / 40, 0.6, 1);
      el.style.opacity = String(1 - THREE.MathUtils.smoothstep(dist, 22, 45));
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${k.toFixed(3)})`;
    };
    place(this.myTag, localHead, showMine);
    for (const p of this.peers.values()) {
      const d = p.diver;
      const vis = !!d && d.root.visible;
      p.tag.dataset.mode = p.gear;
      place(p.tag, vis ? d!.headWorld(_b) : null, vis);
    }
  }

  /** 가장 가까이 보이는 다른 다이버 (월드 좌표 기준) */
  nearest(at: THREE.Vector3): { nick: string; dist: number; pos: THREE.Vector3 } | null {
    let best: { nick: string; dist: number; pos: THREE.Vector3 } | null = null;
    for (const p of this.peers.values()) {
      const d = p.diver;
      if (!d || !d.root.visible) continue;
      const dist = d.root.position.distanceTo(at);
      if (!best || dist < best.dist) best = { nick: p.nick, dist, pos: d.root.position };
    }
    return best;
  }

  /** 지금 함께 있는 사람 수 (나 포함) */
  get count() { return this.peers.size + 1; }
}

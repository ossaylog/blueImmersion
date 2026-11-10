// 전체 체험 흐름 오케스트레이션 (상태머신 + 연출)
import * as THREE from 'three';
import { Engine } from './core/Engine';
import { detectQuality, type Quality } from './core/quality';
import { store, type Mode, type View } from './core/store';
import { clamp, damp, dampAngle } from './core/math';
import { waterUniforms } from './water/WaterShading';
import { OceanSurface, waveHeight } from './water/OceanSurface';
import { Sky } from './water/Sky';
import { Horizon } from './water/Horizon';
import { LightShafts } from './water/LightShafts';
import { Particles } from './water/Particles';
import { Bubbles } from './water/Bubbles';
import { buildSeabed } from './world/Seabed';
import { CoralReef } from './world/CoralReef';
import { Residents } from './world/Residents';
import { Boat } from './world/Boat';
import {
  Pontoon, MD, UD, SP, SNORKEL_SPOTS, SCUBA_SPOTS, SNORKEL_LANES, SCUBA_LANES, HINGE, MAIN_LANE,
  routeSnorkelEntry, routeScubaEntry, snorkelSeat, snorkelFloat, scubaEntry, type Spot,
} from './world/Pontoon';
import { DeckMover, loungerSide, loungerLie, type Lounger, type ZoneId } from './world/Deck';
import { MapView, type MapState } from './ui/MapView';
import { Walker, type WayPt } from './world/Walker';
import { FishSystem } from './life/FishSystem';
import { SpawnDirector } from './life/SpawnDirector';
import { Benthic, BENTHIC_SPECIES } from './life/Benthic';
import { Collection } from './life/Collection';
import { RESIDENT_SPECIES, tierOf } from './data/codex';
import type { SpeciesDef, DiverInfo, Creature } from './life/types';
import speciesData from './data/species.json';
import { Diver, type Pose } from './character/Diver';
import { Input } from './control/Input';
import { CameraRig } from './control/CameraRig';
import { SnorkelController, ScubaController, colliders } from './control/Controllers';
import { DiveComputer } from './dive/DiveComputer';
import { AudioEngine } from './audio/Audio';
import { UI } from './ui/UI';
import { Multiplayer, type NetState } from './net/Multiplayer';
import { worldNow } from './core/worldClock';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const LEG = 0.93;           // 발바닥 → 골반 높이
const START_Z = -235;       // 출발 지점 (깊은 바다)
const BERTH = V3(-9.6, 0, -7.7); // 판툰 좌현 계류 위치 (배 중심)
type Act = (dt: number) => boolean; // true를 돌려주면 다음 동작으로
const CRUISE_T = 24;
const tick = () => new Promise((r) => setTimeout(r, 0));
const ease = (u: number) => u * u * (3 - 2 * u);

export class App {
  q: Quality = detectQuality();
  engine: Engine; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  input: Input; ui: UI; audio = new AudioEngine(); rig: CameraRig;
  sky!: Sky; horizon!: Horizon; surface!: OceanSurface; shafts!: LightShafts; particles!: Particles; bubbles!: Bubbles;
  reef!: CoralReef; residents!: Residents; benthic!: Benthic; fish!: FishSystem; director!: SpawnDirector;
  boat!: Boat; pontoon!: Pontoon; diver!: Diver; net!: Multiplayer; collection!: Collection;
  snorkel = new SnorkelController(); scuba = new ScubaController(); computer = new DiveComputer();
  hemi!: THREE.HemisphereLight; sun!: THREE.DirectionalLight;
  species = (speciesData as unknown as { species: SpeciesDef[] }).species;
  info: DiverInfo = { pos: V3(), vel: V3(), forward: V3(0, 0, 1), idleTime: 0, active: false, fp: false };

  private t = 0; private phaseT = 0; private cruiseU = 0;
  private camLocal = V3(); private lookLocal = V3();
  private camTarget = V3(); private lookTarget = V3();
  private gearSteps: { label: string; dur: number; act: () => void }[] = [];
  private gearIdx = 0;
  private gearDone = false;
  /** 판툰 위 캐릭터 동작 큐 (걷기 → 앉기 → …) */
  private acts: Act[] = [];
  /** 판툰 위 자유 이동 */
  private deck = new DeckMover();
  private lying: Lounger | null = null;
  private lieState: 'none' | 'going' | 'lying' | 'rising' = 'none';
  private zoneSeen: ZoneId | null = null;
  private zoneDismissed = new Set<ZoneId>();
  map!: MapView;
  private spot: Spot = SNORKEL_SPOTS[0];
  private lane = 0;
  private atGear = false;
  private seenStairs = false;
  private onPontoon = false;
  private gangwayClank = false;
  private feetW: [THREE.Vector3, THREE.Vector3] = [V3(), V3()];
  private tmpL = V3();
  /** driveCam 기준 좌표계 (배 / 판툰) */
  private camFrame: THREE.Object3D | null = null;
  private entryCam: 'follow' | 'front' | 'stride' | 'float' | 'under' | 'boat' = 'follow';
  private entryLook = 0.25;
  private wasUnder = false;
  private swishT = 0;
  private lastSnorkDiving = false;
  private surfacedHinted = false;
  /** 머리를 물 밖으로 내민 상태 (스쿠버: 수면 부상 / 스노클: 고개 들기) */
  private surfacedNow = false;
  private headUpHinted = false;

  constructor() {
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    this.engine = new Engine(canvas, this.q);
    this.engine.onContextLost = () => this.ui?.hint('그래픽 메모리가 부족해 화면을 다시 준비하고 있어요…', true, 8);
    // 복구된 컨텍스트에서는 셰이더·버퍼를 다시 만들어야 해 안전하게 새로고침 (컬렉션은 저장되어 있음)
    this.engine.onContextRestored = () => location.reload();
    this.scene = this.engine.scene; this.camera = this.engine.camera;
    this.input = new Input(canvas);
    this.rig = new CameraRig(this.camera);
    this.ui = new UI(document.getElementById('ui')!, {
      board: () => this.board(), skip: () => { this.cruiseU = Math.max(this.cruiseU, 0.999); },
      select: (m, v) => this.select(m, v),
      dismissZone: () => { if (this.ui.zone) this.zoneDismissed.add(this.ui.zone); this.ui.showZone(null); },
      returnToBoat: () => this.returnToBoat(), toggleView: () => this.toggleView(),
      toggleMap: () => this.toggleMap(),
    }, this.q.isTouch, this.input);
    store.subscribe((s, p) => { if (s.audio !== p.audio || s.muted !== p.muted) this.audio.applySettings(s.audio, s.muted); });
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'KeyV' && !e.repeat) this.toggleView();
      if (e.code === 'KeyM' && !e.repeat) this.toggleMap();
      if (e.code === 'Escape') { if (this.map?.isOpen) this.map.close(); else if (this.ui.codexOpen) this.ui.closeCodex(); else store.set({ settingsOpen: !store.get().settingsOpen }); }
    });
  }

  async init() {
    const sc = this.scene;
    const L = (p: number) => this.ui.setLoading(p);
    this.hemi = new THREE.HemisphereLight(0x9cc8ff, 0x3a4a48, 0.9);
    this.sun = new THREE.DirectionalLight(0xfff3e0, 3.0);
    this.sun.position.copy(waterUniforms.uSunDir.value).multiplyScalar(100);
    sc.add(this.hemi, this.sun);
    this.sky = new Sky(sc);
    this.horizon = new Horizon(sc);
    this.surface = new OceanSurface(sc, this.q.surfaceSegments); L(0.15); await tick();
    this.shafts = new LightShafts(sc, this.q.shafts);
    this.particles = new Particles(sc, this.q.particles, this.q.pixelRatio);
    this.bubbles = new Bubbles(sc);
    buildSeabed(sc, this.q.terrainSegments); L(0.35); await tick();
    this.reef = new CoralReef(sc, this.q.coralDensity); L(0.7); await tick();
    this.fish = new FishSystem(sc, this.reef, this.species, this.q.fishScale);
    this.residents = new Residents(sc, this.reef, this.fish, this.species, this.q.tier === 'low'); L(0.85); await tick();
    this.benthic = new Benthic(sc, this.q.tier === 'low');
    this.director = new SpawnDirector(sc, this.camera, this.fish, this.species, this.q.tier === 'low');
    // 바다 생물 컬렉션: 회유 생물 + 바닥 생물 + 정주 생물 전부
    this.collection = new Collection([...this.species, ...BENTHIC_SPECIES, ...Object.values(RESIDENT_SPECIES)]);
    this.ui.setCollection(this.collection);
    this.director.isCollected = (id) => this.collection.has(id);
    // 정주 생물(말미잘·흰동가리·대왕조개·성게 등)도 화면에 담기면 발견으로 기록
    const clown = this.species.find((s) => s.id === 'clownfish');
    const residentSp: Record<string, SpeciesDef> = { ...RESIDENT_SPECIES, ...(clown ? { clownfish: { ...clown, sizeClass: 'small', seeDist: 4 } as SpeciesDef } : {}) };
    const spots: Creature[] = this.residents.spots.filter((p) => residentSp[p.id]).map((p) => ({
      sp: residentSp[p.id], alive: true, leaving: false, life: 1e9, encountered: false, center: () => p.pos, leave: () => {},
    }));
    this.director.extra = [...this.benthic.creatures, ...spots];
    // 생물 이름은 실제로 화면에 보이는 동안만 표시 (보이기 시작할 때 표시 → 시야에서 사라지면 숨김)
    this.director.onEncounter = (sp, c) => {
      const tier = tierOf(sp.id);
      const isNew = this.collection.record(sp, Math.max(0, -this.camera.position.y));
      this.ui.toast(sp.nameKo, `${sp.nameEn} · ${sp.sci}`, tier, isNew);
      const needPhoto = isNew || !this.collection.photos[sp.id];
      if (needPhoto) {
        // 지금 내 시야에서 그 생물을 찍어 컬렉션 사진으로 보관
        this.capturePhoto(c, (url) => {
          if (url) this.collection.setPhoto(sp.id, url);
          if (isNew && tier >= 2) this.ui.discover(sp, url);
        });
      }
      if (isNew) {
        this.ui.updateCodexCount();
        this.audio.chime(tier >= 2 ? tier : 0);
      }
    };
    this.director.onRareSpawn = (sp, tier) => {
      if (tier === 3 && sp.id !== 'humpback' && store.get().phase === 'swim') this.ui.hint('푸른 물 너머로 커다란 그림자가 스친 것 같아요…', false, 5);
    };
    this.director.onEncounterEnd = () => this.ui.hideToast();
    this.director.onSpawn = (sp) => { if (sp.id === 'humpback') this.audio.whaleSong(); };
    this.boat = new Boat(sc);
    this.boat.root.position.set(BERTH.x, 0, START_Z);
    this.pontoon = new Pontoon(sc);
    colliders.push((p, r) => this.pontoon.collide(p, r), (p, r) => store.get().phase === 'swim' && this.boat.collide(p, r));
    this.diver = new Diver(sc);
    this.map = new MapView(document.getElementById('hud')!, document.getElementById('ui')!);
    // 멀티유저: 같은 서버(또는 같은 브라우저의 다른 탭)에 접속한 다이버들을 함께 표시 (판툰 기준 좌표로 공유)
    this.net = new Multiplayer(sc, this.camera, this.bubbles, document.getElementById('ui')!, this.pontoon.root);
    this.net.onPeersChanged = () => this.ui.setOnline(this.net.count, this.net.nick, this.net.mode);
    this.net.onNotice = (text) => this.ui.mpNotice(text);
    this.ui.setOnline(this.net.count, this.net.nick, this.net.mode);
    this.scuba.onInhale = () => this.audio.inhale(this.scuba.depth);
    this.scuba.onExhale = () => { this.audio.exhale(); this.emitExhale(); };
    this.snorkel.onBreath = (inh) => this.audio.snorkelBreath(inh);
    this.scuba.onSurface = (up) => this.setSurfaced(up, 'scuba');
    this.snorkel.onHeadUp = (up) => this.setSurfaced(up, 'snorkel');
    this.snorkel.onNeedAir = (why) => this.ui.hint(why === 'depth' ? '스노클링은 5m까지예요 · 숨 쉬러 수면으로 올라가요' : '숨이 차요 · 수면으로 올라가 숨을 쉬어요', true, 3.5);
    this.snorkel.onSurfaceBreath = () => {
      this.audio.surfaceBreath();
      this.bubbles.burst(this.diver.headWorld(V3()).add(V3(0, 0.15, 0)), 10, 0.1);
    };
    L(1);
    // 셰이더 미리 컴파일 (첫 입수 때 끊김 방지)
    this.camera.position.set(0, -3, 0); this.camera.lookAt(5, -4, 5);
    this.engine.renderer.compile(sc, this.camera);
    this.engine.onFrame = (dt, t) => this.frame(dt, t);
    this.engine.start();
    (window as unknown as { app: App }).app = this;
    setTimeout(() => store.set({ phase: 'title' }), 300);
    // URL 파라미터로 단계 바로가기 (개발·검수용): ?go=snorkel | scuba | deck | dock  &view=fp
    const qs = new URLSearchParams(location.search);
    const go = qs.get('go');
    if (qs.get('view') === 'fp') store.set({ view: 'first' });
    if (go === 'snorkel' || go === 'scuba') setTimeout(() => this.debugJump(go), 400);
    if (go === 'deck') setTimeout(() => { this.dockBoat(); this.camera.position.set(-2, 4, -9); this.enterDeck(V3(0.9, MD, MAIN_LANE), Math.PI / 2); }, 400);
    if (go === 'dock') setTimeout(() => { this.board(); this.cruiseU = 0.999; store.set({ phase: 'cruise' }); }, 400);
  }

  // ───────── 흐름 ─────────
  //  항구 → 셔틀 보트 항해 → 리프 판툰에 계류 → 현문 사다리 → 판툰 위를 자유롭게 (1층 카페·2층 선베드)
  //  → 스노클 존 / 다이빙 데크에 들어서면 시점 선택 → 장비 랙·벤치에서 착용 → 입수 계단·플랫폼에서 입수
  board() {
    this.audio.start();
    this.audio.applySettings(store.get().audio, store.get().muted);
    this.audio.setScene('cruise');
    this.camFrame = this.boat.root;
    store.set({ phase: 'boarding' });
    this.phaseT = 0;
  }

  toggleMap() {
    const ph = store.get().phase;
    if (ph === 'loading' || ph === 'title') return;
    this.map.toggle();
  }

  /** 체험 존에서 시점을 고르면: 장비 랙·벤치로 가서 착용 → 끝나면 바로 입수 */
  select(mode: 'snorkel' | 'scuba', view: View) {
    if (store.get().phase !== 'anchored' || this.acts.length || this.lieState !== 'none') return;
    this.ui.showZone(null);
    store.set({ mode, phase: 'gearing', view });
    this.diver.root.visible = true;
    this.setFov(false);
    this.diver.clearGear();
    this.diver.gearSet = mode;
    this.gearIdx = -1; this.phaseT = 0; this.gearDone = false; this.atGear = false;
    const d = this.diver;
    // 오리발은 걸어 다닐 때 신지 않음 → 입수 지점(계단·플랫폼)에서 신음
    this.gearSteps = mode === 'snorkel'
      ? [
        { label: '기본 수영복', dur: 0.6, act: () => {} },
        { label: '스노클 마스크 착용', dur: 1.1, act: () => d.attach('mask') },
        { label: '스노클 튜브 장착', dur: 1.0, act: () => d.attach('snorkel') },
        { label: '착용 완료 · 오리발은 입수 계단에 앉아서', dur: 0.5, act: () => {} },
      ]
      : [
        { label: '기본 수영복', dur: 0.6, act: () => {} },
        { label: '다이빙 슈트 착용', dur: 2.4, act: () => d.setSuit(true) },
        { label: '다이빙 마스크 착용', dur: 1.0, act: () => d.attach('mask') },
        { label: 'BCD · 공기통 장착', dur: 1.7, act: () => { d.attach('bcd'); setTimeout(() => d.attach('tank'), 450); } },
        { label: '레귤레이터 연결', dur: 1.2, act: () => { d.attach('hose'); d.attach('regulator'); } },
        { label: '웨이트 시스템', dur: 0.9, act: () => d.attach('weights') },
        { label: '다이빙 컴퓨터', dur: 0.8, act: () => d.attach('computer') },
        { label: '착용 완료 · 오리발은 다이빙 플랫폼에서', dur: 0.5, act: () => {} },
      ];
    this.ui.setGearSteps(mode === 'snorkel' ? '스노클링 장비' : '스쿠버다이빙 장비', this.gearSteps.map((s) => s.label), 0);
    // 지금 서 있는 곳에서 장비 랙(스노클) / 다이빙 벤치(스쿠버)로 걸어감
    const P = this.pontoon.root;
    this.spot = this.pickFree(mode === 'snorkel' ? SNORKEL_SPOTS : SCUBA_SPOTS, (s) => s.p);
    const cur = this.deck.pos.clone().setY(MD);
    const route = mode === 'snorkel'
      ? [cur, this.spot.p.clone()]
      : [cur, V3(clamp(cur.x, -3.3, 3.3), MD, clamp(cur.z, -14, -7.6)), V3(-3.3, MD, this.spot.p.z), this.spot.p.clone()];
    this.entryCam = 'follow';
    this.acts = [
      this.walkAct(this.wp(P, route), 1, 'follow'),
      this.call(() => { this.atGear = true; this.phaseT = 0; this.camFromCurrent(P); }),
      this.gearHoldAct(this.spot),
    ];
    this.ui.hint(mode === 'snorkel' ? '스노클 장비 랙에서 마스크와 스노클을 써요' : '다이빙 벤치에서 슈트와 장비를 메요', false, 3);
  }

  startEntry() {
    const mode = store.get().mode!;
    // 혹시 남은 착용 단계가 있으면 즉시 완료
    while (this.gearIdx < this.gearSteps.length - 1) { this.gearIdx++; this.gearSteps[this.gearIdx].act(); }
    if (mode === 'scuba') this.diver.setSuit(true, true);
    store.set({ phase: 'entry' });
    this.phaseT = 0;
    this.diver.root.visible = true;
    this.entryCam = 'follow'; this.entryLook = 0.25; this.seenStairs = false;
    if (this.fp) this.diver.root.visible = false;
    const P = this.pontoon.root;
    if (mode === 'snorkel') {
      const lz = this.lane = this.pickFree(SNORKEL_LANES, (z) => V3(8.9, MD, z));
      const seat = snorkelSeat(lz);
      this.acts = [
        this.walkAct(this.wp(P, routeSnorkelEntry(this.spot, lz)), 0.9, 'entry'),
        this.sitAct(seat.root, seat.feet, Math.PI / 2, 1.3, 0.12),
        this.call(() => this.ui.hint('물에 잠긴 계단에 앉아 오리발을 신어요', false, 3)),
        this.finsSitAct(seat.root, seat.feet),
        this.pushOffAct(lz),
      ];
    } else {
      const lx = this.lane = this.pickFree(SCUBA_LANES, (x) => V3(x, MD, -17.75));
      this.acts = [
        this.walkAct(this.wp(P, routeScubaEntry(this.spot, lx)), 0.9, 'entry'),
        this.call(() => this.ui.hint('난간을 잡고 한 발씩 오리발을 신어요', false, 3)),
        this.finsStandAct(V3(lx, SP, -17.75), Math.PI),
        this.strideAct(lx),
      ];
    }
  }

  returnToBoat() {
    if (store.get().phase !== 'swim') return;
    store.set({ phase: 'exiting' });
    this.ui.fade(true);
    setTimeout(() => {
      this.director.clear();
      this.diver.clearGear();
      this.diver.root.visible = true;
      this.computer.reset();
      this.info.active = false;
      this.audio.setScene('air');
      this.engine.postU.uMask.value = 0;
      this.setFov(false);
      // 판툰으로 올라와 존 바로 옆에 섬 (다시 자유롭게 돌아다님)
      const wasSnorkel = store.get().mode === 'snorkel';
      this.surfacedHinted = false;
      this.surfacedNow = false; this.rig.surfaceMode = false;
      this.scuba.surfaced = false; this.snorkel.headUp = false;
      this.enterDeck(wasSnorkel ? V3(3.2, MD, 1.5) : V3(0.4, MD, -5.9), wasSnorkel ? -Math.PI / 2 : 0);
      this.engine.postU.uWet.value = 0;
      setTimeout(() => this.ui.fade(false), 200);
    }, 1000);
  }

  // ───────── 판툰 위 동작 (걷기·앉기·장비) ─────────
  private wp(frame: THREE.Object3D, pts: THREE.Vector3[]): WayPt[] { return pts.map((p) => ({ frame, p })); }
  private call(fn: () => void): Act { return () => { fn(); return true; }; }
  private runActs(dt: number) {
    let guard = 0;
    while (this.acts.length && guard++ < 8) {
      if (!this.acts[0](dt)) break;
      this.acts.shift(); dt = 0;
    }
  }
  /** 이미 다른 사람이 있는 자리는 피해서 고름 */
  private pickFree<T>(items: T[], posOf: (x: T) => THREE.Vector3): T {
    const others = this.net ? this.net.peerLocalPositions() : [];
    const free = items.filter((it) => { const p = posOf(it); return others.every((o) => Math.hypot(o.x - p.x, o.z - p.z) > 0.75); });
    const pool = free.length ? free : items;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  /** 두 발을 중심점 좌우로 (캐릭터 hipL 쪽 = 로컬 -x 가 feet[0]) */
  private feetAround(c: THREE.Vector3, yaw: number, w = 0.1, out: [THREE.Vector3, THREE.Vector3] = [V3(), V3()]) {
    const lx = Math.cos(yaw), lz = -Math.sin(yaw);
    out[0].set(c.x - lx * w, c.y, c.z - lz * w);
    out[1].set(c.x + lx * w, c.y, c.z + lz * w);
    return out;
  }
  /** 발자국 걷기: 경로 점은 배·판툰 좌표계에 붙어 있어 흔들려도 발이 미끄러지지 않음 */
  private walkAct(pts: WayPt[], speed = 1, cam: 'follow' | 'entry' = 'follow', onSeg?: (seg: number) => void): Act {
    let w: Walker | null = null;
    return (dt) => {
      if (!w) { w = new Walker(pts, this.diver.root.rotation.y); w.speed = speed; }
      w.update(dt);
      const d = this.diver;
      d.root.position.copy(w.pos); d.root.rotation.set(0, w.yaw, 0);
      d.pose = 'steps'; d.feetW = w.feet; d.rail = w.onStairs; d.lean = 0;
      d.lookDown = damp(d.lookDown, w.onStairs ? 1 : 0, 4, dt);
      if (w.onStairs) this.seenStairs = true;
      this.entryCam = cam === 'entry' && this.seenStairs ? 'front' : 'follow';
      this.entryLook = w.onStairs ? 0.65 : 0.25;
      onSeg?.(w.seg);
      return w.done;
    };
  }

  /** 앉기·일어서기: 발은 바닥에 둔 채 엉덩이를 뒤로 빼며 내려앉음 (다리는 IK로 자연스럽게 굽음) */
  private sitAct(rootL: THREE.Vector3, feetL: THREE.Vector3, yaw: number, dur: number, endLean = 0.05, pose: Pose = 'sit'): Act {
    let t = -1;
    const r0 = V3(), f0: THREE.Vector3[] = [V3(), V3()], fT: THREE.Vector3[] = [V3(), V3()];
    const P = this.pontoon.root, d = this.diver;
    return (dt) => {
      if (t < 0) {
        t = 0;
        P.worldToLocal(r0.copy(d.root.position));
        for (let k = 0; k < 2; k++) { if (d.feetW) P.worldToLocal(f0[k].copy(d.feetW[k])); else f0[k].copy(r0).add(V3(0, -0.9, 0)); }
        const ft = this.feetAround(feetL, yaw);
        fT[0].copy(ft[0]); fT[1].copy(ft[1]);
      }
      t += dt;
      const u = Math.min(1, t / dur), e = ease(u);
      const rl = this.tmpL.lerpVectors(r0, rootL, ease(Math.min(1, u * 1.25)));
      rl.y = r0.y + (rootL.y - r0.y) * e;
      P.localToWorld(d.root.position.copy(rl));
      d.root.rotation.set(0, dampAngle(d.root.rotation.y, yaw, 6, dt), 0);
      for (let k = 0; k < 2; k++) {
        this.feetW[k].lerpVectors(f0[k], fT[k], e);
        this.feetW[k].y += Math.sin(Math.PI * e) * 0.04;
        P.localToWorld(this.feetW[k]);
      }
      d.feetW = this.feetW; d.pose = pose; d.rail = false;
      d.lookDown = damp(d.lookDown, 0.3, 3, dt);
      d.lean = Math.sin(Math.PI * u) * 0.45 + endLean * e;
      return u >= 1;
    };
  }
  /** 자세 유지 (판툰이 흔들려도 같은 자리). each: 매 프레임 발·몸 조정 */
  private holdAct(rootL: THREE.Vector3, feetL: THREE.Vector3, yaw: number, pose: Pose, lean: number, dur = Infinity, each?: (t: number) => void): Act {
    let t = 0;
    const P = this.pontoon.root, d = this.diver;
    return (dt) => {
      t += dt;
      P.localToWorld(d.root.position.copy(rootL));
      d.root.rotation.set(0, dampAngle(d.root.rotation.y, yaw, 5, dt), 0);
      const ft = this.feetAround(feetL, yaw);
      for (let k = 0; k < 2; k++) P.localToWorld(this.feetW[k].copy(ft[k]));
      d.feetW = this.feetW; d.pose = pose; d.rail = false;
      d.lean = damp(d.lean, lean, 4, dt);
      d.lookDown = damp(d.lookDown, 0, 2, dt);
      each?.(t);
      return t >= dur;
    };
  }
  /** 장비 랙·벤치 앞에 서서 착용 */
  private gearHoldAct(spot: Spot): Act {
    const P = this.pontoon.root, d = this.diver;
    return (dt) => {
      P.localToWorld(d.root.position.copy(spot.p).add(V3(0, LEG, 0)));
      d.root.rotation.set(0, dampAngle(d.root.rotation.y, spot.yaw, 4, dt), 0);
      d.pose = 'gearUp'; d.feetW = null; d.rail = false; d.lean = 0;
      return false;
    };
  }
  /** 스노클: 물에 잠긴 계단에 앉아 한 발씩 무릎 쪽으로 당겨 오리발을 신음 */
  private finsSitAct(rootL: THREE.Vector3, feetL: THREE.Vector3): Act {
    let a = false, b = false;
    const P = this.pontoon.root, d = this.diver;
    return this.holdAct(rootL, feetL, Math.PI / 2, 'sitFins', 0.35, 2.9, (t) => {
      const leg = t < 1.45 ? 0 : 1;
      d.finLeg = leg;
      const w = Math.sin(Math.PI * clamp(leg === 0 ? (t - 0.15) / 1.2 : (t - 1.6) / 1.2, 0, 1));
      const loc = P.worldToLocal(this.tmpL.copy(this.feetW[leg]));
      loc.y += w * 0.28; loc.x -= w * 0.2;
      P.localToWorld(this.feetW[leg].copy(loc));
      if (!a && t > 0.85) { a = true; d.attach('finL'); this.audio.splash(0.12); }
      if (!b && t > 2.15) { b = true; d.attach('finR'); this.audio.splash(0.12); }
    });
  }
  /** 스쿠버: 플랫폼 끝에서 난간을 잡고 한 발씩 뒤로 들어 오리발을 신음 */
  private finsStandAct(edgeL: THREE.Vector3, yaw: number): Act {
    let a = false, b = false;
    const P = this.pontoon.root, d = this.diver;
    const rootL = edgeL.clone().setY(edgeL.y + 0.9);
    return this.holdAct(rootL, edgeL, yaw, 'steps', 0.18, 2.6, (t) => {
      d.rail = true;
      const leg = t < 1.3 ? 0 : 1;
      const w = Math.sin(Math.PI * clamp(leg === 0 ? (t - 0.1) / 1.1 : (t - 1.4) / 1.1, 0, 1));
      const loc = P.worldToLocal(this.tmpL.copy(this.feetW[leg]));
      loc.y += w * 0.32; loc.x -= Math.sin(yaw) * w * 0.22; loc.z -= Math.cos(yaw) * w * 0.22;
      P.localToWorld(this.feetW[leg].copy(loc));
      d.root.position.y -= w * 0.05;
      if (!a && t > 0.7) { a = true; d.attach('finL'); }
      if (!b && t > 2.0) { b = true; d.attach('finR'); }
    });
  }
  /** 스노클: 계단에서 앞으로 밀고 나가 수면에 엎드려 뜸 */
  private pushOffAct(lz: number): Act {
    let t = -1, splashed = false;
    const from = V3(), d = this.diver;
    return (dt) => {
      if (t < 0) { t = 0; from.copy(d.root.position); }
      t += dt;
      const u = Math.min(1, t / 2.2), e = ease(u);
      const to = this.pontoon.toWorld(snorkelFloat(lz));
      to.y = waveHeight(to.x, to.z, this.t) - 0.2;
      d.root.position.lerpVectors(from, to, e);
      d.root.rotation.set(0, dampAngle(d.root.rotation.y, Math.PI / 2, 3, dt), 0);
      if (u < 0.16) { d.pose = 'sitFins'; d.lean = 0.7; }
      else { d.pose = 'float'; d.feetW = null; d.speed = 0.35; }
      if (!splashed && u > 0.2) { splashed = true; this.audio.splash(0.45); this.bubbles.burst(d.root.position.clone().add(V3(0, -0.3, 0)), 30, 0.25); }
      this.entryCam = 'float'; this.entryLook = 0.2 + u * 0.6;
      if (u >= 1 && t > 2.8) { this.snorkel.start(d.root.position, d.root.rotation.y); this.beginSwim('snorkel'); return true; }
      return false;
    };
  }
  /** 스쿠버: 자이언트 스트라이드 (준비 → 한 발 크게 내딛어 입수 → 기포 구름 → 수면 아래에서 안정) */
  private strideAct(lx: number): Act {
    let t = 0, stage = 0, init = false;
    const from = V3(), to = V3(), hold = V3();
    const d = this.diver, P = this.pontoon.root;
    return (dt) => {
      t += dt;
      if (!init) { init = true; P.worldToLocal(hold.copy(d.root.position)); }
      if (stage === 0) {
        P.localToWorld(d.root.position.copy(hold));
        d.pose = 'stride'; d.feetW = null; d.rail = false;
        this.entryCam = 'stride'; this.entryLook = 0.5;
        if (t > 1.5) { stage = 1; t = 0; from.copy(d.root.position); this.pontoon.toWorld(scubaEntry(lx), to); }
      } else if (stage === 1) {
        const u = Math.min(1, t / 0.75);
        d.root.position.lerpVectors(from, to, u);
        d.root.position.y = THREE.MathUtils.lerp(from.y, to.y, u * u) + Math.sin(u * Math.PI) * 0.35;
        d.pose = 'stride';
        this.entryLook = 0.6;
        if (u >= 1) {
          stage = 2; t = 0;
          this.audio.splash(1.2);
          const fp = this.fp;
          const at = fp ? this.camera.position.clone().add(V3(0, -0.4, 0)) : d.root.position.clone().add(V3(0, 0.2, 0));
          this.bubbles.burst(at, 140, fp ? 0.6 : 0.9, 1.6);
        }
      } else {
        // 물속: 기포 구름 → BCD 부력으로 수면 바로 아래에 안정 → 하강 준비
        d.pose = t < 1.2 ? 'stride' : 'hover';
        d.speed = 0.1;
        const target = to.clone(); target.y = -1.0 + Math.sin(t * 1.2) * 0.05;
        d.root.position.lerp(target, 1 - Math.exp(-1.5 * dt));
        this.entryCam = 'under'; this.entryLook = 0.1 + Math.max(0, 0.6 - t * 0.25);
        if (t > 3.2) { this.scuba.start(d.root.position, d.root.rotation.y); this.beginSwim('scuba'); return true; }
      }
      return false;
    };
  }

  // ───────── 도착: 계류 → 현문 사다리 → 판툰 ─────────
  private updateDocking(dt: number) {
    const P = this.pontoon;
    P.gangwayU = clamp((this.phaseT - 0.8) / 2.4, 0, 1);
    if (this.phaseT > 0.8 && !this.gangwayClank) { this.gangwayClank = true; this.ui.hint('리프 판툰에 도착했어요 · 현문 사다리를 걸고 있어요', false, 3.5); }
    this.camTarget.set(-2.4, 3.3, 1.4); this.lookTarget.set(-7.0, 1.3, -4.4);
    this.driveCam(dt, 0.9);
    if (this.phaseT > 3.8) this.startTransfer();
  }
  private startTransfer() {
    store.set({ phase: 'transfer' }); this.phaseT = 0;
    const B = this.boat.root, P = this.pontoon.root;
    const onP = this.boat.disembarkPath.length - 1; // 이 구간(게이트 → 판툰 경첩)을 지나면 판툰 위
    // 현문을 건너 판툰 안쪽 몇 걸음까지만 걸어 들어오고, 그다음부터는 자유롭게
    const end = V3(-4.0, MD, MAIN_LANE + 0.2);
    const path = [...this.wp(B, this.boat.disembarkPath), ...this.wp(P, [HINGE.clone(), V3(-5.2, MD, MAIN_LANE), end])];
    this.onPontoon = false;
    this.entryCam = 'follow';
    this.acts = [
      this.walkAct(path, 1.3, 'follow', (seg) => { if (seg > onP) this.onPontoon = true; else if (seg < onP) this.entryCam = 'boat'; }),
      this.call(() => {
        this.enterDeck(end, Math.PI / 2);
        this.ui.hint(this.q.isTouch
          ? '판툰에 도착! 자유롭게 둘러보세요 · 우현 스노클 존 / 선미 다이빙 데크로 가면 체험 시작 · 선수 쪽 계단으로 2층 선베드'
          : '판툰에 도착! WASD로 자유롭게 둘러보세요 · 우현 스노클 존 / 선미 다이빙 데크로 가면 체험 시작 · 선수 계단으로 2층 선베드', false, 8);
      }),
    ];
  }
  private dockBoat() {
    this.boat.root.position.set(BERTH.x, 0, BERTH.z); this.boat.speed = 0; this.boat.update(0.016, 0);
    this.pontoon.gangwayU = 1;
  }

  // ───────── 판툰 위 자유 이동 ─────────
  /** 판툰 1층 한 지점에 서서 자유 이동 시작 (도착·복귀·디버그 공통) */
  private enterDeck(pL: THREE.Vector3, yaw: number) {
    store.set({ phase: 'anchored', mode: null });
    this.acts = []; this.lying = null; this.lieState = 'none';
    this.diver.clearGear(); this.diver.setSuit(false, true); this.diver.gearSet = 'none';
    this.deck.place(pL, yaw, 'main');
    this.zoneSeen = this.deck.zone(); this.zoneDismissed.clear();
    this.ui.showZone(null); this.ui.setPrompt('');
    this.applyDeckDiver(0);
    this.applyDeckView();
  }
  private applyDeckView() {
    const fp = this.fp;
    this.diver.root.visible = !fp;
    this.setFov(fp);
    this.rig.surfaceMode = false;
    this.rig.pitchRange = fp ? [-1.2, 1.2] : [-0.2, 1.15];
    this.rig.distRange = [1.6, 7];
    if (fp) this.rig.toFP(this.deckEye(), this.deck.yaw, 0.05);
    else this.rig.toOrbit(this.deckFocus(), 3.6, 0.3);
  }
  private deckFocus() { return this.diver.chestWorld(V3()).add(V3(0, 0.25, 0)); }
  private deckEye() {
    const y = this.diver.root.rotation.y;
    return this.diver.headWorld(V3()).add(V3(Math.sin(y) * 0.1, 0.06, Math.cos(y) * 0.1));
  }
  /** 1층 2층 데크 아래에선 카메라가 천장을 뚫지 않게, 바닥 아래로도 내려가지 않게 */
  private deckCamLimits() {
    const P = this.pontoon.root.position.y;
    const p = this.deck.pos;
    const under = this.deck.level === 'main' && p.z > -3.6 && p.z < 9.2 && Math.abs(p.x) < 6.2;
    this.rig.ceil = under ? P + UD - 0.35 : undefined;
    this.rig.minY = P + (this.lieState === 'lying' ? UD : this.deck.floorAt(p.x, p.z)) + 0.35;
  }
  /** 판툰 좌표의 발자국 → 캐릭터 */
  private applyDeckDiver(dt: number) {
    const d = this.diver, P = this.pontoon.root, m = this.deck;
    P.localToWorld(d.root.position.set(m.pos.x, m.hipY, m.pos.z));
    d.root.rotation.set(0, m.yaw, 0);
    d.pose = 'steps';
    for (let k = 0; k < 2; k++) P.localToWorld(this.feetW[k].copy(m.feet[k]));
    d.feetW = this.feetW;
    d.rail = m.onStairs; d.lean = 0;
    d.lookDown = damp(d.lookDown, m.onStairs ? 0.55 : 0, 4, Math.max(dt, 0.016));
  }

  private updateDeck(dt: number) {
    const inp = this.input.state;
    // 안전장치: 자유 이동 중엔 항상 캐릭터를 따라가는 카메라 (연출 카메라로 남아 있으면 되돌림)
    if (!this.acts.length && this.rig.mode === 'cine') this.applyDeckView();
    if (this.map.isOpen) { inp.move.x = 0; inp.move.y = 0; inp.interact = false; }
    // 선베드에 누워 있는 중: 움직이거나 F를 누르면 일어남
    if (this.lieState === 'lying' && (inp.interact || Math.hypot(inp.move.x, inp.move.y) > 0.3)) this.riseFromLounger();
    if (this.acts.length) {
      this.runActs(dt);
      this.ui.setPrompt(this.lieState === 'lying' ? '일어나기' : '');
      return;
    }
    const yaw = this.rig.heading;
    const want = V3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(inp.move.y * 1.45)
      .addScaledVector(V3(-Math.cos(yaw), 0, Math.sin(yaw)), inp.move.x * 1.45);
    this.deck.update(dt, want, this.fp && this.rig.mode === 'fp' ? yaw : null);
    this.applyDeckDiver(dt);
    // 체험 존: 들어서면 시점 선택 카드 (나중에를 누르면 존을 벗어났다 다시 올 때까지 묻지 않음)
    const z = this.deck.zone();
    if (z !== this.zoneSeen) {
      if (this.zoneSeen && !z) this.zoneDismissed.delete(this.zoneSeen);
      this.zoneSeen = z;
      this.ui.showZone(z && !this.zoneDismissed.has(z) ? z : null);
    }
    // 2층 선베드
    const l = this.deck.nearLounger();
    this.ui.setPrompt(l ? '선베드에 눕기' : '');
    if (l && inp.interact) this.lieOnLounger(l);
  }

  /** 선베드: 옆에 서서 → 가장자리에 앉고 → 다리를 올려 등을 기대고 누움 */
  private lieOnLounger(l: Lounger) {
    const P = this.pontoon.root;
    const side = loungerSide(l);
    const sx = Math.sign(side.x - l.x);
    const sitRoot = V3(l.x + sx * 0.12, UD + 0.47, l.z + 0.2), sitFeet = V3(l.x + sx * 0.55, UD, l.z + 0.2);
    const faceOut = Math.atan2(sx, 0);
    this.lying = l; this.lieState = 'going';
    this.ui.setPrompt('');
    this.acts = [
      this.walkAct(this.wp(P, [this.deck.pos.clone(), side]), 1, 'follow'),
      this.sitAct(sitRoot, sitFeet, faceOut, 1.0, 0.05),
      this.lieAct(loungerLie(l), 1.7, true),
      this.call(() => { this.lieState = 'lying'; this.ui.hint('선베드에서 쉬는 중 · 드래그로 주변 바다를 둘러보세요 · 움직이면 일어나요', false, 5); }),
      this.holdAct(loungerLie(l), loungerLie(l), Math.PI, 'lie', 0),
    ];
  }
  private riseFromLounger() {
    const l = this.lying; if (!l) return;
    const side = loungerSide(l);
    const sx = Math.sign(side.x - l.x);
    const sitRoot = V3(l.x + sx * 0.12, UD + 0.47, l.z + 0.2), sitFeet = V3(l.x + sx * 0.55, UD, l.z + 0.2);
    const faceOut = Math.atan2(sx, 0);
    this.lieState = 'rising';
    this.acts = [
      this.lieAct(sitRoot, 1.4, false, sitFeet),
      this.sitAct(V3(side.x, UD + 0.9, side.z), side, faceOut, 1.0, 0, 'steps'),
      this.call(() => { this.deck.place(side, faceOut, 'upper'); this.lying = null; this.lieState = 'none'; }),
    ];
  }
  /** 앉은 자세 ↔ 누운 자세 (down: 눕기) */
  private lieAct(rootL: THREE.Vector3, dur: number, down: boolean, feetL?: THREE.Vector3): Act {
    let t = -1;
    const r0 = V3(), P = this.pontoon.root, d = this.diver;
    return (dt) => {
      if (t < 0) { t = 0; P.worldToLocal(r0.copy(d.root.position)); }
      t += dt;
      const u = Math.min(1, t / dur), e = ease(u);
      const rl = this.tmpL.lerpVectors(r0, rootL, e);
      P.localToWorld(d.root.position.copy(rl));
      d.root.rotation.set(0, dampAngle(d.root.rotation.y, down ? Math.PI : Math.atan2(Math.sign(rootL.x - (this.lying?.x ?? rootL.x)) || 1, 0), 3.5, dt), 0);
      if (down || u < 0.45) { d.pose = 'lie'; d.feetW = null; }
      else if (feetL) {
        const yaw = d.root.rotation.y;
        const ft = this.feetAround(feetL, yaw);
        for (let k = 0; k < 2; k++) P.localToWorld(this.feetW[k].copy(ft[k]));
        d.pose = 'sit'; d.feetW = this.feetW;
      }
      d.rail = false; d.lean = 0.05;
      return u >= 1;
    };
  }

  /** 지도: 나 · 다른 다이버 · 배 */
  private updateMap(dt: number, phase: string, mode: Mode) {
    const show = phase === 'anchored' || phase === 'swim';
    this.map.setMiniVisible(show);
    if (!show && !this.map.isOpen) return;
    const d = this.diver.root;
    const P = this.pontoon.root;
    const local = this.pontoon.toLocal(this.fp && phase === 'swim' ? this.camera.position : d.position);
    const yaw = phase === 'swim' ? (mode === 'snorkel' ? this.snorkel.yaw : this.scuba.yaw) : phase === 'anchored' && this.lieState === 'none' ? this.deck.yaw : d.rotation.y;
    const onPontoon = phase === 'anchored' || phase === 'gearing' || (phase === 'entry' && local.y > 0.1) || (phase === 'transfer' && this.onPontoon);
    const depth = phase === 'swim' ? (mode === 'snorkel' ? this.snorkel.depth : this.scuba.depth) : 0;
    const st: MapState = {
      me: { x: local.x, z: local.z, yaw, depth, onPontoon, upper: phase === 'anchored' && (this.deck.level !== 'main' || this.lieState !== 'none') },
      peers: this.net.peerMarks(),
      boat: { x: this.boat.root.position.x - P.position.x, z: this.boat.root.position.z - P.position.z, yaw: this.boat.heading },
    };
    this.map.update(st, dt);
  }

  get fp() { return store.get().view === 'first'; }

  /** 수중에서 1인칭 ↔ 3인칭 전환 */
  toggleView() {
    const s = store.get();
    if (s.phase === 'anchored' && !this.acts.length) { store.set({ view: s.view === 'first' ? 'third' : 'first' }); this.applyDeckView(); return; }
    if (s.phase !== 'swim') return;
    store.set({ view: s.view === 'first' ? 'third' : 'first' });
    this.applyView(s.mode);
  }

  private applyView(mode: Mode) {
    const fp = this.fp;
    this.info.fp = fp;
    this.snorkel.fp = fp; this.scuba.fp = fp;
    this.diver.root.visible = !fp;
    this.setFov(fp);
    const up = this.surfacedNow;
    if (fp) {
      this.rig.pitchRange = [-1.35, 1.35];
      this.rig.toFP(this.eye(mode), mode === 'snorkel' ? this.snorkel.yaw : this.scuba.yaw, up ? 0.02 : mode === 'snorkel' ? 0.55 : 0.1);
    } else {
      this.rig.pitchRange = up ? [-0.5, 1.0] : mode === 'snorkel' ? [-0.6, 0.9] : [-1.1, 1.1];
      this.rig.toOrbit(this.focus(mode), up ? 3.4 : mode === 'snorkel' ? 3.2 : 3.6, up ? 0.14 : mode === 'snorkel' ? 0.25 : 0.12);
    }
  }

  /** 물 밖으로 머리를 내밀거나(true) 다시 물속으로(false) */
  private setSurfaced(up: boolean, mode: 'snorkel' | 'scuba') {
    if (this.surfacedNow === up) return;
    this.surfacedNow = up;
    this.rig.surfaceMode = up;
    const fp = this.fp;
    if (up) {
      // 수평선이 보이도록 시선을 들어 올림
      this.rig.pitchRange = fp ? [-1.35, 1.35] : [-0.5, 1.0];
      if (fp) this.rig.aim(0.02); else this.rig.aim(0.14, 3.4);
      if (mode === 'scuba') {
        this.audio.surfaceBreath();
        this.ui.hint(this.q.isTouch ? '수면 위로 올라왔어요 · 배는 ⛵ 표시 쪽 · ▼ 하강으로 다시 잠수' : '수면 위로 올라왔어요 · 배는 ⛵ 표시 쪽 · Shift로 다시 잠수 · ⛵ 배로 복귀', false, 6);
      } else {
        this.ui.hint(this.q.isTouch ? '고개를 들었어요 · ↑ 버튼을 한 번 더 누르면 다시 엎드려요' : '고개를 들었어요 · Space를 한 번 더 누르면 다시 엎드려요', false, 4.5);
      }
    } else {
      this.applyView(mode);
    }
  }

  private setFov(fp: boolean) {
    const portrait = innerWidth / innerHeight < 1;
    this.camera.fov = fp ? (portrait ? 84 : 72) : (portrait ? 76 : 62);
    this.camera.near = fp ? 0.03 : 0.05;
    this.camera.updateProjectionMatrix();
  }

  private debugJump(mode: 'snorkel' | 'scuba') {
    this.cruiseU = 1; this.dockBoat();
    this.enterDeck(V3(0.9, MD, MAIN_LANE), Math.PI / 2);
    this.select(mode, store.get().view);
    this.acts = [];
    for (const s of this.gearSteps) s.act();
    this.gearIdx = this.gearSteps.length; this.gearDone = true;
    const d = this.diver;
    d.attach('finL'); d.attach('finR');
    d.setSuit(mode === 'scuba', true);
    d.feetW = null;
    if (mode === 'snorkel') {
      const feet = this.pontoon.toWorld(snorkelFloat(SNORKEL_LANES[0])); feet.y = -0.2;
      this.snorkel.start(feet, Math.PI / 2); d.root.rotation.set(0, Math.PI / 2, 0);
      d.root.position.copy(feet);
    } else {
      const feet = this.pontoon.toWorld(scubaEntry(0)); feet.y = -4;
      this.scuba.start(feet, Math.PI); d.root.position.copy(feet);
    }
    this.camera.position.copy(d.root.position).add(V3(0, 0.3, 3));
    this.beginSwim(mode);
  }

  private beginSwim(mode: Mode) {
    store.set({ phase: 'swim' });
    this.acts = [];
    this.diver.feetW = null; this.diver.rail = false; this.diver.lean = 0; this.diver.lookDown = 0;
    this.audio.setScene(mode === 'snorkel' ? 'snorkel' : 'scuba');
    this.info.active = true;
    this.rig.distRange = mode === 'snorkel' ? [1.8, 6] : [1.6, 9];
    this.applyView(mode);
    this.updateInfo(mode);
    const fpTip = this.fp ? ' · 시점 버튼으로 3인칭 전환' : '';
    this.ui.hint(mode === 'snorkel'
      ? (this.q.isTouch ? '잠수 버튼으로 내려가면 그 깊이에 머물러요 (최대 5m) · ↑ 수면 / 고개 들기' : 'Shift로 잠수하면 그 깊이에 머물러요 (최대 5m) · Space 수면 / 고개 들기') + fpTip
      : (this.q.isTouch ? '하강 버튼으로 천천히 내려가 보세요' : 'Shift로 천천히 하강 · Space 상승 · Q 정지') + fpTip, false, 7);
  }

  private placeOnDeck() {
    const p = this.boat.toWorld(this.boat.deckSpot);
    this.diver.root.position.set(p.x, p.y + LEG, p.z);
    this.diver.root.rotation.set(0, this.boat.heading + Math.PI, 0);
    this.diver.pose = 'stand';
  }

  /** 장비 착용 장면 (등에 메는 BCD·레귤레이터는 뒤에서) */
  private setGearShot(back: boolean) {
    const s = this.spot;
    const f = V3(Math.sin(s.yaw), 0, Math.cos(s.yaw)), sd = V3(f.z, 0, -f.x);
    this.camFrame = this.pontoon.root;
    this.camTarget = back ? s.p.clone().addScaledVector(f, -2.1).addScaledVector(sd, 0.9).setY(MD + 1.6) : s.p.clone().addScaledVector(f, 0.55).addScaledVector(sd, 2.2).setY(MD + 1.5);
    this.lookTarget = s.p.clone().setY(MD + 1.05);
  }
  /** 지금 카메라 위치에서 끊김 없이 다른 좌표계(판툰 등) 기준 연출로 이어 받음 */
  private camFromCurrent(frame: THREE.Object3D) {
    this.camFrame = frame;
    this.camLocal.copy(frame.worldToLocal(this.camera.position.clone()));
    this.lookLocal.copy(frame.worldToLocal(this.rig.cineLook.clone()));
  }
  /** 걷기·입수 중 3인칭 연출 카메라 (1인칭이면 눈높이) */
  private entryCamera(dt: number) {
    void dt;
    const d = this.diver;
    if (this.fp && store.get().phase === 'entry') { this.fpCam(this.entryLook, 6); return; }
    const yaw = d.root.rotation.y;
    const f = V3(Math.sin(yaw), 0, Math.cos(yaw)), sd = V3(f.z, 0, -f.x);
    const p = d.root.position;
    switch (this.entryCam) {
      case 'follow':
        this.rig.setCine(p.clone().addScaledVector(f, -3.3).addScaledVector(sd, 1.2).add(V3(0, 1.35, 0)), p.clone().addScaledVector(f, 0.8).add(V3(0, 0.1, 0)), 2.0);
        break;
      case 'front': {
        // 계단: 앞쪽 아래에서 올려다봐 발이 디딤판을 딛는 모습이 보이게
        const c = p.clone().addScaledVector(f, 2.9).addScaledVector(sd, 1.5);
        c.y = Math.max(p.y + 0.3, 0.75);
        this.rig.setCine(c, p.clone().add(V3(0, -0.35, 0)), 1.6);
        break;
      }
      case 'stride': {
        const P = this.pontoon.root;
        this.rig.setCine(P.localToWorld(V3(3.6, 1.5, -16.3)), P.localToWorld(V3(this.lane, 0.6, -18.4)), 1.2);
        break;
      }
      case 'float': {
        const c = p.clone().addScaledVector(f, -2.5).addScaledVector(sd, 0.9);
        c.y = this.entryLook > 0.55 ? -0.6 : Math.max(p.y + 0.9, 0.7);
        this.rig.setCine(c, p.clone().add(V3(0, -0.5, 0)).addScaledVector(f, 0.8), 1.4);
        break;
      }
      case 'boat': {
        // 배 갑판의 좁은 통로: 선실에 가리지 않게 판툰 위에서 배 옆을 바라봄
        this.rig.setCine(this.pontoon.root.localToWorld(V3(-4.3, 2.9, 1.2)), p.clone().add(V3(0, 0.1, 0)), 1.8);
        break;
      }
      case 'under':
        this.rig.setCine(p.clone().addScaledVector(f, 3.2).add(V3(1.2, -1.2, 0)), p.clone(), 1.3);
        break;
    }
  }

  private focus(mode: Mode) {
    const d = this.diver;
    if (this.surfacedNow) return d.headWorld(V3()).add(V3(0, 0.12, 0));
    if (mode === 'snorkel') {
      const f = V3(Math.sin(this.snorkel.yaw), 0, Math.cos(this.snorkel.yaw));
      return d.headWorld(V3()).addScaledVector(f, 0.5).add(V3(0, -0.75, 0));
    }
    return d.chestWorld(V3()).add(V3(0, 0.25, 0));
  }

  /** 1인칭 눈 위치 (마스크 렌즈) */
  private eye(mode: Mode) {
    const c = mode === 'snorkel' ? this.snorkel : this.scuba;
    const f = V3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    return this.diver.headWorld(V3()).addScaledVector(f, 0.14).add(V3(0, mode === 'snorkel' ? -0.05 : 0.05, 0));
  }

  /** 생물이 보이는 화면 영역을 잘라 작은 사진(JPEG)으로 저장 — 그린 직후 프레임에서 캡처 */
  private capturePhoto(c: Creature, done: (url: string | null) => void) {
    const prev = this.engine.afterRender;
    this.engine.afterRender = () => {
      prev?.();
      try {
        const cv = this.engine.renderer.domElement;
        const W = cv.width, H = cv.height;
        const p = c.center().clone();
        const pr = p.clone().project(this.camera);
        if (pr.z > 1 || Math.abs(pr.x) > 1.2 || Math.abs(pr.y) > 1.2) { done(null); return; }
        // 생물 크기만큼 화면에서 차지하는 반지름 (무리는 조금 넓게)
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
        const group = 'agents' in c ? 1.8 : 1;
        const edge = p.clone().addScaledVector(right, Math.max(0.12, c.sp.length * 0.75 * group)).project(this.camera);
        const rPx = Math.abs(edge.x - pr.x) * 0.5 * W;
        let w = THREE.MathUtils.clamp(rPx * 3.2, H * 0.22, Math.min(W, H * 1.4));
        let h = w * 0.625;
        if (h > H) { h = H; w = h / 0.625; }
        const cx = (pr.x * 0.5 + 0.5) * W, cy = (1 - (pr.y * 0.5 + 0.5)) * H;
        const sx = THREE.MathUtils.clamp(cx - w / 2, 0, W - w), sy = THREE.MathUtils.clamp(cy - h / 2, 0, H - h);
        const out = document.createElement('canvas'); out.width = 320; out.height = 200;
        out.getContext('2d')!.drawImage(cv, sx, sy, w, h, 0, 0, 320, 200);
        done(out.toDataURL('image/jpeg', 0.78));
      } catch { done(null); }
    };
  }

  /** 화면 속 태양 위치 → 후처리 눈부심(글레어·렌즈 고스트) */
  private updateSunGlare(under: boolean) {
    const u = this.engine.postU.uSun.value;
    const sp = this.camera.position.clone().addScaledVector(waterUniforms.uSunDir.value, 500).project(this.camera);
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    const facing = dir.dot(waterUniforms.uSunDir.value);
    const onScreen = Math.max(0, 1 - Math.max(Math.abs(sp.x), Math.abs(sp.y)) * 0.75);
    u.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5, under || facing <= 0 || sp.z > 1 ? 0 : onScreen * Math.min(1, facing * 2));
  }

  private emitExhale() {
    const head = this.diver.bubbleOrigin.getWorldPosition(V3());
    if (this.fp) {
      // 1인칭: 레귤레이터 배기구 기포가 마스크 양옆으로 올라가며 시야 가장자리를 스침
      const c = this.scuba;
      const f = V3(Math.sin(c.yaw), 0, Math.cos(c.yaw)), r = V3(f.z, 0, -f.x);
      const eye = this.eye('scuba');
      for (const s of [-1, 1]) this.bubbles.burst(eye.clone().addScaledVector(r, s * 0.2).addScaledVector(f, 0.05).add(V3(0, -0.18, 0)), 10 + Math.floor(Math.random() * 6), 0.05);
      return;
    }
    this.bubbles.burst(head, 16 + Math.floor(Math.random() * 8), 0.06);
  }

  private updateInfo(mode: Mode) {
    const c = mode === 'snorkel' ? this.snorkel : this.scuba;
    if (this.fp) this.info.pos.copy(this.camera.position);
    else this.diver.chestWorld(this.info.pos);
    this.info.vel.copy(c.vel);
    this.info.forward.set(Math.sin(this.rig.heading), 0, Math.cos(this.rig.heading));
    this.info.idleTime = c.idle;
    this.info.fp = this.fp;
  }

  // ───────── 프레임 ─────────
  private frame(dt: number, t: number) {
    this.t = t;
    this.phaseT += dt;
    waterUniforms.uTime.value = t;
    this.input.poll();
    this.rig.sensitivity = store.get().lookSensitivity;
    const s = store.get();
    const boat = this.boat;
    let engineLvl = 0;
    this.pontoon.update(t);

    switch (s.phase) {
      case 'title': {
        boat.speed = 0;
        const a = t * 0.045;
        const bp = boat.root.position;
        this.rig.setCine(V3(bp.x + Math.sin(a) * 23, 3.6, bp.z + Math.cos(a) * 23), V3(bp.x, 5.2, bp.z), 1.2);
        break;
      }
      case 'boarding': {
        this.camTarget = V3(-3.5, 4.8, -14); this.lookTarget = V3(0, 2, 4);
        if (this.phaseT < 0.05) { this.camLocal.copy(boat.root.worldToLocal(this.camera.position.clone())); this.lookLocal.set(0, 2, 0); }
        this.driveCam(dt, 1.1);
        engineLvl = Math.min(1, this.phaseT / 2.5) * 0.4;
        if (this.phaseT > 3) { store.set({ phase: 'cruise' }); this.phaseT = 0; this.cruiseU = 0; }
        break;
      }
      case 'cruise': {
        const prevZ = boat.root.position.z;
        this.cruiseU = Math.min(1, this.cruiseU + dt / CRUISE_T);
        const z = START_Z + (BERTH.z - START_Z) * ease(this.cruiseU);
        boat.root.position.x = BERTH.x;
        boat.root.position.z = z;
        boat.speed = (z - prevZ) / Math.max(dt, 1e-3);
        engineLvl = 0.4 + Math.min(1, boat.speed / 14) * 0.6;
        const u = this.cruiseU;
        if (u < 0.33) { this.camTarget.set(-3.5, 4.8, -14); this.lookTarget.set(0, 2, 6); }
        else if (u < 0.66) { this.camTarget.set(12, 3.2, 1); this.lookTarget.set(0, 1.4, -2); }
        else { this.camTarget.set(-1.2, 5.2, -9); this.lookTarget.set(5, 1, 26); } // 앞쪽에 판툰이 보임
        this.driveCam(dt, 0.7);
        if (this.cruiseU >= 1) {
          // 판툰 좌현에 나란히 붙여 계류 → 현문 사다리를 걸침
          boat.speed = 0; boat.root.position.set(BERTH.x, 0, BERTH.z);
          store.set({ phase: 'docking' }); this.phaseT = 0;
          this.audio.setScene('air');
          this.gangwayClank = false;
          this.camFromCurrent(this.pontoon.root);
        }
        break;
      }
      case 'docking': this.updateDocking(dt); break;
      case 'transfer':
        this.runActs(dt);
        // 다 건너 판툰 자유 이동으로 바뀐 프레임에는 연출 카메라를 다시 걸지 않음 (걸면 카메라가 멈춘 채 따라오지 않음)
        if (store.get().phase === 'transfer') this.entryCamera(dt);
        break;
      case 'anchored': this.updateDeck(dt); break;
      case 'gearing': {
        this.runActs(dt);
        const st = this.gearSteps;
        if (this.atGear && this.gearIdx < st.length) {
          const cur = this.gearIdx >= 0 ? st[this.gearIdx] : null;
          if (!cur || this.phaseT > cur.dur) {
            this.gearIdx++; this.phaseT = 0;
            if (this.gearIdx < st.length) { st[this.gearIdx].act(); this.ui.setGearSteps(s.mode === 'snorkel' ? '스노클링 장비' : '스쿠버다이빙 장비', st.map((x) => x.label), this.gearIdx); }
            if (this.gearIdx === st.length - 1 && !this.gearDone) {
              // 시점은 존에서 이미 골랐으니 착용이 끝나면 바로 입수 지점으로
              this.gearDone = true;
              this.ui.setGearSteps(s.mode === 'snorkel' ? '스노클링 장비' : '스쿠버다이빙 장비', st.map((x) => x.label), st.length);
            }
          }
        }
        if (this.gearDone && this.gearIdx >= st.length && store.get().phase === 'gearing') { this.startEntry(); break; }
        const label = st[Math.max(0, Math.min(this.gearIdx, st.length - 1))]?.label ?? '';
        if (!this.atGear) { this.entryCam = 'follow'; this.entryCamera(dt); }
        else { this.setGearShot(label.includes('BCD') || label.includes('레귤레이터')); this.driveCam(dt, 1.6); }
        break;
      }
      case 'entry':
        this.runActs(dt);
        if (store.get().phase === 'entry') this.entryCamera(dt);
        break;
      case 'swim': this.updateSwim(dt, t, s.mode); break;
      case 'exiting': break;
    }

    boat.update(dt, t);
    // 현문 사다리: 배가 판툰에 계류한 뒤에만 배 갑판 게이트에 걸쳐짐
    const docked = !(s.phase === 'loading' || s.phase === 'title' || s.phase === 'boarding' || s.phase === 'cruise');
    this.pontoon.setGangway(docked ? boat.toWorld(boat.gate) : null);
    if (s.phase === 'title' || s.phase === 'boarding' || s.phase === 'cruise' || s.phase === 'docking') { this.placeOnDeck(); this.diver.feetW = null; }
    if (s.phase === 'boarding' || s.phase === 'cruise') this.diver.root.rotation.y = boat.heading;
    this.diver.update(dt, t);
    {
      // 위치는 판툰 기준 좌표로 공유 → 판툰 위 의자·장비 랙·계단에서 모두에게 같은 자리로 보임
      const d = this.diver, r = d.root;
      const vis = s.phase === 'anchored' || s.phase === 'gearing' || s.phase === 'entry' || s.phase === 'swim' || (s.phase === 'transfer' && this.onPontoon);
      const lp = this.pontoon.toLocal(r.position);
      let ft: number[] | undefined;
      if (d.feetW && (d.pose === 'steps' || d.pose === 'sit' || d.pose === 'sitFins')) {
        const a = this.pontoon.toLocal(d.feetW[0]), b = this.pontoon.toLocal(d.feetW[1]);
        ft = [a.x, a.y, a.z, b.x, b.y, b.z];
      }
      const st: NetState = {
        m: s.mode, w: vis ? 1 : 0, p: [lp.x, lp.y, lp.z], r: [r.rotation.x, r.rotation.y, r.rotation.z],
        po: d.pose, sp: d.speed, mo: d.motion, ft, g: d.gearMask, su: d.suitOn ? 1 : 0, rl: d.rail ? 1 : 0,
      };
      this.net.update(dt, t, st);
    }
    // 바다 생물: 공유 시계(모든 접속자 공통) 기준 → 같은 생물이 같은 시각·위치에
    const W = worldNow();
    this.director.update(dt, t, W, this.info, this.camera.position);
    this.fish.update(dt, t, this.info, W, this.camera.position);
    this.residents.update(t);
    this.benthic.update(dt, t, this.info, W);

    // 카메라
    if ((this.rig.mode === 'orbit' || this.rig.mode === 'fp') && s.phase === 'swim') {
      this.rig.handleInput(this.input.state, this.q.isTouch);
      this.rig.update(dt, this.rig.mode === 'fp' ? this.eye(s.mode) : this.focus(s.mode), t, true);
    } else if ((this.rig.mode === 'orbit' || this.rig.mode === 'fp') && s.phase === 'anchored') {
      if (!this.map.isOpen) this.rig.handleInput(this.input.state, this.q.isTouch);
      this.deckCamLimits();
      this.rig.update(dt, this.rig.mode === 'fp' ? this.deckEye() : this.deckFocus(), t, false);
    } else this.rig.update(dt, V3(), t, false);

    // 수면 위/아래 전환
    const cp = this.camera.position;
    const under = cp.y < waveHeight(cp.x, cp.z, t) - 0.03;
    if (under !== this.wasUnder) {
      this.wasUnder = under;
      if (s.phase !== 'title') this.audio.whoosh();
      if (s.phase === 'swim') {
        this.audio.setScene(under ? (s.mode === 'snorkel' ? 'snorkel' : 'scuba') : 'air');
        // 물 밖으로 나온 순간: 렌즈(마스크)에 물방울이 맺혀 흘러내리고, 눈부심이 잠깐
        if (!under) { this.engine.postU.uWet.value = this.fp ? 1 : 0.45; this.engine.postU.uExposure.value = 1.6; this.audio.splash(0.25); }
      }
    }
    this.engine.postU.uWet.value = Math.max(0, this.engine.postU.uWet.value - dt / 5);
    waterUniforms.uUnderwater.value = under ? 1 : 0;
    this.engine.postU.uUnder.value = under ? 1 : 0;
    this.engine.postU.uMask.value = damp(this.engine.postU.uMask.value, this.fp && (s.phase === 'swim' || (s.phase === 'entry' && under)) ? 1 : 0, 4, dt);
    this.engine.postU.uExposure.value = damp(this.engine.postU.uExposure.value, under ? 0.98 : 1.0, under ? 3 : 1.6, dt);
    this.updateSunGlare(under);
    if (under) { this.hemi.color.setRGB(0.6, 0.8, 0.85); this.hemi.groundColor.setRGB(0.12, 0.18, 0.2); this.hemi.intensity = 0.55; this.sun.intensity = 2.0; }
    else { this.hemi.color.setRGB(0.6, 0.78, 1.0); this.hemi.groundColor.setRGB(0.22, 0.3, 0.3); this.hemi.intensity = 0.95; this.sun.intensity = 3.0; }

    this.sky.update(this.camera);
    this.horizon.update(t, this.pontoon.root.position, under);
    this.surface.update(this.camera);
    this.reef.update(this.camera, under ? 44 : 40);
    this.bubbles.update(dt, t);
    const depth = Math.max(0, -cp.y);
    this.audio.update(dt, depth, engineLvl);
    this.ui.setPerf(`${this.q.tier.toUpperCase()} · ${Math.round(this.engine.fps)} fps`);
    // 닉네임 태그 (카메라 갱신 뒤에 투영해야 흔들리지 않음)
    const mineVisible = this.diver.root.visible && ['transfer', 'anchored', 'gearing', 'entry', 'swim'].includes(s.phase);
    this.net.updateTags(mineVisible ? this.diver.headWorld(V3()) : null, mineVisible);
    // 물 밖에 머리를 내밀었을 때: 판툰 위치 표시 (화면 밖이면 가장자리에 방향 표시)
    {
      const show = s.phase === 'swim' && !under;
      let x = 0, y = 0, dist = 0, side = 0;
      if (show) {
        const bp = this.pontoon.root.position.clone().add(V3(0, 5.2, 0));
        dist = Math.hypot(bp.x - cp.x, bp.z - cp.z);
        const pr = bp.project(this.camera);
        let nx = pr.x, ny = pr.y;
        const behind = pr.z > 1;
        if (behind) { nx = -nx; ny = -0.55; if (Math.abs(nx) < 0.3) nx = nx < 0 ? -1 : 1; }
        if (behind || Math.abs(nx) > 0.9 || Math.abs(ny) > 0.8) {
          const k = Math.max(Math.abs(nx) / 0.9, Math.abs(ny) / 0.8, 1); nx /= k; ny /= k;
          side = nx < 0 ? -1 : 1;
        }
        x = (nx * 0.5 + 0.5) * innerWidth; y = (-ny * 0.5 + 0.5) * innerHeight;
      }
      this.ui.setBoatTag(show && dist > 7, x, y, dist, side);
    }
    this.updateMap(dt, s.phase, s.mode);
    this.input.consume();
  }

  /** 배 기준 로컬 좌표로 카메라를 부드럽게 이동 (배가 움직여도 흔들림 없이) */
  private driveCam(dt: number, lambda: number) {
    const F = this.camFrame ?? this.boat.root;
    this.camLocal.lerp(this.camTarget, 1 - Math.exp(-lambda * dt));
    this.lookLocal.lerp(this.lookTarget, 1 - Math.exp(-lambda * dt));
    this.rig.setCine(F.localToWorld(this.camLocal.clone()), F.localToWorld(this.lookLocal.clone()), 40);
  }

  /** 1인칭 입수 연출: 머리 위치에서 진행 방향을 내려다봄 */
  private fpCam(lookDown: number, lambda = 8) {
    const d = this.diver;
    const yaw = d.root.rotation.y;
    const head = d.headWorld(V3());
    const f = V3(Math.sin(yaw), 0, Math.cos(yaw));
    this.rig.setCine(head.clone().addScaledVector(f, 0.1), head.clone().addScaledVector(f, 2).add(V3(0, -lookDown * 2, 0)), lambda);
  }

  private updateSwim(dt: number, t: number, mode: Mode) {
    const inp = this.input.state;
    if (mode === 'snorkel') {
      this.snorkel.update(dt, t, inp, this.rig.heading, this.diver);
      if (this.snorkel.diving && !this.lastSnorkDiving) this.bubbles.burst(this.diver.bubbleOrigin.getWorldPosition(V3()), 22, 0.1);
      this.lastSnorkDiving = this.snorkel.diving;
      this.ui.setSnorkelDepth(this.snorkel.depth, this.snorkel.breath, this.snorkel.mustSurface);
    } else {
      this.scuba.update(dt, t, inp, this.rig.heading, this.diver);
      const r = this.computer.update(dt, this.scuba.depth, this.scuba.yaw);
      this.ui.updateDive(r);
      if (r.safetyStop > 0 && r.depth >= 3 && r.depth <= 6.5) this.ui.hint('안전 정지 중 · 5m 부근에서 3분간 머물러요', false, 1.5);
      else if (r.lowAir) this.ui.hint('잔압이 낮아요 · 천천히 상승해 배로 돌아가 볼까요?', true, 3);
      if (r.depth < 0.8 && r.maxDepth > 4 && !this.surfacedHinted && !this.scuba.surfaced) { this.surfacedHinted = true; this.ui.hint(this.q.isTouch ? '수면 바로 아래예요 · ▲ 상승을 계속 누르면 물 밖으로 머리를 내밀어요' : '수면 바로 아래예요 · Space를 계속 누르면 물 밖으로 머리를 내밀어요', false, 6); }
    }
    this.updateInfo(mode);
    // 물고기가 바로 옆을 스쳐 갈 때의 미세한 물소리
    this.swishT -= dt;
    if (this.swishT < 0) {
      this.swishT = 0.4;
      let near = 99;
      for (const g of this.fish.groups) for (const a of g.agents) { const dd = a.pos.distanceTo(this.info.pos); if (dd < near && a.vel.length() > 0.35) near = dd; }
      if (near < 1.8) { this.audio.swish(clamp(2 - near, 0.3, 1)); this.swishT = 1.2; }
    }
  }
}
export type { View };

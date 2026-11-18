// DOM 오버레이: 화면 중앙은 비우고, 반투명·소형 UI만 가장자리에
import './style.css';
import { store, type Phase, type AppState } from '../core/store';
import type { DiveReadout } from '../dive/DiveComputer';
import type { Input } from '../control/Input';
import type { Collection } from '../life/Collection';
import type { SpeciesDef } from '../life/types';
import type { ChatMsg } from '../net/Multiplayer';
import { chatRefusal, CHAT_MAX } from '../../server/chatFilter.js';
import { CODEX, TIER_NAME, TIER_EN, TIER_STARS, tierOf, type Tier } from '../data/codex';

export interface UIHandlers {
  board(): void; skip(): void;
  /** 체험 존에서 시점을 골라 시작 */
  select(mode: 'snorkel' | 'scuba', view: 'first' | 'third'): void;
  dismissZone(): void; returnToBoat(): void; toggleView(): void; toggleMap(): void;
  /** 채팅 보내기 (보냈으면 true) */
  sendChat(text: string): boolean;
  /** 손 인사 */
  wave(): void;
}

const html = String.raw;

export class UI {
  el: Record<string, HTMLElement> = {};
  private toastTimer = 0;
  private hintTimer = 0;
  private lastHint = '';

  constructor(private root: HTMLElement, private h: UIHandlers, private isTouch: boolean, private input: Input) {
    if (isTouch) document.body.classList.add('touch');
    root.innerHTML = html`
      <div class="layer on" id="loading"><div><div class="t">BLUE IMMERSION</div><div class="bar"><i></i></div></div></div>

      <div class="layer" id="title">
        <h1>BLUE IMMERSION</h1>
        <p class="sub">언제든 들어갈 수 있는 바닷속 작은 휴식처</p>
        <button class="btn primary pe" data-act="board">배에 탑승하기</button>
        <div class="note">${isTouch ? '가로 화면을 권장해요 · 소리를 켜면 더 깊이 들어갈 수 있어요' : '화면을 드래그해 둘러보기 · 소리를 켜면 더 깊이 들어갈 수 있어요'}</div>
      </div>

      <div class="layer" id="cruise">
        <div class="caption">모든 바다가 만나는 곳으로 이동 중<b>THE WORLD OCEAN</b></div>
        <button class="btn small skip pe" data-act="skip">건너뛰기 →</button>
      </div>

      <div class="layer" id="gear">
        <div class="steps glass"><div class="k">GEAR UP</div><h3 id="gearTitle">장비 착용</h3><ol id="gearList"></ol></div>
      </div>

      <div class="layer" id="hud">
        <div id="dc">
          <div class="lbl">DEPTH</div>
          <div class="depth"><span id="dcDepth">0.0</span><small>m</small></div>
          <div class="grid">
            <div><span class="lbl">DIVE TIME</span><b id="dcTime">0:00</b></div>
            <div><span class="lbl">MAX</span><b id="dcMax">0.0</b></div>
            <div><span class="lbl">TANK</span><b id="dcBar">200</b><div class="air"><i id="dcAir" style="width:100%"></i></div></div>
            <div><span class="lbl">NDL</span><b id="dcNdl">99</b></div>
            <div><span class="lbl">TEMP</span><b id="dcTemp">27°</b></div>
            <div><span class="lbl">STATE</span><b id="dcState">—</b></div>
          </div>
          <div class="rate"><span>ASC</span><span class="bars" id="dcRate"><i></i><i></i><i></i><i></i><i></i></span><span id="dcRateV">0</span></div>
          <div class="compass"><div class="ribbon" id="dcRibbon"></div></div>
          <div class="ss" id="dcSS">SAFETY STOP<b id="dcSSv">3:00</b></div>
        </div>
        <div id="snDepth"><span id="snD">0.0 m</span><div class="breath"><i id="snB"></i></div><small>숨</small></div>
        <div class="top-right">
          <button class="icon-btn pe" data-act="map" tabindex="-1" title="지도 (M)" data-s="지도"><i>🗺</i><span class="lb">지도</span></button>
          <button class="icon-btn pe codex-btn" data-act="codex" tabindex="-1" title="나의 컬렉션" data-s="도감"><i>📖</i><b class="cxn">0/0</b></button>
          <button class="icon-btn pe" data-act="view" id="viewBtn" tabindex="-1" data-s="시점"><i>👁</i><span class="lb">1인칭으로</span></button>
          <button class="icon-btn pe soc" data-act="chat" title="채팅 (Enter)" data-s="채팅"><i>💬</i><span class="lb">채팅</span><b class="badge"></b></button>
          <button class="icon-btn pe soc" data-act="wave" title="손 인사 (H)" data-s="인사"><i>👋</i><span class="lb">손 인사</span></button>
          <button class="icon-btn pe" data-act="settings" title="설정" data-s="설정"><i>⚙</i><span class="lb">설정</span></button>
          <button class="icon-btn pe" data-act="return" title="판툰으로 복귀" data-s="복귀"><i>⛵</i><span class="lb">판툰으로 복귀</span></button>
        </div>
        <div class="keys" id="keys"></div>
        <div class="hint" id="hint"></div>
        <div class="prompt" id="prompt"></div>
        <div id="zoneSel" class="glass">
          <div class="k" id="zoneK">SNORKEL ZONE</div>
          <h3 id="zoneTitle">스노클링 존</h3>
          <p id="zoneDesc"></p>
          <div class="vrow">
            <button class="vcard pe" data-act="zoneFirst"><b>1인칭</b><span>마스크 너머로 바로 눈앞에서.<br>물고기가 코앞을 스쳐 지나가요.</span></button>
            <button class="vcard pe" data-act="zoneThird"><b>3인칭</b><span>내 캐릭터와 주변 바다를<br>함께 바라보며 유영해요.</span></button>
          </div>
          <button class="btn small later pe" data-act="zoneLater">조금 더 둘러볼게요</button>
          <div class="disc">판툰 위에서는 3인칭으로 보이고, 물에 들어가면 고른 시점으로 바뀌어요 · 물속에서 시점 버튼(V)으로 언제든 바꿀 수 있어요 · 가상 체험이며 실제 다이빙 교육을 대신하지 않아요</div>
        </div>
        <div class="toast" id="toast"></div>
        <div id="discover"></div>
        <div id="boatTag"></div>
        <div class="touch-layer" id="touch">
          <div class="joy-zone" id="joyZone"><div class="joy-base" id="joyBase"><div class="joy-knob" id="joyKnob"></div></div></div>
          <div class="act" id="act"></div>
        </div>
      </div>

      <div id="settings">
        <div class="panel glass">
          <h3>소리 · 조작</h3>
          ${(['master:전체 소리', 'ambient:환경음', 'creature:생물 효과음', 'gear:장비 소리', 'music:배경음악'] as const).map((s) => {
            const [k, n] = s.split(':');
            return `<div class="r"><label>${n}</label><input type="range" min="0" max="1" step="0.05" data-audio="${k}"><span data-v="${k}"></span></div>`;
          }).join('')}
          <div class="r"><label>시점 감도</label><input type="range" min="0.4" max="2" step="0.1" data-sens><span data-sv></span></div>
          <div class="foot"><span id="perf"></span><button class="btn small" data-act="closeSettings">닫기</button></div>
        </div>
      </div>
      <div id="codex"><div class="panel glass" id="codexPanel"></div></div>
      <div id="chat" class="glass">
        <header><b>💬 바다 채팅</b><small id="chatWho"></small><button class="x" data-act="closeChat" title="닫기 (Esc)">✕</button></header>
        <div id="chatLog"><div class="empty">아직 대화가 없어요 · 먼저 인사해 보세요 👋</div></div>
        <form id="chatForm" autocomplete="off"><input id="chatIn" maxlength="${CHAT_MAX}" placeholder="모두에게 보낼 말을 적어 주세요" enterkeyhint="send" autocomplete="off" autocorrect="off" spellcheck="false"><button type="submit">보내기</button></form>
        <div class="rule" id="chatRule">지금 접속한 모두가 보는 채팅방이에요 · 욕설·비하·연락처·링크는 자동으로 막혀요</div>
      </div>
      <div id="mp"><div class="chip"><i id="mpDot"></i><b id="mpCount">1</b>명 접속 · <span id="mpNick"></span></div><div id="mpFeed"></div></div>
      <button class="icon-btn pe-always" id="mute" data-s="소리">🔊</button>
      <div id="fade"></div>
    `;
    root.querySelectorAll<HTMLElement>('[id]').forEach((e) => (this.el[e.id] = e));
    root.addEventListener('click', (e) => this.onClick(e));
    this.el.codex.addEventListener('click', (e) => { if (e.target === this.el.codex) this.closeCodex(); });
    root.querySelectorAll<HTMLInputElement>('[data-audio]').forEach((inp) => {
      const k = inp.dataset.audio as keyof AppState['audio'];
      inp.value = String(store.get().audio[k]);
      inp.addEventListener('input', () => store.set({ audio: { ...store.get().audio, [k]: Number(inp.value) } }));
    });
    const sens = root.querySelector<HTMLInputElement>('[data-sens]')!;
    sens.value = String(store.get().lookSensitivity);
    sens.addEventListener('input', () => store.set({ lookSensitivity: Number(sens.value) }));
    this.el.mute.addEventListener('click', () => store.set({ muted: !store.get().muted }));
    store.subscribe((s, p) => this.render(s, p));
    this.render(store.get(), store.get());
    this.setupTouch();
    this.setupChat();
    this.el.keys.innerHTML = '';
  }

  private onClick(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t) return;
    // 키보드(Space·Enter)로 발생한 가짜 클릭은 무시: 시점 버튼 등이 몰래 다시 눌리는 문제 방지
    if (e.detail === 0 && t.dataset.act === 'view') return;
    const a = t.dataset.act!;
    if (a === 'board') this.h.board();
    else if (a === 'skip') this.h.skip();
    else if (a === 'zoneFirst' || a === 'zoneThird') { if (this.zone) this.h.select(this.zone, a === 'zoneFirst' ? 'first' : 'third'); }
    else if (a === 'zoneLater') this.h.dismissZone();
    else if (a === 'map') this.h.toggleMap();
    else if (a === 'view') this.h.toggleView();
    else if (a === 'return') this.h.returnToBoat();
    else if (a === 'settings') store.set({ settingsOpen: true });
    else if (a === 'closeSettings') store.set({ settingsOpen: false });
    else if (a === 'codex') this.openCodex();
    else if (a === 'closeCodex') this.closeCodex();
    else if (a === 'chat') this.toggleChat();
    else if (a === 'closeChat') this.toggleChat(false);
    else if (a === 'wave') this.h.wave();
    // 클릭한 버튼에 포커스가 남으면 Space/Enter(상승 키)가 그 버튼을 다시 눌러 버림 → 즉시 해제
    t.blur();
  }

  private render(s: AppState, p: AppState) {
    const layerOf: Partial<Record<Phase, string>> = { loading: 'loading', title: 'title', cruise: 'cruise', anchored: 'hud', gearing: 'gear', swim: 'hud' };
    for (const id of ['loading', 'title', 'cruise', 'gear', 'hud']) this.el[id].classList.toggle('on', layerOf[s.phase] === id);
    this.el.settings.classList.toggle('show', s.settingsOpen);
    this.el.mute.textContent = s.muted ? '🔇' : '🔊';
    // 버튼은 '누르면 바뀔 시점'을 보여줌: 지금 1인칭이면 3인칭으로, 3인칭이면 1인칭으로
    (this.el.viewBtn.querySelector('.lb') as HTMLElement).textContent = s.view === 'first' ? '3인칭으로' : '1인칭으로';
    this.el.viewBtn.dataset.s = s.view === 'first' ? '3인칭' : '1인칭';
    // 수중·판툰 HUD에선 소리 버튼도 오른쪽 위 버튼 줄에 같이 (모바일에서 따로 떠서 겹치지 않게)
    const tr = this.root.querySelector('#hud .top-right')!;
    const hudOn = s.phase === 'swim' || s.phase === 'anchored';
    if (hudOn && this.el.mute.parentElement !== tr) tr.appendChild(this.el.mute);
    else if (!hudOn && this.el.mute.parentElement === tr) this.root.insertBefore(this.el.mute, this.el.fade);
    this.el.viewBtn.title = s.view === 'first' ? '지금은 1인칭 · 눌러서 3인칭으로 (V)' : '지금은 3인칭 · 눌러서 1인칭으로 (V)';
    this.root.querySelectorAll<HTMLElement>('[data-v]').forEach((e) => (e.textContent = Math.round(s.audio[e.dataset.v as keyof AppState['audio']] * 100) + ''));
    (this.root.querySelector('[data-sv]') as HTMLElement).textContent = s.lookSensitivity.toFixed(1);
    document.body.classList.toggle('phase-swim', s.phase === 'swim');
    document.body.classList.toggle('phase-deck', s.phase === 'anchored');
    document.body.classList.toggle('phase-hud', s.phase === 'swim' || s.phase === 'anchored');
    // 다이브 컴퓨터(수심·시간·잔압·방향)는 스쿠버 수중에서 항상 표시, 스노클 수심 표시는 스노클링에서만
    this.el.dc.classList.toggle('show', s.phase === 'swim' && s.mode === 'scuba');
    if (s.mode !== 'snorkel' || s.phase !== 'swim') this.el.snDepth.classList.remove('show');
    if (s.phase !== p.phase || s.mode !== p.mode) {
      this.el.touch.classList.toggle('on', s.phase === 'swim' || s.phase === 'anchored');
      this.buildActions(s.phase === 'anchored' ? 'deck' : s.mode);
      if (s.phase === 'swim') this.showKeys(s.mode);
      if (s.phase === 'anchored' && p.phase !== 'anchored') this.showKeys('deck');
      // 존 선택 카드는 판툰 위를 걸어 다닐 때만 — 남아 있으면 투명한 채로 다른 버튼을 가로막음
      if (s.phase !== 'anchored') this.showZone(null);
      if (s.phase !== 'swim') this.hideToast();
    }
  }

  setGearSteps(title: string, steps: string[], cur: number) {
    this.el.gearTitle.textContent = title;
    this.el.gearList.innerHTML = steps.map((s, i) => `<li class="${i < cur ? 'done' : i === cur ? 'cur' : ''}">${s}</li>`).join('');
  }
  /** 체험 존에 들어섰을 때: 시점 선택 카드 */
  zone: 'snorkel' | 'scuba' | null = null;
  showZone(z: 'snorkel' | 'scuba' | null) {
    this.zone = z;
    this.el.zoneSel.classList.toggle('show', !!z);
    if (!z) return;
    this.el.zoneSel.dataset.zone = z;
    this.el.zoneK.textContent = z === 'snorkel' ? 'SNORKEL ZONE · 0–5 m' : 'DIVE DECK · 5–30 m';
    this.el.zoneTitle.textContent = z === 'snorkel' ? '스노클링 존이에요 · 어떤 시점으로 들어갈까요?' : '다이빙 데크예요 · 어떤 시점으로 들어갈까요?';
    this.el.zoneDesc.textContent = z === 'snorkel'
      ? '장비 랙에서 마스크·스노클을 쓰고, 입수 계단에 앉아 오리발을 신은 뒤 얕은 산호초로 들어가요.'
      : '벤치에서 슈트·BCD·공기통을 메고, 다이빙 플랫폼에서 자이언트 스트라이드로 입수해요.';
  }
  /** 판툰 위 상호작용 안내 (선베드 눕기 등) · 터치는 버튼으로 */
  setPrompt(text: string) {
    const e = this.el.prompt;
    const txt = text ? (this.isTouch ? text : `F · ${text}`) : '';
    if (e.textContent !== txt) e.textContent = txt;
    e.classList.toggle('show', !!text);
    const b = this.el.act.querySelector<HTMLElement>('[data-tap="act"]');
    if (b) { b.style.display = text ? '' : 'none'; const l = b.querySelector('b'); if (l && l.textContent !== text) l.textContent = text; }
  }

  /** 첫 로딩 화면(index.html의 #boot): 진행률 + 지금 하는 일 */
  setLoading(p: number, step?: string) {
    (this.el.loading.querySelector('.bar i') as HTMLElement).style.width = `${Math.round(p * 100)}%`;
    const bar = document.getElementById('bootBar');
    if (bar) { bar.classList.remove('wait'); (bar.firstElementChild as HTMLElement).style.width = `${Math.round(p * 100)}%`; }
    const st = document.getElementById('bootStep');
    if (st && step) st.textContent = step;
  }
  /** 로딩이 끝나면 첫 로딩 화면을 서서히 걷어냄 */
  hideBoot() {
    const b = document.getElementById('boot');
    if (!b) return;
    b.classList.add('done');
    setTimeout(() => b.remove(), 1000);
  }
  fade(on: boolean) { this.el.fade.classList.toggle('on', on); }

  hint(text: string, warn = false, hold = 4) {
    const e = this.el.hint;
    if (!text) { e.classList.remove('show'); this.lastHint = ''; return; }
    if (text !== this.lastHint) { e.textContent = text; this.lastHint = text; }
    e.classList.add('show'); e.classList.toggle('warn', warn);
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => { e.classList.remove('show'); this.lastHint = ''; }, hold * 1000);
  }

  /** 생물 이름 표시 — 숨김은 SpawnDirector가 생물이 시야에서 사라질 때 호출 (안전장치로 최대 8초) */
  toast(name: string, en: string, tier: Tier = 0, isNew = false) {
    const e = this.el.toast;
    const badge = `<i class="tier t${tier}">${TIER_STARS[tier]} ${TIER_NAME[tier]}</i>${isNew ? '<i class="new">NEW · 컬렉션 등록</i>' : ''}`;
    e.className = `toast t${tier}`;
    e.innerHTML = `${badge}<div>${name}</div><small>${en}</small>`;
    e.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => e.classList.remove('show'), 8000);
  }
  hideToast() { clearTimeout(this.toastTimer); this.el.toast.classList.remove('show'); }

  /** 수면 위에서 보이는 판툰 위치 표시 */
  setBoatTag(show: boolean, x: number, y: number, dist: number, side: number) {
    const e = this.el.boatTag;
    e.classList.toggle('show', show);
    if (!show) return;
    const txt = `${side < 0 ? '◀ ' : ''}⛵ 판툰 ${Math.round(dist)}m${side > 0 ? ' ▶' : ''}`;
    if (e.textContent !== txt) e.textContent = txt;
    e.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -100%)`;
  }

  // ───────── 바다 생물 컬렉션 ─────────
  private col?: Collection;
  private discoverTimer = 0;
  get codexOpen() { return this.el.codex.classList.contains('show'); }
  setCollection(c: Collection) { this.col = c; this.updateCodexCount(); }
  updateCodexCount() {
    if (!this.col) return;
    const txt = `${this.col.count}/${this.col.total}`;
    this.root.querySelectorAll<HTMLElement>('.cxn').forEach((e) => (e.textContent = txt));
  }
  /** 희귀·전설 생물을 처음 만났을 때: 화면 위쪽 소장 카드 */
  discover(sp: SpeciesDef, photo?: string | null) {
    const tier = tierOf(sp.id);
    const e = this.el.discover;
    e.className = `t${tier}`;
    e.innerHTML = `<div class="k">${TIER_STARS[tier]} ${tier === 3 ? '전설의 생물 발견!' : '희귀 생물 발견!'}</div>
      ${photo ? `<img class="ph" src="${photo}" alt="">` : ''}
      <h3>${sp.nameKo}</h3><small>${sp.nameEn} · <i>${sp.sci}</i></small>
      <p>${CODEX[sp.id]?.desc ?? ''}</p>
      <div class="foot">📖 나의 컬렉션에 소장되었어요 · ${this.col ? `${this.col.count}/${this.col.total}` : ''}</div>`;
    void e.offsetWidth;
    e.classList.add('show');
    clearTimeout(this.discoverTimer);
    this.discoverTimer = window.setTimeout(() => e.classList.remove('show'), tier === 3 ? 7000 : 5500);
  }
  openCodex() {
    if (!this.col) return;
    const c = this.col;
    const fmt = (t: number) => { const d = new Date(t); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };
    let body = '';
    for (const tier of [3, 2, 1, 0] as Tier[]) {
      const [got, all] = c.countTier(tier);
      body += `<section class="t${tier}"><h4><span>${TIER_STARS[tier]}</span> ${TIER_NAME[tier]} <em>${TIER_EN[tier]}</em><b>${got} / ${all}</b></h4><div class="grid">`;
      for (const sp of c.all.filter((s) => tierOf(s.id) === tier)) {
        const f = c.found[sp.id], cx = CODEX[sp.id];
        body += f
          ? `<article class="got">${c.photos[sp.id] ? `<img class="ph" src="${c.photos[sp.id]}" alt="${sp.nameKo} 사진" loading="lazy">` : `<div class="ph none">사진은 다음에 만나면 찍혀요</div>`}<h5>${sp.nameKo}</h5><small>${sp.nameEn} · <i>${sp.sci}</i></small><p>${cx.desc}</p><div class="meta">처음 만난 날 ${fmt(f.first)} · ${f.count}번 만남${f.depth > 0.5 ? ` · 최대 ${f.depth.toFixed(1)}m` : ''}</div></article>`
          : `<article class="lock"><div class="ph none">?</div><h5>???</h5><p>아직 만나지 못한 생물이에요.</p><div class="meta">힌트 · ${cx.hint}</div></article>`;
      }
      body += '</div></section>';
    }
    this.el.codexPanel.innerHTML = `<header><div><div class="k">MY SEA COLLECTION</div><h3>나의 바다 생물 컬렉션</h3></div>
      <div class="sum"><b>${c.count}</b> / ${c.total}종<button class="btn small" data-act="closeCodex">닫기</button></div></header>
      <p class="lead">물속에서 화면에 담긴 생물이 자동으로 기록돼요. 희귀·전설 등급은 쉽게 나타나지 않으니 깊은 곳과 탁 트인 바다를 천천히 둘러보세요.</p>${body}`;
    this.el.codex.classList.add('show');
    this.el.codexPanel.scrollTop = 0;
  }
  closeCodex() { this.el.codex.classList.remove('show'); }

  private showKeys(mode: AppState['mode'] | 'deck') {
    if (this.isTouch) return;
    const k = this.el.keys;
    k.innerHTML = mode === 'deck'
      ? '클릭한 곳으로 걷기 (<kbd>W A S D</kbd>도 가능) · 드래그 둘러보기 · 선베드 클릭 또는 <kbd>F</kbd> 눕기 · <kbd>M</kbd> 지도'
      : mode === 'scuba'
      ? '<kbd>W A S D</kbd> 이동 · <kbd>Space</kbd> 상승(수면에서 계속 누르면 물 밖으로) · <kbd>Shift</kbd> 하강 · <kbd>Q</kbd> 정지 · <kbd>M</kbd> 지도 · <kbd>V</kbd> 시점'
      : '<kbd>W A S D</kbd> 이동 · <kbd>Shift</kbd> 잠수(놓으면 그 깊이 유지) · <kbd>Space</kbd> 수면으로 / 고개 들기 · <kbd>M</kbd> 지도 · <kbd>V</kbd> 시점 · 드래그 시점';
    k.style.opacity = '1';
    setTimeout(() => (k.style.opacity = '0'), 12000);
  }

  // ───────── 터치 조작 ─────────
  //  조이스틱은 제자리에 고정. 손가락을 테두리 밖(화면 어디든)으로 끌어도 그 방향으로 최고 속도 이동이 계속됨
  //  · 터치는 Touch 이벤트로 손가락 ID를 끝까지 추적 (요소 밖으로 나가도 처음 누른 요소로 계속 전달되어 가장 확실함)
  //  · 마우스·펜은 Pointer 이벤트 + window에서 추적
  private setupTouch() {
    const zone = this.el.joyZone, base = this.el.joyBase, knob = this.el.joyKnob;
    const R = 52;            // 노브가 움직이는 반지름 (px)
    let touchId: number | null = null, ptrId: number | null = null;
    const move = (x: number, y: number) => {
      const r = base.getBoundingClientRect();
      let dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
      const l = Math.hypot(dx, dy);
      // 테두리 밖: 노브는 테두리에 붙어 있고, 방향은 손가락 쪽 · 세기는 최대
      if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const m = Math.min(1, l / (R * 0.85));
      const k = m < 0.12 ? 0 : (m - 0.12) / 0.88;
      this.input.setTouchMove((dx / Math.max(Math.min(l, R), 1)) * k, (-dy / Math.max(Math.min(l, R), 1)) * k);
    };
    const release = () => { touchId = null; ptrId = null; knob.style.transform = ''; base.classList.remove('active'); this.input.setTouchMove(0, 0); };
    const find = (list: TouchList) => { for (let i = 0; i < list.length; i++) if (list[i].identifier === touchId) return list[i]; return null; };
    // 터치
    zone.addEventListener('touchstart', (e) => {
      if (touchId !== null) return;
      const t = e.changedTouches[0];
      touchId = t.identifier; base.classList.add('active'); move(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    const tmove = (e: TouchEvent) => { if (touchId === null) return; const t = find(e.changedTouches); if (t) { move(t.clientX, t.clientY); e.preventDefault(); } };
    const tend = (e: TouchEvent) => { if (touchId !== null && find(e.changedTouches)) release(); };
    document.addEventListener('touchmove', tmove, { passive: false });
    document.addEventListener('touchend', tend); document.addEventListener('touchcancel', tend);
    // 마우스·펜 (터치는 위에서 처리하므로 제외)
    zone.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || ptrId !== null || touchId !== null) return;
      ptrId = e.pointerId; base.classList.add('active'); move(e.clientX, e.clientY); e.preventDefault();
    });
    addEventListener('pointermove', (e) => { if (e.pointerId === ptrId) move(e.clientX, e.clientY); });
    const pend = (e: PointerEvent) => { if (e.pointerId === ptrId) release(); };
    addEventListener('pointerup', pend); addEventListener('pointercancel', pend);
    // 조이스틱이 숨겨질 때(판툰 복귀 등) 눌린 채로 남지 않게
    store.subscribe((st, p) => { if (st.phase !== p.phase && (touchId !== null || ptrId !== null)) release(); });
  }

  private buildActions(mode: AppState['mode'] | 'deck') {
    const act = this.el.act;
    if (mode === 'deck') {
      act.innerHTML = `<button data-tap="act" style="display:none"><span class="ar">🛏</span><b>눕기</b></button>`;
    } else if (mode === 'snorkel') {
      act.innerHTML = `<button data-hold="down"><span class="ar">↓</span>잠수</button><button data-hold="up"><span class="ar">↑</span>수면</button>`;
    } else if (mode === 'scuba') {
      act.innerHTML = `<button data-hold="up"><span class="ar">▲</span>상승</button><button data-hold="stop">정지</button><button data-hold="down"><span class="ar">▼</span>하강</button>`;
    } else act.innerHTML = '';
    // 채팅·손 인사 (터치 화면에서는 오른쪽 아래 버튼 묶음 맨 위에)
    act.insertAdjacentHTML('afterbegin', `<button data-act="chat" class="soc"><span class="ar">💬</span>채팅<b class="badge"></b></button><button data-act="wave" class="soc"><span class="ar">👋</span>인사</button>`);
    this.renderBadge();
    act.querySelectorAll<HTMLButtonElement>('[data-tap="act"]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => { this.input.queueInteract(); b.classList.add('held'); setTimeout(() => b.classList.remove('held'), 180); e.preventDefault(); });
    });
    act.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach((b) => {
      const k = b.dataset.hold as 'up' | 'down' | 'stop';
      const on = (e: PointerEvent) => { b.setPointerCapture(e.pointerId); b.classList.add('held'); this.input.setTouchButton(k, true); e.preventDefault(); };
      const off = () => { b.classList.remove('held'); this.input.setTouchButton(k, false); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
    });
  }

  // ───────── 다이브 컴퓨터 ─────────
  updateDive(r: DiveReadout) {
    const $ = this.el;
    $.dcDepth.textContent = r.depth.toFixed(1);
    $.dcMax.textContent = r.maxDepth.toFixed(1);
    const m = Math.floor(r.time / 60), s = Math.floor(r.time % 60);
    $.dcTime.textContent = `${m}:${String(s).padStart(2, '0')}`;
    $.dcBar.textContent = Math.round(r.pressure) + '';
    $.dcBar.classList.toggle('warn', r.lowAir);
    $.dcAir.style.width = `${(r.pressure / 200) * 100}%`;
    $.dcNdl.textContent = r.ndl >= 99 ? '99+' : Math.floor(r.ndl) + '';
    $.dcNdl.classList.toggle('warn', r.ndl < 5);
    $.dcTemp.textContent = r.temp.toFixed(0) + '°C';
    $.dcState.textContent = r.rate > 1.5 ? '상승' : r.rate < -1.5 ? '하강' : '호버링';
    const bars = $.dcRate.children;
    const lvl = Math.max(0, Math.min(5, Math.ceil(r.rate / 5)));
    for (let i = 0; i < 5; i++) { bars[i].classList.toggle('on', i < lvl); bars[i].classList.toggle('hot', i >= 4); }
    $.dcRateV.textContent = `${Math.max(0, r.rate).toFixed(0)} m/min`;
    const dirs = ['N', '·', 'NE', '·', 'E', '·', 'SE', '·', 'S', '·', 'SW', '·', 'W', '·', 'NW', '·'];
    let rib = '';
    for (let k = -4; k <= 4; k++) { const i = (Math.round(r.heading / 22.5) + k + 16) % 16; rib += `<span style="display:inline-block;width:18px;text-align:center">${dirs[i]}</span>`; }
    $.dcRibbon.innerHTML = rib;
    const off = ((r.heading / 22.5) % 1) * 18;
    $.dcRibbon.style.left = `calc(50% - ${4.5 * 18 + off}px)`;
    $.dcSS.classList.toggle('show', r.safetyStop >= 0 || r.safetyDone && r.depth > 2.5);
    if (r.safetyDone) $.dcSSv.textContent = '완료 ✓';
    else if (r.safetyStop >= 0) { const sm = Math.floor(r.safetyStop / 60), ss = Math.floor(r.safetyStop % 60); $.dcSSv.textContent = `${sm}:${String(ss).padStart(2, '0')}`; }
  }

  setSnorkelDepth(d: number, breath: number, low: boolean) {
    this.el.snDepth.classList.toggle('show', d > 0.4 || breath < 0.98);
    this.el.snD.textContent = `${d.toFixed(1)} m / 5 m`;
    this.el.snB.style.width = `${Math.round(breath * 100)}%`;
    this.el.snB.classList.toggle('low', low || breath < 0.3);
  }
  setPerf(text: string) { this.el.perf.textContent = text; }

  // ───────── 멀티유저 ─────────
  setOnline(count: number, nick: string, mode: 'ws' | 'local' | 'off') {
    this.el.mpCount.textContent = String(count);
    this.el.mpNick.textContent = nick;
    this.el.mpDot.className = mode;
    this.el.mp.title = mode === 'ws' ? '멀티 서버에 연결됨' : mode === 'local' ? '서버 없음 · 같은 브라우저의 다른 탭과 연결' : '혼자 체험 중';
  }
  // ───────── 채팅 ─────────
  private unread = 0;
  get chatOpen() { return this.el.chat.classList.contains('show'); }
  private setupChat() {
    const form = this.el.chatForm as HTMLFormElement, inp = this.el.chatIn as HTMLInputElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!inp.value.trim()) return;
      if (this.h.sendChat(inp.value)) inp.value = '';
    });
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { this.toggleChat(false); inp.blur(); }
    });
    inp.addEventListener('keyup', (e) => e.stopPropagation());
    // 폰 키보드가 올라오면 보이는 영역 안에 채팅창을 맞춤
    const vv = window.visualViewport;
    const fit = () => {
      const c = this.el.chat;
      if (!vv || !this.isTouch) { c.style.removeProperty('--vvh'); c.style.removeProperty('--vvt'); return; }
      c.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      c.style.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`);
    };
    vv?.addEventListener('resize', fit); vv?.addEventListener('scroll', fit);
    fit();
    this.el.chatLog.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
  }
  toggleChat(on = !this.chatOpen) {
    this.el.chat.classList.toggle('show', on);
    document.body.classList.toggle('chat-open', on);
    if (on) {
      this.unread = 0; this.renderBadge();
      const log = this.el.chatLog; log.scrollTop = log.scrollHeight;
      // 데스크톱은 바로 입력, 터치는 입력칸을 눌렀을 때 키보드가 올라오게 (화면이 갑자기 가려지지 않게)
      if (!this.isTouch) setTimeout(() => (this.el.chatIn as HTMLInputElement).focus(), 30);
    } else (this.el.chatIn as HTMLInputElement).blur();
  }
  private renderBadge() {
    const txt = this.unread ? (this.unread > 9 ? '9+' : String(this.unread)) : '';
    this.root.querySelectorAll<HTMLElement>('.badge').forEach((b) => { b.textContent = txt; b.classList.toggle('on', !!txt); });
  }
  addChat(c: ChatMsg, history: boolean) {
    const log = this.el.chatLog;
    log.querySelector('.empty')?.remove();
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const row = document.createElement('div');
    row.className = 'm' + (c.mine ? ' mine' : '');
    const who = document.createElement('b'); who.textContent = c.mine ? `${c.nick} (나)` : c.nick;
    if (!c.mine) who.style.color = `hsl(${Math.round(c.hue * 360)}, 75%, 72%)`;
    const msg = document.createElement('span'); msg.textContent = c.x;   // 사용자 글은 항상 텍스트로만 (HTML로 해석하지 않음)
    const tm = document.createElement('time'); const d = new Date(c.at); tm.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    row.append(who, msg, tm);
    log.appendChild(row);
    while (log.children.length > 120) log.firstElementChild!.remove();
    if (near || c.mine) log.scrollTop = log.scrollHeight;
    if (!this.chatOpen && !c.mine && !history) {
      this.unread++; this.renderBadge();
      this.mpNotice(`💬 ${c.nick} · ${c.x}`);
    }
  }
  chatRefused(why: string) {
    const t = chatRefusal(why);
    if (!t) return;
    const r = this.el.chatRule;
    r.textContent = t; r.classList.add('warn');
    clearTimeout(this.ruleTimer);
    this.ruleTimer = window.setTimeout(() => { r.textContent = '지금 접속한 모두가 보는 채팅방이에요 · 욕설·비하·연락처·링크는 자동으로 막혀요'; r.classList.remove('warn'); }, 4000);
    if (!this.chatOpen) this.mpNotice(t);
  }
  private ruleTimer = 0;
  setChatWho(count: number) { this.el.chatWho.textContent = `${count}명 접속 중`; }

  private feedTimer = 0;
  mpNotice(text: string) {
    const f = this.el.mpFeed;
    f.textContent = text; f.classList.add('show');
    clearTimeout(this.feedTimer);
    this.feedTimer = window.setTimeout(() => f.classList.remove('show'), 3500);
  }
}

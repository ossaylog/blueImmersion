// 입력 정규화: 키보드·마우스·터치 → InputState
//  컨트롤러는 장치를 모름. 터치는 포인터 ID별로 영역(조이스틱/카메라/버튼)을 분리해 멀티터치 지원.
export interface InputState {
  move: { x: number; y: number };   // x: 좌우, y: 전후 (+전진), 크기 0~1
  up: boolean; down: boolean;
  look: { x: number; y: number };   // 이번 프레임 카메라 회전량 (px)
  zoom: number;
  equalize: boolean;                // 이번 프레임에 눌림
  stop: boolean;                    // 호버링(정지) 요청
  interact: boolean;                // 이번 프레임에 눌림: 판툰에서 선베드 눕기·일어나기 (F)
}

export class Input {
  state: InputState = { move: { x: 0, y: 0 }, up: false, down: false, look: { x: 0, y: 0 }, zoom: 0, equalize: false, stop: false, interact: false };
  private keys = new Set<string>();
  private touchMove = { x: 0, y: 0 };
  private touchUp = false; private touchDown = false; private touchStop = false;
  private eqQueued = false;
  private actQueued = false;
  private dragId: number | null = null;
  private last = { x: 0, y: 0 };
  enabled = true;

  constructor(private surface: HTMLElement) {
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (e.code === 'KeyE') this.eqQueued = true;
      if (e.code === 'KeyF' && !e.repeat) this.actQueued = true;
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    // 카메라: 마우스 드래그 / 터치 드래그 (조이스틱·버튼이 아닌 곳)
    surface.addEventListener('pointerdown', (e) => {
      if (this.dragId !== null) return;
      this.dragId = e.pointerId; this.last = { x: e.clientX, y: e.clientY };
      surface.setPointerCapture(e.pointerId);
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.dragId) return;
      this.state.look.x += e.clientX - this.last.x; this.state.look.y += e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY };
    });
    const end = (e: PointerEvent) => { if (e.pointerId === this.dragId) this.dragId = null; };
    surface.addEventListener('pointerup', end); surface.addEventListener('pointercancel', end);
    surface.addEventListener('wheel', (e) => { this.state.zoom += Math.sign(e.deltaY) * 0.6; e.preventDefault(); }, { passive: false });
    // 브라우저 기본 제스처(스크롤/확대) 차단
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (e.target as HTMLElement)?.closest?.('#scene, .touch-layer')) e.preventDefault(); }, { passive: false });
    let lastTap = 0;
    document.addEventListener('touchend', (e) => { const n = Date.now(); if (n - lastTap < 300) e.preventDefault(); lastTap = n; }, { passive: false });
  }

  setTouchMove(x: number, y: number) { this.touchMove.x = x; this.touchMove.y = y; }
  setTouchButton(b: 'up' | 'down' | 'stop', v: boolean) { if (b === 'up') this.touchUp = v; else if (b === 'down') this.touchDown = v; else this.touchStop = v; }
  queueEqualize() { this.eqQueued = true; }
  queueInteract() { this.actQueued = true; }

  /** 프레임 시작 시 호출 → 상태 갱신 */
  poll() {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
    if (Math.hypot(this.touchMove.x, this.touchMove.y) > 0.05) { x = this.touchMove.x; y = this.touchMove.y; }
    const s = this.state;
    s.move.x = this.enabled ? x : 0; s.move.y = this.enabled ? y : 0;
    s.up = this.enabled && (k.has('Space') || this.touchUp);
    s.down = this.enabled && (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyC') || this.touchDown);
    s.stop = this.enabled && (k.has('KeyQ') || this.touchStop);
    s.equalize = this.eqQueued; this.eqQueued = false;
    s.interact = this.enabled && this.actQueued; this.actQueued = false;
  }
  /** 프레임 끝: 누적량 초기화 */
  consume() { this.state.look.x = 0; this.state.look.y = 0; this.state.zoom = 0; }
}

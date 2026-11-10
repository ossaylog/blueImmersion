// 전역 상태: Zustand와 같은 subscribe 패턴 (필요 시 1:1 치환 가능)
export type Phase = 'loading' | 'title' | 'boarding' | 'cruise' | 'docking' | 'transfer' | 'anchored' | 'gearing' | 'entry' | 'swim' | 'exiting';
export type Mode = 'snorkel' | 'scuba' | null;
export type View = 'first' | 'third';

export interface AudioSettings { master: number; ambient: number; creature: number; gear: number; music: number }

export interface AppState {
  phase: Phase;
  mode: Mode;
  gearStep: number;          // 장비 착용 진행 단계
  view: View;                // 1인칭 / 3인칭
  audio: AudioSettings;
  muted: boolean;
  settingsOpen: boolean;
  lookSensitivity: number;
  hint: string;              // 화면 하단 안내 문구
  encounter: string;         // 최근 마주친 생물 (발견 기록 확장용)
}

type Listener = (s: AppState, prev: AppState) => void;

const initial: AppState = {
  phase: 'loading', mode: null, gearStep: 0, view: 'third',
  audio: { master: 0.8, ambient: 0.9, creature: 0.8, gear: 0.8, music: 0 },
  muted: false, settingsOpen: false, lookSensitivity: 1, hint: '', encounter: '',
};

let state: AppState = initial;
const listeners = new Set<Listener>();

export const store = {
  get: () => state,
  set(patch: Partial<AppState>) {
    const prev = state;
    state = { ...state, ...patch };
    listeners.forEach((l) => l(state, prev));
  },
  subscribe(l: Listener) { listeners.add(l); return () => listeners.delete(l); },
};

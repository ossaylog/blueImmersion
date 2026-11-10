import * as THREE from 'three';
import type { BodyDef } from './FishBody';
import type { Habitat } from '../world/terrain';

export type Behavior = 'school' | 'hoverSchool' | 'mill' | 'wander' | 'graze' | 'hover' | 'cruise' | 'anemone' | 'turtle' | 'manta' | 'eagle' | 'stingray' | 'jelly';
export type SizeClass = 'small' | 'medium' | 'large' | 'mega' | 'resident';

export interface SpeciesDef {
  id: string; nameKo: string; nameEn: string; sci: string;
  sizeClass: SizeClass; length: number; behavior: Behavior; group: [number, number];
  habitats: Record<Habitat, number>; depth: [number, number];
  weight: number; stay: [number, number]; cooldown: number; speed: [number, number];
  curious: number; shy: number;
  /** 발견으로 인정하는 최대 거리 (작은 바닥 생물은 가까이 가야 보임) */
  seeDist?: number;
  body?: BodyDef; pattern?: number; colors: string[]; swim?: { freq: number; amp: number };
}

/** 다이버(플레이어) 정보: 생물이 반응하는 기준 */
export interface DiverInfo {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  forward: THREE.Vector3;
  idleTime: number;   // 멈춰 있던 시간 → 호기심 많은 생물이 다가옴
  active: boolean;    // 물속에 있을 때만
  fp: boolean;        // 1인칭: 생물이 더 가까이 지나감
}

/** SpawnDirector가 관리하는 출현 단위 (물고기 무리, 거북 한 마리 등) */
export interface Creature {
  sp: SpeciesDef;
  alive: boolean;
  leaving: boolean;
  life: number;
  encountered: boolean;
  center(): THREE.Vector3;
  leave(): void;
}

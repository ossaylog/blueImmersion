// 바다 생물 도감: 희귀도 등급 · 특징 · 발견 힌트
//  희귀도 기준 (docs/CREATURES.md 참고)
//   1) 실제 열대 리프 다이빙에서 마주치는 빈도
//   2) 개체 수·보전 상태 (IUCN 적색목록)
//   3) 계절·장소 의존성 (회유, 특정 해역에서만 무리)
//   4) 서식 방식 (리프에 사는 정주종 ↔ 먼 바다에서 잠깐 들르는 대양종)
import type { SpeciesDef } from '../life/types';

export type Tier = 0 | 1 | 2 | 3;
export const TIER_NAME = ['흔함', '보통', '희귀', '전설'] as const;
export const TIER_EN = ['COMMON', 'UNCOMMON', 'RARE', 'LEGENDARY'] as const;
export const TIER_STARS = ['★', '★★', '★★★', '★★★★'] as const;

export interface CodexEntry { tier: Tier; desc: string; hint: string }

export const CODEX: Record<string, CodexEntry> = {
  // ── 흔함: 거의 모든 다이빙에서 만나는 리프의 주인들 ──
  chromis: { tier: 0, desc: '형광 청록빛의 작은 자리돔. 수십 마리가 가지산호 위에 떠 있다가 위험하면 산호 가지 사이로 한꺼번에 숨어요.', hint: '얕은 가지산호 위' },
  anthias: { tier: 0, desc: '주황·분홍빛 꽃돔. 수컷 한 마리가 암컷 무리를 거느리고, 수컷이 사라지면 암컷이 수컷으로 성전환해요.', hint: '산호 벽 앞 물기둥' },
  fusilier: { tier: 0, desc: '등은 푸르고 꼬리는 노란 무리 고기. 리프 가장자리 물기둥을 빠르게 오가며 플랑크톤을 먹어요.', hint: '리프 가장자리 푸른 물' },
  snapper: { tier: 0, desc: '노란 몸에 파란 줄 네 개. 낮에는 바위 그늘에 촘촘히 모여 쉬고 밤에 흩어져 사냥해요.', hint: '바위 그늘·산호 벽' },
  butterfly: { tier: 0, desc: '등지느러미 끝에 실 같은 가닥이 늘어진 나비고기. 평생 짝을 지어 둘이 함께 다녀요.', hint: '산호초 위, 늘 두 마리' },
  tang: { tier: 0, desc: '선명한 파란 몸에 검은 팔레트 무늬. 꼬리자루에 메스처럼 날카로운 가시가 숨어 있어요.', hint: '산호 사이' },
  yellowtang: { tier: 0, desc: '온몸이 레몬색인 쥐치. 해조류를 뜯어 먹어 산호가 해조에 덮이지 않게 지켜줘요.', hint: '얕은 산호초' },
  idol: { tier: 0, desc: '흑·백·노랑 띠와 낫처럼 긴 등지느러미. 수족관에서 기르기 어려워 바다에서만 제대로 볼 수 있어요.', hint: '산호초 위' },
  parrotfish: { tier: 0, desc: '부리 같은 이빨로 산호를 갉아 먹고 고운 모래로 배출해요. 열대 해변 모래의 상당 부분이 앵무고기 작품이에요.', hint: '산호를 쪼는 소리를 따라' },
  emperor: { tier: 0, desc: '파랑·노랑 줄무늬의 화려한 엔젤피시. 어릴 때는 동심원 무늬로, 자라면서 완전히 다른 옷으로 갈아입어요.', hint: '산호 틈 근처' },
  clownfish: { tier: 0, desc: '말미잘의 독침에 면역인 점액으로 몸을 감싸고 말미잘 속에 살아요. 무리에서 가장 큰 개체가 암컷이에요.', hint: '배 주변 얕은 말미잘' },
  hermit: { tier: 0, desc: '흰 점이 박힌 붉은 소라게. 자라면 더 큰 고둥 껍데기로 이사하고, 다가가면 껍데기 속으로 쏙 숨어요.', hint: '모래와 잔해 바닥' },
  reefcrab: { tier: 0, desc: '붉은 바탕에 흰 점이 있는 둥근 게. 다가가면 집게를 번쩍 들어 위협한 뒤 옆걸음으로 달아나요.', hint: '산호 바닥' },
  urchin: { tier: 0, desc: '30cm까지 자라는 가느다란 가시를 가진 성게. 가시 끝이 쉽게 부러져 박히니 절대 만지면 안 돼요.', hint: '산호 틈과 암반' },
  starfish: { tier: 0, desc: '선명한 하늘색 불가사리. 몸이 잘려도 팔 하나에서 몸 전체가 다시 자라나요.', hint: '얕은 잔해 지대' },
  cucumber: { tier: 0, desc: '모래를 삼켜 유기물만 걸러 먹고 깨끗한 모래를 내보내는 바다의 청소부예요.', hint: '모래 바닥' },

  // ── 보통: 찾아보면 만나지만 매번 보이진 않는 생물 ──
  regalangel: { tier: 1, desc: '주황 몸에 남색 테두리의 흰 세로띠가 선명한 엔젤피시. 산호 틈의 해면과 피낭류를 조금씩 쪼아 먹어 기르기 까다로워요.', hint: '산호 틈을 쪼는 주황빛 줄무늬' },
  lionfish: { tier: 1, desc: '부채처럼 펼친 가슴지느러미와 독가시. 천천히 떠다니다 지느러미로 작은 물고기를 몰아 한입에 삼켜요.', hint: '산호 벽 그늘에서 거의 움직이지 않음' },
  moray: { tier: 1, desc: '벌집 무늬 곰치. 입을 벌렸다 닫는 건 위협이 아니라 아가미로 물을 보내 숨 쉬는 동작이에요.', hint: '바위 틈에서 머리만 내밂' },
  stingray: { tier: 1, desc: '황갈색 원반에 선명한 파란 점. 모래에 몸을 반쯤 묻고 쉬다가 조개와 새우를 찾아 먹어요.', hint: '산호 주변 모래밭' },
  batfish: { tier: 1, desc: '호기심이 많아 다이버에게 먼저 다가오는 박쥐고기. 어릴 때는 지느러미가 몸보다 몇 배나 길어요.', hint: '가만히 있으면 다가옴' },
  queenangel: { tier: 1, desc: '머리 위 파란 점이 왕관처럼 보이는 엔젤피시. 해면을 주식으로 하는 카리브해의 여왕이에요.', hint: '산호초 위' },
  garibaldi: { tier: 1, desc: '온몸이 주황색인 자리돔. 원래 캘리포니아 켈프숲의 물고기라 이 바다에서는 반가운 손님이에요.', hint: '바위가 많은 리프' },
  barracuda: { tier: 1, desc: '은빛 몸에 V자 무늬. 수십 마리가 소용돌이처럼 천천히 맴도는 모습이 장관이에요.', hint: '드롭오프 앞 푸른 물' },
  jack: { tier: 1, desc: '커다란 눈의 전갱이 무리. 수백 마리가 빙글빙글 도는 \'토네이도\'를 만들어요.', hint: '드롭오프·푸른 물' },
  moonjelly: { tier: 1, desc: '네 잎 클로버 같은 생식선이 비치는 투명한 해파리. 독이 약해 둥실 떠다니는 모습을 가까이서 볼 수 있어요.', hint: '탁 트인 물기둥' },
  seanettle: { tier: 1, desc: '주황빛 갓 아래로 긴 촉수가 수 미터 늘어지는 해파리. 촉수에 쏘이면 아프니 거리를 두세요.', hint: '탁 트인 물기둥' },
  blacktip: { tier: 1, desc: '지느러미 끝이 먹물에 찍은 듯 검은 상어. 얕은 리프와 석호를 순찰하며 사람을 보면 먼저 피해요.', hint: '얕은 모래 리프' },
  whitetip: { tier: 1, desc: '지느러미 끝이 흰 상어. 낮에는 동굴이나 바닥에서 쉬고, 다른 상어와 달리 멈춰서도 숨을 쉴 수 있어요.', hint: '모래 바닥·벽 아래' },
  lobster: { tier: 1, desc: '청록·흰 줄무늬의 닭새우. 낮에는 산호 밑에 숨어 긴 더듬이만 흔들고, 위협받으면 꼬리를 말아 뒤로 튀어요.', hint: '산호 밑 그늘의 흰 더듬이' },
  scallop: { tier: 1, desc: '껍데기를 여닫으며 물을 뿜어 헤엄치는 가리비. 외투막 가장자리에 수십 개의 작은 눈이 있어요.', hint: '모래 바닥, 가까이 가야 보임' },
  giantclam: { tier: 1, desc: '1m 넘게 자라는 세계 최대의 조개. 외투막 속 공생 조류가 광합성으로 영양을 만들어 줘요. 남획으로 수가 줄었어요.', hint: '햇빛 드는 얕은 리프' },

  // ── 희귀: 운이 좋아야 만나는 생물 ──
  turtle: { tier: 2, desc: '해초를 먹고 사는 바다거북. 수십 년 뒤 자기가 태어난 해변으로 돌아와 알을 낳아요. 멸종위기종이에요.', hint: '해초밭·얕은 리프 (수면으로 숨 쉬러 올라옴)' },
  hawksbill: { tier: 2, desc: '매 부리처럼 뾰족한 입으로 산호 틈의 해면을 뜯어 먹어요. 아름다운 등껍질 때문에 남획되어 위급(CR) 종이 되었어요.', hint: '산호초 사이' },
  wrasse: { tier: 2, desc: '2m까지 자라는 거대한 놀래기. 이마의 혹과 두툼한 입술이 특징이고, 호기심이 많아 다이버를 따라오기도 해요.', hint: '산호 벽을 따라 천천히' },
  bumphead: { tier: 2, desc: '이마로 산호를 들이받아 부숴 먹는 최대의 앵무고기. 무리 지어 다니며 밤에는 함께 잠을 자요.', hint: '얕은 리프 위 무리' },
  eagleray: { tier: 2, desc: '검은 등에 흰 점이 별처럼 박힌 가오리. 날개를 퍼덕이며 무리 지어 날 듯이 헤엄쳐요.', hint: '모래밭 위를 지나감' },
  greyreef: { tier: 2, desc: '꼬리지느러미 뒷가장자리가 검은 상어. 위협을 느끼면 등을 구부리고 몸을 비트는 경고 동작을 해요.', hint: '수심 7m 이상, 드롭오프' },
  zebrashark: { tier: 2, desc: '어릴 때는 얼룩말 줄무늬, 크면 표범 점무늬로 바뀌는 상어. 바닥에서 쉬는 순한 상어지만 멸종위기종이에요.', hint: '모래 바닥' },
  dolphin: { tier: 2, desc: '휘파람 같은 소리로 서로 이름을 부르는 똑똑한 포유류. 다이버 곁을 장난스럽게 스쳐 지나가곤 해요.', hint: '탁 트인 바다, 빠르게 지나감' },
  sardine: { tier: 2, desc: '수만 마리가 하나의 생명체처럼 움직이는 정어리 떼. 해마다 특정 해역에서만 볼 수 있는 \'사딘 런\'이에요.', hint: '푸른 물에서 은빛 구름' },
  triton: { tier: 2, desc: '산호를 갉아먹는 왕관불가사리의 천적인 대형 고둥. 껍데기 때문에 남획되어 지금은 보호종이에요.', hint: '산호 바닥을 아주 천천히' },

  // ── 전설: 평생 한 번 만나기도 어려운 대양의 거인들 ──
  manta: { tier: 3, desc: '날개폭 4m가 넘는 만타가오리. 몸무게 대비 가장 큰 뇌를 가진 어류이고, 배의 점무늬가 지문처럼 개체마다 달라요.', hint: '푸른 물 위쪽을 선회' },
  whaleshark: { tier: 3, desc: '세상에서 가장 큰 물고기. 버스만 한 몸집이지만 플랑크톤만 걸러 먹는 순한 거인이에요. 멸종위기종.', hint: '탁 트인 바다 수면 가까이' },
  humpback: { tier: 3, desc: '길이 13m가 넘는 고래. 수컷은 수십 분 동안 이어지는 복잡한 노래를 부르고, 그 노래는 해마다 조금씩 바뀌어요.', hint: '먼 바다, 노랫소리가 들리면…' },
  hammerhead: { tier: 3, desc: '망치 모양 머리 양끝의 눈으로 넓게 보고 전기 감각으로 먹이를 찾아요. 수백 마리 무리는 극소수 해역에서만 볼 수 있어요. 위급(CR).', hint: '수심 8m 이상, 드롭오프 바깥' },
  mola: { tier: 3, desc: '꼬리가 없는 듯 잘린 몸의 거대한 물고기. 심해에서 차가워진 몸을 데우러 가끔 얕은 곳에 올라와 옆으로 누워 쉬어요.', hint: '푸른 물, 아주 느리게' },
};

/** 정주 생물(직접 스폰되지 않음) 발견용 종 정보 */
const rs = (id: string, nameKo: string, nameEn: string, sci: string, length: number, seeDist: number) =>
  ({ id, nameKo, nameEn, sci, length, seeDist, sizeClass: 'small', behavior: 'wander' }) as unknown as SpeciesDef;
export const RESIDENT_SPECIES: Record<string, SpeciesDef> = {
  giantclam: rs('giantclam', '대왕조개', 'Giant clam', 'Tridacna gigas', 0.8, 4.5),
  urchin: rs('urchin', '긴가시성게', 'Long-spined sea urchin', 'Diadema setosum', 0.25, 2.6),
  starfish: rs('starfish', '파란불가사리', 'Blue sea star', 'Linckia laevigata', 0.25, 3),
  cucumber: rs('cucumber', '검은해삼', 'Black sea cucumber', 'Holothuria atra', 0.35, 3),
  moray: rs('moray', '벌집곰치', 'Laced moray', 'Gymnothorax favagineus', 1.2, 4),
};

export const tierOf = (id: string): Tier => CODEX[id]?.tier ?? 0;

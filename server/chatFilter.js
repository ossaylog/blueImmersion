// 채팅 필터: 비속어·성적 표현·혐오 표현·연락처·링크·도배를 막음
//  서버(relay.js)가 최종 판정하고, 클라이언트도 같은 규칙으로 미리 걸러 바로 안내함
//  우회 방지: 띄어쓰기·숫자·기호 끼워 넣기(시 1 발, 씨.발), 영문 숫자 치환(f*ck, sh1t), 자음만 쓰기(ㅅㅂ)

/** 한글 비속어 (띄어쓰기·숫자·기호를 지운 뒤 포함 여부로 판정) */
const KO = [
  // 욕설
  '시발', '씨발', '씨빨', '시빨', '씨벌', '시벌', '씨팔', '시팔', '씨펄', '시펄', '십팔', '씹새', '씹년', '씹놈', '씹창', '씹할', '쓰발', '쓰벌', '싸발', '싸벌',
  'ㅆㅂ', 'ㅅㅂ', 'ㅅ발', '시ㅂ', 'ㅆ발', '씨ㅂ',
  '병신', '븅신', '빙신', '병쉰', '등신', 'ㅂㅅ', 'ㅄ', '좆', '조까', '좃', '존나', '졸라', '존니', 'ㅈㄴ', 'ㅈ같', '지랄', '지럴', 'ㅈㄹ',
  '개새', '개색', '개세끼', '개쉐', '개섀', '개놈', '개년', '개같', '개자식', '썅', '쌍년', '쌍놈', '쌍노무',
  '씨새끼', '니새끼', '느금', '니애미', '니애비', '느개비', '애미뒤', '애미없', '엠창', '앰창', 
  '미친놈', '미친년', '미친새', '미친개', '미친색', '또라이', '돌아이', '닥쳐', '엿먹', '엿이나',
  '호로새', '호로자식', '호로놈', '후레자식', '상놈', '잡놈', '잡년', '걸레년', '화냥', '창녀', '창놈', '자위', '섹스', '쎅스', '섹하', '야동', 
  '젖꼭', '딸딸', '딸쳐', '강간', '성폭', '몸캠', '조건만남', '원나잇',
  // 혐오·비하
  '한남충', '김치녀', '된장녀', '틀딱', '급식충', '맘충', '페미충', '일베충', '짱깨', '쪽바리', '흑형', '깜둥', '장애새', '병자새',
  // 위협·자해
  '죽어라', '죽여버', '뒤져라', '뒈져', '디져라', '자살해',
];
/** 영어 비속어 (소문자·숫자 치환·반복 글자 압축 뒤 포함 여부) */
const EN = [
  'fuck', 'fck', 'shit', 'bitch', 'biatch', 'asshole', 'cunt', 'dick', 'pussy', 'porn', 'sex', 'slut', 'whore',
  'bastard', 'nigg', 'nigga', 'faggot', 'retard', 'motherf', 'wtf', 'stfu', 'penis', 'vagina', 'boob', 'tits', 'kys',
];
/** 단독으로 쓰면 욕이 되는 것 (메시지 전체가 이것뿐이거나 그 앞뒤가 한글 단어가 아닐 때) */
const SOLO = /(^|[^가-힣])(ㅗ+|ㅆ+)([^가-힣]|$)|^\s*18\s*$|18\s*(놈|새끼|새기)/;
const LINK = /(https?:\/\/|www\.|\.(com|net|kr|io|gg|me|ly|xyz|org|co)\b|discord|open\.kakao|카톡\s*아이디|텔레그램|t\.me\/)/i;
const PHONE = /(01[016789]|0\d{1,2})[\s.-]?\d{3,4}[\s.-]?\d{4}/;
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'l', '*': 'u' };

export const CHAT_MAX = 80;

/** 화면에 보일 수 없는 글자·제어문자 제거, 공백 정리, 같은 글자 5번 넘게 반복은 4번으로 */
export function tidyChat(raw) {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁯﻿]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(.)\1{4,}/gu, '$1$1$1$1')
    .trim()
    .slice(0, CHAT_MAX);
}

/**
 * 보낼 수 있는 말인지 판정
 * @returns {{ ok: true, text: string } | { ok: false, why: string }}
 */
export function checkChat(raw) {
  const text = tidyChat(raw);
  if (!text) return { ok: false, why: 'empty' };
  if (LINK.test(text) || PHONE.test(text.replace(/[^\d\s.-]/g, ' '))) return { ok: false, why: 'contact' };
  if (SOLO.test(text)) return { ok: false, why: 'bad' };
  // 한글: 한글(완성형·자모)만 남겨서 비교 → '시 1 발', '씨.발', '시~발' 모두 '시발'
  const ko = text.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
  for (const w of KO) if (ko.includes(w)) return { ok: false, why: 'bad' };
  // 영어: 숫자·기호를 비슷한 글자로 바꾸고 영문만 남긴 뒤 반복 글자 압축 → 'f u c k', 'sh1t', 'fuuuck'
  //  단어별로 비교 ('push it' → 'pushit'처럼 단어 경계를 넘어 오탐하지 않게), 한두 글자씩 띄운 'f u c k'는 이어 붙여서
  const words = text.toLowerCase().replace(/[0-9@$!|*]/g, (c) => LEET[c] ?? c).split(/[^a-z]+/).filter(Boolean);
  const toks = [];
  for (let i = 0, run = ''; i <= words.length; i++) {
    const w = words[i];
    if (w !== undefined && w.length <= 2) { run += w; continue; }
    if (run) { toks.push(run); run = ''; }
    if (w !== undefined) toks.push(w);
  }
  const bads = EN.map((w) => w.replace(/(.)\1+/g, '$1'));
  for (const t of toks) { const c = t.replace(/(.)\1+/g, '$1'); if (bads.some((b) => c.includes(b))) return { ok: false, why: 'bad' }; }
  return { ok: true, text };
}

/** 거절 이유 → 안내 문구 */
export function chatRefusal(why) {
  if (why === 'contact') return '연락처나 링크는 보낼 수 없어요 · 바다 이야기를 나눠 주세요';
  if (why === 'flood') return '조금 천천히 보내 주세요';
  if (why === 'muted') return '고운 말을 지키지 않아 잠시 채팅이 멈췄어요 · 1분 뒤에 다시 보낼 수 있어요';
  if (why === 'empty') return '';
  return '모두가 함께 쓰는 채팅방이에요 · 고운 말로 다시 써 주세요';
}

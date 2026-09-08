// 컴퓨터 상대: 허용 시작 글자로 시작하는 단어를 우리말샘에서 찾아 규칙을 통과하는 것 중 하나를 고른다.

import { passingEntries } from './rules.js';

// 우리말샘은 결과 수에 비례해 느려진다 (num=100 ≈ 6초, num=20~30 ≈ 1.2초). 작은 페이지를 여러 장 동시에 받는다.
const PAGE = 30;

// 서버 쪽에서 미리 걸러 후보 밀도를 높인다: 단어(구·속담·관용구 제외)·명사·일반어(방언·북한어·옛말 제외).
// 실제 응답으로 확인: 이 필터를 주면 100건 중 100건이 pos=명사, type=일반어 로 온다 (없으면 명사가 절반 남짓).
export const BOT_FILTERS = Object.freeze({ type1: 'word', pos: '1', type3: 'general' });

/**
 * @param client   OpenDictClient | MockDictClient
 * @param starts   허용 시작 글자 목록 (두음법칙 포함). method 가 'end' 이면 허용 끝 글자 목록(앞말잇기)
 * @param used     이미 사용된 단어 집합
 * @param rules    규칙 옵션
 * @param level    'easy' | 'normal' | 'hard'  (hard 일수록 뒤쪽 페이지까지 뒤져 더 많은 후보에서 고른다)
 * @param method   'start'(끝말잇기) | 'end'(앞말잇기)
 * @param filter   후보 추가 조건 (예: 쿵쿵따는 세 글자만)
 * @param filters  우리말샘 검색에 덧붙일 서버 쪽 필터 (예: 쿵쿵따는 letter_s=3&letter_e=3)
 */
export async function pickBotWord(client, { starts, used = new Set(), rules, level = 'normal', rng = Math.random, method = 'start', filter = null, filters = {} }) {
  // 실제 API 는 호출마다 1초 안팎 걸리므로 페이지 수를 줄이고 요청은 한꺼번에 보낸다.
  const maxPages = { easy: 1, normal: 2, hard: 3 }[level] ?? 2;
  const candidates = new Map();
  const matches = method === 'end' ? (w, s) => w.endsWith(s) : (w, s) => w.startsWith(s);
  const accept = (entry, s) => matches(entry.word, s) && !used.has(entry.word) && (!filter || filter(entry));
  const searchFilters = { ...BOT_FILTERS, ...filters };

  // 1) 모든 시작 글자의 첫 페이지를 동시에
  const firsts = await Promise.all(starts.map((start) =>
    client.search({ q: start, method, num: PAGE, start: 1, filters: searchFilters }).then((r) => ({ start, r }), (e) => ({ start, r: null, e }))));
  const errors = firsts.filter((f) => f.e).map((f) => f.e);
  if (errors.length === firsts.length && errors.length) throw errors[0];

  // 2) 뒤쪽 페이지 몇 장을 무작위로 골라 동시에 (앞 페이지만 보면 늘 비슷한 단어가 나오므로)
  const extra = [];
  for (const { start, r } of firsts) {
    if (!r) continue;
    collect(r.items, start, accept, rules, candidates);
    const totalPages = Math.ceil(r.total / PAGE);
    const pages = new Set();
    while (pages.size < Math.min(maxPages - 1, totalPages - 1)) pages.add(2 + Math.floor(rng() * (totalPages - 1)));
    for (const p of pages) extra.push(client.search({ q: start, method, num: PAGE, start: p, filters: searchFilters }).then((res) => ({ start, res }), () => null));
  }
  for (const x of await Promise.all(extra)) if (x) collect(x.res.items, x.start, accept, rules, candidates);

  if (candidates.size === 0) return null;
  const list = [...candidates.values()];
  // 쉬움: 짧은 단어 위주 / 어려움: 긴 단어(끝 글자가 어려운 단어)도 자주 고른다.
  if (level === 'easy') list.sort((a, b) => a.word.length - b.word.length);
  else if (level === 'hard') list.sort((a, b) => b.word.length - a.word.length);
  else shuffle(list, rng);
  const window = level === 'normal' ? list.length : Math.max(1, Math.ceil(list.length / 3));
  return list[Math.floor(rng() * window)];
}

function collect(items, start, accept, rules, out) {
  for (const entry of passingEntries(items, rules)) {
    if (!accept(entry, start)) continue;
    if (!out.has(entry.word)) out.set(entry.word, entry);
  }
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

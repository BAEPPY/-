// 컴퓨터 상대: 허용 시작 글자로 시작하는 단어를 우리말샘에서 찾아 규칙을 통과하는 것 중 하나를 고른다.

import { passingEntries } from './rules.js';

const PAGE = 100;

// 서버 쪽에서 미리 걸러 후보 밀도를 높인다: 단어(구·속담·관용구 제외)·명사·일반어(방언·북한어·옛말 제외).
// 실제 응답으로 확인: 이 필터를 주면 100건 중 100건이 pos=명사, type=일반어 로 온다 (없으면 명사가 절반 남짓).
export const BOT_FILTERS = Object.freeze({ type1: 'word', pos: '1', type3: 'general' });

/**
 * @param client   OpenDictClient | MockDictClient
 * @param starts   허용 시작 글자 목록 (두음법칙 포함)
 * @param used     이미 사용된 단어 집합
 * @param rules    규칙 옵션
 * @param level    'easy' | 'normal' | 'hard'  (hard 일수록 뒤쪽 페이지까지 뒤져 더 많은 후보에서 고른다)
 */
export async function pickBotWord(client, { starts, used = new Set(), rules, level = 'normal', rng = Math.random }) {
  const maxPages = { easy: 1, normal: 2, hard: 4 }[level] ?? 2;
  const candidates = new Map();

  for (const start of starts) {
    const first = await client.search({ q: start, method: 'start', num: PAGE, start: 1, filters: BOT_FILTERS });
    collect(first.items, start, used, rules, candidates);

    const totalPages = Math.ceil(first.total / PAGE);
    if (totalPages > 1) {
      // 앞 페이지만 보면 늘 비슷한 단어가 나오므로, 무작위 페이지를 몇 장 더 본다. (start 는 페이지 번호)
      const pages = new Set();
      while (pages.size < Math.min(maxPages - 1, totalPages - 1)) {
        pages.add(2 + Math.floor(rng() * (totalPages - 1)));
      }
      for (const p of pages) {
        try {
          const res = await client.search({ q: start, method: 'start', num: PAGE, start: p, filters: BOT_FILTERS });
          collect(res.items, start, used, rules, candidates);
        } catch {
          // 추가 페이지 실패는 무시 (첫 페이지 후보만으로 진행)
        }
      }
    }
  }

  if (candidates.size === 0) return null;
  const list = [...candidates.values()];
  // 쉬움: 짧은 단어 위주 / 어려움: 긴 단어(끝 글자가 어려운 단어)도 자주 고른다.
  if (level === 'easy') list.sort((a, b) => a.word.length - b.word.length);
  else if (level === 'hard') list.sort((a, b) => b.word.length - a.word.length);
  else shuffle(list, rng);
  const window = level === 'normal' ? list.length : Math.max(1, Math.ceil(list.length / 3));
  return list[Math.floor(rng() * window)];
}

function collect(items, start, used, rules, out) {
  for (const entry of passingEntries(items, rules)) {
    if (!entry.word.startsWith(start)) continue;
    if (used.has(entry.word)) continue;
    if (!out.has(entry.word)) out.set(entry.word, entry);
  }
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

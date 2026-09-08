// 게임 모드 정의: 제시어 만들기, 단어 검사, 다음 제시어, 컴퓨터 단어 고르기.
//
// ctx = { client (우리말샘/모의 사전), english (EnglishDict), rules, dueum, used (Set), rng, level }
// prompt 는 클라이언트에 그대로 보내지만 `secret` 안의 값(정답·씨앗 단어)은 서버가 걷어낸다.

import { evaluateWord, REASON_MESSAGES } from './rules.js';
import { pickBotWord } from './bot.js';
import {
  allowedStarts, allowedEnds, lastSyllable, firstSyllable, isHangulWord, euro, iga,
  choseongOf, syllablesWithCho, CHOSEONG,
} from './hangul.js';

// 첫 라운드 제시 글자 후보 (단어가 많은 흔한 글자)
export const START_SYLLABLES = ['가', '나', '다', '마', '바', '사', '자', '하', '기', '대', '소', '수', '주', '지', '전', '정', '조', '무', '미', '도', '고', '구', '산', '강', '공', '문', '물', '불', '시', '인'];
const END_SYLLABLES = ['기', '리', '사', '수', '자', '지', '이', '구', '무', '도', '기', '시', '소', '가', '장', '물', '산', '문', '집', '기'];
const START_LETTERS = 'abcdefghlmnoprst';
const COMMON_CHO = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const pickRandom = (arr, rng) => arr[Math.floor(rng() * arr.length)];

function fail(reason, message) {
  return { ok: false, reason, message: message ?? REASON_MESSAGES[reason] ?? '사용할 수 없는 단어예요.' };
}

/** 우리말샘에서 단어를 찾아 규칙 판정 */
async function koLookup(word, ctx) {
  const res = await ctx.client.search({ q: word, method: 'exact', num: 100 });
  return evaluateWord(word, res.items, ctx.rules);
}

/** 서로 다른 무작위 음절 n개 */
function randomSyllables(list, n, rng) {
  const pool = [...list];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

/** 규칙을 통과하는 무작위 단어 하나 (초성 퀴즈·훈민정음 문제 출제용). 없으면 null. 음절 몇 개를 동시에 찾아 본다. */
export async function randomKoreanWord(ctx, { minLen = 2, maxLen = 4, tries = 2 } = {}) {
  const filter = (e) => e.word.length >= minLen && e.word.length <= maxLen && isHangulWord(e.word);
  const filters = { letter_s: minLen, letter_e: maxLen };
  for (let i = 0; i < tries; i++) {
    const syls = randomSyllables(START_SYLLABLES, 3, ctx.rng);
    const found = await Promise.all(syls.map((syl) => pickBotWord(ctx.client, {
      starts: [syl], used: ctx.used, rules: ctx.rules, level: 'normal', rng: ctx.rng, filter, filters,
    }).catch(() => null)));
    const ok = found.filter(Boolean);
    if (ok.length) return pickRandom(ok, ctx.rng);
  }
  return null;
}

/** 이 글자로 시작(또는 끝)하는 단어가 사전에 있는지 첫 페이지만 보고 빠르게 확인 */
async function hasWords(ctx, syl, { method = 'start', filter = null, filters = {} } = {}) {
  const starts = method === 'end' ? allowedEnds(syl, { dueum: ctx.dueum }) : allowedStarts(syl, { dueum: ctx.dueum });
  const found = await pickBotWord(ctx.client, { starts, method, rules: ctx.rules, level: 'easy', rng: ctx.rng, filter, filters }).catch(() => null);
  return found ? starts : null;
}

function scoreLenBonus(word, remaining) {
  return [...word].length * 10 + Math.max(0, Math.round(remaining));
}

// ───────────────────────── 끝말잇기 계열 ─────────────────────────

const kkm = {
  id: 'kkm', name: '끝말잇기', emoji: '🔗', lang: 'ko', turnBased: true, hasBot: true,
  desc: '앞 단어의 마지막 글자로 시작하는 단어를 이어요.',
  async initialPrompt(ctx) {
    // 컴퓨터가 단어를 찾을 수 있는 글자로 시작한다 (모의 사전에서도 동작하도록 확인). 후보 3개를 동시에 확인.
    for (let i = 0; i < 2; i++) {
      const syls = randomSyllables(START_SYLLABLES, 3, ctx.rng);
      const results = await Promise.all(syls.map((syl) => hasWords(ctx, syl, { filter: this.filter, filters: this.filters })));
      const ok = results.filter(Boolean);
      if (ok.length) return { type: 'starts', starts: pickRandom(ok, ctx.rng), lastWord: '' };
    }
    const syl = pickRandom(START_SYLLABLES, ctx.rng);
    return { type: 'starts', starts: allowedStarts(syl, { dueum: ctx.dueum }), lastWord: '' };
  },
  filter: null,
  filters: {},
  chainMessage(prompt) {
    return `'${prompt.starts.join("' 또는 '")}'${euro(prompt.starts[0])} 시작해야 해요.`;
  },
  async check(word, prompt, ctx) {
    if (!isHangulWord(word)) return fail('not_hangul');
    if (!prompt.starts.some((s) => word.startsWith(s))) return fail('chain', this.chainMessage(prompt));
    if (this.filter && !this.filter({ word })) return fail('length', this.lengthMessage);
    if (word.length < ctx.rules.minLength) return fail('too_short');
    const r = await koLookup(word, ctx);
    return r.ok ? { ok: true, entry: r.entry } : r;
  },
  async nextPrompt(prompt, word, ctx) {
    return { type: 'starts', starts: allowedStarts(lastSyllable(word), { dueum: ctx.dueum }), lastWord: word };
  },
  async botWord(prompt, ctx) {
    return pickBotWord(ctx.client, { starts: prompt.starts, used: ctx.used, rules: ctx.rules, level: ctx.level, rng: ctx.rng, filter: this.filter, filters: this.filters });
  },
  score: scoreLenBonus,
};

const kung = {
  ...kkm,
  id: 'kung', name: '쿵쿵따', emoji: '🥁', desc: '세 글자 단어로만 끝말잇기를 해요.',
  filter: (e) => [...e.word].length === 3,
  filters: { letter_s: 3, letter_e: 3 }, // 우리말샘 음절 수 필터로 세 글자 단어만 받아온다
  lengthMessage: '쿵쿵따는 세 글자 단어만 쓸 수 있어요.',
};

const apm = {
  id: 'apm', name: '앞말잇기', emoji: '🔙', lang: 'ko', turnBased: true, hasBot: true,
  desc: '앞 단어의 첫 글자로 끝나는 단어를 이어요.',
  async initialPrompt(ctx) {
    for (let i = 0; i < 2; i++) {
      const syls = randomSyllables(END_SYLLABLES, 3, ctx.rng);
      const results = await Promise.all(syls.map((syl) => hasWords(ctx, syl, { method: 'end' })));
      const ok = results.filter(Boolean);
      if (ok.length) return { type: 'ends', ends: pickRandom(ok, ctx.rng), lastWord: '' };
    }
    const syl = pickRandom(END_SYLLABLES, ctx.rng);
    return { type: 'ends', ends: allowedEnds(syl, { dueum: ctx.dueum }), lastWord: '' };
  },
  chainMessage(prompt) {
    return `'${prompt.ends.join("' 또는 '")}'${euro(prompt.ends[0])} 끝나야 해요.`;
  },
  async check(word, prompt, ctx) {
    if (!isHangulWord(word)) return fail('not_hangul');
    if (!prompt.ends.some((s) => word.endsWith(s))) return fail('chain', this.chainMessage(prompt));
    if (word.length < ctx.rules.minLength) return fail('too_short');
    const r = await koLookup(word, ctx);
    return r.ok ? { ok: true, entry: r.entry } : r;
  },
  async nextPrompt(prompt, word, ctx) {
    return { type: 'ends', ends: allowedEnds(firstSyllable(word), { dueum: ctx.dueum }), lastWord: word };
  },
  async botWord(prompt, ctx) {
    return pickBotWord(ctx.client, { starts: prompt.ends, method: 'end', used: ctx.used, rules: ctx.rules, level: ctx.level, rng: ctx.rng });
  },
  score: scoreLenBonus,
};

// ───────────────────────── 초성 계열 ─────────────────────────

const hunmin = {
  id: 'hunmin', name: '훈민정음', emoji: 'ㄱㅅ', lang: 'ko', turnBased: true, hasBot: true,
  desc: '제시된 두 초성으로 시작하는 단어를 돌아가며 말해요. (예: ㄱㅅ → 가수, 감사, 국수)',
  async initialPrompt(ctx) {
    const seed = await randomKoreanWord(ctx, { minLen: 2, maxLen: 6 });
    const cho = seed ? choseongOf(seed.word).slice(0, 2) : pickRandom(COMMON_CHO, ctx.rng) + pickRandom(COMMON_CHO, ctx.rng);
    return { type: 'hunmin', cho, secret: { seed: seed?.word ?? null } };
  },
  chainMessage(prompt) {
    return `초성이 '${prompt.cho}'로 시작하는 단어여야 해요.`;
  },
  async check(word, prompt, ctx) {
    if (!isHangulWord(word)) return fail('not_hangul');
    if (!choseongOf(word).startsWith(prompt.cho)) return fail('chain', this.chainMessage(prompt));
    if (word.length < Math.max(2, ctx.rules.minLength)) return fail('too_short');
    const r = await koLookup(word, ctx);
    return r.ok ? { ok: true, entry: r.entry } : r;
  },
  async nextPrompt(prompt) {
    return prompt; // 라운드 내내 같은 초성
  },
  async botWord(prompt, ctx) {
    const [c1, c2] = [...prompt.cho];
    const seed = prompt.secret?.seed;
    const filter = (e) => choseongOf(e.word).startsWith(prompt.cho);
    // 1) 출제에 쓴 씨앗 단어 2) 씨앗 단어의 첫 글자로 시작하는 다른 단어 3) 같은 초성의 다른 음절로 시작하는 단어
    if (seed && !ctx.used.has(seed)) {
      const r = await koLookup(seed, ctx).catch(() => null);
      if (r?.ok) return r.entry;
    }
    const syls = seed ? [firstSyllable(seed)] : [];
    const pool = syllablesWithCho(c1).filter((s) => !syls.includes(s));
    while (syls.length < 6 && pool.length) syls.push(pool.splice(Math.floor(ctx.rng() * pool.length), 1)[0]);
    const found = await Promise.all(syls.map((syl) =>
      pickBotWord(ctx.client, { starts: [syl], used: ctx.used, rules: ctx.rules, level: ctx.level, rng: ctx.rng, filter }).catch(() => null)));
    void c2;
    return found.find(Boolean) ?? null;
  },
  score: scoreLenBonus,
};

const choseong = {
  id: 'choseong', name: '초성 퀴즈', emoji: '❓', lang: 'ko', turnBased: false, hasBot: true,
  desc: '초성만 보고 단어를 맞혀요. 먼저 맞힌 사람이 점수를 가져가요.',
  async initialPrompt(ctx) {
    return this.newQuestion(ctx);
  },
  async newQuestion(ctx) {
    const seed = await randomKoreanWord(ctx, { minLen: 2, maxLen: 4 });
    if (!seed) return null;
    return { type: 'choseong', cho: choseongOf(seed.word), length: [...seed.word].length, secret: { answer: seed.word, entry: seed } };
  },
  chainMessage(prompt) {
    return `초성이 '${prompt.cho}'인 ${prompt.length}글자 단어여야 해요.`;
  },
  async check(word, prompt, ctx) {
    if (!isHangulWord(word)) return fail('not_hangul');
    if (choseongOf(word) !== prompt.cho) return fail('chain', this.chainMessage(prompt));
    if (prompt.secret?.answer === word) return { ok: true, entry: prompt.secret.entry };
    const r = await koLookup(word, ctx);
    return r.ok ? { ok: true, entry: r.entry } : r;
  },
  async nextPrompt(prompt, word, ctx) {
    return this.newQuestion(ctx);
  },
  async botWord(prompt) {
    return prompt.secret?.entry ?? null;
  },
  score: (word, remaining) => 10 * [...word].length + Math.max(0, Math.round(remaining)),
};

// ───────────────────────── 영어 ─────────────────────────

const english = {
  id: 'english', name: '영어 끝말잇기', emoji: '🔤', lang: 'en', turnBased: true, hasBot: true,
  desc: 'Word chain in English: the next word starts with the last letter of the previous one. (3+ letters)',
  minLength: 3,
  async initialPrompt(ctx) {
    const letter = START_LETTERS[Math.floor(ctx.rng() * START_LETTERS.length)];
    return { type: 'letter', starts: [letter], lastWord: '' };
  },
  chainMessage(prompt) {
    return `The word must start with '${prompt.starts[0]}'.`;
  },
  async check(word, prompt, ctx) {
    const w = word.toLowerCase();
    if (!/^[a-z]+$/.test(w)) return fail('not_alpha', 'Letters a–z only.');
    if (!prompt.starts.some((s) => w.startsWith(s))) return fail('chain', this.chainMessage(prompt));
    if (w.length < this.minLength) return fail('too_short', `Use words with at least ${this.minLength} letters.`);
    if (!ctx.english?.ready) return fail('no_dict', 'English dictionary is not available on this server.');
    if (!ctx.english.has(w)) return fail('not_found', `'${w}' is not in the dictionary.`);
    return { ok: true, entry: { word: w, headword: w, definition: '', origin: '', link: `https://en.wiktionary.org/wiki/${encodeURIComponent(w)}` } };
  },
  async nextPrompt(prompt, word) {
    const w = word.toLowerCase();
    return { type: 'letter', starts: [w[w.length - 1]], lastWord: w };
  },
  async botWord(prompt, ctx) {
    if (!ctx.english?.ready) return null;
    const w = ctx.english.pick(prompt.starts, { used: ctx.used, level: ctx.level, rng: ctx.rng });
    return w ? { word: w, headword: w, definition: '', origin: '', link: `https://en.wiktionary.org/wiki/${encodeURIComponent(w)}` } : null;
  },
  score: scoreLenBonus,
};

export const MODES = Object.freeze({ kkm, kung, apm, hunmin, choseong, english });
export const MODE_LIST = Object.values(MODES);

export function getMode(id) {
  return MODES[id] ?? null;
}

/** 클라이언트에 보낼 모드 설명 목록 */
export function describeModes({ englishReady = false } = {}) {
  return MODE_LIST.map((m) => ({
    id: m.id, name: m.name, emoji: m.emoji, desc: m.desc, lang: m.lang, turnBased: m.turnBased, hasBot: m.hasBot,
    available: m.lang !== 'en' || englishReady,
  }));
}

/** 제시어에서 비밀 정보(정답 등)를 뺀 공개용 사본 */
export function publicPrompt(prompt) {
  if (!prompt) return null;
  const { secret, ...rest } = prompt;
  return rest;
}

export { iga, CHOSEONG };

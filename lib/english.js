// 영어 끝말잇기용 사전: 한 줄에 한 단어인 텍스트 파일을 읽어 Set 으로 든다.
// 기본 목록은 dwyl/english-words 의 words_alpha.txt (약 37만 단어, 공개 도메인) 를 처음 실행할 때 내려받아
// data/english-words.txt 에 저장한다. 파일이 이미 있으면 내려받지 않는다.

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_ENGLISH_URL = 'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt';

export class EnglishDict {
  constructor(words = [], { minLength = 3 } = {}) {
    this.minLength = minLength;
    this.words = new Set();
    this.byFirst = new Map();
    for (const raw of words) this.add(raw);
  }

  add(raw) {
    const w = String(raw).trim().toLowerCase();
    if (!/^[a-z]+$/.test(w) || w.length < this.minLength || this.words.has(w)) return;
    this.words.add(w);
    const k = w[0];
    if (!this.byFirst.has(k)) this.byFirst.set(k, []);
    this.byFirst.get(k).push(w);
  }

  get size() { return this.words.size; }
  get ready() { return this.words.size > 0; }

  has(word) {
    return this.words.has(String(word ?? '').trim().toLowerCase());
  }

  /** 주어진 글자(들)로 시작하는, 아직 안 쓴 단어 하나. level 에 따라 짧은/긴 단어를 고른다. */
  pick(starts, { used = new Set(), level = 'normal', rng = Math.random, filter = null } = {}) {
    // 목록에 희귀한 긴 단어가 많으므로 난이도에 따라 길이를 제한한다 (쉬움 ≤5, 보통 ≤8, 어려움 제한 없음)
    const maxLen = { easy: 5, normal: 8 }[level] ?? Infinity;
    let pool = [];
    for (const s of starts) for (const w of this.byFirst.get(s) ?? []) if (!used.has(w) && w.length <= maxLen && (!filter || filter(w))) pool.push(w);
    if (pool.length === 0) for (const s of starts) for (const w of this.byFirst.get(s) ?? []) if (!used.has(w) && (!filter || filter(w))) pool.push(w);
    if (pool.length === 0) return null;
    // 어려움: 긴 단어(끝 글자가 까다로운 단어) 쪽, 쉬움: 짧은 단어 쪽에서 고른다.
    const sample = [];
    for (let i = 0; i < Math.min(pool.length, 40); i++) sample.push(pool[Math.floor(rng() * pool.length)]);
    if (level === 'easy') sample.sort((a, b) => a.length - b.length);
    else if (level === 'hard') sample.sort((a, b) => b.length - a.length);
    const window = level === 'normal' ? sample.length : Math.max(1, Math.ceil(sample.length / 3));
    return sample[Math.floor(rng() * window)];
  }

  static fromFile(file, opts) {
    const text = fs.readFileSync(file, 'utf8');
    return new EnglishDict(text.split(/\r?\n/), opts);
  }

  /**
   * 파일이 있으면 읽고, 없으면 (download 가 켜져 있을 때) 내려받아 저장한 뒤 읽는다.
   * 실패하면 빈 사전을 돌려준다 (영어 모드는 "사전 없음"으로 표시됨).
   */
  static async load({ file, url = DEFAULT_ENGLISH_URL, download = true, fetchImpl = globalThis.fetch, log = console } = {}) {
    try {
      if (file && fs.existsSync(file)) return EnglishDict.fromFile(file);
      if (!download || !url) return new EnglishDict();
      log.log?.(`[영어 사전] ${url} 에서 단어 목록을 내려받는 중…`);
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (file) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
      }
      const dict = new EnglishDict(text.split(/\r?\n/));
      log.log?.(`[영어 사전] ${dict.size.toLocaleString()} 단어 준비됨${file ? ` (${file})` : ''}`);
      return dict;
    } catch (e) {
      log.warn?.(`[영어 사전] 단어 목록을 준비하지 못했어요: ${e.message}. 영어 끝말잇기는 비활성화됩니다.`);
      return new EnglishDict();
    }
  }
}

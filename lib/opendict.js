// 우리말샘 Open API 클라이언트 + 오프라인용 모의 사전
// API 문서: https://opendict.korean.go.kr/service/openApiInfo
//   GET https://opendict.korean.go.kr/api/search?key=...&q=...&req_type=json&advanced=y&method=exact&num=100
//
// 실제 동작 (2026-09 확인)
//   * 정상 응답: { channel: { total, start, num, title, link, description, item: [ { word, sense: [ {...} ] } ] } }
//     결과가 없으면 channel.item 이 아예 없다. sense 는 항상 배열(원소 1개)이다.
//   * 오류 응답: req_type=json 을 보내도 XML 로 온다.  <error><error_code>020</error_code><message>Unregistered key</message></error>
//   * num 은 10~100 만 허용(범위를 벗어나면 103 오류), start 는 페이지 번호(1~1000)다.
//   * advanced=y 이면 type1(word|phrase|idiom|proverb)·type2(native|chinese|loanword|hybrid)·type3(general|dialect|nkorean|ancient)
//     ·pos(1=명사 …)·cat 같은 서버 쪽 필터를 함께 쓸 수 있다.

import fs from 'node:fs';
import { cleanHeadword } from './rules.js';

export const OPENDICT_ENDPOINT = 'https://opendict.korean.go.kr/api/search';

/** 우리말샘 오류 코드 → 사용자에게 보여줄 설명 */
export const ERROR_MESSAGES = {
  '000': '우리말샘 서버 시스템 오류',
  '020': '등록되지 않은 인증키예요. .env 의 OPENDICT_API_KEY 를 확인하세요.',
  '021': '일시적으로 사용이 중지된 인증키예요.',
  '100': '검색어가 없어요.',
  '101': '잘못된 검색 대상(target) 값',
  '102': '잘못된 검색 방식(method) 값',
  '103': '잘못된 결과 수(num) 값 (10~100)',
  '104': '잘못된 시작 번호(start) 값',
  '210': '잘못된 품사(pos) 값',
};

export class OpenDictError extends Error {
  constructor(message, { status = 502, code = null } = {}) {
    super(message);
    this.name = 'OpenDictError';
    this.status = status;
    this.code = code;
  }
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function normalizeCode(code) {
  if (code == null || code === '') return null;
  const s = String(code).trim();
  return /^\d+$/.test(s) ? s.padStart(3, '0') : s;
}

function errorFrom(code, message) {
  const c = normalizeCode(code);
  const desc = ERROR_MESSAGES[c] ?? message ?? '알 수 없는 오류';
  return new OpenDictError(`우리말샘 API 오류 ${c ?? ''}: ${desc}`.replace(/\s+:/, ':'), {
    status: c === '020' || c === '021' ? 500 : 502,
    code: c,
  });
}

/** XML 오류 응답(<error><error_code>…</error_code><message>…</message></error>)을 해석한다. 오류가 아니면 null. */
export function parseXmlError(body) {
  const s = String(body ?? '');
  if (!/<error>/i.test(s)) return null;
  const code = s.match(/<error_code>\s*([^<]*?)\s*<\/error_code>/i)?.[1] ?? null;
  const message = s.match(/<message>\s*([^<]*?)\s*<\/message>/i)?.[1] ?? null;
  return errorFrom(code, message);
}

/** 우리말샘 JSON 응답에서 검색 결과를 꺼내 정규화한다. */
export function parseSearchResponse(json) {
  if (json && json.error) {
    const err = json.error;
    throw errorFrom(err.error_code ?? err.code ?? null, err.message);
  }
  const channel = json?.channel ?? json ?? {};
  const items = asArray(channel.item);
  return {
    total: Number(channel.total ?? items.length) || 0,
    start: Number(channel.start ?? 1) || 1,
    num: Number(channel.num ?? items.length) || items.length,
    items,
  };
}

/** 간단한 LRU 캐시 (사전 결과는 바뀌지 않으므로 넉넉히 캐시) */
class LruCache {
  constructor(max = 5000) {
    this.max = max;
    this.map = new Map();
  }
  get(k) {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k);
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }
  set(k, v) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
}

const clampNum = (n) => Math.min(100, Math.max(10, Number(n) || 100));

export class OpenDictClient {
  constructor({ apiKey, extraParams = '', fetchImpl = globalThis.fetch, timeoutMs = 8000, endpoint = OPENDICT_ENDPOINT } = {}) {
    if (!apiKey) throw new Error('OPENDICT_API_KEY 가 필요합니다.');
    this.apiKey = apiKey;
    this.extraParams = new URLSearchParams(extraParams);
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.endpoint = endpoint;
    this.cache = new LruCache();
    this.name = 'opendict';
  }

  /**
   * @param {object} p
   * @param {string} p.q        검색어
   * @param {string} [p.method] exact | include | start | end
   * @param {number} [p.num]    페이지 크기 (10~100)
   * @param {number} [p.start]  페이지 번호 (1~1000)
   * @param {object} [p.filters] 서버 쪽 필터 (type1, type2, type3, type4, pos, cat …)
   */
  buildUrl({ q, method = 'exact', num = 100, start = 1, filters = {} }) {
    const url = new URL(this.endpoint);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('q', q);
    url.searchParams.set('req_type', 'json');
    url.searchParams.set('advanced', 'y');
    url.searchParams.set('method', method);
    url.searchParams.set('num', String(clampNum(num)));
    url.searchParams.set('start', String(Math.max(1, Number(start) || 1)));
    for (const [k, v] of Object.entries(filters)) if (v != null && v !== '') url.searchParams.set(k, String(v));
    for (const [k, v] of this.extraParams) url.searchParams.set(k, v);
    return url;
  }

  /** 원본 JSON 응답 (디버그용) */
  async raw(params) {
    const url = this.buildUrl(params);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    } catch (e) {
      throw new OpenDictError(`우리말샘 서버에 연결하지 못했어요. (${e.name === 'AbortError' ? '시간 초과' : e.message})`, { status: 503 });
    } finally {
      clearTimeout(timer);
    }
    const body = await res.text();
    if (!res.ok) throw new OpenDictError(`우리말샘 서버 응답 오류 (HTTP ${res.status})`, { status: 502 });
    const xmlError = parseXmlError(body);
    if (xmlError) throw xmlError;
    try {
      return JSON.parse(body);
    } catch {
      throw new OpenDictError('우리말샘 응답을 해석하지 못했어요. (JSON 아님)', { status: 502 });
    }
  }

  /** @returns {Promise<{total:number,start:number,num:number,items:object[]}>} */
  async search(params) {
    const key = JSON.stringify([params.q, params.method ?? 'exact', clampNum(params.num), params.start ?? 1, params.filters ?? {}]);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = parseSearchResponse(await this.raw(params));
    this.cache.set(key, result);
    return result;
  }
}

// 모의 사전에서 서버 쪽 필터를 흉내 낼 때 쓰는 대응표
const TYPE3 = { general: '일반어', dialect: '방언', nkorean: '북한어', ancient: '옛말' };
const POS_CODES = { 1: '명사', 2: '대명사', 3: '수사', 4: '조사', 5: '동사', 6: '형용사', 7: '관형사', 8: '부사', 9: '감탄사', 10: '접사', 11: '의존 명사' };

/** test/fixtures/mock-dict.json 을 사전으로 쓰는 오프라인 클라이언트 (API 응답과 같은 모양을 돌려준다) */
export class MockDictClient {
  constructor(file) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    this.items = asArray(data.channel?.item ?? data.item ?? data);
    this.name = 'mock';
  }

  async raw(params) {
    const r = await this.search(params);
    return { channel: { title: 'mock', total: r.total, start: r.start, num: r.num, item: r.items } };
  }

  async search({ q, method = 'exact', num = 100, start = 1, filters = {} }) {
    const pred = {
      exact: (w) => w === q,
      start: (w) => w.startsWith(q),
      end: (w) => w.endsWith(q),
      include: (w) => w.includes(q),
    }[method] ?? ((w) => w === q);
    const all = this.items.filter((it) => pred(cleanHeadword(it.word)) && matchesFilters(it, filters));
    num = clampNum(num);
    const items = all.slice((start - 1) * num, start * num);
    return { total: all.length, start, num, items };
  }
}

function matchesFilters(item, filters) {
  const senses = asArray(item.sense);
  const sense = senses[0] ?? {};
  if (filters.type1 && filters.type1 !== 'all') {
    const isWord = !/\^/.test(item.word ?? '');
    if (String(filters.type1).split(',').includes('word') !== isWord) return false;
  }
  if (filters.type3 && filters.type3 !== 'all') {
    const allowed = String(filters.type3).split(',').map((k) => TYPE3[k]).filter(Boolean);
    if (!allowed.includes(sense.type ?? item.type)) return false;
  }
  if (filters.pos && String(filters.pos) !== '0') {
    const allowed = String(filters.pos).split(',').map((k) => POS_CODES[k]).filter(Boolean);
    if (!allowed.includes(sense.pos ?? item.pos)) return false;
  }
  const len = cleanHeadword(item.word).length;
  if (filters.letter_s && len < Number(filters.letter_s)) return false;
  if (filters.letter_e && len > Number(filters.letter_e)) return false;
  return true;
}

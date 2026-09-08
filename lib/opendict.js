// 우리말샘 Open API 클라이언트 + 오프라인용 모의 사전
// API 문서: https://opendict.korean.go.kr/service/openApiInfo
//   GET https://opendict.korean.go.kr/api/search?key=...&q=...&req_type=json&advanced=y&method=exact&num=100
//
// 실제 API 동작 (2026-09 확인)
//   * num 은 10~100, start 는 1~1000 범위만 받는다. 벗어나면 103/104 오류.
//   * 오류 응답은 req_type=json 이어도 XML(<error><error_code/><message/></error>) 로 온다.
//   * advanced=y 일 때 type1/type2/type3/pos/letter_s 같은 필터를 쓸 수 있다. (rules.js 의 searchFilters 참고)

import fs from 'node:fs';
import { cleanHeadword } from './rules.js';

export const OPENDICT_ENDPOINT = 'https://opendict.korean.go.kr/api/search';

export const ERROR_MESSAGES = {
  '000': '우리말샘 시스템 오류',
  '020': '등록되지 않은 인증키예요. OPENDICT_API_KEY 를 확인하세요.',
  '021': '일시적으로 사용이 중지된 인증키예요.',
  '100': '잘못된 검색 요청 (query 없음)',
  '101': '잘못된 target 값',
  '102': '잘못된 method 값',
  '103': '잘못된 num 값 (10~100)',
  '104': '잘못된 start 값 (1~1000)',
  '200': '잘못된 type1 값',
  '201': '잘못된 type2 값',
  '202': '잘못된 type3 값',
  '203': '잘못된 type4 값',
  '210': '잘못된 pos 값',
  '214': '잘못된 letter_s 값',
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

function apiError(code, message) {
  const c = code == null ? null : String(code).padStart(3, '0');
  const friendly = ERROR_MESSAGES[c];
  const status = c === '020' || c === '021' ? 500 : 502;
  return new OpenDictError(`우리말샘 API 오류 ${c ?? ''}: ${friendly ?? message ?? '알 수 없는 오류'}`.trim(), { status, code: c });
}

/** 우리말샘이 XML 로 돌려주는 오류 응답이면 OpenDictError 를, 아니면 null 을 돌려준다. */
export function parseErrorXml(body) {
  const m = /<error>[\s\S]*?<error_code>\s*([^<]*?)\s*<\/error_code>[\s\S]*?<message>\s*([^<]*?)\s*<\/message>/.exec(body ?? '');
  return m ? apiError(m[1], m[2]) : null;
}

/** 우리말샘 JSON 응답에서 검색 결과를 꺼내 정규화한다. */
export function parseSearchResponse(json) {
  if (json && json.error) {
    const err = json.error;
    throw apiError(err.error_code ?? err.code ?? null, err.message);
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

const clamp = (n, lo, hi, def) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return def;
  return Math.min(hi, Math.max(lo, Math.trunc(v)));
};

/** 검색 파라미터를 API 허용 범위로 맞춘다. */
export function normalizeParams({ q, method = 'exact', num = 100, start = 1, filters = {} } = {}) {
  return { q: String(q ?? ''), method, num: clamp(num, 10, 100, 100), start: clamp(start, 1, 1000, 1), filters: { ...filters } };
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
   * @param params.filters  advanced 검색 필터 (type1, type2, type3, pos, letter_s ...). rules.js 의 searchFilters() 참고
   */
  buildUrl(params) {
    const { q, method, num, start, filters } = normalizeParams(params);
    const url = new URL(this.endpoint);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('q', q);
    url.searchParams.set('req_type', 'json');
    url.searchParams.set('advanced', 'y');
    url.searchParams.set('method', method);
    url.searchParams.set('num', String(num));
    url.searchParams.set('start', String(start));
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
    const xmlError = parseErrorXml(body);
    if (xmlError) throw xmlError;
    if (!res.ok) throw new OpenDictError(`우리말샘 서버 응답 오류 (HTTP ${res.status})`, { status: 502 });
    try {
      return JSON.parse(body);
    } catch {
      throw new OpenDictError('우리말샘 응답을 해석하지 못했어요. (JSON 아님)', { status: 502 });
    }
  }

  /** @returns {Promise<{total:number,start:number,num:number,items:object[]}>} */
  async search(params) {
    const p = normalizeParams(params);
    const key = JSON.stringify([p.q, p.method, p.num, p.start, Object.entries(p.filters).sort()]);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = parseSearchResponse(await this.raw(p));
    this.cache.set(key, result);
    return result;
  }
}

// ---- 모의 사전 ------------------------------------------------------------

const POS_CODES = { 1: '명사', 2: '대명사', 3: '수사', 5: '동사', 6: '형용사', 8: '부사', 11: '의존 명사' };
const TYPE3 = { general: '일반어', dialect: '방언', nkorean: '북한어', ancient: '옛말' };
const TYPE2 = { native: '고유어', chinese: '한자어', loanword: '외래어', hybrid: '혼종어' };

/** 우리말샘의 advanced 필터를 흉내 낸다. (모의 사전 항목은 실제 응답 모양 + word_type 주석 필드) */
export function matchesFilters(item, filters = {}) {
  const senses = asArray(item.sense);
  const has = (v) => v != null && v !== '' && String(v) !== 'all' && String(v) !== '0';
  if (has(filters.type1)) {
    const allow = String(filters.type1).split(',');
    const isWord = !/\^/.test(item.word ?? '') && senses.some((s) => s.pos || item.pos);
    if (!(isWord ? allow.includes('word') : allow.includes('phrase'))) return false;
  }
  if (has(filters.pos)) {
    const allow = String(filters.pos).split(',').map((c) => POS_CODES[c] ?? c);
    if (!senses.some((s) => allow.includes(s.pos || item.pos))) return false;
  }
  if (has(filters.type3)) {
    const allow = String(filters.type3).split(',').map((c) => TYPE3[c] ?? c);
    if (!senses.some((s) => allow.includes(s.type || item.type || '일반어'))) return false;
  }
  if (has(filters.type2)) {
    const allow = String(filters.type2).split(',').map((c) => TYPE2[c] ?? c);
    if (!allow.includes(item.word_type || '고유어')) return false;
  }
  if (has(filters.letter_s) && cleanHeadword(item.word).length < Number(filters.letter_s)) return false;
  if (has(filters.letter_e) && cleanHeadword(item.word).length > Number(filters.letter_e)) return false;
  return true;
}

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

  async search(params) {
    const { q, method, num, start, filters } = normalizeParams(params);
    const pred = {
      exact: (w) => w === q,
      start: (w) => w.startsWith(q),
      end: (w) => w.endsWith(q),
      include: (w) => w.includes(q),
    }[method] ?? ((w) => w === q);
    const all = this.items.filter((it) => pred(cleanHeadword(it.word)) && matchesFilters(it, filters));
    const items = all.slice((start - 1) * num, start * num);
    return { total: all.length, start, num, items };
  }
}

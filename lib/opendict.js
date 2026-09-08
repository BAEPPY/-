// 우리말샘 Open API 클라이언트 + 오프라인용 모의 사전
// API 문서: https://opendict.korean.go.kr/service/openApiInfo
//   GET https://opendict.korean.go.kr/api/search?key=...&q=...&req_type=json&advanced=y&method=exact&num=100

import fs from 'node:fs';
import { cleanHeadword } from './rules.js';

export const OPENDICT_ENDPOINT = 'https://opendict.korean.go.kr/api/search';

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

/** 우리말샘 JSON 응답에서 검색 결과를 꺼내 정규화한다. */
export function parseSearchResponse(json) {
  if (json && json.error) {
    const err = json.error;
    const code = err.error_code ?? err.code ?? null;
    throw new OpenDictError(`우리말샘 API 오류 ${code ?? ''}: ${err.message ?? '알 수 없는 오류'}`.trim(), {
      status: 502,
      code,
    });
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

  buildUrl({ q, method = 'exact', num = 100, start = 1 }) {
    const url = new URL(this.endpoint);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('q', q);
    url.searchParams.set('req_type', 'json');
    url.searchParams.set('advanced', 'y');
    url.searchParams.set('method', method);
    url.searchParams.set('num', String(num));
    url.searchParams.set('start', String(start));
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
    try {
      return JSON.parse(body);
    } catch {
      throw new OpenDictError('우리말샘 응답을 해석하지 못했어요. (JSON 아님)', { status: 502 });
    }
  }

  /** @returns {Promise<{total:number,start:number,num:number,items:object[]}>} */
  async search(params) {
    const key = JSON.stringify([params.q, params.method ?? 'exact', params.num ?? 100, params.start ?? 1]);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = parseSearchResponse(await this.raw(params));
    this.cache.set(key, result);
    return result;
  }
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

  async search({ q, method = 'exact', num = 100, start = 1 }) {
    const pred = {
      exact: (w) => w === q,
      start: (w) => w.startsWith(q),
      end: (w) => w.endsWith(q),
      include: (w) => w.includes(q),
    }[method] ?? ((w) => w === q);
    const all = this.items.filter((it) => pred(cleanHeadword(it.word)));
    const items = all.slice((start - 1) * num, start * num);
    return { total: all.length, start, num, items };
  }
}

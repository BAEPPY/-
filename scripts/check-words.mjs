#!/usr/bin/env node
// 단어 목록을 서버와 같은 방식(규칙 필터 조회 → 실패 시 무필터 조회)으로 판정해 표로 보여준다.
//   OPENDICT_API_KEY=... node scripts/check-words.mjs 사과 리본 서울      (우리말샘 실제 API)
//   MOCK_DICT=1 node scripts/check-words.mjs 사과 리본 서울               (모의 사전)
//   인자를 생략하면 test/fixtures 를 만든 단어 목록 전체를 검사한다.

import path from 'node:path';
import { getConfig } from '../lib/config.js';
import { OpenDictClient, MockDictClient } from '../lib/opendict.js';
import { evaluateWord, searchFilters } from '../lib/rules.js';
import { WORDS } from './build-fixture.mjs';

/** server.js 의 /api/validate 와 같은 2단계 판정 */
export async function validateWord(client, word, rules) {
  const strict = await client.search({ q: word, method: 'exact', num: 100, filters: searchFilters(rules) });
  let verdict = evaluateWord(word, strict.items, rules);
  if (!verdict.ok) {
    const all = await client.search({ q: word, method: 'exact', num: 100 });
    verdict = evaluateWord(word, all.items, rules, { unfiltered: true });
  }
  return verdict;
}

async function main() {
  const config = getConfig();
  const client = config.mock
    ? new MockDictClient(path.join(config.root, 'test', 'fixtures', 'mock-dict.json'))
    : new OpenDictClient({ apiKey: config.apiKey, extraParams: config.extraParams });
  const words = process.argv.slice(2).length ? process.argv.slice(2) : WORDS;
  console.log(`사전: ${client.name}  규칙: ${JSON.stringify(config.rules)}\n`);
  for (const w of words) {
    const v = await validateWord(client, w, config.rules);
    const tail = v.ok ? `${v.entry.headword}${v.entry.origin ? ` (${v.entry.origin})` : ''}  ${v.entry.definition.slice(0, 40)}` : v.message;
    console.log(`${v.ok ? '✅' : '❌'} ${w.padEnd(6)} ${(v.reason ?? 'ok').padEnd(12)} ${tail}`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

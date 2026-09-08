#!/usr/bin/env node
// 우리말샘 API 실제 응답으로 test/fixtures/mock-dict.json 을 다시 만든다.
//   OPENDICT_API_KEY=... node scripts/build-fixture.mjs
//
// 항목은 검색 API 응답 모양 그대로 저장하고, 검색 응답에는 없는 원어 유형(외래어 여부)만
// type2=loanword 필터로 한 번 더 조회해서 word_type 필드로 덧붙인다. (모의 사전이 type2 필터를 흉내 내는 데 쓴다)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../lib/config.js';
import { OpenDictClient } from '../lib/opendict.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test', 'fixtures', 'mock-dict.json');

// 모의 사전에 넣을 단어. 게임이 이어지도록 끝말이 맞물리는 일반 명사 + 규칙 검증용 예외 단어.
export const WORDS = [
  // 일반 명사 (끝말 연결용)
  '사과', '과일', '일기', '기차', '차례', '예술', '술래', '내일', '가방', '방석', '석유', '유리', '이름',
  '나무', '무지개', '개미', '미소', '소리', '다리', '마음', '음악', '악기', '기린', '인사', '사자', '자동차',
  '차이', '이유', '유령', '영화', '화분', '분수', '수박', '박수', '하늘', '바다', '다람쥐', '고양이', '이불',
  '불꽃', '전화', '마차', '지구', '구름', '정원', '원숭이', '강물', '물고기', '산책', '책상', '상자', '자연',
  '연필', '필통', '통화', '도시', '시간', '간식', '식당', '당근', '근처', '처음', '소금', '금붕어', '어머니',
  '노래', '여자', '사람', '학교', '서울', '애비',
  // 규칙 검증용
  '먹다',                       // 동사
  '것', '물',                   // 한 글자 (의존 명사 / 명사)
  '사과나무', '가정법원', '숫놈', '오랫만', '멋장이', // 합성어(-) / 구(^) / '⇒규범 표기' 비표준
  '니체', '이순신', '대한민국',  // 고유 명사 (인명·책명 / 인명 / 지명)
  '래일', '설겆이',             // 북한어
  '강생이',                     // 방언
  '나모', '즈믄',               // 옛말
  '리본', '래스터', '컴퓨터', '오뎅', '짜장면', // 외래어
  '닭도리탕',                   // 혼종어 + 합성어
];

async function main() {
  const config = getConfig();
  if (!config.apiKey) {
    console.error('OPENDICT_API_KEY 가 필요합니다.');
    process.exit(1);
  }
  const client = new OpenDictClient({ apiKey: config.apiKey });
  const items = [];
  const seen = new Set();
  for (const w of WORDS) {
    const all = await client.search({ q: w, method: 'exact', num: 100 });
    const loan = await client.search({ q: w, method: 'exact', num: 100, filters: { type2: 'loanword' } });
    const loanCodes = new Set(loan.items.flatMap((it) => [].concat(it.sense ?? []).map((s) => String(s.target_code))));
    let n = 0;
    for (const it of all.items) {
      const senses = [].concat(it.sense ?? []);
      const code = String(senses[0]?.target_code ?? '');
      if (seen.has(code)) continue;
      seen.add(code);
      const item = { word: it.word, sense: senses };
      if (loanCodes.has(code)) item.word_type = '외래어';
      items.push(item);
      n++;
    }
    console.error(`${w}: ${n}건${loanCodes.size ? ` (외래어 ${loanCodes.size})` : ''}`);
  }
  const out = {
    channel: {
      title: 'mock 우리말샘 (실제 검색 API 응답으로 생성, scripts/build-fixture.mjs)',
      total: items.length,
      start: 1,
      num: items.length,
      item: items,
    },
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.error(`→ ${path.relative(ROOT, OUT)} (${items.length}건)`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

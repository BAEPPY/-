'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Anthropic = require('@anthropic-ai/sdk');
const api = require('../src/api');
const prompt = require('../src/prompt');

const baseForm = {
  dateText: '2026년 6월 22일(월)', target: '5학년', activity: '반편견입양교육', detail: '- 가족의 다양한 형태 알아보기',
  scale: '', partner: '', effect: '', voiceMode: 'none', voice: '', quote2: '',
  tone: 'report', tense: 'done', paras: '3', mark: '□', subhead: false, iem: false, signer: ''
};

test('buildInput: 기본 입력은 Apps Script 판과 같은 줄을 만든다', () => {
  const out = api.buildInput(baseForm).split('\n');
  assert.deepEqual(out, [
    '날짜: 2026년 6월 22일(월)',
    '대상: 5학년',
    '활동명: 반편견입양교육',
    '활동 내용: - 가족의 다양한 형태 알아보기',
    '목적·기대효과: 따로 주어지지 않았으므로 활동 내용에서 교육적 의미를 이끌어 내어 첫 문단과 마지막 문단에 자연스럽게 쓸 것',
    '참가자 소감: 없음. 소감이나 발언을 지어내지 말고 무엇을 배웠는지 서술로만 마무리할 것',
    '문체: 보도자료체(~하였다)',
    '시점: 이미 끝난 활동',
    '문단 수: 3개',
    '문단 기호: □'
  ]);
});

test('buildInput: 선택 항목과 소감 방식이 반영된다', () => {
  const out = api.buildInput(Object.assign({}, baseForm, {
    dateText: '', scale: '13개 학급', partner: '외부 강사', effect: '인권 감수성', voiceMode: 'quote', voice: '재밌었어요',
    quote2: '교감 김영숙 — 뜻깊었다', tone: 'polite', tense: 'plan', paras: '4', mark: '○', subhead: true, iem: true, signer: '교감 김영숙'
  }));
  assert.ok(!out.includes('날짜:'));
  assert.ok(out.includes('규모·시수·장소: 13개 학급'));
  assert.ok(out.includes('협력기관·강사: 외부 강사'));
  assert.ok(out.includes('강조할 목적·기대효과: 인권 감수성'));
  assert.ok(out.includes('참가자 소감(실제 발언'));
  assert.ok(out.includes('대표자·관계자 발언'));
  assert.ok(out.includes('문체: 안내체(~했습니다)'));
  assert.ok(out.includes('시점: 진행 중이거나 앞으로 할 활동'));
  assert.ok(out.includes('문단 수: 4개'));
  assert.ok(out.includes('문단 기호: ○'));
  assert.ok(out.includes('소제목'));
  assert.ok(out.includes('I-E.U.M'));
  assert.ok(out.includes('"(교감 김영숙)"'));
  const polished = api.buildInput(Object.assign({}, baseForm, { voiceMode: 'polish', voice: '재밌었어요' }));
  assert.ok(polished.includes('참가자 반응 키워드'));
});

test('parseArticle: 제목과 본문을 나눈다', () => {
  assert.deepEqual(api.parseArticle('제목: 한라초 5학년, 교육 실시\n---\n□ 본문'), { title: '한라초 5학년, 교육 실시', body: '□ 본문' });
  assert.deepEqual(api.parseArticle('구분선 없는 응답'), { title: '', body: '구분선 없는 응답' });
  assert.deepEqual(api.parseArticle('  제목만\n---\n  '), { title: '제목만', body: '' });
});

test('buildSystemPrompt: 규칙 + 안내문 + 예시 순서', () => {
  const s = api.buildSystemPrompt(prompt.RULES, prompt.EXAMPLES);
  assert.ok(s.startsWith(prompt.RULES));
  assert.ok(s.includes('다음은 우리 학교가 실제로 게시한 홍보글입니다.'));
  assert.ok(s.endsWith(prompt.EXAMPLES));
});

test('summarizeUsage: 캐시 읽기는 0.1배, 캐시 저장은 1.25배', () => {
  const u = api.summarizeUsage({ input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 3000, output_tokens: 500 }, 'claude-sonnet-5');
  assert.equal(u.inputTokens, 6000);
  assert.equal(u.cacheReadTokens, 3000);
  assert.equal(u.outputTokens, 500);
  // (1000*2 + 2000*2*1.25 + 3000*2*0.1 + 500*10) / 1e6
  assert.ok(Math.abs(u.usd - (2000 + 5000 + 600 + 5000) / 1e6) < 1e-12);
  assert.equal(api.summarizeUsage(undefined, 'unknown-model').model, api.DEFAULT_MODEL);
});

test('describeError: SDK 오류 종류별 한국어 안내', () => {
  const gen = (status, msg) => Anthropic.APIError.generate(status, { error: { type: 'x', message: msg } }, msg, new Headers());
  assert.match(api.describeError(gen(401, 'invalid x-api-key')), /API 키가 올바르지/);
  assert.match(api.describeError(gen(403, 'forbidden')), /권한/);
  assert.match(api.describeError(gen(429, 'rate')), /요청이 몰렸/);
  assert.match(api.describeError(gen(404, 'model not found')), /모델을 찾을 수 없/);
  assert.match(api.describeError(gen(400, 'Your credit balance is too low')), /잔액이 부족/);
  assert.match(api.describeError(gen(400, 'max_tokens too large')), /\(400\)/);
  assert.match(api.describeError(gen(500, 'boom')), /서버 쪽 오류/);
  assert.match(api.describeError(new Anthropic.APIConnectionTimeoutError()), /오래 걸려/);
  assert.match(api.describeError(new Anthropic.APIConnectionError({ message: 'ECONNREFUSED' })), /인터넷 연결/);
  assert.equal(api.describeError(new Error('빈 응답')), '빈 응답');
});

/** 가짜 Anthropic 서버: 요청을 기록하고 정해진 응답을 돌려준다. */
function mockServer(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const out = handler(req, body ? JSON.parse(body) : null);
      res.writeHead(out.status || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.json));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    server, baseURL: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(r => server.close(r))
  })));
}

test('generateArticle: 요청 형식과 응답 해석 (가짜 서버)', async () => {
  let seen = null;
  const mock = await mockServer((req, json) => {
    seen = { url: req.url, headers: req.headers, json };
    return {
      json: {
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5',
        content: [
          { type: 'thinking', thinking: '', signature: 'x' },
          { type: 'text', text: '제목: 한라초 5학년, 반편견입양교육 실시\n---\n□ 첫 문단\n\n□ 둘째 문단' }
        ],
        stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 120, cache_creation_input_tokens: 9000, cache_read_input_tokens: 0, output_tokens: 300 }
      }
    };
  });
  try {
    const r = await api.generateArticle(baseForm, {
      apiKey: 'sk-ant-test', model: 'claude-sonnet-5', rules: prompt.RULES, examples: prompt.EXAMPLES, baseURL: mock.baseURL
    });
    assert.equal(seen.url, '/v1/messages');
    assert.equal(seen.headers['x-api-key'], 'sk-ant-test');
    assert.equal(seen.json.model, 'claude-sonnet-5');
    assert.equal(seen.json.max_tokens, api.MAX_TOKENS);
    assert.equal(seen.json.system[0].cache_control.type, 'ephemeral');
    assert.ok(seen.json.system[0].text.includes('한라초등학교(교장 오상남)'));
    assert.equal(seen.json.messages[0].role, 'user');
    assert.ok(seen.json.messages[0].content.startsWith('날짜: 2026년 6월 22일(월)'));
    assert.equal(r.title, '한라초 5학년, 반편견입양교육 실시');
    assert.equal(r.body, '□ 첫 문단\n\n□ 둘째 문단');
    assert.equal(r.truncated, false);
    assert.equal(r.usage.inputTokens, 9120);
    assert.equal(r.usage.outputTokens, 300);
  } finally {
    await mock.close();
  }
});

test('generateArticle: 401이면 한국어 안내로 바뀐다', async () => {
  const mock = await mockServer(() => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }));
  try {
    await assert.rejects(
      api.generateArticle(baseForm, { apiKey: 'bad', rules: prompt.RULES, examples: prompt.EXAMPLES, baseURL: mock.baseURL }),
      err => /API 키가 올바르지/.test(api.describeError(err))
    );
  } finally {
    await mock.close();
  }
});

test('generateArticle: 텍스트가 없으면 오류, max_tokens면 truncated 표시', async () => {
  let n = 0;
  const mock = await mockServer(() => {
    n += 1;
    return n === 1
      ? { json: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: 'end_turn', usage: {} } }
      : { json: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: '제목: A\n---\n□ 잘린' }], stop_reason: 'max_tokens', usage: {} } };
  });
  try {
    const opts = { apiKey: 'k', rules: 'r', examples: 'e', baseURL: mock.baseURL, model: 'claude-haiku-4-5' };
    await assert.rejects(api.generateArticle(baseForm, opts), /빈 응답/);
    const r = await api.generateArticle(baseForm, opts);
    assert.equal(r.truncated, true);
    assert.equal(r.usage.model, 'claude-haiku-4-5');
  } finally {
    await mock.close();
  }
});

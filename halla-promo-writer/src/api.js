'use strict';
/**
 * Anthropic API 호출 — 화면에서 받은 값을 프롬프트로 조립해 홍보글을 만듭니다.
 * (Electron에 의존하지 않으므로 node --test 로 단위 시험할 수 있습니다.)
 */

const Anthropic = require('@anthropic-ai/sdk');

/** 선택할 수 있는 모델. 가격은 100만 토큰당 미국 달러(입력/출력). */
const MODELS = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — 기본값. 품질과 비용의 균형', inputPrice: 2, outputPrice: 10 },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — 가장 저렴. 문장이 조금 단조로울 수 있음', inputPrice: 1, outputPrice: 5 },
  { id: 'claude-opus-5', label: 'Claude Opus 5 — 가장 정교. 비용이 약 2.5배', inputPrice: 5, outputPrice: 25 }
];
const DEFAULT_MODEL = 'claude-sonnet-5';

// 홍보글은 보통 1,000~2,000 토큰이지만, 모델이 답하기 전에 생각하는 분량도 여기에 포함되므로 넉넉히 둡니다.
// (실제 비용은 만들어진 토큰 수만큼만 듭니다.)
const MAX_TOKENS = 8000;

const EXAMPLES_INTRO = '다음은 우리 학교가 실제로 게시한 홍보글입니다. 문체와 구조를 따르되 문장을 그대로 베끼지는 마십시오.';

function resolveModel(id) {
  return MODELS.find(m => m.id === id) || MODELS.find(m => m.id === DEFAULT_MODEL);
}

/** 화면에서 받은 값을 프롬프트 입력으로 조립 (Apps Script 판과 같은 규칙) */
function buildInput(f) {
  const lines = [];

  if (f.dateText) lines.push('날짜: ' + f.dateText);
  lines.push('대상: ' + f.target);
  lines.push('활동명: ' + f.activity);
  lines.push('활동 내용: ' + f.detail);
  if (f.scale) lines.push('규모·시수·장소: ' + f.scale);
  if (f.partner) lines.push('협력기관·강사: ' + f.partner);

  lines.push(f.effect
    ? '강조할 목적·기대효과: ' + f.effect
    : '목적·기대효과: 따로 주어지지 않았으므로 활동 내용에서 교육적 의미를 이끌어 내어 첫 문단과 마지막 문단에 자연스럽게 쓸 것');

  if (f.voiceMode === 'quote' && f.voice) {
    lines.push('참가자 소감(실제 발언 — 큰따옴표로 직접 인용하고 "라며", "라고 소감을 전했다"로 이을 것): ' + f.voice);
  } else if (f.voiceMode === 'polish' && f.voice) {
    lines.push('참가자 반응 키워드(실제로 나온 말 — 특정 인물을 지목하지 말고 "~라는 소감을 발표하며" 형태의 간접 요약 한 문장으로 다듬을 것): ' + f.voice);
  } else {
    lines.push('참가자 소감: 없음. 소감이나 발언을 지어내지 말고 무엇을 배웠는지 서술로만 마무리할 것');
  }

  if (f.quote2) lines.push('대표자·관계자 발언(실제 발언 — 직함과 이름을 밝히고 인용할 것): ' + f.quote2);

  lines.push('문체: ' + (f.tone === 'report' ? '보도자료체(~하였다)' : '안내체(~했습니다)'));
  lines.push('시점: ' + (f.tense === 'done' ? '이미 끝난 활동' : '진행 중이거나 앞으로 할 활동'));
  lines.push('문단 수: ' + f.paras + '개');
  lines.push('문단 기호: ' + f.mark);
  if (f.subhead) lines.push('각 문단 기호 뒤에 그 문단을 요약하는 짧은 소제목을 한 줄 넣고, 줄을 바꿔 본문을 쓸 것(첫 문단 제외)');
  if (f.iem) lines.push('진로연계교육 연구학교 글이므로 <꿈 I-E.U.M> 역량인 나(I)의 발견, 삶 이음(U), 꿈 이음(M)을 활동 내용과 연결해 괄호 표기로 녹여낼 것');
  if (f.signer) lines.push('마지막 문단 끝에 "(' + f.signer + ')"를 붙일 것');

  return lines.join('\n');
}

/** 규칙과 예시로 시스템 프롬프트를 만듭니다. */
function buildSystemPrompt(rules, examples) {
  return rules + '\n\n' + EXAMPLES_INTRO + '\n\n' + examples;
}

/** 모델 응답 "제목: …\n---\n본문" 을 제목과 본문으로 나눕니다. */
function parseArticle(text) {
  const t = (text || '').trim();
  const i = t.indexOf('---');
  if (i === -1) return { title: '', body: t };
  return {
    title: t.slice(0, i).replace(/^제목:\s*/, '').trim(),
    body: t.slice(i + 3).trim()
  };
}

/** 토큰 사용량으로 비용을 어림합니다(미국 달러). 캐시 저장은 1.25배, 캐시 읽기는 0.1배. */
function summarizeUsage(usage, modelId) {
  const m = resolveModel(modelId);
  const u = usage || {};
  const input = u.input_tokens || 0;
  const cacheWrite = u.cache_creation_input_tokens || 0;
  const cacheRead = u.cache_read_input_tokens || 0;
  const output = u.output_tokens || 0;
  const usd = (input * m.inputPrice
    + cacheWrite * m.inputPrice * 1.25
    + cacheRead * m.inputPrice * 0.1
    + output * m.outputPrice) / 1e6;
  return { model: m.id, inputTokens: input + cacheWrite + cacheRead, cacheReadTokens: cacheRead, outputTokens: output, usd };
}

/** SDK 오류를 사용자에게 보여 줄 한국어 문장으로 바꿉니다. */
function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'API 키가 올바르지 않습니다. 설정에서 키를 다시 확인해 주세요.';
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return '이 API 키로는 요청할 수 없습니다. Anthropic 콘솔에서 키의 권한을 확인해 주세요.';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return '요청이 몰렸습니다. 30초쯤 뒤에 다시 눌러 주세요.';
  }
  if (err instanceof Anthropic.NotFoundError) {
    return '선택한 모델을 찾을 수 없습니다. 설정에서 다른 모델을 골라 주세요.';
  }
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit|billing/i.test(err.message || '')) {
      return 'API 잔액이 부족합니다. Anthropic 콘솔(Billing)에서 결제 정보를 확인해 주세요.';
    }
    return '요청이 잘못되어 글을 만들지 못했습니다 (400). ' + err.message;
  }
  if (err instanceof Anthropic.InternalServerError) {
    return 'Anthropic 서버 쪽 오류입니다. 잠시 후 다시 눌러 주세요.';
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return '응답이 너무 오래 걸려 중단했습니다. 다시 눌러 주세요.';
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return '인터넷 연결을 확인해 주세요. Anthropic 서버에 접속하지 못했습니다.';
  }
  if (err instanceof Anthropic.APIError) {
    return '글을 만들지 못했습니다 (' + err.status + '). ' + err.message;
  }
  return (err && err.message) || String(err);
}

/**
 * 홍보글 생성.
 * @param {object} form  화면 입력값
 * @param {object} opts  { apiKey, model, rules, examples, baseURL? }
 * @returns {Promise<{title:string, body:string, truncated:boolean, usage:object}>}
 */
async function generateArticle(form, opts) {
  const model = resolveModel(opts.model).id;
  const client = new Anthropic({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    maxRetries: 2,
    timeout: 5 * 60 * 1000
  });

  const response = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    // 규칙·예시는 매번 같으므로 캐시해 둡니다. 5분 안에 다시 쓰면 입력 비용이 크게 줄어듭니다.
    system: [
      { type: 'text', text: buildSystemPrompt(opts.rules, opts.examples), cache_control: { type: 'ephemeral' } }
    ],
    messages: [{ role: 'user', content: buildInput(form) }]
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('모델이 이 요청에는 글을 쓰지 않겠다고 답했습니다. 입력 내용을 조금 바꿔 다시 시도해 주세요.');
  }

  const text = (response.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  if (!text) throw new Error('빈 응답을 받았습니다. 다시 시도해 주세요.');

  const article = parseArticle(text);
  return {
    title: article.title,
    body: article.body,
    truncated: response.stop_reason === 'max_tokens',
    usage: summarizeUsage(response.usage, model)
  };
}

module.exports = {
  MODELS, DEFAULT_MODEL, MAX_TOKENS,
  buildInput, buildSystemPrompt, parseArticle, summarizeUsage, describeError, generateArticle, resolveModel
};

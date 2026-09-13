/**
 * 한라초 홍보글 작성 — 메인 코드
 *
 * 처음 설치할 때 할 일
 *  1) 왼쪽 톱니바퀴(프로젝트 설정) > 스크립트 속성 > 속성 추가
 *     속성: ANTHROPIC_API_KEY      값: 발급받은 API 키
 *  2) 배포 > 새 배포 > 유형 '웹 앱'
 *
 * 예시와 규칙은 Prompt.gs 파일에 있습니다. 새 홍보글 유형이 생기면 그 파일만 고치면 됩니다.
 */

const MODEL = 'claude-sonnet-5';   // 더 저렴하게 쓰려면 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 2000;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('한라초 홍보글 작성')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) {
    throw new Error('API 키가 없습니다. 프로젝트 설정 > 스크립트 속성에서 ANTHROPIC_API_KEY를 추가해 주세요.');
  }
  return key;
}

/** 화면에서 받은 값을 프롬프트 입력으로 조립 */
function buildInput_(f) {
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

/** 화면에서 google.script.run으로 호출 */
function generateArticle(f) {
  const payload = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: RULES + '\n\n다음은 우리 학교가 실제로 게시한 홍보글입니다. 문체와 구조를 따르되 문장을 그대로 베끼지는 마십시오.\n\n' + EXAMPLES,
    messages: [{ role: 'user', content: buildInput_(f) }]
  };

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': getApiKey_(),
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const data = JSON.parse(res.getContentText());

  if (code !== 200) {
    const msg = (data.error && data.error.message) || res.getContentText();
    if (code === 401) throw new Error('API 키가 올바르지 않습니다. 스크립트 속성을 확인해 주세요.');
    if (code === 429) throw new Error('요청이 몰렸습니다. 30초쯤 뒤에 다시 눌러 주세요.');
    if (code === 400 && msg.indexOf('credit') > -1) throw new Error('API 잔액이 부족합니다. Anthropic 콘솔에서 결제 정보를 확인해 주세요.');
    throw new Error('글을 만들지 못했습니다 (' + code + '). ' + msg);
  }

  const text = (data.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('\n')
    .trim();

  if (!text) throw new Error('빈 응답을 받았습니다. 다시 시도해 주세요.');

  const i = text.indexOf('---');
  if (i === -1) return { title: '', body: text };
  return {
    title: text.slice(0, i).replace(/^제목:\s*/, '').trim(),
    body: text.slice(i + 3).trim()
  };
}

/**
 * (선택) 만든 글을 스프레드시트에 기록하고 싶을 때
 * 아래 SHEET_ID에 스프레드시트 ID를 넣고, Index.html의 saveLog 호출 부분 주석을 풀면 됩니다.
 */
const SHEET_ID = '';

function saveLog(title, body) {
  if (!SHEET_ID) return;
  SpreadsheetApp.openById(SHEET_ID).getSheets()[0]
    .appendRow([new Date(), title, body]);
}

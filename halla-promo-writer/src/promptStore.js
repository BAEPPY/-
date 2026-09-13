'use strict';
/**
 * 규칙·예시 파일 관리
 *
 * 앱에 내장된 기본 규칙(RULES)과 예시(EXAMPLES)는 src/prompt.js에 있습니다.
 * 담당 교사가 앱을 다시 만들지 않고도 예시를 고칠 수 있도록,
 * 사용자 폴더에 텍스트 파일이 있으면 그 내용을 대신 씁니다.
 *
 *   <userData>/prompt/examples.txt   ← 홍보글 예시 (있으면 내장 예시 대신 사용)
 *   <userData>/prompt/rules.txt      ← 작성 규칙 (있으면 내장 규칙 대신 사용)
 *
 * 파일은 글을 만들 때마다 새로 읽으므로, 저장만 하면 바로 반영됩니다.
 */

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const builtin = require('./prompt');

const GUIDE = [
  '한라초 홍보글 작성 — 예시·규칙 파일 안내',
  '',
  '이 폴더의 파일을 고치면 앱을 다시 설치하지 않아도 바로 반영됩니다.',
  '',
  '  examples.txt  홍보글 예시. 새 유형이 생기면 맨 아래에 같은 형식으로 덧붙이세요.',
  '                유형 구분선(─── 설명 ───), 제목: 줄, 문단(□ 로 시작), 문단 사이 빈 줄.',
  '                비슷한 유형을 늘리기보다 없던 유형을 하나 채우는 쪽이 효과가 큽니다.',
  '                예시가 많아지면 글 한 편당 비용도 조금씩 오르니 겹치는 것은 지워도 됩니다.',
  '  rules.txt     작성 규칙. 교장 성함이 바뀌면 여기서 고치세요.',
  '',
  '파일을 지우면 앱에 내장된 기본 예시·규칙으로 돌아갑니다.',
  '(앱 메뉴 [도움말 > 기본 예시·규칙으로 되돌리기]로도 지울 수 있습니다.)',
  ''
].join('\n');

function dir() {
  return path.join(app.getPath('userData'), 'prompt');
}

function files() {
  const d = dir();
  return {
    dir: d,
    examples: path.join(d, 'examples.txt'),
    rules: path.join(d, 'rules.txt'),
    guide: path.join(d, '읽어보세요.txt')
  };
}

function readIfExists(file) {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
    return text || null;
  } catch (e) {
    return null;
  }
}

/** 현재 적용되는 규칙·예시. 파일이 있으면 파일, 없으면 내장값. */
function current() {
  const f = files();
  const rules = readIfExists(f.rules);
  const examples = readIfExists(f.examples);
  return {
    rules: rules || builtin.RULES,
    examples: examples || builtin.EXAMPLES,
    customRules: !!rules,
    customExamples: !!examples
  };
}

/** 편집용 파일이 없으면 내장 내용으로 만들어 두고 경로를 돌려줍니다. */
function ensureFiles() {
  const f = files();
  fs.mkdirSync(f.dir, { recursive: true });
  if (!fs.existsSync(f.examples)) fs.writeFileSync(f.examples, builtin.EXAMPLES + '\n', 'utf8');
  if (!fs.existsSync(f.rules)) fs.writeFileSync(f.rules, builtin.RULES + '\n', 'utf8');
  fs.writeFileSync(f.guide, GUIDE, 'utf8');
  return f;
}

/** 사용자 파일을 지워 내장 기본값으로 되돌립니다. */
function reset() {
  const f = files();
  for (const file of [f.examples, f.rules, f.guide]) {
    try { fs.unlinkSync(file); } catch (e) { /* 없으면 무시 */ }
  }
}

module.exports = { current, ensureFiles, reset, files };

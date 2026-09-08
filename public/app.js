// 끝말잇기 게임 클라이언트
import { allowedStarts, lastSyllable, euro } from '/shared/hangul.js';

const $ = (sel) => document.querySelector(sel);
const el = {
  setup: $('#screen-setup'), game: $('#screen-game'), result: $('#screen-result'),
  setupForm: $('#setup-form'), fieldP2: $('#field-p2'), fieldLevel: $('#field-level'),
  players: $('#players'), roundIndicator: $('#round-indicator'),
  promptLabel: $('#prompt-label'), promptWord: $('#prompt-word'), promptStarts: $('#prompt-starts'),
  timerFill: $('#timer-fill'), timerText: $('#timer-text'),
  wordForm: $('#word-form'), wordInput: $('#word-input'), btnSubmit: $('#btn-submit'),
  message: $('#message'), botThinking: $('#bot-thinking'),
  history: $('#history'), historyCount: $('#history-count'),
  overlay: $('#round-overlay'), overlayTitle: $('#overlay-title'), overlayDesc: $('#overlay-desc'), btnNextRound: $('#btn-next-round'),
  resultTitle: $('#result-title'), resultBody: $('#result-body'), resultBest: $('#result-best'),
  btnAgain: $('#btn-again'), btnSetup: $('#btn-setup'), btnQuit: $('#btn-quit'),
  dictBadge: $('#dict-badge'), chipDueum: $('#chip-dueum'), dueumNote: $('#dueum-note'),
};

// 첫 라운드 제시 글자 후보 (단어가 많은 흔한 첫 글자)
const START_SYLLABLES = ['가', '나', '다', '마', '바', '사', '자', '하', '기', '대', '소', '수', '주', '지', '전', '정', '조', '무', '미', '도', '고', '구', '산', '강', '공', '문', '물', '불', '시', '인'];

let serverConfig = { dueum: true, rules: {}, mock: false };
let settings = null;
let game = null;

// ───────────────────────── 초기화 ─────────────────────────

async function init() {
  try {
    const res = await fetch('/api/config');
    serverConfig = await res.json();
  } catch { /* 기본값 유지 */ }
  if (serverConfig.mock) {
    el.dictBadge.textContent = '모의 사전 (MOCK)';
    el.dictBadge.classList.add('mock');
    el.dictBadge.title = 'OPENDICT_API_KEY 가 없어 test/fixtures/mock-dict.json 을 사용 중';
  }
  if (!serverConfig.dueum) {
    el.chipDueum.textContent = '두음법칙 ✕';
    el.chipDueum.classList.add('off');
    el.dueumNote.textContent = '두음법칙은 적용되지 않아요.';
  }

  el.setupForm.addEventListener('change', syncSetupFields);
  syncSetupFields();
  el.setupForm.addEventListener('submit', (e) => { e.preventDefault(); startGame(readSettings()); });
  el.wordForm.addEventListener('submit', (e) => { e.preventDefault(); submitWord(); });
  el.btnNextRound.addEventListener('click', nextRound);
  el.btnAgain.addEventListener('click', () => startGame(settings));
  el.btnSetup.addEventListener('click', () => showScreen('setup'));
  el.btnQuit.addEventListener('click', () => {
    if (confirm('게임을 그만둘까요?')) { stopTimer(); finishGame(); }
  });
}

function syncSetupFields() {
  const mode = new FormData(el.setupForm).get('mode');
  el.fieldP2.hidden = mode !== 'local';
  el.fieldLevel.hidden = mode !== 'bot';
}

function readSettings() {
  const f = new FormData(el.setupForm);
  const mode = f.get('mode');
  const p1 = (f.get('p1') || '나').trim() || '나';
  const p2 = (f.get('p2') || '친구').trim() || '친구';
  return {
    mode,
    level: f.get('level') || 'normal',
    turnSec: Number(f.get('turnSec')) || 15,
    rounds: Number(f.get('rounds')) || 3,
    players: mode === 'bot'
      ? [{ name: p1, isBot: false }, { name: '컴퓨터', isBot: true }]
      : [{ name: p1, isBot: false }, { name: p2 === p1 ? p2 + '2' : p2, isBot: false }],
  };
}

function showScreen(name) {
  el.setup.hidden = name !== 'setup';
  el.game.hidden = name !== 'game';
  el.result.hidden = name !== 'result';
}

// ───────────────────────── 게임 진행 ─────────────────────────

function startGame(s) {
  settings = s;
  game = {
    players: s.players.map((p) => ({ ...p, score: 0, wins: 0, words: 0 })),
    round: 0,
    turn: 0,
    history: [],
    allHistory: [],
    used: new Set(),
    starts: [],
    lastWord: '',
    token: 0,
    timer: null,
    remaining: s.turnSec,
    busy: false,
    over: false,
  };
  showScreen('game');
  startRound();
}

function startRound() {
  const g = game;
  g.round += 1;
  g.history = [];
  g.used = new Set();
  g.lastWord = '';
  g.starts = [START_SYLLABLES[Math.floor(Math.random() * START_SYLLABLES.length)]];
  g.turn = (g.round - 1) % g.players.length; // 라운드마다 선공 교대
  el.history.innerHTML = '';
  el.historyCount.textContent = '0';
  el.overlay.hidden = true;
  renderRound();
  renderPrompt();
  renderPlayers();
  setMessage('', '');
  startTurn();
}

function startTurn() {
  const g = game;
  g.token += 1;
  g.busy = false;
  g.remaining = settings.turnSec;
  renderPlayers();
  renderTimer();
  startTimer();

  const player = g.players[g.turn];
  if (player.isBot) {
    el.wordInput.disabled = true;
    el.btnSubmit.disabled = true;
    el.botThinking.hidden = false;
    botTurn(g.token);
  } else {
    el.botThinking.hidden = true;
    el.wordInput.disabled = false;
    el.btnSubmit.disabled = false;
    el.wordInput.value = '';
    el.wordInput.focus();
  }
}

function nextPlayer() {
  game.turn = (game.turn + 1) % game.players.length;
}

async function submitWord() {
  const g = game;
  if (!g || g.busy || g.over) return;
  const word = el.wordInput.value.trim();
  if (!word) return;
  const token = g.token;
  g.busy = true;
  pauseTimer();
  el.btnSubmit.disabled = true;
  setMessage('확인 중…', 'info');

  let data;
  try {
    data = await validateWord(word);
  } catch (err) {
    if (token !== g.token) return;
    g.busy = false;
    el.btnSubmit.disabled = false;
    setMessage(`사전 확인에 실패했어요: ${err.message}`, 'bad');
    resumeTimer();
    return;
  }
  if (token !== g.token) return; // 그 사이에 턴이 끝남

  if (data.ok) {
    acceptWord(word, data.entry, data.nextStarts);
  } else {
    g.busy = false;
    el.btnSubmit.disabled = false;
    rejectWord(data.message ?? '사용할 수 없는 단어예요.');
    resumeTimer();
  }
}

async function validateWord(word) {
  const params = new URLSearchParams({ word, starts: game.starts.join(','), used: [...game.used].join(',') });
  const res = await fetch(`/api/validate?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function acceptWord(word, entry, nextStarts) {
  const g = game;
  stopTimer();
  const player = g.players[g.turn];
  const bonus = Math.round(g.remaining);
  const points = word.length * 10 + bonus;
  player.score += points;
  player.words += 1;
  g.used.add(word);
  g.lastWord = word;
  g.starts = nextStarts ?? allowedStarts(lastSyllable(word), { dueum: serverConfig.dueum });
  g.history.push({ word, entry, player, points });
  g.allHistory.push({ word, entry, player, points });
  renderHistoryItem({ word, entry, player, points });
  renderPrompt();
  setMessage(player.isBot ? `컴퓨터: ${word}` : `${word} ✓ +${points}점`, 'good');
  nextPlayer();
  startTurn();
}

function rejectWord(msg) {
  setMessage(msg, 'bad');
  el.wordForm.classList.remove('shake');
  void el.wordForm.offsetWidth; // 애니메이션 재시작
  el.wordForm.classList.add('shake');
  el.wordInput.select();
  el.wordInput.focus();
}

async function botTurn(token) {
  const g = game;
  const delayRange = { easy: [2000, 4500], normal: [1200, 3000], hard: [500, 1500] }[settings.level] ?? [1200, 3000];
  const delay = delayRange[0] + Math.random() * (delayRange[1] - delayRange[0]);
  const fetching = fetchBotWord();
  await sleep(delay);
  if (token !== g.token) return;
  let data;
  try {
    data = await fetching;
  } catch (err) {
    if (token !== g.token) return;
    setMessage(`컴퓨터가 사전을 열지 못했어요: ${err.message}`, 'bad');
    data = { ok: false };
  }
  if (token !== g.token) return;
  el.botThinking.hidden = true;
  if (data.ok) {
    acceptWord(data.word, data.entry, data.nextStarts);
  } else {
    stopTimer();
    endRound(g.turn, '이어갈 단어를 찾지 못했어요');
  }
}

async function fetchBotWord() {
  const params = new URLSearchParams({ starts: game.starts.join(','), used: [...game.used].join(','), level: settings.level });
  const res = await fetch(`/api/bot?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function endRound(loserIdx, why) {
  const g = game;
  g.token += 1;
  g.busy = true;
  el.wordInput.disabled = true;
  el.btnSubmit.disabled = true;
  el.botThinking.hidden = true;
  const loser = g.players[loserIdx];
  g.players.forEach((p, i) => { if (i !== loserIdx) p.wins += 1; });
  renderPlayers();

  const isLast = g.round >= settings.rounds;
  const winners = g.players.filter((_, i) => i !== loserIdx).map((p) => p.name).join(', ');
  el.overlayTitle.textContent = `${loser.name} 패배!`;
  el.overlayDesc.innerHTML = `${escapeHtml(why)}.<br>${escapeHtml(winners)} 승리 · 이번 라운드 단어 ${g.history.length}개`;
  el.btnNextRound.textContent = isLast ? '결과 보기' : `${g.round + 1}라운드 시작`;
  el.overlay.hidden = false;
  el.btnNextRound.focus();
}

function nextRound() {
  if (game.round >= settings.rounds) finishGame();
  else startRound();
}

function finishGame() {
  const g = game;
  g.over = true;
  el.overlay.hidden = true;
  const ranked = [...g.players].sort((a, b) => b.wins - a.wins || b.score - a.score);
  const top = ranked[0];
  const tie = ranked.length > 1 && ranked[1].wins === top.wins && ranked[1].score === top.score;
  el.resultTitle.textContent = tie ? '무승부!' : `🏆 ${top.name} 승리!`;
  el.resultBody.innerHTML = ranked.map((p, i) => `
    <tr class="${!tie && i === 0 ? 'winner' : ''}">
      <td>${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}</td><td>${p.wins}</td><td>${p.score}</td><td>${p.words}</td>
    </tr>`).join('');
  const best = g.allHistory.reduce((acc, h) => (!acc || h.word.length > acc.word.length ? h : acc), null);
  el.resultBest.textContent = best
    ? `가장 긴 단어: ${best.word} (${best.word.length}글자, ${best.player.name}) · 총 ${g.allHistory.length}개 단어`
    : '';
  showScreen('result');
}

// ───────────────────────── 타이머 ─────────────────────────

function startTimer() {
  stopTimer();
  game.lastTick = performance.now();
  game.timer = setInterval(tick, 100);
}
function pauseTimer() { if (game.timer) { clearInterval(game.timer); game.timer = null; } }
function resumeTimer() { if (!game.timer && !game.over) { game.lastTick = performance.now(); game.timer = setInterval(tick, 100); } }
function stopTimer() { pauseTimer(); }

function tick() {
  const g = game;
  const now = performance.now();
  g.remaining -= (now - g.lastTick) / 1000;
  g.lastTick = now;
  if (g.remaining <= 0) {
    g.remaining = 0;
    renderTimer();
    stopTimer();
    const p = g.players[g.turn];
    endRound(g.turn, p.isBot ? '컴퓨터가 시간 안에 답하지 못했어요' : '시간이 다 됐어요');
    return;
  }
  renderTimer();
}

function renderTimer() {
  const ratio = Math.max(0, game.remaining / settings.turnSec);
  el.timerFill.style.width = `${ratio * 100}%`;
  el.timerFill.className = 'timer-fill' + (ratio < 0.2 ? ' danger' : ratio < 0.5 ? ' warn' : '');
  el.timerText.textContent = game.remaining.toFixed(1);
}

// ───────────────────────── 렌더링 ─────────────────────────

function renderRound() {
  el.roundIndicator.textContent = `${game.round} / ${settings.rounds} 라운드`;
}

function renderPlayers() {
  el.players.innerHTML = game.players.map((p, i) => `
    <li class="player ${i === game.turn && !game.over ? 'active' : ''}">
      <span class="name">${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}</span>
      <span class="score">${p.score}</span>
      <span class="sub">라운드 승 ${p.wins} · 단어 ${p.words}</span>
    </li>`).join('');
}

function renderPrompt() {
  const g = game;
  if (g.lastWord) {
    const body = g.lastWord.slice(0, -1);
    el.promptLabel.textContent = '앞 단어';
    el.promptWord.innerHTML = `${escapeHtml(body)}<span class="tail">${escapeHtml(lastSyllable(g.lastWord))}</span>`;
  } else {
    el.promptLabel.textContent = '첫 단어 · 이 글자로 시작하세요';
    el.promptWord.innerHTML = '';
  }
  el.promptStarts.innerHTML = g.starts.map((s, i) => i === 0
    ? `<span class="start-syl">${escapeHtml(s)}</span>`
    : `<span class="start-syl alt">${escapeHtml(s)}<small>두음법칙</small></span>`).join('');
  el.wordInput.placeholder = `'${g.starts.join("' 또는 '")}'${euro(g.starts[0])} 시작하는 단어`;
}

function renderHistoryItem({ word, entry, player, points }) {
  const li = document.createElement('li');
  li.className = player.isBot ? 'bot' : 'me';
  const def = entry?.definition ? escapeHtml(entry.definition) : '';
  const origin = entry?.origin ? ` <span class="muted">(${escapeHtml(entry.origin)})</span>` : '';
  const link = entry?.link ? `<a href="${escapeAttr(entry.link)}" target="_blank" rel="noopener" title="우리말샘에서 보기">↗</a>` : '';
  li.innerHTML = `
    <div class="hw"><b>${escapeHtml(word)}</b>${origin}<span class="pts">+${points}</span></div>
    <div class="who">${escapeHtml(player.name)}</div>
    ${def ? `<div class="def">${def}${link}</div>` : ''}`;
  el.history.prepend(li);
  el.historyCount.textContent = String(game.history.length);
}

function setMessage(text, kind) {
  el.message.textContent = text;
  el.message.className = `message ${kind}`;
}

// ───────────────────────── 유틸 ─────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  const str = String(s);
  return /^https?:\/\//.test(str) ? escapeHtml(str) : '#';
}

init();

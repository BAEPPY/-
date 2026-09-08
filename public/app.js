// 끝말잇기 클라이언트: 홈(프로필·빠른 시작·방 만들기/찾기) + 방(대기실·게임·결과). 게임 진행은 서버가 주관하고 SSE 로 상태를 받는다.

const $ = (sel) => document.querySelector(sel);
const el = {
  home: $('#screen-home'), room: $('#screen-room'),
  nickBtn: $('#nick-btn'), nickLabel: $('#nick-label'), homeName: $('#home-name'), dictBadge: $('#dict-badge'),
  level: $('#level'), expFill: $('#exp-fill'), expText: $('#exp-text'), statWins: $('#stat-wins'), statWords: $('#stat-words'),
  roomsCount: $('#rooms-count'), quickBubble: $('#quick-bubble'), quickSub: $('#quick-sub'),
  btnCreate: $('#btn-create'), btnQuick: $('#btn-quick'), btnRefresh: $('#btn-refresh'), roomList: $('#room-list'), joinForm: $('#join-form'),
  createForm: $('#create-form'), modeGrid: $('#mode-grid'), fieldQuiz: $('#field-quiz'), ruleChecks: $('#rule-checks'), rulesField: $('#rules-field'), createMessage: $('#create-message'),
  rulesModes: $('#rules-modes'),
  roomMode: $('#room-mode'), roomName: $('#room-name'), roomCode: $('#room-code'), btnCopy: $('#btn-copy'), btnLeave: $('#btn-leave'), btnSide: $('#btn-side'), chatBadge: $('#chat-badge'),
  roundIndicator: $('#round-indicator'), stateDot: $('#state-dot'),
  board: $('#board'), boardCount: $('#board-count'), promptLabel: $('#prompt-label'), promptWord: $('#prompt-word'), timerFill: $('#timer-fill'), timerText: $('#timer-text'),
  boardLobby: $('#board-lobby'), settingsSummary: $('#settings-summary'), seatForm: $('#seat-form'), botForm: $('#bot-form'), btnSettings: $('#btn-settings'), hostTools: $('#host-tools'), btnStart: $('#btn-start'), waitingNote: $('#waiting-note'), lobbyHint: $('#lobby-hint'),
  boardGame: $('#board-game'), turnPill: $('#turn-pill'), wordForm: $('#word-form'), entryBadge: $('#entry-badge'), wordInput: $('#word-input'), btnSubmit: $('#btn-submit'), message: $('#message'), hints: $('#hints'),
  boardResult: $('#board-result'), resultTitle: $('#result-title'), resultBody: $('#result-body'), resultBest: $('#result-best'), btnAgain: $('#btn-again'), resultNote: $('#result-note'),
  players: $('#players'), side: $('#side'), history: $('#history'), historyCount: $('#history-count'), chatPanel: $('#chat-panel'), chatLog: $('#chat-log'), chatForm: $('#chat-form'),
  overlay: $('#round-overlay'), overlayTitle: $('#overlay-title'), overlayDesc: $('#overlay-desc'), btnNextRound: $('#btn-next-round'), overlayCount: $('#overlay-count'),
  countdown: $('#countdown'), countdownNum: $('#countdown-num'),
  settingsForm: $('#settings-form'), settingsMode: $('#settings-mode'), settingsRuleChecks: $('#settings-rule-checks'), settingsMessage: $('#settings-message'),
  sheetBackdrop: $('#sheet-backdrop'), toast: $('#toast'),
};

const store = {
  get(k, def = null) { try { return localStorage.getItem(k) ?? def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  json(k, def) { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
};

const state = {
  clientId: store.get('kkm.clientId') || newClientId(),
  nick: store.get('kkm.nick') || '',
  stats: store.json('kkm.stats', { wins: 0, words: 0, games: 0 }),
  config: { modes: [], ruleOptions: [], defaultRules: {}, dueum: true, mock: false },
  room: null,
  es: null,
  offset: 0,
  timer: null,
  lastPromptKey: '',
  pendingSubmit: false,
  sideTab: 'history',
  unreadChat: 0,
  countedGame: null,
};
store.set('kkm.clientId', state.clientId);

// ───────────────────────── 초기화 ─────────────────────────

async function init() {
  try {
    state.config = await (await fetch('/api/config')).json();
  } catch { /* 기본값 유지 */ }
  if (state.config.mock) {
    el.dictBadge.textContent = '모의 사전';
    el.dictBadge.classList.add('mock');
    el.dictBadge.title = 'OPENDICT_API_KEY 가 없어 test/fixtures/mock-dict.json 을 사용 중';
  }
  renderModeGrid();
  renderRuleChecks(el.ruleChecks, state.config.defaultRules);
  renderRuleChecks(el.settingsRuleChecks, state.config.defaultRules);
  el.settingsMode.innerHTML = state.config.modes.map((m) => `<option value="${m.id}" ${m.available ? '' : 'disabled'}>${m.emoji} ${escapeHtml(m.name)}</option>`).join('');
  el.rulesModes.innerHTML = state.config.modes.map((m) => `<li><b>${escapeHtml(m.emoji)} ${escapeHtml(m.name)}</b> — ${escapeHtml(m.desc)}</li>`).join('');

  ensureNick();
  renderStats();
  el.nickBtn.addEventListener('click', () => ensureNick(true));
  document.querySelectorAll('[data-sheet]').forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.sheet)));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheets));
  el.sheetBackdrop.addEventListener('click', closeSheets);
  el.btnCreate.addEventListener('click', () => openSheet('create'));
  el.createForm.addEventListener('change', syncCreateFields);
  el.createForm.addEventListener('submit', (e) => { e.preventDefault(); createRoom(false); });
  el.btnQuick.addEventListener('click', () => createRoom(true));
  el.btnRefresh.addEventListener('click', loadRooms);
  el.joinForm.addEventListener('submit', (e) => { e.preventDefault(); const code = new FormData(el.joinForm).get('code').trim().toUpperCase(); if (code) joinRoom(code); });
  el.btnCopy.addEventListener('click', copyInvite);
  el.btnLeave.addEventListener('click', () => leaveRoom());
  el.btnSide.addEventListener('click', () => { setSideTab('chat'); el.side.scrollIntoView({ behavior: 'smooth' }); });
  el.side.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setSideTab(t.dataset.tab)));
  el.seatForm.addEventListener('submit', (e) => { e.preventDefault(); addSeat(); });
  el.botForm.addEventListener('submit', (e) => { e.preventDefault(); addBot(); });
  el.btnStart.addEventListener('click', () => act('start'));
  el.btnNextRound.addEventListener('click', () => act('next'));
  el.btnAgain.addEventListener('click', () => act('next'));
  el.settingsForm.addEventListener('submit', (e) => { e.preventDefault(); applySettings(); });
  el.wordForm.addEventListener('submit', (e) => { e.preventDefault(); submitWord(); });
  el.chatForm.addEventListener('submit', (e) => { e.preventDefault(); sendChat(); });
  window.addEventListener('hashchange', handleHash);
  syncCreateFields();
  loadRooms();
  handleHash();
}

function newClientId() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 16; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

function ensureNick(force = false) {
  if (force || !state.nick) {
    const v = prompt('닉네임을 정하세요 (12자 이내)', state.nick || '');
    if (v != null && v.trim()) state.nick = v.trim().slice(0, 12);
    if (!state.nick) state.nick = `손님${Math.floor(Math.random() * 9000 + 1000)}`;
    store.set('kkm.nick', state.nick);
  }
  el.nickLabel.textContent = state.nick;
  el.homeName.textContent = state.nick;
}

function renderStats() {
  const s = state.stats;
  const per = 20;
  const level = 1 + Math.floor(s.words / per);
  el.level.textContent = String(level);
  el.expFill.style.width = `${((s.words % per) / per) * 100}%`;
  el.expText.textContent = `${s.words % per} / ${per}`;
  el.statWins.textContent = String(s.wins);
  el.statWords.textContent = String(s.words);
}

function recordGameResult(room) {
  const rr = room.roundResult;
  if (!rr?.final || state.countedGame === `${room.id}:${rr.ranking?.length}:${room.round}`) return;
  state.countedGame = `${room.id}:${rr.ranking?.length}:${room.round}`;
  const mine = room.players.filter((p) => p.mine);
  for (const p of mine) { state.stats.wins += p.wins; state.stats.words += p.words; }
  state.stats.games += 1;
  store.set('kkm.stats', JSON.stringify(state.stats));
  renderStats();
}

function modeInfo(id) {
  return state.config.modes.find((m) => m.id === id) ?? { id, name: id, emoji: '', turnBased: true, hasBot: true, lang: 'ko' };
}

function renderModeGrid() {
  el.modeGrid.innerHTML = state.config.modes.map((m, i) => `
    <label>
      <input type="radio" name="mode" value="${m.id}" ${i === 0 ? 'checked' : ''} ${m.available ? '' : 'disabled'}>
      <span class="mode-card"><span class="mode-emoji">${escapeHtml(m.emoji)}</span><b>${escapeHtml(m.name)}</b><small>${escapeHtml(m.desc)}${m.available ? '' : ' (서버에 영어 사전이 없어요)'}</small></span>
    </label>`).join('');
}

function renderRuleChecks(container, rules) {
  const dueumLabel = container.querySelector('label');
  container.innerHTML = '';
  container.appendChild(dueumLabel);
  for (const opt of state.config.ruleOptions ?? []) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" name="rule:${opt.key}" ${rules?.[opt.key] ? 'checked' : ''}><span>${escapeHtml(opt.label)} 허용</span>`;
    container.appendChild(label);
  }
}

function readRules(form) {
  const f = new FormData(form);
  const rules = {};
  for (const opt of state.config.ruleOptions ?? []) rules[opt.key] = f.get(`rule:${opt.key}`) != null;
  return rules;
}

function syncCreateFields(e) {
  const f = new FormData(el.createForm);
  const m = modeInfo(f.get('mode'));
  el.fieldQuiz.hidden = m.turnBased !== false;
  el.rulesField.hidden = m.lang === 'en';
  // 쿵쿵따: 우리말샘의 세 글자 단어는 대부분 합성어·파생어(사과-나무)라서 합성어를 허용하지 않으면 이어가기 어렵다
  if (m.id === 'kung' && e?.target?.name === 'mode') {
    const c = el.ruleChecks.querySelector('[name="rule:allowCompound"]');
    if (c) c.checked = true;
  }
  el.quickSub.textContent = `컴퓨터와 ${m.name}`;
}

function readCreateSettings(form) {
  const f = new FormData(form);
  return {
    turnSec: Number(f.get('turnSec')), rounds: Number(f.get('rounds')), maxPlayers: Number(f.get('maxPlayers')), quizCount: Number(f.get('quizCount')),
    level: f.get('level'), isPublic: f.get('isPublic') !== '0', dueum: f.get('dueum') != null, rules: readRules(form),
  };
}

// ───────────────────────── 시트 ─────────────────────────

function openSheet(name) {
  closeSheets();
  const sheet = $(`#sheet-${name}`);
  if (!sheet) return;
  if (name === 'rooms') loadRooms();
  if (name === 'settings' && state.room) fillSettingsForm(state.room);
  sheet.hidden = false;
  el.sheetBackdrop.hidden = false;
}

function closeSheets() {
  document.querySelectorAll('.sheet').forEach((s) => { s.hidden = true; });
  el.sheetBackdrop.hidden = true;
}

// ───────────────────────── API ─────────────────────────

async function post(path, body = {}) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId: state.clientId, ...body }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

async function act(action, body = {}) {
  if (!state.room) return null;
  try {
    return await post(`/api/rooms/${state.room.id}/${action}`, body);
  } catch (e) {
    toast(e.message);
    return null;
  }
}

// ───────────────────────── 홈 ─────────────────────────

async function loadRooms() {
  try {
    const data = await (await fetch('/api/rooms')).json();
    const rooms = data.rooms ?? [];
    const open = rooms.filter((r) => r.state === 'lobby' && r.players < r.maxPlayers).length;
    el.roomsCount.hidden = open === 0;
    el.roomsCount.textContent = String(open);
    el.quickBubble.hidden = rooms.length === 0;
    el.quickBubble.textContent = `${rooms.length}개 방이 열려 있어요`;
    if (rooms.length === 0) { el.roomList.innerHTML = '<li class="muted">열린 방이 없어요. 방을 만들어 보세요!</li>'; return; }
    el.roomList.innerHTML = rooms.map((r) => {
      const m = modeInfo(r.mode);
      const full = r.players >= r.maxPlayers;
      const canJoin = r.state === 'lobby' && !full;
      return `<li>
        <div class="room-info"><b>${escapeHtml(m.emoji)} ${escapeHtml(r.name)}</b><small>${escapeHtml(m.name)} · ${r.players}/${r.maxPlayers}명${r.bots ? ` + 🤖${r.bots}` : ''} · ${r.turnSec}초 · ${r.rounds}라운드 · <code>${r.id}</code></small></div>
        <span class="state ${r.state === 'lobby' ? '' : 'playing'}">${r.state === 'lobby' ? (full ? '가득 참' : '대기 중') : r.state === 'finished' ? '결과 보는 중' : '게임 중'}</span>
        <button type="button" class="btn ${canJoin ? 'btn-mint' : 'btn-gray'}" data-join="${r.id}" ${canJoin ? '' : 'disabled'}>입장</button>
      </li>`;
    }).join('');
    el.roomList.querySelectorAll('[data-join]').forEach((b) => b.addEventListener('click', () => joinRoom(b.dataset.join)));
  } catch {
    el.roomList.innerHTML = '<li class="muted">방 목록을 불러오지 못했어요.</li>';
  }
}

async function createRoom(quick) {
  const f = new FormData(el.createForm);
  const mode = f.get('mode');
  const settings = readCreateSettings(el.createForm);
  if (quick) { settings.isPublic = false; settings.maxPlayers = Math.max(settings.maxPlayers, 2); }
  setMsg(el.createMessage, '', '');
  try {
    const data = await post('/api/rooms', { name: state.nick, roomName: f.get('roomName') || `${state.nick}의 방`, mode, settings });
    closeSheets();
    await enterRoom(data.roomId);
    if (quick) {
      const m = modeInfo(mode);
      if (m.hasBot) await act('bot', { level: settings.level });
      await act('start');
    }
  } catch (e) {
    if (quick) toast(e.message); else setMsg(el.createMessage, e.message, 'bad');
  }
}

async function joinRoom(id) {
  try {
    await post(`/api/rooms/${id}/join`, { name: state.nick });
    closeSheets();
    await enterRoom(id);
  } catch (e) {
    toast(e.message);
    if (location.hash) history.replaceState(null, '', location.pathname);
  }
}

function handleHash() {
  const m = location.hash.match(/^#room=([A-Za-z0-9]{4,8})$/);
  if (!m) return;
  const id = m[1].toUpperCase();
  if (state.room?.id === id) return;
  joinRoom(id);
}

// ───────────────────────── 방 입장/퇴장 ─────────────────────────

async function enterRoom(id) {
  closeStream();
  state.room = { id };
  state.lastPromptKey = '';
  state.unreadChat = 0;
  el.history.innerHTML = '';
  el.chatLog.innerHTML = '';
  el.historyCount.textContent = '0';
  el.chatBadge.hidden = true;
  setMsg(el.message, '', '');
  setSideTab('history');
  history.replaceState(null, '', `#room=${id}`);
  showScreen('room');
  window.scrollTo(0, 0);
  openStream(id);
}

function openStream(id) {
  const es = new EventSource(`/api/rooms/${id}/events?clientId=${encodeURIComponent(state.clientId)}`);
  state.es = es;
  es.addEventListener('state', (e) => onState(JSON.parse(e.data)));
  es.addEventListener('word', (e) => onWord(JSON.parse(e.data)));
  es.addEventListener('reject', (e) => onReject(JSON.parse(e.data)));
  es.addEventListener('chat', (e) => appendChat(JSON.parse(e.data), true));
  es.addEventListener('system', (e) => appendChat({ ...JSON.parse(e.data), sys: true }));
  es.addEventListener('reveal', (e) => onReveal(JSON.parse(e.data)));
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) { toast('방과 연결이 끊겼어요.'); leaveRoom(true); }
  };
}

function closeStream() {
  if (state.es) { state.es.close(); state.es = null; }
  stopTimer();
}

async function leaveRoom(silent = false) {
  if (state.room && !silent) await act('leave');
  closeStream();
  state.room = null;
  history.replaceState(null, '', location.pathname);
  showScreen('home');
  loadRooms();
}

function showScreen(name) {
  el.home.hidden = name !== 'home';
  el.room.hidden = name !== 'room';
}

async function copyInvite() {
  const url = `${location.origin}${location.pathname}#room=${state.room.id}`;
  try { await navigator.clipboard.writeText(url); toast('초대 링크를 복사했어요'); } catch { prompt('초대 링크', url); }
}

async function addSeat() {
  const name = new FormData(el.seatForm).get('name').trim();
  if (!name) return;
  const r = await act('join', { name });
  if (r) el.seatForm.reset();
}

async function addBot() {
  const level = new FormData(el.botForm).get('level');
  await act('bot', { level });
}

async function applySettings() {
  const f = new FormData(el.settingsForm);
  const patch = {
    mode: f.get('mode'), turnSec: Number(f.get('turnSec')), rounds: Number(f.get('rounds')), maxPlayers: Number(f.get('maxPlayers')), quizCount: Number(f.get('quizCount')),
    level: f.get('level'), dueum: f.get('dueum') != null, rules: readRules(el.settingsForm),
  };
  const r = await act('settings', patch);
  if (r) { closeSheets(); toast('설정을 바꿨어요'); }
}

async function sendChat() {
  const text = new FormData(el.chatForm).get('text').trim();
  if (!text) return;
  el.chatForm.reset();
  await act('chat', { text });
}

function setSideTab(tab) {
  state.sideTab = tab;
  el.side.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  el.history.hidden = tab !== 'history';
  el.chatPanel.hidden = tab !== 'chat';
  if (tab === 'chat') { state.unreadChat = 0; el.chatBadge.hidden = true; }
}

// ───────────────────────── 서버 이벤트 ─────────────────────────

function onState(room) {
  const prev = state.room;
  state.room = room;
  state.offset = room.serverNow - Date.now();
  if (room.state === 'playing' && prev?.round !== room.round) { el.history.innerHTML = ''; el.historyCount.textContent = '0'; setMsg(el.message, '', ''); }
  if (room.state === 'lobby' && prev?.state === 'finished') { el.history.innerHTML = ''; el.historyCount.textContent = '0'; }
  render();
}

function onWord(item) {
  renderHistoryItem(item);
  const mine = state.room?.players.find((p) => p.id === item.playerId)?.mine;
  setMsg(el.message, `${item.name}: ${item.word} +${item.points}점`, mine ? 'good' : 'info');
  if (mine) el.wordInput.value = '';
}

function onReject(data) {
  setMsg(el.message, data.message ?? '사용할 수 없는 단어예요.', 'bad');
  el.wordForm.classList.remove('shake');
  void el.wordForm.offsetWidth;
  el.wordForm.classList.add('shake');
  el.wordInput.select();
  el.wordInput.focus();
}

function onReveal(data) {
  if (data.answer) {
    setMsg(el.message, `시간 초과! 정답은 ‘${data.answer}’`, 'info');
    renderHistoryItem({ word: data.answer, entry: data.entry, name: '정답', isBot: false, points: 0, reveal: true });
  }
}

function appendChat(msg, fromLive = false) {
  const li = document.createElement('li');
  if (msg.sys) { li.className = 'sys'; li.textContent = msg.text; } else li.innerHTML = `<b>${escapeHtml(msg.name)}</b>${escapeHtml(msg.text)}`;
  el.chatLog.appendChild(li);
  while (el.chatLog.children.length > 60) el.chatLog.firstChild.remove();
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
  if (fromLive && state.sideTab !== 'chat' && !msg.sys) {
    state.unreadChat += 1;
    el.chatBadge.textContent = String(state.unreadChat);
    el.chatBadge.hidden = false;
  }
}

// ───────────────────────── 렌더링 ─────────────────────────

function myTurnPlayer() {
  const r = state.room;
  if (!r) return null;
  const mode = modeInfo(r.mode);
  if (mode.turnBased) {
    const p = r.players.find((x) => x.id === r.turnPlayerId);
    return p?.mine ? p : null;
  }
  return r.players.find((p) => p.mine) ?? null;
}

function render() {
  const r = state.room;
  if (!r || !r.players) return;
  const mode = modeInfo(r.mode);
  el.roomMode.textContent = `${mode.emoji} ${mode.name}`;
  el.roomName.textContent = r.name;
  el.roomCode.textContent = r.id;

  const inLobby = r.state === 'lobby';
  const playing = r.state === 'playing' || r.state === 'roundEnd';
  const counting = r.state === 'countdown';
  el.boardLobby.hidden = !inLobby;
  el.boardGame.hidden = !playing;
  el.boardResult.hidden = r.state !== 'finished';
  el.countdown.hidden = !counting;
  el.seatForm.hidden = !inLobby;
  el.botForm.hidden = !(inLobby && r.isHost);
  el.botForm.querySelector('select').parentElement.querySelector('button[type=submit]').hidden = !mode.hasBot;
  el.hostTools.hidden = !(inLobby && r.isHost);
  el.waitingNote.hidden = !(inLobby && !r.isHost);
  el.roundIndicator.innerHTML = inLobby ? '대기 중' : counting ? '곧 시작' : r.state === 'finished' ? '게임 종료'
    : `라운드 <b>${r.round}</b> / ${r.settings.rounds}${r.quiz ? ` · ${r.quiz.index}/${r.quiz.count}` : ''}`;
  el.stateDot.textContent = playing ? '실' : inLobby ? '대' : counting ? '준' : '끝';
  el.stateDot.className = `dot ${inLobby ? 'lobby' : 'playing'}`;
  el.boardCount.hidden = !playing;
  el.boardCount.textContent = String(r.history?.length ?? 0);

  renderPlayers(r, mode);
  if (inLobby || counting) renderLobbyBoard(r, mode);
  if (inLobby) renderLobby(r, mode);
  if (playing) renderGame(r, mode);
  if (r.state === 'finished') { renderResult(r); recordGameResult(r); }
  renderOverlay(r);
  if (playing || counting) startTimer(); else stopTimer();
  if (r.history && el.history.children.length === 0) for (const h of r.history) renderHistoryItem(h);
  if (r.chat && el.chatLog.children.length === 0) for (const c of r.chat) appendChat(c);
}

function renderLobbyBoard(r, mode) {
  const chips = ruleChipText(r, mode);
  el.promptLabel.textContent = r.state === 'countdown' ? '잠시 후 시작해요' : `${mode.emoji} ${mode.name} · ${r.settings.turnSec}초 · ${r.settings.rounds}라운드`;
  el.promptWord.innerHTML = `<span class="last">${escapeHtml(r.state === 'countdown' ? '준비!' : chips)}</span>`;
  el.timerFill.style.width = '100%';
  el.timerFill.className = 'board-timer-fill';
  el.timerText.textContent = `${r.players.length}명 참가`;
}

function ruleChipText(r, mode) {
  if (mode.lang === 'en') return 'English · 3+ letters';
  const opts = state.config.ruleOptions ?? [];
  const allowed = opts.filter((o) => r.settings.rules[o.key]).map((o) => o.label);
  return `${r.settings.dueum ? '두음법칙 ○' : '두음법칙 ✕'} · ${allowed.length ? `${allowed.join(', ')} 허용` : '표준어 명사만'}`;
}

function renderPlayers(r, mode) {
  const n = r.players.length;
  el.players.className = `podiums${n > 4 ? ' lots' : n > 2 ? ' many' : ''}`;
  const top = Math.max(0, ...r.players.map((p) => p.score));
  const leaders = r.players.filter((p) => p.score === top && top > 0);
  el.players.innerHTML = r.players.map((p, i) => {
    const active = r.state === 'playing' && mode.turnBased && p.id === r.turnPlayerId;
    const canKick = (p.mine || (r.isHost && (p.isBot || !p.mine))) && r.state === 'lobby';
    const ring = active ? `<div class="ring active" data-ring="${p.id}">…</div>` : p.mine ? '<div class="ring mine">나</div>' : '<div class="ring"></div>';
    return `<div class="podium p${(i % 8) + 1} ${active ? 'active' : ''} ${p.isBot ? 'bot' : ''} ${p.connected ? '' : 'off'}">
      ${ring}
      <svg class="mascot"><use href="#mascot"/></svg>
      <div class="plaque">
        <div class="pname">${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}${p.isHost ? '<span class="tag">방장</span>' : ''}</div>
        <div class="counter">${counter(p.score)}</div>
        <div class="psub">승 ${p.wins} · 단어 ${p.words}${p.isBot && p.level ? ` · ${levelName(p.level)}` : ''}${p.connected ? '' : ' · 끊김'}</div>
        ${canKick ? `<button type="button" class="kick" data-kick="${p.id}">${p.mine ? '빼기' : '내보내기'}</button>` : ''}
        ${leaders.length === 1 && leaders[0] === p && r.state !== 'lobby' ? '<div class="lead">🔥 선두</div>' : ''}
      </div>
    </div>`;
  }).join('');
  el.players.querySelectorAll('[data-kick]').forEach((b) => b.addEventListener('click', () => act('leave', { playerId: b.dataset.kick })));
}

function counter(score) {
  const s = String(Math.max(0, Math.min(999999, score))).padStart(6, '0');
  const firstNonZero = s.search(/[1-9]/);
  if (firstNonZero < 0) return `<span class="z">00000</span>0`;
  return `<span class="z">${s.slice(0, firstNonZero)}</span>${s.slice(firstNonZero)}`;
}

function renderLobby(r, mode) {
  const s = r.settings;
  const rows = [['모드', `${mode.emoji} ${mode.name}`], ['턴 제한', `${s.turnSec}초`], ['라운드', `${s.rounds}라운드`], ['인원', `최대 ${s.maxPlayers}명`]];
  if (!mode.turnBased) rows.push(['문제 수', `라운드마다 ${s.quizCount}문제`]);
  if (mode.hasBot) rows.push(['컴퓨터', levelName(s.level)]);
  if (mode.lang !== 'en') rows.push(['인정 범위', ruleChipText(r, mode)]);
  el.settingsSummary.innerHTML = rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('');
  el.lobbyHint.textContent = mode.turnBased
    ? (r.players.length < 2 ? '2명 이상이 필요해요. 같은 화면에서 번갈아 하려면 친구 이름을 추가하고, 혼자면 컴퓨터를 추가하세요.' : '준비되면 방장이 게임을 시작해요. 🔗 를 눌러 초대 링크를 보낼 수 있어요.')
    : '초성 퀴즈는 모두가 동시에 답해요. 먼저 맞힌 사람이 점수를 가져가요.';
}

function fillSettingsForm(r) {
  const f = el.settingsForm;
  f.mode.value = r.mode;
  f.turnSec.value = String(r.settings.turnSec);
  f.rounds.value = String(r.settings.rounds);
  f.maxPlayers.value = String(r.settings.maxPlayers);
  f.quizCount.value = String(r.settings.quizCount);
  f.level.value = r.settings.level;
  f.dueum.checked = r.settings.dueum;
  for (const o of state.config.ruleOptions ?? []) { const c = f.querySelector(`[name="rule:${o.key}"]`); if (c) c.checked = Boolean(r.settings.rules[o.key]); }
}

function renderGame(r, mode) {
  const p = r.prompt;
  const key = JSON.stringify([r.round, p, r.turnPlayerId, r.quiz?.index]);
  if (key !== state.lastPromptKey) {
    state.lastPromptKey = key;
    renderPrompt(r, mode);
  }
  const me = myTurnPlayer();
  const canType = r.state === 'playing' && me != null;
  el.wordInput.disabled = !canType;
  el.btnSubmit.disabled = !canType || state.pendingSubmit;
  el.wordForm.classList.toggle('idle', !canType);
  const turnP = r.players.find((x) => x.id === r.turnPlayerId);
  const mine = r.players.filter((x) => x.mine);
  el.turnPill.hidden = false;
  if (!mode.turnBased) {
    el.turnPill.textContent = `초성 퀴즈 ${r.quiz?.index ?? 1} / ${r.quiz?.count ?? ''} · 먼저 맞히면 점수!`;
    el.turnPill.className = 'turn-pill';
    el.entryBadge.textContent = canType ? '지금 답하세요!' : '대기';
  } else if (me) {
    el.turnPill.textContent = '';
    el.turnPill.className = 'turn-pill';
    el.turnPill.hidden = true;
    el.entryBadge.textContent = mine.length > 1 ? `${me.name} 차례!` : '내 차례!';
  } else {
    el.turnPill.textContent = turnP ? `${turnP.name} 님의 차례` : '';
    el.turnPill.className = 'turn-pill';
    el.entryBadge.textContent = turnP?.isBot ? `${turnP.name}가 생각하는 중…` : '기다리는 중';
  }
  el.wordInput.lang = mode.lang === 'en' ? 'en' : 'ko';
  if (canType && document.activeElement !== el.wordInput && el.overlay.hidden) el.wordInput.focus({ preventScroll: true });
}

function promptLabelFor(p, mode) {
  if (!p) return '';
  switch (p.type) {
    case 'starts': return p.lastWord ? '앞 단어의 끝 글자로 시작' : '첫 단어 · 이 글자로 시작';
    case 'ends': return p.lastWord ? '앞 단어의 첫 글자로 끝나게' : '첫 단어 · 이 글자로 끝나게';
    case 'hunmin': return '이 초성으로 시작하는 단어';
    case 'choseong': return `초성 퀴즈 · ${p.length}글자`;
    case 'letter': return p.lastWord ? 'Starts with the last letter' : 'First word · start with';
    default: return mode.name;
  }
}

function renderPrompt(r, mode) {
  const p = r.prompt;
  el.hints.innerHTML = '';
  if (!p) { el.promptLabel.textContent = '문제를 준비하는 중…'; el.promptWord.innerHTML = ''; return; }
  el.promptLabel.textContent = promptLabelFor(p, mode);
  let html = '';
  const hints = [];
  let placeholder = '단어를 입력하세요';
  const lastLine = (word, tailIdx) => {
    const chars = [...word];
    return `<span class="last">${chars.map((c, i) => (i === tailIdx ? `<i>${escapeHtml(c)}</i>` : escapeHtml(c))).join('')}</span>`;
  };
  if (p.type === 'starts' || p.type === 'letter') {
    const main = p.type === 'letter' ? p.starts[0].toUpperCase() : p.starts[0];
    html = `<span>${escapeHtml(main)}</span>${p.starts.slice(1).map((s) => `<span class="alt">${escapeHtml(s)}<small>두음법칙</small></span>`).join('')}`;
    if (p.lastWord) html += lastLine(p.lastWord, [...p.lastWord].length - 1);
    placeholder = p.type === 'letter' ? `Word starting with '${p.starts[0]}'` : `'${p.starts.join("' 또는 '")}'(으)로 시작`;
    if (mode.id === 'kung') hints.push('<span class="hint-chip">🥁 <b>세 글자</b>만</span>');
    if (p.starts.length > 1) hints.push(`<span class="hint-chip">두음법칙: <b>${escapeHtml(p.starts.slice(1).join(', '))}</b>(으)로 시작해도 돼요</span>`);
  } else if (p.type === 'ends') {
    html = `<span>…${escapeHtml(p.ends[0])}</span>${p.ends.slice(1).map((s) => `<span class="alt">…${escapeHtml(s)}<small>두음법칙</small></span>`).join('')}`;
    if (p.lastWord) html += lastLine(p.lastWord, 0);
    placeholder = `'${p.ends.join("' 또는 '")}'(으)로 끝나는 단어`;
    hints.push('<span class="hint-chip">🔙 앞 단어의 <b>첫 글자</b>로 끝나야 해요</span>');
  } else if (p.type === 'hunmin') {
    html = `<span class="cho">${escapeHtml(p.cho)}</span>`;
    placeholder = `초성 '${p.cho}'로 시작하는 단어`;
    hints.push(`<span class="hint-chip">예: <b>${escapeHtml(exampleFor(p.cho))}</b></span>`);
  } else if (p.type === 'choseong') {
    html = `<span class="cho">${escapeHtml(p.cho)}</span>`;
    placeholder = `초성이 '${p.cho}'인 ${p.length}글자 단어`;
    hints.push(`<span class="hint-chip">초성이 같은 <b>다른 단어</b>도 정답이에요</span>`);
  }
  el.promptWord.innerHTML = html;
  el.wordInput.placeholder = placeholder;
  el.hints.innerHTML = hints.join('');
}

function exampleFor(cho) {
  const table = { ㄱㅅ: '가수', ㅅㄱ: '사과', ㄴㅁ: '나무', ㅎㄴ: '하늘', ㅂㄷ: '바다', ㅈㄱ: '지구', ㅁㅅ: '미소', ㄱㅈ: '가지', ㅇㅅ: '인사', ㅅㅈ: '사자' };
  return table[cho] ?? '…';
}

function renderOverlay(r) {
  const rr = r.roundResult;
  const show = r.state === 'roundEnd' && rr;
  el.overlay.hidden = !show;
  if (!show) return;
  el.overlayTitle.textContent = rr.loser ? `${rr.loser.name} 패배!` : (rr.winners.length ? `${rr.winners.join(', ')} 승리!` : `${rr.round}라운드 종료`);
  const line2 = rr.loser ? `${rr.winners.join(', ')} 승리` : '';
  el.overlayDesc.innerHTML = `${escapeHtml(rr.why ?? '')}${line2 ? `<br>${escapeHtml(line2)}` : ''}<br>이번 라운드 단어 ${rr.words}개`;
  el.btnNextRound.hidden = !r.isHost;
  el.btnNextRound.textContent = rr.isLast ? '결과 보기' : `${rr.round + 1}라운드 시작`;
}

function renderResult(r) {
  const rr = r.roundResult ?? {};
  const ranking = rr.ranking ?? [];
  el.resultTitle.textContent = rr.tie ? '무승부!' : rr.champion ? `🏆 ${rr.champion.name} 승리!` : '게임 종료';
  el.resultBody.innerHTML = ranking.map((p, i) => `
    <tr class="${!rr.tie && i === 0 ? 'winner' : ''}">
      <td>${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}</td><td>${p.wins}</td><td>${p.score}</td><td>${p.words}</td>
    </tr>`).join('');
  el.resultBest.textContent = rr.why ? rr.why : '';
  el.btnAgain.hidden = !r.isHost;
  el.resultNote.textContent = r.isHost ? '' : '방장이 다시 시작하면 대기실로 돌아가요.';
  el.promptLabel.textContent = '게임 종료';
  el.promptWord.innerHTML = `<span class="last">${escapeHtml(rr.champion ? `${rr.champion.name} 승리` : '무승부')}</span>`;
  el.timerText.textContent = '';
}

function renderHistoryItem(item) {
  const li = document.createElement('li');
  const p = state.room?.players.find((x) => x.id === item.playerId);
  li.className = item.reveal ? 'other' : item.isBot ? 'bot' : p?.mine ? 'me' : 'other';
  const entry = item.entry ?? {};
  const def = entry.definition ? escapeHtml(entry.definition) : '';
  const origin = entry.origin ? ` <span class="muted">(${escapeHtml(entry.origin)})</span>` : '';
  const link = entry.link ? `<a href="${escapeAttr(entry.link)}" target="_blank" rel="noopener" title="사전에서 보기">↗</a>` : '';
  li.innerHTML = `
    <div class="hw"><b>${escapeHtml(item.word)}</b>${origin}${item.reveal ? '' : `<span class="pts">+${item.points}</span>`}</div>
    <div class="who">${escapeHtml(item.name)}</div>
    ${def || link ? `<div class="def">${def}${link}</div>` : ''}`;
  el.history.prepend(li);
  el.historyCount.textContent = String(el.history.children.length);
  el.boardCount.textContent = String(el.history.children.length);
}

function levelName(l) { return { easy: '쉬움', normal: '보통', hard: '어려움' }[l] ?? l; }

// ───────────────────────── 입력 ─────────────────────────

async function submitWord() {
  const r = state.room;
  const me = myTurnPlayer();
  if (!r || !me || state.pendingSubmit) return;
  const word = el.wordInput.value.trim();
  if (!word) return;
  state.pendingSubmit = true;
  el.btnSubmit.disabled = true;
  setMsg(el.message, '확인 중…', 'info');
  try {
    const data = await post(`/api/rooms/${r.id}/word`, { playerId: me.id, word });
    if (data.ok) el.wordInput.value = '';
    else if (data.reason === 'late') setMsg(el.message, data.message, 'info');
  } catch (e) {
    setMsg(el.message, e.message, 'bad');
  } finally {
    state.pendingSubmit = false;
    el.btnSubmit.disabled = !myTurnPlayer();
    if (myTurnPlayer()) el.wordInput.focus({ preventScroll: true });
  }
}

// ───────────────────────── 타이머 ─────────────────────────

function startTimer() {
  if (state.timer) return;
  state.timer = setInterval(tick, 100);
  tick();
}
function stopTimer() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
}
function tick() {
  const r = state.room;
  if (!r) return;
  const remaining = Math.max(0, (r.deadline - (Date.now() + state.offset)) / 1000);
  if (r.state === 'countdown') { el.countdownNum.textContent = String(Math.max(1, Math.ceil(remaining))); return; }
  if (r.state === 'roundEnd') { el.overlayCount.textContent = `${Math.ceil(remaining)}초 뒤 자동으로 넘어가요`; return; }
  const total = r.settings.turnSec;
  const ratio = Math.max(0, Math.min(1, remaining / total));
  el.timerFill.style.width = `${ratio * 100}%`;
  el.timerFill.className = 'board-timer-fill' + (ratio < 0.2 ? ' danger' : ratio < 0.5 ? ' warn' : '');
  el.timerText.textContent = `${remaining.toFixed(1)}초`;
  const ring = el.players.querySelector('[data-ring]');
  if (ring) ring.textContent = `${remaining.toFixed(1)}초`;
}

// ───────────────────────── 유틸 ─────────────────────────

let toastTimer = null;
function toast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
}
function setMsg(node, text, kind) {
  node.textContent = text;
  node.className = `${node === el.message ? 'entry-bar-text ' : ''}message ${kind ?? ''}`;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  const str = String(s);
  return /^https?:\/\//.test(str) ? escapeHtml(str) : '#';
}

init();

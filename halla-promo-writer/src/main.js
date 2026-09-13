'use strict';
/**
 * 한라초 홍보글 작성 — 데스크톱 앱 메인 프로세스
 *
 * 하는 일
 *  - 창을 띄우고 화면(renderer/)을 보여 줍니다.
 *  - 화면에서 온 요청(IPC)을 받아 Anthropic API를 호출합니다. API 키는 메인 프로세스에만 있습니다.
 *  - 설정(API 키·모델), 예시·규칙 파일, 만든 글 보관함을 관리합니다.
 */

const { app, BrowserWindow, Menu, ipcMain, shell, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_TITLE = '한라초 홍보글 작성';
app.setName(APP_TITLE);
// 설정·보관함 폴더를 개발 중과 설치판에서 똑같이 맞춥니다.
//   Windows: C:\Users\<이름>\AppData\Roaming\HallaPromoWriter
//   macOS:   ~/Library/Application Support/HallaPromoWriter
app.setPath('userData', path.join(app.getPath('appData'), 'HallaPromoWriter'));

const settings = require('./settings');
const promptStore = require('./promptStore');
const api = require('./api');

const isMac = process.platform === 'darwin';
const LINKS = {
  apiKeys: 'https://console.anthropic.com/settings/keys',
  billing: 'https://console.anthropic.com/settings/billing'
};
const ALLOWED_EXTERNAL = ['https://console.anthropic.com/', 'https://docs.anthropic.com/', 'https://www.anthropic.com/'];

let mainWindow = null;

/* ───────── 창 ───────── */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 880,
    minWidth: 720,
    minHeight: 560,
    title: APP_TITLE,
    show: false,
    backgroundColor: '#E9EEEF',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 화면 안의 링크는 앱 안에서 열지 않고 기본 브라우저로 보냅니다.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) {
      event.preventDefault();
      openExternal(url);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function openExternal(url) {
  if (typeof url === 'string' && ALLOWED_EXTERNAL.some(prefix => url.startsWith(prefix))) {
    shell.openExternal(url);
    return true;
  }
  return false;
}

function sendOpenSettings() {
  if (mainWindow) mainWindow.webContents.send('ui:open-settings');
}

/* ───────── 만든 글 보관함 ───────── */

function historyDir() {
  return path.join(app.getPath('userData'), 'history');
}

function saveHistory(article) {
  try {
    const dir = historyDir();
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    const safeTitle = (article.title || '제목없음').replace(/[\\/:*?"<>|\r\n]/g, ' ').trim().slice(0, 40);
    fs.writeFileSync(path.join(dir, stamp + ' ' + safeTitle + '.txt'),
      (article.title || '') + '\n\n' + (article.body || '') + '\n', 'utf8');
  } catch (e) {
    // 보관함 저장 실패는 글 만들기 자체를 막지 않습니다.
    console.error('history save failed:', e);
  }
}

/* ───────── 메뉴 ───────── */

async function confirmResetPrompt() {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['되돌리기', '취소'],
    defaultId: 1,
    cancelId: 1,
    title: APP_TITLE,
    message: '직접 고친 예시·규칙 파일을 지우고 앱에 내장된 기본값으로 되돌릴까요?',
    detail: '지운 파일은 복구할 수 없습니다. 남겨 두고 싶으면 먼저 폴더를 열어 복사해 두세요.'
  });
  if (response === 0) promptStore.reset();
}

function buildMenu() {
  const settingsItem = { label: '설정…', accelerator: 'CmdOrCtrl+,', click: sendOpenSettings };

  const template = [
    ...(isMac ? [{
      label: APP_TITLE,
      submenu: [
        { role: 'about', label: APP_TITLE + ' 정보' },
        { type: 'separator' },
        settingsItem,
        { type: 'separator' },
        { role: 'hide', label: '숨기기' },
        { role: 'hideOthers', label: '다른 앱 숨기기' },
        { role: 'unhide', label: '모두 보기' },
        { type: 'separator' },
        { role: 'quit', label: '종료' }
      ]
    }] : []),
    {
      label: '파일',
      submenu: [
        ...(isMac ? [] : [settingsItem, { type: 'separator' }]),
        { label: '만든 글 보관함 열기', click: () => { fs.mkdirSync(historyDir(), { recursive: true }); shell.openPath(historyDir()); } },
        { type: 'separator' },
        isMac ? { role: 'close', label: '창 닫기' } : { role: 'quit', label: '종료' }
      ]
    },
    {
      label: '편집',
      submenu: [
        { role: 'undo', label: '실행 취소' },
        { role: 'redo', label: '다시 실행' },
        { type: 'separator' },
        { role: 'cut', label: '잘라내기' },
        { role: 'copy', label: '복사' },
        { role: 'paste', label: '붙여넣기' },
        { role: 'selectAll', label: '모두 선택' }
      ]
    },
    {
      label: '보기',
      submenu: [
        { role: 'resetZoom', label: '실제 크기' },
        { role: 'zoomIn', label: '확대' },
        { role: 'zoomOut', label: '축소' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '전체 화면' }
      ]
    },
    {
      label: '도움말',
      submenu: [
        { label: 'API 키 발급 페이지 열기', click: () => shell.openExternal(LINKS.apiKeys) },
        { label: '사용량·결제 확인 (Anthropic 콘솔)', click: () => shell.openExternal(LINKS.billing) },
        { type: 'separator' },
        { label: '홍보글 예시 편집…', click: () => shell.openPath(promptStore.ensureFiles().examples) },
        { label: '작성 규칙 편집…', click: () => shell.openPath(promptStore.ensureFiles().rules) },
        { label: '예시·규칙 폴더 열기', click: () => shell.openPath(promptStore.ensureFiles().dir) },
        { label: '기본 예시·규칙으로 되돌리기', click: confirmResetPrompt },
        { type: 'separator' },
        { label: '설정 파일 위치 열기', click: () => shell.showItemInFolder(settings.settingsPath()) },
        { label: '버전 ' + app.getVersion(), enabled: false }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ───────── 화면과의 통신(IPC) ───────── */

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max || 20000) : '';
}

function sanitizeForm(f) {
  const src = f && typeof f === 'object' ? f : {};
  return {
    dateText: str(src.dateText, 200),
    target: str(src.target, 200),
    activity: str(src.activity, 300),
    detail: str(src.detail),
    scale: str(src.scale, 300),
    partner: str(src.partner, 300),
    effect: str(src.effect, 2000),
    voiceMode: ['none', 'polish', 'quote'].includes(src.voiceMode) ? src.voiceMode : 'none',
    voice: str(src.voice, 2000),
    quote2: str(src.quote2, 2000),
    tone: src.tone === 'polite' ? 'polite' : 'report',
    tense: src.tense === 'plan' ? 'plan' : 'done',
    paras: ['3', '4', '5'].includes(String(src.paras)) ? String(src.paras) : '3',
    mark: ['□', '○', '*'].includes(src.mark) ? src.mark : '□',
    subhead: !!src.subhead,
    iem: !!src.iem,
    signer: str(src.signer, 100)
  };
}

function settingsForUi() {
  const p = promptStore.current();
  return Object.assign(settings.summary(), {
    models: api.MODELS,
    defaultModel: api.DEFAULT_MODEL,
    customRules: p.customRules,
    customExamples: p.customExamples
  });
}

function registerIpc() {
  ipcMain.handle('settings:get', () => settingsForUi());

  ipcMain.handle('settings:save', (event, data) => {
    const d = data && typeof data === 'object' ? data : {};
    if (typeof d.apiKey === 'string' && d.apiKey.trim()) settings.setApiKey(d.apiKey);
    if (typeof d.model === 'string' && api.MODELS.some(m => m.id === d.model)) settings.setModel(d.model);
    return settingsForUi();
  });

  ipcMain.handle('settings:clear-key', () => {
    settings.setApiKey('');
    return settingsForUi();
  });

  ipcMain.handle('models:list', () => api.MODELS);

  ipcMain.handle('article:generate', async (event, form) => {
    const apiKey = settings.getApiKey();
    if (!apiKey) {
      return { ok: false, needKey: true, error: 'API 키가 없습니다. 설정에서 키를 먼저 넣어 주세요.' };
    }
    const prompt = promptStore.current();
    try {
      const result = await api.generateArticle(sanitizeForm(form), {
        apiKey,
        model: settings.getModel() || api.DEFAULT_MODEL,
        rules: prompt.rules,
        examples: prompt.examples
      });
      saveHistory(result);
      return Object.assign({ ok: true }, result);
    } catch (err) {
      console.error('generate failed:', err && err.status ? err.status : '', err && err.message ? err.message : err);
      return { ok: false, error: api.describeError(err) };
    }
  });

  ipcMain.handle('clipboard:write', (event, text) => {
    clipboard.writeText(typeof text === 'string' ? text : '');
    return true;
  });

  ipcMain.handle('shell:open-external', (event, url) => openExternal(url));
}

/* ───────── 앱 수명 ───────── */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpc();
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}

'use strict';
/**
 * 설정 저장소 — API 키와 모델 선택을 이 컴퓨터에만 저장합니다.
 *
 * 저장 위치: app.getPath('userData')/settings.json
 *   Windows: C:\Users\<이름>\AppData\Roaming\HallaPromoWriter\settings.json
 *   macOS:   ~/Library/Application Support/HallaPromoWriter/settings.json
 *
 * API 키는 운영체제의 보안 저장소(Windows DPAPI, macOS 키체인)로 암호화해 저장합니다.
 * 암호화를 쓸 수 없는 환경에서는 평문으로 저장되며, 설정 화면에 그 사실을 표시합니다.
 *
 * 환경 변수 ANTHROPIC_API_KEY가 있으면 저장된 키보다 우선합니다(개발·시험용).
 */

const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readFile() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    return {};
  }
}

function writeFile(data) {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch (e) {
    return false;
  }
}

/** 저장된 API 키(복호화된 문자열). 없으면 ''. */
function getApiKey() {
  const env = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (env) return env;

  const data = readFile();
  if (data.apiKeyEncrypted) {
    if (!encryptionAvailable()) return '';
    try {
      return safeStorage.decryptString(Buffer.from(data.apiKeyEncrypted, 'base64'));
    } catch (e) {
      return '';
    }
  }
  return typeof data.apiKeyPlain === 'string' ? data.apiKeyPlain : '';
}

function setApiKey(key) {
  const data = readFile();
  const trimmed = (key || '').trim();
  delete data.apiKeyEncrypted;
  delete data.apiKeyPlain;
  if (trimmed) {
    let encrypted = null;
    try {
      if (encryptionAvailable()) encrypted = safeStorage.encryptString(trimmed).toString('base64');
    } catch (e) {
      encrypted = null; // 암호화가 안 되는 환경이면 평문으로 저장합니다.
    }
    if (encrypted) data.apiKeyEncrypted = encrypted;
    else data.apiKeyPlain = trimmed;
  }
  writeFile(data);
}

function getModel() {
  const data = readFile();
  return typeof data.model === 'string' ? data.model : '';
}

function setModel(model) {
  const data = readFile();
  data.model = model;
  writeFile(data);
}

/** 화면에 보여 줄 요약. 키 원문은 절대 화면으로 보내지 않습니다. */
function summary() {
  const data = readFile();
  const key = getApiKey();
  const fromEnv = !!(process.env.ANTHROPIC_API_KEY || '').trim();
  return {
    hasKey: !!key,
    keyHint: key ? key.slice(0, 7) + '…' + key.slice(-4) : '',
    keyFromEnv: fromEnv,
    encrypted: fromEnv ? false : !!data.apiKeyEncrypted,
    model: getModel(),
    settingsPath: settingsPath()
  };
}

module.exports = { getApiKey, setApiKey, getModel, setModel, summary, settingsPath };

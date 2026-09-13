'use strict';
/* 한라초 홍보글 작성 — 화면 로직. 메인 프로세스와는 window.halla(preload)로만 통신합니다. */
(function () {
  var WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  var DEFAULT_INTRO = 'API 키는 이 컴퓨터에만 저장되며, 화면이 아닌 앱 내부에서만 사용합니다.';
  var state = { dateMode: 'single', voiceMode: 'none', tone: 'report', tense: 'done', mark: '□', paras: '3' };
  var settings = { hasKey: false, models: [], model: '', defaultModel: '' };

  function $(id) { return document.getElementById(id); }

  /* ───── 날짜 표기 ───── */
  function fmt(iso, withYear) {
    if (!iso) return '';
    var p = iso.split('-'), Y = +p[0], M = +p[1], D = +p[2];
    var w = WEEK[new Date(Y, M - 1, D).getDay()];
    return (withYear === false ? '' : Y + '년 ') + M + '월 ' + D + '일(' + w + ')';
  }
  function dayOnly(iso) {
    var p = iso.split('-'), Y = +p[0], M = +p[1], D = +p[2];
    return D + '일(' + WEEK[new Date(Y, M - 1, D).getDay()] + ')';
  }
  function dateText() {
    if (state.dateMode === 'free') return $('dFree').value.trim();
    if (state.dateMode === 'single') return fmt($('d1').value);
    var a = $('d1b').value, b = $('d2').value;
    if (!a) return '';
    if (!b) return fmt(a);
    var pa = a.split('-'), pb = b.split('-');
    if (pa[0] !== pb[0]) return fmt(a) + '부터 ' + fmt(b) + '까지';
    if (pa[1] !== pb[1]) return fmt(a) + '부터 ' + fmt(b, false) + '까지';
    return fmt(a) + '부터 ' + dayOnly(b) + '까지';
  }

  /* ───── 세그먼트 버튼 ───── */
  function seg(id, key, after) {
    var box = $(id);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      Array.prototype.forEach.call(box.querySelectorAll('button'), function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      state[key] = b.getAttribute('data-v');
      if (after) after();
    });
  }
  seg('segDate', 'dateMode', function () {
    $('dateSingle').classList.toggle('hide', state.dateMode !== 'single');
    $('dateRange').classList.toggle('hide', state.dateMode !== 'range');
    $('dateFree').classList.toggle('hide', state.dateMode !== 'free');
    refresh();
  });
  seg('segVoice', 'voiceMode', function () {
    var on = state.voiceMode !== 'none';
    $('voice').classList.toggle('hide', !on);
    $('voice').placeholder = state.voiceMode === 'polish'
      ? '실제로 나온 말을 짧게 (예: 공책 이렇게 정리해볼래요, 재밌었어요)'
      : '실제 발언을 그대로';
    $('voiceHelp').textContent =
      state.voiceMode === 'none' ? '소감 문장 없이 서술로 마무리합니다.'
        : state.voiceMode === 'polish' ? '특정 인물을 지목하지 않는 간접 요약으로 정리합니다.'
          : '큰따옴표 직접 인용으로 들어갑니다. 실제 발언만 넣으세요.';
  });
  seg('segTone', 'tone'); seg('segTense', 'tense'); seg('segMark', 'mark'); seg('segParas', 'paras');

  /* ───── 대상 칩 ───── */
  ['1학년', '2학년', '3학년', '4학년', '5학년', '6학년', '전교생', '본교 교원', '학부모', '전교학생회', '학부모회'].forEach(function (t) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = t;
    b.onclick = function () { $('target').value = t; refresh(); };
    $('targetChips').appendChild(b);
  });

  /* ───── 게시 체크리스트 ───── */
  ['학교 홈페이지 접속 후 인증서로 로그인',
    '알림마당 > 공지사항 에 등록',
    '알림마당 > 학교소식 에 같은 내용으로 한 번 더 등록',
    '사진 4~5장 첨부 (카톡방 사진 중 아이들 얼굴이 크게 나오지 않은 것)'
  ].forEach(function (t) {
    var li = document.createElement('li');
    li.innerHTML = '<input type="checkbox"><span></span>';
    li.querySelector('span').textContent = t;
    li.onclick = function (e) {
      var cb = li.querySelector('input');
      if (e.target !== cb) cb.checked = !cb.checked;
      li.classList.toggle('done', cb.checked);
    };
    $('checklist').appendChild(li);
  });

  /* ───── 입력 상태 ───── */
  function refresh() {
    $('datePreview').textContent = dateText() ? '본문 표기: ' + dateText() : '';
    var filled = $('target').value.trim() && $('activity').value.trim() && $('detail').value.trim();
    $('go').disabled = !filled;
    $('readyNote').classList.toggle('hide', !!(filled && settings.hasKey));
    $('readyNote').textContent = settings.hasKey
      ? '대상 · 활동명 · 활동 내용을 채우면 만들 수 있습니다.'
      : '설정(오른쪽 위 ⚙)에서 Anthropic API 키를 먼저 넣어 주세요.';
    $('openSettings').classList.toggle('warn', !settings.hasKey);
  }
  ['d1', 'd1b', 'd2', 'dFree', 'target', 'activity', 'detail'].forEach(function (id) {
    $(id).addEventListener('input', refresh);
  });

  function collectForm() {
    return {
      dateText: dateText(),
      target: $('target').value.trim(),
      activity: $('activity').value.trim(),
      detail: $('detail').value.trim(),
      scale: $('scale').value.trim(),
      partner: $('partner').value.trim(),
      effect: $('effect').value.trim(),
      voiceMode: state.voiceMode,
      voice: $('voice').value.trim(),
      quote2: $('quote2').value.trim(),
      tone: state.tone,
      tense: state.tense,
      paras: state.paras,
      mark: state.mark,
      subhead: $('subhead').checked,
      iem: $('iem').checked,
      signer: $('signer').value.trim()
    };
  }

  /* ───── 글 만들기 ───── */
  var timer = null, startedAt = 0;
  function tick() {
    var s = Math.round((Date.now() - startedAt) / 1000);
    $('go').textContent = '쓰는 중… ' + s + '초';
  }
  function setBusy(busy) {
    if (busy) {
      startedAt = Date.now();
      $('go').disabled = true;
      $('again').disabled = true;
      tick();
      timer = setInterval(tick, 1000);
    } else {
      clearInterval(timer); timer = null;
      $('go').textContent = '홍보글 만들기';
      $('again').disabled = false;
      refresh();
    }
  }
  function showError(msg) {
    $('err').textContent = msg;
    $('err').classList.remove('hide');
  }
  function fmtNum(n) { return (n || 0).toLocaleString('ko-KR'); }
  function modelLabel(id) {
    var m = (settings.models || []).filter(function (x) { return x.id === id; })[0];
    return m ? m.label.split(' — ')[0] : id;
  }
  function autosize() {
    var b = $('outBody');
    b.style.height = 'auto';
    b.style.height = (b.scrollHeight + 20) + 'px';
  }
  function showResult(r) {
    $('empty').classList.add('hide');
    $('result').classList.remove('hide');
    $('bar').classList.remove('hide');
    $('factNote').classList.remove('hide');
    $('outTitle').textContent = r.title;
    $('outBody').value = r.body;
    autosize();
    if (r.usage) {
      var u = r.usage;
      $('usageNote').textContent = '이번 글 사용량: 입력 ' + fmtNum(u.inputTokens) + ' 토큰'
        + (u.cacheReadTokens ? ' (그중 ' + fmtNum(u.cacheReadTokens) + '은 캐시에서 싸게)' : '')
        + ' · 출력 ' + fmtNum(u.outputTokens) + ' 토큰 · 약 $' + u.usd.toFixed(3)
        + ' · ' + modelLabel(u.model) + ' · 파일 > 만든 글 보관함에 저장됨';
      $('usageNote').classList.remove('hide');
    }
    if (r.truncated) showError('글이 길어 끝이 잘렸을 수 있습니다. 문단 수를 줄이거나 다시 써 보세요.');
  }
  function generate() {
    if (!settings.hasKey) { openSettings('홍보글을 만들려면 먼저 Anthropic API 키를 넣어 주세요.'); return; }
    $('err').classList.add('hide');
    setBusy(true);
    window.halla.generate(collectForm())
      .then(function (r) {
        if (!r || !r.ok) {
          showError((r && r.error) || '글을 만들지 못했습니다. 잠시 후 다시 눌러 주세요.');
          if (r && r.needKey) { settings.hasKey = false; openSettings(r.error); }
          return;
        }
        showResult(r);
      })
      .catch(function (e) { showError(e && e.message ? e.message : String(e)); })
      .finally(function () { setBusy(false); });
  }
  $('go').onclick = generate;
  $('again').onclick = generate;

  /* ───── 복사 ───── */
  $('bar').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-c]'); if (!b) return;
    var what = b.getAttribute('data-c');
    var t = $('outTitle').textContent, y = $('outBody').value;
    var text = what === 'title' ? t : what === 'body' ? y : t + '\n\n' + y;
    var old = b.textContent;
    window.halla.copyText(text).then(function () {
      b.textContent = '복사했습니다';
      setTimeout(function () { b.textContent = old; }, 1600);
    });
  });

  /* ───── 설정 ───── */
  function renderSettings() {
    var sel = $('model');
    sel.innerHTML = '';
    (settings.models || []).forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.id; o.textContent = m.label;
      sel.appendChild(o);
    });
    sel.value = settings.model || settings.defaultModel;

    $('keyStatus').textContent = settings.keyFromEnv
      ? '환경 변수 ANTHROPIC_API_KEY의 키를 쓰고 있습니다.'
      : settings.hasKey
        ? '저장된 키: ' + settings.keyHint + (settings.encrypted
          ? ' (운영체제 보안 저장소로 암호화됨)'
          : ' (이 컴퓨터에서는 암호화 저장을 쓸 수 없어 평문으로 저장됨)')
        : '저장된 키가 없습니다.';
    $('clearKey').classList.toggle('hide', !settings.hasKey || !!settings.keyFromEnv);

    var custom = [settings.customRules && '규칙', settings.customExamples && '예시'].filter(Boolean);
    $('promptStatus').textContent = custom.length
      ? '직접 고친 ' + custom.join('·') + ' 파일을 쓰고 있습니다. (도움말 메뉴에서 편집하거나 되돌릴 수 있습니다)'
      : '앱에 내장된 기본 규칙·예시를 쓰고 있습니다. 도움말 › 홍보글 예시 편집… 에서 바꿀 수 있습니다.';
  }
  function applySettings(s) {
    settings = s || settings;
    renderSettings();
    refresh();
  }
  function showSettingsErr(msg) {
    $('settingsErr').textContent = msg;
    $('settingsErr').classList.remove('hide');
  }
  function openSettings(msg) {
    var dlg = $('settingsDlg');
    $('settingsIntro').textContent = msg || DEFAULT_INTRO;
    $('apiKey').value = '';
    $('apiKey').type = 'password';
    $('toggleKey').textContent = '보기';
    $('settingsErr').classList.add('hide');
    renderSettings();
    if (!dlg.open) dlg.showModal();
    setTimeout(function () { $('apiKey').focus(); }, 50);
  }
  function saveSettings() {
    var key = $('apiKey').value.trim();
    if (!key && !settings.hasKey) { showSettingsErr('API 키를 넣어 주세요.'); return; }
    if (key && key.indexOf('sk-ant-') !== 0) {
      showSettingsErr('키는 보통 sk-ant- 로 시작합니다. 콘솔에서 복사한 키가 맞는지 확인해 주세요. (그래도 저장했습니다)');
    }
    window.halla.saveSettings({ apiKey: key, model: $('model').value })
      .then(function (s) {
        applySettings(s);
        if (key && key.indexOf('sk-ant-') !== 0) return; // 경고를 읽을 수 있게 창을 열어 둡니다.
        $('settingsDlg').close();
      })
      .catch(function (e) { showSettingsErr('저장하지 못했습니다: ' + (e && e.message ? e.message : e)); });
  }
  $('openSettings').onclick = function () { openSettings(); };
  $('saveSettings').onclick = saveSettings;
  $('settingsForm').addEventListener('submit', function (e) { e.preventDefault(); saveSettings(); });
  $('closeSettings').onclick = function () { $('settingsDlg').close(); };
  $('toggleKey').onclick = function () {
    var i = $('apiKey');
    i.type = i.type === 'password' ? 'text' : 'password';
    this.textContent = i.type === 'password' ? '보기' : '숨기기';
  };
  $('clearKey').onclick = function () {
    if (!window.confirm('저장된 API 키를 지울까요? 다시 쓰려면 키를 새로 넣어야 합니다.')) return;
    window.halla.clearApiKey().then(applySettings);
  };
  Array.prototype.forEach.call(document.querySelectorAll('a.ext'), function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); window.halla.openExternal(a.href); });
  });
  window.halla.onOpenSettings(function () { openSettings(); });

  /* ───── 시작 ───── */
  refresh();
  window.halla.getSettings().then(function (s) {
    applySettings(s);
    if (!s.hasKey) openSettings('처음 쓰시는군요. Anthropic API 키를 넣으면 바로 쓸 수 있습니다. 키는 이 컴퓨터에만 저장됩니다.');
  });
})();

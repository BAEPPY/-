# 끝말잇기 (우리말샘 Open API)

끄투 온라인 스타일의 끝말잇기 웹 게임입니다. 단어 검증은 국립국어원 **우리말샘 Open API**로 하고, 외부 패키지 없이 Node.js 내장 모듈만 사용합니다.

## 규칙

| 규칙 | 판정 기준 (우리말샘 응답 필드) |
|---|---|
| 명사만 허용 | `pos === "명사"` (의존 명사·대명사·수사 제외) |
| 표준어만 허용 | 범주(`type`)가 `방언`·`옛말`이면 불허, 뜻풀이가 `→ 다른말.` 또는 `'X'의 잘못` 꼴이면 불허 |
| 북한어 불허 | `type === "북한어"` |
| 외국어(외래어) 불허 | 원어 유형 `word_type === "외래어"` (`ALLOW_LOANWORDS=1` 로 허용 가능) |
| 합성어 불허 | 표제어(`word`)에 형태소 경계 `-` 또는 띄어쓰기 `^` 가 있거나 `word_unit !== "단어"` (`ALLOW_COMPOUND=1` 로 허용 가능) |
| 고유 명사 불허 | 전문 분야(`cat`)가 `인명`·`지명`·`책명`·`고유명 일반` |
| 길이 2 이상 | 글자 수 |
| 끝말 잇기 | 앞 단어 마지막 글자로 시작. 두음법칙 허용 (`ALLOW_DUEUM=0` 으로 끌 수 있음) |
| 중복 불허 | 한 라운드 안에서 같은 단어 재사용 금지 |

동형어(같은 표기, 다른 뜻)가 여러 개면 **하나라도** 규칙을 통과하면 허용합니다.

## 실행

```bash
cp .env.example .env      # OPENDICT_API_KEY 에 우리말샘 인증키 입력
npm start                 # http://localhost:3000
```

인증키가 없거나 `MOCK_DICT=1` 이면 `test/fixtures/mock-dict.json` 의 작은 모의 사전으로 동작합니다 (오프라인 개발용, 상단에 MOCK 배지가 표시됨).

```bash
npm run dev               # 모의 사전 + DEBUG 모드
npm test                  # 규칙·두음법칙·컴퓨터 로직 단위 테스트
```

## 구조

```
server.js            HTTP 서버: 정적 파일 + /api/* (우리말샘 프록시, 키는 서버에만 둠)
lib/rules.js         규칙 판정 (evaluateWord / passingEntries)
lib/hangul.js        두음법칙, 음절 분해, 조사 선택 (브라우저에서도 /shared/hangul.js 로 사용)
lib/opendict.js      우리말샘 API 클라이언트 (LRU 캐시) + 모의 사전 클라이언트
lib/bot.js           컴퓨터 상대의 단어 선택 (method=start 검색 후 규칙 필터)
lib/config.js        .env 로더
public/              게임 UI (index.html, style.css, app.js)
test/                node:test 기반 테스트, 모의 사전 픽스처
```

### API

| 경로 | 설명 |
|---|---|
| `GET /api/validate?word=사과&starts=사,나&used=가방,방석` | 단어 판정. `{ok, reason, message, entry, nextStarts}` |
| `GET /api/bot?starts=과&used=...&level=easy|normal|hard` | 컴퓨터가 이어갈 단어 하나 |
| `GET /api/config` | 서버 규칙 설정 |
| `GET /api/raw?word=사과&method=exact` | 우리말샘 원본 응답 (`DEBUG=1` 일 때만) |

### 우리말샘 응답 필드 확인

우리말샘 응답의 필드 이름(`pos`, `type`, `cat`, `word_type`, `word_unit`)이 문서와 다르게 오는 경우가 있으면 `DEBUG=1` 로 서버를 띄운 뒤
`/api/raw?word=사과` 로 실제 응답을 확인하고 `lib/rules.js` 의 `normalizeItem()` 만 손보면 됩니다.
품사·범주 등이 항목(item) 쪽에 있든 뜻풀이(sense) 쪽에 있든 모두 읽도록 되어 있습니다.

서버 쪽 검색에 파라미터를 더 붙이고 싶으면 `.env` 의 `OPENDICT_EXTRA_PARAMS` (예: `type1=word&pos=1`) 를 사용하세요.

## 게임 방식

- **컴퓨터와 대전** 또는 **친구와 번갈아** (한 화면에서 교대) 모드
- 턴 제한 시간 10~60초, 라운드 1·3·5회. 시간 안에 잇지 못하면 그 라운드 패배
- 점수 = 글자 수 × 10 + 남은 시간(초) 보너스
- 각 단어의 뜻풀이와 원어를 기록에 표시

뜻풀이 출처: [국립국어원 우리말샘](https://opendict.korean.go.kr/) (CC BY-SA 2.0 KR)

# 끝말잇기 (우리말샘 Open API)

끄투 온라인 스타일의 끝말잇기 웹 게임입니다. 단어 검증은 국립국어원 **우리말샘 Open API**로 하고, 외부 패키지 없이 Node.js 내장 모듈만 사용합니다.

## 규칙

판정 기준은 우리말샘 검색 API의 **실제 응답 필드**(아래 "우리말샘 응답 필드 확인" 참고)를 기준으로 합니다.

| 규칙 | 판정 기준 (우리말샘 응답 필드) |
|---|---|
| 명사만 허용 | `sense.pos === "명사"` 또는 `관·명`처럼 명사를 포함한 조합 품사. `의존 명사`·`대명사`·`수사`·`""`(구·어근) 은 불허 |
| 표준어만 허용 | `sense.type` 이 `방언`·`옛말`이면 불허. `일반어`라도 뜻풀이가 `… ⇒규범 표기는 ‘설거지’이다.`, `‘X’의 잘못`, `→ X.` 꼴이면 불허 (대응 표준어를 힌트로 알려 줌) |
| 북한어 불허 | `sense.type === "북한어"` |
| 외국어(외래어) 불허 | 원어 `sense.origin` 에 로마자·가나·그리스·키릴 문자가 있으면 외래어 (`computer`, `←apartment`, `▼hand phone`, `金medal`). 한자만 있거나(沙果) 없으면(고유어) 허용. `ALLOW_LOANWORDS=1` 로 허용 가능 |
| 합성어·파생어·구 불허 | 표제어(`word`)에 형태소 경계 `-`(사과-나무, 가난-뱅이) 또는 띄어쓰기 `^`(가정^법원) 가 있으면 불허 (`ALLOW_COMPOUND=1` 로 `-` 는 허용 가능. `^` 구는 품사가 없어 계속 불허) |
| 고유 명사 불허 | 전문 분야 `sense.cat` 이 `인명`·`지명`·`책명`·`고유명 일반`. 또는 `미술`·`음악`·`영상`·`문학` 분야이면서 뜻풀이가 "…가 그린 그림.", "…작사·작곡의 대중가요.", "…감독이 만든 영화." 처럼 작품명인 항목 |
| 길이 2 이상 | 글자 수 |
| 끝말 잇기 | 앞 단어 마지막 글자로 시작. 두음법칙 허용 (`ALLOW_DUEUM=0` 으로 끌 수 있음) |
| 중복 불허 | 한 라운드 안에서 같은 단어 재사용 금지 |

동형어(같은 표기, 다른 뜻)가 여러 개면 **하나라도** 규칙을 통과하면 허용합니다. 예를 들어 `서울`은 지명 항목 외에 "한 나라의 중앙 정부가 있는 곳"이라는 일반 명사 항목이 있어 허용되고, `한강`은 지명·소설·영화·노래 항목뿐이라 불허됩니다.

불허 사유가 여럿이면 해당하는 뜻풀이가 가장 많은 사유를 알려 주고, 방언·북한어·옛말·비표준어는 대응 표준어를 함께 보여 줍니다. (예: `정구지` → "방언은 사용할 수 없어요. (표준어: 부추)")

## 실행

```bash
cp .env.example .env      # OPENDICT_API_KEY 에 우리말샘 인증키 입력
npm start                 # http://localhost:3000
```

인증키가 없거나 `MOCK_DICT=1` 이면 `test/fixtures/mock-dict.json` 의 작은 모의 사전으로 동작합니다 (오프라인 개발용, 상단에 MOCK 배지가 표시됨).

```bash
npm run dev               # 모의 사전 + DEBUG 모드
npm test                  # 규칙·두음법칙·컴퓨터 로직 단위 테스트 + 우리말샘 실제 응답 기반 판정 테스트
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
test/                node:test 기반 테스트, 모의 사전 픽스처(mock-dict.json), 우리말샘 실제 응답 표본(opendict-samples.json)
```

### API

| 경로 | 설명 |
|---|---|
| `GET /api/validate?word=사과&starts=사,나&used=가방,방석` | 단어 판정. `{ok, reason, message, hint?, entry, nextStarts}` |
| `GET /api/bot?starts=과&used=...&level=easy|normal|hard` | 컴퓨터가 이어갈 단어 하나 |
| `GET /api/config` | 서버 규칙 설정 |
| `GET /api/raw?word=사과&method=exact` | 우리말샘 원본 응답 (`DEBUG=1` 일 때만) |

### 우리말샘 응답 필드 확인

2026-09-08 에 실제 인증키로 `https://opendict.korean.go.kr/api/search?req_type=json&advanced=y&method=exact&num=100&q=…` 를 호출해 확인한 내용입니다.
(`test/fixtures/opendict-samples.json` 에 65개 단어의 원본 응답을 모아 두었고 `test/real-response.test.js` 가 이를 기준으로 규칙 판정을 검증합니다.)

```jsonc
{ "channel": { "total": 11, "start": 1, "num": 11, "item": [
  { "word": "사과",          // 표제어. '-' 는 형태소 경계(사과-나무), '^' 는 띄어쓰기(가정^법원)
    "sense": [ {            // 항상 원소 1개짜리 배열. 동형어마다 item 이 따로 온다
      "target_code": "184908", "sense_no": "006",
      "definition": "사과나무의 열매.",
      "pos": "명사",         // "의존 명사" "대명사" "수사" "동사" … 조합 품사는 "수·관" "관·명" 처럼 축약. 구·어근은 ""
      "type": "일반어",      // "일반어" | "방언" | "북한어" | "옛말"
      "cat": "식물",         // 전문 분야 (없으면 필드 자체가 없음). 고유 명사는 "인명" "지명" "책명" "고유명 일반"
      "origin": "沙果/砂果", // 원어 (없으면 필드 없음). 외래어는 "computer" "←apartment" "▼hand phone" "金medal"
      "link": "https://opendict.korean.go.kr/dictionary/view?sense_no=184908"
    } ] } ] } }
```

- 문서에 있는 `word_unit`(구성 단위)·`word_type`(고유어 여부)는 **검색 응답에 없습니다.** 어휘 조회 API(`/api/view`)에도 대부분 비어 오므로 쓰지 않고, 합성어는 표제어의 `-`/`^`, 외래어는 `origin` 의 문자 종류로 판정합니다.
- 비표준어는 `type` 이 `일반어`이면서 뜻풀이 끝에 `⇒규범 표기는 ‘설거지’이다.` 가 붙어 옵니다. 방언·북한어·옛말은 `‘부추’의 방언`, `‘역사’의 북한어.`, `‘천’의 옛말.` 꼴입니다.
- 결과가 없으면 `channel.item` 이 아예 없습니다. 뜻풀이에는 `&lt;FL&gt;…&lt;/FL&gt;` 같은 HTML 이스케이프된 태그가 섞여 있어 표시 전에 걷어냅니다.
- **오류 응답은 `req_type=json` 이어도 XML** 로 옵니다: `<error><error_code>020</error_code><message>Unregistered key</message></error>` (020 등록되지 않은 키, 103 num 범위 오류 등). 서버가 이를 해석해 `/api/*` 에 `{ ok:false, error, code }` 로 돌려줍니다.
- `num` 은 10~100 만 허용되고 `start` 는 페이지 번호입니다. `advanced=y` 이면 `type1=word`(단어만)·`pos=1`(명사만)·`type3=general`(일반어만) 같은 서버 쪽 필터를 쓸 수 있어, 컴퓨터가 단어를 고를 때(`lib/bot.js`) 이 필터로 후보 밀도를 높입니다.

새 응답을 직접 보려면 `DEBUG=1` 로 서버를 띄운 뒤 `/api/raw?word=사과` 를 열면 됩니다. 필드가 바뀌면 `lib/rules.js` 의 `normalizeItem()` 만 손보면 됩니다.

서버 쪽 검색에 파라미터를 더 붙이고 싶으면 `.env` 의 `OPENDICT_EXTRA_PARAMS` (예: `sort=popular`) 를 사용하세요.

## 게임 방식

- **컴퓨터와 대전** 또는 **친구와 번갈아** (한 화면에서 교대) 모드
- 턴 제한 시간 10~60초, 라운드 1·3·5회. 시간 안에 잇지 못하면 그 라운드 패배
- 점수 = 글자 수 × 10 + 남은 시간(초) 보너스
- 각 단어의 뜻풀이와 원어를 기록에 표시

뜻풀이 출처: [국립국어원 우리말샘](https://opendict.korean.go.kr/) (CC BY-SA 2.0 KR)

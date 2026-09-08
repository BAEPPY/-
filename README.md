# 끝말잇기 (우리말샘 Open API)

끄투 온라인 스타일의 끝말잇기 웹 게임입니다. 단어 검증은 국립국어원 **우리말샘 Open API**로 하고, 외부 패키지 없이 Node.js 내장 모듈만 사용합니다.

## 규칙

우리말샘 **실제 API 응답으로 검증한**(2026-09, `npm run test:live`) 판정 기준입니다.

| 규칙 | 판정 방법 |
|---|---|
| 명사만 허용 | 검색 필터 `pos=1` + 응답 `sense.pos === "명사"` (의존 명사·대명사·수사·'수·관' 같은 겸용 품사 제외) |
| 단어만 허용 | 검색 필터 `type1=word` (구·관용구·속담 제외. 구는 `pos` 가 비고 표제어에 `^` 가 있음) |
| 표준어만 허용 | 검색 필터 `type3=general` + 응답 `sense.type` 이 `방언`·`옛말`이면 불허, 뜻풀이가 `→ 다른말.`, `⇒규범 표기는 ‘X’이다.`, `‘X’의 잘못` 꼴이면 불허 |
| 북한어 불허 | `sense.type === "북한어"` |
| 외래어 불허 | 검색 필터 `type2=native,chinese,hybrid` — **응답에 원어 유형(`word_type`)이 없어서** 서버 필터로만 걸러진다 (`ALLOW_LOANWORDS=1` 로 허용 가능) |
| 합성어 불허 | 표제어(`word`)에 형태소 경계 `-` 가 있음 (`ALLOW_COMPOUND=1` 로 허용 가능) |
| 고유 명사 불허 | 전문 분야(`sense.cat`)가 `인명`·`지명`·`책명`·`고유명 일반` |
| 길이 2 이상 | 글자 수 (컴퓨터 검색에는 `letter_s=2`) |
| 끝말 잇기 | 앞 단어 마지막 글자로 시작. 두음법칙 허용 (`ALLOW_DUEUM=0` 으로 끌 수 있음) |
| 중복 불허 | 한 라운드 안에서 같은 단어 재사용 금지 |

동형어(같은 표기, 다른 뜻)가 여러 개면 **하나라도** 규칙을 통과하면 허용합니다. 그래서 `서울`(지명이지만 "한 나라의 중앙 정부가 있는 곳"이라는 일반 명사 뜻이 있음), `나모`(옛말이지만 불교 용어 螺毛가 있음)는 허용되고,
`이순신`(인명뿐), `숫놈`(모든 뜻이 `⇒규범 표기는 ‘수놈’`)은 불허됩니다. 반대로 `자동차`·`물고기`·`금붕어` 같은 흔한 말도 우리말샘 표제어가 `자동-차`·`물-고기`·`금-붕어` 라서 기본 설정에서는 합성어로 불허됩니다. 너무 빡빡하면 `ALLOW_COMPOUND=1` 을 켜세요.

### 판정 순서 (`/api/validate`)

1. 규칙을 검색 필터로 붙여 조회 (`type1=word&pos=1&type3=general&type2=native,chinese,hybrid`) → 응답만으로 알 수 없는 것(합성어 `-`, 고유 명사 `cat`, 비표준 뜻풀이)을 `lib/rules.js` 로 다시 거른다. 통과하면 허용.
2. 실패했으면 필터 없이 한 번 더 조회해서 사유(북한어·방언·외래어 …)를 알아낸다. 여기서 규칙을 통과하는 항목이 나오면 응답에 없는 정보(원어 유형)로 서버가 걸러낸 것이므로 **외래어**로 판정한다.

## 실행

```bash
cp .env.example .env      # OPENDICT_API_KEY 에 우리말샘 인증키 입력
npm start                 # http://localhost:3000
```

인증키가 없거나 `MOCK_DICT=1` 이면 `test/fixtures/mock-dict.json` 의 작은 모의 사전으로 동작합니다 (오프라인 개발용, 상단에 MOCK 배지가 표시됨).

```bash
npm run dev               # 모의 사전 + DEBUG 모드
npm test                  # 규칙·두음법칙·컴퓨터 로직 단위 테스트 (오프라인, 실제 응답으로 만든 픽스처 사용)
npm run test:live         # 우리말샘 실제 API 로 규칙 검증 (.env 의 OPENDICT_API_KEY 필요, 없으면 건너뜀)
npm run check -- 사과 리본  # 단어 몇 개를 서버와 같은 방식으로 판정해 표로 출력 (MOCK_DICT=1 이면 모의 사전)
npm run fixture           # test/fixtures/mock-dict.json 을 실제 API 응답으로 다시 생성
```

## 구조

```
server.js            HTTP 서버: 정적 파일 + /api/* (우리말샘 프록시, 키는 서버에만 둠)
lib/rules.js         규칙 판정 (evaluateWord / passingEntries)
lib/hangul.js        두음법칙, 음절 분해, 조사 선택 (브라우저에서도 /shared/hangul.js 로 사용)
lib/opendict.js      우리말샘 API 클라이언트 (LRU 캐시, 검색 필터, XML 오류 응답 해석) + 모의 사전 클라이언트
lib/bot.js           컴퓨터 상대의 단어 선택 (규칙 필터를 붙인 method=start 검색 후 다시 거름)
lib/config.js        .env 로더
public/              게임 UI (index.html, style.css, app.js)
scripts/             build-fixture.mjs (실제 응답으로 픽스처 생성), check-words.mjs (단어 판정 확인)
test/                node:test 기반 테스트, 모의 사전 픽스처, live.test.js (실제 API 검증)
```

### API

| 경로 | 설명 |
|---|---|
| `GET /api/validate?word=사과&starts=사,나&used=가방,방석` | 단어 판정. `{ok, reason, message, entry, nextStarts}` |
| `GET /api/bot?starts=과&used=...&level=easy|normal|hard` | 컴퓨터가 이어갈 단어 하나 |
| `GET /api/config` | 서버 규칙 설정 |
| `GET /api/raw?word=사과&method=exact&strict=1` | 우리말샘 원본 응답 (`DEBUG=1` 일 때만). `strict=1` 이면 게임 규칙 필터를 붙여 조회 |

### 우리말샘 응답 필드 (실제 확인)

검색 API(`/api/search?advanced=y&req_type=json`)의 실제 응답은 다음 모양입니다. 문서와 달리 **항목(item)에는 `word` 뿐이고, 품사·범주·전문 분야·원어·대상 코드는 모두 뜻풀이(sense) 쪽에** 있으며, 항목 하나에 뜻풀이가 하나씩 옵니다.

```json
{ "channel": { "total": 11, "start": 1, "num": 11,
  "item": [ { "word": "사과",
              "sense": [ { "sense_no": "001", "target_code": "424473", "definition": "살이 연하고 달며 물이 많은 참외.",
                           "pos": "명사", "type": "일반어", "cat": "식물", "origin": "沙果", "link": "https://opendict.korean.go.kr/dictionary/view?sense_no=424473" } ] } ] } }
```

- `word_type`(고유어/한자어/외래어/혼종어)·`word_unit`·`sup_no` 는 검색 응답에 **없습니다**. 외래어는 검색 필터 `type2` 로만 구분할 수 있습니다.
- `type` 값은 `일반어`·`방언`·`북한어`·`옛말`. `type4` 필터는 '일상어/전문어' 구분이라 고유 명사 판정에는 쓸 수 없습니다 (고유 명사는 `cat` 으로).
- `num` 은 10~100, `start` 는 1~1000 만 허용됩니다. 벗어나면 103/104 오류.
- 오류는 `req_type=json` 이어도 **XML** 로 옵니다 (`<error><error_code>020</error_code><message>Unregistered key</message></error>`). `lib/opendict.js` 가 이를 해석해 `우리말샘 API 오류 020: 등록되지 않은 인증키…` 로 알려 줍니다.
- 뜻풀이에 `&lt;FL&gt;…&lt;/FL&gt;` 같은 마크업이 섞여 오는 경우가 있어 `cleanDefinition()` 으로 정리합니다.

필드가 바뀌면 `DEBUG=1` 로 서버를 띄운 뒤 `/api/raw?word=사과` 로 실제 응답을 확인하고 `lib/rules.js` 의 `normalizeItem()` 을 손보세요. 서버 쪽 검색에 파라미터를 더 붙이고 싶으면 `.env` 의 `OPENDICT_EXTRA_PARAMS` (예: `sort=popular`) 를 사용하세요.

## 게임 방식

- **컴퓨터와 대전** 또는 **친구와 번갈아** (한 화면에서 교대) 모드
- 턴 제한 시간 10~60초, 라운드 1·3·5회. 시간 안에 잇지 못하면 그 라운드 패배
- 점수 = 글자 수 × 10 + 남은 시간(초) 보너스
- 각 단어의 뜻풀이와 원어를 기록에 표시

뜻풀이 출처: [국립국어원 우리말샘](https://opendict.korean.go.kr/) (CC BY-SA 2.0 KR)

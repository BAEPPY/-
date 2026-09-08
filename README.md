# 끝말잇기 (우리말샘 Open API)

끄투 온라인 스타일의 끝말잇기 웹 게임입니다. 단어 검증은 국립국어원 **우리말샘 Open API**로 하고, 외부 패키지 없이 Node.js 내장 모듈만 사용합니다.

- **여러 모드**: 끝말잇기 · 쿵쿵따(세 글자) · 앞말잇기 · 훈민정음(두 초성) · 초성 퀴즈 · 영어 끝말잇기
- **단어 인정 범위 조절**: 방마다 방언·비표준어, 옛말, 북한어(문화어), 외래어, 합성어·파생어, 고유 명사 허용 여부와 두음법칙을 정할 수 있음
- **실시간 방**: 설치 없이 브라우저로 접속. 방을 만들고 링크나 방 코드로 친구를 초대. 같은 화면에서 번갈아 하거나 컴퓨터를 넣어 혼자 연습도 가능
- **방 설정**: 턴 제한 시간(5~120초), 라운드 수, 최대 인원, 초성 퀴즈 문제 수, 컴퓨터 난이도, 공개/비공개

## 게임 모드

| 모드 | 규칙 | 컴퓨터 |
|---|---|---|
| 🔗 끝말잇기 | 앞 단어의 마지막 글자로 시작 (두음법칙 허용 가능) | ○ |
| 🥁 쿵쿵따 | 끝말잇기 + 세 글자 단어만 (우리말샘 `letter_s=3&letter_e=3` 필터). 세 글자 단어는 대부분 합성어·파생어라 방을 만들 때 **합성어 허용**이 자동으로 켜짐 | ○ |
| 🔙 앞말잇기 | 앞 단어의 **첫** 글자로 **끝나는** 단어 (두음법칙은 역방향으로: 역 → 역·녁·력) | ○ (우리말샘 `method=end` 검색) |
| ㄱㅅ 훈민정음 | 제시된 두 초성으로 시작하는 단어를 돌아가며 (가수, 감사, 국수 …). 라운드 내내 같은 초성 | ○ |
| ❓ 초성 퀴즈 | 초성만 보고 단어 맞히기. 턴 없이 모두가 동시에 답하고 먼저 맞힌 사람이 점수. 초성이 같은 다른 사전 단어도 정답 | ○ |
| 🔤 영어 끝말잇기 | 마지막 글자로 시작하는 영어 단어 (3글자 이상). 단어 목록은 첫 실행 때 내려받음 (아래 참고) | ○ |

턴 방식 모드는 제한 시간 안에 못 잇거나 틀린 단어만 내면 그 라운드에서 지고, 나머지가 라운드 승을 가져갑니다. 초성 퀴즈는 라운드 점수가 가장 높은 사람이 승리합니다.

컴퓨터 상대는 우리말샘을 실시간으로 검색합니다. 우리말샘은 결과 수(`num`)에 비례해 느려져서(100건 ≈ 6초, 30건 ≈ 1.2초) 30건짜리 페이지 여러 장을 동시에 받아 1~3초 안에 후보를 고르고, 난이도에 따라 일부러 제한 시간의 8~75% 를 기다렸다가 답합니다. 초성 퀴즈의 다음 문제는 미리 만들어 둡니다.

## 단어 규칙

판정 기준은 우리말샘 검색 API의 **실제 응답 필드**(아래 "우리말샘 응답 필드 확인" 참고)를 기준으로 합니다. 아래 표의 "불허" 항목은 기본값이고, 방 설정에서 각각 허용으로 바꿀 수 있습니다.

| 규칙 | 판정 기준 (우리말샘 응답 필드) |
|---|---|
| 명사만 허용 | `sense.pos === "명사"` 또는 `관·명`처럼 명사를 포함한 조합 품사. `의존 명사`·`대명사`·`수사`·`""`(구·어근) 은 불허 |
| 방언·비표준어 불허 (`allowDialect`) | `sense.type === "방언"`. `일반어`라도 뜻풀이가 `… ⇒규범 표기는 ‘설거지’이다.`, `‘X’의 잘못`, `→ X.` 꼴이면 불허 (대응 표준어를 힌트로 알려 줌) |
| 옛말 불허 (`allowOld`) | `sense.type === "옛말"` |
| 북한어 불허 (`allowNorth`) | `sense.type === "북한어"` |
| 외국어(외래어) 불허 (`allowLoanwords`) | 원어 `sense.origin` 에 로마자·가나·그리스·키릴 문자가 있으면 외래어 (`computer`, `←apartment`, `▼hand phone`, `金medal`). 한자만 있거나(沙果) 없으면(고유어) 허용 |
| 합성어·파생어·구 불허 (`allowCompound`) | 표제어(`word`)에 형태소 경계 `-`(사과-나무, 가난-뱅이) 또는 띄어쓰기 `^`(가정^법원) 가 있으면 불허 (허용해도 `^` 구는 품사가 없어 계속 불허) |
| 고유 명사 불허 (`allowProper`) | 전문 분야 `sense.cat` 이 `인명`·`지명`·`책명`·`고유명 일반`. 또는 `미술`·`음악`·`영상`·`문학` 분야이면서 뜻풀이가 "…가 그린 그림.", "…작사·작곡의 대중가요.", "…감독이 만든 영화." 처럼 작품명인 항목 |
| 길이 2 이상 | 글자 수 |
| 끝말 잇기 | 앞 단어 마지막 글자로 시작. 두음법칙 허용 여부는 방 설정 (`ALLOW_DUEUM` 은 방 없이 쓰는 `/api/validate` 의 기본값) |
| 중복 불허 | 한 라운드 안에서 같은 단어 재사용 금지 |

동형어(같은 표기, 다른 뜻)가 여러 개면 **하나라도** 규칙을 통과하면 허용합니다. 예를 들어 `서울`은 지명 항목 외에 "한 나라의 중앙 정부가 있는 곳"이라는 일반 명사 항목이 있어 허용되고, `한강`은 지명·소설·영화·노래 항목뿐이라 불허됩니다.

불허 사유가 여럿이면 해당하는 뜻풀이가 가장 많은 사유를 알려 주고, 방언·북한어·옛말·비표준어는 대응 표준어를 함께 보여 줍니다. (예: `정구지` → "방언은 사용할 수 없어요. (표준어: 부추)")

## 실행

```bash
cp .env.example .env      # OPENDICT_API_KEY 에 우리말샘 인증키 입력
npm start                 # http://localhost:3000
```

인증키가 없거나 `MOCK_DICT=1` 이면 `test/fixtures/mock-dict.json` 의 작은 모의 사전으로 동작합니다 (오프라인 개발용, 상단에 MOCK 배지가 표시됨).

영어 끝말잇기는 한 줄에 한 단어인 목록 파일이 필요합니다. 기본으로 첫 실행 때 [dwyl/english-words](https://github.com/dwyl/english-words) 의 `words_alpha.txt`(약 37만 단어)를 내려받아 `data/english-words.txt` 에 저장하고, 실패하면 영어 모드만 비활성화됩니다. `.env` 의 `ENGLISH_WORDLIST`(파일 경로)·`ENGLISH_WORDLIST_URL`·`ENGLISH_DOWNLOAD=0` 으로 바꿀 수 있습니다.

```bash
npm run dev               # 모의 사전 + DEBUG 모드
npm test                  # 규칙·두음법칙·모드·방 엔진 단위 테스트 + 우리말샘 실제 응답 기반 판정 테스트
```

## 구조

```
server.js            HTTP 서버: 정적 파일 + /api/* (우리말샘 프록시, 방 API, SSE 실시간 이벤트). 키는 서버에만 둠
lib/room.js          게임 방·진행 엔진 (참가, 설정, 턴·타이머, 컴퓨터, 라운드/결과, SSE 구독자)
lib/modes.js         게임 모드 정의 (제시어 생성, 단어 검사, 다음 제시어, 컴퓨터 단어 선택)
lib/rules.js         우리말샘 항목 규칙 판정 (evaluateWord / passingEntries, 허용 옵션)
lib/hangul.js        두음법칙(정방향·역방향), 초성, 음절 분해, 조사 선택
lib/opendict.js      우리말샘 API 클라이언트 (LRU 캐시, 서버 필터) + 모의 사전 클라이언트
lib/bot.js           우리말샘에서 시작/끝 글자로 후보를 검색해 규칙을 통과하는 단어 고르기
lib/english.js       영어 단어 목록 사전
lib/config.js        .env 로더
public/              게임 UI (index.html, style.css, app.js) — 로비(방 만들기·목록) + 방(대기실·게임·결과·채팅)
test/                node:test 기반 테스트, 모의 사전 픽스처(mock-dict.json), 우리말샘 실제 응답 표본(opendict-samples.json)
```

### API

방 API 는 본문이 JSON 이고, 모든 요청에 브라우저가 만든 `clientId`(6~64자 영숫자) 가 들어갑니다. 게임 진행은 서버가 주관하고, 상태 변화는 SSE 로 내려갑니다.

| 경로 | 설명 |
|---|---|
| `GET /api/config` | 서버 설정: 기본 규칙, 규칙 옵션 목록, 모드 목록(영어 사전 준비 여부 포함), 제한값 |
| `GET /api/rooms` | 공개 방 목록 |
| `POST /api/rooms` `{clientId, name, roomName, mode, settings}` | 방 만들고 참가 (방장). `settings`: `turnSec, rounds, maxPlayers, quizCount, level, dueum, isPublic, rules{allow…}` |
| `POST /api/rooms/:id/join` `{clientId, name}` | 참가. 같은 `clientId` 로 여러 번 부르면 같은 화면 좌석이 늘어남 (최대 4) |
| `POST /api/rooms/:id/leave` `{clientId, playerId?}` | 나가기 / 좌석 빼기 (방장은 남도 내보낼 수 있음) |
| `POST /api/rooms/:id/bot` `{clientId, level}` | 컴퓨터 추가 (방장) |
| `POST /api/rooms/:id/settings` `{clientId, mode?, …settings}` | 설정 변경 (방장, 대기 중) |
| `POST /api/rooms/:id/start` / `next` | 시작 / 다음 라운드·결과·대기실로 (방장. 라운드 종료는 8초 뒤 자동 진행) |
| `POST /api/rooms/:id/word` `{clientId, playerId, word}` | 단어 제출. `{ok, entry}` 또는 `{ok:false, reason, message}` |
| `POST /api/rooms/:id/chat` `{clientId, text}` | 채팅 |
| `GET /api/rooms/:id/events?clientId=…` | SSE. 이벤트: `state`(방 전체 상태), `word`(인정된 단어), `reject`(내 단어 거절), `reveal`(초성 퀴즈 정답 공개), `chat`, `system` |
| `GET /api/validate?word=사과&starts=사,나&used=가방,방석` | (방 없이) 단어 판정. `{ok, reason, message, hint?, entry, nextStarts}` |
| `GET /api/bot?starts=과&used=...&level=easy|normal|hard` | (방 없이) 컴퓨터가 이어갈 단어 하나 |
| `GET /api/raw?word=사과&method=exact` | 우리말샘 원본 응답 (`DEBUG=1` 일 때만) |

`state` 의 `prompt` 는 모드에 따라 `{type:'starts', starts, lastWord}`, `{type:'ends', ends, lastWord}`, `{type:'hunmin', cho}`, `{type:'choseong', cho, length}`, `{type:'letter', starts, lastWord}` 중 하나이고, `deadline`/`serverNow` 로 남은 시간을 계산합니다.

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

- 로비에서 **방 만들기**(모드·시간·라운드·인원·인정 범위 선택) 또는 **컴퓨터와 바로 시작**
- 방에서 **초대 링크 복사**(`#room=코드`) 로 친구를 부르거나, 같은 화면에서 번갈아 할 플레이어·컴퓨터를 추가
- 라운드마다 선공이 바뀌고, 시간 안에 잇지 못하면 그 라운드 패배. 점수 = 글자 수 × 10 + 남은 시간(초) 보너스
- 각 단어의 뜻풀이·원어·우리말샘 링크를 기록에 표시. 방 안에서 채팅 가능
- 접속이 잠시 끊겨도(새로고침) 같은 브라우저면 자리가 유지되고, 사람이 모두 나간 방은 닫힘

뜻풀이 출처: [국립국어원 우리말샘](https://opendict.korean.go.kr/) (CC BY-SA 2.0 KR)

# Redesigned DJ — 전시용 단일 페이지

크롬(Chrome) macOS 스타일 **브라우저 창 UI**를 재현한 **전시·데모** 페이지입니다.  
창·탭을 드래그하는 제스처로 **Volume / Pitch / Tempo / Bass** 네 채널을 조절하고, 그 값이 **실제 배경 MP3**(Web Audio)에 반영됩니다.

> 이 README는 **처음 저장소를 여는 협업자**가 구조와 동작을 빠르게 파악하도록 쓴 것입니다.

---

## 목차

1. [기술 스택](#기술-스택)
2. [디렉터리 구조](#디렉터리-구조)
3. [로컬 실행·빌드](#로컬-실행빌드)
4. [페이지가 하는 일(주요 기능)](#페이지가-하는-일주요-기능)
5. [오디오 파이프라인](#오디오-파이프라인)
6. [`src/main.js` 논리 구조](#srcmainjs-논리-구조)
7. [HTML·CSS에서 알아둘 점](#htmlcss에서-알아둘-점)
8. [튜닝용 상수](#튜닝용-상수)
9. [제한·주의](#제한주의)

---

## 기술 스택

| 구분 | 사용 |
|------|------|
| 빌드·개발 서버 | [Vite](https://vitejs.dev/) 6.x |
| 모듈 | ES modules (`type: "module"`) |
| 오디오 | Web Audio API |
| 피치 시프트 | [rubberband-web](https://www.npmjs.com/package/rubberband-web) (AudioWorklet, **GPL-2.0-or-later** — 배포·전시 시 라이선스 확인) |
| 스타일 | 순수 CSS (`css/styles.css`) |
| 마크업 | 단일 `index.html` + 정적 에셋 |

`vite.config.js`에서 **`base: "./"`** 로 두어, `dist/`를 **하위 경로**에 올려도 상대 경로로 열리도록 했습니다.

---

## 디렉터리 구조

```
프로젝트 루트/
├── index.html              # 진입 HTML: 창 레이아웃, HUD, <audio>
├── src/
│   └── main.js             # 전부: UI 인터랙션 + Web Audio (단일 모듈)
├── css/
│   └── styles.css          # 크롬 룩앤필, 그리드, 탭·창, HUD, 숨김 오디오
├── public/
│   ├── audio/              # 배경 MP3 (Git에 포함되는 예시 트랙)
│   └── rubberband/         # ⚠️ postinstall으로 복사됨 — 기본적으로 Git에 없음 (.gitignore)
├── scripts/
│   └── copy-rubberband.mjs # node_modules/rubberband-web/public → public/rubberband
├── package.json
├── vite.config.js
└── dist/                   # npm run build 산출물 (보통 Git 제외)
```

- **`public/rubberband/`**  
  `npm install` 시 `postinstall`이 `scripts/copy-rubberband.mjs`를 실행해 **`node_modules/rubberband-web/public`** 내용을 복사합니다.  
  협업자는 **반드시 `npm install` 후** 개발·빌드해야 워클릿 경로가 살아 있습니다.

---

## 로컬 실행·빌드

### 요구 사항

- **Node.js** LTS 권장 (예: 20.x)

### 설치

```bash
npm install
```

### 개발 서버

```bash
npm run dev
```

터미널에 나온 URL로 접속하세요.

**`index.html`만 더블클릭(`file://`)으로 열지 마세요.**  
모듈 스크립트·절대 경로 리소스가 깨지거나, 로컬 파일 정책으로 오디오·워클릿이 동작하지 않을 수 있습니다.

### 프로덕션 빌드·미리보기

```bash
npm run build
npm run preview
```

배포 시 **`dist/` 폴더 전체**를 정적 호스팅에 올리면 됩니다. (`audio/`, `rubberband/` 포함)

---

## 페이지가 하는 일(주요 기능)

### 1) 전시용 크롬 창 UI

- **`browser-stage`**: 그리드(기본 2×2) 위에 **여러 `chrome-window`** 배치.
- 각 창: 트래픽 라이트, **탭 스트립**, 툴바(뒤로·앞으로·새로고침, 옴니박스, 공유·프로필·메뉴), 빈 콘텐츠 영역.
- **실제 네비게이션·탭 닫기로 페이지 이동** 등은 구현하지 않음 — **시각·인터랙션 데모**입니다.

### 2) 창 선택(포커스)

- 무대 **빈 배경** 클릭 → 첫 번째 창 선택.
- **`chrome-tabstrip--drag-handle`** 안을 누른 창 → 해당 창이 `chrome-window--selected`.

### 3) 탭 좌클릭 드래그 — 두 가지 모드

임계값(`DRAG_THRESHOLD_PX`, 6px) 이상 움직인 뒤, **처음 의미 있는 방향**으로 갈림.

#### A. 가로 스크럽 = 해당 탭 채널만 “올리기”

- 탭 제목이 **Volume / Pitch / Tempo / Bass** 중 하나일 때만 채널로 인식.
- **가로 이동이 세로보다 `TAB_SCRUB_HORIZONTAL_LEAD_PX`(10px) 이상 더 커야** 스크럽으로 인정  
  (모든 탭이 DJ 채널명이라, 조금만 가로로 움직여도 예전엔 스크럽으로 오인되어 **탭 뜯기가 막히는** 문제가 있었음).
- 스크럽 중: 좌우 방향과 관계없이 **이동한 픽셀**에 비례해 해당 채널 `djState`만 **0~100% 범위에서 증가(상승만)**.

#### B. 그 외(세로 우선 등) = 탭 뜯기

- 탭을 **떼어** `body`에 고정 위치로 드래그.
- 다른 창의 **탭 스트립** 위에 놓으면 **삽입 위치 표시** 후 드롭 시 그 스트립에 합류.
- 스트립 **밖**에 놓으면 **새 떠 있는 창**(`chrome-window--floated`)을 만들고 그 탭만 넣음.
- 원래 창에 탭이 0개가 되면 **창 제거**.
- 드롭·병합 시 삽입 X는 **`clampClientXIntoStrip`**으로 스트립 안으로 잡아 **탭 순서가 이상하게 튀는** 현상을 줄임.

### 4) 창 제목줄 드래그

- **좌클릭**: 창 이동(떠 있으면 `left/top`, 아니면 `transform`).  
  활성 탭 제목이 DJ 채널이면 **창 중심 이동 거리**에 비례해 그 채널 값 **증가**.
- **우클릭**: 같은 방식으로 값 **감소** (제목줄에서 컨텍스트 메뉴 `preventDefault`).
- 민감도: **`DJ_WIN_PX_PER_PERCENT`** (12) — 창 중심이 이 픽셀만큼 움직일 때 대략 1% 변화에 가깝게 잡힌 스케일.

### 5) 창끼리 탭 합치기(드래그 종료 시)

- 다른 창의 탭 스트립과 **겹침**이 충분할 때만 병합.
- 조건: 두 창의 **탭스트립 DOM `getBoundingClientRect()`** 교차 면적 ÷ **둘 중 작은 스트립 면적** ≥ **`MERGE_TABSTRIP_OVERLAP_MIN`(0.8)**  
  → 사용자 요청에 맞춰 **대략 80% 겹침** 이상일 때만 합쳐지게 함 (예전엔 포인터가 스트립 안만 들어가도 합쳐지는 등 과민했음).
- 병합 시 **`mergeAllTabs`**: 소스 스트립의 탭들을 **`DocumentFragment`**에 모아 **한 번에** 타겟 스트립에 삽입해 순서·레이아웃 튐을 완화.

### 6) DJ 상태·HUD

- **`djState`**: `{ Volume, Pitch, Tempo, Bass }` 각 0~100, 초기 50(중립).
- **`#dj-param-hud`**: 채널명과 반올림 `%` 표시.
- 드래그 중 HUD는 **`scheduleDjHudDom`**으로 **프레임당 한 번** DOM 갱신(메인 스레드 부하 완화).  
  포인터 업 시 **`flushDjHudDom`**으로 예약 취소 후 즉시 반영 + 오디오 스냅.

### 7) 배경 음악

- **`#exhibition-audio`**: `index.html`에 지정된 MP3, `loop`, `playsinline`.
- **실제 소리**는 `djState`와 연동 (아래 [오디오 파이프라인](#오디오-파이프라인)).
- 경로에 공백이 있어도 되도록 **`encodePathSegmentsPreservingSlashes`**로 `src` 정리.
- 자동재생 제한: 첫 **`pointerdown` / `keydown`**에서 `AudioContext.resume()` 및 `play()` 재시도.

### 8) 부트 오류 표시

- **`boot()`**에서 초기화 예외 시 화면 하단에 **`pre`**로 스택을 띄움.

---

## 오디오 파이프라인

### 그래프(요약)

```
<audio> ── MediaElementSource ──► [ Rubber Band 노드: 피치만, 템포는 1.0 고정 ]
                                        │
                                        ▼
                              BiquadFilter (lowshelf = Bass)
                                        │
                                        ▼
                              GainNode (마스터 = Volume)
                                        │
                                        ▼
                              destination (스피커)
```

- **템포(Tempo)**  
  Rubber Band `setTempo`는 **쓰지 않음** (실시간 변경 시 잡음이 컸음).  
  대신 **`<audio>.playbackRate`** + **`preservesPitch`**(가능하면 `webkitPreservesPitch`)로 **속도만** 조절.

- **피치(Pitch)**  
  Rubber Band **`setPitch`(비율)**.  
  급격한 `setPitch` 호출이 워클릿을 불안정하게 해 **끊김·무음**이 나와, **전용 서보 루프**(`pitchServoTick`)로 목표까지 **프레임당 `RB_PITCH_MAX_STEP_RATIO` 이하**만 이동.  
  손 뗌·그래프 준비 직후는 **`applyRubberBandPitchImmediate`**로 서보 중단 후 목표로 즉시 스냅.

- **볼륨·베이스**  
  값이 실제로 바뀔 때만 `GainNode` / lowshelf **gain**에 써서 불필요한 그래프 갱신 감소.

- **Rubber Band 실패 시**  
  소스 → lowshelf 직결(피치 워클릿 없음), 템포만 `playbackRate`.

### 워클릿 URL

런타임에 다음과 같이 로드합니다.

`new URL("rubberband/rubberband-processor.js", window.location.href).href`

빌드 후에는 `dist/rubberband/`에 같이 복사되어야 합니다.

### 드래그 중 오디오 갱신 방식

- 탭 스크럽·창 드래그로 `djState`가 바뀔 때: **`syncExhibitionAudioFromDjState({ deferToFrame: true })`**  
  → **`exhibitionAudioGraphRaf`**로 **게인·베이스·playbackRate**를 **프레임당 최대 1회** 적용.  
- 피치는 위 **서보**가 별도 `requestAnimationFrame`으로 따라감.

---

## `src/main.js` 논리 구조

**단일 파일**에 UI와 오디오가 모두 있습니다. 아래는 **역할별 그룹**입니다.

| 구역 | 대표 식별자 | 설명 |
|------|-------------|------|
| 상수·전역 상태 | `DJ_CHANNELS`, `djState`, `POINTER_WIN_OPTS`, `exhibition*` 변수들 | 채널 목록, 믹스 상태, 오디오 그래프 핸들, rAF id |
| 창·탭 DOM 헬퍼 | `getTabs`, `findInsertBefore`, `setOnlyActiveTab`, `stripUnderPoint`, … | 탭 순서, 드롭 표시, 스트립 탐색 |
| 병합·창 생성 | `mergeAllTabs`, `shouldMergeWindowToStrip`, `rectsOverlapRatio`, `createWindowWithTab` | 창 합치기, 새 창에 탭 1개만 넣기 |
| 탭 드래그 | `beginTabTear` | 스크럽 vs 뜯기 분기, `pointermove`/`up` |
| 창 드래그 | `beginWindowDrag` | 이동 + DJ 증감 + 병합 검사 |
| DJ 키 매핑 | `getDjChannelKeyFromTab`, `getDjChannelKeyForWindow` | 탭 제목 ↔ 채널명 |
| HUD | `updateDjHudDom`, `scheduleDjHudDom`, `flushDjHudDom`, `renderDjHud` | HUD 문자열 |
| 피치·템포 매핑 | `djPctToPitchRatio`, `djPctToTempoRatio`, `clampSafeRatio` | % → 비율 |
| Rubber Band 피치 | `cancelPitchServo`, `applyRubberBandPitchImmediate`, `requestPitchServoFrame`, `pitchServoTick` | 서보·즉시 스냅 |
| 템포·그래프 동기화 | `applyExhibitionTempoPlayback`, `scheduleDeferredExhibitionAudioSync`, `runExhibitionAudioGraphSync`, `syncExhibitionAudioFromDjState` | defer / 즉시, 스냅 옵션 |
| 그래프 초기화 | `initExhibitionWebAudioGraph`, `initExhibitionAudio` | `AudioContext`, MES, RB, 필터, 게인, `play` 언락 |
| 스테이지 바인딩 | `attachStage` | `pointerdown` / `contextmenu`에서 탭·창 드래그 시작 분기 |
| 유틸 | `encodePathSegmentsPreservingSlashes`, `clamp`, `parseTranslate`, … | |
| 부트 | `init`, `boot`, `DOMContentLoaded` | 스테이지 연결 → HUD → 오디오 |

---

## HTML·CSS에서 알아둘 점

### `index.html`

- 각 창의 **활성 탭 제목**이 Volume / Pitch / Tempo / Bass로 **다르게** 잡혀 있으면, “이 창을 움직이면 볼륨 / 저 창은 피치 …”처럼 느껴집니다.  
  **탭 제목 문자열**은 `DJ_CHANNELS`·`getDjChannelKeyFromTab`과 **반드시 일치**해야 합니다.
- **`chrome-tabstrip--drag-handle`**: 창 드래그와 탭 드래그가 이 영역에서 시작됩니다.
- **`#dj-param-hud`**: HUD 컨테이너.
- **`#exhibition-audio`**: 배경 트랙. `src`는 전시용 예시 MP3 경로.

### `css/styles.css`

- Chrome Refresh / Material You 느낌의 **헤더·탭·옴니박스** 스타일.
- **`body.chrome-ui--window-dragging`**, **`body.chrome-ui--tab-tearing`**: 드래그 중 `cursor`, `touch-action`, `user-select`.
- **`.exhibition-audio`**: 화면에 거의 안 보이게 작게·투명하게 (레이아웃 영향 최소).

---

## 튜닝용 상수 (`src/main.js` 상단 근처)

| 이름 | 역할 |
|------|------|
| `DRAG_THRESHOLD_PX` | 드래그로 인정하기 전 최소 이동 (px) |
| `TAB_SCRUB_HORIZONTAL_LEAD_PX` | 스크럽으로 인정하려면 가로가 세로보다 이 px 이상 더 커야 함 |
| `MERGE_TABSTRIP_OVERLAP_MIN` | 창 병합: 두 탭스트립 면적 겹침 비율 하한 (0~1) |
| `DJ_WIN_PX_PER_PERCENT` | 창 중심 이동 대비 DJ % 민감도 |
| `DJ_PITCH_OCT_RANGE` | 피치 % → 옥타브 스케일 (± 범위의 절반) |
| `DJ_TEMPO_OCT_RANGE` | 템포 % → 옥타브 스케일 |
| `DJ_RB_RATIO_MIN` / `DJ_RB_RATIO_MAX` | 피치·템포 비율 클램프 |
| `RB_PITCH_MAX_STEP_RATIO` | 피치 서보: 한 프레임에 바꿀 수 있는 비율 상한 |
| `DJ_TEMPO_PLAYBACK_SMOOTH` | `playbackRate` 목표 추종 스무딩 |

---

## 제한·주의

1. **`createMediaElementSource`는 `<audio>`당 한 번**  
   그래프를 부숴고 같은 엘리먼트로 다시 만들기 어렵습니다. 워클릿이 죽으면 **페이지 새로고침**이 가장 단순한 복구입니다.

2. **`public/rubberband/`는 Git에 없을 수 있음**  
   새 클론 후 **`npm install` 필수**.

3. **GPL**  
   `rubberband-web` 라이선스를 배포·전시 맥락에 맞게 확인하세요.

4. **브라우저**  
   AudioWorklet·`preservesPitch` 지원은 브라우저마다 다릅니다.

---

## 변경 이력을 코드와 함께 보고 싶다면

```bash
git log --oneline -- src/main.js index.html css/styles.css vite.config.js
```

이 README는 **현재 동작 기준**으로 작성되었습니다. 동작을 바꾼 뒤에는 상수·함수 목차를 같이 업데이트해 주면 협업에 도움이 됩니다.

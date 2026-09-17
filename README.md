# HWP Grid

HWP·HWPX 문서를 브라우저에서 여러 페이지 격자로 읽는 독립적인 오픈소스 뷰어.

**본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.**

한컴/한글과컴퓨터와 제휴·후원·승인 관계가 없습니다. HWP·HWPX 명칭은 지원 형식을 설명하기 위해 사용합니다.

## 기능

- 문서 서버 업로드 없이 WebAssembly로 로컬 처리
- 열 개수 조절, 확대·축소, 드래그 이동, 페이지 이동, 전체 화면
- IndexedDB에 마지막 원본 문서 1개 저장, localStorage에 보기 위치 저장
- 다시 접속하면 마지막 문서·열 개수·배율·위치를 복원
- 저장본 삭제 가능 (컴퓨터의 원본 파일은 수정·삭제하지 않음)

## 공개 사이트

[HWP Grid 열기](https://gisbi-kim.github.io/hwp-grid/) · [GitHub 저장소](https://github.com/gisbi-kim/hwp-grid)

## GitHub Pages 배포

1. `gisbi-kim/hwp-grid` 공개 저장소를 만들고 이 폴더의 **내용 전체**를 main에 올립니다. `.github/`도 포함해야 합니다.
2. GitHub 저장소 Settings → Pages → Build and deployment → Source를 **GitHub Actions**로 선택합니다.
3. Actions에서 `Deploy HWP Grid to GitHub Pages`를 실행합니다. 이후 main에 push하면 자동으로 다시 배포합니다.
4. 성공 후 주소: `https://gisbi-kim.github.io/hwp-grid/`.

`vite.config.ts`의 base 및 WASM/고지 링크는 `/hwp-grid/` 하위 경로에 대응합니다. 서버 런타임, API 키, ChatGPT 로그인은 필요하지 않습니다. 소스만 배포하므로 빌드 시 의존성을 npm에서 설치합니다.

기존 `chatgpt.site`와 GitHub Pages는 다른 origin이므로 저장된 문서는 자동 이전되지 않습니다. 새 주소에서 원본을 한 번 다시 열면 됩니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```sh
npm ci
npm run dev
```

배포 파일 생성:

```sh
npm run build
```

## 사용

파일 선택 또는 드래그 앤 드롭으로 엽니다. 휠은 스크롤, Ctrl/Command+휠은 확대, 드래그는 화면 이동입니다. 모바일 문서 영역에서는 두 손가락을 오므리거나 펼쳐 20–800%로 축소·확대하고, 한 손가락으로 이동합니다. 문서 영역에 포커스한 상태에서 좌우 방향키로 행 이동, 0으로 화면 맞춤이 가능합니다.

최대 200 MiB, 암호 없는 HWP·HWPX를 지원합니다. 복잡한 표·수식·글꼴은 한컴 출력과 다를 수 있으며, 원본 편집이나 출력 정확성을 보증하지 않습니다. 브라우저 저장은 영구 백업이 아닙니다. 웹사이트 최초 로드는 인터넷이 필요하며 별도 오프라인 서비스 워커는 없습니다.

## 라이선스

이 프로젝트 고유 코드는 MIT입니다. 제3자 코드와 글꼴에는 각각의 라이선스가 계속 적용됩니다.

| 구성요소 | 버전 | 라이선스 |
|---|---|---|
| @rhwp/core | 0.8.6 | MIT |
| DOMPurify | 3.4.15 | Apache-2.0 선택 (MPL-2.0 OR Apache-2.0) |
| Noto Sans KR / Noto Serif KR | 5.3.0 | SIL OFL-1.1 |
| React / React DOM | 19.2.6 | MIT |
| Radix UI / shadcn | package-lock.json / 포함 소스 | MIT |
| Lucide | 1.31.0 | ISC, 일부 Feather 유래 아이콘 MIT |

빌드 시 `scripts/prepare-assets.mjs`가 런타임 npm 의존성의 고지를 수집하고 공개 배포에 동봉합니다. UI와 라이선스 페이지에서 한컴의 공개 스펙 고지와 제3자 라이선스를 확인할 수 있습니다. 상위 rhwp의 제3자 고지는 `legal/`에 별도 보존합니다.

한컴 실행파일·SDK·DLL이나 한컴/Microsoft 상용 폰트 파일을 이 앱에 추가하지 않았습니다. 한컴 원본 스펙 PDF 및 사용자 문서도 저장소에 동봉하지 않습니다.

이 문서는 확인한 라이선스와 출처를 정리한 것이며, 모든 상위 의존성의 권리관계를 독립적으로 검증한 법률 의견이나 무침해 보증은 아닙니다. 추가 배포 리소스 및 향후 의존성 변경 시 조건을 다시 확인해야 합니다.

## 배포 이력

- 1.0.0: 제공된 hwp-grid-github-ready.zip을 기반으로 최초 공개. Vite를 8.3.0으로 갱신하고 타입 검사·배포 빌드·의존성 보안 검사를 수행했습니다.

- 모바일 터치: 두 손가락 사이를 중심으로 핀치 확대·축소, 한 손가락 이동 및 손가락 수 전환을 지원합니다.

- 성능 표시: 하단에 최초 사이트 로딩 시간, 최근 문서 준비 시간, 2초 간격의 메모리 정보를 표시합니다. 최초 로딩은 Navigation Timing의 loadEventEnd 기준이며 문서 준비는 파일 읽기부터 분석까지(페이지 렌더링·저장 제외)입니다. 메모리(JS)는 지원 브라우저의 performance.memory 추정값이며 미지원 시 명시합니다. 엔진 할당량은 WebAssembly 메모리 버퍼 크기입니다. 두 값은 전체 탭 메모리가 아니며 합산하지 않습니다. MB는 1,000,000바이트입니다.

- 혼합 용지 격자: 가로·세로 및 크기가 다른 페이지도 표시 너비를 같게 맞추고 원본 비율을 유지합니다. 행 높이는 해당 행의 페이지에 맞춰 계산하여 문서 전체의 최대 용지 크기로 생기던 여백을 줄였습니다.

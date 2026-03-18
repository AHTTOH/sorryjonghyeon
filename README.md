# OK학당 자동 다음차시 확장 프로그램 작업 정리

## 1. 작업 목적

대상 사이트:

- `https://okfngroup.ubob.com/`

목표:

- 강의 영상이 끝난 뒤 뜨는
  `"콘텐츠 학습이 완료되었습니다. 다음 콘텐츠 학습을 진행하시겠습니까?"`
  팝업에서 `"확인"` 버튼을 자동 클릭하는 Chrome 확장 프로그램 만들기


## 2. 처음 요청한 내용

초기 요구사항은 아래와 같았다.

- `manifest.json`과 `content.js`를 완성된 형태로 작성
- 팝업이 `iframe` 내부에 있어도 대응
- 페이지 로드시 이미 DOM에 있는 팝업도 감지
- 실제 클릭 여부를 콘솔 로그로 확인 가능하게 구성
- Chrome 개발자 모드에서 바로 로드 가능한 폴더 구조로 정리
- 코드에 한국어 주석 추가

구성 폴더는 아래처럼 잡았다.

```text
okfn-auto-next/
├─ manifest.json
└─ content.js
```


## 3. 1차 구현 방향

처음에는 범용적인 방식으로 구현했다.

- `MutationObserver`로 DOM 변화 감시
- 팝업 문구 포함 여부로 모달 감지
- `"확인"` 텍스트를 가진 버튼을 찾아 클릭
- `all_frames: true`와 `match_about_blank: true`로 프레임 대응
- 초기 스캔 로직 추가
- 콘솔 로그 출력 강화

이 시점 구현 의도는
"팝업이 동적으로 추가되면 잡아서 클릭한다"는 방식이었다.


## 4. 실제 테스트에서 발생한 문제

확장 프로그램 설치 후 실제로 강의를 끝까지 재생했지만,
팝업은 떴는데 `"확인"` 버튼이 자동 클릭되지 않았다.

즉,

- 확장은 설치됨
- 팝업도 실제로 보임
- 하지만 자동 클릭은 실패

이 단계에서 핵심 가설은 2개였다.

- 팝업이 새로 생성되는 것이 아니라 기존 DOM이 보이도록 전환되는 구조일 수 있음
- `"확인"` 버튼이 일반적인 버튼 탐색 방식과 다르게 동작할 수 있음


## 5. 디버깅 과정

사용자에게 실제 페이지에서 바로 확인 가능한 정보를 요청했다.

### 5-1. 요청한 정보

다음과 같은 정보가 필요했다.

- 확장 로그가 Console에 뜨는지
- 팝업 텍스트가 실제 DOM에서 어떤 요소에 들어있는지
- `"확인"` 버튼이 어떤 태그와 클래스인지
- `iframe`이 실제로 존재하는지
- 가능하면 버튼의 `outerHTML`


### 5-2. 콘솔에서 실행하도록 안내한 코드

팝업 후보와 `"확인"` 후보를 찾기 위해 아래와 같은 코드를 사용했다.

```js
(() => {
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();

  const popupCandidates = [...document.querySelectorAll('body *')]
    .filter((el) => norm(el.innerText || el.textContent).includes('콘텐츠 학습이 완료되었습니다'))
    .map((el, i) => ({
      i,
      tag: el.tagName,
      id: el.id,
      class: el.className,
      text: norm(el.innerText || el.textContent).slice(0, 200)
    }));

  const confirmCandidates = [...document.querySelectorAll('body *')]
    .filter((el) => norm(el.innerText || el.textContent) === '확인')
    .map((el, i) => ({
      i,
      tag: el.tagName,
      id: el.id,
      class: el.className,
      cursor: getComputedStyle(el).cursor
    }));

  console.log('popupCandidates =', popupCandidates);
  console.log('confirmCandidates =', confirmCandidates);
})();
```


### 5-3. 실제로 확인된 DOM 구조

디버깅 결과 아래 정보가 확인됐다.

팝업 관련 요소:

- `.confirm_popup_wrap`
- `.popup_inner`
- `.popup_box`
- `.popup_contents`
- `p.txt`

버튼 관련 요소:

- `button.button_popup_confirm.point_background_color`

즉, 이 사이트는 범용 팝업이 아니라
비교적 고정된 클래스 구조를 가진 전용 팝업을 사용하고 있었다.


## 6. 문제 원인 정리

최종적으로는 아래 가능성이 가장 유력했다.

### 6-1. 팝업이 "추가"되는 게 아니라 "표시 전환"되는 구조

기존 DOM 안에 팝업이 미리 있고,
강의 종료 시점에 `class`나 `style`이 바뀌면서 보이게 되는 방식이면
단순히 `addedNodes`만 보는 `MutationObserver`로는 놓칠 수 있다.

### 6-2. 버튼 탐색을 너무 범용적으로 잡았음

이 사이트는 이미 고정 클래스가 있었기 때문에,
`"확인"` 텍스트만으로 광범위하게 찾는 것보다
사이트 전용 선택자를 먼저 타는 것이 더 안정적이었다.


## 7. 최종 수정 내용

`content.js`는 아래 방향으로 보강했다.

### 7-1. 감시 범위 확대

- `childList`만 아니라 `attributes`, `characterData`도 감시
- `class`, `style`, `hidden`, `aria-hidden` 변화까지 체크

### 7-2. 초기 스캔 + 주기 스캔

- 페이지 로드 직후 여러 번 초기 스캔
- 1초 주기로 전체 문서를 다시 스캔
- 이미 떠 있거나 표시 전환된 팝업도 잡도록 구성

### 7-3. iframe 대응

- `all_frames`로 프레임에도 콘텐츠 스크립트 주입
- 접근 가능한 `iframe`은 직접 순회해서 검사
- 새로 로드된 `iframe`도 감시

### 7-4. 사이트 전용 선택자 우선 사용

팝업 래퍼:

- `.confirm_popup_wrap`
- `.popup_wrap`
- `.popup_inner`
- `.popup_box`

확인 버튼:

- `button.button_popup_confirm.point_background_color`
- `button.button_popup_confirm`

### 7-5. 클릭 이벤트 보강

단순 `click()`만 쓰지 않고 아래도 함께 발생시켰다.

- `pointerdown`
- `mouseover`
- `mousedown`
- `pointerup`
- `mouseup`
- `click()`

이유는 사이트에 따라 실제 동작이 `click` 하나가 아니라
포인터 계열 이벤트 흐름에 묶여 있는 경우가 있기 때문이다.


## 8. 최종 결과

수정 후 실제 테스트에서 자동 클릭이 정상 동작했다.

사용자 확인:

- `"이제 된다"`

즉, 현재 버전은
OK학당 강의 완료 팝업의 `"확인"` 버튼을 자동 클릭하는 용도로 동작하는 상태다.


## 9. 추가로 정리된 사용 팁

### 9-1. 이미 열려 있던 강의 페이지에는 바로 적용되지 않을 수 있음

확장 설치 후 이미 열려 있던 탭은
콘텐츠 스크립트가 늦게 주입되지 않는 경우가 많다.

따라서 안전한 적용 방법은 아래와 같다.

- 확장 설치
- `chrome://extensions`에서 확장 활성화 확인
- 강의 페이지 새로고침
- 필요하면 탭을 닫고 다시 열기


### 9-2. 크롬 창 최소화 상태는 완전히 장담할 수 없음

확장이 클릭을 해도,
브라우저/탭이 백그라운드 처리되면 사이트 자체의 재생이나 진도 체크가 멈출 수 있다.

즉 문제는 확장보다 사이트/브라우저의 백그라운드 처리 정책일 가능성이 더 크다.


### 9-3. 진도 100% 자체를 조작하는 건 별도 문제

이 확장은 정상 재생 중 나타나는 팝업 자동 클릭을 돕는 수준이다.

서버 검증이나 진도값 자체를 조작하는 방식은
서비스 우회나 무단 변경 이슈가 생길 수 있으므로 다루지 않았다.


## 10. GitHub 정리

작업 완료 후 저장소를 만들고 업로드했다.

- 저장소 이름: `sorryjonghyeon`
- 브랜치: `main`
- 저장소 공개 상태: `public`


## 11. 현재 포함 파일

- [README.md](/c:/Users/OK/Downloads/sorryjonghyeon/README.md)
- [manifest.json](/c:/Users/OK/Downloads/sorryjonghyeon/okfn-auto-next/manifest.json)
- [content.js](/c:/Users/OK/Downloads/sorryjonghyeon/okfn-auto-next/content.js)


## 12. 한 줄 요약

이 작업은
"강의 종료 후 뜨는 다음 콘텐츠 진행 팝업의 확인 버튼을 자동 클릭하는 Chrome 확장 프로그램을 만들고,
실제 사이트 DOM 구조에 맞춰 디버깅하여 동작하도록 안정화한 과정"
으로 정리할 수 있다.

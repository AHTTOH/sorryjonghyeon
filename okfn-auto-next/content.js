(() => {
  const LOG_PREFIX = '[OK학당 Auto]';
  const POPUP_TEXT_PATTERNS = [
    '콘텐츠 학습이 완료되었습니다',
    '다음 콘텐츠 학습을 진행하시겠습니까'
  ];
  const STORAGE_KEY_PLAYBACK_RATE = 'playbackRate';
  const DEFAULT_PLAYBACK_RATE = 3.0;
  const CONFIRM_TEXT = '확인';
  const CLICK_DELAY_MS = 300;
  const PERIODIC_SCAN_MS = 1000;
  const POPUP_WRAPPER_SELECTORS = [
    '.confirm_popup_wrap',
    '.popup_wrap',
    '.popup_inner',
    '.popup_box'
  ];
  const CONFIRM_BUTTON_SELECTORS = [
    'button.button_popup_confirm.point_background_color',
    'button.button_popup_confirm',
    '.popup_footer button',
    'button'
  ];

  let observerStarted = false;
  let lastClickedButton = null;
  let lastClickedAt = 0;
  let periodicScanStarted = false;
  let storageSyncStarted = false;
  let targetPlaybackRate = DEFAULT_PLAYBACK_RATE;
  const boundVideos = new WeakSet();

  // 현재 스크립트가 어느 프레임에서 실행 중인지 로그에 표시한다.
  function getFrameLabel() {
    try {
      return window.top === window ? 'top-frame' : 'iframe';
    } catch (error) {
      return 'iframe';
    }
  }

  // 콘솔 로그 포맷을 통일해 실제 동작 여부를 확인하기 쉽게 만든다.
  function log(message, ...args) {
    console.log(`${LOG_PREFIX} [${getFrameLabel()}] ${message}`, ...args);
  }

  // 공백과 줄바꿈 차이 때문에 문자열 비교가 흔들리지 않도록 정규화한다.
  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 요소가 화면상 숨겨져 있으면 클릭 대상에서 제외한다.
  function isVisible(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    return element.getClientRects().length > 0;
  }

  // 버튼 텍스트를 태그 종류와 무관하게 동일한 방식으로 읽는다.
  function getButtonText(element) {
    return normalizeText(element.innerText || element.textContent || element.value || '');
  }

  // 저장된 배속값이 이상할 때를 대비해 허용 범위(1.0x ~ 3.0x)로 보정한다.
  function normalizePlaybackRate(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return DEFAULT_PLAYBACK_RATE;
    }

    return Math.max(1, Math.min(3, numeric));
  }

  // HTML5 video 요소에 목표 배속을 강제로 적용한다.
  function applyPlaybackRate(video, reason) {
    if (!(video instanceof HTMLVideoElement)) {
      return false;
    }

    try {
      const before = Number(video.playbackRate || 1);
      if (Math.abs(before - targetPlaybackRate) < 0.01) {
        return false;
      }

      video.defaultPlaybackRate = targetPlaybackRate;
      video.playbackRate = targetPlaybackRate;

      const after = Number(video.playbackRate || 1);
      log(`배속 적용: ${before}x -> ${after}x / target=${targetPlaybackRate}x / reason=${reason}`);
      return Math.abs(after - targetPlaybackRate) < 0.01;
    } catch (error) {
      log(`배속 적용 실패 / reason=${reason}`, error);
      return false;
    }
  }

  // 새로 발견한 video 에 이벤트를 걸어 사이트가 배속을 되돌려도 다시 맞춘다.
  function bindVideo(video, reason) {
    if (!(video instanceof HTMLVideoElement)) {
      return;
    }

    if (boundVideos.has(video)) {
      applyPlaybackRate(video, `${reason}:already-bound`);
      return;
    }

    boundVideos.add(video);

    const syncPlaybackRate = (event) => {
      applyPlaybackRate(video, `${reason}:${event.type}`);
    };

    video.addEventListener('loadedmetadata', syncPlaybackRate);
    video.addEventListener('play', syncPlaybackRate);
    video.addEventListener('playing', syncPlaybackRate);
    video.addEventListener('ratechange', syncPlaybackRate);

    applyPlaybackRate(video, `${reason}:bind`);
  }

  // 현재 루트에서 video 태그를 찾아 저장된 배속을 유지하도록 연결한다.
  function scanVideos(root, reason) {
    if (!(root instanceof Element) && !(root instanceof Document)) {
      return;
    }

    if (root instanceof HTMLVideoElement) {
      bindVideo(root, reason);
      return;
    }

    const videos = root.querySelectorAll('video');
    for (const video of videos) {
      bindVideo(video, reason);
    }
  }

  // 현재 문서와 접근 가능한 iframe 안의 video에 최신 배속 설정을 다시 적용한다.
  function refreshPlaybackRate(reason) {
    scanVideos(document, reason);
    scanChildIframes(`${reason}:iframes`);
  }

  // 확장 팝업에서 바꾼 배속 설정을 읽어 즉시 반영한다.
  function loadPlaybackRatePreference(reason) {
    if (!chrome?.storage?.sync) {
      log(`storage API를 사용할 수 없어 기본 배속 ${DEFAULT_PLAYBACK_RATE}x를 유지합니다. reason=${reason}`);
      targetPlaybackRate = DEFAULT_PLAYBACK_RATE;
      refreshPlaybackRate(`${reason}:no-storage`);
      return;
    }

    chrome.storage.sync.get({ [STORAGE_KEY_PLAYBACK_RATE]: DEFAULT_PLAYBACK_RATE }, (result) => {
      if (chrome.runtime.lastError) {
        log(`배속 설정 로드 실패 / reason=${reason}`, chrome.runtime.lastError);
        return;
      }

      targetPlaybackRate = normalizePlaybackRate(result[STORAGE_KEY_PLAYBACK_RATE]);
      log(`배속 설정 로드: ${targetPlaybackRate}x / reason=${reason}`);
      refreshPlaybackRate(`${reason}:storage-load`);
    });
  }

  // 팝업 UI에서 사용자가 배속 버튼을 누르면 열린 탭의 content script도 즉시 반응한다.
  function startStorageSync() {
    if (storageSyncStarted || !chrome?.storage?.onChanged) {
      return;
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !changes[STORAGE_KEY_PLAYBACK_RATE]) {
        return;
      }

      targetPlaybackRate = normalizePlaybackRate(changes[STORAGE_KEY_PLAYBACK_RATE].newValue);
      log(`배속 설정 변경 감지: ${targetPlaybackRate}x`);
      refreshPlaybackRate('storage-change');
    });

    storageSyncStarted = true;
  }

  // 팝업 문구가 있는지 느슨하게 확인한다.
  function isPopupText(text) {
    const normalized = normalizeText(text);
    return POPUP_TEXT_PATTERNS.some((pattern) => normalized.includes(pattern));
  }

  // 루트 노드 내부에 완료 팝업 문구가 있는지 확인한다.
  function containsPopupKeyword(root) {
    if (!(root instanceof Element) && !(root instanceof Document)) {
      return false;
    }

    return isPopupText(root.innerText || root.textContent || '');
  }

  // 이 사이트 팝업 래퍼를 우선 탐색해 중복 버튼이나 숨김 요소 오탐을 줄인다.
  function findPopupWrappers(root) {
    if (!(root instanceof Element) && !(root instanceof Document)) {
      return [];
    }

    const wrappers = [];
    for (const selector of POPUP_WRAPPER_SELECTORS) {
      wrappers.push(...root.querySelectorAll(selector));
    }

    return wrappers.filter((wrapper) => isVisible(wrapper) && containsPopupKeyword(wrapper));
  }

  // 텍스트 노드나 span 내부를 눌러도 반응하는 사이트가 있어, 실제 클릭 가능한 조상을 찾아낸다.
  function resolveClickableElement(element) {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    let current = element;
    for (let depth = 0; current && depth < 5; depth += 1) {
      if (!isVisible(current)) {
        current = current.parentElement;
        continue;
      }

      if (
        current.matches('button, a, input[type="button"], input[type="submit"], [role="button"], [onclick]') ||
        current.className?.toString().match(/btn|button|confirm/i) ||
        window.getComputedStyle(current).cursor === 'pointer'
      ) {
        return current;
      }

      current = current.parentElement;
    }

    return isVisible(element) ? element : null;
  }

  // 팝업 후보 루트에서 "확인" 버튼을 찾는다.
  function findConfirmButton(root) {
    if (!(root instanceof Element) && !(root instanceof Document)) {
      return null;
    }

    const popupWrappers = findPopupWrappers(root);
    for (const wrapper of popupWrappers) {
      for (const selector of CONFIRM_BUTTON_SELECTORS) {
        const buttons = wrapper.querySelectorAll(selector);
        for (const button of buttons) {
          if (!isVisible(button)) {
            continue;
          }

          if (getButtonText(button) !== CONFIRM_TEXT) {
            continue;
          }

          const clickable = resolveClickableElement(button);
          if (clickable) {
            return clickable;
          }
        }
      }
    }

    const candidates = root.querySelectorAll('button, a, input[type="button"], input[type="submit"], div, span, strong');
    for (const candidate of candidates) {
      if (!isVisible(candidate)) {
        continue;
      }

      const text = getButtonText(candidate);
      if (text === CONFIRM_TEXT) {
        const clickable = resolveClickableElement(candidate);
        if (clickable) {
          return clickable;
        }
      }
    }

    return null;
  }

  // 클릭 전후 상태를 남기고, 일반 click 이외의 이벤트도 함께 발생시켜 호환성을 높인다.
  function clickConfirmButton(button, reason) {
    if (!(button instanceof HTMLElement)) {
      return false;
    }

    if (button === lastClickedButton && Date.now() - lastClickedAt < 1500) {
      log(`중복 클릭 방지: 최근에 같은 버튼을 클릭해서 건너뜁니다. reason=${reason}`);
      return true;
    }

    const buttonText = getButtonText(button);
    log(`팝업 감지 / 버튼="${buttonText}" / reason=${reason}`);

    window.setTimeout(() => {
      if (!button.isConnected) {
        log(`클릭 실패: 버튼이 DOM에서 제거되었습니다. reason=${reason}`);
        return;
      }

      try {
        button.focus?.();
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
        button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
        button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
        button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        button.click();

        lastClickedButton = button;
        lastClickedAt = Date.now();

        log(`확인 버튼 클릭 실행 완료. reason=${reason}`, button);
      } catch (error) {
        log(`클릭 중 오류 발생. reason=${reason}`, error);
      }
    }, CLICK_DELAY_MS);

    return true;
  }

  // 전달받은 루트 자체와 하위 요소를 검사해 팝업을 찾는다.
  function scanRoot(root, reason) {
    if (!(root instanceof Element) && !(root instanceof Document)) {
      return false;
    }

    if (containsPopupKeyword(root)) {
      const button = findConfirmButton(root);
      if (button) {
        return clickConfirmButton(button, reason);
      }
    }

    const descendants = root.querySelectorAll('*');
    for (const element of descendants) {
      if (!containsPopupKeyword(element)) {
        continue;
      }

      const button = findConfirmButton(element);
      if (button) {
        return clickConfirmButton(button, reason);
      }
    }

    return false;
  }

  // 현재 문서 안에 있는 iframe 요소를 직접 순회해 접근 가능한 프레임도 즉시 검사한다.
  function scanChildIframes(reason) {
    const frames = document.querySelectorAll('iframe');
    for (const frame of frames) {
      try {
        const childDocument = frame.contentDocument;
        if (!childDocument || !childDocument.body) {
          continue;
        }

        if (scanRoot(childDocument, `${reason}:child-iframe`)) {
          return true;
        }

        scanVideos(childDocument, `${reason}:child-iframe`);
      } catch (error) {
        log(`iframe 직접 스캔 불가: 다른 origin 이거나 아직 로드되지 않았습니다. reason=${reason}`, error);
      }
    }

    return false;
  }

  // 페이지 로드 직후 이미 떠 있는 팝업을 잡기 위해 초기 스캔을 여러 번 시도한다.
  function runInitialScans() {
    const delays = [0, 500, 1500, 3000];

    for (const delay of delays) {
      window.setTimeout(() => {
        log(`초기 스캔 실행. delay=${delay}ms`);

        if (document.body) {
          scanRoot(document, `initial-scan-${delay}ms`);
          scanChildIframes(`initial-scan-${delay}ms`);
        } else {
          log(`초기 스캔 보류: document.body 가 아직 없습니다. delay=${delay}ms`);
        }
      }, delay);
    }
  }

  // body 생성이 늦는 페이지도 있어 Observer 시작을 몇 차례 재시도한다.
  function ensureObserverStarted() {
    if (observerStarted) {
      return;
    }

    if (document.body) {
      startObserver();
      return;
    }

    const delays = [200, 500, 1000, 2000];
    for (const delay of delays) {
      window.setTimeout(() => {
        if (!observerStarted && document.body) {
          log(`Observer 재시도 성공. delay=${delay}ms`);
          startObserver();
        }
      }, delay);
    }
  }

  // MutationObserver 만으로 놓치는 경우를 대비해 주기적으로 전체 스캔한다.
  function startPeriodicScan() {
    if (periodicScanStarted) {
      return;
    }

    window.setInterval(() => {
      if (!document.body) {
        return;
      }

      scanRoot(document, 'periodic-scan');
      scanChildIframes('periodic-scan');
      scanVideos(document, 'periodic-scan');
    }, PERIODIC_SCAN_MS);

    periodicScanStarted = true;
    log(`주기 스캔 시작. interval=${PERIODIC_SCAN_MS}ms`);
  }

  // 동적으로 추가되는 모달과 iframe 변화를 감시한다.
  function startObserver() {
    if (observerStarted) {
      return;
    }

    if (!document.body) {
      log('MutationObserver 시작 보류: document.body 가 아직 없습니다.');
      return;
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const addedNode of mutation.addedNodes) {
            if (!(addedNode instanceof Element)) {
              continue;
            }

            scanRoot(addedNode, 'mutation-added-node');
            scanVideos(addedNode, 'mutation-added-node');

            if (addedNode.tagName === 'IFRAME') {
              const frame = addedNode;
              frame.addEventListener('load', () => {
                try {
                  if (frame.contentDocument) {
                    scanRoot(frame.contentDocument, 'iframe-load');
                    scanVideos(frame.contentDocument, 'iframe-load');
                  }
                } catch (error) {
                  log('iframe load 후 직접 접근 실패', error);
                }
              });
            }
          }
          continue;
        }

        if (mutation.target instanceof Element) {
          scanRoot(mutation.target, `mutation-${mutation.type}`);
          scanVideos(mutation.target, `mutation-${mutation.type}`);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
      characterData: true
    });

    observerStarted = true;
    log('MutationObserver 시작 - 팝업 대기 중...');
  }

  // body 준비 여부와 무관하게 안전하게 초기화한다.
  function bootstrap() {
    log(`확장 로드됨. url=${location.href}`);
    loadPlaybackRatePreference('bootstrap');
    startStorageSync();
    runInitialScans();
    ensureObserverStarted();
    startPeriodicScan();
    refreshPlaybackRate('bootstrap');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();

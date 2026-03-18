const STORAGE_KEY_PLAYBACK_RATE = 'playbackRate';
const DEFAULT_PLAYBACK_RATE = 3;

const rateButtons = [...document.querySelectorAll('.rate-button')];
const statusElement = document.getElementById('status');

function normalizePlaybackRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_PLAYBACK_RATE;
  }

  return Math.max(1, Math.min(3, numeric));
}

function renderActiveRate(rate) {
  for (const button of rateButtons) {
    button.classList.toggle('active', Number(button.dataset.rate) === rate);
  }

  statusElement.textContent = `현재 설정된 배속: ${rate.toFixed(1)}x`;
}

function savePlaybackRate(rate) {
  chrome.storage.sync.set({ [STORAGE_KEY_PLAYBACK_RATE]: rate }, () => {
    if (chrome.runtime.lastError) {
      statusElement.textContent = `저장 실패: ${chrome.runtime.lastError.message}`;
      return;
    }

    renderActiveRate(rate);
    statusElement.textContent = `배속을 ${rate.toFixed(1)}x로 저장했습니다. 열려 있는 강의 탭에 바로 반영됩니다.`;
  });
}

for (const button of rateButtons) {
  button.addEventListener('click', () => {
    const rate = normalizePlaybackRate(button.dataset.rate);
    savePlaybackRate(rate);
  });
}

chrome.storage.sync.get({ [STORAGE_KEY_PLAYBACK_RATE]: DEFAULT_PLAYBACK_RATE }, (result) => {
  const rate = normalizePlaybackRate(result[STORAGE_KEY_PLAYBACK_RATE]);
  renderActiveRate(rate);
});

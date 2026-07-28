/**
 * Set up image popup
 *
 * Dependencies: https://github.com/biati-digital/glightbox
 */

const lightImages = '.popup:not(.dark)';
const darkImages = '.popup:not(.light)';
const dependencyRetryDelay = 50;
const dependencyRetryLimit = 200;

function createLightbox(selector) {
  return GLightbox({
    selector,
    closeButton: true,
    touchNavigation: true,
    keyboardNavigation: true,
    closeOnOutsideClick: true
  });
}

export function imgPopup() {
  if (document.querySelector('.popup') === null) {
    return;
  }

  const hasDualImages = !(
    document.querySelector('.popup.light') === null &&
    document.querySelector('.popup.dark') === null
  );

  let selector = Theme.isDark ? darkImages : lightImages;
  let current = null;
  let reverse = null;
  let themeListener = null;
  let retryTimer = null;
  let retryCount = 0;
  let disposed = false;

  const initialize = () => {
    retryTimer = null;

    if (disposed) {
      return;
    }

    if (typeof GLightbox !== 'function') {
      if (retryCount < dependencyRetryLimit) {
        retryCount += 1;
        retryTimer = window.setTimeout(initialize, dependencyRetryDelay);
      }

      return;
    }

    selector = Theme.isDark ? darkImages : lightImages;
    current = createLightbox(selector);

    if (hasDualImages && Theme.isToggleable) {
      themeListener = (event) => {
        if (
          event.source === window &&
          event.data &&
          event.data.id === Theme.eventId
        ) {
          selector = selector === lightImages ? darkImages : lightImages;

          if (reverse === null) {
            reverse = createLightbox(selector);
          }

          [current, reverse] = [reverse, current];
        }
      };

      window.addEventListener('message', themeListener);
    }
  };

  if (typeof window.krosaRegisterPageCleanup === 'function') {
    window.krosaRegisterPageCleanup(() => {
      disposed = true;
      window.clearTimeout(retryTimer);

      if (themeListener) {
        window.removeEventListener('message', themeListener);
      }

      current?.destroy();
      reverse?.destroy();
    });
  }

  initialize();
}

/**
 * Set up image popup
 *
 * Dependencies: https://github.com/biati-digital/glightbox
 */

const lightImages = '.popup:not(.dark)';
const darkImages = '.popup:not(.light)';
let selector = lightImages;

function swapImages(current, reverse) {
  if (selector === lightImages) {
    selector = darkImages;
  } else {
    selector = lightImages;
  }

  if (reverse === null) {
    reverse = GLightbox({ selector: `${selector}` });
  }

  return [reverse, current];
}

export function imgPopup() {
  if (document.querySelector('.popup') === null) {
    return;
  }

  const hasDualImages = !(
    document.querySelector('.popup.light') === null &&
    document.querySelector('.popup.dark') === null
  );

  if (Theme.isDark) {
    selector = darkImages;
  }

  let current = GLightbox({ selector: `${selector}` });
  let reverse = null;
  let themeListener = null;

  if (hasDualImages && Theme.isToggleable) {
    themeListener = (event) => {
      if (
        event.source === window &&
        event.data &&
        event.data.id === Theme.eventId
      ) {
        [current, reverse] = swapImages(current, reverse);
      }
    };

    window.addEventListener('message', themeListener);
  }

  if (typeof window.krosaRegisterPageCleanup === 'function') {
    window.krosaRegisterPageCleanup(() => {
      if (themeListener) {
        window.removeEventListener('message', themeListener);
      }

      current?.destroy();
      reverse?.destroy();
    });
  }
}

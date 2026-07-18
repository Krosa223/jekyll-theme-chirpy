(function () {
  'use strict';

  function wrapLineGlass(element) {
    if (
      element.dataset.lineGlassReady === 'true' ||
      !element.textContent.trim() ||
      element.querySelector('img, picture, video, audio, iframe, pre')
    ) {
      return;
    }

    var wrapper = document.createElement('span');
    wrapper.className = 'reading-line-glass';

    while (element.firstChild) {
      wrapper.appendChild(element.firstChild);
    }

    element.appendChild(wrapper);
    element.dataset.lineGlassReady = 'true';
  }

  function initReadingLines() {
    document
      .querySelectorAll('.post-article > .content > p')
      .forEach(wrapLineGlass);

    document
      .querySelectorAll('.post-article > .content > :is(ul, ol) > li')
      .forEach(function (item) {
        if (!item.querySelector(':scope > ul, :scope > ol, :scope > blockquote')) {
          wrapLineGlass(item);
        }
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReadingLines);
  } else {
    initReadingLines();
  }
})();

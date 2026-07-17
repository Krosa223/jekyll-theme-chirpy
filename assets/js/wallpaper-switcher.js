(function () {
  'use strict';

  var storageKey = 'krosa-wallpaper';
  var defaultWallpaper = '7pje5o';
  var wallpaperIds = [
    '1k5kdg',
    '7pje5o',
    'd8p83m',
    'gp2q9q',
    '134825297',
    '147092236',
    '133608163',
    '139576849',
    '132910923'
  ];
  var root = document.documentElement;

  function isValidWallpaper(value) {
    return wallpaperIds.indexOf(value) !== -1;
  }

  function initWallpaperPicker() {
    var picker = document.querySelector('.wallpaper-picker');
    var toggle = document.getElementById('wallpaper-toggle');
    var menu = document.getElementById('wallpaper-menu');
    var options = Array.prototype.slice.call(
      document.querySelectorAll('.wallpaper-option[data-wallpaper]')
    );

    if (!picker || !toggle || !menu || !options.length) return;

    function setMenuOpen(open) {
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    }

    function applyWallpaper(value, persist) {
      var wallpaper = isValidWallpaper(value) ? value : defaultWallpaper;
      root.setAttribute('data-wallpaper', wallpaper);

      options.forEach(function (option) {
        option.setAttribute(
          'aria-pressed',
          String(option.getAttribute('data-wallpaper') === wallpaper)
        );
      });

      if (!persist) return;

      try {
        window.localStorage.setItem(storageKey, wallpaper);
      } catch {
        // The visual choice still works when storage is unavailable.
      }
    }

    applyWallpaper(root.getAttribute('data-wallpaper'), false);

    toggle.addEventListener('click', function () {
      setMenuOpen(menu.hidden);
    });

    options.forEach(function (option) {
      option.addEventListener('click', function () {
        applyWallpaper(option.getAttribute('data-wallpaper'), true);
        setMenuOpen(false);
        toggle.focus();
      });
    });

    document.addEventListener('click', function (event) {
      if (!menu.hidden && !picker.contains(event.target)) {
        setMenuOpen(false);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !menu.hidden) {
        setMenuOpen(false);
        toggle.focus();
      }
    });

    window.addEventListener('storage', function (event) {
      if (event.key === storageKey && isValidWallpaper(event.newValue)) {
        applyWallpaper(event.newValue, false);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWallpaperPicker);
  } else {
    initWallpaperPicker();
  }
})();

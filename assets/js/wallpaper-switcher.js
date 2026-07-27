(function () {
  'use strict';

  var wallpaperStorageKey = 'krosa-wallpaper';
  var modeStorageKey = 'krosa-wallpaper-mode';
  var defaultWallpaper = '7pje5o';
  var defaultMode = 'auto';
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
  var schedule = [
    { start: 5, wallpaper: '134825297' },
    { start: 11, wallpaper: '132910923' },
    { start: 17, wallpaper: '139576849' },
    { start: 20, wallpaper: '7pje5o' },
    { start: 24, wallpaper: '133608163' }
  ];
  var root = document.documentElement;
  var refreshTimer = null;
  var currentMode = defaultMode;

  function isValidWallpaper(value) {
    return wallpaperIds.indexOf(value) !== -1;
  }

  function isValidMode(value) {
    return value === 'auto' || value === 'manual';
  }

  function readCookie(key) {
    var prefix = key + '=';
    var cookies = document.cookie.split(';');

    for (var i = 0; i < cookies.length; i += 1) {
      var cookie = cookies[i].trim();
      if (cookie.indexOf(prefix) === 0) {
        try {
          return decodeURIComponent(cookie.slice(prefix.length));
        } catch {
          return null;
        }
      }
    }

    return null;
  }

  function readPreference(key) {
    try {
      var stored = window.localStorage.getItem(key);
      if (stored) return stored;
    } catch {
      // Fall through to the preference cookie.
    }

    return readCookie(key);
  }

  function storePreference(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // The preference cookie below remains available as a fallback.
    }

    document.cookie =
      key +
      '=' +
      encodeURIComponent(value) +
      '; path=/; max-age=31536000; SameSite=Lax';
  }

  function readStoredWallpaper() {
    var stored = readPreference(wallpaperStorageKey);
    return isValidWallpaper(stored) ? stored : null;
  }

  function readStoredMode() {
    var stored = readPreference(modeStorageKey);
    return isValidMode(stored) ? stored : null;
  }

  function wallpaperForTime(date) {
    var hour = date.getHours() + date.getMinutes() / 60;
    var wallpaper = schedule[schedule.length - 1].wallpaper;

    for (var i = 0; i < schedule.length; i += 1) {
      if (hour < schedule[i].start) break;
      wallpaper = schedule[i].wallpaper;
    }

    return wallpaper;
  }

  function millisecondsUntilNextPeriod(date) {
    var nextChange = null;

    for (var i = 0; i < schedule.length; i += 1) {
      var candidate = new Date(date);
      candidate.setHours(schedule[i].start, 0, 0, 0);
      if (candidate <= date) continue;
      nextChange = candidate;
      break;
    }

    if (!nextChange) {
      nextChange = new Date(date);
      nextChange.setDate(nextChange.getDate() + 1);
      nextChange.setHours(schedule[0].start, 0, 0, 0);
    }

    return Math.max(1000, nextChange.getTime() - date.getTime() + 250);
  }

  function initWallpaperPicker() {
    var picker = document.querySelector('.wallpaper-picker');
    var toggle = document.getElementById('wallpaper-toggle');
    var menu = document.getElementById('wallpaper-menu');
    var autoOption = document.getElementById('wallpaper-auto');
    var options = Array.prototype.slice.call(
      document.querySelectorAll('.wallpaper-option[data-wallpaper]')
    );

    if (!picker || !toggle || !menu || !autoOption || !options.length) return;

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

      storePreference(wallpaperStorageKey, wallpaper);
    }

    function refreshTimedWallpaper() {
      if (currentMode !== 'auto') return;

      var now = new Date();
      applyWallpaper(wallpaperForTime(now), false);
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(
        refreshTimedWallpaper,
        millisecondsUntilNextPeriod(now)
      );
    }

    function applyMode(value, persist) {
      currentMode = isValidMode(value) ? value : defaultMode;
      root.setAttribute('data-wallpaper-mode', currentMode);
      autoOption.setAttribute(
        'aria-pressed',
        String(currentMode === 'auto')
      );

      if (currentMode === 'auto') {
        refreshTimedWallpaper();
      } else {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }

      if (persist) {
        storePreference(modeStorageKey, currentMode);
      }
    }

    function syncStoredPreference() {
      var storedWallpaper = readStoredWallpaper();
      var storedMode = readStoredMode() || defaultMode;

      applyMode(storedMode, false);
      if (storedMode === 'manual') {
        applyWallpaper(
          storedWallpaper || root.getAttribute('data-wallpaper'),
          false
        );
      }
    }

    syncStoredPreference();

    toggle.addEventListener('click', function () {
      setMenuOpen(menu.hidden);
    });

    autoOption.addEventListener('click', function () {
      applyMode('auto', true);
      setMenuOpen(false);
      toggle.focus();
    });

    options.forEach(function (option) {
      option.addEventListener('click', function () {
        applyMode('manual', true);
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
      if (event.key === modeStorageKey && isValidMode(event.newValue)) {
        applyMode(event.newValue, false);
      }

      if (
        event.key === wallpaperStorageKey &&
        currentMode === 'manual' &&
        isValidWallpaper(event.newValue)
      ) {
        applyWallpaper(event.newValue, false);
      }
    });

    window.addEventListener('pageshow', function () {
      syncStoredPreference();
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && currentMode === 'auto') {
        refreshTimedWallpaper();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWallpaperPicker);
  } else {
    initWallpaperPicker();
  }
})();

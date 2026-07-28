(function () {
  'use strict';

  if (window.krosaGlassCursor) return;

  var surfaceSelector = [
    '#sidebar',
    '#topbar-wrapper',
    '#main-wrapper > .container',
    '#wallpaper-menu',
    '.dropdown-menu',
    '.post-preview',
    '.category-folder-tab',
    '.category-folder-sheet',
    '.category-quick-menu',
    '#tags',
    '#archives',
    '#page-category',
    '#page-tag',
    'main > article[data-toc]',
    'main > article:not([data-toc]) > .content',
    '#search-results > article',
    '#panel-wrapper .access > section',
    '.post-article > .content > p',
    '.post-navigation .btn'
  ].join(',');

  var pointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var discRadius = 16;
  var trailLifetime = 520;
  var maxTrailPoints = 24;
  var enabled = false;
  var activeSurface = null;
  var hasPointer = false;
  var targetX = 0;
  var targetY = 0;
  var currentX = 0;
  var currentY = 0;
  var normalX = 0;
  var normalY = 1;
  var normalReady = false;
  var lastSampleX = Number.NaN;
  var lastSampleY = Number.NaN;
  var lastFrameTime = 0;
  var animationFrame = 0;
  var leftPoints = [];
  var rightPoints = [];

  var layer = document.createElement('div');
  layer.className = 'glass-cursor-effect';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = [
    '<svg class="glass-cursor-trails" aria-hidden="true" focusable="false">',
    '<defs>',
    '<linearGradient id="glass-cursor-left-gradient" gradientUnits="userSpaceOnUse">',
    '<stop offset="0" stop-color="#fff" stop-opacity="0"></stop>',
    '<stop offset="0.55" stop-color="#dff5fb" stop-opacity="0.16"></stop>',
    '<stop offset="1" stop-color="#dff5fb" stop-opacity="0.58"></stop>',
    '</linearGradient>',
    '<linearGradient id="glass-cursor-right-gradient" gradientUnits="userSpaceOnUse">',
    '<stop offset="0" stop-color="#fff" stop-opacity="0"></stop>',
    '<stop offset="0.55" stop-color="#dff5fb" stop-opacity="0.16"></stop>',
    '<stop offset="1" stop-color="#dff5fb" stop-opacity="0.58"></stop>',
    '</linearGradient>',
    '</defs>',
    '<path class="glass-cursor-trail glass-cursor-trail-soft" data-glass-trail="left" stroke="url(#glass-cursor-left-gradient)"></path>',
    '<path class="glass-cursor-trail glass-cursor-trail-soft" data-glass-trail="right" stroke="url(#glass-cursor-right-gradient)"></path>',
    '<path class="glass-cursor-trail glass-cursor-trail-edge" data-glass-trail="left" stroke="url(#glass-cursor-left-gradient)"></path>',
    '<path class="glass-cursor-trail glass-cursor-trail-edge" data-glass-trail="right" stroke="url(#glass-cursor-right-gradient)"></path>',
    '</svg>',
    '<div class="glass-cursor-disc"></div>'
  ].join('');
  document.body.appendChild(layer);

  var disc = layer.querySelector('.glass-cursor-disc');
  var leftPaths = Array.prototype.slice.call(
    layer.querySelectorAll('[data-glass-trail="left"]')
  );
  var rightPaths = Array.prototype.slice.call(
    layer.querySelectorAll('[data-glass-trail="right"]')
  );
  var leftGradient = layer.querySelector('#glass-cursor-left-gradient');
  var rightGradient = layer.querySelector('#glass-cursor-right-gradient');

  function roundCoordinate(value) {
    return Math.round(value * 10) / 10;
  }

  function findSurface(element) {
    if (!(element instanceof Element)) return null;
    return element.closest(surfaceSelector);
  }

  function readSurfaceRadius(surface, rect) {
    var style = window.getComputedStyle(surface);
    var radii = [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius
    ]
      .map(function (value) {
        return parseFloat(value);
      })
      .filter(function (value) {
        return Number.isFinite(value);
      });
    var radius = radii.length ? Math.max.apply(null, radii) : 0;

    return Math.min(radius, rect.width / 2, rect.height / 2);
  }

  function updateClip() {
    if (!activeSurface || !activeSurface.isConnected) return false;

    var rect = activeSurface.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.right <= 0 ||
      rect.bottom <= 0 ||
      rect.left >= window.innerWidth ||
      rect.top >= window.innerHeight
    ) {
      return false;
    }

    var top = Math.max(0, rect.top);
    var right = Math.max(0, window.innerWidth - rect.right);
    var bottom = Math.max(0, window.innerHeight - rect.bottom);
    var left = Math.max(0, rect.left);
    var radius = readSurfaceRadius(activeSurface, rect);
    var inset =
      'inset(' +
      top +
      'px ' +
      right +
      'px ' +
      bottom +
      'px ' +
      left +
      'px round ' +
      radius +
      'px)';

    layer.style.clipPath = inset;
    layer.style.webkitClipPath = inset;
    return true;
  }

  function clearTrail() {
    leftPoints = [];
    rightPoints = [];
    lastSampleX = Number.NaN;
    lastSampleY = Number.NaN;
    leftPaths.concat(rightPaths).forEach(function (path) {
      path.removeAttribute('d');
    });
  }

  function positionDisc() {
    disc.style.transform =
      'translate3d(' +
      roundCoordinate(currentX - discRadius) +
      'px, ' +
      roundCoordinate(currentY - discRadius) +
      'px, 0)';
  }

  function deactivate() {
    activeSurface = null;
    layer.classList.remove('is-active');
    ensureAnimation();
  }

  function setSurface(surface) {
    if (!enabled || !surface) {
      deactivate();
      return;
    }

    var wasActive = Boolean(activeSurface);
    if (surface !== activeSurface) {
      activeSurface = surface;
      clearTrail();

      if (!wasActive) {
        currentX = targetX;
        currentY = targetY;
        normalReady = false;
        positionDisc();
      }
    }

    if (!updateClip()) {
      deactivate();
      return;
    }

    layer.classList.add('is-active');
    ensureAnimation();
  }

  function buildPath(points) {
    if (points.length < 2) return '';

    var first = points[0];
    var path =
      'M ' + roundCoordinate(first.x) + ' ' + roundCoordinate(first.y);

    for (var index = 1; index < points.length - 1; index += 1) {
      var point = points[index];
      var next = points[index + 1];
      var midpointX = (point.x + next.x) / 2;
      var midpointY = (point.y + next.y) / 2;

      path +=
        ' Q ' +
        roundCoordinate(point.x) +
        ' ' +
        roundCoordinate(point.y) +
        ' ' +
        roundCoordinate(midpointX) +
        ' ' +
        roundCoordinate(midpointY);
    }

    var last = points[points.length - 1];
    path += ' L ' + roundCoordinate(last.x) + ' ' + roundCoordinate(last.y);
    return path;
  }

  function updateGradient(gradient, points) {
    if (points.length < 2) return;

    var first = points[0];
    var last = points[points.length - 1];
    gradient.setAttribute('x1', first.x);
    gradient.setAttribute('y1', first.y);
    gradient.setAttribute('x2', last.x);
    gradient.setAttribute('y2', last.y);
  }

  function updatePath(paths, gradient, points) {
    var pathData = buildPath(points);

    paths.forEach(function (path) {
      if (pathData) {
        path.setAttribute('d', pathData);
      } else {
        path.removeAttribute('d');
      }
    });

    updateGradient(gradient, points);
  }

  function updateTrailGeometry() {
    updatePath(leftPaths, leftGradient, leftPoints);
    updatePath(rightPaths, rightGradient, rightPoints);
  }

  function trimTrail(time) {
    while (leftPoints.length && time - leftPoints[0].time > trailLifetime) {
      leftPoints.shift();
      rightPoints.shift();
    }
  }

  function appendTrailPoint(time) {
    var leftPoint = {
      x: currentX + normalX * discRadius,
      y: currentY + normalY * discRadius,
      time: time
    };
    var rightPoint = {
      x: currentX - normalX * discRadius,
      y: currentY - normalY * discRadius,
      time: time
    };
    var sampleDistance = Math.hypot(
      currentX - lastSampleX,
      currentY - lastSampleY
    );

    if (leftPoints.length && sampleDistance < 1.4) {
      leftPoints[leftPoints.length - 1] = leftPoint;
      rightPoints[rightPoints.length - 1] = rightPoint;
    } else {
      leftPoints.push(leftPoint);
      rightPoints.push(rightPoint);
    }

    while (leftPoints.length > maxTrailPoints) {
      leftPoints.shift();
      rightPoints.shift();
    }

    lastSampleX = currentX;
    lastSampleY = currentY;
  }

  function updateNormal(moveX, moveY, speed) {
    var nextNormalX = -moveY / speed;
    var nextNormalY = moveX / speed;

    if (!normalReady) {
      normalX = nextNormalX;
      normalY = nextNormalY;
      normalReady = true;
      return;
    }

    if (nextNormalX * normalX + nextNormalY * normalY < 0) {
      nextNormalX *= -1;
      nextNormalY *= -1;
    }

    var normalFollow = Math.min(0.48, 0.2 + speed * 0.018);
    normalX += (nextNormalX - normalX) * normalFollow;
    normalY += (nextNormalY - normalY) * normalFollow;

    var normalLength = Math.hypot(normalX, normalY) || 1;
    normalX /= normalLength;
    normalY /= normalLength;
  }

  function render(time) {
    animationFrame = 0;
    var elapsed = lastFrameTime ? Math.min(32, time - lastFrameTime) : 16;
    lastFrameTime = time;
    var previousX = currentX;
    var previousY = currentY;

    if (activeSurface) {
      var follow = 1 - Math.exp(-elapsed / 56);
      currentX += (targetX - currentX) * follow;
      currentY += (targetY - currentY) * follow;

      if (
        Math.abs(targetX - currentX) < 0.03 &&
        Math.abs(targetY - currentY) < 0.03
      ) {
        currentX = targetX;
        currentY = targetY;
      }

      var moveX = currentX - previousX;
      var moveY = currentY - previousY;
      var speed = Math.hypot(moveX, moveY);

      if (speed > 0.04) {
        updateNormal(moveX, moveY, speed);
        appendTrailPoint(time);
      }

      positionDisc();
    }

    trimTrail(time);
    updateTrailGeometry();

    var distanceToTarget = Math.hypot(
      targetX - currentX,
      targetY - currentY
    );
    if (
      (activeSurface && distanceToTarget > 0.04) ||
      leftPoints.length > 0
    ) {
      animationFrame = window.requestAnimationFrame(render);
    } else {
      lastFrameTime = 0;
    }
  }

  function ensureAnimation() {
    if (!animationFrame) {
      animationFrame = window.requestAnimationFrame(render);
    }
  }

  function refreshSurface() {
    if (!enabled || !hasPointer) {
      deactivate();
      return;
    }

    setSurface(
      findSurface(document.elementFromPoint(targetX, targetY))
    );
  }

  function syncAvailability() {
    enabled = pointerQuery.matches && !motionQuery.matches;
    if (!enabled) deactivate();
  }

  function listenForMediaChange(query) {
    if (query.addEventListener) {
      query.addEventListener('change', syncAvailability);
    } else {
      query.addListener(syncAvailability);
    }
  }

  document.addEventListener(
    'pointermove',
    function (event) {
      if (event.pointerType && event.pointerType !== 'mouse') return;

      hasPointer = true;
      targetX = event.clientX;
      targetY = event.clientY;
      setSurface(findSurface(event.target));
    },
    { passive: true }
  );

  window.addEventListener(
    'scroll',
    function () {
      if (activeSurface) refreshSurface();
    },
    { capture: true, passive: true }
  );
  window.addEventListener('resize', refreshSurface, { passive: true });
  window.addEventListener('blur', deactivate);
  window.addEventListener('pointerout', function (event) {
    if (!event.relatedTarget) deactivate();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) deactivate();
  });
  document.addEventListener('swup:visit:start', deactivate);

  listenForMediaChange(pointerQuery);
  listenForMediaChange(motionQuery);
  syncAvailability();

  window.krosaGlassCursor = {
    hide: deactivate,
    refresh: refreshSurface
  };
})();

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
  var headNormalX = 0;
  var headNormalY = 1;
  var headNormalReady = false;
  var lastSampleX = Number.NaN;
  var lastSampleY = Number.NaN;
  var lastFrameTime = 0;
  var animationFrame = 0;
  var trailPoints = [];

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

  function clearTrail() {
    trailPoints = [];
    headNormalReady = false;
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
    if (!enabled) {
      deactivate();
      return;
    }

    var wasActive = Boolean(activeSurface);
    activeSurface = surface || document.documentElement;
    layer.classList.toggle('is-over-glass', Boolean(surface));

    if (!wasActive) {
      clearTrail();
      currentX = targetX;
      currentY = targetY;
      positionDisc();
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

  function calculateNormal(points, index) {
    var previous = points[Math.max(0, index - 1)];
    var next = points[Math.min(points.length - 1, index + 1)];
    var tangentX = next.x - previous.x;
    var tangentY = next.y - previous.y;
    var tangentLength = Math.hypot(tangentX, tangentY) || 1;

    return {
      x: -tangentY / tangentLength,
      y: tangentX / tangentLength
    };
  }

  function constrainNormal(normal, nextNormal, distance) {
    if (normal.x * nextNormal.x + normal.y * nextNormal.y < 0) {
      normal = { x: -normal.x, y: -normal.y };
    }

    var normalDot = Math.max(
      -1,
      Math.min(1, nextNormal.x * normal.x + nextNormal.y * normal.y)
    );
    var normalCross =
      nextNormal.x * normal.y - nextNormal.y * normal.x;
    var turn = Math.atan2(normalCross, normalDot);
    var safeTurn = Math.asin(
      Math.min(1, distance / (discRadius * 1.08))
    );

    turn = Math.max(-safeTurn, Math.min(safeTurn, turn));

    var turnCos = Math.cos(turn);
    var turnSin = Math.sin(turn);

    return {
      x: nextNormal.x * turnCos - nextNormal.y * turnSin,
      y: nextNormal.x * turnSin + nextNormal.y * turnCos
    };
  }

  function buildOffsetPoints(points) {
    var count = points.length;
    var normals = new Array(count);
    var left = new Array(count);
    var right = new Array(count);

    if (count < 2) {
      return { left: [], right: [] };
    }

    for (var index = 0; index < count; index += 1) {
      normals[index] = calculateNormal(points, index);
    }

    var headNormal = normals[count - 1];

    if (
      headNormalReady &&
      headNormal.x * headNormalX + headNormal.y * headNormalY < 0
    ) {
      headNormal = { x: -headNormal.x, y: -headNormal.y };
    }

    normals[count - 1] = headNormal;
    headNormalX = headNormal.x;
    headNormalY = headNormal.y;
    headNormalReady = true;

    for (var normalIndex = count - 2; normalIndex >= 0; normalIndex -= 1) {
      var point = points[normalIndex];
      var nextPoint = points[normalIndex + 1];
      var distance = Math.hypot(
        nextPoint.x - point.x,
        nextPoint.y - point.y
      );

      normals[normalIndex] = constrainNormal(
        normals[normalIndex],
        normals[normalIndex + 1],
        distance
      );
    }

    for (var pointIndex = 0; pointIndex < count; pointIndex += 1) {
      var trailPoint = points[pointIndex];
      var trailNormal = normals[pointIndex];

      left[pointIndex] = {
        x: trailPoint.x + trailNormal.x * discRadius,
        y: trailPoint.y + trailNormal.y * discRadius
      };
      right[pointIndex] = {
        x: trailPoint.x - trailNormal.x * discRadius,
        y: trailPoint.y - trailNormal.y * discRadius
      };
    }

    return { left: left, right: right };
  }

  function updateTrailGeometry() {
    var offsetPoints = buildOffsetPoints(trailPoints);

    updatePath(leftPaths, leftGradient, offsetPoints.left);
    updatePath(rightPaths, rightGradient, offsetPoints.right);
  }

  function trimTrail(time) {
    while (
      trailPoints.length &&
      time - trailPoints[0].time > trailLifetime
    ) {
      trailPoints.shift();
    }

    if (!trailPoints.length) {
      headNormalReady = false;
    }
  }

  function appendTrailPoint(time) {
    var point = {
      x: currentX,
      y: currentY,
      time: time
    };
    var sampleDistance = Math.hypot(
      currentX - lastSampleX,
      currentY - lastSampleY
    );

    if (trailPoints.length && sampleDistance < 1.4) {
      trailPoints[trailPoints.length - 1] = point;
    } else {
      trailPoints.push(point);
    }

    while (trailPoints.length > maxTrailPoints) {
      trailPoints.shift();
    }

    lastSampleX = currentX;
    lastSampleY = currentY;
  }

  function render(time) {
    animationFrame = 0;
    var elapsed = lastFrameTime ? Math.min(32, time - lastFrameTime) : 16;
    lastFrameTime = time;
    var previousX = currentX;
    var previousY = currentY;

    if (activeSurface) {
      var targetDistance = Math.hypot(
        targetX - currentX,
        targetY - currentY
      );
      var followTime = Math.max(30, 56 - targetDistance * 0.22);
      var follow = 1 - Math.exp(-elapsed / followTime);
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
      trailPoints.length > 0
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

  function preserveDuringNavigation() {
    if (!enabled || !hasPointer) return;

    activeSurface = document.documentElement;
    layer.classList.remove('is-over-glass');
    layer.classList.add('is-active');
    ensureAnimation();
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
  document.addEventListener('swup:visit:start', preserveDuringNavigation);
  document.addEventListener('swup:page:view', function () {
    window.requestAnimationFrame(refreshSurface);
  });

  listenForMediaChange(pointerQuery);
  listenForMediaChange(motionQuery);
  syncAvailability();

  window.krosaGlassCursor = {
    hide: deactivate,
    refresh: refreshSurface
  };
})();

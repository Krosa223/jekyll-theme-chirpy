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
  var clickBurstDelay = 34;
  var clickBurstDuration = 620;
  var maxClickBursts = 6;
  var maxClickRipples = 5;
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
  var clickBursts = [];
  var clickRipples = [];

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
    '<canvas class="glass-click-bursts"></canvas>',
    '<div class="glass-cursor-disc"></div>'
  ].join('');
  document.body.appendChild(layer);

  var disc = layer.querySelector('.glass-cursor-disc');
  var clickCanvas = layer.querySelector('.glass-click-bursts');
  var clickContext = clickCanvas && clickCanvas.getContext('2d');
  var clickCanvasWidth = 0;
  var clickCanvasHeight = 0;
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

  function resizeClickCanvas() {
    if (!clickContext) return;

    var dpr = Math.min(1.25, window.devicePixelRatio || 1);
    clickCanvasWidth = window.innerWidth;
    clickCanvasHeight = window.innerHeight;
    clickCanvas.width = Math.round(clickCanvasWidth * dpr);
    clickCanvas.height = Math.round(clickCanvasHeight * dpr);
    clickContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function removeClickRipple(ripple) {
    var index = clickRipples.indexOf(ripple);

    if (index !== -1) {
      clickRipples.splice(index, 1);
    }

    ripple.remove();
  }

  function createGlassRipple(x, y) {
    var ripple = document.createElement('div');
    ripple.className = 'glass-click-ripple';
    ripple.style.transform =
      'translate3d(' + roundCoordinate(x) + 'px, ' +
      roundCoordinate(y) + 'px, 0)';
    ripple.innerHTML = [
      '<span class="glass-click-wave glass-click-wave-primary"></span>',
      '<span class="glass-click-wave glass-click-wave-secondary"></span>'
    ].join('');

    layer.appendChild(ripple);
    clickRipples.push(ripple);

    while (clickRipples.length > maxClickRipples) {
      removeClickRipple(clickRipples[0]);
    }

    var finalWave = ripple.querySelector('.glass-click-wave-secondary');
    finalWave.addEventListener(
      'animationend',
      function () {
        removeClickRipple(ripple);
      },
      { once: true }
    );

    window.setTimeout(function () {
      removeClickRipple(ripple);
    }, 900);
  }

  function createBurstFragments(direction) {
    var fragments = [];
    var side = Math.random() < 0.5 ? -1 : 1;
    var offsets = [-side * 0.14, side * 0.42, side * 0.96];

    for (var index = 0; index < offsets.length; index += 1) {
      fragments.push({
        angle: direction + offsets[index] + (Math.random() - 0.5) * 0.2,
        curve: side * (2.5 + Math.random() * 4.5),
        delay: 0.07 + index * 0.025 + Math.random() * 0.025,
        distance: 29 + index * 7 + Math.random() * 10,
        length: 5.5 + Math.random() * 3.8,
        width: 2.6 + Math.random() * 1.8,
        spin: side * (0.28 + Math.random() * 0.62) * (index === 1 ? -1 : 1),
        colorIndex: index
      });
    }

    return fragments;
  }

  function queueClickBurst(x, y) {
    if (!clickContext) return;

    var rotation = Math.random() * Math.PI * 2;
    var spinDirection = Math.random() < 0.5 ? -1 : 1;

    clickBursts.push({
      x: x,
      y: y,
      startTime: null,
      rotation: rotation,
      spinDirection: spinDirection,
      fragments: createBurstFragments(rotation + spinDirection * 0.5)
    });

    while (clickBursts.length > maxClickBursts) {
      clickBursts.shift();
    }
  }

  function easeOutCubic(progress) {
    return 1 - Math.pow(1 - progress, 3);
  }

  function clampProgress(progress) {
    return Math.max(0, Math.min(1, progress));
  }

  function drawClickGlow(context, progress, eased) {
    var opacity = Math.pow(1 - progress, 1.6);
    var radius = 9 + eased * 14;
    var glow = context.createRadialGradient(0, 0, 0, 0, 0, radius);

    glow.addColorStop(0, 'rgba(142, 225, 255, ' + 0.22 * opacity + ')');
    glow.addColorStop(
      0.48,
      'rgba(76, 167, 255, ' + 0.12 * opacity + ')'
    );
    glow.addColorStop(1, 'rgba(43, 135, 235, 0)');

    context.fillStyle = glow;
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fill();
  }

  function drawGrowingArc(
    context,
    radius,
    startAngle,
    arcLength,
    lineWidth,
    opacity,
    color
  ) {
    var segmentCount = Math.max(
      3,
      Math.ceil(Math.abs(arcLength) / 0.22)
    );
    var step = arcLength / segmentCount;
    var gap = Math.min(Math.abs(step) * 0.2, 0.028);
    var direction = step < 0 ? -1 : 1;

    context.lineCap = 'round';
    context.shadowColor = 'rgba(63, 172, 255, ' + 0.58 * opacity + ')';
    context.shadowBlur = 7 * opacity;

    for (var index = 0; index < segmentCount; index += 1) {
      var tailProgress = (index + 1) / segmentCount;
      var segmentStart = startAngle + step * index;
      var segmentEnd = segmentStart + step - gap * direction;
      var segmentOpacity =
        opacity * (0.1 + Math.pow(tailProgress, 1.55) * 0.9);

      context.lineWidth = lineWidth * (0.7 + tailProgress * 0.3);
      context.strokeStyle =
        'rgba(' +
        color[0] +
        ', ' +
        color[1] +
        ', ' +
        color[2] +
        ', ' +
        segmentOpacity +
        ')';
      context.beginPath();
      context.arc(
        0,
        0,
        radius,
        segmentStart,
        segmentEnd,
        direction < 0
      );
      context.stroke();
    }
  }

  function drawClickRings(context, burst, progress, eased) {
    var growth = easeOutCubic(clampProgress(progress / 0.68));
    var secondaryGrowth = easeOutCubic(
      clampProgress((progress - 0.08) / 0.72)
    );
    var fade =
      progress < 0.52
        ? 1
        : Math.pow(1 - clampProgress((progress - 0.52) / 0.48), 1.25);
    var radius = 22 + eased * 21;
    var direction = burst.spinDirection;
    var rotation =
      burst.rotation + direction * (0.2 + eased * 2.45);
    var primaryLength = direction * (0.16 + growth * 4.18);
    var secondaryLength =
      -direction * (0.1 + secondaryGrowth * 2.08);

    drawGrowingArc(
      context,
      radius,
      rotation,
      primaryLength,
      1.3 + (1 - progress) * 0.85,
      fade * 0.92,
      [76, 167, 255]
    );
    drawGrowingArc(
      context,
      radius * 0.76,
      rotation + direction * 2.72,
      secondaryLength,
      0.85 + (1 - progress) * 0.42,
      fade * 0.72,
      [108, 217, 255]
    );
  }

  function drawClickFragments(context, burst, progress) {
    var fragmentColors = [
      [76, 167, 255],
      [105, 214, 255],
      [42, 132, 231]
    ];

    burst.fragments.forEach(function (fragment) {
      var fragmentProgress = clampProgress(
        (progress - fragment.delay) / (1 - fragment.delay)
      );

      if (!fragmentProgress) return;

      var eased = easeOutCubic(fragmentProgress);
      var fadeIn = clampProgress(fragmentProgress / 0.12);
      var opacity = fadeIn * Math.pow(1 - fragmentProgress, 1.08) * 0.9;
      var distance = 11 + fragment.distance * eased;
      var curve = fragment.curve * Math.sin(Math.PI * fragmentProgress);
      var normalX = -Math.sin(fragment.angle);
      var normalY = Math.cos(fragment.angle);
      var x = Math.cos(fragment.angle) * distance + normalX * curve;
      var y = Math.sin(fragment.angle) * distance + normalY * curve;
      var color = fragmentColors[fragment.colorIndex % fragmentColors.length];

      context.save();
      context.translate(x, y);
      context.rotate(fragment.angle + fragment.spin * eased);
      context.fillStyle =
        'rgba(' +
        color[0] +
        ', ' +
        color[1] +
        ', ' +
        color[2] +
        ', ' +
        opacity +
        ')';
      context.strokeStyle = 'rgba(204, 244, 255, ' + 0.62 * opacity + ')';
      context.lineWidth = 0.65;
      context.lineJoin = 'round';
      context.shadowColor = 'rgba(65, 176, 255, ' + 0.72 * opacity + ')';
      context.shadowBlur = 6 * opacity;
      context.beginPath();
      context.moveTo(fragment.length, 0);
      context.lineTo(-fragment.length * 0.52, -fragment.width);
      context.lineTo(-fragment.length * 0.16, fragment.width * 0.62);
      context.closePath();
      context.fill();
      context.stroke();
      context.restore();
    });
  }

  function drawClickBurst(context, burst, progress) {
    var eased = easeOutCubic(progress);

    context.save();
    context.translate(burst.x, burst.y);
    context.globalCompositeOperation = 'source-over';
    drawClickGlow(context, progress, eased);
    drawClickRings(context, burst, progress, eased);
    drawClickFragments(context, burst, progress);
    context.restore();
  }

  function drawClickBursts(time) {
    if (!clickContext) return false;

    clickContext.clearRect(0, 0, clickCanvasWidth, clickCanvasHeight);

    clickBursts = clickBursts.filter(function (burst) {
      if (burst.startTime === null) {
        burst.startTime = time + clickBurstDelay;
      }

      if (time < burst.startTime) return true;

      var progress = (time - burst.startTime) / clickBurstDuration;

      if (progress >= 1) return false;

      drawClickBurst(clickContext, burst, Math.max(0, progress));
      return true;
    });

    return clickBursts.length > 0;
  }

  function clearClickEffects() {
    clickBursts = [];
    clickRipples.slice().forEach(removeClickRipple);

    if (clickContext) {
      clickContext.clearRect(0, 0, clickCanvasWidth, clickCanvasHeight);
    }
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
    var hasClickBursts = drawClickBursts(time);

    var distanceToTarget = Math.hypot(
      targetX - currentX,
      targetY - currentY
    );
    if (
      (activeSurface && distanceToTarget > 0.04) ||
      trailPoints.length > 0 ||
      hasClickBursts
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
    if (!enabled) {
      clearClickEffects();
      deactivate();
    }
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

  document.addEventListener(
    'pointerdown',
    function (event) {
      if (
        !enabled ||
        event.button !== 0 ||
        (event.pointerType && event.pointerType !== 'mouse')
      ) {
        return;
      }

      targetX = event.clientX;
      targetY = event.clientY;
      setSurface(findSurface(event.target));
      createGlassRipple(event.clientX, event.clientY);
      queueClickBurst(event.clientX, event.clientY);
      ensureAnimation();
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
  window.addEventListener(
    'resize',
    function () {
      resizeClickCanvas();
      refreshSurface();
    },
    { passive: true }
  );
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
  resizeClickCanvas();
  syncAvailability();

  window.krosaGlassCursor = {
    hide: deactivate,
    refresh: refreshSurface
  };
})();

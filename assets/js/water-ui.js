(function () {
  'use strict';

  if (window.krosaWaterUI) {
    window.krosaWaterUI.refresh();
    return;
  }

  var buttonSelector = [
    '#sidebar-trigger',
    '#search-trigger',
    '#mode-toggle',
    '#wallpaper-toggle'
  ].join(',');
  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var pointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
  var wrapper = null;
  var canvas = null;
  var context = null;
  var resizeObserver = null;
  var animationFrame = 0;
  var width = 0;
  var height = 0;
  var pointCount = 0;
  var displacement = [];
  var velocity = [];
  var acceleration = [];
  var lastPointerX = Number.NaN;
  var lastPointerY = Number.NaN;
  var lastPointerTime = 0;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function resetPointer() {
    lastPointerX = Number.NaN;
    lastPointerY = Number.NaN;
    lastPointerTime = 0;
  }

  function createPoints(nextCount) {
    pointCount = nextCount;
    displacement = Array(pointCount).fill(0);
    velocity = Array(pointCount).fill(0);
    acceleration = Array(pointCount).fill(0);
  }

  function traceSurface() {
    var step = width / Math.max(1, pointCount - 1);
    var waterline = height * 0.62;
    var index;

    context.beginPath();
    context.moveTo(0, waterline + displacement[0]);

    for (index = 1; index < pointCount - 1; index += 1) {
      var controlX = index * step;
      var controlY = waterline + displacement[index];
      var nextX = (index + 0.5) * step;
      var nextY =
        waterline + (displacement[index] + displacement[index + 1]) / 2;

      context.quadraticCurveTo(controlX, controlY, nextX, nextY);
    }

    context.lineTo(
      width,
      waterline + displacement[Math.max(0, pointCount - 1)]
    );
  }

  function drawWater() {
    if (!context || !width || !height || pointCount < 2) return;

    context.clearRect(0, 0, width, height);

    traceSurface();
    context.lineTo(width, height);
    context.lineTo(0, height);
    context.closePath();

    var fill = context.createLinearGradient(0, height * 0.48, 0, height);
    fill.addColorStop(0, 'rgba(203, 247, 255, 0.12)');
    fill.addColorStop(0.18, 'rgba(102, 210, 231, 0.17)');
    fill.addColorStop(1, 'rgba(48, 157, 190, 0.24)');
    context.fillStyle = fill;
    context.fill();

    traceSurface();
    context.lineWidth = 3;
    context.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    context.stroke();

    traceSurface();
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(92, 204, 226, 0.72)';
    context.stroke();
  }

  function stepWater() {
    var index;
    var energy = 0;
    var spring = 0.048;
    var spread = 0.17;
    var damping = 0.925;

    for (index = 0; index < pointCount; index += 1) {
      var left = displacement[Math.max(0, index - 1)];
      var right = displacement[Math.min(pointCount - 1, index + 1)];
      var wave = left + right - displacement[index] * 2;

      acceleration[index] = -spring * displacement[index] + spread * wave;
    }

    for (index = 0; index < pointCount; index += 1) {
      velocity[index] = (velocity[index] + acceleration[index]) * damping;
      displacement[index] += velocity[index];
      energy = Math.max(
        energy,
        Math.abs(displacement[index]),
        Math.abs(velocity[index])
      );
    }

    drawWater();

    if (energy > 0.018 && !motionQuery.matches) {
      animationFrame = window.requestAnimationFrame(stepWater);
      return;
    }

    for (index = 0; index < pointCount; index += 1) {
      displacement[index] = 0;
      velocity[index] = 0;
    }

    animationFrame = 0;
    drawWater();
  }

  function startWater() {
    if (!animationFrame && !motionQuery.matches) {
      animationFrame = window.requestAnimationFrame(stepWater);
    }
  }

  function disturbWater(event) {
    if (
      !wrapper ||
      !pointerQuery.matches ||
      motionQuery.matches ||
      pointCount < 2
    ) {
      return;
    }

    var bounds = wrapper.getBoundingClientRect();
    var pointerX = clamp(event.clientX - bounds.left, 0, bounds.width);
    var pointerY = clamp(event.clientY - bounds.top, 0, bounds.height);
    var now = window.performance.now();

    if (!Number.isNaN(lastPointerX) && now - lastPointerTime >= 10) {
      var deltaX = pointerX - lastPointerX;
      var deltaY = pointerY - lastPointerY;
      var elapsed = Math.max(10, now - lastPointerTime);
      var speed = Math.sqrt(deltaX * deltaX + deltaY * deltaY) / elapsed;
      var proximity =
        1 - clamp(Math.abs(pointerY - height * 0.62) / (height * 0.7), 0, 1);
      var strength = clamp(1.5 + speed * 2.1, 1.5, 6.2);
      var direction = Math.abs(deltaY) > 0.35 ? Math.sign(deltaY) : 1;
      var center = Math.round((pointerX / Math.max(1, width)) * (pointCount - 1));
      var offset;

      strength *= 0.45 + proximity * 0.55;

      for (offset = -3; offset <= 3; offset += 1) {
        var point = clamp(center + offset, 0, pointCount - 1);
        var weight = 1 - Math.abs(offset) / 4;
        velocity[point] += strength * weight * direction;
      }

      velocity[clamp(center - 5, 0, pointCount - 1)] -= strength * 0.28;
      velocity[clamp(center + 5, 0, pointCount - 1)] -= strength * 0.28;
      startWater();
    }

    lastPointerX = pointerX;
    lastPointerY = pointerY;
    lastPointerTime = now;
  }

  function resizeCanvas() {
    if (!wrapper || !canvas || !context) return;

    var bounds = wrapper.getBoundingClientRect();
    var pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    var nextWidth = Math.max(1, Math.round(bounds.width));
    var nextHeight = Math.max(1, Math.round(bounds.height));
    var nextCount = clamp(Math.round(nextWidth / 16), 48, 96);

    width = nextWidth;
    height = nextHeight;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    if (pointCount !== nextCount) createPoints(nextCount);
    resetPointer();
    drawWater();
  }

  function preparePoolButtons() {
    document.querySelectorAll(buttonSelector).forEach(function (button) {
      button.classList.add('water-pool-button');
    });
  }

  function removeRipple(ripple) {
    if (ripple && ripple.parentNode) ripple.parentNode.removeChild(ripple);
  }

  function createRipple(event) {
    var target = event.target;
    var button = target && target.closest ? target.closest(buttonSelector) : null;

    if (!button || motionQuery.matches) return;

    button.classList.add('water-pool-button');

    var bounds = button.getBoundingClientRect();
    var ripple = document.createElement('span');
    ripple.className = 'water-pool-ripple';
    ripple.setAttribute('aria-hidden', 'true');
    ripple.style.setProperty(
      '--water-ripple-x',
      event.clientX - bounds.left + 'px'
    );
    ripple.style.setProperty(
      '--water-ripple-y',
      event.clientY - bounds.top + 'px'
    );
    ripple.addEventListener(
      'animationend',
      function () {
        removeRipple(ripple);
      },
      { once: true }
    );
    button.appendChild(ripple);
    window.setTimeout(function () {
      removeRipple(ripple);
    }, 850);
  }

  function unmountTopbar() {
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }

    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }

    if (wrapper) {
      wrapper.removeEventListener('pointermove', disturbWater);
      wrapper.removeEventListener('pointerleave', resetPointer);
      wrapper.classList.remove('has-water-reservoir');
    }

    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    wrapper = null;
    canvas = null;
    context = null;
    resetPointer();
  }

  function mountTopbar() {
    var nextWrapper = document.getElementById('topbar-wrapper');

    preparePoolButtons();

    if (!nextWrapper) {
      unmountTopbar();
      return;
    }

    if (nextWrapper === wrapper && canvas && canvas.isConnected) {
      resizeCanvas();
      return;
    }

    unmountTopbar();
    wrapper = nextWrapper;
    wrapper.classList.add('has-water-reservoir');
    canvas = document.createElement('canvas');
    canvas.className = 'topbar-water-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    wrapper.prepend(canvas);
    context = canvas.getContext('2d');

    if (!context) {
      unmountTopbar();
      return;
    }

    wrapper.addEventListener('pointermove', disturbWater, { passive: true });
    wrapper.addEventListener('pointerleave', resetPointer, { passive: true });

    if ('ResizeObserver' in window) {
      resizeObserver = new window.ResizeObserver(resizeCanvas);
      resizeObserver.observe(wrapper);
    }

    resizeCanvas();
  }

  function handleMotionPreference() {
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }

    createPoints(pointCount || 48);
    drawWater();
  }

  function destroy() {
    unmountTopbar();
    document.removeEventListener('pointerdown', createRipple);
    document.removeEventListener('swup:page:view', mountTopbar);
    window.removeEventListener('resize', resizeCanvas);

    if (motionQuery.removeEventListener) {
      motionQuery.removeEventListener('change', handleMotionPreference);
    } else {
      motionQuery.removeListener(handleMotionPreference);
    }

    delete window.krosaWaterUI;
  }

  document.addEventListener('pointerdown', createRipple, { passive: true });
  document.addEventListener('swup:page:view', function () {
    window.requestAnimationFrame(mountTopbar);
  });

  if (!('ResizeObserver' in window)) {
    window.addEventListener('resize', resizeCanvas, { passive: true });
  }

  if (motionQuery.addEventListener) {
    motionQuery.addEventListener('change', handleMotionPreference);
  } else {
    motionQuery.addListener(handleMotionPreference);
  }

  window.krosaWaterUI = {
    refresh: mountTopbar,
    destroy: destroy
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountTopbar, { once: true });
  } else {
    mountTopbar();
  }
})();

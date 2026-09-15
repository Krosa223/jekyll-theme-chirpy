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
  var pointerVelocityX = 0;
  var pointerVelocityY = 0;
  var waterTime = 0;
  var lastFrameTime = 0;
  var lastDrawTime = 0;
  var drawInterval = 1000 / 30; // Canvas only redraws at ~30 FPS.
  var transitionPaused = false;

  // Cursor / splash physics. The main water remains a very cheap 1-D height
  // field; only detached spray is particle based.
  var wrapperLeft = 0;
  var wrapperTop = 0;
  var splashParticles = [];
  var maxSplashParticles = 84;
  var lastSplashTime = 0;
  var lastColliderX = Number.NaN;
  var lastColliderY = Number.NaN;

  var duck = {
    x: 0, speed: 0, left: 20, right: 20, visible: false,
    heave: 0, heaveSpeed: 0
  };
  var boat = {
    x: 0, speed: 0, visible: false,
    heave: 0, heaveSpeed: 0
  };

  function disturbanceAt(x) {
    var p = clamp(x / Math.max(1, width) * (pointCount - 1), 0, pointCount - 1);
    var i = Math.floor(p);
    return displacement[i] * (1 - (p - i)) +
      displacement[Math.min(i + 1, pointCount - 1)] * (p - i);
  }

  function ambientWaveAt(x) {
    if (motionQuery.matches || !width) return 0;

    // Three low-amplitude waves with different wavelengths/speeds.
    // The sum is intentionally subtle so the topbar still feels like glass,
    // not like a cartoon ocean.
    return (
      Math.sin(x * 0.010 - waterTime * 0.82) * 2.75 +
      Math.sin(x * 0.021 + waterTime * 0.52 + 1.4) * 1.25 +
      Math.sin(x * 0.0056 - waterTime * 0.24 + 2.2) * 0.62
    );
  }

  function surfaceAt(x) {
    return disturbanceAt(x) + ambientWaveAt(x);
  }

  function drawWake(x, speed, size) {
    if (Math.abs(speed) < 0.055) return;

    var direction = speed > 0 ? -1 : 1;
    var waterline = height * 0.62 + surfaceAt(x);
    var strength = clamp(Math.abs(speed) / 0.45, 0, 1);

    context.save();
    context.lineCap = 'round';
    context.lineWidth = 0.8;
    context.strokeStyle = 'rgba(226, 252, 255, ' + (0.12 + strength * 0.14) + ')';

    for (var wakeIndex = 0; wakeIndex < 2; wakeIndex += 1) {
      var distance = size + 5 + wakeIndex * 8;
      context.beginPath();
      context.moveTo(x + direction * (size * 0.45), waterline + 1.2 + wakeIndex * 0.8);
      context.quadraticCurveTo(
        x + direction * distance,
        waterline + 2.8 + wakeIndex,
        x + direction * (distance + 8),
        waterline + 1.1 + wakeIndex * 0.8
      );
      context.stroke();
    }
    context.restore();
  }


  function drawBuoyancyRipple(x, heaveSpeed, size) {
    var motion = Math.abs(heaveSpeed);
    if (motion < 0.010) return;

    var waterline = height * 0.62 + surfaceAt(x);
    var strength = clamp(motion / 0.20, 0, 1);
    var spread = size * (0.75 + strength * 0.30);

    context.save();
    context.lineCap = 'round';
    context.lineWidth = 0.65 + strength * 0.25;
    context.strokeStyle = 'rgba(231, 252, 255, ' + (0.08 + strength * 0.14) + ')';

    context.beginPath();
    context.moveTo(x - size * 0.42, waterline + 1.2);
    context.quadraticCurveTo(
      x - spread,
      waterline + 2.1 + strength * 1.1,
      x - spread - 5,
      waterline + 1.35
    );
    context.stroke();

    context.beginPath();
    context.moveTo(x + size * 0.42, waterline + 1.2);
    context.quadraticCurveTo(
      x + spread,
      waterline + 2.1 + strength * 1.1,
      x + spread + 5,
      waterline + 1.35
    );
    context.stroke();

    context.restore();
  }

  function cursorColliderState() {
    var cursor = window.krosaGlassCursor;

    if (!cursor || typeof cursor.getState !== 'function') return null;

    var state = cursor.getState();
    if (!state || !state.active) return null;

    return {
      x: state.x - wrapperLeft,
      y: state.y - wrapperTop,
      vx: Number.isFinite(state.vx) ? state.vx : 0,
      vy: Number.isFinite(state.vy) ? state.vy : 0,
      speed: Number.isFinite(state.speed) ? state.speed : 0,
      radius: clamp(Number.isFinite(state.radius) ? state.radius : 16, 10, 28)
    };
  }

  function addSurfaceImpulse(pointIndex, amount) {
    pointIndex = clamp(pointIndex, 0, pointCount - 1);
    velocity[pointIndex] = clamp(velocity[pointIndex] + amount, -4.8, 4.8);
  }

  function spawnSplash(x, y, vx, vy, intensity, direction, now) {
    if (now - lastSplashTime < 34) return;

    intensity = clamp(intensity, 0, 1);
    if (intensity < 0.13) return;

    lastSplashTime = now;

    var count = 1 + Math.floor(intensity * 6);
    var available = Math.max(0, maxSplashParticles - splashParticles.length);
    count = Math.min(count, available);

    for (var index = 0; index < count; index += 1) {
      var side = Math.random() * 2 - 1;
      var inheritedX = vx * (0.055 + Math.random() * 0.045);
      var outwardX =
        direction * (34 + Math.random() * 68) * (0.42 + intensity * 0.58);

      splashParticles.push({
        x: x + side * (3 + Math.random() * 8),
        y: y - 1 - Math.random() * 3,
        vx: inheritedX + outwardX + side * (18 + Math.random() * 34),
        vy:
          -(
            52 +
            Math.random() * 82 +
            intensity * 90 +
            Math.max(0, vy) * 0.045
          ),
        age: 0,
        life: 0.34 + Math.random() * 0.28,
        size: Math.random() < 0.72 ? 2 : 3,
        alpha: 0.44 + Math.random() * 0.34
      });
    }
  }

  function applyCursorCollider(now) {
    if (!wrapper || pointCount < 2 || motionQuery.matches) return;

    var collider = cursorColliderState();

    // If the glass cursor module is not exposing state yet, keep the old
    // pointer fallback alive. Once getState() exists, this is the only force
    // path so the visible disc and the water cannot drift apart.
    if (!collider) {
      lastColliderX = Number.NaN;
      lastColliderY = Number.NaN;
      return;
    }

    var radius = collider.radius;
    if (
      collider.x < -radius ||
      collider.x > width + radius ||
      collider.y < -radius ||
      collider.y > height + radius
    ) {
      lastColliderX = collider.x;
      lastColliderY = collider.y;
      return;
    }

    var surfaceY = height * 0.62 + surfaceAt(collider.x);
    var signedDepth = collider.y - surfaceY;

    // Contact is strongest while the visible disc cuts through the interface.
    // Deep underwater / far above the surface fades out instead of pulling the
    // whole strip like rubber.
    var contactDistance = Math.abs(signedDepth);
    var contact = 1 - clamp(contactDistance / (radius * 1.28), 0, 1);
    contact = contact * contact * (3 - 2 * contact);

    if (contact <= 0.004) {
      lastColliderX = collider.x;
      lastColliderY = collider.y;
      return;
    }

    var step = width / Math.max(1, pointCount - 1);
    var center = Math.round(collider.x / Math.max(1, width) * (pointCount - 1));
    var radiusPoints = clamp(Math.ceil((radius * 1.75) / Math.max(1, step)), 2, 5);
    var speedRatio = clamp(collider.speed / 900, 0, 1);
    var horizontalRatio = clamp(Math.abs(collider.vx) / 850, 0, 1);
    var downwardRatio = clamp(Math.max(0, collider.vy) / 700, 0, 1);

    // The solid disc depresses the water locally. This is a target force rather
    // than a raw kick, so slow contact still has volume and does not feel like
    // a massless mouse pointer.
    var penetration = clamp((signedDepth + radius) / (radius * 2), 0, 1);
    var depressionTarget =
      contact * penetration * (2.5 + speedRatio * 4.5 + downwardRatio * 2.6);

    for (var offset = -radiusPoints; offset <= radiusPoints; offset += 1) {
      var point = clamp(center + offset, 0, pointCount - 1);
      var normalized = offset / Math.max(1, radiusPoints);
      var weight = Math.max(0, 1 - normalized * normalized);

      velocity[point] = clamp(
        velocity[point] +
          (depressionTarget * weight - displacement[point] * 0.035) * 0.13,
        -4.8,
        4.8
      );
    }

    // Sideways motion displaces volume: water piles up in front of the disc and
    // leaves a weaker trough behind it. Negative displacement is visually an
    // upward crest in this canvas coordinate system.
    var direction = collider.vx >= 0 ? 1 : -1;
    var front = center + direction * (radiusPoints + 2);
    var frontFar = center + direction * (radiusPoints + 4);
    var rear = center - direction * (radiusPoints + 2);
    var push = contact * (0.28 + horizontalRatio * 1.55 + speedRatio * 0.42);

    addSurfaceImpulse(front, -push);
    addSurfaceImpulse(frontFar, -push * 0.48);
    addSurfaceImpulse(rear, push * 0.34);

    // Vertical entry creates a paired crest rather than one jelly-like hump.
    if (Math.abs(collider.vy) > 85) {
      var verticalPush =
        contact * clamp(Math.abs(collider.vy) / 700, 0, 1) * 0.95;
      addSurfaceImpulse(center - radiusPoints - 1, -verticalPush);
      addSurfaceImpulse(center + radiusPoints + 1, -verticalPush);
    }

    var duckInfluence = Math.max(0, 1 - Math.abs(collider.x - duck.x) / 118);
    if (duck.visible && duckInfluence > 0) {
      duck.speed = clamp(
        duck.speed + collider.vx / 1000 * duckInfluence * contact * 0.19,
        -0.68,
        0.68
      );
    }

    var boatInfluence = Math.max(0, 1 - Math.abs(collider.x - boat.x) / 145);
    if (boat.visible && boatInfluence > 0) {
      boat.speed = clamp(
        boat.speed + collider.vx / 1000 * boatInfluence * contact * 0.14,
        -0.52,
        0.52
      );
    }

    // Only fast/meaningful contacts throw detached droplets.
    var splashIntensity =
      contact *
      clamp(speedRatio * 0.72 + downwardRatio * 0.54 + horizontalRatio * 0.42, 0, 1);

    spawnSplash(
      collider.x,
      surfaceY,
      collider.vx,
      collider.vy,
      splashIntensity,
      direction,
      now
    );

    lastColliderX = collider.x;
    lastColliderY = collider.y;
  }

  function updateSplashParticles(elapsed) {
    if (!splashParticles.length) return;

    var dt = clamp(elapsed / 1000, 0, 0.05);
    var gravity = 430;

    splashParticles = splashParticles.filter(function (particle) {
      particle.age += dt;
      if (particle.age >= particle.life) return false;

      particle.vx *= Math.pow(0.985, dt * 60);
      particle.vy += gravity * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;

      if (particle.x < -10 || particle.x > width + 10 || particle.y > height + 10) {
        return false;
      }

      // Re-entry: recycle the droplet and return a tiny amount of energy to
      // the height field. This makes splashes feel connected to the water.
      if (particle.age > 0.09 && particle.vy > 0) {
        var surfaceY = height * 0.62 + surfaceAt(particle.x);
        if (particle.y >= surfaceY) {
          var center = Math.round(
            clamp(particle.x, 0, width) / Math.max(1, width) * (pointCount - 1)
          );
          addSurfaceImpulse(center, clamp(particle.vy / 900, 0.025, 0.12));
          return false;
        }
      }

      return true;
    });
  }

  function drawSplashParticles() {
    if (!splashParticles.length) return;

    context.save();

    splashParticles.forEach(function (particle) {
      var progress = clamp(particle.age / particle.life, 0, 1);
      var alpha = particle.alpha * Math.pow(1 - progress, 0.7);
      var pixelSize = particle.size;

      // Deliberately snap to a 2 px grid and use fillRect: this keeps detached
      // spray cheap and gives the requested subtle pixel-particle look.
      var x = Math.round(particle.x / 2) * 2;
      var y = Math.round(particle.y / 2) * 2;

      context.fillStyle =
        'rgba(214, 248, 255, ' + alpha.toFixed(3) + ')';
      context.fillRect(x, y, pixelSize, pixelSize);

      if (pixelSize >= 3 && alpha > 0.25) {
        context.fillStyle =
          'rgba(255, 255, 255, ' + (alpha * 0.42).toFixed(3) + ')';
        context.fillRect(x, y, 1, 1);
      }
    });

    context.restore();
  }

  function drawBoat() {
    if (!boat.visible) return;
    var slope = (surfaceAt(boat.x + 12) - surfaceAt(boat.x - 12)) / 24;
    context.save();
    context.translate(boat.x, height * 0.62 + boat.heave);
    context.rotate(clamp(Math.atan(slope * 1.95), -0.40, 0.40));
    context.fillStyle = 'rgba(32, 127, 149, 0.16)';
    context.beginPath();
    context.ellipse(0, 3, 16, 2, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#a76a3e';
    context.beginPath();
    context.moveTo(-16, -3);
    context.lineTo(16, -3);
    context.lineTo(10, 3);
    context.lineTo(-10, 3);
    context.closePath();
    context.fill();
    context.strokeStyle = '#70472e';
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(-14, -2);
    context.lineTo(14, -2);
    context.moveTo(-1, -3);
    context.lineTo(-1, -24);
    context.stroke();
    context.fillStyle = '#fff5df';
    context.beginPath();
    context.moveTo(1, -23);
    context.quadraticCurveTo(6, -15, 13, -6);
    context.lineTo(1, -6);
    context.closePath();
    context.fill();
    context.fillStyle = '#d1e5e5';
    context.beginPath();
    context.moveTo(-3, -21);
    context.lineTo(-13, -6);
    context.lineTo(-3, -6);
    context.closePath();
    context.fill();
    context.restore();
  }

  function drawDuck() {
    if (!duck.visible) return;
    var slope = (surfaceAt(duck.x + 8) - surfaceAt(duck.x - 8)) / 16;
    context.save();
    context.translate(duck.x, height * 0.62 + duck.heave);
    context.rotate(clamp(Math.atan(slope * 2.10), -0.46, 0.46));
    context.fillStyle = 'rgba(32, 127, 149, 0.16)';
    context.beginPath();
    context.ellipse(0, 2, 12, 2.5, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#f5cb57';
    context.beginPath();
    context.ellipse(-1, -4, 10, 6, -0.12, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#ffe38a';
    context.beginPath();
    context.arc(6, -12, 5.5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#e89442';
    context.beginPath();
    context.moveTo(10, -12);
    context.lineTo(16, -10);
    context.lineTo(10, -8.5);
    context.fill();
    context.fillStyle = '#34332c';
    context.beginPath();
    context.arc(7.8, -13, 0.95, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#dcae42';
    context.lineWidth = 1;
    context.beginPath();
    context.ellipse(-3, -5, 4.5, 2.5, -0.2, 0.1, Math.PI);
    context.stroke();
    context.restore();
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function resetPointer() {
    lastPointerX = Number.NaN;
    lastPointerY = Number.NaN;
    lastPointerTime = 0;
    pointerVelocityX = 0;
    pointerVelocityY = 0;
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
    context.moveTo(0, waterline + surfaceAt(0));

    for (index = 1; index < pointCount - 1; index += 1) {
      var controlX = index * step;
      var controlY = waterline + surfaceAt(controlX);
      var nextX = (index + 0.5) * step;
      var nextY = waterline + surfaceAt(nextX);

      context.quadraticCurveTo(controlX, controlY, nextX, nextY);
    }

    context.lineTo(width, waterline + surfaceAt(width));
  }

  function traceWaterArea() {
    traceSurface();
    context.lineTo(width, height);
    context.lineTo(0, height);
    context.closePath();
  }

  function drawFlowBands() {
    var waterline = height * 0.62;
    var band;

    context.save();
    traceWaterArea();
    context.clip();
    context.lineCap = 'round';

    for (band = 0; band < 3; band += 1) {
      var baseY = waterline + 6 + band * 6.2;
      var amplitude = 0.8 + band * 0.32;
      var spatial = 0.020 + band * 0.006;
      var temporal = 0.58 + band * 0.23;
      var first = true;

      context.beginPath();
      for (var x = -20; x <= width + 20; x += 10) {
        var y = baseY +
          Math.sin(x * spatial - waterTime * temporal + band * 1.7) * amplitude +
          Math.sin(x * 0.008 + waterTime * 0.31 + band) * 0.45;

        if (first) {
          context.moveTo(x, y);
          first = false;
        } else {
          context.lineTo(x, y);
        }
      }

      context.lineWidth = band === 0 ? 1.05 : 0.7;
      context.strokeStyle = band === 0
        ? 'rgba(228, 251, 255, 0.15)'
        : 'rgba(117, 216, 235, 0.095)';
      context.stroke();
    }

    context.restore();
  }

  function drawForegroundWater() {
    var waterline = height * 0.62;
    traceWaterArea();

    // This thin transparent layer is drawn *after* the duck/boat. It only
    // covers the part below the current surface, which makes them look
    // partially submerged instead of pasted on top of the canvas.
    var foreground = context.createLinearGradient(0, waterline - 1, 0, waterline + 12);
    foreground.addColorStop(0, 'rgba(178, 239, 250, 0.18)');
    foreground.addColorStop(0.35, 'rgba(82, 190, 214, 0.105)');
    foreground.addColorStop(1, 'rgba(44, 145, 176, 0.045)');
    context.fillStyle = foreground;
    context.fill();
  }

  function drawSurfaceShimmer() {
    context.save();
    context.lineCap = 'round';

    // A soft highlight and a very thin blue edge look closer to light on
    // real water than the old moving dashed line.
    traceSurface();
    context.lineWidth = 1.8;
    context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    context.stroke();

    traceSurface();
    context.lineWidth = 0.65;
    context.strokeStyle = 'rgba(76, 188, 214, 0.46)';
    context.stroke();

    // Two faint specular streaks drift independently below the surface.
    var waterline = height * 0.62;
    for (var i = 0; i < 2; i += 1) {
      var span = 34 + i * 18;
      var cycle = width + span * 2;
      var center = ((waterTime * (12 + i * 5) + i * width * 0.41) % cycle) - span;
      var y = waterline + 4.5 + i * 4 + Math.sin(waterTime * 0.55 + i) * 0.35;

      context.beginPath();
      context.moveTo(center - span * 0.5, y);
      context.quadraticCurveTo(center, y - 0.55, center + span * 0.5, y);
      context.lineWidth = 0.7;
      context.strokeStyle = 'rgba(236, 253, 255, 0.10)';
      context.stroke();
    }

    context.restore();
  }

  function drawWater() {
    if (!context || !width || !height || pointCount < 2) return;

    context.clearRect(0, 0, width, height);

    traceWaterArea();

    var fill = context.createLinearGradient(0, height * 0.48, 0, height);
    fill.addColorStop(0, 'rgba(218, 249, 255, 0.10)');
    fill.addColorStop(0.20, 'rgba(111, 214, 233, 0.155)');
    fill.addColorStop(0.68, 'rgba(58, 169, 198, 0.22)');
    fill.addColorStop(1, 'rgba(38, 139, 172, 0.255)');
    context.fillStyle = fill;
    context.fill();

    drawFlowBands();
    drawWake(duck.x, duck.speed, 11);
    drawWake(boat.x, boat.speed, 16);
    drawBuoyancyRipple(duck.x, duck.heaveSpeed, 11);
    drawBuoyancyRipple(boat.x, boat.heaveSpeed, 16);
    drawDuck();
    drawBoat();
    drawForegroundWater();
    drawSurfaceShimmer();
    drawSplashParticles();
  }

  function stepWater(now) {
    if (
      !wrapper ||
      transitionPaused ||
      document.hidden ||
      document.documentElement.classList.contains('is-changing') ||
      motionQuery.matches
    ) {
      animationFrame = 0;
      lastFrameTime = 0;
      lastDrawTime = 0;
      return;
    }

    var index;
    var energy = 0;
    // Tuned for a shallow, calm reservoir: small amplitude, gentle travel
    // and enough damping that a touch does not turn into a splash.
    // Less "rubber sheet": weaker local spring, stronger lateral transport
    // and slightly heavier damping. The result travels like water instead of
    // oscillating in place like jelly.
    var spring = 0.018;
    var spread = 0.198;
    var damping = 0.934;
    var elapsed = lastFrameTime ? clamp(now - lastFrameTime, 0, 48) : 16.67;

    lastFrameTime = now;
    waterTime += elapsed / 1000;

    applyCursorCollider(now);
    updateSplashParticles(elapsed);

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

      if (energy < 0.003 && Math.abs(displacement[index]) < 0.003 && Math.abs(velocity[index]) < 0.003) {
        displacement[index] = 0;
        velocity[index] = 0;
      }
    }

    if (duck.visible) {
      var slope = (surfaceAt(duck.x + 8) - surfaceAt(duck.x - 8)) / 16;

      // A very small horizontal drift follows the local slope. Pointer motion
      // can still push the duck, but it gradually settles instead of sliding.
      duck.speed = clamp((duck.speed - slope * 0.038) * 0.986, -0.42, 0.42);
      duck.x += duck.speed;
      if (duck.x < duck.left || duck.x > duck.right) {
        duck.x = clamp(duck.x, duck.left, duck.right);
        duck.speed *= -0.28;
      }

      // Spring-damper heave: the duck follows the water with a slight delay.
      // That delay is what makes it feel buoyant rather than glued to a line.
      var duckSurface =
        (
          surfaceAt(duck.x - 10) +
          surfaceAt(duck.x - 4) +
          surfaceAt(duck.x) * 2 +
          surfaceAt(duck.x + 4) +
          surfaceAt(duck.x + 10)
        ) / 6;
      var duckTarget = duckSurface * 1.58 + 1.45;
      duck.heaveSpeed += (duckTarget - duck.heave) * 0.132;
      duck.heaveSpeed *= 0.91;
      duck.heave += duck.heaveSpeed;
    }

    if (boat.visible) {
      var boatSlope = (surfaceAt(boat.x + 12) - surfaceAt(boat.x - 12)) / 24;
      boat.speed = clamp((boat.speed - boatSlope * 0.026) * 0.99, -0.32, 0.32);
      boat.x += boat.speed;
      if (boat.x < duck.left || boat.x > duck.right) {
        boat.x = clamp(boat.x, duck.left, duck.right);
        boat.speed *= -0.25;
      }

      var boatSurface =
        (
          surfaceAt(boat.x - 18) +
          surfaceAt(boat.x - 8) +
          surfaceAt(boat.x) * 2 +
          surfaceAt(boat.x + 8) +
          surfaceAt(boat.x + 18)
        ) / 6;
      var boatTarget = boatSurface * 1.48 + 0.95;
      boat.heaveSpeed += (boatTarget - boat.heave) * 0.108;
      boat.heaveSpeed *= 0.925;
      boat.heave += boat.heaveSpeed;

      // Resolve contact without allowing the two floating objects to overlap.
      if (Math.abs(boat.x - duck.x) < 36) {
        var sign = boat.x >= duck.x ? 1 : -1;
        var middle = clamp((boat.x + duck.x) / 2, duck.left + 18, duck.right - 18);
        boat.x = middle + sign * 18;
        duck.x = middle - sign * 18;
        boat.speed = sign * Math.abs(boat.speed) * 0.35;
        duck.speed = -sign * Math.abs(duck.speed) * 0.35;
      }
    }

    // Canvas gradients and paths are the expensive part. Keep physics smooth,
    // but redraw the reservoir at ~30 FPS. This is more than enough for a small
    // topbar animation and leaves headroom for Swup transitions.
    if (!lastDrawTime || now - lastDrawTime >= drawInterval) {
      drawWater();
      lastDrawTime = now;
    }

    animationFrame = window.requestAnimationFrame(stepWater);
  }

  function startWater() {
    if (
      !animationFrame &&
      wrapper &&
      !transitionPaused &&
      !document.hidden &&
      !document.documentElement.classList.contains('is-changing') &&
      !motionQuery.matches
    ) {
      lastFrameTime = 0;
      lastDrawTime = 0;
      animationFrame = window.requestAnimationFrame(stepWater);
    }
  }

  function disturbWater(event) {
    if (
      window.krosaGlassCursor &&
      typeof window.krosaGlassCursor.getState === 'function'
    ) {
      // The V7 collider is evaluated inside stepWater(). Wake the simulation
      // whenever the visible glass cursor moves over the reservoir.
      if (wrapper && !motionQuery.matches && !transitionPaused) {
        startWater();
      }
      return;
    }

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

    // First pointer event only establishes the reference sample.
    if (Number.isNaN(lastPointerX)) {
      lastPointerX = pointerX;
      lastPointerY = pointerY;
      lastPointerTime = now;
      return;
    }

    // Sample at roughly one display frame. Important: do NOT overwrite the
    // reference point when we skip a sample, otherwise 60/120 Hz pointermove
    // events can keep resetting the timer and the water never receives input.
    var elapsed = now - lastPointerTime;
    if (elapsed < 14) return;

    var deltaX = pointerX - lastPointerX;
    var deltaY = pointerY - lastPointerY;
    var rawVX = deltaX / Math.max(14, elapsed);
    var rawVY = deltaY / Math.max(14, elapsed);

    // Moderate low-pass filtering: responsive, but not jittery.
    pointerVelocityX = pointerVelocityX * 0.58 + rawVX * 0.42;
    pointerVelocityY = pointerVelocityY * 0.58 + rawVY * 0.42;

    var waterline = height * 0.62 + surfaceAt(pointerX);
    var interactionRadius = Math.max(17, height * 0.46);
    var distanceToSurface = Math.abs(pointerY - waterline);
    var proximity = 1 - clamp(distanceToSurface / interactionRadius, 0, 1);

    // Smooth fade near the edge of the interaction band.
    proximity = proximity * proximity * (3 - 2 * proximity);

    // Vertical movement couples most strongly to the surface; horizontal
    // movement still creates a small wake so simply passing over the water is visible.
    // Horizontal sweeps should also push the surface strongly. In the old
    // tuning only 16% of horizontal mouse speed contributed, so moving the
    // pointer across the topbar barely generated a visible wave.
    var normalSpeed =
      Math.abs(pointerVelocityY) * 1.05 +
      Math.abs(pointerVelocityX) * 0.58;

    if (proximity > 0.006 && normalSpeed > 0.008) {
      var direction = Math.abs(pointerVelocityY) > 0.015
        ? Math.sign(pointerVelocityY)
        : 1;
      var strength = clamp(normalSpeed * 1.42, 0, 1.75) * proximity;
      var center = Math.round((pointerX / Math.max(1, width)) * (pointCount - 1));

      // Broader impulse: the cursor now pushes a patch of water rather than
      // just a few points. Clamp local velocity so repeated fast sweeps remain
      // dramatic without exploding into an unstable "tsunami".
      for (var offset = -6; offset <= 6; offset += 1) {
        var point = clamp(center + offset, 0, pointCount - 1);
        var weight = Math.exp(-(offset * offset) / 9.2);
        velocity[point] = clamp(
          velocity[point] + strength * weight * direction,
          -3.4,
          3.4
        );
      }

      // Add a leading/trailing pair based on horizontal mouse direction. This
      // makes a sideways sweep launch a travelling wave instead of a symmetric
      // local bump.
      var travelDirection = pointerVelocityX >= 0 ? 1 : -1;
      var lead = clamp(center + travelDirection * 6, 0, pointCount - 1);
      var trail = clamp(center - travelDirection * 7, 0, pointCount - 1);

      velocity[lead] = clamp(
        velocity[lead] + strength * 0.36 * direction,
        -3.4,
        3.4
      );
      velocity[trail] = clamp(
        velocity[trail] - strength * 0.24 * direction,
        -3.4,
        3.4
      );

      // Wider counter-lobes give the mouse-created disturbance an ocean-wave
      // silhouette: a crest followed by a trough.
      velocity[clamp(center - 9, 0, pointCount - 1)] = clamp(
        velocity[clamp(center - 9, 0, pointCount - 1)] -
          strength * 0.18 * direction,
        -3.4,
        3.4
      );
      velocity[clamp(center + 9, 0, pointCount - 1)] = clamp(
        velocity[clamp(center + 9, 0, pointCount - 1)] -
          strength * 0.18 * direction,
        -3.4,
        3.4
      );

      var influence = Math.max(0, 1 - Math.abs(pointerX - duck.x) / 125);
      duck.speed = clamp(
        duck.speed + pointerVelocityX * influence * proximity * 0.22,
        -0.62,
        0.62
      );

      var boatInfluence = Math.max(0, 1 - Math.abs(pointerX - boat.x) / 145);
      boat.speed = clamp(
        boat.speed + pointerVelocityX * boatInfluence * proximity * 0.16,
        -0.48,
        0.48
      );

      startWater();
    }

    // Update the reference only after a real sample was processed.
    lastPointerX = pointerX;
    lastPointerY = pointerY;
    lastPointerTime = now;
  }

  function resizeCanvas() {
    if (!wrapper || !canvas || !context) return;

    var bounds = wrapper.getBoundingClientRect();
    wrapperLeft = bounds.left;
    wrapperTop = bounds.top;
    var pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
    var nextWidth = Math.max(1, Math.round(bounds.width));
    var nextHeight = Math.max(1, Math.round(bounds.height));
    var nextCount = clamp(Math.round(nextWidth / 16), 48, 96);

    var fraction = width ? duck.x / width : 0.45;
    var boatFraction = width ? boat.x / width : 0.65;
    width = nextWidth;
    height = nextHeight;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    if (pointCount !== nextCount) createPoints(nextCount);
    duck.left = 24;
    duck.right = width - 24;
    var breadcrumb = wrapper.querySelector('#breadcrumb');
    var search = wrapper.querySelector('#search-wrapper');
    if (breadcrumb && breadcrumb.getBoundingClientRect().width) {
      duck.left = Math.max(duck.left, breadcrumb.getBoundingClientRect().right - bounds.left + 24);
    }
    if (search && search.getBoundingClientRect().width) {
      duck.right = Math.min(duck.right, search.getBoundingClientRect().left - bounds.left - 24);
    }
    duck.visible = width >= 600 && duck.right - duck.left >= 60;
    duck.x = duck.visible ? clamp(fraction * width, duck.left, duck.right) : width / 2;
    duck.speed = 0;
    duck.heave = duck.visible
      ? (
          (
            surfaceAt(duck.x - 10) +
            surfaceAt(duck.x - 4) +
            surfaceAt(duck.x) * 2 +
            surfaceAt(duck.x + 4) +
            surfaceAt(duck.x + 10)
          ) / 6
        ) * 1.58 + 1.45
      : 0;
    duck.heaveSpeed = 0;
    boat.visible = duck.visible && duck.right - duck.left >= 130 && height >= 44;
    boat.x = boat.visible ? clamp(boatFraction * width, duck.left, duck.right) : width / 2;
    if (boat.visible && Math.abs(boat.x - duck.x) < 36) {
      boat.x = duck.x + 40 <= duck.right ? duck.x + 40 : duck.x - 40;
    }
    boat.speed = 0;
    boat.heave = boat.visible
      ? (
          (
            surfaceAt(boat.x - 18) +
            surfaceAt(boat.x - 8) +
            surfaceAt(boat.x) * 2 +
            surfaceAt(boat.x + 8) +
            surfaceAt(boat.x + 18)
          ) / 6
        ) * 1.48 + 0.95
      : 0;
    boat.heaveSpeed = 0;
    resetPointer();
    drawWater();
    startWater();
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
    lastFrameTime = 0;
    lastDrawTime = 0;
    resetPointer();
  }

  function pauseForNavigation() {
    transitionPaused = true;
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    lastFrameTime = 0;
    lastDrawTime = 0;
  }

  function resumeAfterNavigation() {
    transitionPaused = false;
    window.requestAnimationFrame(function () {
      mountTopbar();
      startWater();
    });
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
      lastFrameTime = 0;
      lastDrawTime = 0;
      return;
    }

    startWater();
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

    lastFrameTime = 0;
    createPoints(pointCount || 48);
    drawWater();

    if (!motionQuery.matches) startWater();
  }

  function destroy() {
    unmountTopbar();
    document.removeEventListener('pointerdown', createRipple);
    document.removeEventListener('swup:visit:start', pauseForNavigation);
    document.removeEventListener('swup:page:view', resumeAfterNavigation);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('resize', resizeCanvas);

    if (motionQuery.removeEventListener) {
      motionQuery.removeEventListener('change', handleMotionPreference);
    } else {
      motionQuery.removeListener(handleMotionPreference);
    }

    delete window.krosaWaterUI;
  }

  document.addEventListener('pointerdown', createRipple, { passive: true });
  document.addEventListener('swup:visit:start', pauseForNavigation);
  document.addEventListener('swup:page:view', resumeAfterNavigation);
  document.addEventListener('visibilitychange', handleVisibilityChange);

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

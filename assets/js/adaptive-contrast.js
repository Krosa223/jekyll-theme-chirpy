(() => {
  'use strict';
  if (window.krosaAdaptiveContrast) return;
  const root = document.documentElement;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 192;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  let cacheUrl = '', cached = null, timer, revision = 0;
  const states = new WeakMap();
  const themeCache = new Map();
  let themeRevision = 0;
  let activeThemeUrl = '';
  async function updateFormatTheme() {
    const wrapper = document.getElementById('main-wrapper');
    if (!wrapper) return;
    const match = getComputedStyle(wrapper, '::before').backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    if (!match) return;
    const url = new URL(match[1], document.baseURI).href;
    if (url === activeThemeUrl) return;
    const version = ++themeRevision;
    const wallpaper = root.dataset.wallpaper || url;
    const key = 'krosa-format-theme-v2:' + wallpaper;
    let theme = themeCache.get(url);
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (!theme && saved?.url === url && ['dark', 'light'].includes(saved.theme)) theme = saved.theme;
    } catch {}
    if (!theme) {
      const image = await imageData(url);
      if (version !== themeRevision) return;
      if (!image) return;
      const samples = [];
      for (let i = 0; i < image.pixels.length; i += 16) {
        samples.push(luminance([image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]]));
      }
      samples.sort((a, b) => a - b);
      theme = samples[Math.floor(samples.length / 2)] < .47 ? 'dark' : 'light';
    }
    if (version !== themeRevision) return;
    themeCache.set(url, theme);
    activeThemeUrl = url;
    root.dataset.formatTheme = theme;
    try { localStorage.setItem(key, JSON.stringify({ url, theme })); } catch {}
  }
  const specialSelector = '.table-wrapper, details, blockquote.prompt-tip, blockquote.prompt-info, blockquote.prompt-warning, blockquote.prompt-danger, kbd';
  const color = value => {
    const n = value.match(/[\d.]+/g);
    return n && n.length >= 3 ? [+n[0], +n[1], +n[2], n.length > 3 ? +n[3] : 1] : [0, 0, 0, 0];
  };
  const blend = (base, tint) => base.map((v, i) => v * (1 - tint[3]) + tint[i] * tint[3]);
  const luminance = rgb => rgb.map(v => {
    v /= 255;
    return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const offset = (value, space) => {
    if (value.endsWith('%')) return parseFloat(value) * space / 100;
    if (value === 'center') return space / 2;
    if (value === 'right' || value === 'bottom') return space;
    return parseFloat(value) || 0;
  };
  function imageData(url) {
    if (url === cacheUrl) return cached;
    cacheUrl = url;
    cached = new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        try {
          ctx.clearRect(0, 0, 192, 192);
          ctx.drawImage(image, 0, 0, 192, 192);
          resolve({ width: image.naturalWidth, height: image.naturalHeight, pixels: ctx.getImageData(0, 0, 192, 192).data });
        } catch { resolve(null); }
      };
      image.onerror = () => resolve(null);
      image.src = url;
    });
    return cached;
  }
  async function update() {
    const version = ++revision;
    const home = document.querySelector('.home-layout');
    const wrapper = document.getElementById('main-wrapper');
    if (!wrapper) return;
    const targets = home ? [...home.querySelectorAll('.home-topics, .home-post-card .post-preview, #topbar-wrapper, footer')] : [];
    if (!targets.length) return;
    const bg = getComputedStyle(wrapper, '::before');
    const match = bg.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    const image = match ? await imageData(new URL(match[1], document.baseURI).href) : null;
    if (version !== revision || !wrapper.isConnected) return;
    if (!image) {
      targets.forEach(el => {
        el.removeAttribute('data-auto-ink');
        el.removeAttribute('data-code-theme');
        el.removeAttribute('data-format-theme');
        el.style.removeProperty('--auto-primary');
        el.style.removeProperty('--auto-secondary');
        states.delete(el);
      });
      return;
    }
    const left = parseFloat(bg.left) || 0, top = parseFloat(bg.top) || 0;
    const width = innerWidth - left - (parseFloat(bg.right) || 0);
    const height = innerHeight - top - (parseFloat(bg.bottom) || 0);
    const scale = Math.max(width / image.width, height / image.height);
    const position = bg.backgroundPosition.split(' ');
    const x0 = left + offset(position[0], width - image.width * scale);
    const y0 = top + offset(position[1] || '50%', height - image.height * scale);
    const wash = color(getComputedStyle(wrapper, '::after').backgroundColor);
    targets.forEach(el => {
      const box = el.getBoundingClientRect();
      if (!box.width || box.bottom < 0 || box.top > innerHeight) return;
      const layers = [];
      for (let node = el; node && node !== wrapper; node = node.parentElement) {
        layers.unshift(color(getComputedStyle(node).backgroundColor));
      }
      // Local low-resolution samples approximate the frosted backdrop, not the whole wallpaper.
      const samples = [];
      const average = [0, 0, 0];
      for (let y = 0; y < 5; y++) for (let x = 0; x < 9; x++) {
        const px = box.left + box.width * (x + .5) / 9;
        const py = box.top + box.height * (y + .5) / 5;
        const ix = Math.max(0, Math.min(191, Math.floor((px - x0) / (image.width * scale) * 192)));
        const iy = Math.max(0, Math.min(191, Math.floor((py - y0) / (image.height * scale) * 192)));
        const index = (iy * 192 + ix) * 4;
        const pixel = Array.from(image.pixels.slice(index, index + 3));
        let rgb = blend(pixel, wash);
        layers.forEach(layer => { rgb = blend(rgb, layer); });
        samples.push(luminance(rgb));
        rgb.forEach((value, i) => { average[i] += value / 45; });
      }
      const score = ink => samples.map(l => (Math.max(l, ink) + .05) / (Math.min(l, ink) + .05)).sort((a, b) => a - b)[9];
      const dark = score(luminance([28, 30, 33]));
      const light = score(luminance([238, 240, 241]));
      let next = dark >= light ? 'dark' : 'light';
      const previous = states.get(el);
      if (previous && next !== previous && Math.max(dark, light) < Math.min(dark, light) * 1.2) next = previous;
      states.set(el, next);
      if (el.dataset.autoInk !== next) el.dataset.autoInk = next;
      // Find the gentlest solid tone that meets the sampled contrast target.
      // This is an approximation of material-aware labels, not native vibrancy.
      const endpoint = next === 'light' ? [238, 240, 241] : [28, 30, 33];
      const mean = average.reduce((sum, value) => sum + value, 0) / 3;
      const ambient = average.map(value => mean * .94 + value * .06);
      const tone = target => {
        let low = 0, high = 1;
        for (let i = 0; i < 12; i++) {
          const mix = (low + high) / 2;
          const rgb = ambient.map((value, j) => value + (endpoint[j] - value) * mix);
          if (score(luminance(rgb)) >= target) high = mix;
          else low = mix;
        }
        return `rgb(${ambient.map((value, i) => Math.round(value + (endpoint[i] - value) * high)).join(', ')})`;
      };
      const increasedContrast = matchMedia('(prefers-contrast: more)').matches;
      el.style.setProperty('--auto-primary', tone(increasedContrast ? 7 : 5.2));
      el.style.setProperty('--auto-secondary', tone(increasedContrast ? 7 : 4.5));
    });
  }
  function schedule() {
    ++revision;
    clearTimeout(timer);
    timer = setTimeout(update, 100);
  }
  function refresh() { updateFormatTheme(); schedule(); }
  window.krosaAdaptiveContrast = { refresh };
  addEventListener('resize', schedule, { passive: true });
  addEventListener('scroll', () => { if (document.querySelector('.home-layout')) schedule(); }, { passive: true });
  addEventListener('pageshow', refresh);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);
  matchMedia('(prefers-contrast: more)').addEventListener('change', schedule);
  new MutationObserver(refresh).observe(root, { attributes: true, attributeFilter: ['data-wallpaper', 'data-mode', 'data-bs-theme'] });
  new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 &&
      (node.matches('#swup, .home-layout, .post-article, div.highlighter-rouge') || node.querySelector('.home-reading, .post-article'))))) schedule();
  }).observe(document.body, { childList: true, subtree: true });
  refresh();
})();

import Swup from 'swup';
import SwupA11yPlugin from '@swup/a11y-plugin';
import SwupHeadPlugin from '@swup/head-plugin';
import SwupPreloadPlugin from '@swup/preload-plugin';
import SwupScriptsPlugin from '@swup/scripts-plugin';

const pageCleanups = new Set();

window.krosaRegisterPageCleanup = (cleanup) => {
  if (typeof cleanup !== 'function') {
    return () => {};
  }

  pageCleanups.add(cleanup);
  return () => pageCleanups.delete(cleanup);
};

function cleanupCurrentPage() {
  pageCleanups.forEach((cleanup) => {
    try {
      cleanup();
    } catch (error) {
      console.error('Unable to clean up the current page:', error);
    }
  });
  pageCleanups.clear();

  if (typeof window.krosaPageCleanup === 'function') {
    window.krosaPageCleanup();
    delete window.krosaPageCleanup;
  }
}

function updateSidebarActiveLink() {
  const links = Array.from(document.querySelectorAll('#sidebar .nav-item a'));
  const currentPath = new URL(window.location.href).pathname.replace(/\/+$/, '/');
  let activeLink = null;
  let activeLength = -1;

  links.forEach((link) => {
    const item = link.closest('.nav-item');
    const linkPath = new URL(link.href, window.location.href).pathname.replace(
      /\/+$/,
      '/'
    );
    const matches =
      linkPath === '/'
        ? currentPath === '/'
        : currentPath === linkPath || currentPath.startsWith(linkPath);

    item?.classList.remove('active');
    if (matches && linkPath.length > activeLength) {
      activeLink = item;
      activeLength = linkPath.length;
    }
  });

  activeLink?.classList.add('active');
}

function closePersistentOverlays() {
  const wallpaperMenu = document.getElementById('wallpaper-menu');
  const wallpaperToggle = document.getElementById('wallpaper-toggle');

  if (wallpaperMenu && wallpaperToggle) {
    wallpaperMenu.hidden = true;
    wallpaperToggle.setAttribute('aria-expanded', 'false');
  }

  document.body.removeAttribute('sidebar-display');
  document.getElementById('sidebar')?.classList.remove('z-2');
  document.getElementById('mask')?.classList.add('d-none');
}

function getMissingPageDependencies() {
  const checks = [
    {
      needed: () => document.getElementById('search-input'),
      ready: () => typeof window.SimpleJekyllSearch === 'function'
    },
    {
      needed: () => document.querySelector('[data-ts], time[datetime]'),
      ready: () =>
        typeof window.dayjs === 'function' &&
        typeof window.dayjs_plugin_localizedFormat === 'function'
    },
    {
      needed: () => document.querySelector('.popup'),
      ready: () => typeof window.GLightbox === 'function'
    },
    {
      needed: () =>
        document.getElementById('copy-link') ||
        document.querySelector('.code-header > button'),
      ready: () => typeof window.ClipboardJS === 'function'
    },
    {
      needed: () =>
        document.querySelector('main > article[data-toc="true"]'),
      ready: () => typeof window.tocbot?.init === 'function'
    },
    {
      needed: () => document.querySelector('.language-mermaid'),
      ready: () => typeof window.mermaid?.initialize === 'function'
    }
  ];

  return checks.filter(({ needed, ready }) => needed() && !ready());
}

async function waitForPageDependencies() {
  const timeoutAt = performance.now() + 1500;

  while (getMissingPageDependencies().length && performance.now() < timeoutAt) {
    await new Promise((resolve) => window.setTimeout(resolve, 16));
  }
}

const swup = new Swup({
  containers: ['#swup'],
  animationSelector: '[data-swup-transition]',
  animateHistoryBrowsing: true,
  plugins: [
    new SwupHeadPlugin({
      awaitAssets: true,
      attributes: ['lang', 'dir']
    }),
    new SwupPreloadPlugin({
      throttle: 4,
      preloadVisibleLinks: {
        enabled: true,
        threshold: 0.15,
        delay: 650,
        containers: ['#sidebar', '#swup']
      }
    }),
    new SwupA11yPlugin(),
    new SwupScriptsPlugin({
      head: true,
      body: true,
      optin: true
    })
  ]
});

swup.hooks.on('content:replace', waitForPageDependencies, {
  priority: -100
});

swup.hooks.before('content:replace', () => {
  cleanupCurrentPage();
  closePersistentOverlays();
});

swup.hooks.on('page:view', () => {
  updateSidebarActiveLink();
});

window.krosaSwup = swup;

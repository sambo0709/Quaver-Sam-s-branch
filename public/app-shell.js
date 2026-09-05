(function () {
  'use strict';

  const routeAliases = {
    '/': 'home',
    '/Index.html': 'home',
    '/index.html': 'home',
    '/search.html': 'search',
    '/playlists.html': 'playlists',
    '/profile.html': 'profile',
    '/settings.html': 'settings',
  };

  const routePaths = {
    home: '/Index.html',
    search: '/search.html',
    playlists: '/playlists.html',
    profile: '/profile.html',
    settings: '/settings.html',
  };

  const views = new Map();
  const pageCache = new Map();

  const initialRoute = routeAliases[window.location.pathname] || 'home';
  const state = {
    mounted: false,
    route: 'home',
    initialRoute: initialRoute,
    user: null,
    theme: document.documentElement.dataset.theme || 'dark',
  };
  const events = new EventTarget();

  function routeFromUrl(value) {
    let url;
    try { url = new URL(value || window.location.href, window.location.href); }
    catch (_) { return null; }
    if (url.origin !== window.location.origin) return null;
    return routeAliases[url.pathname] || null;
  }

  function routeUrl(route, sourceUrl) {
    const url = new URL(sourceUrl || routePaths[route] || '/', window.location.origin);
    return url.pathname + url.search + url.hash;
  }

  function shellElement(name) {
    return document.querySelector('[data-shell="' + name + '"]');
  }

  function setActiveRoute(route) {
    state.route = route || 'home';
    document.querySelectorAll('[data-route]').forEach(function (link) {
      const active = link.dataset.route === state.route;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    const view = shellElement('view');
    if (view) view.dataset.view = state.route;
    events.dispatchEvent(new CustomEvent('routechange', { detail: { route: state.route } }));
  }

  function setUser(user) {
    state.user = user || null;
    events.dispatchEvent(new CustomEvent('userchange', { detail: { user: state.user } }));
  }

  function setTheme(theme) {
    state.theme = theme || 'dark';
    events.dispatchEvent(new CustomEvent('themechange', { detail: { theme: state.theme } }));
  }

  function showToast(message, type) {
    if (typeof window.showToast === 'function') return window.showToast(message, type);
    const toast = shellElement('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'toast ' + (type || 'success') + ' show';
    window.setTimeout(function () { toast.classList.remove('show'); }, 3000);
  }

  function registerView(route, definition) {
    if (!routePaths[route]) throw new Error('Unknown Quaver route: ' + route);
    views.set(route, definition || {});
  }

  async function loadPage(path) {
    if (!pageCache.has(path)) {
      pageCache.set(path, fetch(path, { headers: { 'X-Quaver-View': '1' } }).then(function (response) {
        if (!response.ok) throw new Error('Could not load this page.');
        return response.text();
      }).catch(function (error) {
        pageCache.delete(path);
        throw error;
      }));
    }
    return new DOMParser().parseFromString(await pageCache.get(path), 'text/html');
  }

  function finishRoute(view, route, options) {
    const hash = window.location.hash;
    const hashTarget = hash && document.getElementById(hash.slice(1));
    if (hashTarget) hashTarget.scrollIntoView({ block: 'start' });
    else if (!options || options.scroll !== false) window.scrollTo({ top: 0, behavior: 'instant' });
    if (!options || options.focus !== false) {
      const heading = view.querySelector('h1');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    }
    events.dispatchEvent(new CustomEvent('viewrender', { detail: { route: route } }));
  }

  async function renderRoute(route, options) {
    const definition = views.get(route);
    if (!definition) return false;
    const view = shellElement('view');
    if (!view) return false;
    document.documentElement.classList.add('app-view-transitioning');
    view.setAttribute('aria-busy', 'true');
    try {
      const currentDefinition = views.get(state.route);
      if (route === state.route) {
        if (typeof definition.update === 'function') await definition.update(view);
        setActiveRoute(route);
        finishRoute(view, route, options);
        return true;
      }
      let content = null;
      if (!definition.fragment && typeof definition.render === 'function') {
        content = await definition.render({ route: route, view: view, state: state });
      }
      if (route !== state.route && currentDefinition) {
        if (typeof currentDefinition.unmount === 'function') currentDefinition.unmount();
        currentDefinition.fragment = document.createDocumentFragment();
        while (view.firstChild) currentDefinition.fragment.appendChild(view.firstChild);
      }
      if (definition.fragment && definition.fragment.childNodes.length) {
        view.replaceChildren(definition.fragment);
      } else if (content) {
        if (typeof content === 'string') view.innerHTML = content;
        else if (content instanceof Node) view.replaceChildren(content);
      }
      if (definition.bodyClass) document.body.className = definition.bodyClass;
      else document.body.removeAttribute('class');
      if (definition.title) document.title = definition.title;
      setActiveRoute(route);
      if (typeof definition.mount === 'function') await definition.mount(view);
      finishRoute(view, route, options);
      return true;
    } finally {
      document.documentElement.classList.remove('app-view-transitioning');
      view.removeAttribute('aria-busy');
    }
  }

  async function navigate(target, options) {
    const route = routePaths[target] ? target : routeFromUrl(target);
    const definition = route && views.get(route);
    if (!route || !definition) return false;
    const destination = routeUrl(route, routePaths[target] ? null : target);
    const previousUrl = window.location.href;
    if (!options || !options.popstate) {
      const method = options && options.replace ? 'replaceState' : 'pushState';
      window.history[method]({ quaverRoute: route }, '', destination);
    }
    try {
      return await renderRoute(route, options);
    } catch (error) {
      window.history.replaceState({ quaverRoute: state.route }, '', previousUrl);
      showToast(error.message || 'That page could not be loaded.', 'error');
      return false;
    }
  }

  function handleNavigationClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.target || link.hasAttribute('download')) return;
    const route = routeFromUrl(link.href);
    if (!route || !views.has(route)) return;
    event.preventDefault();
    navigate(link.href);
  }

  function handleNavigationSubmit(event) {
    const form = event.target.closest('form[action]');
    if (!form || form.method.toLowerCase() !== 'get') return;
    const route = routeFromUrl(form.action);
    if (!route || !views.has(route)) return;
    event.preventDefault();
    const destination = new URL(form.action, window.location.href);
    new FormData(form).forEach(function (value, key) { destination.searchParams.set(key, String(value)); });
    navigate(destination.href);
  }

  function handlePrefetch(event) {
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    const route = routeFromUrl(link.href);
    const definition = route && views.get(route);
    if (definition && definition.source) loadPage(definition.source).catch(function () {});
  }

  function handlePopState() {
    const route = routeFromUrl(window.location.href);
    if (route && views.has(route)) renderRoute(route, { popstate: true, scroll: false });
    else window.location.reload();
  }

  function mount() {
    if (state.mounted) return;
    const required = ['top-nav', 'view', 'player', 'mobile-nav', 'toast'];
    const missing = required.filter(function (name) { return !shellElement(name); });
    if (missing.length) throw new Error('Quaver shell is missing: ' + missing.join(', '));
    state.mounted = true;
    registerView('home', { title: 'Quaver', bodyClass: '' });
    registerView('search', {
      title: 'Search - Quaver',
      bodyClass: 'profile-page search-page',
      source: '/search.html',
      render: async function () {
        const page = await loadPage('/search.html');
        const main = page.querySelector('main.search-main');
        if (!main) throw new Error('Search view is unavailable.');
        return document.importNode(main, true);
      },
      mount: function (view) {
        if (window.QuaverSearch) window.QuaverSearch.mount(view);
      },
      unmount: function () {
        if (window.QuaverSearch) window.QuaverSearch.unmount();
      },
      update: function () {
        if (window.QuaverSearch) window.QuaverSearch.update();
      },
    });
    registerView('playlists', {
      title: 'Playlists - Quaver',
      bodyClass: 'profile-page playlists-page',
      source: '/playlists.html',
      render: async function () {
        const page = await loadPage('/playlists.html');
        const fragment = document.createDocumentFragment();
        ['main.playlist-library-main', '#library-modal-overlay', '#library-modal', '#collection-picker-overlay', '#collection-picker', '#playlist-cover-input'].forEach(function (selector) {
          const element = page.querySelector(selector);
          if (element) fragment.appendChild(document.importNode(element, true));
        });
        if (!fragment.querySelector('main.playlist-library-main')) throw new Error('Playlists view is unavailable.');
        return fragment;
      },
      mount: function (view) {
        if (window.QuaverPlaylists) window.QuaverPlaylists.mount(view);
      },
      unmount: function () {
        if (window.QuaverPlaylists) window.QuaverPlaylists.unmount();
      },
      update: function () {
        if (window.QuaverPlaylists) window.QuaverPlaylists.update();
      },
    });
    registerView('profile', {
      title: 'Profile - Quaver',
      bodyClass: 'profile-page',
      source: '/profile.html',
      render: async function () {
        const page = await loadPage('/profile.html');
        const fragment = document.createDocumentFragment();
        ['#wrapped-modal', 'main.profile-main', '#profile-editor-overlay'].forEach(function (selector) {
          const element = page.querySelector(selector);
          if (element) fragment.appendChild(document.importNode(element, true));
        });
        if (!fragment.querySelector('main.profile-main')) throw new Error('Profile view is unavailable.');
        return fragment;
      },
      mount: function (view) {
        if (window.QuaverProfile) return window.QuaverProfile.mount(view);
      },
      unmount: function () {
        if (window.QuaverProfile) window.QuaverProfile.unmount();
      },
    });
    registerView('settings', {
      title: 'Settings - Quaver',
      bodyClass: 'profile-page settings-page',
      source: '/settings.html',
      render: async function () {
        const page = await loadPage('/settings.html');
        const main = page.querySelector('main.settings-main');
        if (!main) throw new Error('Settings view is unavailable.');
        return document.importNode(main, true);
      },
      mount: function (view) {
        if (window.QuaverSettings) return window.QuaverSettings.mount(view);
      },
      unmount: function () {
        if (window.QuaverSettings) window.QuaverSettings.unmount();
      },
    });
    document.documentElement.classList.add('app-shell-mounted');
    setActiveRoute('home');
    document.addEventListener('click', handleNavigationClick);
    document.addEventListener('submit', handleNavigationSubmit);
    document.addEventListener('pointerover', handlePrefetch, { passive: true });
    document.addEventListener('focusin', handlePrefetch);
    window.addEventListener('popstate', handlePopState);
    window.history.replaceState({ quaverRoute: initialRoute }, '', window.location.href);
    if (initialRoute !== 'home') navigate(window.location.href, { replace: true });
    events.dispatchEvent(new CustomEvent('mount', { detail: { route: initialRoute } }));
  }

  window.QuaverShell = {
    state: state,
    events: events,
    mount: mount,
    element: shellElement,
    setActiveRoute: setActiveRoute,
    setUser: setUser,
    setTheme: setTheme,
    showToast: showToast,
    navigate: navigate,
    registerView: registerView,
    routeFromUrl: routeFromUrl,
    canNavigate: function (route) { return views.has(route); },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();

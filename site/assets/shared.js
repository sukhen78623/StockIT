/* StockIt shared script: theme + sidebar + header + footer + global search.
   Every page loads this one file, so header/footer are edited in ONE place. */
(function () {
  var API = '';
  var KEY = 'stockit-theme';
  var root = document.documentElement;
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var queue = [], built = false;

  var ICON = {
    auto: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    light: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 15.4A8.4 8.4 0 0 1 8.6 4 8.4 8.4 0 1 0 20 15.4z"/></svg>'
  };
  var LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  var NEXT = { auto: 'light', light: 'dark', dark: 'auto' };

  function getMode() { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function apply(m) {
    root.setAttribute('data-mode', m);
    root.setAttribute('data-theme', m === 'auto' ? (mq.matches ? 'dark' : 'light') : m);
    var b = document.getElementById('themeBtn');
    if (b) { b.innerHTML = ICON[m] + '<span class="lbl">' + LABEL[m] + '</span>'; b.title = 'Theme: ' + LABEL[m]; }
    window.dispatchEvent(new Event('themechange'));
  }
  apply(getMode());
  if (mq.addEventListener) mq.addEventListener('change', function () { if (getMode() === 'auto') apply('auto'); });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmt(n) {
    if (n == null || isNaN(n)) return '\u2014';
    return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pct(n) {
    if (n == null || isNaN(n)) return '\u2014';
    return (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%';
  }
  function na(msg) { return '<div class="na">' + esc(msg || 'Data Unavailable') + '</div>'; }

  window.StockIt = {
    api: API, esc: esc, fmt: fmt, pct: pct, na: na,
    ready: function (fn) { if (built) fn(); else queue.push(fn); }
  };

  var I = {
    home: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>',
    filter: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>',
    star: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.3l1.1-6.2L3 9.7l6.2-.9z"/></svg>',
    user: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    search: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    logo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l5-5 4 3 7-8"/></svg>'
  };

  document.addEventListener('DOMContentLoaded', function () {
    var page = document.getElementById('page');
    if (page) {
      var active = document.body.getAttribute('data-page') || '';
      var items = [
        ['dashboard', '/', 'Dashboard', I.home, ''],
        ['screener', '', 'Screener', I.filter, 'Soon'],
        ['watchlist', '', 'Watchlist', I.star, 'Soon'],
        ['login', '', 'Login', I.user, 'Soon']
      ];
      var nav = items.map(function (x) {
        if (x[1]) return '<a href="' + x[1] + '" class="' + (active === x[0] ? 'active' : '') + '">' + x[3] + x[2] + '</a>';
        return '<span class="item soon">' + x[3] + x[2] + '<span class="tag">' + x[4] + '</span></span>';
      }).join('');

      var app = document.createElement('div');
      app.className = 'app';
      app.innerHTML =
        '<div class="overlay" id="ov"></div>' +
        '<aside class="sidebar">' +
          '<a class="brand" href="/"><span class="logo">' + I.logo + '</span>StockIt</a>' +
          '<nav class="nav">' + nav + '</nav>' +
          '<div class="side-note">Prices: NSE End of Day</div>' +
        '</aside>' +
        '<div class="main">' +
          '<header class="topbar">' +
            '<button class="iconbtn burger" id="burger" aria-label="Menu">' + I.menu + '</button>' +
            '<div class="search">' + I.search +
              '<input id="q" type="search" placeholder="Search stock or symbol" autocomplete="off" aria-label="Search stocks">' +
              '<div class="sbox" id="sbox" hidden></div>' +
            '</div>' +
            '<button class="iconbtn" id="themeBtn"></button>' +
          '</header>' +
          '<main class="content" id="content"></main>' +
          '<footer class="footer"><div class="in">' +
            '<span><b>StockIt</b> \u2014 free Indian stock research</span>' +
            '<span>Data: NSE End of Day (not live). For information only, not investment advice.</span>' +
            '<span>\u00A9 ' + new Date().getFullYear() + ' StockIt</span>' +
          '</div></footer>' +
        '</div>';
      page.parentNode.insertBefore(app, page);
      document.getElementById('content').appendChild(page);

      var closeMenu = function () { app.classList.remove('open'); };
      document.getElementById('burger').onclick = function () { app.classList.toggle('open'); };
      document.getElementById('ov').onclick = closeMenu;

      var tb = document.getElementById('themeBtn');
      tb.onclick = function () { var m = NEXT[getMode()]; try { localStorage.setItem(KEY, m); } catch (e) {} apply(m); };
      apply(getMode());

      // Global search
      var q = document.getElementById('q'), box = document.getElementById('sbox'), timer, hits = [];
      function show(list) {
        hits = list;
        box.innerHTML = list.length
          ? list.map(function (r) {
              return '<a class="s-item" href="/stock?symbol=' + encodeURIComponent(r.symbol) + '"><b>' + esc(r.symbol) + '</b><span>' + esc(r.name || '') + '</span></a>';
            }).join('')
          : '<div class="s-empty">No match found</div>';
        box.hidden = false;
      }
      q.addEventListener('input', function () {
        clearTimeout(timer);
        var v = q.value.trim();
        if (!v) { box.hidden = true; return; }
        timer = setTimeout(function () {
          fetch(API + '/api/search?q=' + encodeURIComponent(v))
            .then(function (r) { if (!r.ok) throw 0; return r.json(); })
            .then(function (j) { show(j.results || []); })
            .catch(function () { box.innerHTML = '<div class="s-empty">Data Unavailable</div>'; box.hidden = false; });
        }, 200);
      });
      q.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && hits.length) location.href = '/stock?symbol=' + encodeURIComponent(hits[0].symbol);
        if (e.key === 'Escape') box.hidden = true;
      });
      document.addEventListener('click', function (e) { if (!e.target.closest('.search')) box.hidden = true; });
    }
    built = true;
    queue.splice(0).forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
  });
})();

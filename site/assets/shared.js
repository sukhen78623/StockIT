/* StockIt shared script: theme + header + bottom nav + footer + global search.
   Every page loads this one file, so header/footer are edited in ONE place. */
(function () {
  var API = '';
  var KEY = 'stockit-theme';
  var root = document.documentElement;
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var queue = [], built = false;

  function svg(d, s) {
    return '<svg width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  }
  var ICON = {
    auto: svg('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>', 17),
    light: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', 17),
    dark: svg('<path d="M20 15.4A8.4 8.4 0 0 1 8.6 4 8.4 8.4 0 1 0 20 15.4z"/>', 17)
  };
  var LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  var NEXT = { auto: 'light', light: 'dark', dark: 'auto' };
  var I = {
    home: svg('<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>', 21),
    screens: svg('<path d="M3 5h18l-7 8v6l-4 2v-8z"/>', 21),
    tools: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-.6-.6-2.6z"/>', 21),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', 21),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 17),
    searchBig: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 24),
    logo: svg('<path d="M4 17l5-5 4 3 7-8"/>', 18)
  };

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

  function mountSearch(el) {
    el.innerHTML = I.search + '<input type="search" placeholder="Search for a company" autocomplete="off" aria-label="Search stocks"><div class="sbox" hidden></div>';
    var q = el.querySelector('input'), box = el.querySelector('.sbox'), timer, hits = [];
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
    document.addEventListener('click', function (e) { if (!el.contains(e.target)) box.hidden = true; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var page = document.getElementById('page');
    if (page) {
      var active = document.body.getAttribute('data-page') || '';
      var isHome = active === 'home';

      var links = [
        ['home', '/', 'Home', I.home],
        ['screens', '', 'Screens', I.screens],
        ['tools', '', 'Tools', I.tools],
        ['login', '', 'Login', I.user]
      ];
      var dnav = links.map(function (x) {
        return x[1]
          ? '<a href="' + x[1] + '" class="' + (active === x[0] ? 'active' : '') + '">' + x[2] + '</a>'
          : '<span class="item soon">' + x[2] + '<span class="tag">Soon</span></span>';
      }).join('');
      function bi(x) {
        return x[1]
          ? '<a href="' + x[1] + '" class="' + (active === x[0] ? 'active' : '') + '">' + x[3] + x[2] + '</a>'
          : '<span class="item soon" title="Coming soon">' + x[3] + x[2] + '</span>';
      }
      var bnav = bi(links[0]) + bi(links[1]) +
        '<button class="go" id="goSearch" aria-label="Search">' + I.searchBig + '</button>' +
        bi(links[2]) + bi(links[3]);

      var wrap = document.createElement('div');
      wrap.innerHTML =
        '<header class="top"><div class="top-in">' +
          '<a class="brand" href="/"><span class="logo">' + I.logo + '</span><span class="bname">StockIt</span></a>' +
          '<nav class="dnav">' + dnav + '</nav>' +
          (isHome ? '<span class="spacer"></span>' : '<div class="gsearch" data-search></div>') +
          '<button class="iconbtn" id="themeBtn"></button>' +
        '</div></header>' +
        '<main class="content" id="content"></main>' +
        '<footer class="footer"><div class="in">' +
          '<span><b>StockIt</b> \u2014 free Indian stock research</span>' +
          '<span>Data: NSE End of Day (not live). For information only, not investment advice.</span>' +
          '<span>\u00A9 ' + new Date().getFullYear() + ' StockIt</span>' +
        '</div></footer>' +
        '<nav class="bnav">' + bnav + '</nav>';
      page.parentNode.insertBefore(wrap, page);
      while (wrap.firstChild) wrap.parentNode.insertBefore(wrap.firstChild, wrap);
      wrap.parentNode.removeChild(wrap);
      document.getElementById('content').appendChild(page);

      document.getElementById('themeBtn').onclick = function () {
        var m = NEXT[getMode()]; try { localStorage.setItem(KEY, m); } catch (e) {} apply(m);
      };
      apply(getMode());

      Array.prototype.forEach.call(document.querySelectorAll('[data-search]'), mountSearch);
      document.getElementById('goSearch').onclick = function () {
        var inp = document.querySelector('.gsearch input');
        window.scrollTo(0, 0);
        if (inp) inp.focus();
      };
    }
    built = true;
    queue.splice(0).forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
  });
})();

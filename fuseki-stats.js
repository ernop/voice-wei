// Play statistics for applications hosted on fuseki.net.
//
// Canonical copy: fuseki4_ai setup/apps/fuseki-stats.js. Applications vendor
// it unchanged; the server contract is in fuseki4_ai docs/deployment.md
// ("Application play events"). Pings go only to the page's own server, which
// writes them to a private log. On any other host (local development, GitHub
// Pages copies, tests) nothing is sent.
//
//   FusekiStats.game({m: 'expert', r: 'win', d: 61.234, ...})  a game ended
//   FusekiStats.engaged(function () { return audio.playing; })  time without input
//
// Game field keys are lowercase identifiers; values are finite numbers,
// booleans, or tokens of letters, digits and _ . : / -. Anything else is
// dropped before sending, so free text never leaves the browser.
(function (root) {
  'use strict';

  var ENDPOINTS = {
    'minesweeper-friendly.fuseki.net': '/_event',
    'nectaris-remake.fuseki.net': '/_event',
    'go-replayer.fuseki.net': '/_event',
    'fuseki.net': '/voice-wei/_event',
    'www.fuseki.net': '/voice-wei/_event'
  };
  var PATH_PREFIXES = {'fuseki.net': '/voice-wei/', 'www.fuseki.net': '/voice-wei/'};
  var IDLE_MS = 5 * 60 * 1000;
  var TICK_MS = 5 * 1000;
  // Hidden tabs that play audio may run timers only once a minute.
  var ENGAGED_GAP_MS = 2 * 60 * 1000;
  var FLUSH_MS = 10 * 60 * 1000;
  var PLAYER_KEY = 'fuseki-stats-player';
  var CORE_KEYS = ['v', 'e', 'p', 's', 'n', 't', 'pg'];
  var KEY_RE = /^[a-z][a-z0-9_]{0,23}$/;
  var TOKEN_RE = /^[A-Za-z0-9_.:\/-]{1,64}$/;
  var ID_RE = /^[0-9a-f]{16}$/;
  var INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

  function randomId(crypto) {
    var bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += (bytes[i] + 256).toString(16).slice(1);
    return out;
  }

  function storedPlayer(storage, crypto) {
    try {
      var id = storage.getItem(PLAYER_KEY);
      if (ID_RE.test(id || '')) return id;
      id = randomId(crypto);
      storage.setItem(PLAYER_KEY, id);
      return id;
    } catch (error) {
      return randomId(crypto);
    }
  }

  function encodeValue(value) {
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number') {
      if (!isFinite(value) || Math.abs(value) >= 1e12) return null;
      return String(Math.round(value * 1000) / 1000);
    }
    return typeof value === 'string' && TOKEN_RE.test(value) ? value : null;
  }

  function query(pairs) {
    var parts = [];
    for (var i = 0; i < pairs.length; i++) {
      var value = encodeValue(pairs[i][1]);
      if (value !== null) parts.push(pairs[i][0] + '=' + encodeURIComponent(value));
    }
    return parts.join('&');
  }

  function gameFields(fields) {
    var pairs = [];
    Object.keys(fields || {}).forEach(function (key) {
      if (KEY_RE.test(key) && CORE_KEYS.indexOf(key) < 0) pairs.push([key, fields[key]]);
    });
    return pairs;
  }

  // env: {window, document, storage, crypto, location, now, send, endpoint, setInterval}
  function create(env) {
    var player = storedPlayer(env.storage, env.crypto);
    var session = randomId(env.crypto);
    var sequence = 0;
    var started = false;
    var lastInput = -Infinity;
    var lastTick = env.now();
    var activeMs = 0;
    var engagedCheck = null;

    function engaged() {
      try {
        return Boolean(engagedCheck && engagedCheck());
      } catch (error) {
        return false;
      }
    }

    function account() {
      var now = env.now();
      var isEngaged = engaged();
      // A suspended or throttled page cannot claim the time it was asleep.
      var gap = Math.min(now - lastTick, isEngaged ? ENGAGED_GAP_MS : 2 * TICK_MS);
      lastTick = now;
      var visible = env.document.visibilityState === 'visible';
      if (gap > 0 && (isEngaged || (visible && now - lastInput <= IDLE_MS))) activeMs += gap;
    }

    function ping(event, fields) {
      account();
      var seconds = Math.floor(activeMs / 1000);
      activeMs -= seconds * 1000;
      var pairs = [
        ['v', 1], ['e', event], ['p', player], ['s', session],
        ['n', sequence++], ['t', seconds], ['pg', env.location.pathname]
      ].concat(gameFields(fields));
      try {
        env.send(env.endpoint + '?' + query(pairs));
      } catch (error) {
        // Statistics must never break the application.
      }
    }

    function flushTime() {
      account();
      if (started && activeMs >= 1000) ping('time');
    }

    function onInput() {
      var now = env.now();
      if (!started) {
        account();
        lastTick = now;
        lastInput = now;
        started = true;
        ping('play');
        return;
      }
      lastInput = now;
    }

    INPUT_EVENTS.forEach(function (name) {
      env.window.addEventListener(name, onInput, {capture: true, passive: true});
    });
    env.document.addEventListener('visibilitychange', function () {
      if (env.document.visibilityState === 'hidden') flushTime();
      else if (engaged()) account();
      else lastTick = env.now();
    });
    env.window.addEventListener('pagehide', flushTime);
    env.setInterval(function () {
      account();
      if (started && activeMs >= FLUSH_MS) ping('time');
    }, TICK_MS);

    return {
      game: function (fields) {
        if (!started) {
          started = true;
          lastInput = env.now();
        }
        ping('game', fields);
      },
      engaged: function (check) {
        engagedCheck = typeof check === 'function' ? check : null;
      }
    };
  }

  function send(url) {
    var options = {cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'};
    try {
      options.keepalive = true;
      root.fetch(url, options).catch(function () {});
    } catch (error) {
      delete options.keepalive;
      root.fetch(url, options).catch(function () {});
    }
  }

  var location = root.location;
  var host = location && location.hostname;
  var endpoint = ENDPOINTS[host];
  var prefix = PATH_PREFIXES[host];
  var enabled = Boolean(endpoint) &&
    (!prefix || location.pathname.indexOf(prefix) === 0) &&
    typeof root.fetch === 'function' && Boolean(root.crypto && root.crypto.getRandomValues);
  var api = {game: function () {}, engaged: function () {}};
  if (enabled) {
    var storage = null;
    try {
      storage = root.localStorage;
    } catch (error) {
      // Blocked storage: each page load gets its own player number.
    }
    try {
      api = create({
        window: root,
        document: root.document,
        storage: storage,
        crypto: root.crypto,
        location: location,
        now: function () { return Date.now(); },
        send: send,
        endpoint: endpoint,
        setInterval: function (callback, ms) { return root.setInterval(callback, ms); }
      });
    } catch (error) {
      // Storage or listeners unavailable: the application runs without statistics.
    }
  }
  root.FusekiStats = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = {create: create, ENDPOINTS: ENDPOINTS};
  }
})(typeof window !== 'undefined' ? window : globalThis);

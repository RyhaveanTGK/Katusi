/* assets/js/app.js
   Ortak istemci tarafı yardımcıları.
   footer.php (alt quick-nav) tarafından yüklenir.

   İçerik:
     - window.Sound : ses yöneticisi (RAMTASK Faz 7 · 12.4)
         Sound.play('event_key')      → admin'in o olaya atadığı sesi çalar
         Sound.setVolume(0..100)       → anlık ses seviyesi (kaydeder)
         Sound.setEnabled(true/false)  → ses aç/kapa (kaydeder)
         Sound.isEnabled() / .getVolume()
     Ses ayarı hesaba bağlıdır (user_settings); sound-config.php'den yüklenir,
     save-settings.php ile kaydedilir. localStorage KULLANILMAZ. */
(function () {
  'use strict';

  /* ── CSRF token'ı sayfadan yakala (varsa) ───────────────────────
     Sayfalarda <meta name="csrf-token" content="..."> veya gizli
     input olabilir. Bulunamazsa kaydetme sessizce atlanır. */
  function csrfToken() {
    var m = document.querySelector('meta[name="csrf-token"]');
    if (m && m.content) return m.content;
    var i = document.querySelector('input[name="csrf_token"]');
    if (i && i.value) return i.value;
    return null;
  }

  var Sound = (function () {
    var map = {};        // event_key -> url|null
    var cache = {};      // url -> HTMLAudioElement (şablon)
    var enabled = true;  // user_settings.sound_on
    var volume = 80;     // 0..100
    var loaded = false;
    var readyQ = [];     // konfiq yüklənənə qədər gözləyən geri çağırışlar

    function flushReady() {
      while (readyQ.length) {
        var cb = readyQ.shift();
        try { cb(); } catch (e) { /* yox say */ }
      }
    }

    function applyConfig(cfg) {
      if (!cfg) return;
      map = cfg.sounds || {};
      if (typeof cfg.sound_on !== 'undefined') enabled = !!Number(cfg.sound_on);
      if (typeof cfg.volume !== 'undefined') volume = clampVol(cfg.volume);
      loaded = true;
      flushReady();
    }

    function clampVol(v) {
      v = parseInt(v, 10);
      if (isNaN(v)) v = 80;
      return Math.max(0, Math.min(100, v));
    }

    function load() {
      // Yalnız giriş yapan sayfalarda anlamlı; hata olursa sessiz geç.
      return fetch('sound-config.php', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (cfg) { applyConfig(cfg); })
        .catch(function () { /* ses sistemi yoksa sessiz */ });
    }

    function play(eventKey) {
      if (!enabled) return;
      var url = map[eventKey];
      if (!url) return; // admin atamamış / kapalı
      try {
        var tpl = cache[url];
        if (!tpl) {
          tpl = new Audio(url);
          tpl.preload = 'auto';
          cache[url] = tpl;
        }
        // Üst üste çalabilmek için klon kullan.
        var a = tpl.cloneNode(true);
        a.volume = volume / 100;
        var p = a.play();
        if (p && p.catch) p.catch(function () { /* otomatik oynatma engeli vb. */ });
      } catch (e) { /* yok say */ }
    }

    /* Sunucuya kişisel ayarı yaz (debounce'lu). */
    var saveTimer = null;
    function persist() {
      var token = csrfToken();
      if (!token) return; // token yoksa yalnız oturum içinde geçerli
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        var body = new URLSearchParams();
        body.set('csrf_token', token);
        body.set('sound_on', enabled ? '1' : '0');
        body.set('volume', String(volume));
        fetch('save-settings.php', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString()
        }).catch(function () { /* sessiz */ });
      }, 250);
    }

    return {
      load: load,
      play: play,
      setEnabled: function (on) { enabled = !!on; persist(); },
      isEnabled: function () { return enabled; },
      setVolume: function (v) { volume = clampVol(v); persist(); },
      getVolume: function () { return volume; },
      isLoaded: function () { return loaded; },
      // Səhifə açılış səsləri üçün: konfiq yüklənəndən sonra cb çağırılır.
      whenReady: function (cb) {
        if (typeof cb !== 'function') return;
        if (loaded) { try { cb(); } catch (e) {} }
        else { readyQ.push(cb); }
      },
      // setting.php gibi sayfalar config'i hazır aldıysa elle besleyebilir:
      _apply: applyConfig
    };
  })();

  window.Sound = Sound;

  // Sayfa açılışında ses ayarını yükle (giriş yoksa sessizce başarısız olur).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { Sound.load(); });
  } else {
    Sound.load();
  }
})();

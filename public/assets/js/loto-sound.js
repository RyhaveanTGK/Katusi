/**
 * One Loto — səs mühərriki (WebAudio, xarici fayl tələb etmir)
 *  - LotoSound.draw(n)  → yeni daş çıxdıqda "top yuvarlanır + zəng" səsi
 *  - LotoSound.place()  → daş bilete qoyulduqda "tık" səsi
 *  - LotoSound.buy()    → bilet alındıqda
 *  - LotoSound.del()    → bilet/işarə silindikdə
 *  - LotoSound.refresh()→ bilet yenilədikdə
 *  - LotoSound.change() → bilet dəyişdirildikdə
 *  - LotoSound.win()    → bilet tam dolub qazandıqda fanfar
 *  - LotoSound.toggle() → səsi aç/bağla (localStorage-da saxlanılır)
 */
(function (global) {
  var STORAGE_KEY = 'loto_sound_on';
  var ctx = null;

  function enabled() {
    var v = null;
    try { v = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    return v === null ? true : v === '1';
  }

  function setEnabled(on) {
    try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch (e) {}
  }

  function ac() {
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(opts) {
    if (!enabled()) return;
    var c = ac();
    if (!c) return;
    var t0 = c.currentTime + (opts.delay || 0);
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.from || 440, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + (opts.dur || 0.2));
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.vol || 0.18, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + (opts.dur || 0.2));
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + (opts.dur || 0.2) + 0.02);
  }

  function noise(dur, vol) {
    if (!enabled()) return;
    var c = ac();
    if (!c) return;
    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource();
    src.buffer = buf;
    var filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1400;
    var gain = c.createGain();
    gain.gain.value = vol || 0.12;
    src.connect(filter).connect(gain).connect(c.destination);
    src.start();
  }

  var LotoSound = {
    isOn: enabled,
    setOn: function (on) { setEnabled(on); if (on) tone({ from: 660, to: 990, dur: 0.12, type: 'triangle', vol: 0.12 }); },
    toggle: function () { var next = !enabled(); this.setOn(next); return next; },
    unlock: function () { ac(); },
    /** daş çıxdı — top fırlanır və dayanır */
    draw: function () {
      noise(0.22, 0.09);
      tone({ from: 320, to: 720, dur: 0.22, type: 'triangle', vol: 0.16 });
      tone({ from: 880, to: 1320, dur: 0.18, type: 'sine', vol: 0.12, delay: 0.16 });
    },
    /** daş bilete qoyuldu — qısa, quru "tık" */
    place: function () {
      noise(0.06, 0.08);
      tone({ from: 1180, to: 620, dur: 0.09, type: 'square', vol: 0.09 });
    },
    /** balans artdı — qəpik (sikkə) səsi */
    coin: function () {
      noise(0.05, 0.05);
      tone({ from: 1760, to: 2640, dur: 0.09, type: 'square', vol: 0.11 });
      tone({ from: 2640, to: 3520, dur: 0.14, type: 'square', vol: 0.09, delay: 0.07 });
      tone({ from: 1320, dur: 0.18, type: 'triangle', vol: 0.07, delay: 0.05 });
    },
    /** bilet alındı — kassa/uğur akkordu */
    buy: function () {
      tone({ from: 523, to: 784, dur: 0.14, type: 'triangle', vol: 0.18 });
      tone({ from: 784, to: 1046, dur: 0.16, type: 'triangle', vol: 0.16, delay: 0.11 });
      tone({ from: 1046, to: 1568, dur: 0.22, type: 'sine', vol: 0.13, delay: 0.22 });
      noise(0.07, 0.05);
    },
    /** bilet/işarə silindi — aşağı düşən "swoosh" */
    del: function () {
      noise(0.14, 0.07);
      tone({ from: 620, to: 180, dur: 0.24, type: 'sawtooth', vol: 0.13 });
      tone({ from: 300, to: 120, dur: 0.18, type: 'sine', vol: 0.08, delay: 0.1 });
    },
    /** yenilə — qısa fırlanan/qarışdıran səs */
    refresh: function () {
      noise(0.1, 0.06);
      tone({ from: 440, to: 880, dur: 0.16, type: 'triangle', vol: 0.13 });
      tone({ from: 880, to: 660, dur: 0.12, type: 'triangle', vol: 0.1, delay: 0.14 });
    },
    /** dəyişdir — iki addımlı "blip-blop" */
    change: function () {
      tone({ from: 990, to: 1320, dur: 0.09, type: 'square', vol: 0.1 });
      tone({ from: 700, to: 520, dur: 0.11, type: 'square', vol: 0.09, delay: 0.1 });
    },
    /** sayğac / düymə tıkkısı */
    tick: function () {
      tone({ from: 900, to: 900, dur: 0.05, type: 'square', vol: 0.07 });
    },
    /** xəta */
    error: function () {
      tone({ from: 320, to: 180, dur: 0.2, type: 'sawtooth', vol: 0.12 });
      tone({ from: 200, to: 140, dur: 0.22, type: 'sawtooth', vol: 0.1, delay: 0.12 });
    },
    /** bilet tam doldu */
    win: function () {
      [0, 0.12, 0.24, 0.4].forEach(function (d, i) {
        tone({ from: [523, 659, 784, 1046][i], dur: i === 3 ? 0.5 : 0.16, type: 'triangle', vol: 0.2, delay: d });
      });
    }
  };

  global.LotoSound = LotoSound;

  // İlk toxunuşda audio context-i aç (mobil brauzer tələbi)
  ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
    global.addEventListener(ev, function once() {
      LotoSound.unlock();
      global.removeEventListener(ev, once);
    }, { passive: true });
  });
})(window);

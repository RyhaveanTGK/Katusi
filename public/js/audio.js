/* Birloto — səs effektləri (Web Audio API ilə; heç bir fayl yüklənmir).
   Debounce time-limits: eyni hadisə bir-birinin ardınca təkrarlanmır. */
(function () {
  'use strict';
  const A = {
    ctx: null, muted: false,
    _last: {},
    _limits: { draw:1300, mark:250, win:4000, lose:4000, ticket:1200, coin:600, bet:1000, click:200 },
    _enabled: { draw:true, mark:true, win:true, lose:true, ticket:true, coin:true, bet:true, click:true },
    _ensure() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch (e) { this.ctx = null; }
    },
    setMuted(v) { this.muted = !!v; if (!v) this._ensure(); },
    _ok(k) {
      if (this.muted || !this._enabled[k]) return false;
      const now = Date.now(), l = this._limits[k]||0;
      if (this._last[k] && now - this._last[k] < l) return false;
      this._last[k] = now; return true;
    },
    _blip(freq, dur, type, gain) {
      this._ensure(); if (!this.ctx) return;
      try {
        const ctx = this.ctx, osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = type||'sine'; osc.frequency.value = freq;
        osc.connect(g); g.connect(ctx.destination);
        const t0 = ctx.currentTime;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(gain||0.18, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.start(t0); osc.stop(t0 + dur + 0.05);
      } catch (e) {}
    },
    draw() { if (this._ok('draw')) { this._blip(880, 0.08, 'triangle', 0.14); setTimeout(() => this._blip(660, 0.12, 'sine', 0.10), 60); } },
    mark() { if (this._ok('mark')) this._blip(620, 0.06, 'square', 0.12); },
    ticket() {
      if (!this._ok('ticket')) return;
      this._blip(720, 0.08, 'sine', 0.16);
      setTimeout(() => this._blip(960, 0.10, 'sine', 0.16), 80);
      setTimeout(() => this._blip(1200, 0.10, 'sine', 0.14), 180);
    },
    win() {
      if (!this._ok('win')) return;
      [523,659,784,1046].forEach((f,i)=>setTimeout(()=>this._blip(f,0.18,'triangle',0.20), i*140));
    },
    lose() { if (!this._ok('lose')) return; this._blip(440,0.18,'sawtooth',0.10); setTimeout(()=>this._blip(220,0.30,'sawtooth',0.10),180); },
    coin() { if (!this._ok('coin')) return; this._blip(1320,0.06,'sine',0.14); setTimeout(()=>this._blip(1480,0.10,'sine',0.12),60); },
    bet()  { if (!this._ok('bet'))  return; this._blip(560,0.10,'square',0.12); setTimeout(()=>this._blip(380,0.10,'square',0.10),80); },
    click(){ if (this._ok('click')) this._blip(800, 0.04, 'sine', 0.08); }
  };
  window.BirlotoAudio = A;
})();

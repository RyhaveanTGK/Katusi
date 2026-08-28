/* Birloto oyun ekranı — serverdən gələn random daşları göstərir, kartları render edir,
   balansı server-otoritativ kimi qəbul edir, səs effektlərini çağırır. Auto-play YOXDUR. */
(function () {
  'use strict';
  const ROOM = window.ROOM || {}; const USER = window.USER || {};
  const ROOM_ID = ROOM._id;
  const $ = (id) => document.getElementById(id);
  const balVal=$('balVal'), trophyEl=$('cupVal');
  const playersToggle=$('playersToggle'), playersCount=$('playersCount'), playersCountMini=$('playersCountMini');
  const timerText=$('timerText'), statusText=$('statusText');
  const ballEl=$('ballEl'), drawList=$('drawList');
  const qtyVal=$('qtyVal'), buyBtnAmt=$('buyBtnAmt'), winPotential=$('winPotential'), buyBtn=$('buyBtn');
  const toolRow=$('toolRow');
  const playersModal=$('playersModal'), playersListFull=$('playersListFull'), playerTotalLabel=$('playerTotalLabel');
  const playersListMini=$('playersListMini');
  const muteBtn=$('muteBtn'), discardBtn=$('discardBtn');
  const toast=$('toast');
  const winBanner=$('winBanner'), winBannerPrize=$('winBannerPrize');

  const state = {
    balance: USER.balance||0, qty:2, cards:[], drawn:new Set(),
    rounds: ROOM.currentRoundId||1, status: ROOM.status||'waiting',
    roundEndsAt: ROOM.roundEndsAt ? new Date(ROOM.roundEndsAt) : null,
    drawIntervalSec: ROOM.drawIntervalSec||5, markGraceSec: ROOM.markGraceSec||12
  };

  function refreshMuteIcon(){ if(!muteBtn)return;
    muteBtn.querySelector('.material-symbols-outlined').textContent = window.BirlotoAudio.muted?'volume_off':'volume_up'; }
  if (muteBtn) muteBtn.addEventListener('click', () => {
    window.BirlotoAudio.setMuted(!window.BirlotoAudio.muted); refreshMuteIcon();
    if (!window.BirlotoAudio.muted) window.BirlotoAudio.click();
  });
  refreshMuteIcon();

  let toastT;
  function showToast(t, color) {
    if (!toast) return;
    toast.textContent = t;
    toast.style.background = color || 'rgba(16,12,24,.94)';
    toast.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(()=>toast.classList.remove('show'), 2200);
  }

  function setBalance(v){ state.balance = Number(v)||0; if (balVal) balVal.textContent = state.balance.toFixed(2); }
  setBalance(state.balance);
  async function refreshBalance(){
    try{ const r = await fetch('/balance', {cache:'no-store'}); const d=await r.json();
      if (d && typeof d.balance==='number') setBalance(d.balance); }catch(e){}
  }
  setInterval(refreshBalance, 5000);

  function setQty(v) {
    state.qty = Math.max(1, Math.min(10, v|0));
    qtyVal.textContent = String(state.qty);
    const amt = (state.qty * ROOM.entryFee);
    buyBtnAmt.textContent = amt.toFixed(2);
    const pot = (ROOM.entryFee<=0.2) ? state.qty*200 : (ROOM.entryFee<=0.5) ? state.qty*100 : (ROOM.entryFee<=1) ? state.qty*50 : (ROOM.entryFee<=5) ? state.qty*5 : state.qty*2;
    winPotential.textContent = String(pot);
  }
  setQty(state.qty);
  $('qtyPlus').addEventListener('click', ()=>{ window.BirlotoAudio.click(); setQty(state.qty+1); });
  $('qtyMinus').addEventListener('click', ()=>{ window.BirlotoAudio.click(); setQty(state.qty-1); });

  function renderCards(){
    toolRow.innerHTML = '';
    state.cards.forEach((c, idx) => {
      const div = document.createElement('div'); div.className='ticket'; div.dataset.cardId=c._id;
      const tools = document.createElement('div'); tools.className='ticket-tools';
      tools.innerHTML = `
        <button class="tool" data-act="refresh"><span class="material-symbols-outlined">refresh</span><span class="tool-label">yenilə</span></button>
        <button class="tool" data-act="delete"><span class="material-symbols-outlined">delete</span><span class="tool-label">sil</span></button>
        <button class="tool" data-act="edit"><span class="material-symbols-outlined">edit</span><span class="tool-label">dəyiş</span></button>
        <span class="ticket-no">#${idx+1}</span>`;
      div.appendChild(tools);

      const grid = document.createElement('div'); grid.className='grid';
      const numbers = c.numbers||[];
      for (let r=0; r<3; r++) {
        const row = numbers[r]||[];
        for (let col=0; col<9; col++) {
          const cell = document.createElement('div');
          const v = row[col];
          if (v == null) { cell.className='cell empty'; }
          else {
            cell.className='cell clickable'; cell.textContent = String(v); cell.dataset.num = String(v);
            if (state.drawn.has(Number(v))) cell.classList.add('drawn');
            if ((c.markedNumbers||[]).includes(Number(v))) cell.classList.add('marked');
          }
          grid.appendChild(cell);
        }
      }
      div.appendChild(grid);

      const foot = document.createElement('div'); foot.className='ticket-foot';
      foot.innerHTML = `<span>Daş: <b style="color:#f5c518">${(c.markedNumbers||[]).length}/15</b></span>
        <div class="progress"><i style="width:${(((c.markedNumbers||[]).length/15)*100).toFixed(0)}%"></i></div>`;
      div.appendChild(foot);
      toolRow.appendChild(div);

      div.querySelector('[data-act="refresh"]').addEventListener('click', () => { window.BirlotoAudio.click(); refreshOneCard(idx); });
      div.querySelector('[data-act="delete"]').addEventListener('click', () => { window.BirlotoAudio.click(); deleteCard(c._id); });
      div.querySelector('[data-act="edit"]').addEventListener('click', () => { window.BirlotoAudio.click(); showToast('Dəyiş funksiyası tezliklə'); });
      grid.querySelectorAll('.cell').forEach(cell => { if (!cell.classList.contains('empty')) cell.addEventListener('click', ()=>onCellClick(c._id, cell)); });
    });
  }

  function updateDrawnUI(){
    if (!state.cards.length) return;
    state.cards.forEach(c => {
      const grid = toolRow.querySelector(`.ticket[data-card-id="${c._id}"] .grid`);
      if (!grid) return;
      grid.querySelectorAll('.cell').forEach(cell => {
        if (cell.classList.contains('empty')) return;
        const v = Number(cell.dataset.num);
        if (state.drawn.has(v)) cell.classList.add('drawn');
        if ((c.markedNumbers||[]).includes(v)) cell.classList.add('marked');
      });
      const foot = toolRow.querySelector(`.ticket[data-card-id="${c._id}"] .ticket-foot`);
      if (foot) {
        foot.querySelector('b').textContent = `${(c.markedNumbers||[]).length}/15`;
        const i = foot.querySelector('i');
        if (i) i.style.width = ((c.markedNumbers||[]).length/15*100).toFixed(0)+'%';
      }
    });
  }

  function onCellClick(cardId, cell){
    if (state.status !== 'started') { showToast('Oyun başlaymayıb'); return; }
    const num = Number(cell.dataset.num);
    if (!state.drawn.has(num)) { showToast('Bu daş hələ çıxmayıb'); return; }
    if (cell.classList.contains('marked')) return;
    const card = state.cards.find(c => c._id===cardId);
    if (!card) return;
    card.markedNumbers = card.markedNumbers||[];
    if (!card.markedNumbers.includes(num)) card.markedNumbers.push(num);
    cell.classList.add('marked'); cell.classList.remove('clickable');
    window.BirlotoAudio.mark();
    fetch('/api/room/' + ROOM_ID + '/mark', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ cardId, number: num }) }).catch(()=>{});
  }

  buyBtn.addEventListener('click', async () => {
    try {
      window.BirlotoAudio.bet();
      buyBtn.disabled = true;
      const r = await fetch('/api/room/' + ROOM_ID + '/buy-ticket', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ qty: state.qty })
      });
      const d = await r.json();
      if (!d.ok) {
        showToast(d.error||'Xəta', 'rgba(232,0,26,.95)');
        if (d.error && d.error.indexOf('balans')>=0) window.BirlotoAudio.lose();
        return;
      }
      state.cards = d.cards||[];
      state.drawn = new Set((d.room && d.room.drawnNumbers) || []);
      if (state.cards.length > 0) window.BirlotoAudio.ticket();
      if (typeof d.balance === 'number') setBalance(d.balance);
      renderCards();
      showToast('Bilet alındı ✓', 'rgba(22,166,45,.95)');
    } catch (e) { showToast('Şəbəkə xətası'); }
    finally { buyBtn.disabled = false; }
  });

  async function deleteCard(cardId){
    try{
      const r = await fetch('/api/room/' + ROOM_ID + '/discard', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ cardId }) });
      const d = await r.json();
      if (!d.ok) { showToast('Silmə xətası'); return; }
      window.BirlotoAudio.lose();
      state.cards = state.cards.filter(c => c._id !== cardId);
      refreshBalance();
      renderCards();
      showToast('Kart silindi, balans qaytarıldı');
    } catch (e) { showToast('Silmə xətası'); }
  }

  async function refreshOneCard(idx) {
    if (!state.cards[idx]) return;
    const oldId = state.cards[idx]._id;
    await deleteCard(oldId);
    const prevQty = state.qty; setQty(1); buyBtn.click();
    setQty(prevQty);
  }

  if (discardBtn) discardBtn.addEventListener('click', () => {
    if (!state.cards.length) { showToast('Silinəcək kart yoxdur'); return; }
    deleteCard(state.cards[state.cards.length-1]._id);
  });

  if (playersToggle) {
    playersToggle.addEventListener('click', () => openPlayersModal());
    playersToggle.addEventListener('keypress', e => { if (e.key==='Enter'||e.key===' ') openPlayersModal(); });
  }
  $('closePM').addEventListener('click', closePlayersModal);
  function openPlayersModal(){ playersModal.classList.add('open'); refreshPlayers(true); }
  function closePlayersModal(){ playersModal.classList.remove('open'); }

  async function refreshPlayers(forceFull){
    try{
      const r = await fetch('/api/room/' + ROOM_ID + '/players'); const d = await r.json();
      const count = d.count||0;
      if (playersCount) playersCount.textContent = String(count);
      if (playersCountMini) playersCountMini.textContent = String(count);
      if (playerTotalLabel) playerTotalLabel.textContent = `${d.realCount||0} real · ${d.botCount||0} bot`;

      if (playersListMini) {
        playersListMini.innerHTML='';
        (d.players||[]).slice(0,6).forEach(p => {
          const row = document.createElement('div'); row.className='player-row';
          row.innerHTML = `<div class="player-av" style="${p.isBot?'background:linear-gradient(180deg,#9eb1ff,#3f5fcf);color:#fff':''}">${p.isBot?'B':(p.name||'').slice(0,2).toUpperCase()}</div>
            <div class="player-name">${escapeHtml(p.name||'')}${p.isBot?' <span style="color:#9eb1ff;font-size:11px;font-weight:800">BOT</span>':''}</div>
            <div class="player-bet">${(p.stake||0).toFixed(2)}<small>₼</small></div>`;
          playersListMini.appendChild(row);
        });
      }
      if (forceFull && playersListFull) {
        playersListFull.innerHTML='';
        (d.players||[]).forEach(p => {
          const row = document.createElement('div'); row.className='pm-row';
          row.innerHTML = `<div class="av ${p.isBot?'bot':''}">${p.isBot?'B':(p.name||'').slice(0,2).toUpperCase()}</div>
            <div class="name">${escapeHtml(p.name||'')}</div>
            ${p.isBot?'<span class="bot-tag">BOT</span>':''}
            <div class="stake">${(p.stake||0).toFixed(2)} ₼</div>`;
          playersListFull.appendChild(row);
        });
      }
    } catch (e) {}
  }
  function escapeHtml(s){return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  setInterval(()=>refreshPlayers(false), 3500);

  /* Serverdən gələn daşları oxuyur (RANDOM server qərar verir) */
  async function refreshState(){
    try{
      const r = await fetch('/api/room/' + ROOM_ID + '/state');
      if (!r.ok) return;
      const d = await r.json();
      const prevStatus = state.status;
      state.status = d.status; state.rounds = d.currentRoundId;
      state.drawIntervalSec = d.drawIntervalSec || state.drawIntervalSec;
      state.markGraceSec = d.markGraceSec || state.markGraceSec;
      state.roundEndsAt = d.roundEndsAt ? new Date(d.roundEndsAt) : null;

      if (d.status === 'started') statusText.textContent = 'CANLI';
      else if (d.status === 'ended') statusText.textContent = 'BİTİB';
      else statusText.textContent = 'GÖZLƏYİR';

      const drawn = d.drawnNumbers||[];
      const before = state.drawn;
      const newly = drawn.filter(n => !before.has(n));
      state.drawn = new Set(drawn);

      ballEl.textContent = drawn.length ? drawn[drawn.length-1] : '?';
      if (newly.length) {
        ballEl.classList.remove('pop'); void ballEl.offsetWidth; ballEl.classList.add('pop');
        window.BirlotoAudio.draw();
      }

      const list = drawn.slice(-30).reverse();
      drawList.innerHTML = '';
      list.forEach((n, idx) => {
        const el = document.createElement('div');
        el.className = 'draw-item' + (idx===0?' latest':'');
        el.textContent = n;
        drawList.appendChild(el);
      });
      drawList.scrollLeft = 0;

      updateTimer();

      if (d.currentRoundId !== state.rounds || !state.cards.length) {
        // raund dəyişibsə və ya kart yoxdursa, kartları serverdən çək
        await loadMyCards();
      }

      if (trophyEl) trophyEl.textContent = ((d.basePot||d.stakeTotal)||0).toFixed(2);
      updateDrawnUI();

      if (d.status === 'started' && prevStatus === 'waiting') window.BirlotoAudio.draw();
    } catch (e) {}
  }
  setInterval(refreshState, 1100); refreshState();

  function updateTimer(){
    if (!state.roundEndsAt) { timerText.textContent='--:--'; return; }
    const left = Math.max(0, state.roundEndsAt.getTime() - Date.now());
    const total = Math.floor(left/1000);
    const mm = String(Math.floor(total/60)).padStart(2,'0');
    const ss = String(total%60).padStart(2,'0');
    timerText.textContent = mm+':'+ss;
  }
  setInterval(updateTimer, 1000);

  async function loadMyCards(){
    try{
      const r = await fetch('/api/room/' + ROOM_ID + '/mycards');
      const d = await r.json();
      if (d.ok) {
        state.cards = d.cards||[];
        state.drawn = new Set(d.drawnNumbers||[]);
        renderCards();
      }
    } catch (e) {}
  }
  loadMyCards();

  document.addEventListener('click', function once(){ try{ window.BirlotoAudio && window.BirlotoAudio._ensure(); }catch(e){} document.removeEventListener('click', once, true); }, true);
})();

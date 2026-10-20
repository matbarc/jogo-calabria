(function () {
  const { brl, signedBrl, pct, cls, esc, $ } = U;
  const app = $('#app');
  const socket = io({ transports: ['websocket', 'polling'] });
  U.connBadge(socket);

  const STORE = 'jogo-inv-team';
  const saved = () => { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } };
  const save = v => { try { v ? localStorage.setItem(STORE, JSON.stringify(v)) : localStorage.removeItem(STORE); } catch {} };

  let S = null; // último estado do servidor
  let screenKey = ''; // qual tela está montada
  let draft = null; // carteira sendo editada
  let unsynced = 0; // envios ainda sem resposta
  let sendTimer = null;

  // ------------------------------------------------------------ conexão
  socket.on('connect', () => {
    const s = saved();
    if (s && s.code && s.token) {
      socket.emit('team:resume', s, res => { if (!res || !res.ok) { save(null); renderJoin(); } });
    } else if (!S) renderJoin();
  });
  socket.on('state', st => {
    U.syncClock(st.serverNow);
    S = st;
    render();
  });
  socket.on('kicked', () => { save(null); S = null; screenKey = ''; renderJoin('O professor removeu este time. Entre de novo.'); });

  // ------------------------------------------------------------ entrar
  function renderJoin(msg) {
    screenKey = 'join';
    const params = new URLSearchParams(location.search);
    const code = params.get('code') || (saved() || {}).code || '';
    app.innerHTML = `
      <div class="hero anim-up">
        <div class="eyebrow">IEE Impacto · Aula 5</div>
        <h1>Jogo de Investimento</h1>
        <p>Digite o código que aparece no telão e o nome do seu time.</p>
      </div>
      <form class="card anim-up" id="join" autocomplete="off">
        <label class="field"><span>Código da sala</span>
          <input id="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" value="${esc(code)}" placeholder="000000" class="num"></label>
        <label class="field"><span>Nome do time</span>
          <input id="name" maxlength="24" placeholder="Ex.: Os Investidores" autocapitalize="words"></label>
        <button class="btn gold block" type="submit">Entrar</button>
        <p class="err" id="err">${msg ? esc(msg) : ''}</p>
      </form>`;
    const f = $('#join');
    (code ? $('#name') : $('#code')).focus();
    f.onsubmit = e => {
      e.preventDefault();
      const btn = f.querySelector('button');
      btn.disabled = true;
      socket.emit('team:join', { code: $('#code').value.trim(), name: $('#name').value }, res => {
        btn.disabled = false;
        if (!res || !res.ok) { $('#err').textContent = (res && res.error) || 'Não foi possível entrar.'; return; }
        save({ code: res.code, token: res.token });
        history.replaceState(null, '', '/');
        if (res.resumed) U.toast('Bem-vindos de volta! A carteira de vocês foi mantida.');
      });
    };
  }

  // ------------------------------------------------------------ render
  function render() {
    if (!S || !S.me) return;
    const key = S.phase + ':' + (S.round ? S.round.n : 0) + (S.phase === 'reveal' ? ':' + S.showWhy : '');
    if (S.phase === 'decide') {
      if (screenKey !== key) { draft = { ...S.me.holdings }; unsynced = 0; renderDecide(); screenKey = key; }
      else updateDecide();
      return;
    }
    if (S.phase === 'lobby') renderLobby();
    else if (S.phase === 'reveal') { if (screenKey !== key) renderReveal(screenKey.startsWith('reveal:') ? false : true); else renderReveal(false); }
    else if (S.phase === 'final') renderFinal();
    screenKey = key;
  }

  function header() {
    return `<header class="app"><span class="team">${esc(S.me.name)}</span><span class="eyebrow">Sala ${esc(S.code)}</span></header>`;
  }

  function renderLobby() {
    const m = S.me;
    app.innerHTML = `${header()}
      <div class="hero anim-up" style="padding-top:28px">
        <div class="eyebrow">Vocês estão dentro</div>
        <h1>Prontos, ${esc(m.name)}!</h1>
        <p>Aguardem o professor começar a primeira rodada<span class="dots"></span></p>
      </div>
      <div class="card anim-up">
        <div class="eyebrow" style="color:var(--muted)">Ponto de partida</div>
        <div class="summary" style="margin:8px 0 4px">
          <div><div class="lbl">Caixa inicial</div><div class="big num">${brl(m.startCash)}</div></div>
          ${m.tampinhas ? `<div class="cash"><div class="lbl">Bônus do Kahoot</div><div class="big num">+${brl(m.tampinhas * S.settings.rateIn)}</div></div>` : ''}
        </div>
        <p style="color:var(--muted);margin:10px 0 0">Em cada rodada aparece uma notícia. Vocês decidem quanto colocar em cada ativo. O que não for investido fica no caixa.</p>
        <div class="rows">${S.assets.map(a => `<div class="row"><span class="n"><span class="swatch" style="background:${a.color}"></span>${a.name}</span><span class="flat" style="font-size:14px">${a.tag}</span><span class="v num">${brl(S.initialPrices[a.key], true)}</span></div>`).join('')}</div>
      </div>
      <p class="wait">${S.teamCount} ${S.teamCount === 1 ? 'time conectado' : 'times conectados'}</p>`;
  }

  // ------------------------------------------------------------ decisão
  const STEPS = [-100, -10, 10, 100];
  function invested() { return S.assets.reduce((s, a) => s + (draft[a.key] || 0), 0); }

  function renderDecide() {
    const r = S.round;
    app.innerHTML = `${header()}
      <section class="news anim-pop">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="eyebrow">Rodada ${r.n} de ${r.total}</span>
          <span class="timer hidden" id="timer"></span>
        </div>
        <div class="bar"></div>
        <h2>${esc(r.title)}</h2>
        <p>${esc(r.news)}</p>
      </section>
      <div id="editor">
        <div class="summary">
          <div><div class="lbl">Patrimônio</div><div class="big num" id="total"></div></div>
          <div class="cash"><div class="lbl">No caixa</div><div class="big num" id="cash"></div></div>
        </div>
        <div class="compo" id="compo">${S.assets.map(a => `<div data-k="${a.key}" style="background:${a.color};width:0"></div>`).join('')}<div class="c-cash" style="flex:1"></div></div>
        <div id="assets">${S.assets.map(a => `
          <div class="asset" style="--c:${a.color}" data-k="${a.key}">
            <div class="top">
              <div><div class="name">${a.name}</div><div class="price">Preço agora: ${brl(r.pricesBefore[a.key], true)}</div></div>
              <input class="val num" inputmode="numeric" aria-label="Valor em ${a.name}" data-k="${a.key}">
            </div>
            <div class="steps">${STEPS.map(s => `<button type="button" data-k="${a.key}" data-s="${s}" class="${s > 0 ? 'plus' : ''}">${s > 0 ? '+' : '−'}${Math.abs(s)}</button>`).join('')}</div>
          </div>`).join('')}
        </div>
        <div class="mini-actions">
          <button class="link" id="sellAll" type="button">Tudo para o caixa</button>
          <span class="flat" style="font-size:14px;align-self:center">Valores em R$</span>
        </div>
      </div>
      <div class="dock"><div class="inner">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span style="font-weight:700;color:var(--muted)">No caixa: <b class="num up" id="dockCash" style="font-size:20px"></b></span>
          <span class="timer hidden" id="timer2"></span>
        </div>
        <button class="btn gold block" id="ready">Confirmar carteira</button>
        <div class="status-line" id="status"></div>
      </div></div>`;

    $('#assets').addEventListener('click', e => {
      const b = e.target.closest('button[data-s]');
      if (!b || S.me.ready) return;
      const k = b.dataset.k, step = Number(b.dataset.s);
      const total = S.me.total;
      const free = total - invested();
      let v = draft[k] + step;
      if (step > 0) v = draft[k] + Math.min(step, free);
      draft[k] = Math.max(0, v);
      queueSend();
      updateDecide();
    });
    $('#assets').addEventListener('change', e => {
      const inp = e.target.closest('input.val');
      if (!inp) return;
      const k = inp.dataset.k;
      const raw = Math.max(0, Math.floor(Number(String(inp.value).replace(/\D/g, '')) || 0));
      const others = invested() - draft[k];
      const max = S.me.total - others;
      if (raw > max) U.toast(`Só cabem ${brl(max)} aqui. O resto já está investido.`);
      draft[k] = Math.min(raw, max);
      queueSend();
      updateDecide();
    });
    $('#assets').addEventListener('focusin', e => { if (e.target.matches('input.val')) setTimeout(() => e.target.select(), 0); });
    $('#sellAll').onclick = () => { if (S.me.ready) return; S.assets.forEach(a => (draft[a.key] = 0)); queueSend(); updateDecide(); };
    $('#ready').onclick = () => {
      flushSend(() => socket.emit('team:ready', { ready: !S.me.ready }));
    };
    updateDecide();
  }

  function queueSend() {
    unsynced++;
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => flushSend(), 180);
  }
  function flushSend(after) {
    clearTimeout(sendTimer);
    if (unsynced === 0) { after && after(); return; }
    const sentCount = unsynced;
    socket.emit('team:allocate', { holdings: draft }, res => {
      unsynced = Math.max(0, unsynced - sentCount);
      if (!res || !res.ok) {
        U.toast((res && res.error) || 'Não foi possível salvar.');
        if (S && S.phase === 'decide') { draft = { ...S.me.holdings }; updateDecide(); }
      }
      after && after();
    });
  }

  function updateDecide() {
    if (!$('#editor')) return;
    const m = S.me;
    if (unsynced === 0 && document.activeElement && !document.activeElement.matches('input.val')) draft = { ...m.holdings };
    const total = m.total;
    const inv = invested();
    const cash = total - inv;
    $('#total').textContent = brl(total);
    $('#cash').textContent = brl(cash);
    $('#dockCash').textContent = brl(cash);
    for (const a of S.assets) {
      const seg = $(`#compo [data-k="${a.key}"]`);
      seg.style.width = (total ? (draft[a.key] / total) * 100 : 0) + '%';
      const inp = $(`input.val[data-k="${a.key}"]`);
      if (document.activeElement !== inp) inp.value = brl(draft[a.key]).replace('R$ ', '');
      for (const b of document.querySelectorAll(`button[data-k="${a.key}"]`)) {
        const s = Number(b.dataset.s);
        b.disabled = m.ready || (s < 0 ? draft[a.key] <= 0 : cash <= 0);
      }
    }
    $('#editor').classList.toggle('locked', !!m.ready);
    const btn = $('#ready');
    btn.textContent = m.ready ? 'Mudar de ideia' : 'Confirmar carteira';
    btn.className = 'btn block ' + (m.ready ? 'ghost' : 'gold');
    $('#status').textContent = m.ready ? 'Carteira confirmada. Aguardem o professor revelar.' : 'Vocês podem mexer até o professor revelar o resultado.';
    tick();
  }

  function tick() {
    if (!S || S.phase !== 'decide') return;
    const left = U.timerLeft(S.timer);
    for (const el of [$('#timer'), $('#timer2')]) {
      if (!el) continue;
      if (left == null) { el.classList.add('hidden'); continue; }
      el.classList.remove('hidden');
      el.textContent = left > 0 ? '⏱ ' + U.fmtClock(left) : 'Tempo!';
      el.classList.toggle('low', left <= 10000);
    }
  }
  setInterval(tick, 250);

  // ------------------------------------------------------------ revelação
  function renderReveal(animate) {
    const r = S.round, m = S.me, lr = m.lastReveal;
    if (!lr) return;
    const diff = lr.totalAfter - lr.totalBefore;
    const rows = S.assets.filter(a => lr.before[a.key] > 0).map(a => {
      const d = lr.after[a.key] - lr.before[a.key];
      return `<div class="row"><span class="n"><span class="swatch" style="background:${a.color}"></span>${a.name} <span class="chip ${cls(r.delta[a.key])}">${pct(r.delta[a.key])}</span></span>
        <span class="v num flat"><small>antes</small>${brl(lr.before[a.key])}</span>
        <span class="v num ${cls(d)}"><small>agora</small>${brl(lr.after[a.key])}</span></div>`;
    }).join('');
    const others = S.assets.filter(a => !(lr.before[a.key] > 0));
    app.innerHTML = `${header()}
      <div class="${animate ? 'anim-pop' : ''}">
        <div class="eyebrow" style="text-align:center;margin-top:10px">Rodada ${r.n} · O que aconteceu</div>
        <h2 style="text-align:center;font-size:26px;margin-top:6px">${esc(r.title)}</h2>
        <div class="result-head">
          <div class="big num">${brl(lr.totalAfter)}</div>
          <div class="delta num ${cls(diff)}">${diff === 0 ? 'Sem mudança' : signedBrl(diff) + ' nesta rodada'}</div>
        </div>
        <div class="pos"><div class="medal">${m.pos}º</div><div><strong>${m.pos}º lugar</strong><br><span class="flat">de ${S.teamCount} ${S.teamCount === 1 ? 'time' : 'times'}</span></div></div>
        <div class="card" style="margin-top:18px">
          <div class="rows" style="margin-top:0">
            ${rows}
            <div class="row"><span class="n"><span class="swatch" style="background:#C9D3EA"></span>Caixa</span><span class="v num flat"><small>antes</small>${brl(lr.cash)}</span><span class="v num flat"><small>agora</small>${brl(lr.cash)}</span></div>
          </div>
          ${others.length ? `<p class="flat" style="font-size:14px;margin:10px 0 0">Fora da carteira: ${others.map(a => `${a.name} <span class="${cls(r.delta[a.key])}">${pct(r.delta[a.key])}</span>`).join(' · ')}</p>` : ''}
        </div>
        ${r.why ? `<div class="why anim-up"><div class="eyebrow">Por quê</div>${esc(r.why)}</div>` : ''}
        <p class="wait">${r.n < r.total ? 'Aguardem a próxima notícia' : 'Aguardem o resultado final'}<span class="dots"></span></p>
      </div>`;
  }

  // ------------------------------------------------------------ final
  function renderFinal() {
    const m = S.me;
    const ranking = S.ranking || [];
    const labels = ['Início'].concat(Array.from({ length: S.totalRounds }, (_, i) => 'R' + (i + 1)));
    app.innerHTML = `${header()}
      <div class="hero anim-pop" style="padding:20px 0 0;text-align:center">
        <div class="eyebrow">Fim de jogo</div>
        <div class="pos" style="margin-top:12px"><div class="medal" style="width:76px;height:76px;font-size:34px">${m.pos}º</div></div>
        <h1 style="margin-top:12px">${m.pos === 1 ? 'Vocês venceram!' : m.pos + 'º lugar'}</h1>
      </div>
      <div class="stats">
        <div class="stat"><div class="lbl">Patrimônio final</div><div class="val num">${brl(m.total)}</div></div>
        <div class="stat"><div class="lbl">Rendimento</div><div class="val num ${cls(m.yieldPct)}">${pct(m.yieldPct, 1)}</div></div>
        <div class="stat"><div class="lbl">Começaram com</div><div class="val num">${brl(m.startCash)}</div></div>
        <div class="stat gold"><div class="lbl">Tampinhas p/ leilão</div><div class="val num">${m.tampinhasOut}</div></div>
      </div>
      <div class="card" style="margin-top:14px">
        <div class="eyebrow" style="color:var(--muted)">Rodada a rodada</div>
        <div class="chart" id="chart" style="margin-top:8px"></div>
      </div>
      <div class="card" style="margin-top:14px">
        <div class="eyebrow" style="color:var(--muted)">Ranking</div>
        <div class="lb">${ranking.map(r => `<div class="r ${r.id === m.id ? 'me' : ''}"><span>${r.pos}º</span><span>${esc(r.name)}</span><span class="num">${brl(r.total)}</span></div>`).join('')}</div>
      </div>`;
    const hs = S.histories || [];
    const series = hs.map((h, i) => ({
      name: h.name, values: h.history,
      color: h.id === m.id ? '#C9992E' : '#9AA6C8', highlight: h.id === m.id,
    }));
    U.lineChart($('#chart'), series, labels, { width: 520, height: 300, labelSpace: 10, thin: true, aria: 'Patrimônio por rodada' });
  }
})();

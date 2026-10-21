(function () {
  const { brl, signedBrl, pct, cls, esc, $ } = U;
  const app = $('#app');
  const socket = io({ transports: ['websocket', 'polling'] });
  U.connBadge(socket);

  const ss = {
    get: k => { try { return sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} },
  };
  let password = ss.get('jogo-pw');
  let code = ss.get('jogo-code');
  let S = null;
  let drawerOpen = false;
  let finalTab = 'teams';
  let busy = false;
  const tpTimers = {};

  // ------------------------------------------------------------ conexão
  socket.on('connect', () => { if (password) login(password, true); else renderLogin(); });
  socket.on('state', st => { U.syncClock(st.serverNow); S = st; render(); });

  function login(pw, silent) {
    socket.emit('teacher:login', { password: pw }, res => {
      if (!res.ok) { ss.set('jogo-pw', null); password = null; renderLogin(silent ? '' : res.error); return; }
      password = pw; ss.set('jogo-pw', pw);
      if (code && res.games.some(g => g.code === code)) open(code);
      else { code = null; ss.set('jogo-code', null); renderGames(res.games); }
    });
  }
  function open(c) {
    socket.emit('teacher:open', { code: c }, res => {
      if (!res.ok) { U.toast(res.error); code = null; ss.set('jogo-code', null); login(password, true); return; }
      code = c; ss.set('jogo-code', c);
    });
  }
  function act(type, extra = {}, cb) {
    if (busy && ['start', 'reveal', 'next', 'undo'].includes(type)) return;
    if (['start', 'reveal', 'next', 'undo'].includes(type)) busy = true;
    socket.emit('teacher:action', { code, type, ...extra }, res => {
      busy = false;
      if (!res.ok) U.toast(res.error);
      cb && cb(res);
    });
  }

  // ------------------------------------------------------------ login
  function renderLogin(err = '') {
    S = null;
    app.innerHTML = `
      <form class="login anim-up" id="f">
        <div class="eyebrow">IEE Impacto · Aula 5</div>
        <h1>Área do professor</h1>
        <label class="field"><span>Senha</span><input type="password" id="pw" autocomplete="current-password"></label>
        <button class="btn block">Entrar</button>
        <p class="err">${esc(err)}</p>
      </form>`;
    $('#pw').focus();
    $('#f').onsubmit = e => { e.preventDefault(); login($('#pw').value); };
  }

  function renderGames(games) {
    S = null;
    const phaseName = g => g.phase === 'lobby' ? 'Aguardando times' : g.phase === 'final' ? 'Encerrado' : `Rodada ${g.round}`;
    app.innerHTML = `
      <div class="login anim-up">
        <div class="eyebrow">IEE Impacto · Aula 5</div>
        <h1>Jogo de Investimento</h1>
        <button class="btn gold block" id="new">Criar novo jogo</button>
        ${games.length ? `<div class="games"><div class="eyebrow" style="color:var(--muted);margin-bottom:8px">Continuar um jogo</div>
          ${games.map(g => `<button data-c="${g.code}"><span>Sala ${g.code} · ${phaseName(g)}</span><span class="flat">${g.teams} ${g.teams === 1 ? 'time' : 'times'}</span></button>`).join('')}</div>` : ''}
        <button class="link" id="out" style="margin-top:18px;background:none;border:0;color:var(--muted);text-decoration:underline">Sair</button>
      </div>`;
    $('#new').onclick = () => socket.emit('teacher:create', {}, res => res.ok ? open(res.code) : U.toast(res.error));
    app.querySelectorAll('[data-c]').forEach(b => (b.onclick = () => open(b.dataset.c)));
    $('#out').onclick = () => { ss.set('jogo-pw', null); password = null; renderLogin(); };
  }

  // ------------------------------------------------------------ render
  // em localhost, mostra o IP da rede para os celulares conseguirem entrar
  let host = location.host, origin = location.origin;
  if (/^(localhost|127\.)/.test(location.hostname)) {
    fetch('/lan').then(r => r.json()).then(j => {
      if (j.ip) { host = `${j.ip}:${j.port}`; origin = `http://${host}`; render(); }
    }).catch(() => {});
  }
  const joinUrl = () => `${origin}/?code=${S.code}`;

  // A tela é montada uma vez e depois só as partes que mudaram são trocadas.
  // Assim campos em edição e botões não são recriados quando um aluno entra ou mexe na carteira.
  let shellReady = false;
  const lastHtml = {};
  function ensureShell() {
    if (shellReady && $('#stage')) return;
    app.innerHTML = `<div class="head" id="head"></div>
      <div class="stage" id="stage" style="position:relative"></div>
      <div class="foot" id="foot"></div>
      <div id="drawerHost"></div>`;
    shellReady = true;
    for (const k in lastHtml) delete lastHtml[k];
  }
  function setHTML(id, html) {
    if (lastHtml[id] === html) return false;
    $('#' + id).innerHTML = html;
    lastHtml[id] = html;
    return true;
  }

  function render() {
    if (!S) return;
    ensureShell();
    setHTML('head', `
      <div class="brand"><b>Jogo de Investimento</b> · IEE Impacto · Aula 5</div>
      ${S.phase !== 'lobby' && S.phase !== 'final' ? `<div class="joinpill">Entrar: ${esc(host)} <span class="code num">${S.code}</span></div>` : `<div class="joinpill">Sala <span class="code num">${S.code}</span></div>`}`);
    $('#stage').classList.toggle('dark', S.phase === 'decide');
    const stageChanged = setHTML('stage', stage());
    if (S.phase === 'lobby') patchTeams();
    if (S.phase === 'final' && stageChanged) drawFinalChart();
    setHTML('foot', foot());
    const st = $('#fstatus'); if (st) st.textContent = footStatus();
    if (drawerOpen && drawerPhase !== phaseKey()) closeDrawer();
    tick();
  }

  function stage() {
    switch (S.phase) {
      case 'lobby': return lobby();
      case 'decide': return decide();
      case 'reveal': return reveal();
      case 'final': return final();
    }
    return '';
  }

  // ---- lobby
  function lobby() {
    const url = joinUrl();
    return `<div class="lobby">
      <div class="joinbig anim-up">
        <div class="eyebrow">Entre pelo celular</div>
        <h1>Montem seus times</h1>
        <div class="url">${esc(host)}</div>
        <div class="flat" style="font-weight:700;margin-top:14px">Código da sala</div>
        <div class="codebig num">${S.code}</div>
        <img src="/qr.svg?u=${encodeURIComponent(url)}" alt="QR code para entrar no jogo">
      </div>
      <div class="teams">
        <h2 id="tcount"></h2>
        <div class="hint">Digite as tampinhas do Kahoot de cada time (1 tampinha = ${brl(S.settings.rateIn, S.settings.rateIn % 1 !== 0)} no caixa) e aperte Enter. Dá para corrigir até a Rodada 1 ser revelada, em ⚙ Ajustes.</div>
        <div class="trow headrow"><span>Time</span><span style="text-align:right">Tampinhas</span><span style="text-align:right">Caixa inicial</span><span></span></div>
        <div class="tlist" id="tlist"></div>
        <div class="empty" id="tempty">Aguardando o primeiro time entrar…</div>
      </div>
    </div>`;
  }

  // linhas dos times: criadas uma vez por time e só atualizadas depois
  function patchTeams() {
    const list = $('#tlist');
    if (!list) return;
    const ids = new Set(S.teams.map(t => t.id));
    for (const row of [...list.children]) if (!ids.has(row.dataset.id)) row.remove();
    S.teams.forEach((t, i) => {
      let row = list.querySelector(`[data-id="${t.id}"]`);
      if (!row) {
        row = document.createElement('div');
        row.className = 'trow anim-pop';
        row.dataset.id = t.id;
        row.innerHTML = `<span class="nm"><i class="dot"></i><span class="tn"></span></span>
          <input class="num" inputmode="numeric" data-team="${t.id}" value="${t.tampinhas}">
          <span class="num cash" style="text-align:right;font-weight:800"></span>
          <button class="x" data-kick="${t.id}" title="Remover time">×</button>`;
      }
      if (list.children[i] !== row) list.insertBefore(row, list.children[i] || null);
      row.querySelector('.dot').classList.toggle('off', !t.connected);
      row.querySelector('.tn').textContent = t.name;
      row.querySelector('.cash').textContent = brl(t.startCash);
      const inp = row.querySelector('input');
      inp.setAttribute('aria-label', 'Tampinhas de ' + t.name);
      if (document.activeElement !== inp && !tpTimers[t.id]) inp.value = t.tampinhas;
    });
    $('#tcount').textContent = `${S.teams.length} ${S.teams.length === 1 ? 'time' : 'times'}`;
    $('#tempty').classList.toggle('hidden', S.teams.length > 0);
  }

  function sendTampinhas(inp) {
    const id = inp.dataset.team;
    clearTimeout(tpTimers[id]);
    const value = Number(String(inp.value).replace(/\D/g, '')) || 0;
    tpTimers[id] = 'sending';
    act('tampinhas', { teamId: id, value }, res => {
      delete tpTimers[id];
      if (!res.ok) { const t = S && S.teams.find(x => x.id === id); if (t) inp.value = t.tampinhas; }
      render();
    });
  }

  // ---- decide
  function decide() {
    const r = S.round;
    const teams = S.teams;
    const ready = teams.filter(t => t.ready).length;
    return `<div class="timerbig num" id="bigclock"></div>
      <div class="newsbig anim-pop">
        <div class="eyebrow">Rodada ${r.n} de ${r.total}</div>
        <div class="bar"></div>
        <h1>${esc(r.title)}</h1>
        <p class="lead">${esc(r.news)}</p>
        <div class="ask">Compram, vendem ou ficam parados?</div>
        <div class="prices">${S.assets.map(a => `<div class="p" style="--c:${a.color}"><div class="n">${a.name}</div><div class="v num">${brl(r.pricesBefore[a.key], true)}</div></div>`).join('')}</div>
        <div class="readygrid">${teams.map(t => `<span class="t ${t.ready ? 'ready' : t.touched ? 'touched' : ''}">${t.ready ? '✓ ' : ''}${esc(t.name)}</span>`).join('')}</div>
        <div style="color:#AEB7DA;font-weight:700;margin-top:10px;font-size:16px">${ready} de ${teams.length} confirmaram a carteira</div>
      </div>`;
  }

  // ---- reveal
  function rankingList(rows, showChange) {
    // barras a partir de um piso (senão R$ 1.000 x R$ 1.230 ficam quase iguais)
    const max = Math.max(...rows.map(r => r.total), 1);
    const min = Math.min(...rows.map(r => r.total));
    const width = v => (max === min ? 100 : 18 + 82 * (v - min) / (max - min));
    const compact = rows.length > 8;
    return `<div class="rank ${compact ? 'compact' : ''}">${rows.map((r, i) => `
      <div class="rk ${r.pos === 1 ? 'first' : ''} anim-up" style="animation-delay:${Math.min(i, 12) * 60}ms">
        <div class="p">${r.pos}º</div>
        <div><div class="nm">${esc(r.name)}</div><div class="barwrap"><div style="width:${width(r.total)}%"></div></div></div>
        <div class="tot num">${brl(r.total)}${showChange ? `<small class="${cls(r.lastChange)}">${r.lastChange ? signedBrl(r.lastChange) : 'sem mudança'}</small>` : ''}</div>
      </div>`).join('')}</div>`;
  }

  function reveal() {
    const r = S.round;
    return `<div class="reveal">
      <div class="anim-up">
        <div class="eyebrow">Rodada ${r.n} · O que aconteceu</div>
        <h1>${esc(r.title)}</h1>
        <table class="px num">
          <thead><tr><th>Ativo</th><th>Antes</th><th>Variação</th><th>Agora</th></tr></thead>
          <tbody>${S.assets.map(a => `<tr>
            <td><span class="swatch" style="background:${a.color};margin-right:8px"></span>${a.name}</td>
            <td>${brl(r.pricesBefore[a.key], true)}</td>
            <td><span class="chip ${cls(r.delta[a.key])}" style="font-size:17px">${pct(r.delta[a.key])}</span></td>
            <td class="now ${cls(r.delta[a.key])}">${brl(r.pricesAfter[a.key], true)}</td></tr>`).join('')}
          </tbody>
        </table>
        <div class="whybox">
          <div class="eyebrow" style="margin-bottom:6px">Por quê</div>
          ${r.why ? `<div class="anim-up">${esc(r.why)}</div>` : `<div class="ask">Pergunte à turma: por que isso subiu? Por que isso caiu?</div>`}
        </div>
      </div>
      <div>
        <h2 style="font-size:26px;margin-bottom:14px">Quem está na frente</h2>
        ${rankingList(S.ranking, true)}
      </div>
    </div>`;
  }

  // ---- final
  function final() {
    const rk = S.ranking;
    const w = rk[0];
    const winners = rk.filter(r => r.pos === 1);
    const bestYield = [...rk].sort((a, b) => b.yieldPct - a.yieldPct)[0];
    return `<div class="final">
      <div>
        ${w ? `<div class="winner anim-pop"><div class="trophy">🏆</div><div><div class="eyebrow">${winners.length > 1 ? 'Empate na frente' : 'Maior patrimônio'}</div><h1>${winners.map(x => esc(x.name)).join(' e ')}</h1></div><div class="amt num">${brl(w.total)}</div></div>` : ''}
        <table class="fin num">
          <thead><tr><th>#</th><th>Time</th><th>Patrimônio</th><th>Começou</th><th>Rendimento</th><th>Tampinhas</th></tr></thead>
          <tbody>${rk.map(r => `<tr><td>${r.pos}º</td><td class="nm">${esc(r.name)}</td><td>${brl(r.total)}</td><td class="flat">${brl(r.startCash)}</td><td class="${cls(r.yieldPct)}">${pct(r.yieldPct, 1)}</td><td class="tp">${r.tampinhasOut}</td></tr>`).join('')}</tbody>
        </table>
        ${bestYield && rk.length > 1 ? `<p class="flat" style="margin-top:12px;font-size:16px">Maior rendimento %: <b style="color:var(--navy)">${esc(bestYield.name)}</b> (${pct(bestYield.yieldPct, 1)}). Tampinhas: R$ 1 = ${String(S.settings.rateOut).replace('.', ',')} tampinha.</p>` : ''}
      </div>
      <div>
        <div class="tabs">
          <button data-tab="teams" class="${finalTab === 'teams' ? 'on' : ''}">Times, rodada a rodada</button>
          <button data-tab="bench" class="${finalTab === 'bench' ? 'on' : ''}">E se fosse R$ 1.000 num ativo só?</button>
        </div>
        <div class="chart" id="chart"></div>
        ${finalTab === 'bench' ? benchTable() : ''}
      </div>
    </div>`;
  }

  function benchTable() {
    const names = Object.fromEntries(S.assets.map(a => [a.key, a.name]));
    names.caixa = 'Caixa';
    return `<table class="fin num" style="margin-top:14px"><thead><tr><th>Ativo</th><th></th><th>Pior momento</th><th>Final</th><th>Resultado</th></tr></thead>
      <tbody>${S.benchmark.map(b => `<tr><td class="nm">${names[b.key]}</td><td></td><td class="${cls(b.worst - 1000)}">${brl(b.worst)}</td><td>${brl(b.final)}</td><td class="${cls(b.final - 1000)}">${pct(b.final / 1000 - 1)}</td></tr>`).join('')}</tbody></table>`;
  }

  function drawFinalChart() {
    const el = $('#chart');
    if (!el) return;
    const labels = ['Início'].concat(Array.from({ length: S.totalRounds }, (_, i) => 'R' + (i + 1)));
    let series;
    if (finalTab === 'bench') {
      const colors = Object.fromEntries(S.assets.map(a => [a.key, a.color]));
      const names = Object.fromEntries(S.assets.map(a => [a.key, a.name]));
      series = S.benchmark.map(b => ({ name: b.key === 'caixa' ? 'Caixa' : names[b.key], color: b.key === 'caixa' ? '#8E98B8' : colors[b.key], values: b.path, dashed: b.key === 'caixa' }));
    } else {
      const order = S.ranking.map(r => r.id);
      const teams = [...S.teams].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      series = teams.map((t, i) => ({ name: t.name, values: t.history, color: U.TEAM_COLORS[i % U.TEAM_COLORS.length], highlight: i === 0 }));
    }
    U.lineChart(el, series, labels, { width: 820, height: finalTab === 'bench' ? 300 : 440, labelSpace: 150, aria: 'Patrimônio por rodada' });
  }

  // ---- rodapé de controle
  function primary() {
    switch (S.phase) {
      case 'lobby': return { label: 'Começar Rodada 1 →', type: 'start', disabled: !S.teams.length };
      case 'decide': return { label: 'Revelar resultado →', type: 'reveal' };
      case 'reveal':
        if (!S.showWhy) return { label: 'Mostrar o porquê →', type: 'showWhy' };
        return S.round.n < S.round.total ? { label: `Notícia da Rodada ${S.round.n + 1} →`, type: 'next' } : { label: 'Ver resultado final →', type: 'next' };
    }
    return null;
  }

  function footStatus() {
    if (S.phase === 'decide') return `${S.teams.filter(t => t.ready).length}/${S.teams.length} confirmaram`;
    if (S.phase === 'lobby') return `${S.teams.length} ${S.teams.length === 1 ? 'time' : 'times'} conectados`;
    if (S.phase === 'reveal') return `Rodada ${S.round.n} de ${S.round.total}`;
    return '';
  }

  function foot() {
    const p = primary();
    const timerCtl = S.phase === 'decide' ? `
      <div class="clock num" id="clock">–</div>
      <button class="btn ghost" data-a="timerToggle" id="ttoggle">Pausar</button>
      <button class="btn ghost" data-a="timerAdd">+30 s</button>` : '';
    return `
      <button class="btn ghost" data-a="settings" title="Ajustes">⚙ Ajustes</button>
      <button class="btn ghost" data-a="undo" ${S.canUndo ? '' : 'disabled'} title="Desfaz a última passagem de fase">↶ Voltar</button>
      ${timerCtl}
      <span class="status" id="fstatus"></span>
      <span class="spacer"></span>
      ${p ? `<span class="kbd">→ ou espaço</span><button class="btn primary" data-a="primary" ${p.disabled ? 'disabled' : ''}>${p.label}</button>` : ''}`;
  }

  // ---- ajustes: montado só ao abrir, não é redesenhado pelas atualizações
  let drawerPhase = '';
  const phaseKey = () => S.phase + ':' + (S.round ? S.round.n : 0);
  const canChangeStart = () => S.phase === 'lobby' || (S.phase === 'decide' && S.round.n === 1);
  const fmtNum = v => String(v).replace('.', ',');

  function openDrawer() {
    const s = S.settings;
    const early = canChangeStart();
    drawerOpen = true;
    drawerPhase = phaseKey();
    $('#drawerHost').innerHTML = `<div class="drawer anim-up">
      <h3>Ajustes</h3>
      <label class="field"><span>Tempo por rodada (segundos, 0 = sem cronômetro)</span><input class="num" id="sec" inputmode="numeric" value="${s.decideSeconds}"></label>
      ${S.phase === 'decide' ? '<p class="note">Ao salvar, o cronômetro desta rodada recomeça com o novo tempo.</p>' : ''}
      ${early && S.teams.length ? `<div class="field"><span>Tampinhas do Kahoot por time</span>
        <div class="dteams">${S.teams.map(t => `<label class="dteam"><span>${esc(t.name)}</span><input class="num" inputmode="numeric" data-dteam="${t.id}" data-orig="${t.tampinhas}" value="${t.tampinhas}"></label>`).join('')}</div></div>` : ''}
      <div class="row2">
        <label class="field"><span>R$ por tampinha (entrada)</span><input class="num" id="rin" inputmode="decimal" value="${fmtNum(s.rateIn)}" ${early ? '' : 'disabled'}></label>
        <label class="field"><span>Tampinhas por R$ (saída)</span><input class="num" id="rout" inputmode="decimal" value="${fmtNum(s.rateOut)}"></label>
      </div>
      <p class="note">${early ? 'Câmbios iguais às células O2 e P2 da planilha. Padrão: 1 e 0,2.' : 'As tampinhas iniciais e o câmbio de entrada só mudam até a Rodada 1 ser revelada.'}</p>
      <button class="btn" data-a="saveSettings">Salvar ajustes</button>
      <button class="btn ghost" data-a="restart">Recomeçar do zero (mesmos times)</button>
      <button class="btn ghost" data-a="exit">Trocar de jogo</button>
    </div>`;
    const first = $('#sec'); if (first) first.focus();
  }
  function closeDrawer() { drawerOpen = false; drawerPhase = ''; const h = $('#drawerHost'); if (h) h.innerHTML = ''; }

  async function saveSettings() {
    const num = v => Number(String(v).replace(',', '.'));
    const call = (type, extra) => new Promise(r => socket.emit('teacher:action', { code, type, ...extra }, r));
    const errors = [];
    const rin = $('#rin');
    let res = await call('settings', { decideSeconds: num($('#sec').value), rateIn: rin.disabled ? undefined : num(rin.value), rateOut: num($('#rout').value) });
    if (!res.ok) errors.push(res.error);
    for (const inp of document.querySelectorAll('[data-dteam]')) {
      const v = Number(inp.value.replace(/\D/g, '')) || 0;
      if (String(v) === inp.dataset.orig) continue;
      res = await call('tampinhas', { teamId: inp.dataset.dteam, value: v });
      if (!res.ok) errors.push(res.error);
    }
    if (errors.length) U.toast(errors[0]);
    else { closeDrawer(); U.toast('Ajustes salvos.'); }
  }

  // cliques e digitação tratados por delegação (os elementos podem ser trocados)
  app.addEventListener('click', e => {
    const a = e.target.closest('[data-a]');
    if (a && !a.disabled) return onAction(a.dataset.a);
    const k = e.target.closest('[data-kick]');
    if (k) {
      const t = S && S.teams.find(x => x.id === k.dataset.kick);
      if (t && confirm(`Remover o time "${t.name}"?`)) act('kick', { teamId: t.id });
      return;
    }
    const tab = e.target.closest('[data-tab]');
    if (tab) { finalTab = tab.dataset.tab; render(); }
  });
  app.addEventListener('input', e => {
    const inp = e.target.closest('[data-team]');
    if (!inp) return;
    clearTimeout(tpTimers[inp.dataset.team]);
    tpTimers[inp.dataset.team] = setTimeout(() => sendTampinhas(inp), 900);
  });
  app.addEventListener('focusout', e => {
    const inp = e.target.closest('[data-team]');
    if (inp && tpTimers[inp.dataset.team] && tpTimers[inp.dataset.team] !== 'sending') sendTampinhas(inp);
  });
  app.addEventListener('keydown', e => {
    const inp = e.target.closest('[data-team]');
    if (inp && e.key === 'Enter') { e.preventDefault(); sendTampinhas(inp); inp.blur(); return; }
    if (e.target.closest('.drawer') && e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); saveSettings(); }
    if (e.target.closest('.drawer') && e.key === 'Escape') closeDrawer();
  });

  function onAction(a) {
    switch (a) {
      case 'primary': {
        const p = primary();
        if (!p || p.disabled) return;
        if (p.type === 'showWhy') act('showWhy', { value: true });
        else act(p.type);
        return;
      }
      case 'undo':
        if (confirm('Voltar para a etapa anterior? As carteiras voltam a como estavam antes.')) act('undo');
        return;
      case 'timerToggle': case 'timerAdd': act(a, { seconds: 30 }); return;
      case 'settings': drawerOpen ? closeDrawer() : openDrawer(); return;
      case 'saveSettings': saveSettings(); return;
      case 'restart':
        if (confirm('Recomeçar o jogo? Todas as carteiras voltam ao caixa inicial (os times continuam conectados).')) { closeDrawer(); act('restart'); }
        return;
      case 'exit':
        closeDrawer(); code = null; ss.set('jogo-code', null); S = null; login(password, true); return;
    }
  }

  // teclado / passador de slides (setas e Page Down sempre; espaço/Enter só fora de campos e botões)
  document.addEventListener('keydown', e => {
    if (!S || !shellReady || e.target.closest('input, textarea, .drawer')) return;
    const always = ['ArrowRight', 'PageDown'].includes(e.key);
    const soft = [' ', 'Enter'].includes(e.key) && !e.target.closest('button');
    if (always || soft) { e.preventDefault(); onAction('primary'); }
  });

  // cronômetro
  function tick() {
    if (!S || S.phase !== 'decide') return;
    const left = U.timerLeft(S.timer);
    const txt = left == null ? '–' : left > 0 ? U.fmtClock(left) : 'Tempo!';
    const c = $('#clock'); if (c) c.textContent = txt;
    const big = $('#bigclock');
    if (big) { big.textContent = left == null ? '' : txt; big.classList.toggle('low', left != null && left <= 10000); }
    const tt = $('#ttoggle'); if (tt) tt.textContent = S.timer.running ? 'Pausar' : (left > 0 ? 'Continuar' : 'Iniciar');
  }
  setInterval(tick, 250);
})();

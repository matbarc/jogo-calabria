/* Utilidades compartilhadas entre a tela do aluno e a do professor. */
(function () {
  const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const U = {};
  U.brl = (v, cents = false) => (v < 0 ? '−' : '') + 'R$ ' + (cents ? nf2 : nf0).format(Math.abs(v));
  U.signedBrl = v => (v > 0 ? '+' : v < 0 ? '−' : '') + 'R$ ' + nf0.format(Math.abs(v));
  U.pct = (d, digits = 0) => {
    if (!d) return '—';
    const s = (Math.abs(d) * 100).toFixed(digits).replace('.', ',');
    return (d > 0 ? '+' : '−') + s + '%';
  };
  U.cls = v => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
  U.esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.$ = (sel, root = document) => root.querySelector(sel);

  let toastTimer;
  U.toast = msg => {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
  };

  // relógio: compensa diferença entre o relógio do servidor e o do aparelho
  let clockOffset = 0;
  U.syncClock = serverNow => { clockOffset = serverNow - Date.now(); };
  U.timerLeft = timer => {
    if (!timer) return null;
    if (timer.running) return Math.max(0, timer.endsAt - (Date.now() + clockOffset));
    return timer.remaining;
  };
  U.fmtClock = ms => {
    const s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  U.connBadge = socket => {
    const el = document.createElement('div');
    el.className = 'conn hidden';
    el.textContent = 'Reconectando…';
    document.body.appendChild(el);
    socket.on('disconnect', () => el.classList.remove('hidden'));
    socket.on('connect', () => el.classList.add('hidden'));
  };

  // Paleta para os times no gráfico (distinguíveis e legíveis no projetor)
  U.TEAM_COLORS = ['#1F2761', '#C9992E', '#2E7D4F', '#C0392B', '#3B5BDB', '#8B5A3C', '#7B3FA0', '#0E8C8C', '#D9721C', '#5B6585', '#B83280', '#4C7A12'];

  /**
   * Gráfico de linhas em SVG.
   * series: [{ name, color, values: number[], highlight?: bool, dashed?: bool }]
   * labels: string[] (eixo x)
   */
  U.lineChart = (el, series, labels, opts = {}) => {
    const W = opts.width || 900, H = opts.height || 380;
    const padL = 64, padR = opts.labelSpace ?? 150, padT = 16, padB = 34;
    const all = series.flatMap(s => s.values.filter(v => v != null));
    if (!all.length) { el.innerHTML = ''; return; }
    let lo = Math.min(...all), hi = Math.max(...all);
    const span = Math.max(hi - lo, 100);
    const step = niceStep(span / 5);
    lo = Math.floor((lo - span * 0.05) / step) * step;
    hi = Math.ceil((hi + span * 0.05) / step) * step;
    const x = i => padL + (i * (W - padL - padR)) / Math.max(1, labels.length - 1);
    const y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    let g = '<g class="grid">';
    for (let v = lo; v <= hi + 1e-9; v += step) g += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>`;
    g += '</g><g class="axis">';
    for (let v = lo; v <= hi + 1e-9; v += step) g += `<text x="${padL - 10}" y="${y(v) + 4}" text-anchor="end">${U.brl(v)}</text>`;
    labels.forEach((l, i) => { g += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle">${U.esc(l)}</text>`; });
    g += '</g>';

    const ordered = [...series].sort((a, b) => (a.highlight ? 1 : 0) - (b.highlight ? 1 : 0));
    let lines = '';
    const ends = [];
    for (const s of ordered) {
      const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
      if (!pts.length) continue;
      const w = s.highlight ? 4 : opts.thin ? 2 : 3;
      const op = opts.dimOthers && !s.highlight ? 0.35 : 1;
      lines += `<polyline fill="none" stroke="${s.color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" opacity="${op}" ${s.dashed ? 'stroke-dasharray="6 6"' : ''} points="${pts.map(p => p.join(',')).join(' ')}"/>`;
      const last = pts[pts.length - 1];
      lines += `<circle cx="${last[0]}" cy="${last[1]}" r="${w + 1}" fill="${s.color}" opacity="${op}"/>`;
      if (padR > 20) ends.push({ y: last[1], x: last[0], s, op });
    }
    // rótulos no fim das linhas, empurrados para não sobrepor
    ends.sort((a, b) => a.y - b.y);
    const gap = 17;
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < gap) ends[i].y = ends[i - 1].y + gap;
    const overflow = ends.length ? ends[ends.length - 1].y - (H - padB) : 0;
    if (overflow > 0) {
      ends[ends.length - 1].y -= overflow;
      for (let i = ends.length - 2; i >= 0; i--) if (ends[i + 1].y - ends[i].y < gap) ends[i].y = ends[i + 1].y - gap;
    }
    for (const e of ends) {
      const name = e.s.name.length > 16 ? e.s.name.slice(0, 15) + '…' : e.s.name;
      lines += `<text class="lbl" x="${e.x + 12}" y="${e.y + 4}" fill="${e.s.color}" opacity="${e.op}">${U.esc(name)}</text>`;
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${U.esc(opts.aria || 'Gráfico')}">${g}${lines}</svg>`;
  };
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
  }

  window.U = U;
})();

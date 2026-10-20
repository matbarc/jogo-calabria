// Simula uma partida inteira: professor + 3 times. Uso: node test/simulate.js
const { io } = require('socket.io-client');
const URL = process.env.URL || 'http://localhost:3000';
const emit = (s, ev, data) => new Promise(r => s.emit(ev, data, r));
const wait = ms => new Promise(r => setTimeout(r, ms));
// estratégias: por rodada, quanto colocar em cada ativo (R$), o resto no caixa
const plans = {
  'Arrojados': r => ({ acoes: 'all' }),
  'Cautelosos': r => ({}),
  'Mistos': r => ({ ouro: 300, casa: 200, pao: 100 }),
};
(async () => {
  const t = io(URL, { transports: ['websocket'] });
  let tState; t.on('state', s => (tState = s));
  console.log('login', (await emit(t, 'teacher:login', { password: 'professor' })).ok);
  const { code } = await emit(t, 'teacher:create', {});
  await emit(t, 'teacher:open', { code });
  const teams = {};
  for (const name of Object.keys(plans)) {
    const s = io(URL, { transports: ['websocket'] });
    teams[name] = { s, st: null };
    s.on('state', st => (teams[name].st = st));
    const r = await emit(s, 'team:join', { code, name });
    if (!r.ok) throw new Error(r.error);
  }
  const dup = await emit(teams.Mistos.s, 'team:join', { code, name: 'arrojados' });
  console.log('duplicate name rejected:', !dup.ok, dup.error);
  await wait(100);
  const arId = tState.teams.find(x => x.name === 'Arrojados').id;
  console.log('tampinhas', (await emit(t, 'teacher:action', { code, type: 'tampinhas', teamId: arId, value: 10 })).ok);
  console.log('start', (await emit(t, 'teacher:action', { code, type: 'start' })).ok);
  for (let r = 1; r <= 10; r++) {
    await wait(60);
    for (const [name, tm] of Object.entries(teams)) {
      const total = tm.st.me.total;
      const p = plans[name](r);
      const h = { pao: 0, gasolina: 0, casa: 0, ouro: 0, acoes: 0 };
      for (const k in p) h[k] = p[k] === 'all' ? total : p[k];
      const res = await emit(tm.s, 'team:allocate', { holdings: h });
      if (!res.ok) throw new Error(name + ' ' + res.error);
      await emit(tm.s, 'team:ready', { ready: true });
    }
    // tentativa de gastar demais deve falhar
    if (r === 1) { const bad = await emit(teams.Cautelosos.s, 'team:allocate', { holdings: { pao: 5000, gasolina: 0, casa: 0, ouro: 0, acoes: 0 } }); console.log('overspend rejected:', !bad.ok); }
    await wait(60);
    if (r === 1) console.log('ready count before reveal:', tState.teams.filter(x => x.ready).length);
    if (tState.round.delta) throw new Error('delta leaked before reveal');
    await emit(t, 'teacher:action', { code, type: 'reveal' });
    await wait(60);
    if (r === 4) { // testa desfazer e refazer
      await emit(t, 'teacher:action', { code, type: 'undo' });
      await wait(60);
      if (tState.phase !== 'decide' || tState.round.n !== 4) throw new Error('undo failed');
      await emit(t, 'teacher:action', { code, type: 'reveal' });
      await wait(60);
    }
    await emit(t, 'teacher:action', { code, type: 'showWhy', value: true });
    await emit(t, 'teacher:action', { code, type: 'next' });
  }
  await wait(150);
  console.log('phase', tState.phase);
  console.log(JSON.stringify(tState.ranking.map(r => [r.pos, r.name, r.total, r.startCash, (r.yieldPct * 100).toFixed(2) + '%', r.tampinhasOut])));
  console.log('histories', JSON.stringify(tState.teams.map(x => [x.name, x.history])));
  console.log('student final view has ranking:', !!teams.Mistos.st.ranking, 'pos', teams.Mistos.st.me.pos);
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });

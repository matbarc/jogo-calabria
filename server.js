const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const G = require('./game');

const PORT = process.env.PORT || 3000;
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'professor';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'games.json');
const MAX_TEAMS = 60;
const GAME_TTL_MS = 24 * 3600 * 1000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/healthz', (_req, res) => res.send('ok'));
// IP da rede local (quando roda no notebook, o telão mostra este endereço em vez de "localhost")
app.get('/lan', (_req, res) => {
  const ips = Object.values(require('os').networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  const pref = ips.find(ip => /^192\.168\./.test(ip)) || ips.find(ip => /^10\./.test(ip)) || ips[0] || null;
  res.json({ ip: pref, port: Number(PORT) });
});
app.get('/qr.svg', async (req, res) => {
  const text = String(req.query.u || '').slice(0, 300);
  if (!text) return res.status(400).end();
  const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#1F2761', light: '#FFFFFF' } });
  res.type('image/svg+xml').send(svg);
});

// ---------------------------------------------------------------- state
/** @type {Map<string, any>} */
const games = new Map();

function newCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (games.has(code));
  return code;
}
const token = () => crypto.randomBytes(16).toString('hex');
const clone = o => JSON.parse(JSON.stringify(o));

function createGame() {
  const g = {
    code: newCode(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    phase: 'lobby', // lobby | decide | reveal | final
    round: 0, // 1..10 durante o jogo
    showWhy: false,
    timer: { endsAt: null, remaining: null, running: false },
    settings: { rateIn: 1, rateOut: 0.2, decideSeconds: 60 },
    teams: {},
    order: [],
    undo: [],
  };
  games.set(g.code, g);
  return g;
}

function teamTotal(t) { return G.portfolioTotal(t.holdings, t.cash); }

function snapshot(g) {
  const s = clone({ ...g, undo: undefined });
  g.undo.push(s);
  if (g.undo.length > 12) g.undo.shift();
}

function restore(g) {
  const s = g.undo.pop();
  if (!s) return false;
  const keepUndo = g.undo;
  // não apaga times que entraram depois do snapshot
  const lateTeams = Object.values(g.teams).filter(t => !s.teams[t.id]);
  const liveSockets = Object.fromEntries(Object.values(g.teams).map(t => [t.id, t.sockets]));
  Object.assign(g, s, { undo: keepUndo });
  for (const t of Object.values(g.teams)) t.sockets = liveSockets[t.id] || [];
  for (const t of lateTeams) { g.teams[t.id] = t; if (!g.order.includes(t.id)) g.order.push(t.id); }
  return true;
}

function ranking(g) {
  const rows = g.order.map(id => g.teams[id]).filter(Boolean).map(t => {
    const total = teamTotal(t);
    const prev = t.history.length >= 2 ? t.history[t.history.length - 2] : t.startCash;
    return {
      id: t.id, name: t.name, total, startCash: t.startCash,
      yieldPct: t.startCash ? total / t.startCash - 1 : 0,
      lastChange: g.phase === 'reveal' || g.phase === 'final' ? total - prev : 0,
      tampinhasOut: Math.round(total * g.settings.rateOut),
    };
  });
  rows.sort((a, b) => b.total - a.total || b.yieldPct - a.yieldPct);
  let pos = 0, last = null;
  rows.forEach((r, i) => { if (r.total !== last) { pos = i + 1; last = r.total; } r.pos = pos; });
  return rows;
}

function timerView(g) {
  const t = g.timer;
  return { running: t.running, endsAt: t.endsAt, remaining: t.running ? Math.max(0, t.endsAt - Date.now()) : t.remaining };
}

function roundPublic(g) {
  const r = g.round;
  if (r < 1) return null;
  const ev = G.ROUNDS[r - 1];
  const revealed = g.phase === 'reveal' || g.phase === 'final';
  return {
    n: r, total: G.ROUNDS.length, title: ev.title, news: ev.news,
    pricesBefore: G.PRICES[r - 1],
    delta: revealed ? ev.delta : null,
    pricesAfter: revealed ? G.PRICES[r] : null,
    why: revealed && (g.showWhy || g.phase === 'final') ? ev.why : null,
  };
}

function baseView(g) {
  return {
    code: g.code, phase: g.phase, round: roundPublic(g), showWhy: g.showWhy,
    timer: timerView(g), serverNow: Date.now(), settings: g.settings,
    assets: G.ASSETS, totalRounds: G.ROUNDS.length, initialPrices: G.PRICES[0],
    teamCount: g.order.length,
  };
}

function teacherView(g) {
  const v = baseView(g);
  v.teams = g.order.map(id => g.teams[id]).filter(Boolean).map(t => ({
    id: t.id, name: t.name, tampinhas: t.tampinhas, startCash: t.startCash,
    total: teamTotal(t), cash: t.cash, holdings: t.holdings, ready: t.ready, touched: t.touched,
    connected: t.sockets.length > 0, history: t.history,
  }));
  v.ranking = ranking(g);
  v.canUndo = g.undo.length > 0;
  if (g.phase === 'final') v.benchmark = G.singleAssetBenchmark();
  return v;
}

function teamView(g, t) {
  const v = baseView(g);
  const rk = ranking(g);
  const me = rk.find(r => r.id === t.id);
  v.me = {
    id: t.id, name: t.name, holdings: t.holdings, cash: t.cash, total: teamTotal(t),
    startCash: t.startCash, tampinhas: t.tampinhas, ready: t.ready, history: t.history,
    pos: me ? me.pos : null, lastReveal: g.phase === 'reveal' || g.phase === 'final' ? t.lastReveal : null,
    tampinhasOut: me ? me.tampinhasOut : 0, yieldPct: me ? me.yieldPct : 0,
  };
  if (g.phase === 'final') {
    v.ranking = rk.map(r => ({ name: r.name, total: r.total, pos: r.pos, id: r.id, yieldPct: r.yieldPct }));
    v.histories = g.order.map(id => g.teams[id]).filter(Boolean).map(x => ({ id: x.id, name: x.name, history: x.history }));
  }
  return v;
}

// --------------------------------------------------------------- broadcast
const pending = new Set();
function touch(g) {
  g.updatedAt = Date.now();
  pending.add(g.code);
  scheduleSave();
  setImmediate(flush);
}
function flush() {
  for (const code of pending) {
    const g = games.get(code);
    if (!g) continue;
    io.to('teacher:' + code).emit('state', teacherView(g));
    for (const id of g.order) {
      const t = g.teams[id];
      if (t && t.sockets.length) for (const sid of t.sockets) io.to(sid).emit('state', teamView(g, t));
    }
  }
  pending.clear();
}

// ---------------------------------------------------------------- persist
// Com REDIS_URL (Key Value do Render), o jogo fica guardado fora do servidor e
// sobrevive a reinícios e novas publicações. Sem ela, usa um arquivo local.
const REDIS_URL = process.env.REDIS_URL || '';
const REDIS_KEY = 'jogo:games';
let redis = null;

function serialize() {
  const out = [...games.values()].map(g => ({ ...g, teams: Object.fromEntries(Object.entries(g.teams).map(([k, t]) => [k, { ...t, sockets: [] }])) }));
  return JSON.stringify(out);
}

let saveTimer = null;
let saving = null; // promessa da gravação em andamento
let dirty = false;
function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 300);
}
async function saveNow() {
  if (saving) { await saving; if (!dirty) return; }
  if (!dirty) return;
  dirty = false;
  const data = serialize();
  saving = (async () => {
    try {
      if (redis) await redis.set(REDIS_KEY, data);
      else {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
        fs.writeFileSync(DATA_FILE + '.tmp', data);
        fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
      }
    } catch (e) { dirty = true; console.error('save failed', e.message); setTimeout(scheduleSave, 1000); }
  })();
  await saving;
  saving = null;
}

async function load() {
  let raw = null;
  if (REDIS_URL) {
    const { createClient } = require('redis');
    redis = createClient({ url: REDIS_URL, socket: { reconnectStrategy: n => Math.min(n * 200, 3000) } });
    redis.on('error', e => console.error('redis:', e.message));
    try {
      await redis.connect();
      raw = await redis.get(REDIS_KEY);
      console.log('usando Key Value para guardar os jogos');
    } catch (e) {
      console.error('Key Value indisponível, usando arquivo local:', e.message);
      redis = null;
    }
  }
  if (!redis) { try { raw = fs.readFileSync(DATA_FILE, 'utf8'); } catch { /* primeira vez */ } }
  if (!raw) return;
  try {
    for (const g of JSON.parse(raw)) {
      if (Date.now() - g.updatedAt > GAME_TTL_MS) continue;
      for (const t of Object.values(g.teams)) t.sockets = [];
      // cronômetro continua correndo: o reinício leva segundos
      games.set(g.code, g);
    }
    console.log(`loaded ${games.size} game(s)`);
  } catch (e) { console.error('load failed', e.message); }
}

// Render manda SIGTERM antes de trocar a versão: grava o que falta e sai
async function shutdown() {
  try {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    dirty = true;
    await saveNow();
    if (redis) await redis.quit();
  } catch (e) { console.error(e.message); }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

setInterval(() => {
  for (const [code, g] of games) if (Date.now() - g.updatedAt > GAME_TTL_MS) games.delete(code);
}, 3600 * 1000);

// ---------------------------------------------------------------- game actions
function startTimer(g, seconds) {
  g.timer = { running: true, endsAt: Date.now() + seconds * 1000, remaining: null };
}

function enterDecide(g, round) {
  g.phase = 'decide';
  g.round = round;
  g.showWhy = false;
  for (const t of Object.values(g.teams)) { t.ready = false; t.touched = false; }
  if (g.settings.decideSeconds > 0) startTimer(g, g.settings.decideSeconds);
  else g.timer = { running: false, endsAt: null, remaining: null };
}

function reveal(g) {
  const ev = G.ROUNDS[g.round - 1];
  for (const t of Object.values(g.teams)) {
    const before = { ...t.holdings };
    const totalBefore = teamTotal(t);
    for (const k of G.KEYS) t.holdings[k] = G.applyDelta(t.holdings[k], ev.delta[k]);
    const totalAfter = teamTotal(t);
    t.lastReveal = { round: g.round, before, after: { ...t.holdings }, cash: t.cash, totalBefore, totalAfter };
    t.history[g.round] = totalAfter;
    t.history.length = g.round + 1;
  }
  g.phase = 'reveal';
  g.showWhy = false;
  g.timer = { running: false, endsAt: null, remaining: null };
}

function setTampinhas(g, t, value) {
  value = Math.max(0, Math.min(100000, Math.floor(Number(value) || 0)));
  const newStart = G.START_CASH + value * g.settings.rateIn;
  const diff = newStart - t.startCash;
  if (t.cash + diff < 0) return 'O time já investiu esse dinheiro. Peça para ele devolver ao caixa primeiro.';
  t.tampinhas = value;
  t.startCash = newStart;
  t.cash += diff;
  for (let i = 0; i < t.history.length; i++) t.history[i] += diff; // antes da rodada 1 revelar, history = [start]
  return null;
}

function canChangeStart(g) {
  return g.phase === 'lobby' || (g.phase === 'decide' && g.round === 1);
}

function addTeam(g, name) {
  const id = token().slice(0, 8);
  // quem entra atrasado começa com R$ 1.000 e fica parado nas rodadas que perdeu
  const done = g.phase === 'reveal' || g.phase === 'final' ? g.round : Math.max(0, g.round - 1);
  const t = {
    id, token: token(), name, tampinhas: 0, startCash: G.START_CASH,
    holdings: G.emptyHoldings(), cash: G.START_CASH, ready: false, touched: false,
    history: Array(done + 1).fill(G.START_CASH), lastReveal: null, sockets: [], joinedRound: g.round,
  };
  g.teams[id] = t;
  g.order.push(id);
  return t;
}

function cleanName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

// ---------------------------------------------------------------- sockets
io.on('connection', socket => {
  let teacherOk = false;
  let teamRef = null; // { code, id }

  function detachTeam() {
    if (!teamRef) return;
    const g = games.get(teamRef.code);
    const t = g && g.teams[teamRef.id];
    if (t) { t.sockets = t.sockets.filter(s => s !== socket.id); touch(g); }
    teamRef = null;
  }

  function attachTeam(g, t) {
    detachTeam();
    t.sockets.push(socket.id);
    teamRef = { code: g.code, id: t.id };
    touch(g);
  }

  // celular que já estava no jogo se identifica na própria conexão,
  // antes de reenviar cliques que ficaram pendentes durante a queda
  {
    const a = socket.handshake.auth || {};
    const g = a.code && games.get(String(a.code));
    const t = g && a.token && Object.values(g.teams).find(x => x.token === a.token);
    if (t) attachTeam(g, t);
  }

  // -------- professor
  socket.on('teacher:login', ({ password } = {}, ack = () => {}) => {
    if (String(password) !== TEACHER_PASSWORD) return ack({ ok: false, error: 'Senha incorreta.' });
    teacherOk = true;
    ack({ ok: true, games: listGames() });
  });

  function listGames() {
    return [...games.values()].sort((a, b) => b.updatedAt - a.updatedAt)
      .map(g => ({ code: g.code, phase: g.phase, round: g.round, teams: g.order.length, updatedAt: g.updatedAt }));
  }

  socket.on('teacher:create', (_ = {}, ack = () => {}) => {
    if (!teacherOk) return ack({ ok: false, error: 'Faça login.' });
    const g = createGame();
    touch(g);
    ack({ ok: true, code: g.code });
  });

  socket.on('teacher:open', ({ code } = {}, ack = () => {}) => {
    if (!teacherOk) return ack({ ok: false, error: 'Faça login.' });
    const g = games.get(String(code));
    if (!g) return ack({ ok: false, error: 'Jogo não encontrado.' });
    for (const r of socket.rooms) if (r.startsWith('teacher:')) socket.leave(r);
    socket.join('teacher:' + g.code);
    ack({ ok: true });
    socket.emit('state', teacherView(g));
  });

  socket.on('teacher:action', (msg = {}, ack = () => {}) => {
    if (!teacherOk) return ack({ ok: false, error: 'Faça login.' });
    const g = games.get(String(msg.code));
    if (!g) return ack({ ok: false, error: 'Jogo não encontrado.' });
    const err = teacherAction(g, msg);
    if (err) return ack({ ok: false, error: err });
    touch(g);
    ack({ ok: true });
  });

  function teacherAction(g, m) {
    switch (m.type) {
      case 'start':
        if (g.phase !== 'lobby') return 'O jogo já começou.';
        if (!g.order.length) return 'Ninguém entrou ainda.';
        snapshot(g); enterDecide(g, 1); return null;
      case 'reveal':
        if (g.phase !== 'decide') return 'Não há rodada aberta.';
        snapshot(g); reveal(g); return null;
      case 'showWhy':
        if (g.phase !== 'reveal') return null;
        g.showWhy = !!m.value; return null;
      case 'next':
        if (g.phase !== 'reveal') return 'Revele a rodada primeiro.';
        snapshot(g);
        if (g.round >= G.ROUNDS.length) { g.phase = 'final'; g.showWhy = true; }
        else enterDecide(g, g.round + 1);
        return null;
      case 'undo':
        return restore(g) ? null : 'Nada para desfazer.';
      case 'timerAdd': {
        const add = Number(m.seconds) || 30;
        if (g.timer.running) g.timer.endsAt += add * 1000;
        else { g.timer.remaining = (g.timer.remaining || 0) + add * 1000; }
        return null;
      }
      case 'timerToggle':
        if (g.timer.running) g.timer = { running: false, endsAt: null, remaining: Math.max(0, g.timer.endsAt - Date.now()) };
        else if (g.timer.remaining > 0) g.timer = { running: true, endsAt: Date.now() + g.timer.remaining, remaining: null };
        else if (g.phase === 'decide') startTimer(g, g.settings.decideSeconds || 60);
        return null;
      case 'tampinhas': {
        if (!canChangeStart(g)) return 'As notinhas só podem ser lançadas antes da revelação da Rodada 1.';
        const t = g.teams[m.teamId]; if (!t) return 'Time não encontrado.';
        return setTampinhas(g, t, m.value);
      }
      case 'rename': {
        const t = g.teams[m.teamId]; if (!t) return 'Time não encontrado.';
        const name = cleanName(m.name); if (!name) return 'Nome vazio.';
        t.name = name; return null;
      }
      case 'kick': {
        const t = g.teams[m.teamId]; if (!t) return null;
        for (const sid of t.sockets) io.to(sid).emit('kicked');
        delete g.teams[m.teamId];
        g.order = g.order.filter(id => id !== m.teamId);
        return null;
      }
      case 'settings': {
        const s = g.settings;
        if (m.rateIn != null || m.rateOut != null) {
          if (!canChangeStart(g) && m.rateIn != null && Number(m.rateIn) !== s.rateIn) return 'O câmbio de entrada só muda antes da Rodada 1 ser revelada.';
        }
        if (m.rateIn != null) {
          const v = Math.max(0, Number(m.rateIn) || 0);
          if (v !== s.rateIn) {
            const old = s.rateIn; s.rateIn = v;
            for (const t of Object.values(g.teams)) {
              const e = setTampinhas(g, t, t.tampinhas);
              if (e) { s.rateIn = old; for (const tt of Object.values(g.teams)) setTampinhas(g, tt, tt.tampinhas); return e; }
            }
          }
        }
        if (m.rateOut != null) s.rateOut = Math.max(0, Number(m.rateOut) || 0);
        if (m.decideSeconds != null) {
          const sec = Math.max(0, Math.min(600, Math.floor(Number(m.decideSeconds) || 0)));
          const changed = sec !== s.decideSeconds;
          s.decideSeconds = sec;
          // durante uma rodada, o novo tempo vale já: o cronômetro recomeça
          if (changed && g.phase === 'decide') {
            if (sec > 0) startTimer(g, sec);
            else g.timer = { running: false, endsAt: null, remaining: null };
          }
        }
        return null;
      }
      case 'restart': {
        snapshot(g);
        g.phase = 'lobby'; g.round = 0; g.showWhy = false;
        g.timer = { running: false, endsAt: null, remaining: null };
        for (const t of Object.values(g.teams)) {
          t.startCash = G.START_CASH + t.tampinhas * g.settings.rateIn;
          t.cash = t.startCash; t.holdings = G.emptyHoldings(); t.history = [t.startCash];
          t.ready = false; t.touched = false; t.lastReveal = null;
        }
        return null;
      }
      default: return 'Ação desconhecida.';
    }
  }

  // -------- times
  socket.on('team:join', ({ code, name } = {}, ack = () => {}) => {
    const g = games.get(String(code || '').trim());
    if (!g) return ack({ ok: false, error: 'Código não encontrado. Confira o número no telão.' });
    if (g.phase === 'final') return ack({ ok: false, error: 'Esse jogo já terminou.' });
    name = cleanName(name);
    if (!name) return ack({ ok: false, error: 'Escolha um nome para o time.' });
    const existing = Object.values(g.teams).find(t => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (existing.sockets.length) return ack({ ok: false, error: 'Já existe um time com esse nome. Escolha outro.' });
      // time desconectado (celular trocado): retoma a carteira
      attachTeam(g, existing);
      return ack({ ok: true, token: existing.token, code: g.code, resumed: true });
    }
    if (g.order.length >= MAX_TEAMS) return ack({ ok: false, error: 'A sala está cheia.' });
    const t = addTeam(g, name);
    attachTeam(g, t);
    ack({ ok: true, token: t.token, code: g.code });
  });

  socket.on('team:resume', ({ code, token: tk } = {}, ack = () => {}) => {
    const g = games.get(String(code));
    const t = g && Object.values(g.teams).find(x => x.token === tk);
    if (!t) return ack({ ok: false });
    attachTeam(g, t);
    ack({ ok: true });
  });

  socket.on('team:leave', () => detachTeam());

  socket.on('team:allocate', ({ holdings } = {}, ack = () => {}) => {
    const g = teamRef && games.get(teamRef.code);
    const t = g && g.teams[teamRef.id];
    if (!t) return ack({ ok: false, error: 'Você não está no jogo.' });
    if (g.phase !== 'decide') return ack({ ok: false, error: 'A rodada está fechada.' });
    const total = teamTotal(t);
    const next = {};
    let sum = 0;
    for (const k of G.KEYS) {
      const v = Math.floor(Number(holdings && holdings[k]));
      if (!Number.isFinite(v) || v < 0) return ack({ ok: false, error: 'Valor inválido.' });
      next[k] = v; sum += v;
    }
    if (sum > total) return ack({ ok: false, error: 'Não dá para investir mais do que vocês têm.' });
    t.holdings = next;
    t.cash = total - sum;
    t.touched = true;
    t.ready = false;
    touch(g);
    ack({ ok: true });
  });

  socket.on('team:ready', ({ ready } = {}, ack = () => {}) => {
    const g = teamRef && games.get(teamRef.code);
    const t = g && g.teams[teamRef.id];
    if (!t || g.phase !== 'decide') return ack({ ok: false });
    t.ready = !!ready;
    touch(g);
    ack({ ok: true });
  });

  socket.on('disconnect', () => detachTeam());
});

load().then(() => server.listen(PORT, () => {
  console.log(`Jogo de Investimento rodando em http://localhost:${PORT}`);
  if (!process.env.TEACHER_PASSWORD) console.log('Senha do professor: "professor" (defina TEACHER_PASSWORD para mudar)');
}));

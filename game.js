// Regras e dados do Jogo de Investimento (Aula 5).
// Os números são os mesmos da planilha Aula5_Jogo_Investimento.xlsx (aba Preços).
// Para mudar um evento, edite ROUNDS abaixo: title/news aparecem antes da decisão,
// why e delta só depois que o professor revela.

const ASSETS = [
  { key: 'pao', name: 'Pão', tag: 'Consumo básico', color: '#8B5A3C' },
  { key: 'gasolina', name: 'Gasolina', tag: 'Custo de vida', color: '#C0392B' },
  { key: 'casa', name: 'Casa', tag: 'Bem físico', color: '#2E7D4F' },
  { key: 'ouro', name: 'Ouro', tag: 'Porto seguro', color: '#C9992E' },
  { key: 'acoes', name: 'Ações', tag: 'Risco alto, retorno alto', color: '#3B5BDB' },
];
const KEYS = ASSETS.map(a => a.key);

const INITIAL_PRICES = { pao: 10, gasolina: 20, casa: 100, ouro: 80, acoes: 50 };
const START_CASH = 1000;

const ROUNDS = [
  {
    title: 'Tudo tranquilo',
    news: 'A economia segue estável, os preços estão equilibrados e não há grandes mudanças.',
    why: 'Mercado em equilíbrio, sem grandes mudanças.',
    delta: { pao: 0, gasolina: 0, casa: 0, ouro: 0, acoes: 0 },
  },
  {
    title: 'Colheita recorde',
    news: 'O país teve uma super safra de trigo.',
    why: 'Oferta maior de trigo baixa o preço do pão.',
    delta: { pao: -0.2, gasolina: 0, casa: 0, ouro: 0, acoes: 0 },
  },
  {
    title: 'Aumento de salários',
    news: 'O governo aumentou o salário mínimo e as pessoas estão comprando mais.',
    why: 'Mais renda circulando aumenta a demanda geral.',
    delta: { pao: 0.1, gasolina: 0.05, casa: 0.05, ouro: 0, acoes: 0.08 },
  },
  {
    title: 'Banco Central sobe os juros',
    news: 'Para segurar a inflação, o Banco Central aumentou a taxa básica de juros.',
    why: 'Crédito fica caro: menos gente financia casa e as empresas vendem menos. Casa e ações caem; ouro, que não rende juros, perde atratividade.',
    delta: { pao: 0, gasolina: 0, casa: -0.15, ouro: -0.05, acoes: -0.12 },
  },
  {
    title: 'Greve dos caminhoneiros',
    news: 'Os caminhoneiros pararam o transporte por uma semana.',
    why: 'Transporte parado encarece pão e combustível; a bolsa cai e o ouro sobe como porto seguro.',
    delta: { pao: 0.1, gasolina: 0.15, casa: 0, ouro: 0.05, acoes: -0.1 },
  },
  {
    title: 'Banco Central reduz os juros',
    news: 'Para estimular a economia, o Banco Central diminuiu os juros.',
    why: 'Crédito mais barato volta a favorecer casas e ações; o ouro também fica mais atrativo, já que perde menos por não render juros.',
    delta: { pao: 0.02, gasolina: 0.02, casa: 0.12, ouro: 0.05, acoes: 0.15 },
  },
  {
    title: 'Inovação tecnológica',
    news: 'Uma nova tecnologia barateia a produção de energia.',
    why: 'Custos de produção caem: empresas ficam mais eficientes e a gasolina barateia.',
    delta: { pao: -0.03, gasolina: -0.15, casa: 0, ouro: 0, acoes: 0.15 },
  },
  {
    title: 'Pandemia',
    news: 'Um novo vírus se espalha e as pessoas ficam com medo de sair de casa.',
    why: 'Bolsa despenca, ouro sobe como refúgio e o consumo de combustível cai. Ninguém visita imóvel e as obras param: casas caem.',
    delta: { pao: 0.05, gasolina: -0.1, casa: -0.1, ouro: 0.15, acoes: -0.25 },
  },
  {
    title: 'Avanço da vacinação',
    news: 'O vírus está controlado e a economia começa a se recuperar.',
    why: 'A confiança volta: bolsa dispara, casas e consumo se recuperam; o ouro perde força.',
    delta: { pao: 0, gasolina: 0.08, casa: 0.1, ouro: -0.08, acoes: 0.3 },
  },
  {
    title: 'Impressão de dinheiro',
    news: 'O governo decidiu imprimir dinheiro para ajudar famílias endividadas.',
    why: 'Mais moeda em circulação pressiona o preço de tudo. Quem ficou só no caixa perdeu poder de compra.',
    delta: { pao: 0.1, gasolina: 0.1, casa: 0.1, ouro: 0.08, acoes: 0.1 },
  },
];

// Arredondamento igual ao ROUND do Excel para valores positivos
// (toPrecision limpa o ruído de ponto flutuante, ex.: 45*1.1 = 49.50000000000001).
function roundTo(x, digits) {
  const f = Math.pow(10, digits);
  const v = Number((x * f).toPrecision(12));
  return Math.sign(v) * Math.round(Math.abs(v)) / f;
}

// prices[0] = inicial; prices[r] = depois do evento da rodada r
const PRICES = [INITIAL_PRICES];
for (const r of ROUNDS) {
  const prev = PRICES[PRICES.length - 1];
  const next = {};
  for (const k of KEYS) next[k] = roundTo(prev[k] * (1 + r.delta[k]), 2);
  PRICES.push(next);
}

// Valor de uma posição em R$ depois do evento (planilha: ROUND(valor*(1+Δ),0))
function applyDelta(value, d) {
  return roundTo(value * (1 + d), 0);
}

function emptyHoldings() {
  return Object.fromEntries(KEYS.map(k => [k, 0]));
}

function portfolioTotal(holdings, cash) {
  return KEYS.reduce((s, k) => s + (holdings[k] || 0), 0) + cash;
}

// R$ 1.000 parados num ativo só, do início ao fim (slide 38)
function singleAssetBenchmark() {
  const rows = KEYS.map(k => {
    let v = START_CASH;
    let worst = v;
    const path = [v];
    for (const r of ROUNDS) {
      v = applyDelta(v, r.delta[k]);
      path.push(v);
      worst = Math.min(worst, v);
    }
    return { key: k, worst, final: v, path };
  });
  rows.push({ key: 'caixa', worst: START_CASH, final: START_CASH, path: Array(ROUNDS.length + 1).fill(START_CASH) });
  return rows;
}

module.exports = { ASSETS, KEYS, ROUNDS, PRICES, START_CASH, roundTo, applyDelta, emptyHoldings, portfolioTotal, singleAssetBenchmark };

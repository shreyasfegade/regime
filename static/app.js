(function () {
"use strict";

/* ════════════════════════════════════════════════════════════════════
   REGIME — zero-dependency Canvas + GSAP visualization engine
   ════════════════════════════════════════════════════════════════════ */

// ── Regime palette & particle physics ──────────────────────────────
const RC = {
  'Bullish Trending': '#1FC77D',
  'Bearish Trending': '#E8623A',
  'Crisis': '#F5384E',
  'Accumulation': '#4D8DF5',
};
const RP = {
  'Bullish Trending': { rgb: [31, 199, 125], speed: .17, drift: -.010 },
  'Bearish Trending': { rgb: [232, 98, 58], speed: .24, drift: .012 },
  'Crisis': { rgb: [245, 56, 78], speed: 1.05, drift: 0 },
  'Accumulation': { rgb: [77, 141, 245], speed: .08, drift: 0 },
  'loading': { rgb: [120, 130, 150], speed: .13, drift: 0 },
};
const BORDER = ['Accumulation', 'Bullish Trending', 'Bearish Trending', 'Crisis'];
const SHORT = { 'Bullish Trending': 'Bull', 'Bearish Trending': 'Bear', 'Crisis': 'Crisis', 'Accumulation': 'Accum' };
const BREATH = [{ f: .0008, a: 2.0, ph: 0 }, { f: .00095, a: 1.7, ph: 1.3 }, { f: .0012, a: 2.6, ph: 2.5 }, { f: .0006, a: 1.3, ph: 3.8 }];

// ── App state ──────────────────────────────────────────────────────
const S = {
  particles: [], candles: [], probBands: [], regimeBlocks: [], dates: [],
  stateSeq: [], stateProbs: [], labelMap: {}, regime: 'Accumulation',
  currency: { code: 'INR', symbol: '₹' }, backtest: null,
  breathTime: 0, hoverCandle: -1, candleReveal: 99999, btReveal: 1,
  cfg: RP['Accumulation'], data: null, presets: [],
};
const PAD = { l: 62, r: 14, t: 18, b: 30 };
const CH = { chart: 470, prob: 150, bt: 240 };
let chartW = 0, chartH = 0, cvW = 0;

const $ = id => document.getElementById(id);

// ── Boot ───────────────────────────────────────────────────────────
$('dt-end').value = new Date().toISOString().slice(0, 10);
$('btn-go').onclick = () => loadData();
$('ticker-input').onkeydown = e => { if (e.key === 'Enter') { closePicker(); loadData(); } };
initParticles();
initPicker();
requestAnimationFrame(masterLoop);
loadData();

// ── Master animation loop ──────────────────────────────────────────
function masterLoop(ts) {
  S.breathTime = ts;
  tickParticles();
  drawChart();
  drawProbBands();
  requestAnimationFrame(masterLoop);
}

/* ── Theme re-tint: drive CSS accent from the active regime ─────────── */
function setTheme(regime) {
  const c = RC[regime] || RC['Accumulation'];
  const rgb = hexRgb(c);
  const root = document.documentElement.style;
  root.setProperty('--accent', c);
  root.setProperty('--accent-rgb', rgb);
}

/* ── Particles ──────────────────────────────────────────────────────── */
function initParticles() {
  const c = $('particle-canvas');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const resize = () => { c.width = innerWidth * dpr; c.height = innerHeight * dpr; c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); };
  resize();
  S.particles = Array.from({ length: 110 }, () => ({
    x: Math.random() * innerWidth, y: Math.random() * innerHeight,
    vx: (Math.random() - .5) * .3, vy: (Math.random() - .5) * .3,
    r: Math.random() * 1.4 + .25, op: Math.random() * .4 + .06,
  }));
  window.onresize = resize;
}
function tickParticles() {
  const c = $('particle-canvas'), ctx = c.getContext('2d'), cfg = S.cfg;
  ctx.fillStyle = 'rgba(8,9,12,0.055)'; ctx.fillRect(0, 0, innerWidth, innerHeight);
  for (const p of S.particles) {
    p.vx += (Math.random() - .5) * .015; p.vy += (Math.random() - .5) * .015 + cfg.drift;
    const m = Math.hypot(p.vx, p.vy);
    if (m > cfg.speed) { p.vx = p.vx / m * cfg.speed; p.vy = p.vy / m * cfg.speed; }
    p.x = (p.x + p.vx + innerWidth) % innerWidth; p.y = (p.y + p.vy + innerHeight) % innerHeight;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832);
    ctx.fillStyle = `rgba(${cfg.rgb[0]},${cfg.rgb[1]},${cfg.rgb[2]},${p.op})`; ctx.fill();
  }
}

/* ── Canvas sizing helper ───────────────────────────────────────────── */
function sizeCanvas(cv, w, h) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/* ── Price / number formatting ──────────────────────────────────────── */
function fmtPrice(v, dec) {
  const loc = S.currency.code === 'INR' ? 'en-IN' : 'en-US';
  return S.currency.symbol + v.toLocaleString(loc, { minimumFractionDigits: dec ?? 0, maximumFractionDigits: dec ?? 0 });
}

/* ── Candlestick chart ──────────────────────────────────────────────── */
function drawChart() {
  const wrap = $('chart-canvas').parentElement;
  const ctx = sizeCanvas($('chart-canvas'), wrap.clientWidth, CH.chart);
  cvW = wrap.clientWidth; chartW = cvW - PAD.l - PAD.r; chartH = CH.chart - PAD.t - PAD.b;
  ctx.clearRect(0, 0, cvW, CH.chart);
  if (!S.candles.length) return;
  const n = S.candles.length;
  let lo = Infinity, hi = -Infinity;
  for (const c of S.candles) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; }
  const yMin = lo - (hi - lo) * .04, yMax = hi + (hi - lo) * .04;
  const xS = i => PAD.l + (i / (n - 1)) * chartW;
  const yS = v => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * chartH;
  const cw = Math.max(1, (chartW / n) * .68);

  // Regime wash
  for (const b of S.regimeBlocks) {
    const x0 = xS(b.si), x1 = xS(b.ei), rgb = hexRgb(b.color);
    const g = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + chartH);
    g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(.55, `rgba(${rgb},.05)`); g.addColorStop(1, `rgba(${rgb},.16)`);
    ctx.fillStyle = g; ctx.fillRect(x0, PAD.t, Math.max(x1 - x0, 1), chartH);
  }
  // Grid + Y axis
  ctx.strokeStyle = 'rgba(255,255,255,.045)'; ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(255,255,255,.32)'; ctx.font = "10px 'JetBrains Mono'"; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = PAD.t + chartH * i / 4, v = yMax - (yMax - yMin) * i / 4;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + chartW, y); ctx.stroke();
    ctx.fillText(fmtPrice(v, v < 100 ? 1 : 0), PAD.l - 8, y);
  }
  // X axis
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const step = Math.max(Math.floor(n / 8), 1);
  for (let i = 0; i < n; i += step) {
    const dt = new Date(S.dates[i]);
    ctx.fillText(dt.toLocaleDateString('en', { month: 'short', year: '2-digit' }), xS(i), PAD.t + chartH + 9);
  }
  // Candles
  const vis = Math.min(Math.floor(S.candleReveal), n);
  for (let i = 0; i < vis; i++) {
    const c = S.candles[i], up = c.c >= c.o, color = up ? RC['Bullish Trending'] : RC['Bearish Trending'];
    const x = xS(i), bt = yS(Math.max(c.o, c.c)), bb = yS(Math.min(c.o, c.c)), bh = Math.max(1.4, bb - bt);
    const hov = i === S.hoverCandle;
    ctx.shadowColor = color; ctx.shadowBlur = hov ? 20 : 8;
    ctx.fillStyle = color; ctx.globalAlpha = hov ? .4 : .16;
    ctx.fillRect(x - cw / 2 - 1, bt - 1, cw + 2, bh + 2); ctx.shadowBlur = 0;
    ctx.globalAlpha = .5; ctx.fillRect(x - .5, yS(c.h), 1, yS(c.l) - yS(c.h));
    ctx.globalAlpha = hov ? 1 : .9; ctx.fillRect(x - cw / 2, bt, cw, bh);
  }
  ctx.globalAlpha = 1;
  // 20-day MA
  if (vis > 20) {
    const pts = [];
    for (let i = 19; i < vis; i++) { let s = 0; for (let j = i - 19; j <= i; j++) s += S.candles[j].c; pts.push({ x: xS(i), y: yS(s / 20) }); }
    ctx.strokeStyle = 'rgba(236,238,243,.85)'; ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(236,238,243,.4)'; ctx.shadowBlur = 6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) { const xc = (pts[i].x + pts[i + 1].x) / 2, yc = (pts[i].y + pts[i + 1].y) / 2; ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc); }
    if (pts.length > 1) { const p = pts[pts.length - 1]; ctx.lineTo(p.x, p.y); }
    ctx.stroke(); ctx.shadowBlur = 0;
  }
  // Crosshair
  if (S.hoverCandle >= 0 && S.hoverCandle < n) {
    const x = xS(S.hoverCandle), cy = yS(S.candles[S.hoverCandle].c);
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + chartH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PAD.l, cy); ctx.lineTo(PAD.l + chartW, cy); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, cy, 3.2, 0, 6.2832); ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 7; ctx.fill(); ctx.shadowBlur = 0;
  }
}

/* ── Probability field (stacked breathing bands) ───────────────────── */
function drawProbBands() {
  const wrap = $('prob-canvas').parentElement;
  const ctx = sizeCanvas($('prob-canvas'), wrap.clientWidth, CH.prob);
  const W = wrap.clientWidth, H = CH.prob, t = S.breathTime;
  ctx.clearRect(0, 0, W, H);
  if (!S.probBands.length) return;
  const n = S.probBands.length, xS = i => (i / (n - 1)) * W;
  for (let bi = 0; bi < BORDER.length; bi++) {
    const label = BORDER[bi], bp = BREATH[bi], off = Math.sin(t * bp.f + bp.ph) * bp.a;
    const rgb = hexRgb(RC[label] || '#888'), top = [], bot = [];
    for (let i = 0; i < n; i++) {
      let cb = 0, ct = 0;
      for (let j = 0; j < BORDER.length; j++) { const v = S.probBands[i][BORDER[j]] || 0; if (j < bi) cb += v; if (j <= bi) ct += v; }
      bot.push({ x: xS(i), y: H - cb * H + off }); top.push({ x: xS(i), y: H - ct * H + off });
    }
    ctx.beginPath(); ctx.moveTo(top[0].x, top[0].y);
    for (let i = 1; i < n; i++) { const p = top[i - 1], c = top[i]; ctx.quadraticCurveTo(p.x, p.y, (p.x + c.x) / 2, (p.y + c.y) / 2); }
    ctx.lineTo(top[n - 1].x, top[n - 1].y);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(bot[i].x, bot[i].y);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `rgba(${rgb},.78)`); g.addColorStop(1, `rgba(${rgb},.22)`);
    ctx.fillStyle = g; ctx.fill();
  }
  if (S.hoverCandle >= 0) {
    const x = xS(S.hoverCandle); ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]);
  }
}

/* ── Backtest equity curve ──────────────────────────────────────────── */
function drawBacktest() {
  const bt = S.backtest; if (!bt) return;
  const wrap = $('bt-canvas').parentElement;
  const ctx = sizeCanvas($('bt-canvas'), wrap.clientWidth, CH.bt);
  const W = wrap.clientWidth, H = CH.bt, P = { l: 58, r: 14, t: 16, b: 24 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  ctx.clearRect(0, 0, W, H);
  const se = bt.strategy_equity, be = bt.benchmark_equity, dd = bt.strategy_drawdown, n = se.length;
  let hi = 0; for (let i = 0; i < n; i++) { hi = Math.max(hi, se[i], be[i]); }
  const yMin = 0, yMax = hi * 1.05;
  const xS = i => P.l + (i / (n - 1)) * iw;
  const yS = v => P.t + (1 - (v - yMin) / (yMax - yMin)) * ih;
  const vis = Math.max(2, Math.floor(n * S.btReveal));

  // grid + multiplier axis
  ctx.strokeStyle = 'rgba(255,255,255,.045)'; ctx.fillStyle = 'rgba(255,255,255,.3)';
  ctx.font = "10px 'JetBrains Mono'"; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) { const y = P.t + ih * i / 4, v = yMax - (yMax - yMin) * i / 4; ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(P.l + iw, y); ctx.stroke(); ctx.fillText(v.toFixed(1) + '×', P.l - 7, y); }
  // baseline at 1.0×
  const y1 = yS(1); ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(P.l, y1); ctx.lineTo(P.l + iw, y1); ctx.stroke(); ctx.setLineDash([]);

  // drawdown underlay (faint red, scaled into bottom band)
  const ddBand = ih * .26;
  ctx.beginPath(); ctx.moveTo(P.l, H - P.b);
  for (let i = 0; i < vis; i++) ctx.lineTo(xS(i), H - P.b + dd[i] * ddBand * 2.2);
  ctx.lineTo(xS(vis - 1), H - P.b); ctx.closePath();
  ctx.fillStyle = 'rgba(245,56,78,.12)'; ctx.fill();

  // benchmark line
  ctx.strokeStyle = 'rgba(154,161,176,.55)'; ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(xS(0), yS(be[0])); for (let i = 1; i < vis; i++) ctx.lineTo(xS(i), yS(be[i])); ctx.stroke();

  // strategy area + line (accent)
  const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4D8DF5';
  const rgb = hexRgb(acc);
  const g = ctx.createLinearGradient(0, P.t, 0, H - P.b);
  g.addColorStop(0, `rgba(${rgb},.28)`); g.addColorStop(1, `rgba(${rgb},.01)`);
  ctx.beginPath(); ctx.moveTo(xS(0), H - P.b);
  for (let i = 0; i < vis; i++) ctx.lineTo(xS(i), yS(se[i]));
  ctx.lineTo(xS(vis - 1), H - P.b); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = acc; ctx.lineWidth = 2; ctx.shadowColor = acc; ctx.shadowBlur = 9; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(xS(0), yS(se[0])); for (let i = 1; i < vis; i++) ctx.lineTo(xS(i), yS(se[i])); ctx.stroke(); ctx.shadowBlur = 0;
  // head dot
  const hx = xS(vis - 1), hy = yS(se[vis - 1]);
  ctx.beginPath(); ctx.arc(hx, hy, 3.4, 0, 6.2832); ctx.fillStyle = acc; ctx.shadowColor = acc; ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0;
}

/* ── Hover ──────────────────────────────────────────────────────────── */
$('chart-canvas').addEventListener('mousemove', e => {
  const r = e.currentTarget.getBoundingClientRect();
  const mx = e.clientX - r.left, n = S.candles.length; if (!n) return;
  const idx = Math.round(((mx - PAD.l) / chartW) * (n - 1));
  S.hoverCandle = Math.max(0, Math.min(n - 1, idx));
  const c = S.candles[S.hoverCandle], si = S.stateSeq[S.hoverCandle], lbl = S.labelMap[String(si)] || '';
  const prob = S.stateProbs[S.hoverCandle] ? S.stateProbs[S.hoverCandle][si] : 0;
  const tt = $('tooltip');
  tt.innerHTML = `<div class="tt-r" style="color:${RC[lbl] || '#fff'}"><span>${lbl}</span><span>${(prob * 100).toFixed(0)}%</span></div>
    <div class="tt-d"><span class="tt-l">Date</span><span class="tt-v">${S.dates[S.hoverCandle]}</span></div>
    <div class="tt-d"><span class="tt-l">Open</span><span class="tt-v">${fmtPrice(c.o, 2)}</span></div>
    <div class="tt-d"><span class="tt-l">High</span><span class="tt-v">${fmtPrice(c.h, 2)}</span></div>
    <div class="tt-d"><span class="tt-l">Low</span><span class="tt-v">${fmtPrice(c.l, 2)}</span></div>
    <div class="tt-d"><span class="tt-l">Close</span><span class="tt-v">${fmtPrice(c.c, 2)}</span></div>`;
  tt.style.opacity = '1'; tt.style.left = Math.min(e.clientX + 18, innerWidth - 190) + 'px'; tt.style.top = Math.max(12, e.clientY - 120) + 'px';
});
$('chart-canvas').addEventListener('mouseleave', () => { S.hoverCandle = -1; $('tooltip').style.opacity = '0'; });
$('chart-canvas').style.cursor = 'crosshair';

/* ── Ticker picker ──────────────────────────────────────────────────── */
async function initPicker() {
  try { const r = await fetch('/api/presets'); S.presets = (await r.json()).presets || []; } catch { S.presets = []; }
  renderPicker('');
  const input = $('ticker-input');
  input.addEventListener('focus', () => { renderPicker(input.value); openPicker(); });
  input.addEventListener('input', () => renderPicker(input.value));
  document.addEventListener('click', e => { if (!e.target.closest('.field')) closePicker(); });
}
function renderPicker(q) {
  const p = $('picker'); q = (q || '').trim().toUpperCase();
  const items = S.presets.filter(x => !q || x.symbol.includes(q) || x.name.toUpperCase().includes(q));
  let html = '', lastGroup = '';
  for (const x of items) {
    if (x.market !== lastGroup) { html += `<div class="picker-group">${x.market}</div>`; lastGroup = x.market; }
    html += `<div class="picker-item" data-sym="${x.symbol}"><span class="picker-sym">${x.symbol}</span><span class="picker-name">${x.name}</span></div>`;
  }
  p.innerHTML = html || '<div class="picker-group">No match — press Enter to try anyway</div>';
  p.querySelectorAll('.picker-item').forEach(el => el.onclick = () => { $('ticker-input').value = el.dataset.sym; closePicker(); loadData(); });
}
function openPicker() { $('picker').classList.add('open'); }
function closePicker() { $('picker').classList.remove('open'); }

/* ── Load + orchestrate ─────────────────────────────────────────────── */
async function loadData() {
  const btn = $('btn-go'), tk = $('ticker-input').value.trim().toUpperCase() || 'RELIANCE.NS';
  const st = $('dt-start').value, en = $('dt-end').value;
  btn.textContent = 'Analyzing'; btn.classList.add('busy'); S.cfg = RP['loading'];
  gsap.to('#chart-canvas,#prob-canvas,#bt-canvas', { opacity: .12, duration: .3, ease: 'power2.in' });
  const scan = $('scan-line');
  gsap.fromTo(scan, { top: 0, opacity: .7 }, { top: CH.chart + 'px', opacity: 0, duration: .6, ease: 'none', onStart: () => scan.style.display = 'block', onComplete: () => scan.style.display = 'none' });
  try {
    const r = await fetch(`/api/analyze?ticker=${encodeURIComponent(tk)}&start=${st}&end=${en}`);
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    S.data = d; S.dates = d.dates; S.stateSeq = d.state_sequence; S.stateProbs = d.state_probs;
    S.labelMap = d.label_map; S.regime = d.current_regime; S.currency = d.currency || S.currency;
    S.backtest = d.backtest;
    S.candles = d.ohlc.map(c => ({ o: c.o, h: c.h, l: c.l, c: c.c }));
    S.regimeBlocks = buildBlocks(d); S.probBands = buildProb(d);
    S.cfg = RP[d.current_regime] || RP['Accumulation'];
    setTheme(d.current_regime);
    $('logo-dot').style.background = RC[d.current_regime] || '#4D8DF5';
    $('chart-ticker').textContent = d.ticker;
    renderLegend();
    gsap.to('#chart-canvas,#prob-canvas,#bt-canvas', { opacity: 1, duration: .6, ease: 'power2.out' });

    // KPI hero
    const c = RC[d.current_regime] || '#4D8DF5', re = $('stat-regime-name');
    gsap.to(re, { opacity: 0, duration: .18, onComplete: () => { re.textContent = d.current_regime; re.style.color = c; gsap.to(re, { opacity: 1, duration: .35 }); } });
    $('stat-regime-sub').textContent = `${d.dates.length} sessions analyzed`;
    animC('stat-confidence', d.current_confidence * 100, '%', 0);
    animC('stat-persistence', d.persistence_forecast, 'd', 0, '~');
    const cagr = d.backtest.metrics.strategy.cagr;
    animC('stat-cagr', cagr, '%', 1, cagr >= 0 ? '+' : '');
    $('stat-cagr').style.color = cagr >= 0 ? RC['Bullish Trending'] : RC['Bearish Trending'];
    $('stat-cagr-sub').textContent = `B&H ${d.backtest.metrics.benchmark.cagr >= 0 ? '+' : ''}${d.backtest.metrics.benchmark.cagr}%`;
    const rc = $('regime-card'); gsap.to(rc, { borderLeftColor: c, duration: .5 }); rc.style.boxShadow = `inset 0 0 70px ${c}0d`;

    // Candle cascade
    S.candleReveal = 0; gsap.to(S, { candleReveal: S.candles.length, duration: 1.25, ease: 'power1.inOut' });
    // Backtest draw-on
    S.btReveal = 0; renderBacktestMetrics(d.backtest);
    gsap.to(S, { btReveal: 1, duration: 1.4, ease: 'power2.out', onUpdate: drawBacktest, delay: .3, onComplete: drawBacktest });

    renderTimeline(d); renderMatrix(d); renderStats(d); renderRing(d);
    gsap.fromTo('.kpi', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .55, stagger: .07, ease: 'power3.out' });
    gsap.fromTo('.sb-sec', { opacity: 0, x: 18 }, { opacity: 1, x: 0, duration: .55, stagger: .1, ease: 'power3.out', delay: .2 });
    gsap.fromTo('#bt-panel', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: .6, ease: 'power3.out', delay: .35 });
    $('err-bar').style.display = 'none';
  } catch (err) {
    $('err-bar').innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg><span>${err.message}</span>`;
    $('err-bar').style.display = 'flex';
    gsap.to('#chart-canvas,#prob-canvas,#bt-canvas', { opacity: 1, duration: .3 });
  } finally { btn.textContent = 'Analyze'; btn.classList.remove('busy'); }
}

function animC(id, target, suf, dec, pre = '') {
  const el = $(id); if (!el) return;
  gsap.fromTo({ v: 0 }, { v: target }, { duration: .95, ease: 'power4.out', onUpdate: function () { el.textContent = pre + this.targets()[0].v.toFixed(dec) + suf; } });
}

/* ── Helpers ────────────────────────────────────────────────────────── */
function hexRgb(h) { if (!h || h[0] !== '#') return '128,128,128'; const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255].join(','); }
function buildBlocks(d) {
  const out = [];
  for (const b of d.regime_blocks) { const si = d.dates.indexOf(b.start), ei = d.dates.indexOf(b.end); if (si >= 0) out.push({ si, ei: ei >= 0 ? ei : d.dates.length - 1, label: b.label, color: RC[b.label] || '#4D8DF5' }); }
  return out;
}
function buildProb(d) {
  const l2s = {}; Object.entries(d.label_map).forEach(([k, v]) => { (l2s[v] = l2s[v] || []).push(+k); });
  return d.dates.map((_, i) => { const row = {}; BORDER.forEach(l => { row[l] = (l2s[l] || []).reduce((s, si) => s + (d.state_probs[i] ? d.state_probs[i][si] : 0), 0); }); return row; });
}
function renderLegend() {
  $('legend').innerHTML = BORDER.map(l => `<span class="lg"><span class="lg-dot" style="background:${RC[l]}"></span>${SHORT[l]}</span>`).join('');
}

/* ── Timeline strip ─────────────────────────────────────────────────── */
function renderTimeline(d) {
  const cv = $('tl-canvas'), W = cv.parentElement.clientWidth, ctx = sizeCanvas(cv, W, 40), n = d.dates.length;
  ctx.clearRect(0, 0, W, 40);
  for (const b of S.regimeBlocks) {
    const x0 = b.si / n * W, x1 = b.ei / n * W, rgb = hexRgb(b.color);
    const g = ctx.createLinearGradient(0, 0, 0, 40); g.addColorStop(0, `rgba(${rgb},.85)`); g.addColorStop(1, `rgba(${rgb},.5)`);
    ctx.fillStyle = g; ctx.fillRect(x0, 0, Math.max(x1 - x0, 1.5), 40);
  }
}
$('tl-canvas').addEventListener('mousemove', e => {
  if (!S.candles.length) return; const r = e.currentTarget.getBoundingClientRect();
  S.hoverCandle = Math.max(0, Math.min(S.candles.length - 1, Math.round((e.clientX - r.left) / r.width * (S.candles.length - 1))));
});
$('tl-canvas').addEventListener('mouseleave', () => S.hoverCandle = -1);

/* ── Transition matrix heatmap ──────────────────────────────────────── */
function renderMatrix(d) {
  const cv = $('matrix-cv'), labels = Object.values(d.label_map), nn = labels.length;
  const cs = 46, pad = 52, top = 6, w = pad + nn * cs + 8, h = top + nn * cs + 22;
  const ctx = sizeCanvas(cv, w, h); cv.style.width = w + 'px';
  let drawn = 0;
  (function step() {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < nn; i++) for (let j = 0; j < nn; j++) {
      const idx = i * nn + j, v = d.transition_matrix[i][j], x = pad + j * cs, y = top + i * cs;
      if (idx <= drawn) {
        const p = Math.min((drawn - idx) / 3, 1), rgb = hexRgb(RC[labels[i]] || '#4D8DF5');
        ctx.fillStyle = `rgba(${rgb},${(v * p * .85 + .04).toFixed(3)})`; ctx.beginPath(); ctx.roundRect(x, y, cs - 4, cs - 4, 5); ctx.fill();
        ctx.fillStyle = v * p > .5 ? 'rgba(8,9,12,.9)' : 'rgba(255,255,255,.78)'; ctx.font = "600 11px 'JetBrains Mono'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(v * p * 100) + '%', x + (cs - 4) / 2, y + (cs - 4) / 2);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,.34)'; ctx.font = "10px 'Inter'"; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i < nn; i++) ctx.fillText(SHORT[labels[i]] || labels[i].slice(0, 5), pad - 6, top + i * cs + (cs - 4) / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let j = 0; j < nn; j++) ctx.fillText(SHORT[labels[j]] || labels[j].slice(0, 5), pad + j * cs + (cs - 4) / 2, top + nn * cs + 5);
    drawn += .5; if (drawn < nn * nn + 4) requestAnimationFrame(step);
  })();
}

/* ── Regime statistics table ────────────────────────────────────────── */
function renderStats(d) {
  const el = $('stats-tbl');
  el.innerHTML = '<div class="st-head"><span>Regime</span><span>Time</span><span>Ret</span><span>Vol</span></div>';
  Object.entries(d.regime_stats).forEach(([label, s], i) => {
    const c = RC[label] || '#4D8DF5', row = document.createElement('div'); row.className = 'st-row';
    row.innerHTML = `<span class="st-name"><span class="st-dot" style="background:${c}"></span>${SHORT[label] || label}</span>
      <span class="st-v">${s.pct.toFixed(1)}%</span>
      <span class="st-v" style="color:${s.avg_ret >= 0 ? RC['Bullish Trending'] : RC['Bearish Trending']}">${s.avg_ret >= 0 ? '+' : ''}${s.avg_ret.toFixed(2)}</span>
      <span class="st-v">${s.avg_vol.toFixed(2)}</span>`;
    el.appendChild(row); setTimeout(() => row.classList.add('show'), 120 + i * 90);
  });
}

/* ── Duration ring ──────────────────────────────────────────────────── */
function renderRing(d) {
  const svg = $('ring-svg'), r = 52, cx = 64, cy = 64, sw = 6, circ = 2 * Math.PI * r;
  const c = RC[d.current_regime] || '#4D8DF5', pct = Math.min(d.persistence_forecast / 30, 1);
  svg.innerHTML = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="${sw}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"
      stroke-dasharray="${circ}" stroke-dashoffset="${circ}" transform="rotate(-90 ${cx} ${cy})"
      style="transition:stroke-dashoffset 1.1s cubic-bezier(.16,1,.3,1);filter:drop-shadow(0 0 5px ${c})"/>`;
  setTimeout(() => { svg.querySelectorAll('circle')[1].style.strokeDashoffset = circ * (1 - pct); }, 60);
  $('ring-lbl').innerHTML = `<span class="rv" style="color:${c}">~${Math.round(d.persistence_forecast)}d</span><span class="rs">expected hold</span>`;
}

/* ── Backtest metrics grid ──────────────────────────────────────────── */
function renderBacktestMetrics(bt) {
  const s = bt.metrics.strategy, b = bt.metrics.benchmark, m = bt.metrics;
  const cells = [
    { l: 'Total Return', v: `${s.total_return >= 0 ? '+' : ''}${s.total_return}%`, sub: `B&H ${b.total_return}%`, cls: s.total_return >= 0 ? 'pos' : 'neg' },
    { l: 'CAGR', v: `${s.cagr >= 0 ? '+' : ''}${s.cagr}%`, sub: `B&H ${b.cagr}%`, cls: s.cagr >= 0 ? 'pos' : 'neg' },
    { l: 'Sharpe', v: s.sharpe.toFixed(2), sub: `B&H ${b.sharpe.toFixed(2)}`, cls: s.sharpe >= b.sharpe ? 'pos' : '' },
    { l: 'Sortino', v: s.sortino.toFixed(2), sub: `B&H ${b.sortino.toFixed(2)}`, cls: s.sortino >= b.sortino ? 'pos' : '' },
    { l: 'Max Drawdown', v: `${s.max_drawdown}%`, sub: `B&H ${b.max_drawdown}%`, cls: s.max_drawdown >= b.max_drawdown ? 'pos' : 'neg' },
    { l: 'Time in Market', v: `${m.time_in_market}%`, sub: `${m.trades} switches`, cls: '' },
  ];
  $('bt-metrics').innerHTML = cells.map(c =>
    `<div class="bt-m"><div class="bt-m-lbl">${c.l}</div><div class="bt-m-val ${c.cls}">${c.v}</div><div class="bt-m-sub">${c.sub}</div></div>`
  ).join('');
}
})();

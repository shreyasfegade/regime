(function(){"use strict";
// ═══ CONSTANTS ═══
const RC={'Bullish Trending':'#1D9E75','Bearish Trending':'#D85A30','High Volatility':'#BA7517','Accumulation':'#378ADD'};
const RP={
  'Bullish Trending':{rgb:[29,158,117],speed:.18,drift:-.008},
  'Bearish Trending':{rgb:[216,90,48],speed:.22,drift:.008},
  'High Volatility':{rgb:[186,117,23],speed:.85,drift:0},
  'Accumulation':{rgb:[55,138,221],speed:.09,drift:0},
  'loading':{rgb:[80,80,100],speed:.12,drift:0}
};
const BORDER=['Accumulation','Bullish Trending','Bearish Trending','High Volatility'];
const BREATH=[{f:.0008,a:2.2,ph:0},{f:.00095,a:1.8,ph:1.3},{f:.0013,a:3,ph:2.5},{f:.0006,a:1.4,ph:3.8}];

// ═══ STATE ═══
const S={
  particles:[],candles:[],probBands:[],regimeBlocks:[],dates:[],
  stateSeq:[],stateProbs:[],labelMap:{},regimeColors:{},
  breathTime:0,hoverX:-1,hoverCandle:-1,candleReveal:99999,
  cfg:RP['Accumulation'],regime:'Accumulation',data:null
};
const PAD={l:52,r:12,t:16,b:28};
let chartW=0,chartH=0,cvW=0,cvH=0,probW=0,probH=0;

// ═══ INIT ═══
const $=id=>document.getElementById(id);
$('dt-end').value=new Date().toISOString().slice(0,10);
$('btn-go').onclick=()=>loadData();
$('ticker-input').onkeydown=e=>{if(e.key==='Enter')loadData()};
initParticles();
requestAnimationFrame(masterLoop);
loadData();

// ═══ MASTER LOOP ═══
function masterLoop(ts){
  S.breathTime=ts;
  tickParticles();
  drawChart();
  drawProbBands();
  requestAnimationFrame(masterLoop);
}

// ═══ PARTICLES ═══
function initParticles(){
  const c=$('particle-canvas');c.width=window.innerWidth;c.height=window.innerHeight;
  S.particles=Array.from({length:130},()=>({
    x:Math.random()*c.width,y:Math.random()*c.height,
    vx:(Math.random()-.5)*.3,vy:(Math.random()-.5)*.3,
    r:Math.random()*1.3+.2,op:Math.random()*.45+.08
  }));
  window.onresize=()=>{c.width=window.innerWidth;c.height=window.innerHeight};
}
function tickParticles(){
  const c=$('particle-canvas'),ctx=c.getContext('2d'),cfg=S.cfg;
  ctx.fillStyle='rgba(6,6,8,0.045)';ctx.fillRect(0,0,c.width,c.height);
  for(const p of S.particles){
    p.vx+=(Math.random()-.5)*.015;p.vy+=(Math.random()-.5)*.015+cfg.drift;
    const m=Math.sqrt(p.vx*p.vx+p.vy*p.vy);
    if(m>cfg.speed){p.vx=p.vx/m*cfg.speed;p.vy=p.vy/m*cfg.speed}
    p.x=(p.x+p.vx+c.width)%c.width;p.y=(p.y+p.vy+c.height)%c.height;
    ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
    ctx.fillStyle=`rgba(${cfg.rgb[0]},${cfg.rgb[1]},${cfg.rgb[2]},${p.op})`;ctx.fill();
  }
}

// ═══ CHART ═══
function sizeCanvas(cv,wrap,h){
  const dpr=devicePixelRatio||1;const w=wrap.clientWidth;
  cv.width=w*dpr;cv.height=h*dpr;cv.style.width=w+'px';cv.style.height=h+'px';
  return cv.getContext('2d');
}
function drawChart(){
  const wrap=$('chart-wrap'),cv=$('chart-canvas');
  const ctx=sizeCanvas(cv,wrap,480);const dpr=devicePixelRatio||1;
  ctx.scale(dpr,dpr);
  cvW=wrap.clientWidth;cvH=480;chartW=cvW-PAD.l-PAD.r;chartH=cvH-PAD.t-PAD.b;
  ctx.clearRect(0,0,cvW,cvH);
  if(!S.candles.length)return;
  const n=S.candles.length;
  const prices=S.candles.flatMap(c=>[c.h,c.l]);
  const yMin=Math.min(...prices)*.998,yMax=Math.max(...prices)*1.002;
  const xS=i=>PAD.l+(i/(n-1))*chartW;
  const yS=v=>PAD.t+(1-(v-yMin)/(yMax-yMin))*chartH;
  const cw=Math.max(1,(chartW/n)*.7);

  // Regime wash
  for(const b of S.regimeBlocks){
    const x0=xS(b.si),x1=xS(b.ei),rgb=hexRgb(b.color);
    const g=ctx.createLinearGradient(0,PAD.t,0,PAD.t+chartH);
    g.addColorStop(0,`rgba(${rgb},0)`);g.addColorStop(.6,`rgba(${rgb},.04)`);g.addColorStop(1,`rgba(${rgb},.12)`);
    ctx.fillStyle=g;ctx.fillRect(x0,PAD.t,Math.max(x1-x0,1),chartH);
  }
  // Grid
  ctx.strokeStyle='rgba(255,255,255,.04)';ctx.lineWidth=1;
  for(let i=1;i<5;i++){const y=PAD.t+chartH*i/5;ctx.beginPath();ctx.moveTo(PAD.l,y);ctx.lineTo(PAD.l+chartW,y);ctx.stroke()}
  // Y labels
  ctx.fillStyle='rgba(255,255,255,.3)';ctx.font="10px 'JetBrains Mono'";ctx.textAlign='right';ctx.textBaseline='middle';
  for(let i=0;i<=4;i++){const v=yMin+(yMax-yMin)*i/4;ctx.fillText('$'+v.toFixed(0),PAD.l-6,yS(v))}
  // X labels
  ctx.textAlign='center';ctx.textBaseline='top';
  const step=Math.max(Math.floor(n/8),1);
  for(let i=0;i<n;i+=step){
    const dt=new Date(S.dates[i]);ctx.fillText(dt.toLocaleDateString('en',{month:'short',year:'2-digit'}),xS(i),PAD.t+chartH+8);
  }
  // Candles
  const vis=Math.min(Math.floor(S.candleReveal),n);
  ctx.save();
  for(let i=0;i<vis;i++){
    const c=S.candles[i],up=c.c>=c.o,color=up?'#1D9E75':'#D85A30';
    const x=xS(i),bt=yS(Math.max(c.o,c.c)),bb=yS(Math.min(c.o,c.c)),bh=Math.max(1.5,bb-bt);
    const hov=i===S.hoverCandle;
    // Glow
    ctx.shadowColor=color;ctx.shadowBlur=hov?22:10;
    ctx.fillStyle=color;ctx.globalAlpha=hov?.35:.18;
    ctx.fillRect(x-cw/2-1,bt-1,cw+2,bh+2);ctx.shadowBlur=0;
    // Wick
    ctx.globalAlpha=.55;ctx.fillRect(x-.5,yS(c.h),1,yS(c.l)-yS(c.h));
    // Body
    ctx.globalAlpha=hov?1:.88;ctx.fillRect(x-cw/2,bt,cw,bh);
  }
  ctx.restore();
  // Trend line (20-day MA)
  if(vis>20){
    const pts=[];
    for(let i=19;i<vis;i++){let s=0;for(let j=i-19;j<=i;j++)s+=S.candles[j].c;pts.push({x:xS(i),y:yS(s/20)})}
    ctx.save();ctx.strokeStyle='rgba(255,255,255,.82)';ctx.lineWidth=1.5;
    ctx.shadowColor='rgba(255,255,255,.45)';ctx.shadowBlur=7;ctx.lineJoin='round';ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<pts.length-1;i++){
      const xc=(pts[i].x+pts[i+1].x)/2,yc=(pts[i].y+pts[i+1].y)/2;
      ctx.quadraticCurveTo(pts[i].x,pts[i].y,xc,yc);
    }
    if(pts.length>1)ctx.quadraticCurveTo(pts[pts.length-2].x,pts[pts.length-2].y,pts[pts.length-1].x,pts[pts.length-1].y);
    ctx.stroke();ctx.restore();
  }
  // Crosshair
  if(S.hoverCandle>=0&&S.hoverCandle<n){
    const x=xS(S.hoverCandle),cy=yS(S.candles[S.hoverCandle].c);
    ctx.strokeStyle='rgba(255,255,255,.12)';ctx.lineWidth=1;ctx.setLineDash([4,4]);
    ctx.beginPath();ctx.moveTo(x,PAD.t);ctx.lineTo(x,PAD.t+chartH);ctx.stroke();
    ctx.beginPath();ctx.moveTo(PAD.l,cy);ctx.lineTo(PAD.l+chartW,cy);ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();ctx.arc(x,cy,3,0,Math.PI*2);ctx.fillStyle='#fff';ctx.shadowColor='#fff';ctx.shadowBlur=6;ctx.fill();ctx.shadowBlur=0;
  }
}

// ═══ PROB BANDS ═══
function drawProbBands(){
  const wrap=$('prob-canvas').parentElement,cv=$('prob-canvas');
  const ctx=sizeCanvas(cv,wrap,150);const dpr=devicePixelRatio||1;ctx.scale(dpr,dpr);
  const W=wrap.clientWidth,H=150,t=S.breathTime;
  ctx.clearRect(0,0,W,H);
  if(!S.probBands.length)return;
  const n=S.probBands.length,xS=i=>(i/(n-1))*W;
  for(let bi=0;bi<BORDER.length;bi++){
    const label=BORDER[bi],bp=BREATH[bi],off=Math.sin(t*bp.f+bp.ph)*bp.a;
    const color=RC[label]||'#888',rgb=hexRgb(color);
    const top=[],bot=[];
    for(let i=0;i<n;i++){
      let cb=0,ct=0;
      for(let j=0;j<BORDER.length;j++){const v=S.probBands[i][BORDER[j]]||0;if(j<bi)cb+=v;if(j<=bi)ct+=v}
      bot.push({x:xS(i),y:H-cb*H+off});top.push({x:xS(i),y:H-ct*H+off});
    }
    ctx.beginPath();ctx.moveTo(top[0].x,top[0].y);
    for(let i=1;i<n;i++){const p=top[i-1],c=top[i];ctx.quadraticCurveTo(p.x,p.y,(p.x+c.x)/2,(p.y+c.y)/2)}
    ctx.lineTo(top[n-1].x,top[n-1].y);
    for(let i=n-1;i>=0;i--)ctx.lineTo(bot[i].x,bot[i].y);
    ctx.closePath();
    const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,`rgba(${rgb},.7)`);g.addColorStop(1,`rgba(${rgb},.2)`);
    ctx.fillStyle=g;ctx.fill();
  }
  if(S.hoverCandle>=0){
    const x=xS(S.hoverCandle);ctx.strokeStyle='rgba(255,255,255,.1)';ctx.lineWidth=1;ctx.setLineDash([4,4]);
    ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();ctx.setLineDash([]);
  }
}

// ═══ HOVER ═══
$('chart-canvas').addEventListener('mousemove',e=>{
  const r=e.currentTarget.getBoundingClientRect();
  const mx=e.clientX-r.left,n=S.candles.length;if(!n)return;
  const rel=mx-PAD.l,idx=Math.round((rel/chartW)*(n-1));
  S.hoverCandle=Math.max(0,Math.min(n-1,idx));S.hoverX=mx;
  const c=S.candles[S.hoverCandle],si=S.stateSeq[S.hoverCandle],lbl=S.labelMap[String(si)]||'';
  const prob=S.stateProbs[S.hoverCandle]?S.stateProbs[S.hoverCandle][si]:0;
  const tt=$('tooltip');
  tt.innerHTML=`<div class="tt-r" style="color:${RC[lbl]||'#fff'}">${lbl} ${(prob*100).toFixed(0)}%</div>
    <div class="tt-d"><span class="tt-l">Date</span><span class="tt-v">${S.dates[S.hoverCandle]}</span></div>
    <div class="tt-d"><span class="tt-l">O</span><span class="tt-v">${c.o.toFixed(2)}</span></div>
    <div class="tt-d"><span class="tt-l">H</span><span class="tt-v">${c.h.toFixed(2)}</span></div>
    <div class="tt-d"><span class="tt-l">L</span><span class="tt-v">${c.l.toFixed(2)}</span></div>
    <div class="tt-d"><span class="tt-l">C</span><span class="tt-v">${c.c.toFixed(2)}</span></div>`;
  tt.style.opacity='1';tt.style.left=Math.min(e.clientX+16,innerWidth-180)+'px';tt.style.top=(e.clientY-100)+'px';
});
$('chart-canvas').addEventListener('mouseleave',()=>{S.hoverCandle=-1;S.hoverX=-1;$('tooltip').style.opacity='0'});
$('chart-canvas').style.cursor='crosshair';

// ═══ LOAD DATA ═══
async function loadData(){
  const btn=$('btn-go'),tk=$('ticker-input').value.trim().toUpperCase()||'SPY';
  const st=$('dt-start').value,en=$('dt-end').value;
  btn.textContent='analyzing';S.cfg=RP['loading'];
  gsap.to('#chart-canvas,#prob-canvas',{opacity:.12,duration:.3,ease:'power2.in'});
  const scan=$('scan-line');gsap.fromTo(scan,{top:0,opacity:.6},{top:'100%',opacity:0,duration:.5,ease:'none',
    onStart:()=>scan.style.display='block',onComplete:()=>scan.style.display='none'});
  try{
    const r=await fetch(`/api/analyze?ticker=${tk}&start=${st}&end=${en}`);const d=await r.json();
    if(d.error)throw new Error(d.error);
    S.data=d;S.dates=d.dates;S.stateSeq=d.state_sequence;S.stateProbs=d.state_probs;
    S.labelMap=d.label_map;S.regimeColors=d.regime_colors;S.regime=d.current_regime;
    S.candles=d.ohlc.map(c=>({o:c.o,h:c.h,l:c.l,c:c.c}));
    S.regimeBlocks=buildBlocks(d);S.probBands=buildProb(d);
    S.cfg=RP[d.current_regime]||RP['Accumulation'];
    $('logo-dot').style.background=RC[d.current_regime]||'#378ADD';
    gsap.to('#chart-canvas,#prob-canvas',{opacity:1,duration:.6,ease:'power2.out'});
    // Hero
    const c=RC[d.current_regime]||'#378ADD';
    const re=$('stat-regime-name');
    gsap.to(re,{opacity:0,duration:.2,onComplete:()=>{re.textContent=d.current_regime;re.style.color=c;gsap.to(re,{opacity:1,duration:.3})}});
    animC('stat-confidence',d.current_confidence*100,'%',0);
    animC('stat-persistence',d.persistence_forecast,'d',0,'~');
    $('stat-regimes').textContent=Object.keys(d.label_map).length;
    const rc=$('regime-card');gsap.to(rc,{borderLeftColor:c,duration:.5});rc.style.boxShadow=`inset 0 0 60px ${c}08`;
    // Candle cascade
    S.candleReveal=0;gsap.to(S,{candleReveal:S.candles.length,duration:1.2,ease:'power1.inOut'});
    // Sidebar
    renderTimeline(d);renderMatrix(d);renderStats(d);renderRing(d);
    gsap.fromTo('.stat-card',{opacity:0,y:12},{opacity:1,y:0,duration:.5,stagger:.08,ease:'power3.out'});
    gsap.fromTo('.sb-sec',{opacity:0,x:16},{opacity:1,x:0,duration:.5,stagger:.1,ease:'power3.out',delay:.2});
    $('err-bar').style.display='none';
  }catch(err){$('err-bar').textContent='⚠ '+err.message;$('err-bar').style.display='block';
    gsap.to('#chart-canvas,#prob-canvas',{opacity:1,duration:.3})}
  finally{btn.textContent='Analyze'}
}
function animC(id,target,suf,dec,pre=''){
  const el=$(id);if(!el)return;
  gsap.fromTo({v:0},{v:target},{duration:.9,ease:'power4.out',onUpdate:function(){el.textContent=pre+this.targets()[0].v.toFixed(dec)+suf}});
}

// ═══ HELPERS ═══
function hexRgb(h){if(!h||h[0]!=='#')return'128,128,128';const v=parseInt(h.slice(1),16);return[(v>>16)&255,(v>>8)&255,v&255].join(',')}
function buildBlocks(d){
  const out=[];
  for(const b of d.regime_blocks){
    const si=d.dates.indexOf(b.start),ei=d.dates.indexOf(b.end);
    if(si>=0)out.push({si,ei:ei>=0?ei:d.dates.length-1,label:b.label,color:RC[b.label]||'#378ADD'});
  }return out;
}
function buildProb(d){
  const l2s={};Object.entries(d.label_map).forEach(([k,v])=>{if(!l2s[v])l2s[v]=[];l2s[v].push(+k)});
  return d.dates.map((_,i)=>{
    const row={};BORDER.forEach(l=>{const idxs=l2s[l]||[];row[l]=idxs.reduce((s,si)=>s+(d.state_probs[i]?d.state_probs[i][si]:0),0)});return row;
  });
}

// ═══ TIMELINE ═══
function renderTimeline(d){
  const cv=$('tl-canvas'),ctx=cv.getContext('2d');
  const dpr=devicePixelRatio||1;const W=cv.parentElement.clientWidth;
  cv.width=W*dpr;cv.height=36*dpr;cv.style.width=W+'px';ctx.scale(dpr,dpr);
  const n=d.dates.length;
  for(const b of S.regimeBlocks){
    const x0=b.si/n*W,x1=b.ei/n*W;
    ctx.fillStyle=b.color;ctx.globalAlpha=.6;ctx.fillRect(x0,0,Math.max(x1-x0,2),36);
  }ctx.globalAlpha=1;
}

// ═══ MATRIX ═══
function renderMatrix(d){
  const cv=$('matrix-cv'),ctx=cv.getContext('2d');
  const labels=Object.values(d.label_map),sh={'Bullish Trending':'Bull','Bearish Trending':'Bear','High Volatility':'HiVol','Accumulation':'Accum'};
  const nn=labels.length,cs=42,pad=48,top=4;
  cv.width=pad+nn*cs+8;cv.height=top+nn*cs+20;cv.style.width=cv.width+'px';
  let drawn=0;
  (function step(){
    ctx.clearRect(0,0,cv.width,cv.height);
    for(let i=0;i<nn;i++){for(let j=0;j<nn;j++){
      const idx=i*nn+j,v=d.transition_matrix[i][j],x=pad+j*cs,y=top+i*cs;
      if(idx<=drawn){
        const p=Math.min((drawn-idx)/3,1),rgb=hexRgb(RC[labels[i]]||'#378ADD');
        ctx.fillStyle=`rgba(${rgb},${v*p*.8})`;ctx.beginPath();ctx.roundRect(x,y,cs-3,cs-3,4);ctx.fill();
        ctx.fillStyle=v>.5?'rgba(0,0,0,.8)':'rgba(255,255,255,.7)';ctx.font='11px Inter';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(Math.round(v*p*100)+'%',x+cs/2,y+cs/2);
      }
    }
    ctx.fillStyle='rgba(255,255,255,.3)';ctx.font='10px Inter';ctx.textAlign='right';ctx.textBaseline='middle';
    for(let i=0;i<nn;i++)ctx.fillText(sh[labels[i]]||labels[i].slice(0,4),pad-5,top+i*cs+cs/2);
    ctx.textAlign='center';ctx.textBaseline='top';
    for(let j=0;j<nn;j++)ctx.fillText(sh[labels[j]]||labels[j].slice(0,4),pad+j*cs+cs/2,top+nn*cs+4);
    }
    drawn+=.5;if(drawn<nn*nn+4)requestAnimationFrame(step);
  })();
}

// ═══ STATS ═══
function renderStats(d){
  const el=$('stats-tbl');
  el.innerHTML='<div style="display:grid;grid-template-columns:1fr 44px 52px 44px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:2px;font-size:9.5px;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.06em"><span>Regime</span><span style="text-align:right">Time</span><span style="text-align:right">Ret</span><span style="text-align:right">Vol</span></div>';
  Object.entries(d.regime_stats).forEach(([label,s],i)=>{
    const c=RC[label]||'#378ADD';const row=document.createElement('div');row.className='st-row regime-stat-row';
    row.innerHTML=`<span class="st-name"><span class="st-dot" style="background:${c}"></span>${label}</span>
      <span class="st-v">${s.pct.toFixed(1)}%</span>
      <span class="st-v" style="color:${s.avg_ret>=0?'#1D9E75':'#D85A30'}">${s.avg_ret>=0?'+':''}${s.avg_ret.toFixed(3)}%</span>
      <span class="st-v">${s.avg_vol.toFixed(3)}%</span>`;
    el.appendChild(row);setTimeout(()=>row.classList.add('show'),100+i*80);
  });
}

// ═══ RING ═══
function renderRing(d){
  const svg=$('ring-svg');svg.innerHTML='';
  const r=44,cx=55,cy=55,sw=5,circ=2*Math.PI*r;
  const c=RC[d.current_regime]||'#378ADD',pct=Math.min(d.persistence_forecast/30,1);
  svg.innerHTML=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="${sw}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"
      stroke-dasharray="${circ}" stroke-dashoffset="${circ}" transform="rotate(-90 ${cx} ${cy})"
      style="transition:stroke-dashoffset 1s cubic-bezier(.16,1,.3,1);filter:drop-shadow(0 0 4px ${c})"/>`;
  setTimeout(()=>{svg.querySelectorAll('circle')[1].style.strokeDashoffset=circ*(1-pct)},50);
  $('ring-lbl').innerHTML=`<span class="rv" style="color:${c}">~${Math.round(d.persistence_forecast)}d</span><span class="rs">expected</span>`;
}
})();

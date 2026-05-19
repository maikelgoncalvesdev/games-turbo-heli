const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const W = cv.width, H = cv.height;
// buffer de normais (G-buffer 2D): #8080ff = normal "para cima" (plano)
const cvN = document.createElement('canvas');
cvN.width = W; cvN.height = H;
const nx = cvN.getContext('2d');
const $ = id => document.getElementById(id);

let keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  initAudio();
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter'].includes(e.code)) e.preventDefault();
  if ((state === 'menu' || state === 'over') && !e.repeat &&
      ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)) {
    gameMode = gameMode === 'easy' ? 'normal' : 'easy';
    renderMode();
  }
  if (e.code === 'Enter' && !e.repeat) {
    if (state === 'bonus' && bonus && bonus.done) continueAfterBonus();
    else if (state === 'play' || state === 'pause') togglePause();
    else startGame();
  }
  if (e.code === 'Space' && !e.repeat &&
      state === 'bonus' && bonus && bonus.done) {
    continueAfterBonus();
  }
});
addEventListener('keyup', e => keys[e.code] = false);

addEventListener('keydown', e => {
  if (e.code === 'KeyM') { initAudio(); toggleMusic(); }
});

// ---- controles touch (mobile) ----
(function setupTouch(){
  // mostra os controles só quando há toque real; some ao usar teclado
  // (evita botões num PC com tela touch enquanto se joga no teclado)
  addEventListener('touchstart',
    () => document.body.classList.add('touch'),
    {passive:true, capture:true});
  addEventListener('keydown',
    () => document.body.classList.remove('touch'),
    {capture:true});
  const pad = $('tPad'), stick = $('tStick'),
        bFire = $('bFire'), bBomb = $('bBomb');
  const DZ = 14, MAXR = 48;          // zona morta e raio máx. do analógico
  let moveId = null, ox = 0, oy = 0;

  function clearDirs(){
    keys.ArrowLeft = keys.ArrowRight = false;
    keys.ArrowUp = keys.ArrowDown = false;
    stick.style.transform = '';
  }
  function setDir(dx, dy){
    const d = Math.hypot(dx, dy);
    const cl = d > MAXR ? MAXR / d : 1;
    stick.style.transform = `translate(${dx*cl}px,${dy*cl}px)`;
    keys.ArrowLeft  = dx < -DZ;
    keys.ArrowRight = dx >  DZ;
    keys.ArrowUp    = dy < -DZ;
    keys.ArrowDown  = dy >  DZ;
  }
  pad.addEventListener('touchstart', e => {
    e.preventDefault(); e.stopPropagation(); initAudio();
    const t = e.changedTouches[0];
    moveId = t.identifier;
    const r = pad.getBoundingClientRect();
    ox = r.left + r.width/2; oy = r.top + r.height/2;
    setDir(t.clientX - ox, t.clientY - oy);
  }, {passive:false});
  pad.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches)
      if (t.identifier === moveId) setDir(t.clientX-ox, t.clientY-oy);
  }, {passive:false});
  const endMove = e => {
    for (const t of e.changedTouches)
      if (t.identifier === moveId){ moveId = null; clearDirs(); }
  };
  pad.addEventListener('touchend', endMove);
  pad.addEventListener('touchcancel', endMove);

  function hold(el, code){
    el.addEventListener('touchstart', e => {
      e.preventDefault(); e.stopPropagation(); initAudio();
      keys[code] = true; el.classList.add('on');
    }, {passive:false});
    const up = e => { e.preventDefault();
      keys[code] = false; el.classList.remove('on'); };
    el.addEventListener('touchend', up, {passive:false});
    el.addEventListener('touchcancel', up);
  }
  hold(bFire, 'Space');
  hold(bBomb, 'KeyB');

  // toque inicia / reinicia / despausa (funciona já no 1º toque,
  // mesmo antes dos controles aparecerem)
  addEventListener('touchstart', e => {
    initAudio();
    if (state === 'menu' || state === 'over') { e.preventDefault(); startGame(); }
    else if (state === 'pause') { e.preventDefault(); togglePause(); }
    else if (state === 'bonus' && bonus && bonus.done) {
      e.preventDefault(); continueAfterBonus();
    }
  }, {passive:false});
})();

let state = 'menu';
let gameMode = 'normal';                 // 'normal' | 'easy'
function renderMode() {
  const el = $('modeSel'); if (!el) return;
  const opt = (m, lbl, mg) => `<span class="key" style="display:inline-block;`
    + `margin:${mg};${m === gameMode
      ? 'background:#ffcf3f;color:#111;font-weight:bold' : ''}">${lbl}</span>`;
  el.innerHTML = opt('easy', 'FÁCIL', '18px 0 6px')
    + '<br>' + opt('normal', 'NORMAL', '6px 0 0');
}
function ehp(v) {                         // vida do inimigo (fácil = -25%)
  return gameMode === 'easy' ? Math.max(1, Math.round(v * 0.75)) : v;
}
let score = 0, hi = +(localStorage.tigerHeliHi || 0), lives = 3, bombs = 3;
let player, bullets, enemies, eBullets, parts, powerups, boss,
    scrollY, spawnT, frame, invuln, nextBoss, shake = 0,
    shocks = [], bombFx = [];
let stage, stageT, kills, banner, bossPending;   // progressão
let helipad = null;                     // heliporto de decolagem (intro)
let landpad = null;                     // heliporto de pouso (fim da fase)
let outro = null;                       // sequência pós-chefe (scroll/land)
let bonus = null;                       // tela de bônus entre fases
const TAKEOFF = 80;                     // frames da sequência de decolagem
function addShake(n){ shake = Math.min(14, shake + n); }

// --- escalonamento de dificuldade por fase ---
const STAGE_FRAMES = 2600;          // duração de cada fase antes do chefe
const BOSS_KINDS = ['heli', 'tank', 'ship'];
function diff() {
  const s = stage || 1;
  return {
    hpBonus:  Math.min(5, Math.floor((s - 1) / 3)),   // +vida (a cada 3 fases)
    speed:    Math.min(1.40, 0.85 + (s - 1) * 0.035), // velocidade dos inimigos
    bullet:   Math.min(1.35, 0.8 + (s - 1) * 0.03),   // velocidade tiro inimigo
    spawn:    Math.max(58, 120 - (s - 1) * 5),         // intervalo de spawn (qtd)
  };
}
function setBanner(txt, sub) { banner = { txt, sub: sub || '', t: 150 }; }

$('hi').textContent = hi;
renderMode();

function reset() {
  player = { x: W/2, y: H - 52, w: 34, h: 34, speed: 3, cd: 0,
             pwr: 1, side: 0, rapid: 0,
             takeoff: TAKEOFF, alt: 0.7 };       // decolando do heliporto
  helipad = { x: W/2, sy0: H - 40 };             // base de tela em scrollY=0
  bullets = []; enemies = []; eBullets = []; parts = [];
  powerups = []; boss = null; shocks = []; bombFx = [];
  landpad = null; outro = null; bonus = null;
  scrollY = 0; spawnT = 150; frame = 0; invuln = 90;
  shake = 0;
  stage = 1; stageT = STAGE_FRAMES; kills = 0; bossPending = false;
  score = 0; lives = 3; bombs = 3;
  setBanner('FASE 1', 'PREPARE-SE');
  updateHud();
}
function updateHud() {
  $('score').textContent = score;
  $('lives').textContent = lives;
  $('hi').textContent = hi;
}
function startGame() {
  reset();
  state = 'play';
  $('msg').classList.add('hidden');
  musStep = 0;
  if (musicOn) startMusic();
}
function togglePause() {
  if (state === 'play') {
    state = 'pause';
    stopMusic();
    showMsg(`<h1>PAUSA</h1>
      <div class="sub">JOGO PAUSADO</div>
      <p class="blink">▶ Pressione ENTER para continuar</p>`);
  } else if (state === 'pause') {
    state = 'play';
    $('msg').classList.add('hidden');
    if (musicOn) startMusic();
  }
}
function showMsg(html) {
  $('msg').innerHTML = html;
  $('msg').classList.remove('hidden');
}

// ---- terreno (rios, estradas, manchas) gerado por faixa ----
const terrain = [];
function terrainBand(by) {
  // by = índice de banda de 40px no espaço do mundo
  let r = Math.sin(by * 12.9898) * 43758.5453;
  r = r - Math.floor(r);
  return r;
}
// ---- biomas por segmento de mundo (aleatório, determinístico) ----
const RIVER_HW = 55;
const SEG = 1700;                       // comprimento de cada bioma (px mundo)
const BIOMES = ['forest', 'desert', 'ice', 'city', 'ocean'];
// hash já é definido mais abaixo; usamos uma versão local idêntica aqui
function bhash(a, b) {
  let h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function segOf(y) { return Math.floor((scrollY - y) / SEG); }
// TESTE: força o bioma oceano em todo o mapa (trocar p/ false p/ normal)
const FORCE_OCEAN = false;
function biomeOf(seg) {
  if (FORCE_OCEAN) return 'ocean';
  if (seg <= 0) return 'forest';                // começa sempre na floresta
  return BIOMES[Math.floor(bhash(seg, 9.7) * BIOMES.length) % BIOMES.length];
}
// bioma com TRANSIÇÃO: perto da emenda, mistura (dither) com o vizinho.
// `r` é um aleatório determinístico 0..1 da célula (mantém ground+scatter juntos)
const BIOME_TRANS = 150;                 // largura da faixa de transição (mundo)
function biomeBlend(y, r) {
  const seg = segOf(y);
  const local = (scrollY - y) - seg * SEG;          // 0..SEG
  let nb = null, f = 0;                              // vizinho e prob. de troca
  if (local < BIOME_TRANS) {
    nb = seg - 1; f = 0.5 * (1 - local / BIOME_TRANS);
  } else if (local > SEG - BIOME_TRANS) {
    nb = seg + 1; f = 0.5 * (1 - (SEG - local) / BIOME_TRANS);
  }
  const base = biomeOf(seg);
  if (nb === null) return base;
  const nbb = biomeOf(nb);
  // cidade tem borda DURA (sem dither) p/ a malha viária não piscar
  if (base === 'city' || nbb === 'city') return base;
  // oceano também tem borda DURA: misturar células de mar dentro de outro
  // bioma escurecia o terreno (parecia "molhado") na transição
  if (base === 'ocean' || nbb === 'ocean') return base;
  return r < f ? nbb : base;
}
// tipo de água do segmento: cidade=lago; outros=rio (às vezes) ou nada
function waterOf(seg) {
  const b = biomeOf(seg);
  if (b === 'city') return 'lake';
  if (b === 'ocean') return 'none';            // bioma já é todo água
  return bhash(seg, 29.3) < 0.55 ? 'river' : 'none';
}
// meia-largura do rio numa coord. de tela (0 = sem rio); pontas ARREDONDADAS
function riverHWAt(y) {
  const seg = segOf(y);
  if (waterOf(seg) !== 'river') return 0;
  const wp = scrollY - y;                 // progresso de mundo
  const local = wp - seg * SEG;           // 0..SEG dentro do segmento
  // largura IRREGULAR: estreita/alarga ao longo do leito + rugosidade
  // de margem (tudo função contínua do mundo -> não pisca)
  const wf = 0.60
    + 0.26*(0.5+0.5*Math.sin(wp*0.0086 + 0.9))
    + 0.14*(0.5+0.5*Math.sin(wp*0.021  + 3.4))
    + 0.06*Math.sin(wp*0.075);
  const R = RIVER_HW * Math.max(0.42, wf); // raio (variável) da ponta/leito
  // se o segmento vizinho também é rio, não afina nessa borda (rio contínuo)
  const distStart = waterOf(seg - 1) === 'river' ? 1e9 : local;
  const distEnd   = waterOf(seg + 1) === 'river' ? 1e9 : (SEG - local);
  const edge = Math.min(distStart, distEnd);
  if (edge >= R) return R;
  if (edge <= 0) return 0;
  // tampa SEMICIRCULAR: ponta totalmente arredondada (sem bico)
  return Math.sqrt(R * R - (R - edge) * (R - edge));
}
function riverCX(y) {
  // soma de senos incomensuráveis -> meandro irregular, contínuo em todo
  // o mundo (sem emendas), nunca um "S" repetido
  const m = (y - scrollY);
  let cx = W*0.5
    + Math.sin(m*0.0041 + 0.6) * W*0.20
    + Math.sin(m*0.0107 + 2.3) * W*0.10
    + Math.sin(m*0.024  + 4.1) * W*0.05;
  return Math.max(W*0.16, Math.min(W*0.84, cx));
}
function inRiver(x, y, margin = 0) {
  const hw = riverHWAt(y);
  return hw > 0 && Math.abs(x - riverCX(y)) < hw + margin;
}
// lago(s) de cidade visíveis: centro e raio na tela
function cityLakes() {
  const out = [];
  for (let s = segOf(H + 200); s <= segOf(-200); s++) {
    if (waterOf(s) !== 'lake') continue;
    const cy = scrollY - (s * SEG + SEG * 0.5);
    if (cy < -200 || cy > H + 200) continue;
    out.push({
      x: W * (0.28 + 0.44 * bhash(s, 5.1)), y: cy,
      rx: 110 + bhash(s, 6.2) * 60, ry: 80 + bhash(s, 7.3) * 50,
      p1: bhash(s,8.1)*6.28, p2: bhash(s,9.4)*6.28, p3: bhash(s,10.7)*6.28,
    });
  }
  return out;
}
// fator radial determinístico (contorno irregular da lagoa)
function lakeWob(l, a) {
  return 1
    + 0.20*Math.sin(3*a + l.p1)
    + 0.12*Math.sin(5*a + l.p2)
    + 0.07*Math.sin(2*a + l.p3);
}
function lakePath(l, g, pad) {
  g.beginPath();
  for (let i = 0; i <= 44; i++) {
    const a = i/44*Math.PI*2, k = lakeWob(l, a);
    const x = l.x + (l.rx+pad)*k*Math.cos(a);
    const y = l.y + (l.ry+pad)*k*Math.sin(a);
    i ? g.lineTo(x,y) : g.moveTo(x,y);
  }
  g.closePath();
}
function inLake(x, y, m = 0) {
  return cityLakes().some(l => {
    const dx = x - l.x, dy = y - l.y, k = lakeWob(l, Math.atan2(dy, dx));
    const ex = dx / ((l.rx+m)*k), ey = dy / ((l.ry+m)*k);
    return ex*ex + ey*ey < 1;
  });
}

// ---- inimigos ----
const TYPES = {
  tank:  { w:30, h:30, hp:2, pts:150, col:'#7d6b3f', shoots:true },
  ship:  { w:46, h:60, hp:6, pts:500, col:'#556070', shoots:true },
  build: { w:40, h:40, hp:4, pts:300, col:'#8a4b2b', shoots:false, fixed:true },
  jet:   { w:28, h:24, hp:1, pts:200, col:'#cfd6e0', shoots:false, fast:true },
  // ---- frota naval (bioma oceano) ----
  boat:    { w:34, h:46, hp:2,  pts:250,  col:'#5b6b78', shoots:true },
  warship: { w:54, h:104, hp:11, pts:1200, col:'#4a5662', shoots:true },
  carrier: { w:86, h:168, hp:22, pts:3000, col:'#3f4a55', shoots:true },
};
function spawnTrain() {
  const rl = lineList(RAIL_P).find(o => {
    const ry = railScreenY(o.n);
    return ry > -20 && ry < H*0.45 && biomeOf(segOf(ry)) !== 'ocean';
  });
  if (!rl) return;                                  // sem trilho no mar
  const cars = 4, len = cars*46 + 44;
  const fromLeft = Math.random() < .5;
  enemies.push({
    t: 'train', cars, w: len, h: 30, col: '#3a3f47',
    railN: rl.n, y: railScreenY(rl.n) + 10,
    x: fromLeft ? -len/2 - 20 : W + len/2 + 20,
    vx: (fromLeft ? 1 : -1) * 1.35, vy: 0,
    hp: ehp(16), pts: 1800, cd: 55, drop: true,
  });
}
function isVessel(t) {
  return t === 'ship' || t === 'boat' || t === 'warship' || t === 'carrier';
}
function spawnNaval() {
  // controla a lotação: poucas embarcações na tela ao mesmo tempo
  const live = enemies.filter(o => isVessel(o.t));
  if (live.length >= 3) return;                       // mar não fica entupido
  const r = Math.random();
  let t = r < .55 ? 'boat' : (r < .85 ? 'warship' : 'carrier');
  // no máximo 1 porta-aviões; evita 2 navios grandes juntos
  if (t === 'carrier' && live.some(o => o.t === 'carrier')) t = 'boat';
  if ((t === 'carrier' || t === 'warship') &&
      live.filter(o => o.t === 'carrier' || o.t === 'warship').length >= 1)
    t = 'boat';
  const cfg = TYPES[t];
  const D = diff();
  // procura uma faixa de entrada sem outra embarcação por perto
  let x = 40 + Math.random() * (W - 80), tries = 0;
  while (tries++ < 14 && enemies.some(o =>
      isVessel(o.t) && o.y < 60 &&
      Math.abs(o.x - x) < (cfg.w + o.w) * 0.5 + 20))
    x = 40 + Math.random() * (W - 80);
  enemies.push({
    t, ...cfg,
    x, y: -cfg.h * 0.5 - 12,
    hp: ehp(cfg.hp + D.hpBonus),
    cd: 50 + Math.random() * 70,
    vx: (Math.random() - .5) * 0.5,
    vy: (t === 'carrier' ? 0.45 : t === 'warship' ? 0.7 : 1.5) * D.speed,
    jcd: 130 + Math.random() * 90,
    drop: Math.random() < (t === 'boat' ? .25 : .5),
  });
}
function spawnEnemy() {
  // bioma oceano: só frota naval (sem unidades terrestres / trem)
  if (biomeOf(segOf(-60)) === 'ocean') { spawnNaval(); return; }
  if (Math.random() < 0.10) { spawnTrain(); return; }
  const roll = Math.random();
  let t;
  // chance de barco (ship) dobrada: .17 -> .34
  if (roll < .40) t = 'tank';
  else if (roll < .55) t = 'build';
  else if (roll < .89) t = 'ship';
  else t = 'jet';
  let cfg = TYPES[t];
  let x = 30 + Math.random() * (W - 60);
  if (t === 'build' || t === 'tank') {
    // unidades terrestres não nascem dentro/encostando no rio ou lago
    const onWater = xx => inRiver(xx, -60, cfg.w/2 + 14)
                       || inLake(xx, -60, cfg.w/2 + 14);
    let tries = 0;
    while (onWater(x) && tries++ < 12)
      x = 30 + Math.random() * (W - 60);
    if (onWater(x)) return; // desiste desta vez
  }
  if (t === 'build') {
    // prédio não nasce na estrada nem no trilho
    if (nearLine(ROAD_P, -60, 36) || nearLine(RAIL_P, -60, 30)) return;
  }
  if (t === 'tank' && Math.random() < 0.35) {
    // tanque trafegando de lado pela estrada (90°)
    const rl = lineList(ROAD_P).find(o => o.y > -10 && o.y < H*0.4 &&
      biomeOf(segOf(o.y)) !== 'ocean');             // sem estrada no mar
    if (rl) {
      const fromLeft = Math.random() < .5;
      enemies.push({
        t: 'tank', ...cfg, road: true, lineN: rl.n,
        x: fromLeft ? -36 : W + 36, y: rl.y + 12,
        vx: (fromLeft ? 1 : -1) * 1.4, vy: 0,
        head: fromLeft ? Math.PI/2 : -Math.PI/2,
        hp: ehp(cfg.hp), cd: 45 + Math.random()*50,
        drop: Math.random() < .3,
      });
      return;
    }
  }
  if (t === 'ship') {
    // barcos só onde há rio (largura suficiente); senão, vira tanque
    const hw = riverHWAt(-60);
    if (hw < 30) { t = 'tank'; cfg = TYPES.tank;
      x = 30 + Math.random() * (W - 60);
      if (inRiver(x, -60, cfg.w/2 + 14)) return; }
    else { x = riverCX(-60) + (Math.random()-.5) * (hw - 20); }
  }
  const D = diff();
  enemies.push({
    t, ...cfg,
    x, y: -60,
    hp: ehp(cfg.hp + (cfg.fixed ? 0 : D.hpBonus)), cd: 60 + Math.random() * 90,
    vx: t === 'jet' ? (Math.random() < .5 ? -1.5 : 1.5) : 0,
    vy: (cfg.fixed ? 1.2 : (t === 'jet' ? 3.2 : 1.1 + Math.random()*0.7))
         * (cfg.fixed ? 1 : D.speed),
    drop: (t === 'ship' || t === 'jet') && Math.random() < .35,
  });
}

// ---------- ÁUDIO (WebAudio 100% sintetizado — sem direitos autorais) ----------
let AC = null, MASTER = null, SFXBUS = null, MUSBUS = null, musicOn = true;
function initAudio() {
  if (AC) return;
  try { AC = new (window.AudioContext || window.webkitAudioContext)(); }
  catch (e) { return; }
  MASTER = AC.createGain(); MASTER.gain.value = 0.85;
  MASTER.connect(AC.destination);
  // compressor para a mixagem não estourar
  const comp = AC.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 5;
  SFXBUS = AC.createGain(); SFXBUS.gain.value = 1.1;
  MUSBUS = AC.createGain(); MUSBUS.gain.value = 0.0;
  SFXBUS.connect(comp); MUSBUS.connect(comp); comp.connect(MASTER);
}
function env(freq, dur, type, vol, dest, slideTo, attack = 0.005) {
  if (!AC) return;
  const t = AC.currentTime;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest || SFXBUS);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, lp = 1800) {
  if (!AC) return;
  const n = AC.sampleRate * dur, buf = AC.createBuffer(1, n, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random()*2-1) * (1 - i/n);
  const s = AC.createBufferSource(); s.buffer = buf;
  const f = AC.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.setValueAtTime(lp, AC.currentTime);
  f.frequency.exponentialRampToValueAtTime(120, AC.currentTime + dur);
  const g = AC.createGain(); g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(SFXBUS); s.start();
}
const SFX = {
  shoot: () => { noise(.07, .22, 5200);                 // estalo
                 env(440, .12, 'square',   .13, SFXBUS, 60);  // corpo
                 env(150, .13, 'sawtooth', .11, SFXBUS, 42);  // soco grave
                 env(1600, .04, 'triangle', .045); },         // snap agudo
  hit:   () => { env(320, .06, 'square', .07, SFXBUS, 140); },
  boom:  () => { noise(.45, .5, 2400);
                 env(150, .4, 'sawtooth', .22, SFXBUS, 36);
                 env(70, .5, 'sine', .25, SFXBUS, 30); },
  power: () => [0,1,2].forEach(i =>
            setTimeout(()=>env([523,784,1175][i], .14,'square',.12), i*70)),
  life:  () => [659,784,988,1319,988,1319].forEach((f,i)=>
            setTimeout(()=>env(f,.16,'triangle',.14),i*90)),
  warn:  () => [0,1,2].forEach(i=>
            setTimeout(()=>env(180,.22,'sawtooth',.2,SFXBUS,150),i*240)),
  death: () => { noise(.8,.5,1600);
                 env(420,.7,'sawtooth',.22,SFXBUS,28); },
  drop:  () => { env(1100, .26, 'sine', .16, SFXBUS, 130);   // assobio
                 env(700, .26, 'triangle', .10, SFXBUS, 90); },
  bomb:  () => { noise(.9, .6, 3200);
                 env(110, .8, 'sawtooth', .3, SFXBUS, 24);
                 env(55, .9, 'sine', .32, SFXBUS, 20);
                 setTimeout(()=>noise(.5,.35,1800), 120); },
};

// ---------- MÚSICA DE FUNDO (chiptune em loop, gerada) ----------
let musStep = 0, musTimer = null;
// Lá menor — baixo, acordes e melodia animada (estilo arcade dos anos 80)
const NT = { 0:0, A2:110, C3:130.8, D3:146.8, E3:164.8, G3:196,
  A3:220, C4:261.6, D4:293.7, E4:329.6, F4:349.2, G4:392, A4:440,
  B4:493.9, C5:523.3, D5:587.3, E5:659.3, G5:784 };
const BASS = ['A2','A2','E3','E3','F4','F4','C3','C3',
              'G3','G3','D3','D3','A2','A2','E3','G3'].map(n=>NT[n]||NT[n]);
const LEAD = ['A4','C5','E5','C5','A4','E5','D5','C5',
              'F4','A4','C5','A4','G4','B4','D5','E5',
              'A4','E5','C5','E5','A4','C5','E5','G5',
              'G4','D5','B4','D5','E5','D5','C5','B4'];
function playMusicStep() {
  if (!AC || !musicOn) return;
  const dest = MUSBUS;
  const i16 = musStep % 16, i32 = musStep % 32;
  // baixo pulsante
  env(BASS[i16], 0.20, 'triangle', 0.5, dest, 0, 0.008);
  // bumbo/hi-hat
  if (i16 % 4 === 0) env(60, 0.12, 'sine', 0.6, dest, 30);
  if (i16 % 2 === 1) noiseHat();
  // melodia (corcheias)
  if (musStep % 2 === 0) {
    const f = NT[LEAD[(musStep/2) % LEAD.length]];
    if (f) { env(f, 0.16, 'square', 0.28, dest);
             env(f*2, 0.10, 'triangle', 0.10, dest); }
  }
  // acorde de apoio a cada compasso
  if (i16 === 0) {
    [NT.A3, NT.C4, NT.E4].forEach(f => env(f, 0.5, 'sawtooth', 0.06, dest));
  }
  musStep++;
}
function noiseHat() {
  if (!AC) return;
  const n = AC.sampleRate*0.04, b = AC.createBuffer(1,n,AC.sampleRate);
  const d = b.getChannelData(0);
  for (let i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n);
  const s=AC.createBufferSource(); s.buffer=b;
  const f=AC.createBiquadFilter(); f.type='highpass'; f.frequency.value=6000;
  const g=AC.createGain(); g.gain.value=0.18;
  s.connect(f); f.connect(g); g.connect(MUSBUS); s.start();
}
function startMusic() {
  if (!AC || musTimer) return;
  MUSBUS.gain.cancelScheduledValues(AC.currentTime);
  MUSBUS.gain.setValueAtTime(MUSBUS.gain.value, AC.currentTime);
  MUSBUS.gain.linearRampToValueAtTime(0.58, AC.currentTime + 1.2);
  musTimer = setInterval(playMusicStep, 136); // ~138 BPM (16 avos)
}
function stopMusic(fade = true) {
  if (musTimer) { clearInterval(musTimer); musTimer = null; }
  if (AC && MUSBUS) {
    MUSBUS.gain.cancelScheduledValues(AC.currentTime);
    MUSBUS.gain.linearRampToValueAtTime(0, AC.currentTime + (fade?0.4:0.01));
  }
}
function toggleMusic() {
  musicOn = !musicOn;
  if (musicOn && state === 'play') startMusic(); else stopMusic();
}

// ---- power-ups ----
const PUPS = {
  F:   { col:'#ff5a3c', label:'F' },   // tiro frontal +
  S:   { col:'#3ca0ff', label:'S' },   // tiro lateral
  B:   { col:'#ffcc00', label:'B' },   // bomba +1
  '1UP':{ col:'#3cff7a', label:'1UP' },// vida extra
};
// limites máximos (vida/bomba dependem do modo)
const PWR_MAX = 4, SIDE_MAX = 3;
function bombMax() { return gameMode === 'easy' ? 5 : 3; }
function lifeMax() { return gameMode === 'easy' ? 10 : 5; }
// um power-up só é útil (e só deve dropar) se ainda não estiver no limite
function canUse(kind) {
  if (kind === 'F')   return player.pwr  < PWR_MAX;
  if (kind === 'S')   return player.side < SIDE_MAX;
  if (kind === 'B')   return bombs        < bombMax();
  if (kind === '1UP') return lives        < lifeMax();
  return true;
}
function dropPower(x, y, kind) {
  if (!canUse(kind)) return;            // no limite: não dropa
  powerups.push({ x, y, w:24, h:24, kind, ...PUPS[kind] });
}
function applyPower(kind) {
  const p = player;
  if (kind === 'F')      p.pwr  = Math.min(PWR_MAX, p.pwr + 1);
  else if (kind === 'S') p.side = Math.min(SIDE_MAX, p.side + 1);
  else if (kind === 'B') bombs = Math.min(bombMax(), bombs + 1);
  else if (kind === '1UP') lives = Math.min(lifeMax(), lives + 1);
  if (kind === '1UP') SFX.life(); else SFX.power();
  explode(player.x, player.y, PUPS[kind].col, 14);
  updateHud();
}

// ---- chefe ----
function spawnBoss() {
  SFX.warn();
  let kind = BOSS_KINDS[(stage - 1) % BOSS_KINDS.length];
  // encouraçado SÓ no oceano; em terra, tanque (helicóptero em qualquer lugar)
  if (biomeOf(segOf(player.y)) === 'ocean') {
    if (kind === 'tank') kind = 'ship';
  } else {
    if (kind === 'ship') kind = 'tank';
  }
  const hp = ehp(120 + (stage - 1) * 45);
  const base = { kind, hp, maxhp: hp, cd: 60, rkt: 130,
    rotor: 0, bank: 0, bob: 0, tread: 0, dir: 1,
    intro: true, x: W/2, y: -160 };
  if (kind === 'heli')
    Object.assign(base, { w:154, h:122, baseY:116 });
  else if (kind === 'tank')
    Object.assign(base, { w:128, h:140, baseY:90, maxY:H*0.5 });
  else // ship
    Object.assign(base, { w:120, h:170, baseY:120, vx:1.5 });
  boss = base;
  setBanner('CHEFE ' + stage, kind === 'heli' ? 'HELICÓPTERO DE ATAQUE'
    : kind === 'tank' ? 'TANQUE PESADO' : 'ENCOURAÇADO');
}
function bossShoot(b, hard) {
  const aim = (sx, sy, sp, spread, n) => {
    const base = Math.atan2(player.y - sy, player.x - sx);
    for (let k = 0; k < n; k++) {
      const a = base + (k - (n-1)/2) * spread;
      eBullets.push({ x:sx, y:sy, w:8, h:8,
        vx: Math.cos(a)*sp, vy: Math.sin(a)*sp });
    }
  };
  if (b.kind === 'heli') {
    const gy = b.y + b.h*0.30;
    b.cd--;
    if (b.cd <= 0) { aim(b.x, gy, 3.6, 0.13, 3); SFX.hit();
      b.cd = hard ? 40 : 66; }
    b.rkt--;
    if (b.rkt <= 0) {
      [-b.w*0.34,-b.w*0.20,b.w*0.20,b.w*0.34].forEach(ox =>
        eBullets.push({ x:b.x+ox, y:b.y+b.h*0.15, w:9, h:18,
          vx: ox*0.012, vy: 4.4, missile:true }));
      SFX.boom(); addShake(4); b.rkt = hard ? 95 : 150;
    }
  } else if (b.kind === 'tank') {
    const gy = b.y + b.h*0.32;
    // agressividade cresce com a fase (cedo = bem tranquilo)
    const agg = Math.min(3, Math.floor((stage - 2) / 3)); // 0 na 1ª vez
    b.cd--;
    if (b.cd <= 0) {
      aim(b.x, gy, 3.4 + agg*0.2, 0.16, 1 + agg + (hard?1:0));
      // leque só a partir de fases avançadas (ou no modo furioso)
      if (agg >= 1 || hard) {
        const n = 3 + agg + (hard?2:0);
        for (let i=0;i<n;i++){ const a=Math.PI/2+(i-(n-1)/2)*0.34;
          eBullets.push({ x:b.x, y:gy, w:7,h:7,
            vx:Math.cos(a)*2.4, vy:Math.sin(a)*2.4 }); }
      }
      SFX.hit(); b.cd = (hard ? 70 : 100) - agg*8;
    }
  } else { // ship: bordadas + canhão mirado
    b.cd--;
    if (b.cd <= 0) {
      aim(b.x, b.y+b.h*0.2, 3.4, 0.12, 3);
      [-b.w*0.3, b.w*0.3].forEach(ox =>
        aim(b.x+ox, b.y, 3.0, 0.5, hard ? 4 : 3));
      SFX.hit(); b.cd = hard ? 52 : 84;
    }
  }
}
function updateBoss() {
  const b = boss;
  b.rotor += 0.9; b.tread += 2;
  if (b.intro) {
    b.y += 1.7;
    if (b.y >= b.baseY) b.intro = false;
    return;
  }
  const hard = b.hp < b.maxhp/2;
  const ddx = player.x - b.x;
  if (b.kind === 'heli') {
    b.bob += 0.04;
    b.y = b.baseY + Math.sin(b.bob) * (hard ? 70 : 50);
    const vx = Math.max(-2.6, Math.min(2.6, ddx * (hard?0.06:0.045)));
    b.x += vx; b.bank += ((-vx*0.12) - b.bank) * 0.1;
  } else if (b.kind === 'tank') {
    const sp = hard ? 1.8 : 1.2;
    b.y += b.dir * sp;
    if (b.y >= b.maxY) b.dir = -1;
    if (b.y <= b.baseY) b.dir = 1;
    b.x += Math.max(-1, Math.min(1, ddx * 0.05));
  } else { // ship: vai e volta na horizontal
    b.y = b.baseY;
    b.x += b.vx * (hard ? 1.5 : 1);
    if (b.x > W - b.w/2 - 4) b.vx = -Math.abs(b.vx);
    if (b.x < b.w/2 + 4)     b.vx =  Math.abs(b.vx);
  }
  b.x = Math.max(b.w/2 + 4, Math.min(W - b.w/2 - 4, b.x));
  bossShoot(b, hard);
  // colisão com tiros do player
  bullets.forEach(bl => {
    if (b.hp > 0 && Math.abs(bl.x-b.x) < b.w/2 && Math.abs(bl.y-b.y) < b.h/2) {
      b.hp -= bl.dmg || 1; bl.dead = true;
      explode(bl.x, bl.y, bl.mis ? '#ff8c1a' : '#ffe', bl.mis ? 14 : 4);
      if (b.hp % 8 === 0) SFX.hit();
      if (b.hp <= 0) { killBoss(); return; }
    }
  });
  if (!boss) return;
  // colisão corpo
  if (invuln === 0 &&
      Math.abs(player.x-b.x) < b.w/2 && Math.abs(player.y-b.y) < b.h/2)
    loseLife();
}
function killBoss() {
  if (!boss) return;
  const b = boss;
  for (let i = 0; i < 8; i++) setTimeout(() => {
    explode(b.x + (Math.random()-.5)*b.w,
            b.y + (Math.random()-.5)*b.h, '#ff8c1a', 26);
    SFX.boom(); addShake(9);
  }, i*120);
  score += 5000;
  if (score > hi) { hi = score; localStorage.tigerHeliHi = hi; }
  dropPower(b.x-30, b.y, '1UP');
  dropPower(b.x+30, b.y, 'B');
  dropPower(b.x, b.y+30, 'F');
  boss = null;
  bossPending = false;
  spawnT = 120;
  // limpa qualquer power-up que estava caindo (não cabe na cena de pouso)
  // mas os recém-soltos do chefe ficam: deixamos cair pelos próximos frames
  enemies = []; eBullets = []; bullets = [];
  // inicia a sequência de fim de fase (scroll calmo -> heliporto -> pouso)
  // espera UMA tela inteira de rolagem (~H/1.2) antes do heliporto aparecer
  // — tempo pro jogador caçar os power-ups dropados pelo chefe
  outro = { phase: 'scroll', t: Math.ceil(H / 1.2) };
  setBanner('FASE ' + stage + ' COMPLETA', 'POUSO À FRENTE');
  SFX.life();
  updateHud();
}

// --- escolhe um lugar à frente p/ o heliporto pousar, sem obstáculos ---
// (estrada/trilho/rio/lago). Avança o "futuro" até achar — ou usa
// fallback no pior caso depois de ~80 tentativas.
function findLandSpot() {
  const PAD_R = 50, STEP = 50, MAX = 80;
  const saved = scrollY;
  for (let i = 0; i < MAX; i++) {
    const sy0 = -60 - saved - i * STEP;
    // simula o scrollY no instante em que o pad chega em screenY = -60
    scrollY = -sy0 - 60;
    const bm = biomeOf(segOf(-60));
    const isOcean = bm === 'ocean';
    let blocked = false;
    if (!isOcean) {
      // estrada (linhas horizontais a cada ROAD_P no mundo)
      if (nearLine(ROAD_P, -60, ROADW/2 + PAD_R + 12)) blocked = true;
      // trilho (com deslocamento p/ não colidir com a estrada)
      else if (lineList(RAIL_P).some(o =>
        Math.abs(railWorldShift(o.n*RAIL_P) + scrollY + 60) < 14 + PAD_R + 12))
        blocked = true;
      // rio/lago no eixo do heliporto
      else if (inRiver(W/2, -60, PAD_R + 10)) blocked = true;
      else if (inLake(W/2, -60, PAD_R + 10))  blocked = true;
    }
    if (!blocked) {
      scrollY = saved;
      return { x: W/2, sy0, marine: isOcean };
    }
  }
  // fallback: usa o ponto original (raro chegar aqui)
  scrollY = saved;
  const sy0 = -60 - saved;
  return { x: W/2, sy0, marine: biomeOf(segOf(-60)) === 'ocean' };
}

// --- Fim de fase: scroll calmo -> entra heliporto -> heli pousa ---
function updateOutro() {
  const o = outro, p = player;
  // particulas/efeitos continuam atualizando
  parts.forEach(pt => { pt.x += pt.vx; pt.y += pt.vy;
    pt.vx *= .94; pt.vy *= .94; pt.life--; });
  parts = parts.filter(pt => pt.life > 0);
  shocks.forEach(sw => {
    const k = 1 - sw.life / sw.maxlife;
    sw.r = 10 + (sw.maxr - 10) * (1 - (1-k)*(1-k));
    sw.life--;
  });
  shocks = shocks.filter(sw => sw.life > 0);
  bombFx.forEach(b => {
    b.y += b.vy; b.vy += 0.07; b.rot += 0.16; b.life--;
    if (b.fuse > 0 && --b.fuse === 0) detonateBomb(b.x, b.y);
  });
  bombFx = bombFx.filter(b => b.life > 0);
  if (shake > 0) shake *= 0.86;
  // banner segue desaparecendo
  if (banner && banner.t > 0) banner.t--;
  // power-ups caindo continuam (player pode pegá-los antes do pouso)
  powerups.forEach(u => { u.y += 1.3; u.t2 = (u.t2||0)+1; });
  powerups = powerups.filter(u => {
    if (hit(player, u)) { applyPower(u.kind); return false; }
    return u.y < H + 30;
  });

  if (o.phase === 'scroll') {
    scrollY += 1.2;
    // jogador ainda controla o heli (pra coletar power-ups do chefe);
    // sem tiro/bomba — só movimento. Banner já avisa "POUSO À FRENTE".
    if (keys.ArrowLeft)  p.x -= p.speed;
    if (keys.ArrowRight) p.x += p.speed;
    if (keys.ArrowUp)    p.y -= p.speed;
    if (keys.ArrowDown)  p.y += p.speed;
    p.x = Math.max(p.w/2, Math.min(W - p.w/2, p.x));
    p.y = Math.max(p.h/2, Math.min(H - p.h/2, p.y));
    if (--o.t <= 0) {
      // escolhe um ponto à frente sem obstáculo (estrada, trilho, rio, lago)
      landpad = findLandSpot();
      o.phase = 'approach';
    }
  } else if (o.phase === 'approach') {
    scrollY += 1.0;
    const cy = landpad.sy0 + scrollY;
    // glide x/y suavemente em direção ao pad
    p.x += (landpad.x - p.x) * 0.06;
    // pairar acima do pad, mas nunca sair do topo da tela
    const hover = Math.max(H * 0.30, cy - 22);
    p.y += (hover - p.y) * 0.05;
    if (cy >= H * 0.58) {
      o.phase = 'land';
      o.t = 70;
      o.land0 = TAKEOFF;                   // reaproveita a duração
    }
  } else if (o.phase === 'land') {
    // sem scroll: mundo congela enquanto o heli desce
    const cy = landpad.sy0 + scrollY;
    p.x += (landpad.x - p.x) * 0.20;
    p.y += ((cy - 12) - p.y) * 0.18;
    // altitude cai 1 -> 0.6 (mesma escala visual do takeoff)
    const k = Math.max(0, o.t) / 70;
    p.alt = 0.6 + 0.4 * (1 - (1 - k)*(1 - k));   // ease-in (suave no fim)
    if (--o.t <= 0) {
      p.x = landpad.x; p.y = cy - 12; p.alt = 0.6;
      // prepara tela de bônus
      const cannon = Math.max(0, p.pwr - 1) + Math.max(0, p.side);
      bonus = {
        lives: lives, livesPts: lives * 2000,
        bombs: bombs, bombsPts: bombs * 1000,
        cannon: cannon,
        cannonPts: gameMode === 'easy' ? 0 : cannon * 1000,
        rem: 0, step: 'lives', delay: 40, done: false, tick: 0,
      };
      bonus.rem = bonus.livesPts;
      state = 'bonus';
    }
  }
}

// --- contabiliza bônus com animação (chamado quando state==='bonus') ---
function updateBonus() {
  frame++;
  const bn = bonus; if (!bn) return;
  // banner ainda pode estar fading
  if (banner && banner.t > 0) banner.t--;
  if (bn.delay > 0) { bn.delay--; return; }
  if (bn.rem > 0) {
    const inc = Math.min(bn.rem, 100);
    bn.rem -= inc;
    score += inc;
    if (score > hi) { hi = score; localStorage.tigerHeliHi = hi; }
    updateHud();
    bn.tick++;
    if (bn.tick % 2 === 0) SFX.hit();
    return;
  }
  // passa pra próxima categoria
  if (bn.step === 'lives') {
    bn.step = 'bombs'; bn.rem = bn.bombsPts; bn.delay = 24;
  } else if (bn.step === 'bombs') {
    bn.step = 'cannon'; bn.rem = bn.cannonPts; bn.delay = 24;
  } else if (bn.step === 'cannon') {
    bn.step = 'done'; bn.done = true; SFX.life();
  }
}

// --- jogador escolhe continuar: decola do heliporto, vai pra próxima fase ---
function continueAfterBonus() {
  if (!bonus || !bonus.done) return;
  stage++;
  stageT = STAGE_FRAMES;
  bossPending = false;
  spawnT = 150;
  bonus = null;
  // heliporto de "decolagem" = mesmo do pouso, reaproveita drawHelipad
  helipad = { x: landpad.x, sy0: landpad.sy0, marine: !!landpad.marine };
  landpad = null;                                  // só um pad aparece
  outro = null;
  // alinha o heli sobre o pad e dispara a sequência de decolagem
  player.x = helipad.x;
  player.y = helipad.sy0 + scrollY - 12;
  player.alt = 0.6;
  player.takeoff = TAKEOFF;
  invuln = 90;
  setBanner('FASE ' + stage, 'INIMIGOS MAIS FORTES');
  state = 'play';
  if (musicOn) startMusic();
  SFX.power();
  updateHud();
}

function explode(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 4;
    parts.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s,
      life: 20 + Math.random()*20, color });
  }
}

function detonateBomb(x, y) {
  enemies.forEach(e => { explode(e.x, e.y, '#ff8c1a', 14); score += e.pts; });
  explode(x, y, '#ffcc00', 60);
  // onda de choque dupla a partir do ponto de impacto
  shocks.push({ x, y, r:10, maxr:Math.hypot(W,H),
                life:34, maxlife:34, w:7,  color:'#bff7ff' });
  shocks.push({ x, y, r:4,  maxr:W*0.7,
                life:26, maxlife:26, w:11, color:'#ffcf3f' });
  SFX.bomb(); addShake(14);
  enemies = [];
  eBullets = [];
  // a bomba não mata o chefe, mas tira bastante energia
  if (boss && !boss.intro) {
    boss.hp = Math.max(1, boss.hp - Math.ceil(boss.maxhp * 0.25));
    explode(boss.x, boss.y, '#ff8c1a', 30);
    addShake(8);
  }
  updateHud();
}

function hit(a, b) {
  return Math.abs(a.x - b.x) < (a.w/2 + (b.w||4)/2) &&
         Math.abs(a.y - b.y) < (a.h/2 + (b.h||4)/2);
}

function update() {
  frame++;
  const p = player;

  // ---- sequência de decolagem: heli sobe do heliporto ----
  if (p.takeoff > 0) {
    p.takeoff--;
    const k = 1 - p.takeoff / TAKEOFF;            // 0 → 1
    const ease = k * k * (3 - 2 * k);             // smoothstep
    // baseY = posição do heli "no chão" (acompanha o heliporto onde quer
    // que ele esteja); sobe 38px enquanto decola.
    const baseY = helipad ? (helipad.sy0 + scrollY - 12) : (H - 52);
    p.x = helipad ? helipad.x : p.x;              // alinha sobre o heliporto
    p.y = baseY + (-38) * ease;
    p.alt = 0.7 + 0.3 * ease;                     // ganha "altitude"
    if (p.takeoff === 0) p.alt = 1;
    return;                                       // mundo congelado na intro
  }
  // outro: pós-chefe (scroll calmo, aproximação, pouso)
  if (outro) { updateOutro(); return; }
  if (!boss) scrollY += 1.2;          // mapa para de subir durante o chefe
  if (invuln > 0) invuln--;

  // player
  if (keys.ArrowLeft)  p.x -= p.speed;
  if (keys.ArrowRight) p.x += p.speed;
  if (keys.ArrowUp)    p.y -= p.speed;
  if (keys.ArrowDown)  p.y += p.speed;
  p.x = Math.max(p.w/2, Math.min(W - p.w/2, p.x));
  p.y = Math.max(p.h/2, Math.min(H - p.h/2, p.y));
  if (p.cd > 0) p.cd--;
  if (keys.Space && p.cd === 0) {
    const sb = (dx, vx) => bullets.push(
      { x: p.x + dx, y: p.y - 18, w:4, h:12, vx: vx||0 });
    // tiro frontal por nível (1→2→3 escala; 4 = mantém tudo + mísseis)
    sb(-8, 0); sb(8, 0);
    if (p.pwr >= 2) sb(0, 0);
    if (p.pwr >= 3) { sb(-14, -1.6); sb(14, 1.6); }
    if (p.pwr >= 4) {
      const mis = dx => bullets.push(
        { x: p.x + dx, y: p.y - 18, w:8, h:16, vx:0, vy:-9, mis:1, dmg:4 });
      mis(-9); mis(9);
    }
    // tiro lateral
    if (p.side >= 1) {
      bullets.push({ x:p.x-12, y:p.y, w:10, h:4, vx:-9, vy:0, side:1 });
      bullets.push({ x:p.x+12, y:p.y, w:10, h:4, vx: 9, vy:0, side:1 });
    }
    if (p.side >= 2) {
      bullets.push({ x:p.x-10, y:p.y, w:6, h:8, vx:-6, vy:-7 });
      bullets.push({ x:p.x+10, y:p.y, w:6, h:8, vx: 6, vy:-7 });
    }
    // tiro traseiro 45° (evolução do tiro lateral)
    if (p.side >= 3) {
      bullets.push({ x:p.x-10, y:p.y+8, w:6, h:8, vx:-6, vy: 7, side:1 });
      bullets.push({ x:p.x+10, y:p.y+8, w:6, h:8, vx: 6, vy: 7, side:1 });
    }
    let cd = Math.max(8, (p.pwr >= 3 ? 11 : 14) - (p.rapid || 0));
    if (gameMode === 'easy') cd = Math.max(5, Math.round(cd * 0.75));
    p.cd = cd;                            // FÁCIL: +25% de poder de fogo
    SFX.shoot();
  }
  if (keys.KeyB && bombs > 0 && !p.bombLock) {
    bombs--; p.bombLock = true;
    // tiros inimigos só somem na EXPLOSÃO (ver detonateBomb)
    // bomba VISÍVEL sendo lançada: cai do heli e detona ao fim do pavio
    bombFx.push({ x:p.x, y:p.y + 8, vy:0.5, rot:0,
                  life:42, maxlife:42, fuse:38 });
    SFX.drop(); addShake(3);
    updateHud();
  }
  if (!keys.KeyB) p.bombLock = false;

  // bullets
  bullets.forEach(b => {
    b.x += b.vx || 0;
    b.y += (b.vy !== undefined) ? b.vy : -11;
  });
  bullets = bullets.filter(b =>
    b.y > -20 && b.y < H+20 && b.x > -30 && b.x < W+30);

  // power-ups caindo
  powerups.forEach(u => { u.y += 1.3; u.t2 = (u.t2||0)+1; });
  powerups = powerups.filter(u => {
    if (hit(player, u)) {
      applyPower(u.kind);
      return false;
    }
    return u.y < H + 30;
  });

  // ---- fases: conta o tempo da fase; ao fim, chama o chefe ----
  if (banner && banner.t > 0) banner.t--;
  if (!boss && !bossPending) {
    stageT--;
    if (stageT <= 0) {
      bossPending = true;
      setBanner('PERIGO', 'CHEFE SE APROXIMA');
      SFX.warn();
    }
  }
  if (bossPending && (!banner || banner.t <= 0) && !boss) {
    bossPending = false;
    spawnBoss();
  }
  if (boss) updateBoss();

  // spawn normal (pausa durante o chefe e a aproximação dele)
  if (!boss && !bossPending) {
    spawnT--;
    if (spawnT <= 0) { spawnEnemy(); spawnT = diff().spawn - Math.min(6, frame/6000); }
  }

  // enemies
  enemies.forEach(e => {
    if (e.t === 'train') {
      // trem corre sobre o trilho (preso à linha do mundo)
      e.x += e.vx;
      e.y = railScreenY(e.railN) + 10;
      e.cd--;
      if (e.cd <= 0 && e.x > -e.w/2 && e.x < W + e.w/2) {
        // canhões de 2 vagões mirando o helicóptero
        [-e.w*0.28, e.w*0.18].forEach(ox => {
          const gx = e.x + ox, gy = e.y;
          const dx = player.x-gx, dy = player.y-gy, d = Math.hypot(dx,dy)||1;
          const ts = 3 * diff().bullet;
          eBullets.push({ x:gx, y:gy, w:8, h:8, vx:dx/d*ts, vy:dy/d*ts });
        });
        SFX.hit();
        e.cd = 70;
      }
      return;
    }
    if (e.road) {
      // tanque trafegando de lado pela estrada (90°)
      e.x += e.vx;
      e.y = e.lineN * ROAD_P + scrollY + 12;
      e.cd--;
      if (e.cd <= 0 && e.x > 0 && e.x < W) {
        const dx = player.x-e.x, dy = player.y-e.y, d = Math.hypot(dx,dy)||1;
        { const s=2.6*diff().bullet;
          eBullets.push({ x:e.x, y:e.y, w:7, h:7, vx:dx/d*s, vy:dy/d*s }); }
        e.cd = 80 + Math.random()*50;
      }
      return;
    }
    if (e.t === 'tank') {
      // tanque manobra: vira até 45° e pode recuar de leve p/ mirar
      const dx = player.x - e.x, dy = player.y - e.y;
      let want = Math.atan2(dx, dy);                 // 0 = reto p/ frente
      want = Math.max(-Math.PI/4, Math.min(Math.PI/4, want));
      if (e.head === undefined) e.head = 0;
      const turn = 0.028;
      e.head += Math.max(-turn, Math.min(turn, want - e.head));
      const spd = e.vy;
      e.x += Math.sin(e.head) * spd * 0.85;
      let fwd = Math.cos(e.head) * spd;
      // se o jogador está acima, o tanque só DESACELERA (nunca volta p/ cima)
      if (dy < 0) fwd = Math.max(spd * 0.18, fwd * 0.45);
      e.y += fwd;
      e.x = Math.max(e.w/2, Math.min(W - e.w/2, e.x));
    } else {
      e.y += e.vy;
      e.x += e.vx;
    }
    if (e.t === 'jet' && (e.x < 20 || e.x > W-20)) e.vx *= -1;
    // tanques/prédios desviam do rio (não andam na água)
    if ((e.t === 'tank' || e.t === 'build') && inRiver(e.x, e.y, e.w/2 + 6)) {
      const dir = e.x < riverCX(e.y) ? -1 : 1;
      e.x += dir * 2.2;
      e.x = Math.max(e.w/2, Math.min(W - e.w/2, e.x));
    }
    // tanques/prédios também não entram no lago da cidade
    if ((e.t === 'tank' || e.t === 'build') && inLake(e.x, e.y, e.w/2 + 6)) {
      const lk = cityLakes().find(l => {
        const dx=(e.x-l.x)/(l.rx+e.w/2+6), dy=(e.y-l.y)/(l.ry+e.w/2+6);
        return dx*dx + dy*dy < 1;
      });
      if (lk) {
        e.x += (e.x < lk.x ? -1 : 1) * 2.4;
        e.x = Math.max(e.w/2, Math.min(W - e.w/2, e.x));
      }
    }
    // tanques não se amontoam: afastam-se uns dos outros (X e Y)
    if (e.t === 'tank' && !e.road) {
      enemies.forEach(o => {
        if (o === e || o.t !== 'tank' || o.road) return;
        const dx = e.x - o.x, dy = e.y - o.y;
        const mx = e.w * 0.92, my = e.h * 0.92;
        if (Math.abs(dx) < mx && Math.abs(dy) < my) {
          e.x += (dx >= 0 ? 1 : -1) * (mx - Math.abs(dx)) * 0.12;
          e.y += (dy >= 0 ? 1 : -1) * (my - Math.abs(dy)) * 0.06;
        }
      });
      e.x = Math.max(e.w/2, Math.min(W - e.w/2, e.x));
    }
    // barcos seguem a curva do rio e NUNCA saem da água
    if (e.t === 'ship') {
      const hw = riverHWAt(e.y);
      // água estreita demais p/ o casco (perto da ponta) => sai de cena
      if (hw < e.w * 0.55) { e.dead = true; return; }
      const cx = riverCX(e.y);
      e.x += Math.max(-1.6, Math.min(1.6, (cx - e.x) * 0.10));
      // trava o casco inteiro dentro das margens
      const lim = hw - e.w * 0.5;
      e.x = Math.max(cx - lim, Math.min(cx + lim, e.x));
    }
    // embarcações não se sobrepõem: empurra horizontalmente quem encosta
    if (isVessel(e.t)) {
      enemies.forEach(o => {
        if (o === e || !isVessel(o.t)) return;
        const dx = e.x - o.x, dy = e.y - o.y;
        const minX = (e.w + o.w) * 0.5 + 8;
        const minY = (e.h + o.h) * 0.5;
        if (Math.abs(dx) < minX && Math.abs(dy) < minY) {
          const s = (dx >= 0 ? 1 : -1) * (minX - Math.abs(dx)) * 0.10;
          e.x += s; o.x -= s;
        }
      });
      e.x = Math.max(e.w/2, Math.min(W - e.w/2, e.x));
    }
    // caça dispara 1 míssil quando fica DE FRENTE para o heli
    // (alinhado na horizontal e com o heli logo à frente/abaixo)
    if (e.t === 'jet' && !e.fired && e.y > 0 && e.y < H*0.72 &&
        e.y < player.y - 20 &&
        Math.abs(e.x - player.x) < (e.w + player.w) * 0.5) {
      eBullets.push({ x:e.x, y:e.y+12, w:8, h:18,
        vx:0, vy:4.6, missile:true });
      SFX.hit();
      e.fired = true;
    }
    // porta-aviões lança caças do convés periodicamente
    if (e.t === 'carrier') {
      if (e.jcd === undefined) e.jcd = 150;
      e.jcd--;
      const jetsUp = enemies.reduce((n,o) => n + (o.t === 'jet' ? 1 : 0), 0);
      if (e.jcd <= 0 && jetsUp < 3 && e.y > -e.h*0.3 && e.y < H * 0.6) {
        const D = diff();
        const dir = Math.random() < .5 ? -1 : 1;
        enemies.push({
          t: 'jet', ...TYPES.jet,
          x: e.x + dir * 12, y: e.y + e.h * 0.32,
          hp: TYPES.jet.hp, vx: dir * 1.6, vy: 3.4 * D.speed,
          launch: 14, drop: Math.random() < .3,
        });
        SFX.hit();
        e.launchFx = 10;
        e.jcd = 170 + Math.random() * 130;
      }
      if (e.launchFx > 0) e.launchFx--;
    }
    if (e.shoots) {
      e.cd--;
      if (e.cd <= 0 && e.y > 0 && e.y < H - 120) {
        const dx = player.x - e.x, dy = player.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        { const s=2.5*diff().bullet;
          eBullets.push({ x:e.x, y:e.y, w:7, h:7, vx:dx/d*s, vy:dy/d*s }); }
        e.cd = 90 + Math.random()*60;
      }
    }
  });

  // colisão tiro x inimigo
  bullets.forEach(b => {
    enemies.forEach(e => {
      if (e.hp > 0 && hit(e, b)) {
        e.hp -= b.dmg || 1; b.dead = true;
        explode(b.x, b.y, b.mis ? '#ff8c1a' : '#ffe', b.mis ? 14 : 4);
        if (e.hp <= 0) {
          e.dead = true; score += e.pts;
          explode(e.x, e.y, e.col, 24);
          explode(e.x, e.y, '#ff8c1a', 16);
          SFX.boom(); addShake(e.t === 'ship' ? 5 : 3);
          // meta de abates → cadência permanente na run
          kills++;
          if (kills % 40 === 0 && player.rapid < 2) {
            player.rapid++; SFX.power();
            setBanner('TURBO +' + player.rapid, 'CADÊNCIA AUMENTADA');
          }
          if (e.drop) dropPower(e.x, e.y,
            ['F','S','B','1UP'][Math.random()<.12?3:(Math.random()*3|0)]);
          if (score > hi) { hi = score; localStorage.tigerHeliHi = hi; }
          updateHud();
        }
      }
    });
  });
  bullets = bullets.filter(b => !b.dead);
  enemies = enemies.filter(e => !e.dead && e.y < H + 70 && e.y > -160 &&
    e.x > -e.w - 80 && e.x < W + e.w + 80);

  // eBullets
  eBullets.forEach(b => { b.x += b.vx; b.y += b.vy; });
  eBullets = eBullets.filter(b => b.y < H+20 && b.y > -20 && b.x > -20 && b.x < W+20);

  // dano ao player
  if (invuln === 0) {
    const collided =
      eBullets.some(b => hit(player, b)) ||
      enemies.some(e => e.hp > 0 && hit(player, e));
    if (collided) loseLife();
  }

  // particles
  parts.forEach(pt => { pt.x += pt.vx; pt.y += pt.vy;
    pt.vx *= .94; pt.vy *= .94; pt.life--; });
  parts = parts.filter(pt => pt.life > 0);

  // ondas de choque (bomba): raio cresce com easing, somem ao fim da vida
  shocks.forEach(sw => {
    const k = 1 - sw.life / sw.maxlife;        // 0 -> 1
    sw.r = 10 + (sw.maxr - 10) * (1 - (1-k)*(1-k));   // ease-out
    sw.life--;
  });
  shocks = shocks.filter(sw => sw.life > 0);

  // bomba caindo: gravidade + giro; detona quando o pavio zera
  bombFx.forEach(b => {
    b.y += b.vy; b.vy += 0.07; b.rot += 0.16; b.life--;
    if (b.fuse > 0 && --b.fuse === 0) detonateBomb(b.x, b.y);
  });
  bombFx = bombFx.filter(b => b.life > 0);

  if (shake > 0) shake *= 0.86;
}

function loseLife() {
  explode(player.x, player.y, '#ffcc00', 50);
  explode(player.x, player.y, '#ff3300', 30);
  SFX.death(); addShake(10);
  // ao ser atingido, perde um nível de poder (no FÁCIL os canhões não caem)
  if (gameMode !== 'easy') {
    if (player.pwr > 1) player.pwr--;
    else if (player.side > 0) player.side--;
    else if (player.rapid > 0) player.rapid--;
  }
  lives--;
  updateHud();
  if (lives <= 0) {
    state = 'over';
    stopMusic();
    showMsg(`<h1>GAME OVER</h1>
      <div class="sub">MISSÃO ENCERRADA</div>
      <p>Chegou à <b style="color:#ffcf3f">FASE ${stage}</b></p>
      <p>Pontuação: <b style="color:#ffcf3f">${score}</b></p>
      <p>Recorde: <b style="color:#5ff0d0">${hi}</b></p>
      <p id="modeSel"></p>
      <p class="blink">▶ Pressione ENTER para jogar de novo</p>`);
    renderMode();
  } else {
    player.x = W/2; player.y = H - 90;
    invuln = 110; bombs = Math.max(bombs, 1);
    eBullets = [];
  }
}

// ---- desenho ----
// hash determinístico 0..1 para uma célula do mundo
function hash(ix, iy) {
  let h = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
// ruído de valor (bilinear/suave): contínuo no mundo -> sem "quadrados"
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf*xf*(3-2*xf), v = yf*yf*(3-2*yf);
  const a = hash(xi, yi),   b = hash(xi+1, yi);
  const c = hash(xi, yi+1), d = hash(xi+1, yi+1);
  return (a*(1-u)+b*u)*(1-v) + (c*(1-u)+d*u)*v;
}

// estradas e trilhos: linhas de período fixo no mundo (rolam sem "pular")
const ROAD_P = 560, RAIL_P = 740;
const ROADW = 46;                       // largura da via (asfalto/terra)
function lineList(P, lo = -50, hi = H + 50) {
  const a = [];
  for (let n = Math.floor((lo - scrollY)/P);
           n <= Math.ceil((hi - scrollY)/P); n++)
    a.push({ n, y: n*P + scrollY });
  return a;
}
function nearLine(P, screenY, band) {
  return lineList(P).some(o => Math.abs(o.y - screenY) < band);
}
// trilho se afasta da estrada mais próxima (não sobrepõe, mas pode ficar perto)
const RAIL_MIN_GAP = 64;
function railWorldShift(worldY) {
  const nr = Math.round(worldY / ROAD_P) * ROAD_P;
  const d = worldY - nr;
  if (Math.abs(d) < RAIL_MIN_GAP)
    return nr + (d >= 0 ? 1 : -1) * RAIL_MIN_GAP;
  return worldY;
}
function railScreenY(n) { return railWorldShift(n*RAIL_P) + scrollY; }

// pontes desenhadas de novo por cima dos barcos (barco passa por baixo)
let gRoads = [], gRails = [];
function railBridge(railY) {
  const hw = riverHWAt(railY+11);
  if (hw < 20) return;                       // sem rio aqui = sem ponte
  const cx = riverCX(railY+11);
  const bx = cx - hw - 12, bW = (hw + 12) * 2;
  ctx.fillStyle = '#3a3f47';
  ctx.fillRect(bx, railY-6, bW, 38);
  ctx.fillStyle = '#5a4129';
  for (let x = bx; x < bx + bW; x += 8) ctx.fillRect(x, railY-4, 5, 34);
  ctx.strokeStyle = '#2c3036'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(bx, railY-6); ctx.lineTo(bx+bW, railY-6);
  ctx.moveTo(bx, railY+32); ctx.lineTo(bx+bW, railY+32);
  ctx.stroke();
  ctx.lineWidth = 2;
  for (let x = bx; x < bx + bW; x += 18) {
    ctx.beginPath();
    ctx.moveTo(x, railY-6); ctx.lineTo(x+9, railY+32);
    ctx.lineTo(x+18, railY-6); ctx.stroke();
  }
  ctx.fillStyle = '#aab0b9';
  ctx.fillRect(bx, railY+3, bW, 4);
  ctx.fillRect(bx, railY+15, bW, 4);
}
function roadBridge(r) {
  const roadY = (typeof r === 'number') ? r : r.y;
  const hw = riverHWAt(roadY+15);
  if (hw < 20) return;
  const cx = riverCX(roadY+15);
  ctx.fillStyle = '#6e4a2a';
  ctx.fillRect(cx-hw-10, roadY-3, (hw+10)*2, ROADW+6);
  ctx.strokeStyle = '#4d3017'; ctx.lineWidth = 2;
  for (let x = cx-hw-10; x < cx+hw+10; x += 9) {
    ctx.beginPath(); ctx.moveTo(x, roadY-3);
    ctx.lineTo(x, roadY+ROADW+3); ctx.stroke();
  }
  ctx.fillStyle = '#8a5e36';
  ctx.fillRect(cx-hw-12, roadY-5, (hw+12)*2, 4);
  ctx.fillRect(cx-hw-12, roadY+ROADW+1, (hw+12)*2, 4);
}
function drawBridgesOver() {   // chamado após desenhar os barcos
  gRails.forEach(railBridge);
  gRoads.forEach(roadBridge);
  // veículos das rodovias são redesenhados POR CIMA das pontes (do contrário,
  // a ponte tapava os carros nas travessias de rio)
  gRoads.forEach(r => {
    if (typeof r === 'object') drawRoadCars(r.y, r.n, r.rampFn);
  });
}

/* ===================================================================
   BAKE DE SPRITES: arte HD assada 1x em albedo + normal map.
   O normal map é derivado de um "heightmap" (mapa de relevo em cinza)
   via Sobel — assim basta pintar volumes claros/escuros e a luz por
   pixel sai sozinha no shader WebGL. Tudo gerado por código, sem assets.
   =================================================================== */
function _cv(w,h){ const c=document.createElement('canvas');
  c.width=w; c.height=h; return c; }

function heightToNormal(hcv, strength){
  const w=hcv.width, h=hcv.height;
  const hc=hcv.getContext('2d');
  const s=hc.getImageData(0,0,w,h).data;
  const out=hc.createImageData(w,h), o=out.data;
  const Hh=(x,y)=>{ x=x<0?0:x>w-1?w-1:x; y=y<0?0:y>h-1?h-1:y;
    const i=(y*w+x)*4; return s[i+3] ? s[i]/255 : 0; };
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const i=(y*w+x)*4, a=s[i+3];
    if(!a){ o[i]=128;o[i+1]=128;o[i+2]=255;o[i+3]=0; continue; }
    let nx=(Hh(x-1,y)-Hh(x+1,y))*strength;
    let ny=(Hh(x,y-1)-Hh(x,y+1))*strength;
    let nz=1, L=Math.hypot(nx,ny,nz)||1;
    o[i]  =(nx/L*.5+.5)*255;
    o[i+1]=(ny/L*.5+.5)*255;
    o[i+2]=(nz/L*.5+.5)*255;
    o[i+3]=a;
  }
  const n=_cv(w,h); n.getContext('2d').putImageData(out,0,0); return n;
}
// albedoFn/heightFn recebem um ctx já centrado (0,0 = meio do sprite)
function bakeSprite(w,h, albedoFn, heightFn){
  const a=_cv(w,h), ac=a.getContext('2d');
  const hh=_cv(w,h), hc=hh.getContext('2d');
  ac.save(); ac.translate(w/2,h/2); albedoFn(ac); ac.restore();
  hc.save(); hc.translate(w/2,h/2); heightFn(hc); hc.restore();
  return { a, n: heightToNormal(hh, 2.4), w, h };
}
// textura de normal de ÁGUA: ondas cruzadas ORGÂNICAS (vários trens de
// onda em ângulos diferentes + detalhe fino) — tileável (harmônicos
// inteiros de T) e sem aparência de "listras"
function bakeWaterNormal(T){
  const c=_cv(T,T), g=c.getContext('2d');
  const img=g.createImageData(T,T), d=img.data, P=2*Math.PI/T;
  // trens de onda: [kx, ky, amp, fase] com kx,ky inteiros (tileável)
  const W=[
    [ 3, 1, 1.00, 0.0 ],
    [ 1,-2, 0.80, 1.7 ],
    [ 2, 3, 0.55, 3.1 ],
    [-4, 1, 0.45, 0.6 ],
    [ 5, 4, 0.30, 2.2 ],
    [ 2,-6, 0.22, 4.0 ],
  ];
  for(let y=0;y<T;y++) for(let x=0;x<T;x++){
    const i=(y*T+x)*4;
    let hgt=0;
    for(const [kx,ky,amp,ph] of W)
      hgt += Math.sin(P*(kx*x+ky*y)+ph)*amp;
    // pequena modulação cruzada p/ quebrar regularidade (ainda tileável)
    hgt += Math.sin(P*(x))*Math.sin(P*(2*y))*0.25;
    const v = 128 + hgt*11;
    d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
  }
  g.putImageData(img,0,0);
  return heightToNormal(c, 1.1);
}
// textura de ÁGUA: ruído fractal (fBm) por pixel, tileável + cintilância
// esparsa — superfície turbulenta contínua (como a foto vista do alto)
function _vlat(ix,iy,P,sd){
  ix=((ix%P)+P)%P; iy=((iy%P)+P)%P;
  let h=(ix*374761393 + iy*668265263 + sd*362437)>>>0;
  h=Math.imul(h ^ (h>>>13),1274126177)>>>0;
  return (h>>>0)/4294967296;
}
function _vnoise(x,y,P,sd){
  const x0=Math.floor(x), y0=Math.floor(y);
  const fx=x-x0, fy=y-y0;
  const u=fx*fx*(3-2*fx), v=fy*fy*(3-2*fy);
  const a=_vlat(x0,y0,P,sd),     b=_vlat(x0+1,y0,P,sd);
  const c=_vlat(x0,y0+1,P,sd),   d=_vlat(x0+1,y0+1,P,sd);
  return a+(b-a)*u + (c-a)*v + (a-b-c+d)*u*v;
}
function bakeWaterSpeckle(T, sd0){
  sd0 = sd0||17;
  const c=_cv(T,T), g=c.getContext('2d');
  const img=g.createImageData(T,T), D=img.data;
  // octaves: período (células) que divide -> tileável; y mais "esticado"
  // que x => micro-ondas levemente alongadas (direção do vento)
  const OCT=[[6,0.50],[12,0.27],[24,0.15],[48,0.08]];
  for(let py=0;py<T;py++) for(let px=0;px<T;px++){
    let f=0, hi=0;
    for(let o=0;o<OCT.length;o++){
      const P=OCT[o][0], am=OCT[o][1];
      const nx=px/T*P, ny=py/T*P*1.7;          // anisotropia (1.7)
      const nv=_vnoise(nx,ny,P,sd0+o*7);
      f+=nv*am; if(o>=2) hi+=nv*am;
    }
    // f ~0..1 (soma dos amps = 1). centra em 0 -> claro/escuro
    const t=(f-0.5);
    // mistura escuro<->claro conforme o ruído (superfície contínua)
    let R,Gc,B;
    if(t>=0){ const k=Math.min(1,t*2.4);
      R=20+k*150; Gc=46+k*150; B=70+k*150; }
    else    { const k=Math.min(1,-t*2.4);
      R=20-k*14; Gc=46-k*30; B=70-k*40; }
    // cintilância esparsa: só onde as oitavas finas batem alto
    let A=0.34;
    if(hi>0.165){ const s=Math.min(1,(hi-0.165)*9);
      R+=s*120; Gc+=s*120; B+=s*120; A=0.34+s*0.30; }
    const i=(py*T+px)*4;
    D[i]=R; D[i+1]=Gc; D[i+2]=B; D[i+3]=A*255;
  }
  g.putImageData(img,0,0);
  return c;
}
// pincel de relevo: bolha radial clara (volume arredondado)
function hBlob(g,x,y,rx,ry,hi,lo){
  const grd=g.createRadialGradient(x,y,0,x,y,Math.max(rx,ry));
  grd.addColorStop(0,`rgb(${hi},${hi},${hi})`);
  grd.addColorStop(1,`rgb(${lo},${lo},${lo})`);
  g.fillStyle=grd;
  g.save(); g.translate(x,y); g.scale(rx,ry);
  g.beginPath(); g.arc(0,0,1,0,7); g.fill(); g.restore();
}

let SPR = null;
function buildSprites(){
  // ---- GUNSHIP DO PLAYER estilo Rambo II / Hind (72x88, nariz -y) ----
  const heli = bakeSprite(72,88, a=>{
    // ---- lança de cauda + estabilizadores + deriva ----
    let g=a.createLinearGradient(-4,0,4,0);
    g.addColorStop(0,'#2c4a1f'); g.addColorStop(.5,'#4f7a33');
    g.addColorStop(1,'#22381a'); a.fillStyle=g;
    a.beginPath(); a.moveTo(-5,12); a.lineTo(5,12);
    a.lineTo(2.6,36); a.lineTo(-2.6,36); a.closePath(); a.fill();
    a.fillStyle='#27461c';                       // estabilizador horiz.
    a.beginPath(); a.moveTo(-12,30); a.lineTo(12,30);
    a.lineTo(9,36); a.lineTo(-9,36); a.closePath(); a.fill();
    a.fillStyle='#1c3214';                       // deriva/tail rotor
    a.beginPath(); a.moveTo(2,30); a.lineTo(9,40);
    a.lineTo(2,40); a.closePath(); a.fill();
    // ---- asas em DELTA agressiva; canhões POR BAIXO ----
    [-1,1].forEach(s=>{
      // 1) canhão duplo PRIMEIRO (fica sob a asa; canos curtos)
      a.fillStyle='#121210';
      a.fillRect(s*20-3.6,-15,2.6,11);
      a.fillRect(s*20+1.0,-15,2.6,11);
      a.fillStyle='#2a2a24';                  // fairing do canhão
      a.beginPath(); a.ellipse(s*20,-3,4.6,6,0,0,7); a.fill();
      // 2) asa delta varrida por cima, PONTA RETA (cobre a base do canhão)
      g=a.createLinearGradient(0,-16,0,16);
      g.addColorStop(0,'#6fa049'); g.addColorStop(.5,'#487a31');
      g.addColorStop(1,'#22401a'); a.fillStyle=g;
      a.beginPath();
      a.moveTo(s*4,-18);                 // bordo de ataque na raiz (à frente)
      a.lineTo(s*38,6);                  // ponta — canto dianteiro
      a.lineTo(s*38,15);                 // ponta — borda RETA (vertical)
      a.lineTo(s*6,10);                  // bordo de fuga curto na raiz
      a.closePath(); a.fill();
      a.fillStyle='rgba(195,228,150,.18)';   // bisel do bordo de ataque
      a.beginPath();
      a.moveTo(s*4,-18); a.lineTo(s*38,6); a.lineTo(s*34,7);
      a.lineTo(s*6,-10); a.closePath(); a.fill();
      a.fillStyle='rgba(20,40,15,.30)';      // sombra do bordo de fuga
      a.beginPath();
      a.moveTo(s*38,15); a.lineTo(s*6,10); a.lineTo(s*10,12); a.closePath(); a.fill();
    });
    // ---- fuselagem gunship esguia (nariz -y) ----
    g=a.createLinearGradient(-11,-30,12,20);
    g.addColorStop(0,'#86b85e'); g.addColorStop(.45,'#4a7c32');
    g.addColorStop(1,'#23401a'); a.fillStyle=g;
    a.beginPath();
    a.moveTo(0,-42); a.lineTo(5,-34); a.lineTo(8,-16);
    a.lineTo(9,6); a.lineTo(5,18); a.lineTo(3,28);
    a.lineTo(-3,28); a.lineTo(-5,18); a.lineTo(-9,6);
    a.lineTo(-8,-16); a.lineTo(-5,-34); a.closePath(); a.fill();
    // quilha/sombra inferior
    a.fillStyle='rgba(20,40,15,.45)';
    a.beginPath(); a.moveTo(-9,4); a.lineTo(9,4);
    a.lineTo(4,26); a.lineTo(-4,26); a.closePath(); a.fill();
    // lombada clara
    a.fillStyle='rgba(190,225,150,.20)';
    a.fillRect(-2,-32,4,52);
    // naceles de motor (escapes) atrás do rotor
    a.fillStyle='#33301f';
    a.fillRect(-9,6,5,8); a.fillRect(4,6,5,8);
    // ---- canopies em TANDEM (vidro verde/dourado, escalonado) ----
    const cano=(cy,rx,ry)=>{
      const gg=a.createLinearGradient(0,cy-ry,0,cy+ry);
      gg.addColorStop(0,'#eafff0'); gg.addColorStop(.5,'#7fae74');
      gg.addColorStop(1,'#244a2a'); a.fillStyle=gg;
      a.beginPath(); a.ellipse(0,cy,rx,ry,0,0,7); a.fill();
      a.fillStyle='rgba(255,255,255,.55)';
      a.beginPath(); a.ellipse(-rx*0.35,cy-ry*0.4,rx*0.3,ry*0.35,0,0,7);
      a.fill();
    };
    a.fillStyle='#1f3a16'; a.fillRect(-6,-30,12,26);  // moldura
    cano(-25,4,5.5);                                   // artilheiro (frente)
    cano(-13,5,6.5);                                   // piloto (atrás, alto)
    // ---- canhão de queixo (torre + canos) ----
    a.fillStyle='#1b1b1b';
    a.beginPath(); a.arc(0,-34,4.5,0,7); a.fill();
    a.fillStyle='#0d0d0d';
    a.fillRect(-2.4,-44,1.8,10); a.fillRect(0.6,-44,1.8,10);
    // skids
    a.strokeStyle='#1c1c1c'; a.lineWidth=2.4; a.lineCap='round';
    a.beginPath(); a.moveTo(-16,-6); a.lineTo(-16,16);
    a.moveTo(16,-6); a.lineTo(16,16); a.stroke();
    a.lineWidth=1.6;
    a.beginPath(); a.moveTo(-16,4); a.lineTo(-7,2);
    a.moveTo(16,4); a.lineTo(7,2); a.stroke();
  }, h=>{
    h.fillStyle='#343434';                       // boom baixo
    h.beginPath(); h.moveTo(-5,12); h.lineTo(5,12);
    h.lineTo(2.6,38); h.lineTo(-2.6,38); h.closePath(); h.fill();
    // canhões (baixos, sob a asa) primeiro
    hBlob(h,-20,-3,5,7,170,40); hBlob(h,20,-3,5,7,170,40);
    h.fillStyle='#5e5e5e';                        // asas delta (ponta reta)
    [-1,1].forEach(s=>{ h.beginPath();
      h.moveTo(s*4,-18); h.lineTo(s*38,6); h.lineTo(s*38,15);
      h.lineTo(s*6,10); h.closePath(); h.fill(); });
    hBlob(h,0,-8,9,30,235,60);                   // espinha da fuselagem
    hBlob(h,0,-13,6,8,255,140);                  // domo do piloto
    hBlob(h,0,-25,4.5,6,250,150);                // domo do artilheiro
    hBlob(h,0,-34,5,5,235,150);                  // torre do canhão
    h.fillStyle='#343434';
    h.fillRect(-17,-6,3,22); h.fillRect(14,-6,3,22); // skids
  });

  // ---- CASCO + ESTEIRAS DO TANQUE (44x44) ----
  const tank = bakeSprite(44,44, a=>{
    // esteiras
    [-1,1].forEach(s=>{
      let g=a.createLinearGradient(s*17-4,0,s*17+4,0);
      g.addColorStop(0,'#1c1c1c'); g.addColorStop(.5,'#3a3a3a');
      g.addColorStop(1,'#141414'); a.fillStyle=g;
      a.fillRect(s*17-4,-16,8,32);
      a.fillStyle='#0d0d0d';
      for(let i=-16;i<16;i+=5) a.fillRect(s*17-4,i,8,2.4);
    });
    // casco com chanfro iluminado
    let g=a.createLinearGradient(-13,-13,13,13);
    g.addColorStop(0,'#b7a063'); g.addColorStop(.5,'#7d6b3f');
    g.addColorStop(1,'#4f4324'); a.fillStyle=g;
    a.fillRect(-12,-15,24,30);
    a.fillStyle='rgba(255,245,200,.30)'; a.fillRect(-12,-15,24,4);
    a.fillStyle='rgba(0,0,0,.35)'; a.fillRect(-12,11,24,4);
    // grade do motor + reflexos
    a.strokeStyle='rgba(0,0,0,.4)'; a.lineWidth=1;
    for(let i=-8;i<10;i+=3){ a.beginPath();
      a.moveTo(-9,i); a.lineTo(9,i); a.stroke(); }
  }, h=>{
    h.fillStyle='#2a2a2a';
    h.fillRect(-21,-16,8,32); h.fillRect(13,-16,8,32);   // esteiras baixas
    hBlob(h,0,0,13,16,225,110);                          // casco abaulado
  });

  // ---- TORRE + CANHÃO (gira mirando o player) (52x18, pivô no centro-esq) ----
  const turret = bakeSprite(52,24, a=>{
    let g=a.createLinearGradient(0,-3,0,3);
    g.addColorStop(0,'#5a4d2c'); g.addColorStop(1,'#2e2614');
    a.fillStyle=g; a.fillRect(2,-3.5,26,7);              // cano
    g=a.createRadialGradient(-2,-2,1,0,0,10);
    g.addColorStop(0,'#7a6a3e'); g.addColorStop(1,'#3c3320');
    a.fillStyle=g; a.beginPath(); a.arc(0,0,9,0,7); a.fill();
    a.fillStyle='#2a2416'; a.beginPath(); a.arc(0,0,4,0,7); a.fill();
  }, h=>{
    h.fillStyle='#888'; h.fillRect(2,-3.5,26,7);
    hBlob(h,0,0,9,9,240,120);
  });

  // ---- ÁRVORE (copa volumétrica) ref s=24 -> canvas 96x96 ----
  const tree = bakeSprite(96,96, a=>{
    const S=24, lob=[[-.5,.1,.7],[.5,.05,.7],[0,-.5,.8],[0,.35,.85]];
    a.fillStyle='#16441f';
    lob.forEach(([dx,dy,r])=>{ a.beginPath();
      a.arc(dx*S,dy*S,r*S,0,7); a.fill(); });
    lob.forEach(([dx,dy,r])=>{
      const g=a.createRadialGradient(dx*S-r*S*.4,dy*S-r*S*.5,1,
        dx*S,dy*S,r*S);
      g.addColorStop(0,'#5fae54'); g.addColorStop(.6,'#2f7a38');
      g.addColorStop(1,'rgba(20,60,25,0)');
      a.fillStyle=g; a.beginPath(); a.arc(dx*S,dy*S,r*S,0,7); a.fill();
    });
  }, h=>{
    const S=24, lob=[[-.5,.1,.7],[.5,.05,.7],[0,-.5,.8],[0,.35,.85]];
    lob.forEach(([dx,dy,r])=>hBlob(h,dx*S,dy*S,r*S,r*S,235,40));
  });

  // ---- CACTO SAGUARO (deserto) ref S=24 -> 96x96 ----
  // tronco vertical + 2 braços (esquerdo embaixo, direito em cima)
  const cact = bakeSprite(96,96, a=>{
    const S=24;
    // base verde escura (silhueta)
    a.fillStyle = '#2a5a2d';
    const blobs = [
      [ 0,  .1, .22,  .9],     // tronco (alto)
      [-.55,-.0, .32, .10],    // braço esq horizontal
      [-.70,-.40,.10, .35],    // braço esq subindo
      [ .55,-.20,.32, .10],    // braço dir horizontal
      [ .70,-.55,.10, .32],    // braço dir subindo
    ];
    blobs.forEach(([dx,dy,rx,ry])=>{
      a.beginPath(); a.ellipse(dx*S,dy*S,rx*S,ry*S,0,0,7); a.fill();
    });
    // gradiente de luz por blob (volume)
    blobs.forEach(([dx,dy,rx,ry])=>{
      const cx=dx*S, cy=dy*S, R=Math.max(rx,ry)*S;
      const g=a.createRadialGradient(cx-R*0.4,cy-R*0.5,1,cx,cy,R);
      g.addColorStop(0,'#7cc26a'); g.addColorStop(.55,'#3f8a3a');
      g.addColorStop(1,'rgba(20,55,25,0)');
      a.fillStyle=g; a.beginPath();
      a.ellipse(cx,cy,rx*S,ry*S,0,0,7); a.fill();
    });
    // costelas verticais (linhas escuras finas no tronco e braços)
    a.strokeStyle = 'rgba(15,40,18,.55)'; a.lineWidth = 1.2;
    [-.06,0,.06].forEach(ox=>{ a.beginPath();
      a.moveTo(ox*S, -.7*S); a.lineTo(ox*S, .95*S); a.stroke(); });
    // espinhos (pontinhos claros)
    a.fillStyle='rgba(240,235,180,.65)';
    for(let i=0;i<14;i++){
      const yy=(-.7+i*0.12)*S;
      a.beginPath(); a.arc(-.13*S,yy,.6,0,7); a.fill();
      a.beginPath(); a.arc( .13*S,yy,.6,0,7); a.fill();
    }
    // florezinhas vermelhas nas pontas
    a.fillStyle='#d44'; const flw=(x,y)=>{ a.beginPath();
      a.arc(x,y,2.2,0,7); a.fill(); };
    flw(0,-.78*S); flw(-.70*S,-.74*S); flw(.70*S,-.86*S);
  }, h=>{
    const S=24, blobs=[
      [ 0,  .1, .22,  .9],
      [-.55,-.0, .32, .10], [-.70,-.40,.10, .35],
      [ .55,-.20,.32, .10], [ .70,-.55,.10, .32],
    ];
    blobs.forEach(([dx,dy,rx,ry])=>
      hBlob(h,dx*S,dy*S,rx*S,ry*S,240,55));
  });

  // ---- ROCHA (deserto/gelo) ref S=24 -> 96x96 ----
  const rock = bakeSprite(96,96, a=>{
    const S=24;
    // bloco principal + pedrinha lateral (silhueta)
    a.fillStyle='#6f6a5e';
    a.beginPath(); a.ellipse(0,0, .95*S,.62*S, 0,0,7); a.fill();
    a.beginPath(); a.ellipse(.65*S,.30*S, .35*S,.22*S, 0,0,7); a.fill();
    // facetas claras (planos voltados pra luz: cima/esq)
    const facet=(cx,cy,rx,ry,c1,c2)=>{
      const g=a.createRadialGradient(cx-rx*.5,cy-ry*.6,1,cx,cy,Math.max(rx,ry));
      g.addColorStop(0,c1); g.addColorStop(1,c2);
      a.fillStyle=g; a.beginPath();
      a.ellipse(cx,cy,rx,ry,0,0,7); a.fill();
    };
    facet(0,0, .95*S,.62*S, '#b6ad9b','rgba(70,65,55,0)');
    facet(-.25*S,-.18*S, .55*S,.32*S, '#d8d0bd','rgba(150,140,120,0)');
    facet(.65*S,.30*S, .35*S,.22*S, '#a59f8e','rgba(70,65,55,0)');
    // rachaduras
    a.strokeStyle='rgba(35,30,22,.55)'; a.lineWidth=1.2;
    a.beginPath(); a.moveTo(-.4*S,-.05*S);
    a.lineTo(-.05*S,.10*S); a.lineTo(.30*S,-.02*S); a.stroke();
    a.beginPath(); a.moveTo(.05*S,.35*S); a.lineTo(.25*S,.20*S); a.stroke();
  }, h=>{
    const S=24;
    hBlob(h,0,0, .95*S,.62*S, 245,50);
    hBlob(h,-.18*S,-.12*S, .55*S,.38*S, 255,80);
    hBlob(h,.65*S,.30*S, .35*S,.22*S, 220,40);
  });

  // ---- PINHEIRO NEVADO (gelo) ref S=24 -> 96x96 ----
  // 5 camadas com galhos visíveis, neve com sombra e gelinhos pendurados
  const pine = bakeSprite(96,96, a=>{
    const S=24;
    // sombra azulada projetada à direita (no albedo, fica integrada à arte)
    a.fillStyle='rgba(80,120,160,.18)';
    a.beginPath(); a.ellipse(.45*S,.80*S, S*0.85, S*0.18, 0,0,7); a.fill();
    // tronco com casca
    const tg=a.createLinearGradient(-.10*S,0, .10*S,0);
    tg.addColorStop(0,'#3a2615'); tg.addColorStop(.5,'#6b4626');
    tg.addColorStop(1,'#3a2615');
    a.fillStyle=tg;
    a.fillRect(-.11*S, .55*S, .22*S, .40*S);
    a.strokeStyle='rgba(40,25,15,.7)'; a.lineWidth=.8;
    [-.05,.02,.06].forEach(ox=>{ a.beginPath();
      a.moveTo(ox*S,.58*S); a.lineTo(ox*S,.92*S); a.stroke(); });
    // 5 camadas (de baixo p/ cima): [cy, w (meia largura)]
    const layers=[
      [ .58, 1.00],
      [ .30,  .86],
      [ .05,  .72],
      [-.22,  .58],
      [-.50,  .44],
      [-.78,  .26],   // ponta
    ];
    // contorno verde MUITO escuro (silhueta de galhos)
    a.fillStyle='#102f1a';
    layers.forEach(([cy,w])=>{
      a.beginPath();
      a.moveTo(0, cy*S - w*S*0.85);
      // bordas serrilhadas (galhos) — zig-zag pequeno
      const N=6;
      for (let i=N;i>=0;i--){
        const t=i/N, jag=(i%2===0)?1:.82;
        a.lineTo(-w*S*t*jag, cy*S - w*S*0.85*(1-t));
      }
      a.lineTo(-w*S, cy*S);
      a.lineTo( w*S, cy*S);
      for (let i=0;i<=N;i++){
        const t=i/N, jag=(i%2===0)?1:.82;
        a.lineTo(w*S*t*jag, cy*S - w*S*0.85*(1-t));
      }
      a.closePath(); a.fill();
    });
    // verde médio (corpo)
    a.fillStyle='#2b6638';
    layers.forEach(([cy,w])=>{
      a.beginPath();
      a.moveTo(0, cy*S - w*S*0.78);
      a.lineTo( w*S*0.9, cy*S - 1);
      a.lineTo(-w*S*0.9, cy*S - 1);
      a.closePath(); a.fill();
    });
    // luz por camada (volume, NW)
    layers.forEach(([cy,w])=>{
      const g=a.createRadialGradient(-w*S*0.35,cy*S-w*S*0.55,1,
        0, cy*S-w*S*0.15, w*S);
      g.addColorStop(0,'#7ac46b'); g.addColorStop(.55,'#3e8c44');
      g.addColorStop(1,'rgba(20,55,25,0)');
      a.fillStyle=g;
      a.beginPath();
      a.moveTo(0, cy*S - w*S*0.78);
      a.lineTo( w*S*0.9, cy*S - 1);
      a.lineTo(-w*S*0.9, cy*S - 1);
      a.closePath(); a.fill();
    });
    // sombra azulada SOB cada camada (gelo embaixo dos galhos)
    a.fillStyle='rgba(60,90,140,.35)';
    layers.forEach(([cy,w])=>{
      a.beginPath();
      a.ellipse(0, cy*S - 0.5, w*S*0.88, 2.2, 0, 0, 7);
      a.fill();
    });
    // NEVE em cima dos galhos (com sombra inferior pra dar volume)
    layers.forEach(([cy,w])=>{
      // sombra cinza-azulada por baixo
      a.fillStyle='rgba(180,200,220,.85)';
      a.beginPath();
      a.moveTo(0, cy*S - w*S*0.78);
      a.lineTo( w*S*0.62, cy*S - w*S*0.22);
      a.lineTo( w*S*0.34, cy*S - w*S*0.06);
      a.lineTo(-w*S*0.34, cy*S - w*S*0.06);
      a.lineTo(-w*S*0.62, cy*S - w*S*0.22);
      a.closePath(); a.fill();
      // tampo branco (camada de cima, deslocada pra "cima")
      a.fillStyle='#ffffff';
      a.beginPath();
      a.moveTo(0, cy*S - w*S*0.78);
      a.lineTo( w*S*0.55, cy*S - w*S*0.22);
      a.lineTo( w*S*0.28, cy*S - w*S*0.10);
      a.lineTo(-w*S*0.28, cy*S - w*S*0.10);
      a.lineTo(-w*S*0.55, cy*S - w*S*0.22);
      a.closePath(); a.fill();
    });
    // gelinhos pendurados (icicles) nas pontas das camadas inferiores
    a.fillStyle='rgba(200,230,245,.9)';
    a.strokeStyle='rgba(140,180,210,.6)'; a.lineWidth=.7;
    [[ .80, .62],[-.80, .62],[ .65, .35],[-.65, .35]].forEach(([dx,dy])=>{
      a.beginPath();
      a.moveTo(dx*S-1, dy*S);
      a.lineTo(dx*S+1, dy*S);
      a.lineTo(dx*S,   dy*S+3.5);
      a.closePath(); a.fill(); a.stroke();
    });
    // brilho central (estrelinhas/sparkles na neve)
    a.fillStyle='rgba(255,255,255,.95)';
    [[-.18,-.55],[.22,-.10],[-.12,.20]].forEach(([dx,dy])=>{
      a.beginPath(); a.arc(dx*S,dy*S, 1.1, 0, 7); a.fill();
    });
  }, h=>{
    const S=24, layers=[[.58,1.00],[.30,.86],[.05,.72],[-.22,.58],
                        [-.50,.44],[-.78,.26]];
    layers.forEach(([cy,w])=>
      hBlob(h, 0, cy*S - w*S*0.28, w*S*0.95, w*S*0.50, 245, 30));
    hBlob(h, 0, .74*S, .13*S, .20*S, 190, 50);
  });

  // ---- PRÉDIO (cidade, vista de cima) ref S=24 -> 96x96 ----
  const bldg = bakeSprite(96,96, a=>{
    const S=24;
    // teto (gradiente diagonal — face NW mais clara)
    const g=a.createLinearGradient(-S,-S, S,S);
    g.addColorStop(0,'#a8aab0'); g.addColorStop(.5,'#7a7c82');
    g.addColorStop(1,'#5d5f65');
    a.fillStyle=g; a.fillRect(-S,-S, 2*S, 2*S);
    // borda escura (parapeito)
    a.strokeStyle='#2b2d32'; a.lineWidth=3;
    a.strokeRect(-S+1.5,-S+1.5, 2*S-3, 2*S-3);
    // marcação interna do parapeito (linha clara)
    a.strokeStyle='rgba(255,255,255,.18)'; a.lineWidth=1;
    a.strokeRect(-S+4,-S+4, 2*S-8, 2*S-8);
    // claraboias
    a.fillStyle='#cfe6f5';
    [[-.55,-.55],[-.55,.55],[.55,-.55],[.55,.55]].forEach(([dx,dy])=>{
      a.fillRect(dx*S-3.5, dy*S-3.5, 7, 7);
    });
    a.strokeStyle='rgba(0,0,0,.5)'; a.lineWidth=.8;
    [[-.55,-.55],[-.55,.55],[.55,-.55],[.55,.55]].forEach(([dx,dy])=>{
      a.strokeRect(dx*S-3.5, dy*S-3.5, 7, 7);
    });
    // condensadores/ar-condicionado central
    a.fillStyle='#3f4147';
    a.fillRect(-.20*S,-.20*S, .40*S, .40*S);
    a.fillStyle='#5b5e64';
    a.fillRect(-.18*S,-.18*S, .36*S, .12*S);
    a.fillRect(-.18*S, .05*S, .36*S, .12*S);
    // caixa d'água / vent stack
    a.fillStyle='#6a6d74';
    a.fillRect(.25*S,-.55*S, .25*S, .25*S);
    a.fillStyle='#404249';
    a.strokeStyle='rgba(0,0,0,.4)'; a.lineWidth=.8;
    a.strokeRect(.25*S,-.55*S, .25*S, .25*S);
    // sombra do parapeito (leste/sul)
    a.fillStyle='rgba(0,0,0,.28)';
    a.fillRect(S-5,-S+3, 4, 2*S-6);
    a.fillRect(-S+3, S-5, 2*S-6, 4);
  }, h=>{
    const S=24;
    // base do prédio: cubo alto
    hBlob(h, 0, 0, S*0.95, S*0.95, 230, 200);
    // parapeito: aro um pouco mais alto
    h.fillStyle='#fff';
    h.lineWidth=4; h.strokeStyle='#fff';
    h.strokeRect(-S+3,-S+3, 2*S-6, 2*S-6);
    // equipamento central + caixa d'água
    hBlob(h, 0, 0, .22*S, .22*S, 255, 200);
    hBlob(h, .37*S, -.43*S, .14*S, .14*S, 255, 200);
  });

  // ---- TREM DE GUERRA: vagão blindado (52x40, corpo ~46x30) ----
  const trainCar = bakeSprite(52,40, a=>{
    let g=a.createLinearGradient(0,-15,0,15);
    g.addColorStop(0,'#5a626e'); g.addColorStop(.45,'#39404a');
    g.addColorStop(1,'#1f242b'); a.fillStyle=g;
    a.fillRect(-23,-13,46,26);                       // casamata blindada
    a.fillStyle='rgba(255,255,255,.16)'; a.fillRect(-23,-13,46,3);
    a.fillStyle='rgba(0,0,0,.40)'; a.fillRect(-23,10,46,3);
    a.fillStyle='#2b313a';                           // chanfros laterais
    a.beginPath(); a.moveTo(-23,-13); a.lineTo(-20,-13);
    a.lineTo(-23,-7); a.closePath(); a.fill();
    a.beginPath(); a.moveTo(23,-13); a.lineTo(20,-13);
    a.lineTo(23,-7); a.closePath(); a.fill();
    a.fillStyle='#11151a';                           // seteira blindada
    a.fillRect(-15,-3,30,5);
    a.fillStyle='rgba(120,150,180,.25)'; a.fillRect(-15,-3,30,1);
    a.fillStyle='#0c0e12';                           // rebites
    for(let rx=-19;rx<=19;rx+=6){ a.beginPath();
      a.arc(rx,-10,1.3,0,7); a.fill();
      a.beginPath(); a.arc(rx,9,1.3,0,7); a.fill(); }
    a.fillStyle='#0a0b0e';                           // bogies/rodas
    a.fillRect(-22,12,44,5);
    [-14,-4,4,14].forEach(wx=>{ a.beginPath();
      a.arc(wx,16,4,0,7); a.fillStyle='#15171c'; a.fill();
      a.fillStyle='#3a3f47'; a.beginPath();
      a.arc(wx,16,1.6,0,7); a.fill(); });
  }, h=>{
    h.fillStyle='#3a3a3a'; h.fillRect(-23,12,46,6);  // rodas baixas
    hBlob(h,0,-1,24,15,225,90);                      // casamata abaulada
    h.fillStyle='rgba(255,255,255,.0)';
  });

  // ---- LOCOMOTIVA BLINDADA (60x44, nariz em cunha à direita) ----
  const trainLoco = bakeSprite(60,44, a=>{
    let g=a.createLinearGradient(0,-16,0,16);
    g.addColorStop(0,'#6b5350'); g.addColorStop(.45,'#47312f');
    g.addColorStop(1,'#241413'); a.fillStyle=g;
    a.beginPath();                                   // casco + cunha frontal
    a.moveTo(-27,-14); a.lineTo(18,-14); a.lineTo(28,0);
    a.lineTo(18,14); a.lineTo(-27,14); a.closePath(); a.fill();
    a.fillStyle='rgba(255,255,255,.16)';
    a.fillRect(-27,-14,45,3);
    a.fillStyle='rgba(0,0,0,.42)'; a.fillRect(-27,11,46,3);
    a.fillStyle='#7a3a34';                            // cabine elevada
    a.fillRect(-24,-12,16,24);
    a.fillStyle='#11151a';
    a.fillRect(-21,-5,9,7);                           // visor blindado
    a.fillStyle='#0c0e12';                            // rebites do nariz
    for(let ry=-10;ry<=10;ry+=5){ a.beginPath();
      a.arc(15,ry,1.4,0,7); a.fill(); }
    a.fillStyle='#161616';                            // chaminé curta
    a.fillRect(2,-20,8,8);
    a.fillStyle='#0a0b0e'; a.fillRect(-26,13,52,5);   // bogies
    [-18,-6,8,18].forEach(wx=>{ a.beginPath();
      a.arc(wx,17,4.5,0,7); a.fillStyle='#15171c'; a.fill();
      a.fillStyle='#4a3f3a'; a.beginPath();
      a.arc(wx,17,1.8,0,7); a.fill(); });
  }, h=>{
    h.fillStyle='#3a3a3a'; h.fillRect(-26,13,52,6);
    hBlob(h,-4,-1,27,16,220,80);                      // corpo
    hBlob(h,-16,0,9,13,245,150);                      // cabine mais alta
  });

  // ---- CANHÃO DE TOPO DO TREM (74x30, pivô no centro-esq) ----
  const trainGun = bakeSprite(74,34, a=>{
    let g=a.createLinearGradient(0,-5,0,5);
    g.addColorStop(0,'#454d3a'); g.addColorStop(1,'#181c12');
    a.fillStyle=g; a.fillRect(8,-5,34,10);            // cano grosso
    a.fillStyle='#0e1009'; a.fillRect(38,-6,7,12);    // freio de boca
    a.fillRect(31,-6,3,12);
    g=a.createRadialGradient(-3,-3,1,0,0,15);
    g.addColorStop(0,'#7c8460'); g.addColorStop(.6,'#4a5238');
    g.addColorStop(1,'#252a1b'); a.fillStyle=g;
    a.beginPath(); a.arc(0,0,14,0,7); a.fill();       // torre blindada
    a.fillStyle='#2f3422';
    a.fillRect(-13,-13,12,26);                        // contrapeso traseiro
    a.fillStyle='rgba(255,255,255,.15)';
    a.beginPath(); a.arc(-3,-4,6,0,7); a.fill();      // brilho da cúpula
    a.fillStyle='#11140c'; a.beginPath();
    a.arc(0,0,4,0,7); a.fill();                       // escotilha
  }, h=>{
    h.fillStyle='#8a8a8a'; h.fillRect(8,-5,37,10);
    h.fillStyle='#5a5a5a'; h.fillRect(-13,-13,12,26);
    hBlob(h,0,0,14,14,250,110);                       // cúpula
  });

  // ---- CAÇA STEALTH estilo F-22 (44x44, nariz em +y/baixo) ----
  const jet = bakeSprite(44,44, a=>{
    const mir=(pts,fn)=>{ fn(pts); fn(pts.map(([x,y])=>[-x,y])); };
    const poly=p=>{ a.beginPath(); a.moveTo(p[0][0],p[0][1]);
      for(let i=1;i<p.length;i++) a.lineTo(p[i][0],p[i][1]);
      a.closePath(); a.fill(); };
    // estabilizadores traseiros (mais escuros, por baixo)
    a.fillStyle='#444b56';
    mir([[5,-13],[14,-19],[16,-17],[6,-11]],poly);
    // ASAS trapezoidais grandes e varridas
    let g=a.createLinearGradient(0,6,0,-14);
    g.addColorStop(0,'#828c99'); g.addColorStop(1,'#4e555f');
    a.fillStyle=g;
    mir([[5,5],[21,-8],[20,-12],[6,-13]],poly);
    // FUSELAGEM com chines (losango stealth), nariz +y
    g=a.createLinearGradient(-7,0,7,0);
    g.addColorStop(0,'#5c636d'); g.addColorStop(.5,'#9aa3af');
    g.addColorStop(1,'#5c636d'); a.fillStyle=g;
    poly([[0,19],[4,12],[6.5,3],[6.5,-12],[4,-18],
          [-4,-18],[-6.5,-12],[-6.5,3],[-4,12]]);
    // facetas stealth escuras (quebram a forma)
    a.fillStyle='rgba(40,45,52,.55)';
    mir([[6.5,3],[6.5,-12],[3,-12],[3,2]],poly);     // flanco
    a.fillStyle='rgba(255,255,255,.10)';
    poly([[0,18],[2.4,11],[2.4,-10],[-2.4,-10],[-2.4,11]]); // spine claro
    // caudas verticais CANTADAS em V (claras, no topo)
    a.fillStyle='#aeb6c0';
    mir([[3,-3],[9,-15],[11,-13],[5,-2]],poly);
    // tomadas de ar
    a.fillStyle='#2b2f37';
    a.fillRect(-6,-2,2.4,9); a.fillRect(3.6,-2,2.4,9);
    // bicos dos motores (traseira, serrilhados)
    a.fillStyle='#1b1e24';
    a.fillRect(-4.6,-19,3.4,4); a.fillRect(1.2,-19,3.4,4);
    a.fillStyle='#3a2a18';
    a.fillRect(-4.6,-15.5,3.4,1.5); a.fillRect(1.2,-15.5,3.4,1.5);
    // canopy dourado (assinatura do F-22)
    g=a.createLinearGradient(0,13,0,3);
    g.addColorStop(0,'#ffe9a8'); g.addColorStop(.5,'#caa24a');
    g.addColorStop(1,'#6e521f'); a.fillStyle=g;
    a.beginPath(); a.ellipse(0,8.5,2.8,5,0,0,7); a.fill();
    a.fillStyle='rgba(255,255,255,.55)';
    a.beginPath(); a.ellipse(-.8,10,1,1.8,0,0,7); a.fill();
  }, h=>{
    const poly=p=>{ h.beginPath(); h.moveTo(p[0][0],p[0][1]);
      for(let i=1;i<p.length;i++) h.lineTo(p[i][0],p[i][1]);
      h.closePath(); h.fill(); };
    h.fillStyle='#4a4a4a';                            // asas finas/baixas
    poly([[5,5],[21,-8],[20,-12],[6,-13]]);
    poly([[-5,5],[-21,-8],[-20,-12],[-6,-13]]);
    h.fillStyle='#6e6e6e';                            // estabilizadores
    poly([[5,-13],[14,-19],[16,-17],[6,-11]]);
    poly([[-5,-13],[-14,-19],[-16,-17],[-6,-11]]);
    hBlob(h,0,-2,6.5,17,235,70);                      // espinha da fuselagem
    hBlob(h,7,-9,3,7,150,40); hBlob(h,-7,-9,3,7,150,40); // caudas V
    hBlob(h,0,8.5,3,5,255,150);                        // bolha do canopy
  });

  // ---- BUNKER/FORTIM de concreto (48x48, corpo ~40) ----
  const bunker = bakeSprite(48,48, a=>{
    // anel de concreto chanfrado
    let g=a.createLinearGradient(0,-20,0,20);
    g.addColorStop(0,'#a59a85'); g.addColorStop(.5,'#7d7461');
    g.addColorStop(1,'#4f4838'); a.fillStyle=g;
    a.fillRect(-20,-20,40,40);
    a.fillStyle='rgba(255,250,235,.22)'; a.fillRect(-20,-20,40,3);
    a.fillStyle='rgba(0,0,0,.40)'; a.fillRect(-20,16,40,4);
    a.fillStyle='rgba(0,0,0,.18)';                   // chanfros cantos
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx,sy])=>{
      a.beginPath(); a.moveTo(sx*20,sy*20);
      a.lineTo(sx*20,sy*12); a.lineTo(sx*12,sy*20);
      a.closePath(); a.fill(); });
    // plataforma recuada
    g=a.createLinearGradient(0,-13,0,13);
    g.addColorStop(0,'#6f6857'); g.addColorStop(1,'#4a4435');
    a.fillStyle=g; a.fillRect(-13,-13,26,26);
    // seteiras nas 4 faces
    a.fillStyle='#101012';
    a.fillRect(-7,-19,14,3); a.fillRect(-7,16,14,3);
    a.fillRect(-19,-7,3,14); a.fillRect(16,-7,3,14);
    // sacos de areia nos cantos (clusters)
    a.fillStyle='#a8975f';
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx,sy])=>{
      for(let i=0;i<3;i++){ a.beginPath();
        a.arc(sx*(15-i*4), sy*15, 4.2,0,7);
        a.fillStyle=i%2?'#b6a468':'#94834f'; a.fill(); }
    });
    // manchas/umidade no concreto
    a.fillStyle='rgba(60,55,42,.30)';
    a.fillRect(-13,-2,26,3); a.fillRect(-2,-13,3,26);
    // base da cúpula central
    g=a.createRadialGradient(-3,-3,1,0,0,12);
    g.addColorStop(0,'#5a564d'); g.addColorStop(1,'#2c2a24');
    a.fillStyle=g; a.beginPath(); a.arc(0,0,11,0,7); a.fill();
  }, h=>{
    hBlob(h,0,0,21,21,210,150);                      // bloco maciço (alto)
    h.fillStyle='#c9c9c9'; h.fillRect(-13,-13,26,26); // plataforma plana alta
    const sb=(x,y)=>hBlob(h,x,y,5,5,240,150);
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx,sy])=>{
      for(let i=0;i<3;i++) sb(sx*(15-i*4), sy*15); });
    hBlob(h,0,0,11,11,235,140);                      // cúpula
  });

  // ---- CANHÃO ANTIAÉREO do bunker (44x22, pivô centro-esq) ----
  const bunkerGun = bakeSprite(44,22, a=>{
    let g=a.createLinearGradient(0,-3.5,0,3.5);
    g.addColorStop(0,'#3a382f'); g.addColorStop(1,'#161510');
    a.fillStyle=g; a.fillRect(4,-3.5,22,7);           // cano
    a.fillStyle='#0c0b08'; a.fillRect(24,-4.5,4,9);   // freio de boca
    g=a.createRadialGradient(-2,-2,1,0,0,11);
    g.addColorStop(0,'#5e5a4c'); g.addColorStop(.6,'#3c3a30');
    g.addColorStop(1,'#1c1b16'); a.fillStyle=g;
    a.beginPath(); a.arc(0,0,10,0,7); a.fill();       // cúpula blindada
    a.fillStyle='#2a281f';
    a.fillRect(-11,-9,9,18);                          // contrapeso
    a.fillStyle='rgba(255,255,255,.14)';
    a.beginPath(); a.arc(-2,-3,4,0,7); a.fill();
    a.fillStyle='#100f0b'; a.beginPath();
    a.arc(0,0,3.4,0,7); a.fill();                     // escotilha
  }, h=>{
    h.fillStyle='#8a8a8a'; h.fillRect(4,-3.5,24,7);
    h.fillStyle='#4a4a4a'; h.fillRect(-11,-9,9,18);
    hBlob(h,0,0,10,10,245,120);                       // cúpula
  });

  // ---- TORRE NAVAL reutilizável (40x18, pivô centro-esq) ----
  const navGun = bakeSprite(40,18, a=>{
    let g=a.createLinearGradient(0,-3,0,3);
    g.addColorStop(0,'#586470'); g.addColorStop(1,'#222a32');
    a.fillStyle=g; a.fillRect(3,-3,19,6);             // cano
    a.fillStyle='#12161b'; a.fillRect(20,-3.5,3,7);   // boca
    g=a.createRadialGradient(-2,-2,1,0,0,9);
    g.addColorStop(0,'#6e7a86'); g.addColorStop(.6,'#414b56');
    g.addColorStop(1,'#1c2228'); a.fillStyle=g;
    a.beginPath(); a.arc(0,0,8.5,0,7); a.fill();      // torre
    a.fillStyle='#11161b'; a.beginPath();
    a.arc(0,0,3,0,7); a.fill();
  }, h=>{
    h.fillStyle='#8a8a8a'; h.fillRect(3,-3,20,6);
    hBlob(h,0,0,8.5,8.5,245,120);
  });

  // util p/ casco naval: silhueta com proa em +y
  const navHull = (a,W2,H2,c0,c1,c2)=>{
    const g=a.createLinearGradient(-W2,0,W2,0);
    g.addColorStop(0,c2); g.addColorStop(.5,c1); g.addColorStop(1,c2);
    a.fillStyle=g;
    a.beginPath();
    a.moveTo(0,H2); a.lineTo(W2*0.82,H2*0.34);
    a.lineTo(W2*0.82,-H2+5);
    a.quadraticCurveTo(0,-H2-3,-W2*0.82,-H2+5);
    a.lineTo(-W2*0.82,H2*0.34); a.closePath(); a.fill();
    a.fillStyle='rgba(255,255,255,.10)';
    a.beginPath(); a.moveTo(0,H2); a.lineTo(W2*0.5,H2*0.4);
    a.lineTo(-W2*0.5,H2*0.4); a.closePath(); a.fill();
    a.fillStyle=c0;                                   // convés
    a.fillRect(-W2*0.62,-H2*0.5,W2*1.24,H2*1.25);
  };

  // ---- MONITOR FLUVIAL BLINDADO (60x76; ref 46x60, proa +y) ----
  const shipHull = bakeSprite(60,76, a=>{
    // casco facetado com cinta de blindagem
    let g=a.createLinearGradient(-26,0,26,0);
    g.addColorStop(0,'#2b333d'); g.addColorStop(.5,'#5a6676');
    g.addColorStop(1,'#222a33'); a.fillStyle=g;
    a.beginPath();
    a.moveTo(0,34);                                   // proa em aríete
    a.lineTo(11,22); a.lineTo(13,-2); a.lineTo(10,-26);
    a.lineTo(-10,-26); a.lineTo(-13,-2); a.lineTo(-11,22);
    a.closePath(); a.fill();
    a.fillStyle='rgba(0,0,0,.40)';                    // linha d'água
    a.fillRect(-13,-26,26,3);
    a.fillStyle='rgba(255,255,255,.12)';
    a.beginPath(); a.moveTo(0,34); a.lineTo(7,24);
    a.lineTo(-7,24); a.closePath(); a.fill();
    // cinta de blindagem rebitada
    a.fillStyle='#39424f'; a.fillRect(-13,4,26,5);
    a.fillStyle='#0e1116';
    for(let rx=-11;rx<=11;rx+=4){ a.beginPath();
      a.arc(rx,6.5,1,0,7); a.fill(); }
    // convés com chapas e escotilhas
    g=a.createLinearGradient(0,-24,0,22);
    g.addColorStop(0,'#3c4654'); g.addColorStop(1,'#28303a');
    a.fillStyle=g; a.fillRect(-9,-22,18,42);
    a.strokeStyle='rgba(0,0,0,.30)'; a.lineWidth=1;
    for(let yy=-18;yy<18;yy+=7){ a.beginPath();
      a.moveTo(-9,yy); a.lineTo(9,yy); a.stroke(); }
    a.fillStyle='#1c2128';                            // escotilhas
    a.fillRect(-5,12,10,5); a.fillRect(-5,-20,10,4);
    // ponte/cidadela blindada escalonada + seteiras
    g=a.createLinearGradient(-9,-8,9,9);
    g.addColorStop(0,'#8a96a6'); g.addColorStop(.5,'#5e6a7a');
    g.addColorStop(1,'#39424f'); a.fillStyle=g;
    a.fillRect(-9,-9,18,17);
    a.fillStyle='#222a33'; a.fillRect(-9,-9,18,3);
    a.fillStyle='#0c1014';                            // fendas de visão
    a.fillRect(-7,-4,14,2.4);
    a.fillStyle='rgba(150,180,210,.30)'; a.fillRect(-7,-4,14,1);
    a.fillStyle='#6b7686'; a.fillRect(-5,8,10,4);     // asa de comando
    // chaminés gêmeas com tampa
    a.fillStyle='#2b313a';
    a.fillRect(-6,-19,5,8); a.fillRect(1,-19,5,8);
    a.fillStyle='#11151a';
    a.fillRect(-6,-19,5,2); a.fillRect(1,-19,5,2);
    // mastro com verga + farol
    a.fillStyle='#9aa6b5'; a.fillRect(-1.5,-25,3,12);
    a.strokeStyle='#9aa6b5'; a.lineWidth=1.5;
    a.beginPath(); a.moveTo(-6,-22); a.lineTo(6,-22); a.stroke();
    a.fillStyle='#ffd24a'; a.beginPath();
    a.arc(0,-25,1.6,0,7); a.fill();
    // racks de cargas de profundidade na popa
    a.fillStyle='#3a4350';
    a.fillRect(-8,-24,5,4); a.fillRect(3,-24,5,4);
  }, h=>{
    hBlob(h,0,-1,13,30,205,60);                       // casco
    h.fillStyle='#7a7a7a'; h.fillRect(-9,-22,18,42);  // convés plano
    hBlob(h,0,-1,9,9,250,150);                        // cidadela (alta)
    hBlob(h,-3,-15,3,5,230,120);                      // chaminés
    hBlob(h,3,-15,3,5,230,120);
  });

  // ---- TORRE PRINCIPAL da canhoneira (50x24, pivô centro-esq) ----
  const shipGun = bakeSprite(50,26, a=>{
    let g=a.createLinearGradient(0,-4,0,4);
    g.addColorStop(0,'#566270'); g.addColorStop(1,'#1c232b');
    a.fillStyle=g;
    a.fillRect(4,-4.5,22,4); a.fillRect(4,1,22,4);    // canos duplos
    a.fillStyle='#12161b';
    a.fillRect(24,-5,4,4); a.fillRect(24,1.5,4,4);    // bocas
    // torre facetada
    g=a.createLinearGradient(-9,-9,9,9);
    g.addColorStop(0,'#8593a3'); g.addColorStop(.5,'#4e596a');
    g.addColorStop(1,'#272f3a'); a.fillStyle=g;
    a.beginPath();
    a.moveTo(-10,-9); a.lineTo(7,-10); a.lineTo(11,0);
    a.lineTo(7,10); a.lineTo(-10,9); a.closePath(); a.fill();
    a.fillStyle='rgba(255,255,255,.14)';
    a.beginPath(); a.moveTo(-10,-9); a.lineTo(7,-10);
    a.lineTo(7,-7); a.lineTo(-10,-6); a.closePath(); a.fill();
    a.fillStyle='#11161b'; a.beginPath();
    a.arc(-1,0,3,0,7); a.fill();
  }, h=>{
    h.fillStyle='#8a8a8a'; h.fillRect(4,-4.5,24,9);
    hBlob(h,-1,0,10,9,245,120);
  });

  // ---- LANCHA DE PATRULHA (40x52; ref 34x46) ----
  const boatHull = bakeSprite(40,52, a=>{
    let g=a.createLinearGradient(-17,0,17,0);
    g.addColorStop(0,'#7a1f1a'); g.addColorStop(.5,'#c4382c');
    g.addColorStop(1,'#7a1f1a'); a.fillStyle=g;
    a.beginPath();
    a.moveTo(0,24); a.lineTo(14,2); a.lineTo(13,-20);
    a.lineTo(-13,-20); a.lineTo(-14,2); a.closePath(); a.fill();
    a.fillStyle='rgba(255,255,255,.14)'; a.fillRect(-13,-20,26,2);
    a.fillStyle='#4a120f'; a.fillRect(-11,-16,22,28);  // cockpit aberto
    a.fillStyle='#8c98a5'; a.fillRect(-7,-2,14,11);    // cabine
    a.fillStyle='#bfe9ff'; a.fillRect(-5,0,10,5);
    a.fillStyle='rgba(255,255,255,.12)';
    a.beginPath(); a.moveTo(0,24); a.lineTo(7,6);
    a.lineTo(-7,6); a.closePath(); a.fill();
  }, h=>{
    hBlob(h,0,-2,14,24,215,70);
    hBlob(h,0,3,8,7,240,140);
  });

  // ---- DESTRÓIER STEALTH (64x120; ref 54x104, proa +y) ----
  const warHull = bakeSprite(64,120, a=>{
    // casco facetado com tumblehome
    let g;
    a.fillStyle='#39454f';
    a.beginPath();
    a.moveTo(0,54);                                   // proa em lâmina
    a.lineTo(9,40); a.lineTo(12,16); a.lineTo(12,-34);
    a.lineTo(8,-50); a.lineTo(-8,-50); a.lineTo(-12,-34);
    a.lineTo(-12,16); a.lineTo(-9,40); a.closePath(); a.fill();
    g=a.createLinearGradient(-12,0,12,0);
    g.addColorStop(0,'#27313b'); g.addColorStop(.5,'#5b6b79');
    g.addColorStop(1,'#27313b'); a.fillStyle=g;
    a.beginPath();                                    // convés (tumblehome)
    a.moveTo(0,50); a.lineTo(8,38); a.lineTo(9,15);
    a.lineTo(9,-33); a.lineTo(6,-46); a.lineTo(-6,-46);
    a.lineTo(-9,-33); a.lineTo(-9,15); a.lineTo(-8,38);
    a.closePath(); a.fill();
    a.fillStyle='rgba(0,0,0,.40)'; a.fillRect(-12,-50,24,3); // linha d'água popa
    a.fillStyle='rgba(255,255,255,.10)';
    a.beginPath(); a.moveTo(0,54); a.lineTo(5,42);
    a.lineTo(-5,42); a.closePath(); a.fill();
    // números de proa + faixas
    a.fillStyle='#cdd6df';
    a.fillRect(-3,44,1.6,5); a.fillRect(0,44,1.6,5); a.fillRect(3,44,1.6,5);
    a.fillStyle='#b5302a'; a.fillRect(-9,15,18,2);
    // ---- VLS: grade de células de mísseis no convés de proa ----
    a.fillStyle='#161a1f';
    for(let cy=22; cy<=38; cy+=5) for(let cx=-6; cx<=6; cx+=4)
      a.fillRect(cx-1.6,cy-1.6,3.2,3.2);
    a.fillStyle='rgba(255,150,60,.20)'; a.fillRect(-7,21,15,1);
    // torre principal base (canhão é stamp separado) -> só anel
    a.fillStyle='#2b333c'; a.beginPath(); a.arc(0,12,7,0,7); a.fill();
    // ---- superestrutura piramidal stealth ----
    g=a.createLinearGradient(-10,-6,10,14);
    g.addColorStop(0,'#8794a3'); g.addColorStop(.5,'#56636f');
    g.addColorStop(1,'#2f3941'); a.fillStyle=g;
    a.beginPath();
    a.moveTo(-10,2); a.lineTo(10,2); a.lineTo(8,-14);
    a.lineTo(-8,-14); a.closePath(); a.fill();
    a.fillStyle='#0d1116'; a.fillRect(-8,-2,16,3);    // ponte (visores)
    a.fillStyle='rgba(150,190,220,.30)'; a.fillRect(-8,-2,16,1);
    // painéis de radar AESA (4 faces) com leve glow
    a.fillStyle='#10202a';
    a.fillRect(-7,-13,5,5); a.fillRect(2,-13,5,5);
    a.fillStyle='rgba(90,200,210,.30)';
    a.fillRect(-7,-13,5,1.4); a.fillRect(2,-13,5,1.4);
    // torre/mastro integrado
    a.fillStyle='#3c4750';
    a.beginPath(); a.moveTo(-4,-12); a.lineTo(4,-12);
    a.lineTo(2,-30); a.lineTo(-2,-30); a.closePath(); a.fill();
    a.fillStyle='#9aa6b5'; a.fillRect(-1,-40,2,12);
    a.fillStyle='#ffce4a'; a.beginPath(); a.arc(0,-40,1.6,0,7); a.fill();
    // chaminés anguladas gêmeas
    a.fillStyle='#222a31';
    a.beginPath(); a.moveTo(-7,-16); a.lineTo(-1,-16);
    a.lineTo(-2,-26); a.lineTo(-6,-26); a.closePath(); a.fill();
    a.beginPath(); a.moveTo(7,-16); a.lineTo(1,-16);
    a.lineTo(2,-26); a.lineTo(6,-26); a.closePath(); a.fill();
    a.fillStyle='#0e1216';
    a.fillRect(-6,-26,4,2); a.fillRect(2,-26,4,2);
    // helipad de popa com "H"
    a.fillStyle='#20272e'; a.fillRect(-8,-46,16,12);
    a.strokeStyle='rgba(230,235,240,.6)'; a.lineWidth=1.4;
    a.beginPath();
    a.moveTo(-3,-44); a.lineTo(-3,-37); a.moveTo(3,-44);
    a.lineTo(3,-37); a.moveTo(-3,-40.5); a.lineTo(3,-40.5);
    a.stroke();
    // CIWS dome atrás da superestrutura
    a.fillStyle='#4a5560'; a.beginPath(); a.arc(0,-20,4,0,7); a.fill();
  }, h=>{
    hBlob(h,0,0,12,52,205,55);                        // casco
    h.fillStyle='#6a6a6a';
    h.beginPath(); h.moveTo(-10,2); h.lineTo(10,2);
    h.lineTo(8,-14); h.lineTo(-8,-14); h.closePath(); h.fill();
    hBlob(h,0,-6,9,12,245,140);                       // superestrutura
    hBlob(h,0,-30,2.5,10,255,150);                    // mastro (alto)
    hBlob(h,-4,-21,3,5,225,110); hBlob(h,4,-21,3,5,225,110);
  });

  // ---- PORTA-AVIÕES (92x176; ref 86x168) ----
  const carrierHull = bakeSprite(96,184, a=>{
    const W2=44, H2=86;
    // casco facetado (proa em lâmina +y)
    let g=a.createLinearGradient(-W2,0,W2,0);
    g.addColorStop(0,'#1b2126'); g.addColorStop(.5,'#3a444e');
    g.addColorStop(1,'#1b2126'); a.fillStyle=g;
    a.beginPath();
    a.moveTo(0,H2); a.lineTo(W2*0.7,H2*0.7); a.lineTo(W2,H2*0.3);
    a.lineTo(W2,-H2+10); a.lineTo(W2*0.5,-H2);
    a.lineTo(-W2*0.5,-H2); a.lineTo(-W2,-H2+10);
    a.lineTo(-W2,H2*0.3); a.lineTo(-W2*0.7,H2*0.7);
    a.closePath(); a.fill();
    a.fillStyle='rgba(0,0,0,.40)'; a.fillRect(-W2,-H2,W2*2,4);
    // convés de voo (non-skid escuro) + saliência a bombordo (deck angular)
    g=a.createLinearGradient(0,-H2,0,H2);
    g.addColorStop(0,'#2b3034'); g.addColorStop(.5,'#33393e');
    g.addColorStop(1,'#262b2f'); a.fillStyle=g;
    a.fillRect(-40,-80,80,158);
    a.beginPath(); a.moveTo(-40,40); a.lineTo(-40,-70);
    a.lineTo(-30,-70); a.lineTo(-12,46); a.closePath(); a.fill(); // angular
    a.fillStyle='rgba(0,0,0,.18)';                     // listras de desgaste
    for(let y=-72;y<74;y+=26) a.fillRect(-40,y,80,3);
    // borda amarela do convés
    a.strokeStyle='rgba(240,210,70,.55)'; a.lineWidth=2;
    a.strokeRect(-39,-79,78,156);
    // pista central tracejada + pista angular (branca)
    a.strokeStyle='rgba(245,245,225,.85)'; a.lineWidth=3.4;
    a.setLineDash([12,9]);
    a.beginPath(); a.moveTo(2,-74); a.lineTo(2,72); a.stroke();
    a.beginPath(); a.moveTo(-30,70); a.lineTo(30,-58); a.stroke();
    a.setLineDash([]);
    // catapultas na proa (2 trilhos) + defletores de jato
    a.strokeStyle='rgba(210,215,220,.5)'; a.lineWidth=2;
    a.beginPath(); a.moveTo(-6,30); a.lineTo(-6,76); a.stroke();
    a.beginPath(); a.moveTo(8,34); a.lineTo(-20,74); a.stroke();
    a.fillStyle='#1c2024'; a.fillRect(-12,28,12,4); a.fillRect(2,32,12,4);
    // cabos de retenção (popa) + círculo de pouso
    a.strokeStyle='rgba(230,232,235,.45)'; a.lineWidth=1.5;
    for(let y=-66;y<-46;y+=6){ a.beginPath();
      a.moveTo(-34,y); a.lineTo(34,y); a.stroke(); }
    a.strokeStyle='rgba(240,210,70,.5)'; a.lineWidth=3;
    a.beginPath(); a.arc(-2,-40,15,0,7); a.stroke();
    // numeral de proa "07"
    a.fillStyle='rgba(240,240,235,.8)';
    a.fillRect(-9,58,4,14); a.fillRect(-9,58,9,4); a.fillRect(-9,65,9,4);
    a.fillRect(2,58,9,4); a.fillRect(7,58,4,14); a.fillRect(2,65,9,4);
    // 2 elevadores de convés (borda)
    a.strokeStyle='rgba(0,0,0,.4)'; a.lineWidth=2;
    a.strokeRect(33,-10,7,22); a.strokeRect(-40,16,8,20);
    // ILHA (estibordo): bloco escalonado + radares + mastros
    g=a.createLinearGradient(28,0,42,0);
    g.addColorStop(0,'#7d8a96'); g.addColorStop(1,'#3a434d');
    a.fillStyle=g; a.fillRect(28,-22,14,46);
    a.fillStyle='#262d34'; a.fillRect(28,-22,14,4);
    a.fillStyle='#0e1318'; a.fillRect(30,-14,10,5);    // ponte (visor)
    a.fillStyle='rgba(150,190,220,.30)'; a.fillRect(30,-14,10,1.4);
    a.fillStyle='#10202a'; a.fillRect(31,-26,8,4);     // AESA
    a.fillStyle='rgba(90,200,210,.30)'; a.fillRect(31,-26,8,1.3);
    a.fillStyle='#9aa6b5'; a.fillRect(34,-40,2.4,16);  // mastro
    a.strokeStyle='#b8c4d2'; a.lineWidth=1.5;
    a.beginPath(); a.moveTo(30,-34); a.lineTo(40,-34); a.stroke();
    a.fillStyle='#1c2024'; a.fillRect(29,18,12,8);     // escape/funil integrado
    a.fillStyle='#ffce4a'; a.beginPath(); a.arc(35,-40,1.6,0,7); a.fill();
    // caças estacionados (asas dobradas) em pontos do convés
    const jetPk=(jx,jy,rot)=>{ a.save(); a.translate(jx,jy); a.rotate(rot);
      a.fillStyle='#aeb7c2';
      a.beginPath(); a.moveTo(0,11); a.lineTo(3.2,0); a.lineTo(3.2,-9);
      a.lineTo(-3.2,-9); a.lineTo(-3.2,0); a.closePath(); a.fill();
      a.fillStyle='#8a94a0'; a.fillRect(-9,-3,18,4);   // asas dobradas
      a.fillStyle='#7a838f'; a.fillRect(-3.2,-11,6.4,3);
      a.restore(); };
    jetPk(-22,-52,0.3); jetPk(-24,-30,0.25);
    jetPk(-20,52,-0.2); jetPk(20,46,-0.15);
  }, h=>{
    const W2=44,H2=86;
    hBlob(h,0,0,W2*0.95,H2*0.95,165,55);               // casco
    h.fillStyle='#9a9a9a'; h.fillRect(-40,-80,80,158);  // convés plano
    hBlob(h,35,1,8,24,250,140);                          // ilha (alta)
  });

  // ---- CHEFE GUNSHIP inimigo (190x190; nariz +y; ref W2=77 H2=61) ----
  const bossHeli = bakeSprite(190,190, a=>{
    const rW=77, rH=61;
    // lança de cauda + estabilizador (-y, atrás)
    let g=a.createLinearGradient(-7,0,7,0);
    g.addColorStop(0,'#22281c'); g.addColorStop(.5,'#3c4632');
    g.addColorStop(1,'#1b2016'); a.fillStyle=g;
    a.beginPath();
    a.moveTo(-7,-rH+30); a.lineTo(7,-rH+30);
    a.lineTo(4,-rH-30); a.lineTo(-4,-rH-30); a.closePath(); a.fill();
    a.fillStyle='#2d352e'; a.fillRect(-22,-rH-26,44,9);
    a.fillStyle='#b5302a'; a.fillRect(-22,-rH-26,44,2); // faixa de perigo
    // asas curtas: pods de foguete + mísseis
    [-1,1].forEach(s=>{
      g=a.createLinearGradient(0,-6,0,24);
      g.addColorStop(0,'#54603f'); g.addColorStop(1,'#2b3322');
      a.fillStyle=g;
      a.beginPath();
      a.moveTo(s*16,-6); a.lineTo(s*(rW+4),4);
      a.lineTo(s*(rW+4),24); a.lineTo(s*16,20); a.closePath(); a.fill();
      a.fillStyle='#23271d';                       // pod de foguetes
      a.fillRect(s*rW-9,4,22,18);
      a.fillStyle='#0e0f0a';
      for(let i=0;i<3;i++){ a.beginPath();
        a.arc(s*rW-3+i*7,22,2.4,0,7); a.fill(); }
      a.fillStyle='rgba(255,255,255,.10)'; a.fillRect(s*rW-9,4,22,2);
      a.fillStyle='#9aa0a8';                        // míssil
      a.fillRect(s*(rW*0.66)-3,4,6,26);
      a.fillStyle='#d8362a'; a.beginPath();
      a.moveTo(s*(rW*0.66)-3,30); a.lineTo(s*(rW*0.66),36);
      a.lineTo(s*(rW*0.66)+3,30); a.closePath(); a.fill();
    });
    // fuselagem blindada (nariz +y)
    g=a.createLinearGradient(-26,-rH,26,rH);
    g.addColorStop(0,'#6f805a'); g.addColorStop(.45,'#465536');
    g.addColorStop(1,'#222a1b'); a.fillStyle=g;
    a.beginPath();
    a.moveTo(0,rH);
    a.quadraticCurveTo(26,rH-10,24,rH*0.3);
    a.lineTo(20,-rH+34);
    a.quadraticCurveTo(16,-rH+10,7,-rH+30);
    a.lineTo(-7,-rH+30);
    a.quadraticCurveTo(-16,-rH+10,-20,-rH+34);
    a.lineTo(-24,rH*0.3);
    a.quadraticCurveTo(-26,rH-10,0,rH);
    a.closePath(); a.fill();
    // quilha sombreada + lombada clara
    a.fillStyle='rgba(15,25,12,.40)';
    a.beginPath(); a.moveTo(-20,rH*0.3); a.lineTo(20,rH*0.3);
    a.lineTo(13,rH-6); a.lineTo(-13,rH-6); a.closePath(); a.fill();
    a.fillStyle='rgba(190,210,150,.16)'; a.fillRect(-3,-rH+34,6,rH);
    // painéis + rebites + faixa de perigo
    a.strokeStyle='rgba(0,0,0,.32)'; a.lineWidth=2;
    a.strokeRect(-15,-rH+34,30,(rH*2)-46);
    a.fillStyle='#b5302a'; a.fillRect(-20,rH*0.3-2,40,3);
    a.fillStyle='#0c0e09';
    for(let ry=-rH+40;ry<rH-10;ry+=14){
      a.beginPath(); a.arc(-17,ry,1.4,0,7); a.fill();
      a.beginPath(); a.arc(17,ry,1.4,0,7); a.fill(); }
    // canopies em tandem (artilheiro frente +y, piloto atrás)
    const cano=(cy,rx,ry)=>{
      a.fillStyle='#0e1b12';
      a.beginPath(); a.ellipse(0,cy,rx,ry,0,0,7); a.fill();
      const gg=a.createLinearGradient(0,cy-ry,0,cy+ry);
      gg.addColorStop(0,'#d8ffe6'); gg.addColorStop(.5,'#6fae86');
      gg.addColorStop(1,'#16331e'); a.fillStyle=gg;
      a.beginPath(); a.ellipse(0,cy,rx-3,ry-3,0,0,7); a.fill();
      a.fillStyle='rgba(255,255,255,.5)';
      a.beginPath(); a.ellipse(-rx*0.3,cy-ry*0.4,rx*0.22,ry*0.3,0,0,7);
      a.fill();
    };
    cano(rH*0.34,12,16); cano(-2,13,15);
    // carcaça das turbinas (escape quente é FX vivo por cima)
    g=a.createLinearGradient(0,-rH+30,0,-rH+46);
    g.addColorStop(0,'#3a4230'); g.addColorStop(1,'#1c2116');
    a.fillStyle=g; a.fillRect(-20,-rH+30,40,16);
    a.fillStyle='#0e0f0a';
    a.fillRect(-16,-rH+34,12,9); a.fillRect(4,-rH+34,12,9);
  }, h=>{
    const rW=77, rH=61;
    h.fillStyle='#343a32';                          // boom baixo
    h.beginPath(); h.moveTo(-7,-rH+30); h.lineTo(7,-rH+30);
    h.lineTo(4,-rH-30); h.lineTo(-4,-rH-30); h.closePath(); h.fill();
    [-1,1].forEach(s=>{ h.fillStyle='#5a5a5a';      // asas planas
      h.beginPath(); h.moveTo(s*16,-6); h.lineTo(s*(rW+4),4);
      h.lineTo(s*(rW+4),24); h.lineTo(s*16,20); h.closePath(); h.fill();
      hBlob(h,s*rW+2,13,11,9,205,70); });           // pods
    hBlob(h,0,rH*0.1,24,rH*0.96,235,55);            // espinha fuselagem
    hBlob(h,0,rH*0.34,12,16,255,150);               // domo artilheiro
    hBlob(h,0,-2,13,15,255,140);                    // domo piloto
  });

  // ---- CHEFE MBT: corpo (150x164; ref W2=64 H2=70, frente +y) ----
  const bossTankBody = bakeSprite(150,164, a=>{
    const W2=64, H2=70, trW=24, txc=W2-trW/2;
    // bases das esteiras (links animados são FX vivo por cima)
    [-1,1].forEach(s=>{
      a.fillStyle='#15171b';
      a.fillRect(s*txc-trW/2,-H2,trW,H2*2);
      a.fillStyle='#0c0d10';
      a.fillRect(s*txc-trW/2,-H2,trW,4);
      a.fillRect(s*txc-trW/2,H2-4,trW,4);
      // rodas de tração visíveis nas pontas
      a.fillStyle='#2a2d33';
      [-H2+12,H2-12].forEach(wy=>{ a.beginPath();
        a.arc(s*txc,wy,9,0,7); a.fill();
        a.fillStyle='#464a52'; a.beginPath();
        a.arc(s*txc,wy,3.5,0,7); a.fill(); a.fillStyle='#2a2d33'; });
    });
    const hw = W2*2 - trW*2 + 6;
    // saia lateral blindada cobrindo topo das esteiras
    a.fillStyle='#3c4630';
    a.fillRect(-hw/2-7,-H2+14,7,H2*2-28);
    a.fillRect(hw/2,-H2+14,7,H2*2-28);
    // casco facetado (glacis na frente +y)
    let g=a.createLinearGradient(-hw/2,-H2,hw/2,H2);
    g.addColorStop(0,'#7d8c58'); g.addColorStop(.5,'#566237');
    g.addColorStop(1,'#333c22'); a.fillStyle=g;
    a.beginPath();
    a.moveTo(-hw/2,-H2+12); a.lineTo(0,-H2);
    a.lineTo(hw/2,-H2+12); a.lineTo(hw/2,H2-26);
    a.lineTo(hw/2-16,H2); a.lineTo(-hw/2+16,H2);
    a.lineTo(-hw/2,H2-26); a.closePath(); a.fill();
    // glacis: chanfro claro + blocos de blindagem reativa (ERA)
    a.fillStyle='rgba(220,230,180,.16)';
    a.beginPath(); a.moveTo(-hw/2,H2-26); a.lineTo(hw/2,H2-26);
    a.lineTo(hw/2-16,H2); a.lineTo(-hw/2+16,H2); a.closePath(); a.fill();
    a.fillStyle='#2f3720';
    for(let bx=-hw/2+14; bx<hw/2-14; bx+=18)
      a.fillRect(bx,H2-22,14,9);                       // ERA frontal
    a.fillStyle='rgba(0,0,0,.30)';
    for(let bx=-hw/2+14; bx<hw/2-14; bx+=18)
      a.fillRect(bx,H2-13,14,2);
    // chevrons de perigo na proa
    a.fillStyle='#caa92f';
    a.fillRect(-hw/2+16,H2-12,hw-32,7);
    a.fillStyle='#1d1f12';
    for(let x=-hw/2+18; x<hw/2-16; x+=14) a.fillRect(x,H2-12,7,7);
    // painéis/rebites no glacis
    a.strokeStyle='rgba(0,0,0,.30)'; a.lineWidth=2;
    a.strokeRect(-hw/2+8,-H2+18,hw-16,H2*2-52);
    a.fillStyle='#1a1d12';
    for(let yy=-H2+24; yy<H2-30; yy+=16){
      a.beginPath(); a.arc(-hw/2+12,yy,1.6,0,7); a.fill();
      a.beginPath(); a.arc(hw/2-12,yy,1.6,0,7); a.fill(); }
    // caixas de estiva + jerricans nas laterais traseiras
    a.fillStyle='#4a5436';
    a.fillRect(-hw/2+6,-H2+18,16,22);
    a.fillRect(hw/2-22,-H2+18,16,22);
    a.fillStyle='rgba(0,0,0,.25)';
    a.fillRect(-hw/2+6,-H2+28,16,2); a.fillRect(hw/2-22,-H2+28,16,2);
    // convés do motor (grelhas) na traseira -y; escape é FX vivo
    g=a.createLinearGradient(0,-H2,0,-H2+30);
    g.addColorStop(0,'#1c2014'); g.addColorStop(1,'#333b22');
    a.fillStyle=g; a.fillRect(-30,-H2+8,60,30);
    a.strokeStyle='rgba(0,0,0,.45)'; a.lineWidth=2;
    for(let yy=-H2+12; yy<-H2+34; yy+=4){ a.beginPath();
      a.moveTo(-28,yy); a.lineTo(28,yy); a.stroke(); }
  }, h=>{
    const W2=64,H2=70,trW=24,txc=W2-trW/2;
    [-1,1].forEach(s=>{ h.fillStyle='#3a3a3a';
      h.fillRect(s*txc-trW/2,-H2,trW,H2*2); });        // esteiras baixas
    const hw=W2*2-trW*2+6;
    hBlob(h,0,2,hw*0.52,H2*0.94,225,90);               // casco abaulado
    h.fillStyle='#d2d2d2';                             // glacis levemente alto
    h.beginPath(); h.moveTo(-hw/2,H2-26); h.lineTo(hw/2,H2-26);
    h.lineTo(hw/2-16,H2); h.lineTo(-hw/2+16,H2); h.closePath(); h.fill();
  });

  // ---- CHEFE MBT: torre + canhão duplo (140x90, pivô centro; cano +x) ----
  const bossTankTurret = bakeSprite(140,96, a=>{
    // bustle traseiro (cesto de estiva) atrás do eixo (-x)
    a.fillStyle='#3a4327';
    a.beginPath();
    a.moveTo(-14,-26); a.lineTo(-40,-20); a.lineTo(-44,0);
    a.lineTo(-40,20); a.lineTo(-14,26); a.closePath(); a.fill();
    a.strokeStyle='rgba(0,0,0,.3)'; a.lineWidth=2;
    a.strokeRect(-40,-18,26,36);
    // canos duplos longos com manga térmica + freio de boca
    [-7,1].forEach(oy=>{
      let g=a.createLinearGradient(0,oy,0,oy+6);
      g.addColorStop(0,'#5a6440'); g.addColorStop(1,'#23271b');
      a.fillStyle=g; a.fillRect(10,oy,58,6);
      a.fillStyle='#1a1d12'; a.fillRect(34,oy-1,10,8);  // manga térmica
      a.fillStyle='#0e1009'; a.fillRect(64,oy-1.5,9,9); // freio de boca
    });
    // mantelete + torre facetada angular
    let g=a.createLinearGradient(-26,-30,30,30);
    g.addColorStop(0,'#90a064'); g.addColorStop(.5,'#5d6a3c');
    g.addColorStop(1,'#333b22'); a.fillStyle=g;
    a.beginPath();
    a.moveTo(34,-12); a.lineTo(34,12); a.lineTo(10,30);
    a.lineTo(-22,26); a.lineTo(-30,0); a.lineTo(-22,-26);
    a.lineTo(10,-30); a.closePath(); a.fill();
    a.fillStyle='rgba(225,235,185,.16)';               // realce superior
    a.beginPath(); a.moveTo(10,-30); a.lineTo(34,-12);
    a.lineTo(20,-10); a.lineTo(2,-26); a.closePath(); a.fill();
    // blocos ERA na face frontal da torre
    a.fillStyle='#2c3420';
    for(let i=-2;i<3;i++) a.fillRect(20,i*9-4,10,8);
    // cúpula do comandante + metralhadora
    g=a.createRadialGradient(-6,-6,2,-4,0,14);
    g.addColorStop(0,'#7e8a58'); g.addColorStop(1,'#3a4225');
    a.fillStyle=g; a.beginPath(); a.arc(-4,0,13,0,7); a.fill();
    a.fillStyle='#2a3019'; a.beginPath(); a.arc(-4,0,6,0,7); a.fill();
    a.fillStyle='#15170e'; a.fillRect(-4,-2.5,22,5);   // MG da cúpula
    // lançadores de fumaça nas laterais
    a.fillStyle='#1c1f12';
    for(let i=0;i<3;i++){ a.fillRect(0,-26+i*3,7,2.4);
      a.fillRect(0,18+i*3,7,2.4); }
    // antena
    a.strokeStyle='#9aa06f'; a.lineWidth=1.5;
    a.beginPath(); a.moveTo(-18,-20); a.lineTo(-26,-34); a.stroke();
  }, h=>{
    h.fillStyle='#8a8a8a'; h.fillRect(10,-7,60,6);
    h.fillRect(10,1,60,6);                              // canos
    hBlob(h,0,0,30,28,245,110);                         // massa da torre
    hBlob(h,-4,0,13,13,255,140);                        // cúpula
  });

  // ---- CHEFE ENCOURAÇADO: casco (132x186; ref W2=60 H2=85, proa +y) ----
  const bossShipHull = bakeSprite(132,186, a=>{
    const W2=60, H2=85;
    // ---- casco facetado com cinta de blindagem ----
    let g=a.createLinearGradient(-W2,0,W2,0);
    g.addColorStop(0,'#1c2630'); g.addColorStop(.5,'#43525f');
    g.addColorStop(1,'#1c2630'); a.fillStyle=g;
    a.beginPath();
    a.moveTo(0,H2); a.lineTo(W2*0.58,H2*0.6);
    a.lineTo(W2,H2*0.16); a.lineTo(W2,-H2+16);
    a.lineTo(W2*0.5,-H2); a.lineTo(-W2*0.5,-H2);
    a.lineTo(-W2,-H2+16); a.lineTo(-W2,H2*0.16);
    a.lineTo(-W2*0.58,H2*0.6); a.closePath(); a.fill();
    a.fillStyle='rgba(0,0,0,.42)'; a.fillRect(-W2,-H2,W2*2,4);
    a.fillStyle='rgba(255,255,255,.10)';
    a.beginPath(); a.moveTo(0,H2); a.lineTo(9,H2*0.7);
    a.lineTo(-9,H2*0.7); a.closePath(); a.fill();
    // cinta de blindagem rebitada nas amuradas
    a.fillStyle='#161d24';
    a.fillRect(-W2,H2*0.16-3,W2*2,4);
    a.fillStyle='#0c1116';
    for(let xx=-W2+8; xx<W2-6; xx+=12){
      a.beginPath(); a.arc(xx,H2*0.16-1,1.3,0,7); a.fill(); }
    // ---- convés de madeira (tabuado) ----
    g=a.createLinearGradient(0,-H2,0,H2);
    g.addColorStop(0,'#7a6a44'); g.addColorStop(.5,'#9c8a58');
    g.addColorStop(1,'#6e5f3c'); a.fillStyle=g;
    a.beginPath();
    a.moveTo(0,H2-6); a.lineTo(W2-10,H2*0.5); a.lineTo(W2-10,-H2+18);
    a.lineTo(-W2+10,-H2+18); a.lineTo(-W2+10,H2*0.5);
    a.closePath(); a.fill();
    a.strokeStyle='rgba(60,48,28,.40)'; a.lineWidth=1;
    for(let xx=-W2+14; xx<W2-12; xx+=7){ a.beginPath();
      a.moveTo(xx,-H2+18); a.lineTo(xx,H2*0.55); a.stroke(); }
    // passadiços/catwalk de aço nas bordas do convés
    a.fillStyle='#39434e';
    a.fillRect(-W2+8,-H2+18,5,H2*2-30); a.fillRect(W2-13,-H2+18,5,H2*2-30);
    // ---- barbetas (bases das 3 torres principais) ----
    [H2*0.56, 0, -H2*0.5].forEach(by=>{
      g=a.createRadialGradient(-3,by-3,2,0,by,17);
      g.addColorStop(0,'#5c6672'); g.addColorStop(1,'#262d35');
      a.fillStyle=g; a.beginPath(); a.arc(0,by,16,0,7); a.fill();
      a.strokeStyle='rgba(0,0,0,.35)'; a.lineWidth=2;
      a.beginPath(); a.arc(0,by,16,0,7); a.stroke();
    });
    // ---- superestrutura pagode escalonada ----
    const tier=(yy,wd,hh,c1,c2)=>{
      const gg=a.createLinearGradient(-wd,0,wd,0);
      gg.addColorStop(0,c2); gg.addColorStop(.5,c1); gg.addColorStop(1,c2);
      a.fillStyle=gg; a.fillRect(-wd,yy-hh,wd*2,hh*2);
      a.fillStyle='rgba(255,255,255,.12)'; a.fillRect(-wd,yy-hh,wd*2,2.5);
      a.fillStyle='rgba(0,0,0,.30)'; a.fillRect(-wd,yy+hh-2.5,wd*2,2.5);
    };
    tier(2,21,28,'#566472','#2c3540');
    tier(-4,16,17,'#627280','#333d49');
    tier(-9,11,9,'#6f7e8c','#3a444f');
    a.fillStyle='#0d141a';                               // ponte (visor)
    a.fillRect(-13,-6,26,4);
    a.fillStyle='rgba(150,195,225,.32)'; a.fillRect(-13,-6,26,1.3);
    // diretor de tiro principal + telêmetro
    a.fillStyle='#46525f'; a.beginPath(); a.arc(0,-12,6,0,7); a.fill();
    a.fillStyle='#283039'; a.fillRect(-9,-13,18,2.5);
    // mastro torre + radar dish + AESA + antenas
    a.strokeStyle='#7c8a98'; a.lineWidth=2.4;
    a.beginPath(); a.moveTo(-6,-18); a.lineTo(0,-46);
    a.lineTo(6,-18); a.moveTo(0,-46); a.lineTo(0,-58); a.stroke();
    a.fillStyle='#cfe0ea';
    a.beginPath(); a.ellipse(0,-40,8,4,0,0,7); a.fill();   // radar dish
    a.fillStyle='#10202a'; a.fillRect(-6,-52,12,4);        // AESA topo
    a.fillStyle='rgba(90,200,210,.30)'; a.fillRect(-6,-52,12,1.3);
    a.fillStyle='#ffce4a'; a.beginPath(); a.arc(0,-58,1.8,0,7); a.fill();
    // 2 chaminés encouraçadas com tampa (fumaça = FX vivo)
    a.fillStyle='#222a31';
    a.fillRect(-10,-30,13,15); a.fillRect(-3,-3,13,15);
    a.fillStyle='#0e1216';
    a.fillRect(-10,-30,13,3); a.fillRect(-3,-3,13,3);
    a.fillStyle='rgba(255,255,255,.08)';
    a.fillRect(-10,-30,13,1.5); a.fillRect(-3,-3,13,1.5);
    // ---- galerias de AA secundária ao longo das amuradas ----
    for(let yy=-H2+34; yy<H2-34; yy+=18){
      [-1,1].forEach(s=>{
        a.fillStyle='#2b333c';
        a.beginPath(); a.arc(s*(W2-13),yy,4.5,0,7); a.fill();
        a.fillStyle='#10151a';
        a.fillRect(s*(W2-13)+(s<0?-9:2),yy-1.4,9,2.8);   // canos AA
        a.fillStyle='rgba(255,255,255,.10)';
        a.beginPath(); a.arc(s*(W2-13)-2,yy-2,1.6,0,7); a.fill();
      });
    }
    // âncora + escovém na proa, faixa de perigo e numeral
    a.fillStyle='#15191e';
    a.fillRect(-2,H2*0.66,4,10);
    a.beginPath(); a.arc(0,H2*0.62,3,0,7); a.fill();
    a.fillStyle='#b5302a'; a.fillRect(-W2+10,H2*0.16,W2*2-20,3);
    a.fillStyle='#d4dde4';
    a.fillRect(-4,H2*0.78,2,7); a.fillRect(0,H2*0.78,2,7);
    a.fillRect(4,H2*0.78,2,7);
  }, h=>{
    const W2=60,H2=85;
    hBlob(h,0,2,W2*0.92,H2*0.95,205,50);               // casco
    h.fillStyle='#b0b0b0';                              // convés
    h.beginPath(); h.moveTo(0,H2-6); h.lineTo(W2-10,H2*0.5);
    h.lineTo(W2-10,-H2+18); h.lineTo(-W2+10,-H2+18);
    h.lineTo(-W2+10,H2*0.5); h.closePath(); h.fill();
    [H2*0.56,0,-H2*0.5].forEach(by=>hBlob(h,0,by,16,16,235,120));
    hBlob(h,0,-2,22,30,250,150);                         // pagode (bem alto)
    hBlob(h,0,-44,3,16,255,150);                         // mastro
    hBlob(h,-3,-22,6,8,225,110); hBlob(h,3,4,6,8,225,110);
  });

  // ---- CHEFE: torre de bateria principal tripla (76x44, pivô centro) ----
  const bossShipTurret = bakeSprite(76,44, a=>{
    [-7,0,7].forEach(oy=>{
      let g=a.createLinearGradient(0,oy-2.5,0,oy+2.5);
      g.addColorStop(0,'#5a6470');
      g.addColorStop(1,'#1c232b'); a.fillStyle=g;
      a.fillRect(8,oy-2.5,30,5);
      a.fillStyle='#10151a'; a.fillRect(36,oy-3,4,6);
    });
    let g=a.createLinearGradient(-14,-14,16,16);
    g.addColorStop(0,'#8493a2'); g.addColorStop(.5,'#4d5a68');
    g.addColorStop(1,'#232c35'); a.fillStyle=g;
    a.beginPath();
    a.moveTo(10,-15); a.lineTo(16,0); a.lineTo(10,15);
    a.lineTo(-16,13); a.lineTo(-20,0); a.lineTo(-16,-13);
    a.closePath(); a.fill();
    a.fillStyle='rgba(255,255,255,.14)';
    a.beginPath(); a.moveTo(10,-15); a.lineTo(16,0);
    a.lineTo(8,-2); a.lineTo(4,-13); a.closePath(); a.fill();
    a.fillStyle='#10151a'; a.beginPath(); a.arc(-4,0,3.4,0,7); a.fill();
  }, h=>{
    h.fillStyle='#8a8a8a'; h.fillRect(8,-9,30,18);
    hBlob(h,-2,0,17,14,245,120);
  });

  SPR = { heli, tank, turret, tree, cact, rock, pine, bldg,
          trainCar, trainLoco, trainGun, jet,
          bunker, bunkerGun, navGun,
          shipHull, shipGun, boatHull, warHull, carrierHull, bossHeli,
          bossTankBody, bossTankTurret,
          bossShipHull, bossShipTurret,
          waterN: bakeWaterNormal(128),
          waterSpeckle: bakeWaterSpeckle(192, 17),
          waterSpeckle2: bakeWaterSpeckle(192, 113),
          waterSpeckle3: bakeWaterSpeckle(192, 251) };
}
// blit albedo no cv e o normal correspondente no cvN (mesmo transform)
function stamp(spr, x, y, rot, scl){
  scl = scl || 1;
  const dw=spr.w*scl, dh=spr.h*scl;
  ctx.save(); ctx.translate(x,y); if(rot) ctx.rotate(rot);
  ctx.drawImage(spr.a, -dw/2, -dh/2, dw, dh); ctx.restore();
  nx.save(); nx.translate(x,y); if(rot) nx.rotate(rot);
  nx.drawImage(spr.n, -dw/2, -dh/2, dw, dh); nx.restore();
}
// fontes de luz dinâmicas → shader (canvas px, y p/ baixo) máx 16
function collectLights(){
  const L=[];
  // luz do bocal: ESTÁVEL enquanto atira (não pisca com o cooldown)
  if(state==='play' && keys && keys.Space && player.takeoff<=0)
    L.push([player.x, player.y-20, 80, 1.0,0.85,0.45, 1.0]);
  for(let k=0;k<parts.length && L.length<15;k+=7){
    const p=parts[k];
    if(p.life>24) L.push([p.x,p.y,70, 1.0,0.55,0.22, 1.0]);
  }
  return L;
}

function drawTree(x, y, s) {
  // sombra projetada
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.beginPath(); ctx.ellipse(x + s*0.5, y + s*0.6, s*0.95, s*0.55, 0, 0, 7);
  ctx.fill();
  // copa volumétrica: sprite HD assado (albedo + normal p/ luz por pixel)
  if (SPR) stamp(SPR.tree, x, y, 0, s/24);
}

function riverPath(pad = 0, g = ctx) {
  // amostragem fina + ponta arredondada (sem pinça/bico) => sem piscar
  const STEP = 4;
  g.beginPath();
  let first = true;
  for (let y = -48; y <= H+48; y += STEP) {
    const hw = riverHWAt(y); if (hw <= 0) continue;
    const x = riverCX(y) - (hw + pad);
    first ? (g.moveTo(x, y), first = false) : g.lineTo(x, y);
  }
  for (let y = H+48; y >= -48; y -= STEP) {
    const hw = riverHWAt(y); if (hw <= 0) continue;
    g.lineTo(riverCX(y) + (hw + pad), y);
  }
  g.closePath();
}
const BIOME_PAL = {
  forest: { g:['#1f6b38','#2c8048','#185a30'], acc:'rgba(150,210,110,.22)',
            name:'FLORESTA' },
  desert: { g:['#e0b56a','#f0cd84','#cf9f52'], acc:'rgba(180,130,55,.30)',
            name:'DESERTO' },
  ice:    { g:['#cfe4ef','#eef7fb','#aecbe0'], acc:'rgba(255,255,255,.6)',
            name:'GELO' },
  city:   { g:['#4c4f55','#5a5d63','#3f4248'], acc:'rgba(20,22,26,.4)',
            name:'CIDADE' },
  ocean:  { g:['#1d4f72','#266a93','#16415f'], acc:'rgba(225,245,255,.20)',
            name:'OCEANO' },
};
// pathFn: traça o contorno da água | cxFn(y): centro | hwFn(y): meia-largura
let _waterPat=null, _specklePat=null, _specklePat2=null, _specklePat3=null;
function drawWaterBody(pathFn, cxFn, hwFn) {
  // ---- ALBEDO da água (cor + profundidade + cristas) ----
  ctx.save(); pathFn(ctx); ctx.clip();
  // água azul natural (margens fundas -> canal um pouco mais claro)
  const cm = cxFn(H/2), hm = Math.max(40, hwFn(H/2));
  const wg = ctx.createLinearGradient(cm-hm,0,cm+hm,0);
  wg.addColorStop(0,'#123a63');
  wg.addColorStop(.16,'#1a4f7e');
  wg.addColorStop(.5,'#2467a0');                      // canal central (azul)
  wg.addColorStop(.84,'#1a4f7e');
  wg.addColorStop(1,'#123a63');
  ctx.fillStyle = wg; ctx.fillRect(0,0,W,H);

  // variação de profundidade ORGÂNICA: manchas grandes e MUITO suaves
  // ancoradas no mundo (sem linhas, sem piscar) — o relevo real vem das
  // normais animadas (shader). Aqui é só leve mottle de cor.
  for (let i = 0; i < 7; i++) {
    const wY = (i*230) % 1400;
    const sy = wY + scrollY;                          // -> tela
    if (sy < -120 || sy > H+120) continue;
    const cx = cxFn(sy), hw = hwFn(sy);
    if (hw < 8) continue;
    const bx = cx + Math.sin(i*2.3)*hw*0.5;
    const r = hw*0.9;
    const gb = ctx.createRadialGradient(bx,sy,0,bx,sy,r);
    const dark = i % 2 === 0;
    gb.addColorStop(0, dark ? 'rgba(8,26,46,.16)' : 'rgba(120,165,200,.10)');
    gb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gb;
    ctx.beginPath(); ctx.ellipse(bx,sy,r,r*1.5,0,0,7); ctx.fill();
  }

  // ---- SPECKLE: campo denso de micro-flecos (a "cara de água do alto").
  // Ancorado ao scroll do mundo (rola junto, não pisca); 2 escalas. ----
  if (SPR && SPR.waterSpeckle) {
    if (!_specklePat){ _specklePat=ctx.createPattern(SPR.waterSpeckle,'repeat');
      _specklePat2=ctx.createPattern(SPR.waterSpeckle2,'repeat');
      _specklePat3=ctx.createPattern(SPR.waterSpeckle3,'repeat'); }
    const T=192, oy=((scrollY)%T+T)%T;
    // 3 campos parados, pesos em senos de freq/fase distintas: a mistura
    // nunca é uniforme -> umas regiões trocam, outras ficam (assíncrono)
    let a=0.5+0.5*Math.sin(frame*0.031),
        b=0.5+0.5*Math.sin(frame*0.043+2.1),
        d=0.5+0.5*Math.sin(frame*0.022+4.2);
    const nz=a+b+d; a/=nz; b/=nz; d/=nz;
    ctx.save(); ctx.translate(0,oy);
    ctx.globalAlpha=a; ctx.fillStyle=_specklePat;
    ctx.fillRect(-T,-oy-T,W+T*2,H+T*2);
    ctx.globalAlpha=b; ctx.fillStyle=_specklePat2;
    ctx.fillRect(-T,-oy-T,W+T*2,H+T*2);
    ctx.globalAlpha=d; ctx.fillStyle=_specklePat3;
    ctx.fillRect(-T,-oy-T,W+T*2,H+T*2);
    ctx.restore();
  }
  // espuma fina e ESTÁVEL nas margens (ancorada no mundo, sem piscar)
  for (let y = -6; y < H+6; y += 5) {
    const cx = cxFn(y), hw = hwFn(y);
    if (hw < 8) continue;
    const wY = y - scrollY;
    ctx.fillStyle = `rgba(205,225,238,${0.10+0.05*Math.sin(wY*0.12)})`;
    ctx.fillRect(cx-hw-1, y, 3, 5);
    ctx.fillRect(cx+hw-2, y, 3, 5);
  }
  ctx.restore();

  // água fica com NORMAL PLANO de propósito: o brilho direcional do sol
  // sobre normais senoidais é que criava as "linhas". A textura é toda
  // carregada pelo speckle do albedo (como na referência, luz plana).
}

// --- decorações por bioma ---
function drawCactus(x, y, s) {
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.beginPath(); ctx.ellipse(x+s*0.25, y+s*0.7, s*0.85, s*0.32, 0,0,7);
  ctx.fill();
  if (SPR) stamp(SPR.cact, x, y, 0, s/24);
}
function drawRock(x, y, s) {
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.beginPath(); ctx.ellipse(x+s*0.15, y+s*0.40, s*1.05, s*0.55, 0,0,7);
  ctx.fill();
  if (SPR) stamp(SPR.rock, x, y, 0, s/24);
}
function drawPine(x, y, s) {
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.beginPath(); ctx.ellipse(x+s*0.35, y+s*0.75, s*0.85, s*0.35, 0,0,7);
  ctx.fill();
  if (SPR) stamp(SPR.pine, x, y, 0, s/24);
}
function drawBuildingBlock(x, y, s, seed) {
  ctx.fillStyle = 'rgba(0,0,0,.32)';
  ctx.fillRect(x-s+5, y-s+6, s*2, s*2);
  if (SPR) {
    stamp(SPR.bldg, x, y, 0, s/24);
    // pequena variação tonal por seed (mantém variedade do bairro)
    const tones = ['rgba(0,0,0,0)','rgba(40,90,160,.10)',
                   'rgba(160,90,40,.08)','rgba(120,200,160,.08)'];
    ctx.fillStyle = tones[(seed*4|0)%4];
    ctx.fillRect(x-s, y-s, s*2, s*2);
    return;
  }
  // fallback (caso sprites ainda não tenham sido construídos)
  ctx.fillStyle = '#7d7f86';
  ctx.fillRect(x-s, y-s, s*2, s*2);
  ctx.fillStyle = '#cfe6f5';                    // janelas
  for (let i=-1;i<2;i++) for (let j=-1;j<2;j++)
    if (bhash(seed+i, j) > 0.35)
      ctx.fillRect(x+i*s*0.55-3, y+j*s*0.55-4, 6, 7);
  ctx.fillStyle = '#3a3d44';                    // topo/heliponto
  ctx.fillRect(x-6, y-6, 12, 12);
}
function drawScatter(b, x, y, s, seed) {
  if (b === 'forest') drawTree(x, y, s);
  else if (b === 'desert') (seed > 0.55 ? drawCactus : drawRock)(x, y, s);
  else if (b === 'ice') (seed > 0.5 ? drawPine : drawRock)(x, y, s*0.9);
  else if (b === 'ocean') {                       // espuma / marola
    ctx.fillStyle = 'rgba(235,248,255,.5)';
    ctx.beginPath();
    ctx.ellipse(x, y + Math.sin(frame*0.08 + x)*2, s*0.55, s*0.2, 0,0,7);
    ctx.fill();
  }
  // cidade: prédios vêm da malha viária coerente (drawCityGrid), não aqui
}

// textura de oceano: marulho ondulado + reflexo especular + espuma
function drawOceanSwell() {
  ctx.save();
  const sc = scrollY;                                  // rola com o mundo

  // 0) variação tonal ORGÂNICA em blobs grandes e suaves (substitui a
  // antiga cor por célula -> acaba a grade de quadrados no oceano)
  for (let i = 0; i < 9; i++) {
    const px = W*(0.5 + 0.42*Math.sin(i*2.3 + 1.1))
             + Math.sin(sc*0.003 + i)*30;
    const span = H + 360;
    let py = ((i*173.7 - sc*0.55) % span + span) % span - 180;
    const r = 150 + (i % 4)*55;
    const dark = i % 2 === 0;
    const gg = ctx.createRadialGradient(px,py,0,px,py,r);
    gg.addColorStop(0, dark ? 'rgba(10,34,55,.22)'
                            : 'rgba(70,135,160,.16)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg;
    ctx.save(); ctx.translate(px,py); ctx.scale(1, 0.7);
    ctx.beginPath(); ctx.arc(0,0,r,0,7); ctx.fill(); ctx.restore();
  }

  // 1) grandes manchas de reflexo (sheen) que sobem devagar
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const px = (W * (0.13 + 0.74 * ((i * 0.37) % 1)))
             + Math.sin(sc * 0.004 + i) * 40;
    let py = ((i * 151.3 - sc * 0.5) % (H + 220) + (H + 220)) % (H + 220) - 110;
    const rx = 90 + (i % 3) * 26, ry = 34 + (i % 2) * 12;
    const g = ctx.createRadialGradient(px, py, 0, px, py, rx);
    g.addColorStop(0, 'rgba(150,205,235,0.10)');
    g.addColorStop(1, 'rgba(150,205,235,0)');
    ctx.fillStyle = g;
    ctx.save(); ctx.translate(px, py); ctx.scale(1, ry / rx);
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, 7); ctx.fill();
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';

  // 2) SPECKLE: campo denso de micro-flecos (a "cara de mar do alto"),
  // ancorado ao scroll do mundo (rola junto, não pisca) — 2 escalas.
  // Substitui as antigas cristas em linha que pareciam fake.
  if (SPR && SPR.waterSpeckle) {
    if (!_specklePat){ _specklePat=ctx.createPattern(SPR.waterSpeckle,'repeat');
      _specklePat2=ctx.createPattern(SPR.waterSpeckle2,'repeat');
      _specklePat3=ctx.createPattern(SPR.waterSpeckle3,'repeat'); }
    const T=192, oy=((sc)%T+T)%T;
    // 3 campos parados, pesos assíncronos -> cintilar irregular no lugar
    let a=0.5+0.5*Math.sin(frame*0.028),
        b=0.5+0.5*Math.sin(frame*0.039+2.1),
        d=0.5+0.5*Math.sin(frame*0.020+4.2);
    const nz=a+b+d; a/=nz; b/=nz; d/=nz;
    ctx.save(); ctx.translate(0,oy);
    ctx.globalAlpha=a; ctx.fillStyle=_specklePat;
    ctx.fillRect(-T,-oy-T,W+T*2,H+T*2);
    ctx.globalAlpha=b; ctx.fillStyle=_specklePat2;
    ctx.fillRect(-T,-oy-T,W+T*2,H+T*2);
    ctx.globalAlpha=d; ctx.fillStyle=_specklePat3;
    ctx.fillRect(-T,-oy-T,W+T*2,H+T*2);
    ctx.restore();
  }
  ctx.restore();
}

// malha urbana coerente: quarteirões + ruas/avenidas contínuas no mundo
function drawCityGrid() {
  const BLK = 132, RW = 30;
  // faixas verticais (em tela) onde o bioma é cidade
  // faixas exatas (limites = emendas dos segmentos) -> sem piscar na troca
  const bands = [];
  for (let s = segOf(H + 40); s <= segOf(-40); s++) {
    if (biomeOf(s) !== 'city') continue;
    const ya = Math.max(-40, scrollY - (s + 1) * SEG);
    const yb = Math.min(H + 40, scrollY - s * SEG);
    if (yb > ya) bands.push([ya, yb]);
  }
  if (!bands.length) return;

  const tones = ['#54585f', '#494d54', '#5e636b', '#43474d'];
  ctx.save();
  for (const [ya, yb] of bands) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, ya, W, yb - ya); ctx.clip();

    const kx1 = Math.ceil(W / BLK);
    const kz0 = Math.floor((ya - scrollY) / BLK) - 1;
    const kz1 = Math.ceil((yb - scrollY) / BLK) + 1;

    // quarteirões (blocos) alinhados à grade do mundo
    for (let kx = 0; kx <= kx1; kx++) {
      for (let kz = kz0; kz <= kz1; kz++) {
        const bxs = kx * BLK + RW / 2;
        const bys = kz * BLK + scrollY + RW / 2;
        const bw = BLK - RW, bh = BLK - RW;
        const t = vnoise(kx * 1.7 + 3, kz * 1.7 + 9);
        ctx.fillStyle = tones[(t * 4 | 0) % 4];
        ctx.fillRect(bxs, bys, bw, bh);
        ctx.fillStyle = 'rgba(255,255,255,.06)';
        ctx.fillRect(bxs, bys, bw, 4);
        ctx.fillStyle = 'rgba(0,0,0,.30)';
        ctx.fillRect(bxs, bys + bh - 5, bw, 5);
        // janelas
        ctx.fillStyle = 'rgba(207,230,245,.20)';
        for (let wxi = 10; wxi < bw - 6; wxi += 16)
          for (let wyi = 12; wyi < bh - 6; wyi += 18)
            ctx.fillRect(bxs + wxi, bys + wyi, 7, 9);
      }
    }
    // faixas amarelas tracejadas — avenidas (vert.) e ruas (horiz.)
    ctx.fillStyle = '#f2f2f2';                    // faixas BRANCAS
    // tracejado ANCORADO ao mundo (anda junto com os quarteirões)
    const startY = Math.ceil((ya - scrollY) / 30) * 30 + scrollY;
    for (let kx = 0; kx <= kx1 + 1; kx++) {
      const ax = kx * BLK;                       // x do mundo == x da tela
      for (let yy = startY; yy < yb; yy += 30)
        ctx.fillRect(ax - 2, yy, 4, 14);
    }
    for (let kz = kz0; kz <= kz1 + 1; kz++) {
      const ry = kz * BLK + scrollY;
      if (ry < ya - 2 || ry > yb + 2) continue;
      for (let xx = 12; xx < W; xx += 30) ctx.fillRect(xx, ry - 2, 13, 4);
    }
    ctx.restore();
  }
  ctx.restore();
}

// --- carro top-down (sedan 11x22) ---
function drawCar(x, y, ang, color) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  // sombra deslocada
  ctx.fillStyle = 'rgba(0,0,0,.42)';
  ctx.beginPath(); ctx.ellipse(1.2, 1.4, 6.2, 11.2, 0, 0, 7); ctx.fill();
  // chassi
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(0, 0, 5.5, 10.5, 0, 0, 7); ctx.fill();
  // pintura mais escura na lateral inferior (volume)
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.fillRect(-5.5, 0, 11, 10);
  // teto/cabine (vidros)
  const tg = ctx.createLinearGradient(0, -4, 0, 4);
  tg.addColorStop(0, '#2c3a52'); tg.addColorStop(1, '#15202f');
  ctx.fillStyle = tg;
  ctx.fillRect(-3.4, -5, 6.8, 8);
  // friso branco do parabrisa
  ctx.fillStyle = 'rgba(180,210,235,.55)';
  ctx.fillRect(-3.4, -5, 6.8, 1.2);
  // brilho lateral (highlight especular)
  ctx.fillStyle = 'rgba(255,255,255,.22)';
  ctx.fillRect(-5.3, -2.5, 1.1, 5);
  // faróis (frente fica no topo)
  ctx.fillStyle = '#fff5b8';
  ctx.fillRect(-3.6, -10.3, 2, 1.8);
  ctx.fillRect( 1.6, -10.3, 2, 1.8);
  // lanternas traseiras
  ctx.fillStyle = '#e22';
  ctx.fillRect(-3.6,  8.6, 2, 1.6);
  ctx.fillRect( 1.6,  8.6, 2, 1.6);
  ctx.restore();
}

const CAR_COLS = ['#d23a3a','#3a78d2','#e0c64a','#37a05a','#dcdcdc',
                  '#222831','#c46b29','#7e4ec2'];

// --- carros nas avenidas/ruas da cidade (densidade baixa) ---
function drawCityCars() {
  const BLK = 132;
  const bands = [];
  for (let s = segOf(H + 40); s <= segOf(-40); s++) {
    if (biomeOf(s) !== 'city') continue;
    const ya = Math.max(-40, scrollY - (s + 1) * SEG);
    const yb = Math.min(H + 40, scrollY - s * SEG);
    if (yb > ya) bands.push([ya, yb]);
  }
  if (!bands.length) return;

  const P = 360;                                  // bem mais espaçado
  ctx.save();
  for (const [ya, yb] of bands) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, ya, W, yb - ya); ctx.clip();

    const kx1 = Math.ceil(W / BLK);
    // avenidas verticais: só ~18% delas têm tráfego, uma faixa só
    for (let kx = 0; kx <= kx1; kx++) {
      if (bhash(kx + 1, 11.3) > 0.30) continue;   // ~30% das avenidas
      const ax = kx * BLK;
      const dirY = bhash(kx + 7, 5.1) < 0.5 ? -1 : 1;
      const sp = dirY < 0 ? 2.3 : 1.5;
      const off = -dirY * frame * sp;
      // mão direita: subindo usa a faixa da direita, descendo usa a esquerda
      const dx = dirY < 0 ? 7 : -7;
      const n0 = Math.floor((ya - scrollY - off) / P) - 1;
      const n1 = Math.ceil((yb - scrollY - off) / P) + 1;
      for (let n = n0; n <= n1; n++) {
        const sy = n * P + off + scrollY;
        if (sy < ya - 14 || sy > yb + 14) continue;
        const id = ((kx * 7 + n * 13) % CAR_COLS.length
                    + CAR_COLS.length) % CAR_COLS.length;
        drawCar(ax + dx, sy, dirY > 0 ? Math.PI : 0, CAR_COLS[id]);
      }
    }
    // ruas horizontais: só ~18% delas têm tráfego, uma faixa só
    const kz0 = Math.floor((ya - scrollY) / BLK) - 1;
    const kz1 = Math.ceil((yb - scrollY) / BLK) + 1;
    for (let kz = kz0; kz <= kz1; kz++) {
      const ry = kz * BLK + scrollY;
      if (ry < ya - 2 || ry > yb + 2) continue;
      if (bhash(kz + 13, 4.7) > 0.09) continue;
      const dirX = bhash(kz + 3, 9.1) < 0.5 ? -1 : 1;
      const sp = 2.0;
      const off = dirX * frame * sp;
      // mão direita: indo p/ leste = faixa de baixo; oeste = faixa de cima
      const dy = dirX > 0 ? 7 : -7;
      const m0 = Math.floor((-off) / P) - 1;
      const m1 = Math.ceil((W - off) / P) + 1;
      for (let m = m0; m <= m1; m++) {
        const xx = m * P + off;
        if (xx < -14 || xx > W + 14) continue;
        const id = ((kz * 7 + m * 13) % CAR_COLS.length
                    + CAR_COLS.length) % CAR_COLS.length;
        drawCar(xx, ry + dy,
                dirX > 0 ? Math.PI * 0.5 : -Math.PI * 0.5, CAR_COLS[id]);
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

// --- carros na ESTRADA (faixa horizontal cruzando o mapa) ---
// roadY = topo do asfalto (screen Y); n = índice da rodovia (lineList)
const JEEP_COLS  = ['#3a5a2c','#2c3a52','#8a5a2e','#555a45','#7a3a2a','#444444'];
const TRUCK_COLS = ['#3a78d2','#d23a3a','#dcdcdc','#5b5b5b','#e0c64a','#37a05a'];

// rampFn: se não-null (estrada de terra), aplica desnível em y conforme x
function drawRoadCars(roadY, n, rampFn) {
  const P = 220;
  // mão direita: leste (dirX=+1) fica na faixa de baixo; oeste na de cima
  const lanes = [
    { dy: ROADW * 0.30, dirX: -1, sp: 2.0 },
    { dy: ROADW * 0.70, dirX:  1, sp: 2.0 },
  ];
  for (const ln of lanes) {
    const off = ln.dirX * frame * ln.sp;
    const phase = ln.dirX > 0 ? 0 : P * 0.5;
    const m0 = Math.floor((-off - phase) / P) - 1;
    const m1 = Math.ceil((W - off - phase) / P) + 1;
    for (let m = m0; m <= m1; m++) {
      // só ~25% dos slots têm veículo (mesma densidade de antes)
      if (bhash(n + m * 1.7, ln.dirX) > 0.25) continue;
      const xx = m * P + off + phase;
      if (xx < -14 || xx > W + 14) continue;
      const yy = roadY + ln.dy + (rampFn ? rampFn(xx) : 0);
      // em estrada de terra, gira o veículo p/ acompanhar o desnível (Yini→Yfim)
      let ang;
      if (rampFn) {
        const sl = rampFn(xx + 1) - rampFn(xx);   // dy/dx local
        ang = Math.atan2(ln.dirX, -ln.dirX * sl);
      } else {
        ang = ln.dirX > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
      }
      // sorteia tipo de veículo: 60% sedan, 25% jipe, 15% caminhão
      const r = bhash(n * 1.3 + m, ln.dirX * 7 + 3);
      if (r < 0.60) {
        const id = ((n * 5 + m * 13 + (ln.dirX > 0 ? 1 : 0))
                    % CAR_COLS.length + CAR_COLS.length) % CAR_COLS.length;
        drawCar(xx, yy, ang, CAR_COLS[id]);
      } else if (r < 0.85) {
        const id = ((n * 3 + m * 11) % JEEP_COLS.length
                    + JEEP_COLS.length) % JEEP_COLS.length;
        drawJeep(xx, yy, ang, JEEP_COLS[id]);
      } else {
        const id = ((n * 7 + m * 17) % TRUCK_COLS.length
                    + TRUCK_COLS.length) % TRUCK_COLS.length;
        drawTruck(xx, yy, ang, TRUCK_COLS[id]);
      }
    }
  }
}

// --- jipe top-down (~11x18, capô curto, roll bar, estepe atrás) ---
function drawJeep(x, y, ang, color) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  // sombra
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.beginPath(); ctx.ellipse(1.2, 1.4, 6.5, 10, 0, 0, 7); ctx.fill();
  // corpo (chassi retangular com cantos arredondados)
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-5.5, -7.5); ctx.lineTo(5.5, -7.5);
  ctx.lineTo(6.0,  7.5);  ctx.lineTo(-6.0, 7.5);
  ctx.closePath(); ctx.fill();
  // capô (frente, mais escuro)
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.fillRect(-4.5, -7.5, 9, 3.5);
  // grade frontal
  ctx.fillStyle = '#222';
  ctx.fillRect(-3.5, -7.8, 7, 1.0);
  ctx.strokeStyle = '#666'; ctx.lineWidth = 0.6;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath(); ctx.moveTo(i, -7.8); ctx.lineTo(i, -6.8); ctx.stroke();
  }
  // para-brisa inclinado
  ctx.fillStyle = '#22324a';
  ctx.fillRect(-4.2, -3.8, 8.4, 1.8);
  ctx.fillStyle = 'rgba(200,220,235,.35)';
  ctx.fillRect(-4.2, -3.8, 8.4, 0.6);
  // cabine aberta (assentos visíveis)
  ctx.fillStyle = '#262a30';
  ctx.fillRect(-4.0, -1.6, 8.0, 3.6);
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.fillRect(-4.0,  0.1, 8.0, 0.4);    // divisão dos bancos
  // roll bar (barra de capotamento)
  ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-4.5, -2); ctx.lineTo(-4.5, 5);
  ctx.moveTo( 4.5, -2); ctx.lineTo( 4.5, 5);
  ctx.moveTo(-4.5,  1.5); ctx.lineTo( 4.5,  1.5);
  ctx.stroke();
  // estepe na traseira
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(0, 6.2, 1.9, 0, 7); ctx.fill();
  ctx.fillStyle = '#555';
  ctx.beginPath(); ctx.arc(0, 6.2, 0.9, 0, 7); ctx.fill();
  // faróis
  ctx.fillStyle = '#fff5b8';
  ctx.fillRect(-4.0, -7.9, 1.7, 1.2);
  ctx.fillRect( 2.3, -7.9, 1.7, 1.2);
  // lanternas traseiras
  ctx.fillStyle = '#e22';
  ctx.fillRect(-4.5,  7.1, 1.5, 1.0);
  ctx.fillRect( 3.0,  7.1, 1.5, 1.0);
  // rodas exteriores (paralamas)
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(-6.2, -5.5, 0.9, 3.5);
  ctx.fillRect( 5.3, -5.5, 0.9, 3.5);
  ctx.fillRect(-6.4,  2.0, 0.9, 3.5);
  ctx.fillRect( 5.5,  2.0, 0.9, 3.5);
  ctx.restore();
}

// --- caminhão top-down (~13x30): cabine + carroceria + pneus laterais ---
function drawTruck(x, y, ang, color) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  // sombra grande
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.fillRect(-6.5, -14, 13.5, 30);
  // carroceria (atrás)
  ctx.fillStyle = '#8a7050';
  ctx.fillRect(-6, -1, 12, 16);
  // ripas verticais (tábuas) da carroceria
  ctx.strokeStyle = 'rgba(60,40,20,.55)'; ctx.lineWidth = 0.6;
  for (let i = -5; i <= 5; i += 2) {
    ctx.beginPath(); ctx.moveTo(i, -1); ctx.lineTo(i, 15); ctx.stroke();
  }
  // beirada superior da caçamba (sombra interna)
  ctx.fillStyle = 'rgba(0,0,0,.30)';
  ctx.fillRect(-6, -1, 12, 1.8);
  // moldura externa escura da carroceria
  ctx.strokeStyle = '#3a2a14'; ctx.lineWidth = 0.9;
  ctx.strokeRect(-6, -1, 12, 16);
  // cabine (frente)
  ctx.fillStyle = color;
  ctx.fillRect(-6, -13, 12, 12);
  // capô (mais escuro)
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.fillRect(-6, -13, 12, 3);
  // teto/cabine: gradiente p/ volume
  const tg = ctx.createLinearGradient(0, -10, 0, -2);
  tg.addColorStop(0, 'rgba(255,255,255,.18)');
  tg.addColorStop(1, 'rgba(0,0,0,.20)');
  ctx.fillStyle = tg;
  ctx.fillRect(-6, -10, 12, 8);
  // para-brisa
  ctx.fillStyle = '#1f2a3d';
  ctx.fillRect(-5, -12, 10, 3);
  ctx.fillStyle = 'rgba(200,220,235,.45)';
  ctx.fillRect(-5, -12, 10, 0.8);
  // faróis
  ctx.fillStyle = '#fff5b8';
  ctx.fillRect(-5, -13.4, 2, 1.4);
  ctx.fillRect( 3, -13.4, 2, 1.4);
  // grade
  ctx.fillStyle = '#222';
  ctx.fillRect(-3, -13.3, 6, 1.0);
  // espelhos retrovisores
  ctx.fillStyle = color;
  ctx.fillRect(-7.2, -11, 1.2, 2);
  ctx.fillRect( 6.0, -11, 1.2, 2);
  // rodas (visíveis nas laterais)
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(-7,  -9, 1.2, 4);          // dianteira esq
  ctx.fillRect( 5.8, -9, 1.2, 4);         // dianteira dir
  ctx.fillRect(-7,   3, 1.2, 4);          // traseira esq
  ctx.fillRect( 5.8,  3, 1.2, 4);         // traseira dir
  ctx.fillRect(-7,   8, 1.2, 4);          // tandem traseiro esq
  ctx.fillRect( 5.8,  8, 1.2, 4);         // tandem traseiro dir
  // lanternas traseiras
  ctx.fillStyle = '#e22';
  ctx.fillRect(-5.5, 14.4, 2, 1.2);
  ctx.fillRect( 3.5, 14.4, 2, 1.2);
  ctx.restore();
}

// --- pedestres na cidade (densidade baixa, andando nas calçadas) ---
// pedestre vista de cima (~9px alto, ~6px de ombros), virado pra +y
function drawPed(x, y, ang, walk, sk, sh, pant, hair) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  // sombra
  ctx.fillStyle = 'rgba(0,0,0,.42)';
  ctx.beginPath(); ctx.ellipse(0.8, 1.2, 3.4, 1.8, 0, 0, 7); ctx.fill();
  // pernas (calça) — balançam pra trás/frente
  const lsw = Math.sin(walk) * 1.5;
  ctx.fillStyle = pant;
  ctx.fillRect(-1.7, 1.4 - lsw * 0.5, 1.4, 3.2 + lsw);
  ctx.fillRect( 0.3, 1.4 + lsw * 0.5, 1.4, 3.2 - lsw);
  // torso (camisa) — oval mais largo (ombros) que comprido
  ctx.fillStyle = sh;
  ctx.beginPath(); ctx.ellipse(0, 0.2, 2.9, 2.4, 0, 0, 7); ctx.fill();
  // contorno discreto pra silhueta legível em qualquer fundo
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.ellipse(0, 0.2, 2.9, 2.4, 0, 0, 7); ctx.stroke();
  // braços balançando (oposto às pernas)
  const asw = Math.sin(walk) * 1.6;
  ctx.fillStyle = sh;
  ctx.beginPath(); ctx.ellipse(-2.8,  asw,       1.0, 1.5, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse( 2.8, -asw,       1.0, 1.5, 0, 0, 7); ctx.fill();
  // mãos (pele) na ponta dos braços
  ctx.fillStyle = sk;
  ctx.beginPath(); ctx.arc(-3.2,  asw + 0.6, 0.7, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc( 3.2, -asw + 0.6, 0.7, 0, 7); ctx.fill();
  // cabeça (à frente do torso)
  ctx.fillStyle = sk;
  ctx.beginPath(); ctx.arc(0, -2.0, 2.0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.arc(0, -2.0, 2.0, 0, 7); ctx.stroke();
  // cabelo (topo / parte de trás da cabeça)
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.arc(0, -2.4, 1.7, Math.PI * 0.15, Math.PI - 0.15);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawCityPeds() {
  const BLK = 132, RW = 30;
  const bands = [];
  for (let s = segOf(H + 40); s <= segOf(-40); s++) {
    if (biomeOf(s) !== 'city') continue;
    const ya = Math.max(-40, scrollY - (s + 1) * SEG);
    const yb = Math.min(H + 40, scrollY - s * SEG);
    if (yb > ya) bands.push([ya, yb]);
  }
  if (!bands.length) return;
  const SKIN  = ['#f0c79a','#d8a376','#a06b46','#e9b88a'];
  const SHIRT = ['#3a78d2','#d23a3a','#e0c64a','#37a05a','#dcdcdc',
                 '#b07730','#7e4ec2','#1f8aa3'];
  const PANTS = ['#3a3f48','#2c2f36','#5e4a2c','#4a3a2a','#243046'];
  const HAIR  = ['#2a1a10','#704030','#c39a55','#1a1a1a'];

  ctx.save();
  for (const [ya, yb] of bands) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, ya, W, yb - ya); ctx.clip();

    const kx1 = Math.ceil(W / BLK);
    const kz0 = Math.floor((ya - scrollY) / BLK) - 1;
    const kz1 = Math.ceil((yb - scrollY) / BLK) + 1;
    for (let kx = 0; kx <= kx1; kx++) {
      for (let kz = kz0; kz <= kz1; kz++) {
        if (bhash(kx * 3.1 + 7, kz * 2.7 + 1) > 0.15) continue;
        const bxs = kx * BLK + RW / 2;
        const bys = kz * BLK + scrollY + RW / 2;
        const bw = BLK - RW, bh = BLK - RW;
        const side = (bhash(kx + 1, kz + 5) * 4) | 0;
        const t0   = bhash(kx + 2, kz + 9);
        const sp   = 0.30;
        const span = ((side & 1) === 0 || side >= 2)
                     ? (side >= 2 ? bh - 14 : bw - 14)
                     : bw - 14;
        const phase = t0 * Math.PI * 2;
        const theta = frame * sp / span * 4 + phase;
        const u  = 0.5 + 0.5 * Math.sin(theta);
        const du = Math.cos(theta);              // sinal = direção do passo
        let px, py, ang;
        if (side === 0) {          // calçada norte: anda horizontal
          px = bxs + 7 + u * (bw - 14); py = bys + 5;
          ang = du >= 0 ? -Math.PI / 2 : Math.PI / 2;
        } else if (side === 1) {   // sul
          px = bxs + 7 + u * (bw - 14); py = bys + bh - 5;
          ang = du >= 0 ? -Math.PI / 2 : Math.PI / 2;
        } else if (side === 2) {   // leste: anda vertical
          px = bxs + bw - 5; py = bys + 7 + u * (bh - 14);
          ang = du >= 0 ? 0 : Math.PI;
        } else {                   // oeste
          px = bxs + 5; py = bys + 7 + u * (bh - 14);
          ang = du >= 0 ? 0 : Math.PI;
        }
        const sk = SKIN [(t0 * 100 | 0) % SKIN.length];
        const sh = SHIRT[((kx * 5 + kz * 3) % SHIRT.length + SHIRT.length)
                         % SHIRT.length];
        const pn = PANTS[((kx * 7 + kz)     % PANTS.length + PANTS.length)
                         % PANTS.length];
        const hr = HAIR [((kx + kz * 11)    % HAIR.length  + HAIR.length)
                         % HAIR.length];
        // velocidade do balanço de pernas/braços: andando passo médio
        const walk = frame * 0.32 + phase;
        drawPed(px, py, ang, walk, sk, sh, pn, hr);
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawTerrain() {
  ctx.fillStyle = '#1c5733';
  ctx.fillRect(0, 0, W, H);

  // ---- solo por bioma (célula = linha de mundo fixa Wc) ----
  const C = 64;
  for (let Wc = Math.floor((-C - scrollY)/C);
           Wc <= Math.ceil((H + C - scrollY)/C); Wc++) {
    const sy = Wc*C + scrollY;
    for (let bx = 0; bx < W/C + 1; bx++) {
      const sx = bx*C;
      const wx = sx, wy = Wc*C;                 // coords de MUNDO (contínuas)
      const b = biomeBlend(sy + C/2, vnoise(wx/90+9, wy/90+4));
      const pal = BIOME_PAL[b];
      // ruído contínuo: manchas grandes que atravessam células
      const n  = vnoise(wx/150, wy/150);
      const n2 = vnoise(wx/60 + 21, wy/60 + 8);
      if (b === 'ocean') {
        // cor de base UNIFORME (sem grade de células); a variação
        // tonal vem em blobs suaves no drawOceanSwell
        ctx.fillStyle = '#1b4f73';
      } else {
        ctx.fillStyle = n < .42 ? pal.g[0] : (n < .74 ? pal.g[1] : pal.g[2]);
      }
      // faixa do solo em pixel inteiro + 1px de sobreposição:
      // elimina a costura sub-pixel que "pisca" ao rolar (gelo/deserto)
      const y0 = Math.round(sy), y1 = Math.round(sy + C);
      ctx.fillRect(sx, y0, C, y1 - y0 + 1);
      if (b === 'forest') {
        // clareiras/folhagem: manchas suaves coerentes (ruído)
        if (n2 > .68) { ctx.fillStyle = pal.acc;
          ctx.beginPath();
          ctx.ellipse(sx+C/2, sy+C/2, C*0.5*(0.55+n2*0.5), C*0.34, 0,0,7);
          ctx.fill(); }
      } else if (b === 'desert') {
        // dunas: cristas LONGAS e contínuas (fase no mundo, casam entre células)
        const f = X => sy + 20 + Math.sin(X*0.016 + wy*0.022)*11;
        ctx.lineWidth = 5;
        ctx.strokeStyle = n2 > .5 ? 'rgba(255,235,180,.22)'
                                  : 'rgba(150,110,55,.20)';
        ctx.beginPath();
        ctx.moveTo(sx, f(sx));
        ctx.quadraticCurveTo(sx+C/2, f(sx+C/2), sx+C, f(sx+C));
        ctx.stroke();
      } else if (b === 'ice') {
        // placas de gelo (ruído) + rachadura contínua que atravessa células
        if (n2 > .55) { ctx.fillStyle='rgba(255,255,255,.40)';
          ctx.beginPath();
          ctx.ellipse(sx+C/2, sy+C/2, C*0.46, C*0.30, 0,0,7); ctx.fill(); }
        const cc = wy*0.03;
        ctx.strokeStyle='rgba(120,150,175,.42)'; ctx.lineWidth=1.5;
        ctx.beginPath();
        ctx.moveTo(sx,   sy + (0.5+0.45*Math.sin(sx*0.05+cc))*C);
        ctx.lineTo(sx+C, sy + (0.5+0.45*Math.sin((sx+C)*0.05+cc))*C);
        ctx.stroke();
      }
      // cidade: ruas/quarteirões num passe global coerente (drawCityGrid)
    }
  }
  drawCityGrid();                               // malha viária contínua
  drawCityCars();                               // tráfego nas avenidas/ruas
  drawCityPeds();                               // pedestres nas calçadas

  // ---- textura de mar (passe global sobre as células de oceano) ----
  if (biomeOf(segOf(-40)) === 'ocean' || biomeOf(segOf(H+40)) === 'ocean')
    drawOceanSwell();

  // ---- lagos (biomas de cidade) ----
  cityLakes().forEach(l => {
    ctx.fillStyle = '#6a6f74';                    // margem de concreto
    lakePath(l, ctx, 9); ctx.fill();
    const lp  = (g=ctx) => lakePath(l, g, 0);
    const lhw = y => { const d=1-((y-l.y)/l.ry)**2;
      return d>0 ? l.rx*Math.sqrt(d)*0.92 : 0; };
    drawWaterBody(lp, () => l.x, lhw);
    ctx.strokeStyle='rgba(220,240,255,.3)'; ctx.lineWidth=2;
    lakePath(l, ctx, 0); ctx.stroke();
  });

  // ---- rio (quando o segmento tem rio) ----
  let hasRiver = false;
  for (let y=0;y<=H;y+=40) if (riverHWAt(y) > 0) { hasRiver = true; break; }
  if (hasRiver) {
    ctx.fillStyle = '#c9b274';                    // bancos de areia
    riverPath(9); ctx.fill();
    drawWaterBody(g => riverPath(0, g), riverCX, riverHWAt);
    // contorno ESTÁVEL (sem animação) seguindo o mesmo traçado do rio
    ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(220,240,255,.32)';
    riverPath(0); ctx.stroke();
  }

  // ---- trilhos de trem ----
  const rails = [];
  lineList(RAIL_P, -40, H+40).forEach(o => {
    const railY = railScreenY(o.n);
    if (railY < -40 || railY > H) return;
    if (biomeOf(segOf(railY)) === 'ocean') return;   // sem trilho no mar
    rails.push(railY);
    ctx.fillStyle = '#5b5750'; ctx.fillRect(0, railY-3, W, 28);
    ctx.fillStyle = '#4a3625';
    for (let x = 0; x < W; x += 16) ctx.fillRect(x, railY-1, 10, 24);
    ctx.fillStyle = '#9aa1aa';
    ctx.fillRect(0, railY+3, W, 4); ctx.fillRect(0, railY+15, W, 4);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.fillRect(0, railY+3, W, 1); ctx.fillRect(0, railY+15, W, 1);
  });

  // ---- estradas ----
  const roads = [];
  lineList(ROAD_P, -40, H+40).forEach(o => {
    const roadY = o.y;
    if (roadY < -40 || roadY > H) return;
    if (biomeOf(segOf(roadY)) === 'ocean') return;   // sem estrada no mar
    // ~40% das vias são de TERRA (sem pavimento); cor segue o bioma
    const dirt = bhash(o.n, 31.7) < 0.42;
    let rampFn = null;                              // exposta p/ drawRoadCars
    if (dirt) {
      const b = biomeOf(segOf(roadY + ROADW/2));
      const col = b === 'desert' ? ['#caa066','#b1894e','#937036']
                : b === 'ice'    ? ['#c6d0d4','#aab7bd','#8c9aa1']
                : b === 'city'   ? ['#85817a','#6e6b64','#54514c']
                :                  ['#7c6040','#664c2f','#4f3a23']; // floresta
      // bordas IRREGULARES + DESNÍVEL geral (entra de um lado e sai mais
      // acima/abaixo do outro); tudo determinístico em x e o.n -> não pisca
      const k = o.n*1.7;
      const sl = (hash(o.n, 5.3) - 0.5) * 0.26;       // rampa (~±60px em W)
      const ramp = x => sl * (x - W/2);
      rampFn = ramp;
      const eTop = x => roadY + ramp(x) + Math.sin(x*0.055+k)*3
        + Math.sin(x*0.017+k*1.9)*2.2 + 1.5;
      const eBot = x => roadY+ROADW + ramp(x) + Math.sin(x*0.048+k*2.3)*3
        + Math.sin(x*0.021+k*0.6)*2.2 - 1.5;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, eTop(0));
      for (let x=0; x<=W; x+=10) ctx.lineTo(x, eTop(x));
      for (let x=W; x>=0; x-=10) ctx.lineTo(x, eBot(x));
      ctx.closePath(); ctx.clip();
      ctx.fillStyle = col[0]; ctx.fillRect(0, roadY-8, W, ROADW+16);
      // acostamento acompanhando a borda ondulada
      ctx.strokeStyle = col[2]; ctx.lineWidth = 7;
      ctx.beginPath();
      for (let x=0; x<=W; x+=10)
        (x?ctx.lineTo:ctx.moveTo).call(ctx, x, eTop(x));
      ctx.stroke();
      ctx.beginPath();
      for (let x=0; x<=W; x+=10)
        (x?ctx.lineTo:ctx.moveTo).call(ctx, x, eBot(x));
      ctx.stroke();
      // 2 sulcos de roda SERPENTEANDO
      ctx.strokeStyle = col[1]; ctx.lineWidth = 6;
      [0.34, 0.64].forEach((fr,i) => {
        ctx.beginPath();
        for (let x=0; x<=W; x+=10) {
          const yy = roadY + ROADW*fr + ramp(x) + Math.sin(x*0.05+k+i*2)*3.2
            + Math.sin(x*0.013+k)*2;
          (x?ctx.lineTo:ctx.moveTo).call(ctx, x, yy);
        }
        ctx.stroke();
      });
      // manchas/pedriscos determinísticos (terra batida)
      for (let i=0; i<26; i++) {
        const hx = hash(o.n*3+i, i*2.1), hy = hash(i*1.7, o.n+i);
        const x = hx*W, y = roadY+5 + hy*(ROADW-10) + ramp(x);
        ctx.fillStyle = (i%3? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,.06)');
        ctx.beginPath();
        ctx.ellipse(x, y, 2+hx*4, 1.5+hy*2.5, 0, 0, 7); ctx.fill();
      }
      ctx.restore();
    } else {
      ctx.fillStyle = '#3a3b40'; ctx.fillRect(0, roadY, W, ROADW); // asfalto
      ctx.fillStyle = '#2b2c30';                     // acostamento
      ctx.fillRect(0, roadY, W, 5);
      ctx.fillRect(0, roadY+ROADW-5, W, 5);
      ctx.fillStyle = 'rgba(255,255,255,.05)';       // brilho do asfalto
      ctx.fillRect(0, roadY+7, W, 2);
      ctx.fillStyle = '#e9e3c6';                     // faixa central tracejada
      for (let x = 0; x < W; x += 48)
        ctx.fillRect(x+14, roadY+ROADW/2-2, 26, 4);
    }
    // guarda dados da estrada p/ pontes e p/ desenhar carros DEPOIS da ponte
    roads.push({ y: roadY, n: o.n, rampFn });
  });
  gRails = rails; gRoads = roads;

  // ---- decorações por bioma ----
  // filtros em COORDENADAS DE MUNDO (não dependem do scroll) — assim a
  // decisão "fica ou não" é estável: a árvore não aparece e some quando
  // o trilho/estrada entra na faixa visível.
  const segOfW = wy => Math.floor(-wy / SEG);
  const nearRoadW = (wy, band) => {
    const ny = Math.round(wy / ROAD_P) * ROAD_P;
    if (biomeOf(segOfW(ny)) === 'ocean') return false;
    return Math.abs(wy - ny) < band;
  };
  const nearRailW = (wy, band) => {
    const ny = railWorldShift(Math.round(wy / RAIL_P) * RAIL_P);
    if (biomeOf(segOfW(ny)) === 'ocean') return false;
    return Math.abs(wy - ny) < band;
  };

  const TC = 80;
  for (let Wc = Math.floor((-TC - scrollY)/TC);
           Wc <= Math.ceil((H + TC - scrollY)/TC); Wc++) {
    const rowY = Wc*TC + scrollY;
    for (let bx = 0; bx < W/TC + 1; bx++) {
      const h = hash(bx*2+1, Wc*2+1);
      const px = bx*TC + (hash(bx, Wc)*0.6 + 0.2)*TC;
      const py = rowY + (h*0.5)*TC;
      const pwy = py - scrollY;                  // worldY estável
      if (helipad && Math.abs(px - helipad.x) < 70 &&
          Math.abs(py - (helipad.sy0 + scrollY)) < 70) continue;  // sem mato no heliporto
      if (landpad && Math.abs(px - landpad.x) < 70 &&
          Math.abs(py - (landpad.sy0 + scrollY)) < 70) continue;  // idem no pad de pouso
      const b = biomeBlend(py, hash(bx*7+3, Wc*7+3));
      const thr = b === 'city' ? 0.35 : 0.5;      // cidade = mais densa
      if (h < thr) continue;
      if (inRiver(px, py, 20) || inLake(px, py, 18)) continue;
      // descarte rápido pelo centro da célula (economia)
      if (nearRoadW(pwy, 56)) continue;
      if (nearRailW(pwy, 50)) continue;
      const cnt = b === 'city' ? 1 : 1 + (h*3|0);
      for (let k = 0; k < cnt; k++) {
        const sx = px + (hash(bx+k, Wc)-.5)*46;
        const sy = py + (hash(Wc+k, bx)-.5)*40;
        const swy = sy - scrollY;                // worldY estável do item
        const ss = 10 + hash(k+1, bx+Wc)*7;
        // raio efetivo do item -> margem extra pra não tocar a rua/trilho
        const pad = ss + 4;
        if (nearRoadW(swy, ROADW/2 + pad)) continue;
        if (nearRailW(swy, 14 + pad)) continue;
        if (inRiver(sx, sy, pad) || inLake(sx, sy, pad)) continue;
        drawScatter(b, sx, sy, ss, hash(bx+k*3, Wc+k));
      }
    }
  }

  drawHelipad();                       // heliporto da decolagem (sobre o solo)
  drawLandPad();                       // heliporto de pouso (fim de fase)
}

// --- desenha um heliporto (terrestre ou marítimo) em (cx,cy) ---
// rotorK: 0..1, intensidade do sopro de poeira (0 = sem dust)
function drawPadAt(cx, cy, marine, rotorK) {
  ctx.save();
  ctx.translate(cx, cy);
  if (marine) {
    // base de mar: pilastras + deck quadrado de aço
    // pilastras (4 cantos) com sombra na água
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    [[-38,28],[38,28],[-38,-22],[38,-22]].forEach(([px,py])=>{
      ctx.beginPath();
      ctx.ellipse(px+5, py+8, 9, 4.5, 0, 0, 7); ctx.fill();
    });
    ctx.fillStyle = '#5a6068';
    [[-38,28],[38,28],[-38,-22],[38,-22]].forEach(([px,py])=>{
      ctx.fillRect(px-5, py-22, 10, 24);
      ctx.fillStyle = '#7d8389';
      ctx.fillRect(px-5, py-22, 10, 3);
      ctx.fillStyle = '#5a6068';
    });
    // sombra do deck na água
    ctx.fillStyle = 'rgba(0,0,0,.30)';
    ctx.fillRect(-50+6, -38+8, 100, 80);
    // deck quadrado (aço com vigas)
    ctx.fillStyle = '#7a7e85';
    ctx.fillRect(-50, -38, 100, 80);
    ctx.strokeStyle = '#3b3e44'; ctx.lineWidth = 2;
    ctx.strokeRect(-50, -38, 100, 80);
    // vigas internas (cruz)
    ctx.strokeStyle = 'rgba(40,42,48,.65)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-50,0); ctx.lineTo(50,0);
    ctx.moveTo(0,-38); ctx.lineTo(0,42); ctx.stroke();
    // amarelo de borda (faixa de alerta)
    ctx.fillStyle = '#e6c533';
    ctx.fillRect(-50, -38, 100, 4);
    ctx.fillRect(-50, 34, 100, 4);
    // círculo do heliponto sobre o deck
    ctx.fillStyle = '#3b3e44';
    ctx.beginPath(); ctx.arc(0, 0, 32, 0, 7); ctx.fill();
    ctx.strokeStyle = '#e9eef2'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 28, 0, 7); ctx.stroke();
  } else {
    // plataforma de concreto (igual ao heliporto original)
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(5, 6, 50, 50, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#6c7077';
    ctx.beginPath(); ctx.arc(0, 0, 48, 0, 7); ctx.fill();
    ctx.fillStyle = '#5a5e64';
    ctx.beginPath(); ctx.arc(0, 0, 42, 0, 7); ctx.fill();
    ctx.strokeStyle = '#e9eef2'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, 36, 0, 7); ctx.stroke();
  }
  // "H" central (em ambos os tipos)
  ctx.strokeStyle = '#eef3f7'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-13, -18); ctx.lineTo(-13, 18);
  ctx.moveTo(13, -18);  ctx.lineTo(13, 18);
  ctx.moveTo(-13, 0);   ctx.lineTo(13, 0);
  ctx.stroke();
  // luzes de borda piscando
  const R = marine ? 46 : 44;
  for (let a = 0; a < 7; a += Math.PI / 4) {
    const on = (Math.floor(frame / 14) % 2) === 0;
    ctx.fillStyle = on ? '#ffd24a' : '#7a6320';
    ctx.beginPath();
    ctx.arc(Math.cos(a) * R, Math.sin(a) * R, 3.2, 0, 7);
    ctx.fill();
  }
  // poeira do rotor (decolagem/pouso)
  if (rotorK > 0) {
    ctx.globalCompositeOperation = 'lighter';
    const k = Math.max(0, Math.min(1, rotorK));
    const g = ctx.createRadialGradient(0, 0, 6, 0, 0, 30 + k * 22);
    g.addColorStop(0, `rgba(220,210,185,${0.30 * (1 - k)})`);
    g.addColorStop(1, 'rgba(220,210,185,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 30 + k * 22, 0, 7); ctx.fill();
  }
  ctx.restore();
}

function drawHelipad() {
  if (!helipad) return;
  const cx = helipad.x, cy = helipad.sy0 + scrollY;
  if (cy > H + 90) { helipad = null; return; }     // já saiu da tela
  // poeira durante decolagem (player.takeoff > 0)
  const rotorK = player.takeoff > 0 ? (1 - player.takeoff / TAKEOFF) : 0;
  drawPadAt(cx, cy, !!helipad.marine, rotorK);
}

function drawLandPad() {
  if (!landpad) return;
  const cx = landpad.x, cy = landpad.sy0 + scrollY;
  // poeira durante o pouso (outro.phase === 'land')
  let rotorK = 0;
  if (outro && outro.phase === 'land')
    rotorK = 1 - Math.max(0, outro.t) / 70;
  drawPadAt(cx, cy, !!landpad.marine, rotorK);
}

function drawHeli(x, y, blink, sc) {
  ctx.save();
  ctx.translate(x, y);
  if (sc && sc !== 1) ctx.scale(sc, sc);
  if (blink && Math.floor(frame/4)%2) ctx.globalAlpha = .35;

  // sombra projetada no chão (deslocada)
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath();
  ctx.ellipse(6, 30, 16, 9, 0, 0, 7);
  ctx.fill();

  // rotor wash (sopro do rotor sobre o solo)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const wash = ctx.createRadialGradient(0,-2,4,0,-2,30);
  wash.addColorStop(0,'rgba(255,255,255,.10)');
  wash.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = wash;
  ctx.beginPath(); ctx.arc(0,-2,30,0,7); ctx.fill();
  ctx.restore();

  // flash do disparo (logo após atirar)
  if (player.cd >= 5) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    [-8, 8].forEach(dx => {
      const fg = ctx.createRadialGradient(dx,-22,0,dx,-22,9);
      fg.addColorStop(0,'rgba(255,240,160,.95)');
      fg.addColorStop(1,'rgba(255,170,30,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(dx,-22,9,0,7); ctx.fill();
    });
    ctx.restore();
  }

  // corpo HD assado: albedo no contexto local, normal no cvN (absoluto)
  if (SPR) {
    ctx.drawImage(SPR.heli.a, -SPR.heli.w/2, -SPR.heli.h/2);
    nx.save(); nx.translate(x, y);
    if (sc && sc !== 1) nx.scale(sc, sc);
    nx.drawImage(SPR.heli.n, -SPR.heli.w/2, -SPR.heli.h/2);
    nx.restore();
  }

  // rotor de cauda
  const ta = frame * 1.4;
  ctx.strokeStyle = '#cfcfcf';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 29 - Math.cos(ta)*7);
  ctx.lineTo(0, 29 + Math.cos(ta)*7);
  ctx.stroke();

  // rotor principal: disco translúcido + pás
  ctx.fillStyle = 'rgba(220,220,220,.10)';
  ctx.beginPath();
  ctx.arc(0, -4, 26, 0, 7);
  ctx.fill();
  const a = frame * 0.8;
  ctx.strokeStyle = 'rgba(235,235,235,.85)';
  ctx.lineWidth = 3;
  for (let k = 0; k < 2; k++) {
    const an = a + k * 1.57;
    ctx.beginPath();
    ctx.moveTo(Math.cos(an)*26, -4 + Math.sin(an)*26);
    ctx.lineTo(-Math.cos(an)*26, -4 - Math.sin(an)*26);
    ctx.stroke();
  }
  // cubo central do rotor
  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath();
  ctx.arc(0, -4, 3.5, 0, 7);
  ctx.fill();

  ctx.restore();
}

function drawEnemy(e) {
  ctx.save();
  ctx.translate(e.x, e.y);
  // sombra de contato
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.beginPath();
  ctx.ellipse(4, 5, e.w*0.55, e.h*0.5, 0, 0, 7);
  ctx.fill();
  ctx.fillStyle = e.col;
  const w = e.w, h = e.h;
  if (e.t === 'train') {
    // TREM DE GUERRA BLINDADO: locomotiva-cunha + vagões + canhão de topo
    const dir = e.vx >= 0 ? 1 : -1;          // sentido de marcha
    if (SPR) {
      const step = (w - 8) / e.cars;
      const blit = (spr, lx, fx) => {            // fx = espelho horizontal
        const dw = step*(spr.w/(spr.w-6)), dh = spr.h*(dw/spr.w);
        ctx.save(); ctx.translate(lx,0); ctx.scale(fx||1,1);
        ctx.drawImage(spr.a, -dw/2, -dh/2, dw, dh); ctx.restore();
        nx.save(); nx.translate(e.x+lx, e.y); nx.scale(fx||1,1);
        nx.drawImage(spr.n, -dw/2, -dh/2, dw, dh); nx.restore();
      };
      for (let i = 0; i < e.cars; i++) {
        const lx = -w/2 + step*(i+0.5);
        const isLoco = (dir > 0) ? (i === e.cars-1) : (i === 0);
        if (isLoco) blit(SPR.trainLoco, lx, dir);
        else        blit(SPR.trainCar, lx, 1);
      }
      // fumaça da locomotiva (FX vivo, aditivo) sobre a chaminé
      const lxL = dir>0 ? (w/2 - step*0.5) : (-w/2 + step*0.5);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const sf = ctx.createRadialGradient(lxL,-h,1,lxL,-h,13);
      sf.addColorStop(0,`rgba(70,70,70,${.30+.18*Math.sin(frame*0.3)})`);
      sf.addColorStop(1,'rgba(60,60,60,0)');
      ctx.fillStyle = sf;
      ctx.beginPath(); ctx.arc(lxL,-h,13,0,7); ctx.fill();
      ctx.restore();
      // canhão de topo girando, mirando o helicóptero
      const ang = Math.atan2(player.y - e.y, player.x - e.x);
      const G = SPR.trainGun, gs = (h*1.25)/G.h;
      const gw = G.w*gs, gh = G.h*gs;
      ctx.save(); ctx.rotate(ang);
      ctx.drawImage(G.a, -gw/2, -gh/2, gw, gh);
      ctx.restore();
      nx.save(); nx.translate(e.x, e.y); nx.rotate(ang);
      nx.drawImage(G.n, -gw/2, -gh/2, gw, gh);
      nx.restore();
    }
    ctx.restore();
    return;
  }
  if (e.t === 'tank') {
    // casco/esteiras assados (giram conforme a manobra até ±45°),
    // torre assada girando independente mirando o player
    const sc = w/30, hd = -(e.head || 0);
    const ang = Math.atan2(player.y - e.y, player.x - e.x);
    if (SPR) {
      const T=SPR.tank, U=SPR.turret;
      ctx.save(); ctx.rotate(hd);
      ctx.drawImage(T.a, -T.w/2*sc, -T.h/2*sc, T.w*sc, T.h*sc);
      ctx.restore();
      ctx.save(); ctx.rotate(ang);
      ctx.drawImage(U.a, -U.w/2*sc, -U.h/2*sc, U.w*sc, U.h*sc);
      ctx.restore();
      nx.save(); nx.translate(e.x, e.y); nx.rotate(hd);
      nx.drawImage(T.n, -T.w/2*sc, -T.h/2*sc, T.w*sc, T.h*sc);
      nx.restore();
      nx.save(); nx.translate(e.x, e.y); nx.rotate(ang);
      nx.drawImage(U.n, -U.w/2*sc, -U.h/2*sc, U.w*sc, U.h*sc);
      nx.restore();
    }
  } else if (e.t === 'ship') {
    // ---- canhoneira HD: proa segue o rio + torre giratória ----
    const rang = Math.atan2(
      riverCX(e.y-22) - riverCX(e.y+22), 44);   // tangente do rio
    if (SPR) {
      const Hs=SPR.shipHull, sc=w/46, dw=Hs.w*sc, dh=Hs.h*sc;
      ctx.save(); ctx.rotate(rang);
      ctx.fillStyle = 'rgba(220,240,255,.30)';  // espuma (FX vivo)
      ctx.beginPath();
      ctx.moveTo(-8,-h/2); ctx.quadraticCurveTo(0,-h/2-12,8,-h/2);
      ctx.fill();
      ctx.drawImage(Hs.a, -dw/2, -dh/2, dw, dh);
      // fumaça das chaminés (FX vivo, aditivo)
      ctx.globalCompositeOperation = 'lighter';
      const sm = ctx.createRadialGradient(0,-h*0.42,1,0,-h*0.42,12);
      sm.addColorStop(0,`rgba(80,80,80,${.26+.16*Math.sin(frame*0.25)})`);
      sm.addColorStop(1,'rgba(70,70,70,0)');
      ctx.fillStyle = sm;
      ctx.beginPath(); ctx.arc(0,-h*0.42,12,0,7); ctx.fill();
      ctx.restore();
      nx.save(); nx.translate(e.x,e.y); nx.rotate(rang);
      nx.drawImage(Hs.n, -dw/2, -dh/2, dw, dh); nx.restore();
      // torre principal (dupla) mirando o player, no convés de proa
      const sa = Math.atan2(player.y-e.y, player.x-e.x);
      const G=SPR.shipGun, gw=G.w*sc, gh=G.h*sc, oy=h*0.16;
      ctx.save(); ctx.translate(0,oy); ctx.rotate(sa);
      ctx.drawImage(G.a, -gw/2, -gh/2, gw, gh); ctx.restore();
      nx.save(); nx.translate(e.x,e.y+oy); nx.rotate(sa);
      nx.drawImage(G.n, -gw/2, -gh/2, gw, gh); nx.restore();
    }
  } else if (e.t === 'build') {
    // ---- bunker/fortim de concreto + canhão giratório (HD assado) ----
    if (SPR) {
      const B=SPR.bunker, sc=w/40, dw=B.w*sc, dh=B.h*sc;
      ctx.drawImage(B.a, -dw/2, -dh/2, dw, dh);
      nx.save(); nx.translate(e.x, e.y);
      nx.drawImage(B.n, -dw/2, -dh/2, dw, dh); nx.restore();
      // canhão antiaéreo mirando o player
      const ba = Math.atan2(player.y-e.y, player.x-e.x);
      const G=SPR.bunkerGun, gw=G.w*sc, gh=G.h*sc;
      ctx.save(); ctx.rotate(ba);
      ctx.drawImage(G.a, -gw/2, -gh/2, gw, gh);
      ctx.restore();
      nx.save(); nx.translate(e.x, e.y); nx.rotate(ba);
      nx.drawImage(G.n, -gw/2, -gh/2, gw, gh); nx.restore();
    }
    // luz de alerta piscando (FX vivo, aditivo)
    if (Math.floor(frame/15)%2) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const lg = ctx.createRadialGradient(0,0,0,0,0,7);
      lg.addColorStop(0,'rgba(255,210,90,.95)');
      lg.addColorStop(1,'rgba(255,150,40,0)');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(0,0,7,0,7); ctx.fill();
      ctx.restore();
    }
  } else if (e.t === 'boat') {
    // ---- lancha de patrulha HD (proa +y) + metralhadora ----
    const wob = Math.sin((e.y + scrollY) * 0.06) * 0.05;
    if (SPR) {
      const Hb=SPR.boatHull, sc=w/34, dw=Hb.w*sc, dh=Hb.h*sc;
      ctx.save(); ctx.rotate(wob);
      ctx.fillStyle = 'rgba(220,240,255,.32)';   // espuma (FX vivo)
      ctx.beginPath();
      ctx.moveTo(-7,-h/2); ctx.quadraticCurveTo(0,-h/2-14,7,-h/2);
      ctx.fill();
      ctx.drawImage(Hb.a, -dw/2, -dh/2, dw, dh);
      ctx.restore();
      nx.save(); nx.translate(e.x,e.y); nx.rotate(wob);
      nx.drawImage(Hb.n, -dw/2, -dh/2, dw, dh); nx.restore();
      const ba2 = Math.atan2(player.y-e.y, player.x-e.x);
      const G=SPR.navGun, gs=sc*0.62, gw=G.w*gs, gh=G.h*gs;
      ctx.save(); ctx.rotate(ba2);
      ctx.drawImage(G.a, -gw/2, -gh/2, gw, gh); ctx.restore();
      nx.save(); nx.translate(e.x,e.y); nx.rotate(ba2);
      nx.drawImage(G.n, -gw/2, -gh/2, gw, gh); nx.restore();
    }
  } else if (e.t === 'warship') {
    // ---- destróier stealth: 2 torres principais + 2 CIWS ----
    if (SPR) {
      const Hw=SPR.warHull, sc=w/54, dw=Hw.w*sc, dh=Hw.h*sc;
      ctx.fillStyle = 'rgba(220,240,255,.30)';   // espuma (FX vivo)
      ctx.beginPath();
      ctx.moveTo(-9,-h/2); ctx.quadraticCurveTo(0,-h/2-16,9,-h/2);
      ctx.fill();
      ctx.drawImage(Hw.a, -dw/2, -dh/2, dw, dh);
      nx.save(); nx.translate(e.x,e.y);
      nx.drawImage(Hw.n, -dw/2, -dh/2, dw, dh); nx.restore();
      const aim = oy => Math.atan2(player.y-(e.y+oy), player.x-e.x);
      const gun = (S,gs,oy) => {
        const a=aim(oy), gw=S.w*gs, gh=S.h*gs;
        ctx.save(); ctx.translate(0,oy); ctx.rotate(a);
        ctx.drawImage(S.a, -gw/2, -gh/2, gw, gh); ctx.restore();
        nx.save(); nx.translate(e.x, e.y+oy); nx.rotate(a);
        nx.drawImage(S.n, -gw/2, -gh/2, gw, gh); nx.restore();
      };
      // torres principais duplas (proa e popa) + 2 CIWS amidships
      gun(SPR.shipGun, sc*1.05,  h*0.22);
      gun(SPR.shipGun, sc*1.05, -h*0.34);
      gun(SPR.navGun,  sc*0.55, -h*0.10);
      gun(SPR.navGun,  sc*0.55,  h*0.02);
    }
  } else if (e.t === 'carrier') {
    // ---- porta-aviões HD: convés + ilha + 4 AA giratórios ----
    if (SPR) {
      const Hc=SPR.carrierHull, sc=w/86, dw=Hc.w*sc, dh=Hc.h*sc;
      ctx.fillStyle = 'rgba(220,240,255,.28)';   // espuma (FX vivo)
      ctx.beginPath();
      ctx.moveTo(-12,-h/2); ctx.quadraticCurveTo(0,-h/2-20,12,-h/2);
      ctx.fill();
      ctx.drawImage(Hc.a, -dw/2, -dh/2, dw, dh);
      nx.save(); nx.translate(e.x,e.y);
      nx.drawImage(Hc.n, -dw/2, -dh/2, dw, dh); nx.restore();
      // flash de catapulta ao lançar (FX vivo, aditivo)
      if (e.launchFx > 0) {
        ctx.save(); ctx.globalCompositeOperation='lighter';
        ctx.fillStyle = `rgba(255,230,170,${e.launchFx/14})`;
        ctx.beginPath();
        ctx.arc(0, h*0.30, 10+(10-e.launchFx)*1.5, 0, 7); ctx.fill();
        ctx.restore();
      }
      // 4 canhões AA nas quinas, mirando o player
      const G=SPR.navGun, gs=sc*0.7, gw=G.w*gs, gh=G.h*gs;
      [[-w*0.40,h*0.36],[w*0.40,h*0.36],
       [-w*0.40,-h*0.36],[w*0.40,-h*0.36]].forEach(([ox,oy])=>{
        const a = Math.atan2(player.y-(e.y+oy), player.x-(e.x+ox));
        ctx.save(); ctx.translate(ox,oy); ctx.rotate(a);
        ctx.drawImage(G.a, -gw/2, -gh/2, gw, gh); ctx.restore();
        nx.save(); nx.translate(e.x+ox, e.y+oy); nx.rotate(a);
        nx.drawImage(G.n, -gw/2, -gh/2, gw, gh); nx.restore();
      });
    }
  } else { // ---- caça a jato (nariz em +y) ----
    // chama do pós-combustor (FX vivo, atrás = -y) — 2 motores
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    [-2.2, 2.2].forEach(ox => {
      const fl = ctx.createLinearGradient(0,-h/2,0,-h/2-12);
      fl.addColorStop(0,`rgba(255,${200+Math.random()*55|0},90,.95)`);
      fl.addColorStop(.5,'rgba(255,140,40,.7)');
      fl.addColorStop(1,'rgba(255,90,20,0)');
      ctx.fillStyle = fl;
      ctx.beginPath();
      ctx.moveTo(ox-3,-h/2); ctx.lineTo(ox,-h/2-9-Math.random()*6);
      ctx.lineTo(ox+3,-h/2); ctx.closePath(); ctx.fill();
    });
    ctx.restore();
    // corpo HD assado (albedo local; normal no cvN absoluto)
    if (SPR) {
      const J = SPR.jet, scl = w/28, dw = J.w*scl, dh = J.h*scl;
      ctx.drawImage(J.a, -dw/2, -dh/2, dw, dh);
      nx.save(); nx.translate(e.x, e.y);
      nx.drawImage(J.n, -dw/2, -dh/2, dw, dh);
      nx.restore();
    }
  }
  ctx.restore();
}

function render() {
  // limpa o G-buffer de normais p/ "plano" (#8080ff = normal pra cima)
  nx.setTransform(1,0,0,1,0,0);
  nx.fillStyle = '#8080ff';
  nx.fillRect(0, 0, W, H);

  ctx.save();
  if (shake > 0.4)
    ctx.translate((Math.random()-.5)*shake, (Math.random()-.5)*shake);

  drawTerrain();

  // embarcações PRIMEIRO (ficam na água) — depois a ponte as cobre
  const onWater = e => isVessel(e.t);
  enemies.forEach(e => { if (onWater(e)) drawEnemy(e); });
  // pontes: só os barcos passam por baixo
  drawBridgesOver();

  // tiros do player (o glow vem do bloom WebGL — sem shadowBlur, que
  // era caríssimo por bala e causava engasgo com muitos canhões)
  bullets.forEach(b => {
    if (b.mis) {
      // míssil do player (aponta p/ cima) — chama em 2 tons sólidos
      const ff = 14 + (frame*7 + b.x|0) % 7;             // flicker barato
      ctx.fillStyle = 'rgba(255,150,30,.55)';
      ctx.beginPath();
      ctx.moveTo(b.x-3, b.y+4); ctx.lineTo(b.x, b.y+ff);
      ctx.lineTo(b.x+3, b.y+4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,225,90,.95)';
      ctx.beginPath();
      ctx.moveTo(b.x-2, b.y+4); ctx.lineTo(b.x, b.y+ff*0.6);
      ctx.lineTo(b.x+2, b.y+4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#9aa0a8';                       // corpo
      ctx.fillRect(b.x-3, b.y-4, 6, 12);
      ctx.fillStyle = '#d8362a';                       // ogiva
      ctx.beginPath();
      ctx.moveTo(b.x-3, b.y-4); ctx.lineTo(b.x, b.y-10);
      ctx.lineTo(b.x+3, b.y-4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6b7077';                       // aletas
      ctx.fillRect(b.x-5, b.y+3, 2, 5);
      ctx.fillRect(b.x+3, b.y+3, 2, 5);
      return;
    }
    ctx.fillStyle = b.side ? '#7fffe0' : '#fff2a0';
    ctx.fillRect(b.x-b.w/2, b.y-b.h/2, b.w, b.h);
    ctx.fillStyle = b.side ? '#2ad6c8' : '#ffb020';
    ctx.fillRect(b.x-b.w/2, b.y-b.h/2+b.h*0.55, b.w, b.h*0.45);
  });

  // demais inimigos por cima da ponte (passam por cima)
  enemies.forEach(e => { if (!onWater(e)) drawEnemy(e); });
  if (boss) drawBoss();

  powerups.forEach(u => {
    const pulse = 1 + Math.sin(frame*0.2)*0.12;
    ctx.save();
    ctx.translate(u.x, u.y); ctx.scale(pulse, pulse);
    ctx.shadowColor = u.col; ctx.shadowBlur = 14;
    ctx.fillStyle = '#0c1018';
    ctx.beginPath(); ctx.arc(0,0,14,0,7); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = u.col;
    ctx.beginPath(); ctx.arc(0,0,12,0,7); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = u.col;
    ctx.font = 'bold 11px Courier New';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(u.label, 0, 1);
    ctx.restore();
  });
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  eBullets.forEach(b => {
    ctx.save();
    if (b.missile) {
      // míssil vertical: corpo metálico, ogiva vermelha e chama
      ctx.shadowColor = '#ff8a1e'; ctx.shadowBlur = 12;
      // rastro de fogo (atrás = acima, pois desce)
      const fl = ctx.createLinearGradient(0, b.y-16, 0, b.y);
      fl.addColorStop(0, 'rgba(255,210,40,0)');
      fl.addColorStop(.6, 'rgba(255,150,30,.7)');
      fl.addColorStop(1, 'rgba(255,90,20,.9)');
      ctx.fillStyle = fl;
      ctx.beginPath();
      ctx.moveTo(b.x-3, b.y-4); ctx.lineTo(b.x, b.y-16-Math.random()*6);
      ctx.lineTo(b.x+3, b.y-4); ctx.closePath(); ctx.fill();
      // corpo
      ctx.fillStyle = '#9aa0a8';
      ctx.fillRect(b.x-3, b.y-8, 6, 12);
      // ogiva vermelha (aponta p/ baixo)
      ctx.fillStyle = '#d8362a';
      ctx.beginPath();
      ctx.moveTo(b.x-3, b.y+4); ctx.lineTo(b.x, b.y+10);
      ctx.lineTo(b.x+3, b.y+4); ctx.closePath(); ctx.fill();
      // aletas
      ctx.fillStyle = '#6b7077';
      ctx.fillRect(b.x-5, b.y-8, 2, 5);
      ctx.fillRect(b.x+3, b.y-8, 2, 5);
    } else {
      ctx.shadowColor = '#ff5a3c'; ctx.shadowBlur = 10;
      ctx.fillStyle = 'rgba(255,140,60,.55)';
      ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffd24d';
      ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, 7); ctx.fill();
    }
    ctx.restore();
  });

  // partículas com glow aditivo
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  parts.forEach(pt => {
    const a = Math.max(0, pt.life/40);
    ctx.globalAlpha = a;
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 2.4 + a*2.2, 0, 7);
    ctx.fill();
  });
  ctx.restore();
  ctx.globalAlpha = 1;

  // bomba sendo lançada (cai do heli, girando, com rastro)
  bombFx.forEach(b => {
    ctx.save();
    ctx.translate(b.x, b.y);
    // rastro de fumaça
    ctx.globalAlpha = .35;
    ctx.fillStyle = '#cfd8e0';
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(0, -b.vy * i * 1.6, 3.2 - i*0.6, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.rotate(b.rot);
    ctx.scale(0.7, 0.7);                    // -30% no tamanho da cápsula
    const rw = 6, rh = 13;                 // cápsula (raio horiz/vert)
    // corpo da cápsula (pílula arredondada)
    const grd = ctx.createLinearGradient(-rw, 0, rw, 0);
    grd.addColorStop(0,  '#2b313c');
    grd.addColorStop(.4, '#6b7686');
    grd.addColorStop(.55,'#9aa6b6');
    grd.addColorStop(1,  '#3a4250');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(-rw, -rh + rw);
    ctx.arc(0, -rh + rw, rw, Math.PI, 0);          // topo arredondado
    ctx.lineTo( rw,  rh - rw);
    ctx.arc(0,  rh - rw, rw, 0, Math.PI);          // base arredondada
    ctx.closePath();
    ctx.fill();
    // faixa central
    ctx.fillStyle = '#cf4030';
    ctx.fillRect(-rw, -2, rw * 2, 4);
    // janelinha/brilho
    ctx.fillStyle = 'rgba(220,235,255,.55)';
    ctx.beginPath();
    ctx.ellipse(-2, -rh + rw, 1.4, 3, 0, 0, 7);
    ctx.fill();
    // aletas na base
    ctx.fillStyle = '#222831';
    ctx.beginPath();
    ctx.moveTo(-rw+1, rh-3); ctx.lineTo(-rw-4, rh+4); ctx.lineTo(-1, rh+1);
    ctx.moveTo( rw-1, rh-3); ctx.lineTo( rw+4, rh+4); ctx.lineTo( 1, rh+1);
    ctx.fill();
    // luz de pavio piscando no topo
    if ((frame >> 2) & 1) {
      ctx.fillStyle = '#ff7a30';
      ctx.beginPath();
      ctx.arc(0, -rh, 2.2, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  });
  ctx.globalAlpha = 1;

  // ondas de choque da bomba
  if (shocks.length) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    shocks.forEach(sw => {
      const a = sw.life / sw.maxlife;          // 1 -> 0
      ctx.globalAlpha = a;
      ctx.lineWidth = sw.w * a + 1;
      ctx.strokeStyle = sw.color;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.r, 0, 7);
      ctx.stroke();
    });
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  if (state === 'play' || state === 'pause')
    drawHeli(player.x, player.y, invuln > 0 && player.takeoff <= 0, player.alt);

  ctx.restore(); // fim do shake

  // HUD inferior: bombas + armas
  ctx.font = '13px Courier New';
  ctx.fillStyle = '#ffcc00';
  ctx.fillText('BOMBAS ' + '◆'.repeat(bombs), 8, H - 12);
  ctx.fillStyle = '#ff5a3c';
  ctx.fillText('TIRO ' + 'I'.repeat(player.pwr||1), 8, H - 30);
  if (player.side) {
    ctx.fillStyle = '#3ca0ff';
    ctx.fillText('LAT ' + '<>'.repeat(player.side), 110, H - 30);
  }
  if (player.rapid) {
    ctx.fillStyle = '#5ff0d0';
    ctx.fillText('TURBO ' + '»'.repeat(player.rapid), 200, H - 30);
  }
  // fase + progresso até o chefe
  ctx.fillStyle = '#cfe0c0'; ctx.textAlign = 'right';
  ctx.fillText('FASE ' + stage, W - 8, H - 12);
  if (!boss && !bossPending) {
    const pr = 1 - Math.max(0, stageT) / STAGE_FRAMES;
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.fillRect(W-92, H-26, 84, 5);
    ctx.fillStyle = '#cfe0c0';
    ctx.fillRect(W-92, H-26, 84*pr, 5);
  }
  ctx.textAlign = 'left';

  // banner de fase/aviso
  if (banner && banner.t > 0) {
    const a = Math.max(0, Math.min(1, banner.t/40) * Math.min(1, (150-banner.t)/15));
    const danger = banner.txt === 'PERIGO';
    ctx.save();
    ctx.textAlign = 'center';
    if (danger) {
      // faixa de fundo VERMELHA piscando + texto BRANCO
      const blink = Math.floor(frame/6) % 2;
      ctx.globalAlpha = a * (0.55 + 0.45*blink);
      ctx.fillStyle = '#d11';
      ctx.fillRect(0, H/2 - 46, W, 92);
      ctx.fillStyle = '#7a0a0a';
      ctx.fillRect(0, H/2 - 46, W, 4);
      ctx.fillRect(0, H/2 + 42, W, 4);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 46px Courier New';
      ctx.fillText(banner.txt, W/2, H/2 - 4);
      ctx.font = 'bold 16px Courier New';
      ctx.fillText(banner.sub, W/2, H/2 + 24);
    } else {
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffcf3f';
      ctx.font = 'bold 44px Courier New';
      ctx.fillText(banner.txt, W/2, H/2 - 8);
      ctx.fillStyle = '#5ff0d0';
      ctx.font = 'bold 16px Courier New';
      ctx.fillText(banner.sub, W/2, H/2 + 20);
    }
    ctx.restore();
    ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }

  // painel de bônus de fim de fase
  if (state === 'bonus' && bonus) {
    const bn = bonus;
    ctx.save();
    // fundo escurecido
    ctx.fillStyle = 'rgba(2,6,12,.78)';
    ctx.fillRect(0, H*0.18, W, H*0.55);
    // moldura ciano
    ctx.strokeStyle = '#5ff0d0'; ctx.lineWidth = 2;
    ctx.strokeRect(8, H*0.18 + 4, W-16, H*0.55 - 8);
    // título
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffcf3f'; ctx.font = 'bold 26px Courier New';
    ctx.fillText('FASE ' + stage + ' COMPLETA', W/2, H*0.18 + 36);
    ctx.fillStyle = '#5ff0d0'; ctx.font = 'bold 13px Courier New';
    ctx.fillText('BÔNUS', W/2, H*0.18 + 58);
    // linhas: cada categoria, mostrando "concluído" quando step passou dela
    const rows = [
      ['VIDAS',      bn.lives,  2000, bn.livesPts,  'lives'],
      ['BOMBAS',     bn.bombs,  1000, bn.bombsPts,  'bombs'],
      ['CANHÃO',     bn.cannon, 1000, bn.cannonPts, 'cannon'],
    ];
    const order = ['lives','bombs','cannon','done'];
    const curIdx = order.indexOf(bn.step);
    ctx.font = 'bold 16px Courier New';
    rows.forEach((r, i) => {
      const [lbl, qty, unit, total, key] = r;
      const y = H*0.18 + 92 + i * 30;
      const idx = order.indexOf(key);
      const past = idx < curIdx;       // já contabilizada
      const cur  = idx === curIdx;     // contabilizando agora
      // dim/highlight
      ctx.globalAlpha = past ? 1 : (cur ? 1 : 0.45);
      ctx.fillStyle = '#cdd9e6';
      ctx.textAlign = 'left';
      ctx.fillText(lbl, 36, y);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#9fb3c8';
      ctx.fillText(qty + ' x ' + unit, W/2, y);
      ctx.textAlign = 'right';
      // valor restante dinâmico só pra categoria atual
      const shown = past ? total : (cur ? (total - bn.rem) : 0);
      ctx.fillStyle = cur ? '#ffcf3f' : '#dcdcdc';
      ctx.fillText('+' + shown, W - 36, y);
    });
    ctx.globalAlpha = 1;
    // observação para modo fácil
    if (gameMode === 'easy') {
      ctx.fillStyle = '#9fb3c8'; ctx.font = '11px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText('(canhão não contabiliza no modo fácil)',
        W/2, H*0.18 + 92 + 3*30 + 6);
    }
    // "CONTINUAR" pisca quando todo o bônus foi contado
    if (bn.done) {
      const blink = Math.floor(frame / 18) % 2 === 0;
      if (blink) {
        ctx.fillStyle = '#ffcf3f'; ctx.font = 'bold 18px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText('▶ CONTINUAR (ENTER)', W/2, H*0.18 + H*0.55 - 22);
      }
    }
    ctx.restore();
    ctx.textAlign = 'left';
  }

  // barra de vida do chefe
  if (boss && !boss.intro) {
    const bw = W - 60;
    ctx.fillStyle = '#400';
    ctx.fillRect(30, 32, bw, 10);
    ctx.fillStyle = '#e23';
    ctx.fillRect(30, 32, bw * Math.max(0, boss.hp/boss.maxhp), 10);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.strokeRect(30, 32, bw, 10);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('CHEFE — FASE ' + stage, W/2, 28);
    ctx.textAlign = 'left';
  }
}

function drawBossTank(b, W2, H2, hurt, gl) {
  ctx.fillStyle = 'rgba(0,0,0,.34)';
  ctx.beginPath(); ctx.ellipse(10, 10, W2+6, H2*0.96, 0, 0, 7); ctx.fill();

  const sc = b.w/128;
  // corpo HD assado
  if (SPR) {
    const B=SPR.bossTankBody, dw=B.w*sc, dh=B.h*sc;
    ctx.drawImage(B.a, -dw/2, -dh/2, dw, dh);
    nx.save(); nx.translate(b.x, b.y);
    nx.drawImage(B.n, -dw/2, -dh/2, dw, dh); nx.restore();
  }
  // links de esteira ANIMADOS (FX vivo) sobre a base assada
  const trW = 24*sc, txc = (W2 - 12)*sc;
  ctx.fillStyle = '#3a3d44';
  const ph = ((b.tread % 16)+16)%16;
  [-1,1].forEach(s => {
    const cx = s*txc;
    for (let y=-H2-16+ph; y<H2; y+=16)
      ctx.fillRect(cx-trW/2, y, trW, 7);
  });
  // escape do motor (traseira -y, ponto fraco) — FX vivo
  ctx.fillStyle = `rgba(255,${110+gl*120|0},40,${.5+gl*.4})`;
  for (let i=-1;i<2;i++) ctx.fillRect(-18*sc+i*15*sc, -H2+16*sc, 9*sc, 16*sc);
  if (hurt) { ctx.fillStyle=`rgba(40,40,40,${.25+gl*.2})`;
    ctx.beginPath(); ctx.arc(0,-H2+6,18+gl*7,0,7); ctx.fill(); }

  // torre + canhão duplo HD, girando p/ mirar o player
  const ang = Math.atan2(player.y-b.y, player.x-b.x);
  if (SPR) {
    const T=SPR.bossTankTurret, dw=T.w*sc, dh=T.h*sc;
    ctx.save(); ctx.rotate(ang);
    ctx.drawImage(T.a, -dw/2, -dh/2, dw, dh);
    ctx.restore();
    nx.save(); nx.translate(b.x, b.y); nx.rotate(ang);
    nx.drawImage(T.n, -dw/2, -dh/2, dw, dh); nx.restore();
  }
  // flash de dano: brilho vermelho radial (sem quadrado)
  if (hurt) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const r = Math.max(W2,H2)*1.15;
    const fg = ctx.createRadialGradient(0,0,r*0.4,0,0,r);
    fg.addColorStop(0,`rgba(255,70,45,${.26+gl*.26})`);
    fg.addColorStop(1,'rgba(255,40,30,0)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(0,0,r,0,7); ctx.fill();
    ctx.restore();
  }
}
function drawBossShip(b, W2, H2, hurt, gl) {
  const sc = b.w/120;
  // esteira de espuma na popa (FX vivo)
  ctx.fillStyle = 'rgba(220,240,255,.25)';
  ctx.beginPath(); ctx.moveTo(-16,-H2);
  ctx.quadraticCurveTo(0,-H2-24,16,-H2); ctx.fill();
  // casco HD assado
  if (SPR) {
    const Hs=SPR.bossShipHull, dw=Hs.w*sc, dh=Hs.h*sc;
    ctx.drawImage(Hs.a, -dw/2, -dh/2, dw, dh);
    nx.save(); nx.translate(b.x,b.y);
    nx.drawImage(Hs.n, -dw/2, -dh/2, dw, dh); nx.restore();
  }
  // fumaça das chaminés (FX vivo aditivo)
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  [[-3*sc,-18*sc],[3*sc,4*sc]].forEach(([ox,oy])=>{
    const s=ctx.createRadialGradient(ox,oy,1,ox,oy,16);
    s.addColorStop(0,`rgba(70,70,70,${.22+.14*Math.sin(frame*0.22)})`);
    s.addColorStop(1,'rgba(60,60,60,0)');
    ctx.fillStyle=s; ctx.beginPath(); ctx.arc(ox,oy,16,0,7); ctx.fill();
  });
  ctx.restore();
  if (hurt){ ctx.fillStyle=`rgba(40,40,40,${.3+gl*.2})`;
    ctx.beginPath(); ctx.arc(0,H2*0.5,16+gl*7,0,7); ctx.fill(); }
  // 3 torres de bateria principal giratórias mirando o player
  if (SPR) {
    const T=SPR.bossShipTurret, dw=T.w*sc, dh=T.h*sc;
    [H2*0.56, 0, -H2*0.5].forEach(oy=>{
      const a = Math.atan2(player.y-(b.y+oy), player.x-b.x);
      ctx.save(); ctx.translate(0,oy); ctx.rotate(a);
      ctx.drawImage(T.a, -dw/2, -dh/2, dw, dh); ctx.restore();
      nx.save(); nx.translate(b.x, b.y+oy); nx.rotate(a);
      nx.drawImage(T.n, -dw/2, -dh/2, dw, dh); nx.restore();
    });
  }
  // flash de dano: brilho vermelho radial (sem quadrado)
  if (hurt) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const r = Math.max(W2,H2)*1.1;
    const fg = ctx.createRadialGradient(0,0,r*0.4,0,0,r);
    fg.addColorStop(0,`rgba(255,70,45,${.24+gl*.24})`);
    fg.addColorStop(1,'rgba(255,40,30,0)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(0,0,r,0,7); ctx.fill();
    ctx.restore();
  }
}
function drawBoss() {
  const b = boss;
  const W2 = b.w/2, H2 = b.h/2;
  const hurt = b.hp < b.maxhp/2;
  const gl = .55 + Math.sin(frame*0.22)*.45;
  ctx.save();
  ctx.translate(b.x, b.y);

  if (b.kind === 'tank') { drawBossTank(b, W2, H2, hurt, gl); ctx.restore(); return; }
  if (b.kind === 'ship') { drawBossShip(b, W2, H2, hurt, gl); ctx.restore(); return; }

  // sombra projetada no chão (deslocada — está voando)
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath();
  ctx.ellipse(22, 26, W2*0.82, H2*0.7, 0, 0, 7); ctx.fill();

  // corpo do gunship inclina (banca) no strafe; o canhão é independente
  ctx.save();
  ctx.rotate(b.bank || 0);

  // ---- corpo HD assado (banca junto; normal no cvN) ----
  if (SPR) {
    const Bh=SPR.bossHeli, sc=b.w/154, dw=Bh.w*sc, dh=Bh.h*sc;
    ctx.drawImage(Bh.a, -dw/2, -dh/2, dw, dh);
    nx.save(); nx.translate(b.x, b.y); nx.rotate(b.bank||0);
    nx.drawImage(Bh.n, -dw/2, -dh/2, dw, dh); nx.restore();
  }
  // rotor de cauda (FX vivo)
  const ta = frame*1.3;
  ctx.strokeStyle = '#c8ccc4'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-6 - Math.cos(ta)*16, -H2-30);
  ctx.lineTo(-6 + Math.cos(ta)*16, -H2-30);
  ctx.stroke();
  // exaustão quente das turbinas (ponto fraco, FX vivo)
  ctx.fillStyle = `rgba(255,${110+gl*120|0},40,${.5+gl*.4})`;
  ctx.fillRect(-16, -H2+34, 12, 9);
  ctx.fillRect(4, -H2+34, 12, 9);
  if (hurt) {                                   // fumaça de dano
    ctx.fillStyle = `rgba(40,40,40,${.22+gl*.2})`;
    ctx.beginPath(); ctx.arc(0,-H2+18,15+gl*7,0,7); ctx.fill();
  }
  ctx.restore(); // fim do banking do corpo

  // ---- canhão de queixo no nariz, mirando o jogador ----
  const gy = H2*0.62;
  const ang = Math.atan2(player.y - b.y - gy, player.x - b.x);
  ctx.save();
  ctx.translate(0, gy);
  ctx.rotate(ang);
  ctx.fillStyle = '#1c2016';
  ctx.fillRect(0, -4, 26, 8);
  ctx.fillStyle = '#11130d';
  ctx.fillRect(22, -5, 7, 10);
  ctx.fillStyle = '#4a5439';
  ctx.beginPath(); ctx.arc(0,0,9,0,7); ctx.fill();
  ctx.restore();

  // ---- rotor principal (disco + 5 pás girando) ----
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const rw = ctx.createRadialGradient(0,0,10,0,0,W2+6);
  rw.addColorStop(0,'rgba(200,210,200,.05)');
  rw.addColorStop(1,'rgba(200,210,200,.14)');
  ctx.fillStyle = rw;
  ctx.beginPath(); ctx.arc(0,0,W2+6,0,7); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(225,228,222,.8)'; ctx.lineWidth = 4;
  for (let k = 0; k < 5; k++) {
    const an = b.rotor + k * (Math.PI*2/5);
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.lineTo(Math.cos(an)*(W2+6), Math.sin(an)*(W2+6));
    ctx.stroke();
  }
  ctx.fillStyle = '#23271b';
  ctx.beginPath(); ctx.arc(0,0,7,0,7); ctx.fill();

  // flash de dano: brilho vermelho radial sobre o corpo (sem quadrado)
  if (hurt) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = Math.max(W2, H2) * 1.15;
    const fg = ctx.createRadialGradient(0, 0, r*0.35, 0, 0, r);
    fg.addColorStop(0, `rgba(255,70,45,${.30+gl*.30})`);
    fg.addColorStop(1, 'rgba(255,40,30,0)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

/* ===== Pós-processamento WebGL: bloom real + CRT por shader ===== */
let present = () => {};                       // fallback (sem WebGL)
(function initGL(){
 try {
  const glc = $('gl');
  const gl  = glc.getContext('webgl', { alpha:false, antialias:false });
  if (!gl) { cv.style.display = 'block'; glc.style.display = 'none'; return; }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);

  const VERT = 'attribute vec2 p;varying vec2 uv;' +
    'void main(){uv=p*0.5+0.5;gl_Position=vec4(p,0.,1.);}';

  function prog(fs){
    const sh=(t,s)=>{const o=gl.createShader(t);gl.shaderSource(o,s);
      gl.compileShader(o);
      if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(o)); return o;};
    const p=gl.createProgram();
    gl.attachShader(p,sh(gl.VERTEX_SHADER,VERT));
    gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs));
    gl.bindAttribLocation(p,0,'p');
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  function target(w,h){
    const tx=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tx);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,
      gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const fb=gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,tx,0);
    return {tx,fb,w,h};
  }

  // textura que recebe o canvas 2D a cada frame
  const srcTex=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,srcTex);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);

  // textura do G-buffer de normais (mesma orientação do cv)
  const nrmTex=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,nrmTex);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);

  const bw=W>>1, bh=H>>1;                     // bloom em meia resolução
  const bright=target(bw,bh), blurA=target(bw,bh), blurB=target(bw,bh);
  const lit=target(W,H);                      // cena já iluminada (full-res)
  const MAXL=16;                              // máx. de luzes dinâmicas

  const pBright=prog(
    'precision mediump float;varying vec2 uv;uniform sampler2D t;'+
    'void main(){vec3 c=texture2D(t,uv).rgb;'+
    'float l=dot(c,vec3(.299,.587,.114));'+
    'float mx=max(c.r,max(c.g,c.b));'+
    'float mn=min(c.r,min(c.g,c.b));'+
    'float sat=mx-mn;'+                                // croma (gelo ~0)
    'float k=smoothstep(.56,.74,sat)'+                // só efeitos MUITO saturados
    '+smoothstep(.965,1.0,l)*0.6;'+                   // + branco-quente quase puro
    'gl_FragColor=vec4(c*k,1.);}');

  const pBlur=prog(
    'precision mediump float;varying vec2 uv;uniform sampler2D t;'+
    'uniform vec2 dir;'+
    'void main(){vec3 s=texture2D(t,uv).rgb*0.227027;'+
    'vec2 o1=dir*1.3846153846,o2=dir*3.2307692308;'+
    's+=(texture2D(t,uv+o1).rgb+texture2D(t,uv-o1).rgb)*0.3162162162;'+
    's+=(texture2D(t,uv+o2).rgb+texture2D(t,uv-o2).rgb)*0.0702702703;'+
    'gl_FragColor=vec4(s,1.);}');

  // ILUMINAÇÃO: sol direcional + especular + luzes dinâmicas, via normais
  const pLight=prog(
    'precision mediump float;varying vec2 uv;'+
    'uniform sampler2D src,nrm;uniform vec2 res;'+
    'uniform vec3 sun;uniform float amb;'+
    'uniform int ln;uniform vec3 lpos[16];uniform vec3 lcol[16];'+
    'void main(){vec3 al=texture2D(src,uv).rgb;'+
    'vec3 N=normalize(texture2D(nrm,uv).xyz*2.0-1.0);'+
    'float sd=max(dot(N,sun),0.0);'+
    'vec3 lite=vec3(amb)+vec3(1.05,1.0,0.9)*sd*0.85;'+
    'vec3 hv=normalize(sun+vec3(0.0,0.0,1.0));'+
    'lite+=vec3(1.0)*pow(max(dot(N,hv),0.0),24.0)*0.22;'+   // especular sol
    'vec2 px=vec2(uv.x*res.x,(1.0-uv.y)*res.y);'+
    'for(int i=0;i<16;i++){ if(i>=ln) break;'+
    'vec3 lp=lpos[i];vec2 d=lp.xy-px;float dd=length(d);'+
    'float at=clamp(1.0-dd/lp.z,0.0,1.0);at*=at;'+
    'vec3 ld=normalize(vec3(d,lp.z*0.55));'+
    'float df=max(dot(N,ld),0.0);'+
    'lite+=lcol[i]*(df*0.75+0.25)*at; }'+
    'vec3 c=al*lite;'+
    'float K=0.80, m=max(c.r,max(c.g,c.b));'+     // joelho no canal mais forte
    'float mk=(m<=K)?m:K+(1.0-K)*(1.0-exp(-(m-K)/(1.0-K)));'+
    'c*=(m>0.0001)?mk/m:1.0;'+                     // escala uniforme: matiz/sat intactos
    'gl_FragColor=vec4(c,1.0);}');

  const pFinal=prog(
    'precision mediump float;varying vec2 uv;'+
    'uniform sampler2D scn;uniform sampler2D blm;'+
    'uniform vec2 res;uniform float time;'+
    'void main(){vec2 c=uv;'+                         // tela PLANA (sem curvatura)
    'vec3 col=texture2D(scn,c).rgb+texture2D(blm,c).rgb*0.6;'+
    'vec2 vg=c*(1.-c.yx);'+                            // vinheta leve
    'col*=clamp(pow(vg.x*vg.y*60.0,0.12),0.,1.);'+
    'gl_FragColor=vec4(col,1.);}');

  const uLsrc=gl.getUniformLocation(pLight,'src');
  const uLnrm=gl.getUniformLocation(pLight,'nrm');
  const uLres=gl.getUniformLocation(pLight,'res');
  const uLsun=gl.getUniformLocation(pLight,'sun');
  const uLamb=gl.getUniformLocation(pLight,'amb');
  const uLln =gl.getUniformLocation(pLight,'ln');
  const uLpos=gl.getUniformLocation(pLight,'lpos[0]');
  const uLcol=gl.getUniformLocation(pLight,'lcol[0]');
  const lPos=new Float32Array(MAXL*3), lCol=new Float32Array(MAXL*3);
  // sol: vindo de cima-esquerda, voltado ao observador (espaço y p/ baixo)
  const SUN=(()=>{ let x=-0.42,y=-0.46,z=0.78;
    const m=Math.hypot(x,y,z); return [x/m,y/m,z/m]; })();

  const uBrT=gl.getUniformLocation(pBright,'t');
  const uBlT=gl.getUniformLocation(pBlur,'t');
  const uBlD=gl.getUniformLocation(pBlur,'dir');
  const uFnS=gl.getUniformLocation(pFinal,'scn');
  const uFnB=gl.getUniformLocation(pFinal,'blm');
  const uFnR=gl.getUniformLocation(pFinal,'res');
  const uFnTi=gl.getUniformLocation(pFinal,'time');

  function pass(p,into){
    if(into){ gl.bindFramebuffer(gl.FRAMEBUFFER,into.fb);
      gl.viewport(0,0,into.w,into.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      gl.viewport(0,0,glc.width,glc.height); }
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER,quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }

  function resize(){
    const r=glc.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1,2);
    glc.width =Math.max(1,Math.round((r.width ||W)*dpr));
    glc.height=Math.max(1,Math.round((r.height||H)*dpr));
  }
  addEventListener('resize',resize); resize();

  present=function(){
    if(!glc.width) resize();
    // 1. canvas 2D (albedo) e G-buffer de normais -> texturas
    gl.bindTexture(gl.TEXTURE_2D,srcTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,cv);
    gl.bindTexture(gl.TEXTURE_2D,nrmTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,cvN);

    // 2. ILUMINAÇÃO: sol + luzes dinâmicas usando as normais -> lit
    const Ls=collectLights(); const n=Math.min(Ls.length,MAXL);
    for(let i=0;i<n;i++){ const a=Ls[i];
      lPos[i*3]=a[0]; lPos[i*3+1]=a[1]; lPos[i*3+2]=a[2];
      lCol[i*3]=a[3]*a[6]; lCol[i*3+1]=a[4]*a[6]; lCol[i*3+2]=a[5]*a[6]; }
    gl.useProgram(pLight);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,srcTex);
    gl.uniform1i(uLsrc,0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,nrmTex);
    gl.uniform1i(uLnrm,1);
    gl.uniform2f(uLres,W,H);
    gl.uniform3f(uLsun,SUN[0],SUN[1],SUN[2]);
    gl.uniform1f(uLamb,0.42);
    gl.uniform1i(uLln,n);
    gl.uniform3fv(uLpos,lPos); gl.uniform3fv(uLcol,lCol);
    pass(pLight,lit);
    gl.activeTexture(gl.TEXTURE0);

    // 3. bright-pass (a partir da cena iluminada)
    gl.useProgram(pBright);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,lit.tx);
    gl.uniform1i(uBrT,0); pass(pBright,bright);
    // 3. blur gaussiano separável (2 passadas p/ glow largo)
    gl.useProgram(pBlur); gl.uniform1i(uBlT,0);
    gl.bindTexture(gl.TEXTURE_2D,bright.tx);
    gl.uniform2f(uBlD,1/bw,0);     pass(pBlur,blurA);
    gl.bindTexture(gl.TEXTURE_2D,blurA.tx);
    gl.uniform2f(uBlD,0,1/bh);     pass(pBlur,blurB);
    gl.bindTexture(gl.TEXTURE_2D,blurB.tx);
    gl.uniform2f(uBlD,2/bw,0);     pass(pBlur,blurA);
    gl.bindTexture(gl.TEXTURE_2D,blurA.tx);
    gl.uniform2f(uBlD,0,2/bh);     pass(pBlur,blurB);
    // 4. composição final: cena iluminada + bloom + vinheta
    gl.useProgram(pFinal);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,lit.tx);
    gl.uniform1i(uFnS,0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,blurB.tx);
    gl.uniform1i(uFnB,1);
    gl.uniform2f(uFnR,glc.width,glc.height);
    gl.uniform1f(uFnTi,frame);
    pass(pFinal,null);
    gl.activeTexture(gl.TEXTURE0);
  };
 } catch(e){
  console.error('WebGL desativado:',e);
  cv.style.display='block'; const g=$('gl'); if(g) g.style.display='none';
  present=()=>{};
 }
})();

// --- timestep fixo: lógica sempre a 60 Hz, render no refresh do monitor ---
const STEP = 1000 / 60;            // 16,67 ms por passo de simulação
const MAX_STEPS = 5;               // teto p/ evitar "espiral da morte"
let _acc = 0, _last = performance.now();
function loop(now) {
  if (now === undefined) now = performance.now();
  try {
    let dt = now - _last;
    _last = now;
    if (dt > 250) dt = STEP;       // aba ficou em 2º plano: não acumula
    _acc += dt;
    let steps = 0;
    while (_acc >= STEP && steps < MAX_STEPS) {
      if (state === 'play') update();
      else if (state === 'bonus') updateBonus();
      _acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) _acc = 0;   // descarta atraso excedente
    render();
    present();
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(loop);
}
buildSprites();
reset();
loop();

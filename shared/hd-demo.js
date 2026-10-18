/*
 * hd-demo.js : UI for the hard-disk gas demos. Depends on harddisks.js (window.HD).
 *
 * <body data-hd="temperature">  : trace = temperature vs time (kicks show up as steps)
 * <body data-hd="count">        : trace = number of atoms in the left half vs time
 *
 * Physical scale: argon-like atoms (m = 39.948 u, hard-disk diameter 0.34 nm) with T = 300 K at the start.
 *   temperature unit = 300 K, speed unit sqrt(kT/m) = 250 m/s, time unit = diameter / speed = 1.36 ps.
 */
(function () {
  'use strict';

  var MODE = document.body.getAttribute('data-hd') === 'count' ? 'count' : 'temperature';
  var W = 28, H = 18.5;                       // box size in atom diameters (same aspect as the original canvas)
  var T_UNIT = 300, V_UNIT = 250, PS = 1.36;  // K, m/s, ps
  var SETTLE = 60;                            // ignore the first 60 time units (~80 ps) in the count statistics
  var WINDOW = 120;                           // trace window, in time units (~163 ps)
  var SAMPLE = 0.1;                           // trace sampling interval, time units
  var BASE_DT = 0.05;                         // simulation time advanced per 60 Hz frame at speed 1
  var REF_LINE = 'rgba(220, 38, 38, 0.6)', REF_LINE_W = 5;   // same heavy red line as the liquid-structure demo

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  var q = new URLSearchParams(window.location.search);
  function num(key, lo, hi, def) { var v = parseFloat(q.get(key)); return isFinite(v) ? clamp(v, lo, hi) : def; }

  var sys = new HD.HardDisks({ w: W, h: H, n: Math.round(num('n', 10, 150, 60)) });
  var kickDv = num('kick', 0.5, 8, 4);
  var speed = num('speed', 0.25, 3, 1);
  var paused = false;

  var theme = {};
  function readTheme() {
    var cs = getComputedStyle(document.documentElement);
    ['ink', 'muted', 'grid', 'accent', 'canvas', 'line'].forEach(function (k) { theme[k] = cs.getPropertyValue('--' + k).trim(); });
  }

  // particle colours by kinetic energy: blue (slow) -> yellow -> orange -> red (fast), like the original demo
  var STOPS = [[58, 110, 165], [42, 157, 143], [233, 196, 60], [244, 140, 60], [214, 40, 57]];
  var LUT = [];
  (function () {
    for (var k = 0; k < 128; k++) {
      var t = k / 127 * (STOPS.length - 1), i = Math.min(Math.floor(t), STOPS.length - 2), f = t - i, c = [];
      for (var j = 0; j < 3; j++) c.push(Math.round(STOPS[i][j] + (STOPS[i + 1][j] - STOPS[i][j]) * f));
      LUT.push('rgb(' + c.join(',') + ')');
    }
  })();
  var E_FULL = 6;                              // kinetic energy (in units of k_B T0) mapped to the red end

  /* ------------------------------------------------------------ state */
  var boxCv = $('box'), trCv = $('trace');
  var bctx = boxCv.getContext('2d'), tctx = trCv.getContext('2d');
  var dpr = 1, boxW = 560, boxH = 370, trW = 500, trH = 320;
  var ts = [], vs = [];                        // trace samples
  var kicks = [];                              // {t, dT}
  var flashes = [];                            // {x, y, born}
  var nextSample = 0, kickCount = 0, lastKickMsg = '';
  var yMax = 500, frameNo = 0;

  function sampleValue() { return MODE === 'count' ? sys.countLeft() : sys.temperature() * T_UNIT; }
  function pushSample() { ts.push(sys.t); vs.push(sampleValue()); nextSample = sys.t + SAMPLE; }
  function restart() {
    sys.reset();
    ts.length = 0; vs.length = 0; kicks.length = 0; flashes.length = 0; kickCount = 0; lastKickMsg = '';
    pushSample();
  }

  /* ------------------------------------------------------------ sizing */
  function sizeCanvases() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    boxW = Math.max(240, Math.floor(boxCv.parentElement.clientWidth));
    boxH = Math.round(boxW * H / W);
    boxCv.style.height = boxH + 'px';
    boxCv.width = Math.round(boxW * dpr); boxCv.height = Math.round(boxH * dpr);
    trW = Math.max(240, Math.floor(trCv.parentElement.clientWidth));
    trH = clamp(Math.round(trW * 0.66), 230, 360);
    trCv.style.height = trH + 'px';
    trCv.width = Math.round(trW * dpr); trCv.height = Math.round(trH * dpr);
  }

  /* ------------------------------------------------------------ drawing: box */
  function drawBox() {
    var ctx = bctx, sc = boxW / W, i;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, boxW, boxH);
    if (MODE === 'count') {
      ctx.fillStyle = theme.accent; ctx.globalAlpha = 0.07; ctx.fillRect(0, 0, boxW / 2, boxH); ctx.globalAlpha = 1;
      ctx.strokeStyle = theme.muted; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(boxW / 2, 0); ctx.lineTo(boxW / 2, boxH); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = theme.muted; ctx.font = '600 12px system-ui, sans-serif'; ctx.textBaseline = 'top';
      ctx.textAlign = 'left'; ctx.fillText('LEFT HALF', 8, 7);
      ctx.textAlign = 'right'; ctx.fillText('RIGHT HALF', boxW - 8, 7);
    }
    var rad = 0.5 * sc;
    for (i = 0; i < sys.n; i++) {
      var e = 0.5 * (sys.vx[i] * sys.vx[i] + sys.vy[i] * sys.vy[i]) / sys.T0;
      ctx.fillStyle = LUT[clamp((e / E_FULL * 127) | 0, 0, 127)];
      ctx.beginPath(); ctx.arc(sys.x[i] * sc, sys.y[i] * sc, rad, 0, 6.2832); ctx.fill();
    }
    // brief expanding ring where you clicked
    var now = performance.now();
    for (i = flashes.length - 1; i >= 0; i--) {
      var age = now - flashes[i].born;
      if (age > 450) { flashes.splice(i, 1); continue; }
      ctx.strokeStyle = REF_LINE; ctx.lineWidth = REF_LINE_W * (1 - age / 450) + 1;
      ctx.beginPath(); ctx.arc(flashes[i].x * sc, flashes[i].y * sc, (0.7 + age / 450 * 2.2) * sc, 0, 6.2832); ctx.stroke();
    }
  }

  /* ------------------------------------------------------------ drawing: trace */
  var M = { l: 54, r: 14, t: 16, b: 40 };
  function niceMax(v) {
    var e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
    return (f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 4 ? 4 : f <= 5 ? 5 : f <= 6 ? 6 : f <= 8 ? 8 : 10) * e;
  }
  function tickStep(max) {
    var raw = max / 5, e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
  }

  function drawTrace() {
    var ctx = tctx, pw = trW - M.l - M.r, ph = trH - M.t - M.b, i, v;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, trW, trH);

    var t1 = Math.max(sys.t, WINDOW), t0 = t1 - WINDOW;
    // y scale
    var target;
    if (MODE === 'count') target = sys.n;
    else {
      var mx = 0; for (i = 0; i < vs.length; i++) if (vs[i] > mx) mx = vs[i];
      target = niceMax(Math.max(450, mx * 1.2));
    }
    yMax += (target - yMax) * (MODE === 'count' ? 1 : 0.12);
    function X(t) { return M.l + (t - t0) / WINDOW * pw; }
    function Y(val) { return M.t + ph - val / yMax * ph; }

    ctx.font = '12px system-ui, sans-serif'; ctx.lineWidth = 1;
    // horizontal grid + labels
    var step = tickStep(yMax);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (v = 0; v <= yMax + 1e-9; v += step) {
      var yy = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = theme.grid; ctx.beginPath(); ctx.moveTo(M.l, yy); ctx.lineTo(M.l + pw, yy); ctx.stroke();
      ctx.fillStyle = theme.muted; ctx.fillText(+v.toFixed(2) + '', M.l - 6, yy);
    }
    // vertical grid: time in ps
    var psA = t0 * PS, psB = t1 * PS, ps, pstep = [10, 20, 25, 50, 100, 200].filter(function (s) { return (psB - psA) / s <= 7; })[0] || 200;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (ps = Math.ceil(psA / pstep) * pstep; ps <= psB + 1e-9; ps += pstep) {
      var xx = Math.round(X(ps / PS)) + 0.5;
      ctx.strokeStyle = theme.grid; ctx.beginPath(); ctx.moveTo(xx, M.t); ctx.lineTo(xx, M.t + ph); ctx.stroke();
      ctx.fillStyle = theme.muted; ctx.fillText(Math.round(ps) + '', xx, M.t + ph + 5);
    }
    ctx.fillStyle = theme.ink;
    ctx.fillText('time (ps)', M.l + pw / 2, trH - 16);
    ctx.save(); ctx.translate(13, M.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle';
    ctx.fillText(MODE === 'count' ? 'atoms in the left half' : 'temperature (K)', 0, 0);
    ctx.restore();

    ctx.save();
    ctx.beginPath(); ctx.rect(M.l, M.t - 2, pw, ph + 4); ctx.clip();
    if (MODE === 'count') {
      ctx.setLineDash([6, 4]); ctx.strokeStyle = theme.muted; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(M.l, Y(sys.n / 2)); ctx.lineTo(M.l + pw, Y(sys.n / 2)); ctx.stroke(); ctx.setLineDash([]);
    }
    // kick markers (heavy translucent red, same style as the reference line in the liquid-structure demo)
    ctx.strokeStyle = REF_LINE; ctx.lineWidth = REF_LINE_W;
    for (i = 0; i < kicks.length; i++) {
      var kx = X(kicks[i].t);
      if (kx < M.l - 5) continue;
      ctx.beginPath(); ctx.moveTo(kx, M.t); ctx.lineTo(kx, M.t + ph); ctx.stroke();
    }
    // the trace itself
    ctx.strokeStyle = theme.ink; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.beginPath();
    var started = false;
    for (i = 0; i < ts.length; i++) {
      if (ts[i] < t0 - SAMPLE) continue;
      var px = X(ts[i]), py = Y(vs[i]);
      if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
    }
    ctx.stroke();
    ctx.restore();

    // legend
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = '11.5px system-ui, sans-serif';
    var items = [[REF_LINE, REF_LINE_W, [], 'kick (mouse click)']];
    if (MODE === 'count') items.push([theme.muted, 1.2, [6, 4], 'equal split, N/2']);
    items.forEach(function (it, k) {
      var yy = M.t + 11 + k * 16, tw = tctx.measureText(it[3]).width, xr = M.l + pw - 8;
      ctx.fillStyle = theme.muted; ctx.fillText(it[3], xr, yy);
      ctx.strokeStyle = it[0]; ctx.lineWidth = it[1]; ctx.setLineDash(it[2]);
      ctx.beginPath(); ctx.moveTo(xr - tw - 30, yy); ctx.lineTo(xr - tw - 8, yy); ctx.stroke(); ctx.setLineDash([]);
    });
  }

  /* ------------------------------------------------------------ readout + stats */
  var lastReadout = '';
  function fmt(v, d) { return v.toFixed(d); }
  function windowStats() {
    var t0 = Math.max(SETTLE, sys.t - WINDOW), s = 0, s2 = 0, c = 0;
    for (var i = 0; i < ts.length; i++) if (ts[i] >= t0) { s += vs[i]; s2 += vs[i] * vs[i]; c++; }
    if (c < 100) return null;                       // still settling
    var m = s / c; return { mean: m, sd: Math.sqrt(Math.max(0, s2 / c - m * m)) };
  }
  function updateReadout() {
    var html;
    if (MODE === 'count') {
      var L = sys.countLeft();
      html = '<span class="big">' + L + '</span> of ' + sys.n + ' atoms are in the left half (' + fmt(100 * L / sys.n, 0) + '%). An equal split would be ' + fmt(sys.n / 2, 0) + '.';
    } else {
      html = lastKickMsg || '<span style="color:var(--muted)">Click an atom to give it a kick.</span>';
    }
    if (html !== lastReadout) { $('readout').innerHTML = html; lastReadout = html; }
  }
  function updateStats() {
    if (MODE === 'count') {
      var ws = windowStats();
      $('st-a').textContent = sys.countLeft() + ' / ' + sys.n;
      $('st-b').textContent = ws ? fmt(ws.mean, 1) + '  (equal split: ' + fmt(sys.n / 2, 1) + ')' : 'settling…';
      $('st-c').textContent = ws ? '± ' + fmt(ws.sd, 1) + '  (√N / 2 = ' + fmt(Math.sqrt(sys.n) / 2, 1) + ')' : 'settling…';
      $('st-d').textContent = String(kickCount);
    } else {
      var T = sys.temperature();
      $('st-a').textContent = fmt(T * T_UNIT, 0) + ' K';
      $('st-b').textContent = fmt(Math.sqrt(2 * T) * V_UNIT, 0) + ' m/s';
      $('st-c').textContent = String(kickCount);
      $('st-d').textContent = String(sys.n);
    }
  }

  /* ------------------------------------------------------------ controls */
  function syncControls() {
    $('n').value = sys.n; $('n-out').textContent = sys.n;
    $('kick').value = kickDv; $('kick-out').textContent = '+' + kickDv.toFixed(1) + ' v₀';
    $('speed').value = speed; $('speed-out').textContent = speed.toFixed(2) + '×';
  }
  $('n').addEventListener('input', function (e) { sys.setN(+e.target.value); $('n-out').textContent = sys.n; restart(); });
  $('kick').addEventListener('input', function (e) { kickDv = +e.target.value; $('kick-out').textContent = '+' + kickDv.toFixed(1) + ' v₀'; });
  $('speed').addEventListener('input', function (e) { speed = +e.target.value; $('speed-out').textContent = speed.toFixed(2) + '×'; });
  $('pause').addEventListener('click', function () { paused = !paused; $('pause').textContent = paused ? 'Resume' : 'Pause'; });
  $('reset').addEventListener('click', restart);

  /* ------------------------------------------------------------ pointer: click an atom to kick it */
  var hitOnDown = false;
  function simPoint(e) {
    var rc = boxCv.getBoundingClientRect();
    return { x: (e.clientX - rc.left) / rc.width * W, y: (e.clientY - rc.top) / rc.height * H };
  }
  function nearest(p, maxd) {
    var best = -1, bd = maxd * maxd;
    for (var i = 0; i < sys.n; i++) {
      var dx = sys.x[i] - p.x, dy = sys.y[i] - p.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  boxCv.addEventListener('pointerdown', function (e) {
    var i = nearest(simPoint(e), e.pointerType === 'touch' ? 1.6 : 0.65);
    hitOnDown = i >= 0;
    if (i < 0) return;
    var before = sys.temperature(), vBefore = sys.speed(i);
    pushSample();                                   // so the trace shows a clean vertical step
    sys.kick(i, kickDv);
    kickCount++;
    kicks.push({ t: sys.t });
    flashes.push({ x: sys.x[i], y: sys.y[i], born: performance.now() });
    pushSample();
    if (MODE === 'temperature') {
      lastKickMsg = 'Kick! The atom was moving at <span class="big">' + fmt(vBefore * V_UNIT, 0) + ' m/s</span> and now moves at <span class="big">' +
        fmt(sys.speed(i) * V_UNIT, 0) + ' m/s</span>. Temperature rose by <span class="big">' + fmt((sys.temperature() - before) * T_UNIT, 0) + ' K</span>.';
    }
  });
  boxCv.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    boxCv.style.cursor = nearest(simPoint(e), 0.65) >= 0 ? 'pointer' : 'default';
  });
  // only block page scrolling when a touch actually lands on an atom
  boxCv.addEventListener('touchstart', function (e) { if (hitOnDown) e.preventDefault(); }, { passive: false });

  /* ------------------------------------------------------------ main loop */
  var last = performance.now();
  function frame(now) {
    window.requestAnimationFrame(frame);
    var ms = Math.min(now - last, 50); last = now;
    if (document.hidden) return;
    frameNo++;
    if (!paused) {
      sys.advance(BASE_DT * speed * ms / 16.667);
      if (sys.t >= nextSample) pushSample();
      var cut = sys.t - WINDOW - 2;
      while (ts.length > 2 && ts[1] < cut) { ts.shift(); vs.shift(); }
      while (kicks.length && kicks[0].t < cut) kicks.shift();
    }
    drawBox(); drawTrace(); updateReadout();
    if (frameNo % 6 === 0) updateStats();
  }

  /* ------------------------------------------------------------ start */
  readTheme();
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', readTheme);
  }
  sizeCanvases(); syncControls(); restart();
  window.addEventListener('resize', sizeCanvases);
  if (window.ResizeObserver) new ResizeObserver(sizeCanvases).observe(boxCv.parentElement);
  window.requestAnimationFrame(frame);
})();

/*
 * Time-reversal demo. Depends on ../../shared/harddisks.js (window.HD).
 *
 * The simulation advances in fixed steps of DT. "Reverse time" flips every velocity (v -> -v) and flips the
 * direction `dir` of the simulation clock, so the integer step counter k (t = k * DT) counts down while
 * `elapsed` (the horizontal axis of the plots) keeps counting up.
 *
 * Physical scale: argon-like atoms (m = 39.948 u, hard-disk diameter 0.34 nm), speed unit 250 m/s, time unit 1.36 ps.
 */
(function () {
  'use strict';

  var W = 28, H = 18.5;                 // box in atom diameters
  var PS = 1.36, V_UNIT = 250;          // ps per time unit, m/s per speed unit
  var DT = 0.05;                        // physics step (time units)
  var V0 = 1.5;                         // initial speed of every atom (to the right)
  var WINDOW = 150;                     // plot window in elapsed time units (~200 ps)
  var SAMPLE_EVERY = 2;                 // plot a point every 2 steps
  var REF_LINE = 'rgba(220, 38, 38, 0.6)', REF_LINE_W = 5;   // same heavy red line as in the other demos
  var COL_R = '#3a6ea5', COL_L = '#e07a2f';
  // entropy cells
  var NXC = 8, NYC = 5, NV = 10, VMIN = -5.25, VW = 1.0;   // bin edges offset so v = 0 and v = ±1.5 sit mid-bin (no flicker from rounding)

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  var q = new URLSearchParams(window.location.search);
  function num(key, lo, hi, def) { var v = parseFloat(q.get(key)); return isFinite(v) ? clamp(v, lo, hi) : def; }

  var N = Math.round(num('n', 20, 100, 40));
  var digits = Math.round(num('digits', 3, 16, 16));
  var speed = num('speed', 0.25, 4, 2);
  var sys = new HD.HardDisks({ w: W, h: H, n: N });
  var paused = false, pauseAtZero = true, showGhost = true;

  var theme = {};
  function readTheme() {
    var cs = getComputedStyle(document.documentElement);
    ['ink', 'muted', 'grid', 'accent', 'canvas', 'ideal'].forEach(function (k) { theme[k] = cs.getPropertyValue('--' + k).trim(); });
  }

  /* ------------------------------------------------------------ state */
  var boxCv = $('box'), trCv = $('trace');
  var bctx = boxCv.getContext('2d'), tctx = trCv.getContext('2d');
  var dpr = 1, boxW = 560, boxH = 370, trW = 500, trH = 400;
  var k = 0, dir = 1, elapsed = 0, stepCount = 0, acc = 0;
  var el = [], sS = [], sP = [], sV = [], sT = [];      // plot samples: elapsed, entropy (total, position, velocity), t
  var marks = [];                                      // elapsed times at which time was reversed
  var lastReturn = null, returnMsg = '';
  var yMaxS = 8, yLoT = -10, yHiT = 10, frameNo = 0;

  /* ------------------------------------------------------------ entropy */
  var pc = new Float64Array(NXC * NYC), vc = new Float64Array(NV * NV);
  function entropy() {
    var n = sys.n, i;
    pc.fill(0); vc.fill(0);
    for (i = 0; i < n; i++) {
      var cx = clamp(Math.floor(sys.x[i] / W * NXC), 0, NXC - 1), cy = clamp(Math.floor(sys.y[i] / H * NYC), 0, NYC - 1);
      pc[cy * NXC + cx]++;
      var a = clamp(Math.floor((sys.vx[i] - VMIN) / VW), 0, NV - 1), b = clamp(Math.floor((sys.vy[i] - VMIN) / VW), 0, NV - 1);
      vc[b * NV + a]++;
    }
    var sp = 0, sv = 0, c;
    for (i = 0; i < pc.length; i++) { c = pc[i]; if (c) sp -= (c / n) * Math.log(c / n); }
    for (i = 0; i < vc.length; i++) { c = vc[i]; if (c) sv -= (c / n) * Math.log(c / n); }
    return [sp + sv, sp, sv];
  }

  function pushSample() {
    var e = entropy();
    el.push(elapsed); sS.push(e[0]); sP.push(e[1]); sV.push(e[2]); sT.push(k * DT * PS);
  }

  /* ------------------------------------------------------------ control of the run */
  function restart() {
    sys.initBeam(V0, Math.min(Math.max(6, N * 0.15), W * 0.8));
    if (digits < 16) { sys.quantize(digits); sys.saveInitial(); }
    k = 0; dir = 1; elapsed = 0; stepCount = 0; acc = 0; paused = false;
    el.length = sS.length = sP.length = sV.length = sT.length = 0; marks.length = 0;
    lastReturn = null; returnMsg = '';
    $('pause').textContent = 'Pause';
    pushSample();
  }

  function fmtErr(e) { return e < 0.01 ? e.toExponential(1) : e.toFixed(2); }

  function onReturn() {
    var err = sys.rmsFromInitial(), ok = err < 0.05;
    lastReturn = { err: err, ok: ok };
    if (ok) {
      returnMsg = 'Back at <b>t = 0</b>, and every atom is inside its dashed ring: the starting arrangement is recovered to within <b>' + fmtErr(err) +
        ' σ</b>. (The arrows now point the other way.) Press Resume to carry on past <var>t</var> = 0.';
    } else {
      returnMsg = 'Back at <b>t = 0</b> but the atoms are <b>not</b> back at the start: rms error <b>' + fmtErr(err) +
        ' σ</b>. Rounding errors were magnified by chaotic collisions until the reversed motion stopped retracing the original.';
    }
    pushSample();
    if (pauseAtZero) { paused = true; $('pause').textContent = 'Resume'; }
  }

  function stepOnce() {
    sys.advance(DT);
    if (digits < 16) sys.quantize(digits);
    k += dir; elapsed += DT; stepCount++;
    if (stepCount % SAMPLE_EVERY === 0) pushSample();
    if (k === 0) onReturn();
  }

  function reverse() {
    pushSample();
    sys.reverseVelocities();
    dir = -dir;
    marks.push(elapsed);
    returnMsg = '';
    paused = false; $('pause').textContent = 'Pause';
  }

  /* ------------------------------------------------------------ sizing */
  function sizeCanvases() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    boxW = Math.max(240, Math.floor(boxCv.parentElement.clientWidth));
    boxH = Math.round(boxW * H / W);
    boxCv.style.height = boxH + 'px';
    boxCv.width = Math.round(boxW * dpr); boxCv.height = Math.round(boxH * dpr);
    trW = Math.max(240, Math.floor(trCv.parentElement.clientWidth));
    trH = clamp(Math.round(trW * 0.86), 320, 460);
    trCv.style.height = trH + 'px';
    trCv.width = Math.round(trW * dpr); trCv.height = Math.round(trH * dpr);
  }

  /* ------------------------------------------------------------ drawing: box */
  function drawBox() {
    var ctx = bctx, sc = boxW / W, i, rad = 0.5 * sc;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, boxW, boxH);
    if (showGhost) {
      ctx.strokeStyle = theme.muted; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.globalAlpha = 0.8;
      for (i = 0; i < sys.n; i++) { ctx.beginPath(); ctx.arc(sys.x0[i] * sc, sys.y0[i] * sc, rad, 0, 6.2832); ctx.stroke(); }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    for (i = 0; i < sys.n; i++) {
      var px = sys.x[i] * sc, py = sys.y[i] * sc;
      ctx.fillStyle = sys.vx[i] >= 0 ? COL_R : COL_L;
      ctx.beginPath(); ctx.arc(px, py, rad, 0, 6.2832); ctx.fill();
      // velocity arrow
      ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + sys.vx[i] * 0.4 * sc, py + sys.vy[i] * 0.4 * sc); ctx.stroke();
    }
  }

  /* ------------------------------------------------------------ drawing: plots */
  function niceMax(v) {
    var e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
    return (f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 4 ? 4 : f <= 5 ? 5 : f <= 6 ? 6 : f <= 8 ? 8 : 10) * e;
  }
  function tickStep(span) {
    var raw = span / 4, e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
  }

  function drawTrace() {
    var ctx = tctx, L = 58, R = 14, T1 = 14, GAP = 22, BOT = 42;
    var avail = trH - T1 - GAP - BOT, h1 = Math.round(avail * 0.62), h2 = avail - h1;
    var y1 = T1, y2 = T1 + h1 + GAP, pw = trW - L - R, i, v;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, trW, trH);

    var t1 = Math.max(elapsed, WINDOW), t0 = t1 - WINDOW;
    function X(e) { return L + (e - t0) / WINDOW * pw; }

    // visible extents -> smooth y ranges
    var mS = 0, tLo = 0, tHi = 0;
    for (i = 0; i < el.length; i++) {
      if (el[i] < t0 - 1) continue;
      if (sS[i] > mS) mS = sS[i];
      if (sT[i] < tLo) tLo = sT[i];
      if (sT[i] > tHi) tHi = sT[i];
    }
    yMaxS += (niceMax(Math.max(7, mS * 1.1)) - yMaxS) * 0.15;
    yLoT += (Math.min(-10, tLo * 1.15) - yLoT) * 0.15;
    yHiT += (Math.max(10, tHi * 1.15) - yHiT) * 0.15;
    function Y1(val) { return y1 + h1 - val / yMaxS * h1; }
    function Y2(val) { return y2 + h2 - (val - yLoT) / (yHiT - yLoT) * h2; }

    ctx.font = '12px system-ui, sans-serif'; ctx.lineWidth = 1;
    // y grids
    var step = tickStep(yMaxS);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (v = 0; v <= yMaxS + 1e-9; v += step) {
      var yy = Math.round(Y1(v)) + 0.5;
      ctx.strokeStyle = theme.grid; ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(L + pw, yy); ctx.stroke();
      ctx.fillStyle = theme.muted; ctx.fillText(+v.toFixed(2) + '', L - 6, yy);
    }
    var step2 = tickStep(yHiT - yLoT);
    for (v = Math.ceil(yLoT / step2) * step2; v <= yHiT + 1e-9; v += step2) {
      var y3 = Math.round(Y2(v)) + 0.5;
      ctx.strokeStyle = theme.grid; ctx.beginPath(); ctx.moveTo(L, y3); ctx.lineTo(L + pw, y3); ctx.stroke();
      ctx.fillStyle = theme.muted; ctx.fillText(Math.round(v) + '', L - 6, y3);
    }
    // x grid (elapsed time in ps) through both panels
    var psA = t0 * PS, psB = t1 * PS, ps, pstep = [10, 20, 25, 50, 100, 200].filter(function (s) { return (psB - psA) / s <= 7; })[0] || 200;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (ps = Math.ceil(psA / pstep) * pstep; ps <= psB + 1e-9; ps += pstep) {
      var xx = Math.round(X(ps / PS)) + 0.5;
      ctx.strokeStyle = theme.grid;
      ctx.beginPath(); ctx.moveTo(xx, y1); ctx.lineTo(xx, y1 + h1); ctx.moveTo(xx, y2); ctx.lineTo(xx, y2 + h2); ctx.stroke();
      ctx.fillStyle = theme.muted; ctx.fillText(Math.round(ps) + '', xx, y2 + h2 + 5);
    }
    ctx.fillStyle = theme.ink;
    ctx.fillText('elapsed time (ps), always runs forward', L + pw / 2, trH - 16);
    ctx.save(); ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.translate(13, y1 + h1 / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('entropy per atom (k_B)', 0, 0); ctx.restore();
    ctx.save(); ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.translate(13, y2 + h2 / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('simulation time t (ps)', 0, 0); ctx.restore();

    function clipTo(top, h, fn) { ctx.save(); ctx.beginPath(); ctx.rect(L, top - 2, pw, h + 4); ctx.clip(); fn(); ctx.restore(); }
    function line(arr, Y, color, width) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.beginPath();
      var started = false;
      for (var j = 0; j < el.length; j++) {
        if (el[j] < t0 - 1) continue;
        var px = X(el[j]), py = Y(arr[j]);
        if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
      }
      ctx.stroke();
    }
    function reversalBars(top, h) {
      ctx.strokeStyle = REF_LINE; ctx.lineWidth = REF_LINE_W;
      for (var j = 0; j < marks.length; j++) {
        var mx = X(marks[j]);
        if (mx < L - 5) continue;
        ctx.beginPath(); ctx.moveTo(mx, top); ctx.lineTo(mx, top + h); ctx.stroke();
      }
    }

    // top panel: entropy
    clipTo(y1, h1, function () {
      reversalBars(y1, h1);
      line(sP, Y1, theme.accent, 1.3);
      line(sV, Y1, theme.ideal, 1.3);
      line(sS, Y1, theme.ink, 2.4);
    });
    // bottom panel: simulation time
    clipTo(y2, h2, function () {
      ctx.setLineDash([6, 4]); ctx.strokeStyle = theme.muted; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(L, Y2(0)); ctx.lineTo(L + pw, Y2(0)); ctx.stroke(); ctx.setLineDash([]);
      reversalBars(y2, h2);
      line(sT, Y2, theme.ink, 2.4);
    });

    // legend (top-left of the entropy panel, where the curve starts low)
    var items = [[theme.ink, 2.4, 'total'], [theme.accent, 1.3, 'positions'], [theme.ideal, 1.3, 'velocities'], [REF_LINE, REF_LINE_W, 'time reversed']];
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '11.5px system-ui, sans-serif';
    items.forEach(function (it, n) {
      var ly = y1 + 11 + n * 15, lx = L + 8;
      ctx.strokeStyle = it[0]; ctx.lineWidth = it[1];
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 20, ly); ctx.stroke();
      ctx.fillStyle = theme.muted; ctx.fillText(it[2], lx + 26, ly);
    });
  }

  /* ------------------------------------------------------------ readout + stats */
  var lastReadout = '';
  function updateReadout() {
    var html;
    if (returnMsg && paused && k === 0) html = returnMsg;
    else if (elapsed === 0) html = 'The atoms start in a strip on the left, all moving right. Press <b>Reverse time</b> whenever you like.';
    else if (dir * k < 0) html = 'The clock is heading back toward <var>t</var> = 0: the atoms are <b>retracing their paths</b> and the entropy falls.';
    else if (!marks.length) html = 'Running forward. Watch the entropy, then press <b>Reverse time</b>.';
    else html = 'The clock is moving <b>away from</b> <var>t</var> = 0 again, now toward ' + (k < 0 ? 'negative' : 'positive') + ' <var>t</var>. The atoms are spreading out and the entropy rises, in <em>both</em> time directions.';
    if (html !== lastReadout) { $('readout').innerHTML = html; lastReadout = html; }
    $('dir-hint').textContent = dir > 0 ? 'time runs →' : '← time runs backwards';
  }
  function updateStats() {
    var t = k * DT * PS, s = sS[sS.length - 1];
    $('st-t').textContent = (t >= 0 ? '+' : '−') + Math.abs(t).toFixed(1) + ' ps  ' + (dir > 0 ? '(forward)' : '(backward)');
    $('st-s').textContent = (s !== undefined ? s.toFixed(2) : '–');
    $('st-d').textContent = sys.rmsFromInitial().toFixed(2) + ' σ';
    $('st-r').textContent = lastReturn ? (lastReturn.ok ? 'recovered, error ' + fmtErr(lastReturn.err) + ' σ' : 'NOT recovered, error ' + fmtErr(lastReturn.err) + ' σ') : '–';
  }

  /* ------------------------------------------------------------ controls */
  function precisionText() { return digits >= 16 ? 'double (no extra rounding)' : digits + ' decimal places'; }
  function syncControls() {
    $('n').value = N; $('n-out').textContent = N;
    $('digits').value = digits; $('digits-out').textContent = precisionText();
    $('speed').value = speed; $('speed-out').textContent = speed.toFixed(2) + '×';
  }
  $('n').addEventListener('input', function (e) { N = +e.target.value; $('n-out').textContent = N; sys.setN(N); restart(); });
  $('digits').addEventListener('input', function (e) { digits = +e.target.value; $('digits-out').textContent = precisionText(); });
  $('speed').addEventListener('input', function (e) { speed = +e.target.value; $('speed-out').textContent = speed.toFixed(2) + '×'; });
  $('reverse').addEventListener('click', reverse);
  $('pause').addEventListener('click', function () { paused = !paused; $('pause').textContent = paused ? 'Resume' : 'Pause'; });
  $('reset').addEventListener('click', restart);
  $('pause0').addEventListener('change', function (e) { pauseAtZero = e.target.checked; });
  $('ghost').addEventListener('change', function (e) { showGhost = e.target.checked; });

  /* ------------------------------------------------------------ main loop */
  var last = performance.now();
  function frame(now) {
    window.requestAnimationFrame(frame);
    var ms = Math.min(now - last, 50); last = now;
    if (document.hidden) return;
    frameNo++;
    if (!paused) {
      acc += speed * ms / 16.667;
      var guard = 0;
      while (acc >= 1 && !paused && guard++ < 16) { stepOnce(); acc -= 1; }
      if (paused) acc = 0;
    }
    drawBox(); drawTrace(); updateReadout();
    if (frameNo % 5 === 0) updateStats();
  }

  /* ------------------------------------------------------------ start */
  readTheme();
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', readTheme);
  }
  sizeCanvases(); syncControls(); restart(); updateStats();
  window.addEventListener('resize', sizeCanvases);
  if (window.ResizeObserver) new ResizeObserver(sizeCanvases).observe(boxCv.parentElement);
  window.requestAnimationFrame(frame);
})();

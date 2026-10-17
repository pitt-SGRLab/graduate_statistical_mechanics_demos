/*
 * md.js : a tiny 2D molecular dynamics engine for teaching liquid structure.
 *
 * Reduced Lennard-Jones units: sigma = 1, epsilon = 1, mass = 1, k_B = 1.
 *   - Model "lj"  : full Lennard-Jones, truncated at 2.5 sigma
 *   - Model "wca" : purely repulsive (Weeks-Chandler-Andersen) -> "soft hard disks"
 * Periodic boundaries, velocity-Verlet integration, Berendsen thermostat.
 *
 * No dependencies. Works in the browser (window.MD) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  var NX = 20, NY = 16;            // triangular-lattice start: 20 columns x 16 rows
  var N = NX * NY;                 // 320 particles
  var SQ3 = Math.sqrt(3);
  var RMAX = 5.0;                  // largest distance used in g(r)
  var GBINS = 100;                 // g(r) bins of width 0.05 sigma
  var CBINS = 50;                  // single-particle count bins of width 0.1 sigma
  var FMAX = 400;                  // force cap: guards against blow-ups after violent edits

  function randn() {
    var u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function System() {
    this.n = N;
    this.x = new Float64Array(N); this.y = new Float64Array(N);
    this.vx = new Float64Array(N); this.vy = new Float64Array(N);
    this.fx = new Float64Array(N); this.fy = new Float64Array(N);
    this.dt = 0.005;
    this.tau = 0.2;               // thermostat coupling time
    this.model = 'lj';
    this.rc2 = 6.25;
    this.T0 = 0.55;               // target temperature
    this.rho = 0.75;              // current density
    this.rhoTarget = 0.75;        // density the box is relaxing toward
    this.lx = 1; this.ly = 1;
    this.pe = 0;
    // histogram scratch space
    this.gHist = new Float64Array(GBINS);
    this.cHist = new Int32Array(CBINS);
    this.setModel('lj');
    this.initLattice(0.75, 0.55);
  }

  System.prototype.setModel = function (m) {
    this.model = m;
    this.rc2 = (m === 'wca') ? Math.pow(2, 1 / 3) : 6.25;
  };

  System.prototype.boxFor = function (rho) {
    var a = Math.sqrt(2 / (SQ3 * rho));
    return [NX * a, NY * a * SQ3 / 2, a];
  };

  /** Place particles on a perfect triangular lattice at density rho; Maxwell velocities at T. */
  System.prototype.initLattice = function (rho, T) {
    var b = this.boxFor(rho), a = b[2];
    this.lx = b[0]; this.ly = b[1];
    this.rho = this.rhoTarget = rho;
    this.T0 = T;
    var k = 0;
    for (var j = 0; j < NY; j++) {
      for (var i = 0; i < NX; i++) {
        this.x[k] = (i + 0.5 * (j & 1) + 0.25) * a;
        this.y[k] = (j + 0.5) * a * SQ3 / 2;
        k++;
      }
    }
    var sd = Math.sqrt(T), mx = 0, my = 0, q;
    for (q = 0; q < N; q++) { this.vx[q] = sd * randn(); this.vy[q] = sd * randn(); mx += this.vx[q]; my += this.vy[q]; }
    mx /= N; my /= N;
    for (q = 0; q < N; q++) { this.vx[q] -= mx; this.vy[q] -= my; }
    this.rescaleTo(T);
    this.computeForces();
  };

  System.prototype.kineticEnergy = function () {
    var s = 0;
    for (var i = 0; i < N; i++) s += this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i];
    return 0.5 * s;
  };
  /** Instantaneous temperature, T = KE / N  (2 degrees of freedom per particle, k_B = 1). */
  System.prototype.temperature = function () { return this.kineticEnergy() / (N - 1); };

  System.prototype.rescaleTo = function (T) {
    var cur = this.temperature();
    if (cur <= 0) return;
    var s = Math.sqrt(T / cur);
    for (var i = 0; i < N; i++) { this.vx[i] *= s; this.vy[i] *= s; }
  };

  System.prototype.computeForces = function () {
    var n = N, x = this.x, y = this.y, fx = this.fx, fy = this.fy;
    var lx = this.lx, ly = this.ly, hx = lx / 2, hy = ly / 2;
    var rc2 = this.rc2, rc = Math.sqrt(rc2), wca = this.model === 'wca';
    var pe = 0, i, j;
    for (i = 0; i < n; i++) { fx[i] = 0; fy[i] = 0; }
    for (i = 0; i < n - 1; i++) {
      var xi = x[i], yi = y[i], fxi = 0, fyi = 0;
      for (j = i + 1; j < n; j++) {
        var dx = xi - x[j];
        if (dx > hx) dx -= lx; else if (dx < -hx) dx += lx;
        if (dx > rc || dx < -rc) continue;
        var dy = yi - y[j];
        if (dy > hy) dy -= ly; else if (dy < -hy) dy += ly;
        if (dy > rc || dy < -rc) continue;
        var r2 = dx * dx + dy * dy;
        if (r2 >= rc2) continue;
        if (r2 < 0.04) r2 = 0.04;
        var i2 = 1 / r2, i6 = i2 * i2 * i2;
        var ff = 24 * i2 * i6 * (2 * i6 - 1);          // F/r
        pe += 4 * i6 * (i6 - 1) + (wca ? 1 : 0);
        var f2 = ff * ff * r2;
        if (f2 > FMAX * FMAX) ff *= FMAX / Math.sqrt(f2);
        fxi += ff * dx; fyi += ff * dy;
        fx[j] -= ff * dx; fy[j] -= ff * dy;
      }
      fx[i] += fxi; fy[i] += fyi;
    }
    this.pe = pe;
  };

  /** One velocity-Verlet step followed by weak-coupling (Berendsen) thermostat. */
  System.prototype.step = function () {
    var n = N, dt = this.dt, h = 0.5 * dt, i;
    var x = this.x, y = this.y, vx = this.vx, vy = this.vy, fx = this.fx, fy = this.fy;
    var lx = this.lx, ly = this.ly;
    for (i = 0; i < n; i++) {
      vx[i] += h * fx[i]; vy[i] += h * fy[i];
      var xi = x[i] + dt * vx[i], yi = y[i] + dt * vy[i];
      if (xi < 0) xi += lx; else if (xi >= lx) xi -= lx;
      if (yi < 0) yi += ly; else if (yi >= ly) yi -= ly;
      x[i] = xi; y[i] = yi;
    }
    this.computeForces();
    for (i = 0; i < n; i++) { vx[i] += h * fx[i]; vy[i] += h * fy[i]; }
    var T = this.temperature();
    if (T > 1e-9) {
      var lam = Math.sqrt(1 + (dt / this.tau) * (this.T0 / T - 1));
      if (lam > 1.1) lam = 1.1; else if (lam < 0.9) lam = 0.9;
      for (i = 0; i < n; i++) { vx[i] *= lam; vy[i] *= lam; }
    }
  };

  /**
   * Gently move the density toward rhoTarget by rescaling the box (and all positions).
   * Returns true while the box is still changing.
   */
  System.prototype.relaxDensity = function () {
    var ratio = this.rhoTarget / this.rho;
    if (Math.abs(ratio - 1) < 1e-4) {
      if (this.rho !== this.rhoTarget) { this.rho = this.rhoTarget; }
      return false;
    }
    var maxStep = 1.006;
    if (ratio > maxStep) ratio = maxStep; else if (ratio < 1 / maxStep) ratio = 1 / maxStep;
    var s = 1 / Math.sqrt(ratio);                    // length scale factor
    for (var i = 0; i < N; i++) { this.x[i] *= s; this.y[i] *= s; }
    this.lx *= s; this.ly *= s; this.rho *= ratio;
    return true;
  };

  /** Minimum-image displacement from particle i to particle j -> writes into out[0], out[1]. */
  System.prototype.minImage = function (i, j, out) {
    var dx = this.x[j] - this.x[i], dy = this.y[j] - this.y[i];
    if (dx > this.lx / 2) dx -= this.lx; else if (dx < -this.lx / 2) dx += this.lx;
    if (dy > this.ly / 2) dy -= this.ly; else if (dy < -this.ly / 2) dy += this.ly;
    out[0] = dx; out[1] = dy;
  };

  /**
   * Instantaneous g(r) from all pairs, in GBINS bins of width RMAX/GBINS.
   * g = (pair count)*2 / (N * rho * ring area): ratio of actual to ideal-gas neighbour count.
   */
  System.prototype.snapshotG = function (out) {
    var n = N, x = this.x, y = this.y, lx = this.lx, ly = this.ly, hx = lx / 2, hy = ly / 2;
    var cnt = this.gHist, i, j, b;
    for (b = 0; b < GBINS; b++) cnt[b] = 0;
    var r2max = RMAX * RMAX, inv = GBINS / RMAX;
    for (i = 0; i < n - 1; i++) {
      var xi = x[i], yi = y[i];
      for (j = i + 1; j < n; j++) {
        var dx = xi - x[j];
        if (dx > hx) dx -= lx; else if (dx < -hx) dx += lx;
        if (dx > RMAX || dx < -RMAX) continue;
        var dy = yi - y[j];
        if (dy > hy) dy -= ly; else if (dy < -hy) dy += ly;
        if (dy > RMAX || dy < -RMAX) continue;
        var r2 = dx * dx + dy * dy;
        if (r2 >= r2max) continue;
        cnt[(Math.sqrt(r2) * inv) | 0]++;
      }
    }
    var dr = RMAX / GBINS, rho = N / (lx * ly);
    for (b = 0; b < GBINS; b++) {
      var r1 = b * dr, r2_ = r1 + dr;
      out[b] = 2 * cnt[b] / (N * rho * Math.PI * (r2_ * r2_ - r1 * r1));
    }
  };

  /** Neighbour counts around particle i in CBINS bins of width RMAX/CBINS. */
  System.prototype.countsAround = function (i, out) {
    var b, tmp = [0, 0];
    for (b = 0; b < CBINS; b++) out[b] = 0;
    var inv = CBINS / RMAX;
    for (var j = 0; j < N; j++) {
      if (j === i) continue;
      this.minImage(i, j, tmp);
      var r = Math.sqrt(tmp[0] * tmp[0] + tmp[1] * tmp[1]);
      if (r < RMAX) out[(r * inv) | 0]++;
    }
  };

  var api = { System: System, N: N, NX: NX, NY: NY, RMAX: RMAX, GBINS: GBINS, CBINS: CBINS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MD = api;
})(typeof window !== 'undefined' ? window : this);

/**
 * Tiny ridge regression (no external ML deps). Used for global / ride-specific wait-time models.
 */

function matVec(A, v) {
  const n = A.length;
  const m = A[0].length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) out[i] += A[i][j] * v[j];
  }
  return out;
}

function transpose(A) {
  const n = A.length;
  const m = A[0].length;
  const T = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) T[j][i] = A[i][j];
  return T;
}

function matMul(A, B) {
  const n = A.length;
  const k = A[0].length;
  const m = B[0].length;
  const C = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let t = 0; t < k; t++) s += A[i][t] * B[t][j];
      C[i][j] = s;
    }
  }
  return C;
}

/** Gaussian elimination for square system (small d). */
function solveLinear(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) continue;
    [M[col], M[piv]] = [M[piv], M[col]];
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    const d = M[i][i];
    x[i] = Math.abs(d) < 1e-12 ? 0 : s / d;
  }
  return x;
}

/**
 * @param {number[][]} Xraw - rows of raw features (no intercept)
 * @param {number[]} y
 * @param {number} lambda
 */
function fitRidge(Xraw, y, lambda = 2) {
  const n = Xraw.length;
  if (n < 5) throw new Error('Not enough rows for ridge fit');
  const d = Xraw[0].length;
  const means = new Array(d).fill(0);
  for (let j = 0; j < d; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Xraw[i][j];
    means[j] = s / n;
  }
  const stds = new Array(d).fill(1);
  for (let j = 0; j < d; j++) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const t = Xraw[i][j] - means[j];
      v += t * t;
    }
    const sd = Math.sqrt(v / Math.max(1, n - 1)) || 1;
    stds[j] = sd < 1e-6 ? 1 : sd;
  }
  const X = Xraw.map((row) => [1, ...row.map((v, j) => (v - means[j]) / stds[j])]);
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const dim = XtX.length;
  for (let i = 0; i < dim; i++) XtX[i][i] += lambda;
  const Xty = new Array(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    let s = 0;
    for (let r = 0; r < n; r++) s += X[r][i] * y[r];
    Xty[i] = s;
  }
  const weights = solveLinear(XtX.map((row) => [...row]), Xty);
  return { means, stds, weights, featureDim: d };
}

function predictRidge(fit, xRaw) {
  const z = [1, ...xRaw.map((v, j) => (v - fit.means[j]) / fit.stds[j])];
  let p = 0;
  for (let i = 0; i < z.length; i++) p += fit.weights[i] * z[i];
  return p;
}

function maeRmse(yTrue, yPred) {
  let ae = 0;
  let se = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const d = yTrue[i] - yPred[i];
    ae += Math.abs(d);
    se += d * d;
  }
  const n = yTrue.length;
  return { mae: ae / n, rmse: Math.sqrt(se / n) };
}

function featureImportanceFromWeights(fit, featureNames) {
  const w = fit.weights.slice(1);
  const abs = w.map((v) => Math.abs(v));
  const sum = abs.reduce((a, b) => a + b, 0) || 1;
  const out = {};
  for (let i = 0; i < featureNames.length; i++) {
    out[featureNames[i]] = abs[i] / sum;
  }
  return out;
}

module.exports = {
  fitRidge,
  predictRidge,
  maeRmse,
  featureImportanceFromWeights,
};

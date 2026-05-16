/**
 * FEATURE_STORE Phase 2 — tree ensembles + small MLP on z-scored snapshot matrices.
 * Pure JS (no extra npm deps). Intended for modest p and n (ride studio caps ~8k rows).
 */
/* eslint-disable max-lines -- single module for matrix prep + trainers + predict */

function solveLinearSystemAugmented(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i += 1) {
    let maxRow = i;
    for (let k = i + 1; k < n; k += 1) {
      if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
    }
    [M[i], M[maxRow]] = [M[maxRow], M[i]];
    const piv = M[i][i];
    if (Math.abs(piv) < 1e-14) continue;
    for (let j = i; j <= n; j += 1) M[i][j] /= piv;
    for (let k = 0; k < n; k += 1) {
      if (k === i) continue;
      const c = M[k][i];
      for (let j = i; j <= n; j += 1) M[k][j] -= c * M[i][j];
    }
  }
  const x = Array(n).fill(0);
  for (let i = 0; i < n; i += 1) x[i] = M[i][n];
  return x;
}

function fitRidgeOLS(Z, y, ridge = 1e-6) {
  const n = Z.length;
  const p1 = Z[0].length;
  const ZtZ = Array.from({ length: p1 }, () => Array(p1).fill(0));
  const Zty = Array(p1).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < p1; j += 1) {
      Zty[j] += Z[i][j] * y[i];
      for (let k = 0; k < p1; k += 1) {
        ZtZ[j][k] += Z[i][j] * Z[i][k];
      }
    }
  }
  for (let i = 0; i < p1; i += 1) ZtZ[i][i] += ridge;
  return solveLinearSystemAugmented(ZtZ, Zty);
}

function buildDesignRowFromFeatures(features, featureKeys, normalization) {
  const zrow = [1];
  for (const k of featureKeys) {
    const raw = features[k];
    const m = normalization[k].mean;
    const s = normalization[k].std;
    zrow.push((raw - m) / s);
  }
  return zrow;
}

function rowToZvec(features, featureKeys, normalization) {
  return featureKeys.map((k) => {
    const raw = features[k];
    const m = normalization[k].mean;
    const s = normalization[k].std;
    return (raw - m) / s;
  });
}

function maeRmseR2(actual, predicted) {
  const n = actual.length;
  if (!n) return { mae: null, rmse: null, r2: null };
  let sumAbs = 0;
  let sumSq = 0;
  const meanY = actual.reduce((a, b) => a + b, 0) / n;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i += 1) {
    const d = predicted[i] - actual[i];
    sumAbs += Math.abs(d);
    sumSq += d * d;
    ssTot += (actual[i] - meanY) ** 2;
    ssRes += (actual[i] - predicted[i]) ** 2;
  }
  const mae = sumAbs / n;
  const rmse = Math.sqrt(sumSq / n);
  const r2 = ssTot > 1e-9 ? 1 - ssRes / ssTot : null;
  return {
    mae: Number(mae.toFixed(4)),
    rmse: Number(rmse.toFixed(4)),
    r2: r2 != null ? Number(r2.toFixed(4)) : null,
  };
}

function mean(y) {
  return y.reduce((a, b) => a + b, 0) / y.length;
}

function sseDeviance(y) {
  if (!y.length) return 0;
  const m = mean(y);
  return y.reduce((s, v) => s + (v - m) ** 2, 0);
}

function shuffleOrder(n, rng) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function bootstrapIndices(n, rng) {
  const o = [];
  for (let i = 0; i < n; i += 1) o.push(Math.floor(rng() * n));
  return o;
}

/** Best axis split on subsampled threshold candidates (regression MSE). */
function findBestSplit(X, y, featOrder, minLeaf, maxSplitCandidates, rng) {
  const n = X.length;
  const p = X[0].length;
  if (n < 2 * minLeaf) return null;

  let bestGain = -Infinity;
  let best = null;

  for (const j of featOrder) {
    const vals = [];
    for (let i = 0; i < n; i += 1) vals.push({ v: X[i][j], i });
    vals.sort((a, b) => a.v - b.v);
    const candCount = Math.min(maxSplitCandidates, Math.max(1, n - 2 * minLeaf));
    const step = Math.max(1, Math.floor((n - 2 * minLeaf) / candCount));
    for (let s = minLeaf; s <= n - minLeaf; s += step) {
      const thr = (vals[s - 1].v + vals[s].v) / 2;
      if (!Number.isFinite(thr) || vals[s - 1].v === vals[s].v) continue;
      const yL = [];
      const yR = [];
      for (let k = 0; k < s; k += 1) yL.push(y[vals[k].i]);
      for (let k = s; k < n; k += 1) yR.push(y[vals[k].i]);
      const gain = sseDeviance(y) - sseDeviance(yL) - sseDeviance(yR);
      if (gain > bestGain) {
        bestGain = gain;
        best = { j, thr, splitAt: s };
      }
    }
  }

  if (!best || bestGain <= 1e-12) return null;

  const sortedIdx = [...Array(n).keys()].sort((a, b) => X[a][best.j] - X[b][best.j]);
  const leftIdx = [];
  const rightIdx = [];
  for (const i of sortedIdx) {
    if (X[i][best.j] <= best.thr) leftIdx.push(i);
    else rightIdx.push(i);
  }
  if (leftIdx.length < minLeaf || rightIdx.length < minLeaf) return null;
  return { j: best.j, thr: best.thr, leftIdx, rightIdx, gain: bestGain };
}

function buildRegressionTree(X, y, depth, maxDepth, minLeaf, mtry, maxSplitCandidates, rng, importance) {
  const n = X.length;
  if (n <= minLeaf * 2 || depth >= maxDepth) {
    return { t: 'leaf', v: Number(mean(y).toFixed(6)) };
  }

  const p = X[0].length;
  const order = shuffleOrder(p, rng).slice(0, Math.min(mtry, p));

  const split = findBestSplit(X, y, order, minLeaf, maxSplitCandidates, rng);
  if (!split) {
    return { t: 'leaf', v: Number(mean(y).toFixed(6)) };
  }

  if (importance && split.j != null) {
    importance[split.j] = (importance[split.j] || 0) + Math.max(0, split.gain || 0);
  }

  const XL = split.leftIdx.map((i) => X[i]);
  const XR = split.rightIdx.map((i) => X[i]);
  const yL = split.leftIdx.map((i) => y[i]);
  const yR = split.rightIdx.map((i) => y[i]);

  return {
    t: 'split',
    j: split.j,
    thr: Number(split.thr.toFixed(8)),
    L: buildRegressionTree(XL, yL, depth + 1, maxDepth, minLeaf, mtry, maxSplitCandidates, rng, importance),
    R: buildRegressionTree(XR, yR, depth + 1, maxDepth, minLeaf, mtry, maxSplitCandidates, rng, importance),
  };
}

function predictTree(node, x) {
  if (node.t === 'leaf') return node.v;
  return x[node.j] <= node.thr ? predictTree(node.L, x) : predictTree(node.R, x);
}

function normalizeImportance(importance, featureKeys) {
  const p = featureKeys.length;
  const vec = Array(p).fill(0);
  for (let j = 0; j < p; j += 1) vec[j] = importance[j] || 0;
  const s = vec.reduce((a, b) => a + b, 0) || 1;
  const out = {};
  for (let j = 0; j < p; j += 1) {
    out[featureKeys[j]] = Number((vec[j] / s).toFixed(4));
  }
  return out;
}

/**
 * Sorted feature importance for API/UI: highest first.
 * @param {Record<string, number>} featureImportance
 * @returns {{ feature: string, importance: number }[]}
 */
function featureImportancesToSortedArray(featureImportance) {
  if (!featureImportance || typeof featureImportance !== 'object') return [];
  return Object.entries(featureImportance)
    .map(([feature, importance]) => ({
      feature: String(feature),
      importance: Number(Number(importance).toFixed(6)),
    }))
    .filter((x) => Number.isFinite(x.importance))
    .sort((a, b) => b.importance - a.importance);
}

function trainRandomForest(X, y, rng, featureKeys, opts = {}) {
  const n = X.length;
  const p = X[0].length;
  const nTrees = opts.nTrees ?? 48;
  const maxDepth = opts.maxDepth ?? 12;
  const minLeaf = opts.minLeaf ?? Math.max(3, Math.floor(n / 120));
  const mtry = opts.mtry ?? Math.max(1, Math.floor(Math.sqrt(p)));
  const maxSplitCandidates = opts.maxSplitCandidates ?? 24;
  const trees = [];
  const imp = Array(p).fill(0);
  for (let t = 0; t < nTrees; t += 1) {
    const idx = bootstrapIndices(n, rng);
    const Xb = idx.map((i) => X[i]);
    const yb = idx.map((i) => y[i]);
    const treeImp = Array(p).fill(0);
    trees.push(buildRegressionTree(Xb, yb, 0, maxDepth, minLeaf, mtry, maxSplitCandidates, rng, treeImp));
    for (let j = 0; j < p; j += 1) imp[j] += treeImp[j];
  }
  const featureImportance = normalizeImportance(imp, featureKeys);
  return { trees, nTrees, maxDepth, minLeaf, mtry, maxSplitCandidates, featureImportance };
}

function trainGradientBoosting(X, y, rng, featureKeys, opts = {}) {
  const n = X.length;
  const p = X[0].length;
  const rounds = opts.rounds ?? 64;
  const shrink = opts.shrinkage ?? 0.06;
  const maxDepth = opts.treeDepth ?? 3;
  const minLeaf = opts.minLeaf ?? Math.max(2, Math.floor(n / 200));
  const mtry = opts.mtry ?? Math.max(1, Math.floor(Math.sqrt(p)));
  const maxSplitCandidates = opts.maxSplitCandidates ?? 20;

  const F = Array(n).fill(mean(y));
  const trees = [];
  const imp = Array(p).fill(0);

  for (let m = 0; m < rounds; m += 1) {
    const r = y.map((yi, i) => yi - F[i]);
    const treeImp = Array(p).fill(0);
    const tr = buildRegressionTree(X, r, 0, maxDepth, minLeaf, mtry, maxSplitCandidates, rng, treeImp);
    trees.push(tr);
    for (let j = 0; j < p; j += 1) imp[j] += treeImp[j];
    for (let i = 0; i < n; i += 1) {
      F[i] += shrink * predictTree(tr, X[i]);
    }
  }

  const featureImportance = normalizeImportance(imp, featureKeys);
  return {
    baseMean: Number(mean(y).toFixed(6)),
    trees,
    shrink,
    rounds,
    maxDepth,
    minLeaf,
    mtry,
    maxSplitCandidates,
    featureImportance,
  };
}

function relu(x) {
  return x > 0 ? x : 0;
}

function trainSmallMlp(X, y, rng, opts = {}) {
  const n = X.length;
  const p = X[0].length;
  const h = Math.min(opts.hidden ?? 28, Math.max(8, 2 * p));
  const epochs = opts.epochs ?? 320;
  const lr = opts.lr ?? 0.025;

  const randW = (rows, cols, scale) => {
    const W = [];
    for (let i = 0; i < rows; i += 1) {
      const row = [];
      for (let j = 0; j < cols; j += 1) row.push((rng() * 2 - 1) * scale);
      W.push(row);
    }
    return W;
  };

  let W1 = randW(h, p, 1 / Math.sqrt(p + 1));
  let b1 = Array(h).fill(0);
  let w2 = Array(h)
    .fill(0)
    .map(() => (rng() * 2 - 1) * 0.1);
  let b2 = 0;

  const ym = mean(y);
  b2 = ym;

  for (let ep = 0; ep < epochs; ep += 1) {
    const gW1 = W1.map((row) => row.map(() => 0));
    const gb1 = Array(h).fill(0);
    const gw2 = Array(h).fill(0);
    let gb2 = 0;

    for (let i = 0; i < n; i += 1) {
      const x = X[i];
      const z = W1.map((row, r) => row.reduce((s, v, c) => s + v * x[c], 0) + b1[r]);
      const a = z.map(relu);
      const yhat = a.reduce((s, v, r) => s + v * w2[r], 0) + b2;
      const diff = yhat - y[i];

      gb2 += diff;
      for (let r = 0; r < h; r += 1) {
        gw2[r] += diff * a[r];
        const ga = diff * w2[r] * (z[r] > 0 ? 1 : 0);
        gb1[r] += ga;
        for (let c = 0; c < p; c += 1) {
          gW1[r][c] += ga * x[c];
        }
      }
    }

    const inv = 1 / n;
    for (let r = 0; r < h; r += 1) {
      b1[r] -= lr * gb1[r] * inv;
      w2[r] -= lr * gw2[r] * inv;
      for (let c = 0; c < p; c += 1) W1[r][c] -= lr * gW1[r][c] * inv;
    }
    b2 -= lr * gb2 * inv;
  }

  const absW = w2.map((v) => Math.abs(v));
  const s = absW.reduce((a, b) => a + b, 0) || 1;
  const featureImportance = {};
  for (let c = 0; c < p; c += 1) {
    let acc = 0;
    for (let r = 0; r < h; r += 1) acc += Math.abs(W1[r][c] * w2[r]);
    featureImportance[opts.featureKeys[c]] = Number((acc / s).toFixed(4));
  }

  return {
    W1: W1.map((row) => row.map((v) => Number(v.toFixed(6)))),
    b1: b1.map((v) => Number(v.toFixed(6))),
    w2: w2.map((v) => Number(v.toFixed(6))),
    b2: Number(b2.toFixed(6)),
    hidden: h,
    featureImportance,
    trainingMeta: { epochs, lr, hidden: h },
  };
}

/**
 * @param {{ trees: unknown[], nTrees?: number }} model
 * @param {number[]} x z-scored feature vector (length p)
 */
function predictRandomForest(model, x) {
  const trees = model?.trees;
  if (!Array.isArray(trees) || !trees.length) return Number.NaN;
  let s = 0;
  for (let t = 0; t < trees.length; t += 1) s += predictTree(trees[t], x);
  return s / trees.length;
}

/**
 * Gradient boosting: F(x) = baseMean + shrink * sum_m tree_m(x).
 * `shrink` is read from the serialized `gbm` object (authoritative); callers may
 * pre-merge `trainingOptionsUsed.gradientBoosting.shrinkage` when loading legacy payloads.
 *
 * @param {{ baseMean?: number, trees: unknown[], shrink?: number }} model
 * @param {number[]} x
 */
function predictGradientBoosting(model, x) {
  const trees = model?.trees;
  if (!Array.isArray(trees) || !trees.length) return Number.NaN;
  const shrink = Number(model?.shrink);
  const eta = Number.isFinite(shrink) ? shrink : 0;
  let v = Number(model?.baseMean);
  if (!Number.isFinite(v)) v = 0;
  for (let m = 0; m < trees.length; m += 1) v += eta * predictTree(trees[m], x);
  return v;
}

/**
 * Single hidden-layer ReLU MLP, regression head (matches trainSmallMlp).
 *
 * @param {{ W1: number[][], b1: number[], w2: number[], b2: number }} mlp
 * @param {number[]} x length p
 */
function predictNeuralNetwork(mlp, x) {
  const W1 = mlp?.W1;
  const b1 = mlp?.b1;
  const w2 = mlp?.w2;
  if (!Array.isArray(W1) || !Array.isArray(b1) || !Array.isArray(w2)) return Number.NaN;
  const h = W1.length;
  const p = x.length;
  const z = new Array(h);
  for (let r = 0; r < h; r += 1) {
    const row = W1[r];
    if (!Array.isArray(row) || row.length !== p) return Number.NaN;
    let acc = Number(b1[r]);
    if (!Number.isFinite(acc)) acc = 0;
    for (let c = 0; c < p; c += 1) acc += row[c] * x[c];
    z[r] = acc;
  }
  let out = Number(mlp.b2);
  if (!Number.isFinite(out)) out = 0;
  for (let r = 0; r < h; r += 1) {
    const wr = Number(w2[r]);
    out += relu(z[r]) * (Number.isFinite(wr) ? wr : 0);
  }
  return out;
}

/**
 * @param {Array<{features: Record<string, number>}>} trainRows
 * @param {Array<{features: Record<string, number>}>} holdRows
 */
function matricesFromRows(trainRows, holdRows, featureKeys) {
  const normalization = {};
  for (const k of featureKeys) {
    const vals = trainRows.map((r) => r.features[k]);
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length;
    let std = Math.sqrt(Math.max(0, variance));
    if (!Number.isFinite(std) || std < 1e-9) std = 1;
    normalization[k] = { mean: m, std };
  }

  const Xtrain = trainRows.map((r) => rowToZvec(r.features, featureKeys, normalization));
  const yTrain = trainRows.map((r) => r.targetWaitPlusHorizon);
  const Xhold = holdRows.map((r) => rowToZvec(r.features, featureKeys, normalization));
  const yHold = holdRows.map((r) => r.targetWaitPlusHorizon);

  return { normalization, Xtrain, yTrain, Xhold, yHold };
}

function trainLinearRidge(trainRows, holdRows, featureKeys, horizonMinutes, ridgeLambda = 1e-6) {
  const { normalization, Xtrain, yTrain, Xhold, yHold } = matricesFromRows(trainRows, holdRows, featureKeys);
  const Ztrain = Xtrain.map((x) => [1, ...x]);
  const beta = fitRidgeOLS(Ztrain, yTrain, ridgeLambda);
  const intercept = beta[0];
  const weights = {};
  for (let j = 0; j < featureKeys.length; j += 1) {
    weights[featureKeys[j]] = beta[j + 1];
  }
  const Zhold = Xhold.map((x) => [1, ...x]);
  const predHold = Zhold.map((zrow) => zrow.reduce((acc, z, idx) => acc + z * beta[idx], 0));
  const { mae, rmse, r2 } = maeRmseR2(yHold, predHold);

  const absW = featureKeys.map((k) => Math.abs(weights[k] || 0));
  const sumAbs = absW.reduce((a, b) => a + b, 0) || 1;
  const featureImportance = {};
  for (let i = 0; i < featureKeys.length; i += 1) {
    featureImportance[featureKeys[i]] = Number((absW[i] / sumAbs).toFixed(4));
  }

  const points = holdRows.map((r, idx) => ({
    i: idx,
    actual: Number(yHold[idx].toFixed(2)),
    predicted: Number(predHold[idx].toFixed(2)),
  }));

  const t0 = trainRows[0].snapshotAt;
  const t1 = trainRows[trainRows.length - 1].snapshotAt;
  const modelPayload = {
    stub: false,
    algorithm: 'linear_regression',
    dataset: 'FEATURE_STORE',
    horizonMinutes,
    normalization,
    intercept: Number(intercept.toFixed(6)),
    weights,
    featureKeys: [...featureKeys],
    trainingRowsUsed: trainRows.length,
    holdoutRowsUsed: holdRows.length,
    trainDateFrom: t0 instanceof Date ? t0.toISOString() : new Date(t0).toISOString(),
    trainDateTo: t1 instanceof Date ? t1.toISOString() : new Date(t1).toISOString(),
    completeRowsTotal: trainRows.length + holdRows.length,
    trainingOptionsUsed: { ridgeLambda },
    featureImportances: featureImportancesToSortedArray(featureImportance),
  };

  return {
    mae,
    rmse,
    r2,
    featureImportance,
    modelPayload,
    evalHoldout: { points, holdoutRows: holdRows.length },
    datasetSnapshotJson: {
      dataset: 'FEATURE_STORE',
      horizonMinutes,
      trainingRowsUsed: trainRows.length,
      holdoutRowsUsed: holdRows.length,
      completeRowsTotal: trainRows.length + holdRows.length,
      trainDateFrom: modelPayload.trainDateFrom,
      trainDateTo: modelPayload.trainDateTo,
      labelDateFrom: trainRows[0].snapshotAt.toISOString(),
      labelDateTo: holdRows[holdRows.length - 1].snapshotAt.toISOString(),
    },
  };
}

function trainWithAlgorithm(trainRows, holdRows, featureKeys, algorithm, rng, horizonMinutes = 15, trainingOptions = {}) {
  const to = trainingOptions && typeof trainingOptions === 'object' ? trainingOptions : {};
  const { normalization, Xtrain, yTrain, Xhold, yHold } = matricesFromRows(trainRows, holdRows, featureKeys);
  const t0 = trainRows[0].snapshotAt;
  const t1 = trainRows[trainRows.length - 1].snapshotAt;
  const iso = (d) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

  const baseMeta = {
    stub: false,
    dataset: 'FEATURE_STORE',
    horizonMinutes,
    normalization,
    featureKeys: [...featureKeys],
    trainingRowsUsed: trainRows.length,
    holdoutRowsUsed: holdRows.length,
    trainDateFrom: iso(t0),
    trainDateTo: iso(t1),
    completeRowsTotal: trainRows.length + holdRows.length,
  };

  if (algorithm === 'linear_regression') {
    const ridgeLambda =
      to.ridgeLambda != null && Number.isFinite(Number(to.ridgeLambda)) ? Number(to.ridgeLambda) : 1e-6;
    const out = trainLinearRidge(trainRows, holdRows, featureKeys, horizonMinutes, ridgeLambda);
    return out;
  }

  if (algorithm === 'random_forest') {
    const rfOpts = { ...(to.randomForest && typeof to.randomForest === 'object' ? to.randomForest : {}) };
    const rf = trainRandomForest(Xtrain, yTrain, rng, featureKeys, rfOpts);
    const predHold = Xhold.map((x) => predictRandomForest(rf, x));
    const { mae, rmse, r2 } = maeRmseR2(yHold, predHold);
    const points = holdRows.map((_, idx) => ({
      i: idx,
      actual: Number(yHold[idx].toFixed(2)),
      predicted: Number(predHold[idx].toFixed(2)),
    }));
    return {
      mae,
      rmse,
      r2,
      featureImportance: rf.featureImportance,
      modelPayload: {
        ...baseMeta,
        algorithm: 'random_forest',
        rf,
        trainingOptionsUsed: {
          randomForest: {
            nTrees: rf.nTrees,
            maxDepth: rf.maxDepth,
            minLeaf: rf.minLeaf,
            mtry: rf.mtry,
            maxSplitCandidates: rf.maxSplitCandidates,
          },
        },
        featureImportances: featureImportancesToSortedArray(rf.featureImportance),
      },
      evalHoldout: { points, holdoutRows: holdRows.length },
      datasetSnapshotJson: {
        dataset: 'FEATURE_STORE',
        horizonMinutes,
        trainingRowsUsed: trainRows.length,
        holdoutRowsUsed: holdRows.length,
        completeRowsTotal: trainRows.length + holdRows.length,
        trainDateFrom: baseMeta.trainDateFrom,
        trainDateTo: baseMeta.trainDateTo,
        labelDateFrom: iso(trainRows[0].snapshotAt),
        labelDateTo: iso(holdRows[holdRows.length - 1].snapshotAt),
      },
    };
  }

  if (algorithm === 'gradient_boosting') {
    const gbmOpts = { ...(to.gradientBoosting && typeof to.gradientBoosting === 'object' ? to.gradientBoosting : {}) };
    const gbm = trainGradientBoosting(Xtrain, yTrain, rng, featureKeys, gbmOpts);
    const predHold = Xhold.map((x) => predictGradientBoosting(gbm, x));
    const { mae, rmse, r2 } = maeRmseR2(yHold, predHold);
    const points = holdRows.map((_, idx) => ({
      i: idx,
      actual: Number(yHold[idx].toFixed(2)),
      predicted: Number(predHold[idx].toFixed(2)),
    }));
    return {
      mae,
      rmse,
      r2,
      featureImportance: gbm.featureImportance,
      modelPayload: {
        ...baseMeta,
        algorithm: 'gradient_boosting',
        gbm,
        trainingOptionsUsed: {
          gradientBoosting: {
            rounds: gbm.rounds,
            shrinkage: gbm.shrink,
            treeDepth: gbm.maxDepth,
            minLeaf: gbm.minLeaf,
            mtry: gbm.mtry,
            maxSplitCandidates: gbm.maxSplitCandidates,
          },
        },
        featureImportances: featureImportancesToSortedArray(gbm.featureImportance),
      },
      evalHoldout: { points, holdoutRows: holdRows.length },
      datasetSnapshotJson: {
        dataset: 'FEATURE_STORE',
        horizonMinutes,
        trainingRowsUsed: trainRows.length,
        holdoutRowsUsed: holdRows.length,
        completeRowsTotal: trainRows.length + holdRows.length,
        trainDateFrom: baseMeta.trainDateFrom,
        trainDateTo: baseMeta.trainDateTo,
        labelDateFrom: iso(trainRows[0].snapshotAt),
        labelDateTo: iso(holdRows[holdRows.length - 1].snapshotAt),
      },
    };
  }

  if (algorithm === 'neural_network') {
    const nnOpts = {
      featureKeys,
      ...(to.neuralNetwork && typeof to.neuralNetwork === 'object' ? to.neuralNetwork : {}),
    };
    const mlp = trainSmallMlp(Xtrain, yTrain, rng, nnOpts);
    const predHold = Xhold.map((x) => predictNeuralNetwork(mlp, x));
    const { mae, rmse, r2 } = maeRmseR2(yHold, predHold);
    const points = holdRows.map((_, idx) => ({
      i: idx,
      actual: Number(yHold[idx].toFixed(2)),
      predicted: Number(predHold[idx].toFixed(2)),
    }));
    return {
      mae,
      rmse,
      r2,
      featureImportance: mlp.featureImportance,
      modelPayload: {
        ...baseMeta,
        algorithm: 'neural_network',
        mlp: { W1: mlp.W1, b1: mlp.b1, w2: mlp.w2, b2: mlp.b2, hidden: mlp.hidden, activation: 'relu' },
        trainingOptionsUsed: {
          neuralNetwork: {
            hidden: mlp.trainingMeta.hidden,
            epochs: mlp.trainingMeta.epochs,
            lr: mlp.trainingMeta.lr,
          },
        },
        featureImportances: featureImportancesToSortedArray(mlp.featureImportance),
      },
      evalHoldout: { points, holdoutRows: holdRows.length },
      datasetSnapshotJson: {
        dataset: 'FEATURE_STORE',
        horizonMinutes,
        trainingRowsUsed: trainRows.length,
        holdoutRowsUsed: holdRows.length,
        completeRowsTotal: trainRows.length + holdRows.length,
        trainDateFrom: baseMeta.trainDateFrom,
        trainDateTo: baseMeta.trainDateTo,
        labelDateFrom: iso(trainRows[0].snapshotAt),
        labelDateTo: iso(holdRows[holdRows.length - 1].snapshotAt),
      },
    };
  }

  throw new Error(`Unsupported FEATURE_STORE algorithm: ${algorithm}`);
}

function predictFeatureStorePayload(payload, featuresInput, featureOrder) {
  const norm = payload.normalization;
  if (!norm || typeof norm !== 'object') return null;
  const order = Array.isArray(featureOrder) ? featureOrder : [];
  if (!order.length) return null;
  const x = new Array(order.length);
  for (let j = 0; j < order.length; j += 1) {
    const k = order[j];
    const raw = Number(featuresInput[k]);
    if (!Number.isFinite(raw)) return null;
    const meta = norm[k];
    if (!meta || !Number.isFinite(meta.mean)) return null;
    const s = Number.isFinite(meta.std) && meta.std > 1e-12 ? meta.std : 1;
    x[j] = (raw - meta.mean) / s;
  }

  let alg = payload.algorithm != null ? String(payload.algorithm).trim() : '';
  if (!alg) {
    if (payload.rf) alg = 'random_forest';
    else if (payload.gbm) alg = 'gradient_boosting';
    else if (payload.mlp) alg = 'neural_network';
    else alg = 'linear_regression';
  }

  if (alg === 'linear_regression') {
    let v = Number(payload.intercept) || 0;
    const w = payload.weights || {};
    for (let j = 0; j < order.length; j += 1) {
      v += (w[order[j]] || 0) * x[j];
    }
    return v;
  }
  if (alg === 'random_forest' && payload.rf) {
    const pv = predictRandomForest(payload.rf, x);
    return Number.isFinite(pv) ? pv : null;
  }
  if (alg === 'gradient_boosting' && payload.gbm) {
    const g = payload.gbm;
    let shrink = Number(g.shrink);
    if (!Number.isFinite(shrink)) {
      const fromMeta = payload.trainingOptionsUsed?.gradientBoosting?.shrinkage;
      if (fromMeta != null && Number.isFinite(Number(fromMeta))) shrink = Number(fromMeta);
      else shrink = 0.06;
    }
    const gbmIn = Number.isFinite(Number(g.shrink)) ? g : { ...g, shrink };
    const pv = predictGradientBoosting(gbmIn, x);
    return Number.isFinite(pv) ? pv : null;
  }
  if (alg === 'neural_network' && payload.mlp) {
    const pv = predictNeuralNetwork(payload.mlp, x);
    return Number.isFinite(pv) ? pv : null;
  }
  return null;
}

module.exports = {
  buildDesignRowFromFeatures,
  rowToZvec,
  maeRmseR2,
  trainWithAlgorithm,
  predictFeatureStorePayload,
  predictRandomForest,
  predictGradientBoosting,
  predictNeuralNetwork,
  matricesFromRows,
  featureImportancesToSortedArray,
};

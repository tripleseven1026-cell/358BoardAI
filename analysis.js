/* =========================================================
   358BoardAI
   analysis.js
   Version 1.0.0
   ========================================================= */
"use strict";
(function initializeAnalysisModule(global) {
  const MODULE_VERSION = "1.0.0";
  const round = (v, d = 1) => { const s = 10 ** d; return Math.round((v + Number.EPSILON) * s) / s; };
  const average = (values) => { const v = values.filter(Number.isFinite); return v.length ? v.reduce((a,b)=>a+b,0)/v.length : 0; };
  const percentage = (part, total) => total > 0 ? round((part / total) * 100, 1) : 0;
  const normalizeHistory = (history) => Array.isArray(history) ? history.filter(Boolean) : [];
  const getSettledHistory = (history) => normalizeHistory(history).filter((item) => item.settlement && ["hit","miss"].includes(item.settlement.status));

  function summarizeItems(items) {
    const all = normalizeHistory(items);
    const settled = getSettledHistory(all);
    const hits = settled.filter((i)=>i.settlement.status === "hit");
    const firstHits = settled.filter((i)=>i.settlement.firstPlaceHit);
    const confidences = settled.map((i)=>Number(i.prediction?.confidence)).filter(Number.isFinite);
    return {
      count: all.length,
      settledCount: settled.length,
      hitCount: hits.length,
      missCount: settled.length - hits.length,
      hitRate: percentage(hits.length, settled.length),
      firstPlaceHitCount: firstHits.length,
      firstPlaceHitRate: percentage(firstHits.length, settled.length),
      averageConfidence: round(average(confidences), 1)
    };
  }

  function groupBy(items, selector) {
    const map = new Map();
    normalizeHistory(items).forEach((item) => {
      const key = selector(item);
      if (key === null || key === undefined || key === "") return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    return map;
  }

  function analyzeByVenue(history) {
    return [...groupBy(history, (i)=>String(i.prediction?.input?.raceVenue || "")).entries()]
      .map(([venue, items]) => ({ venue, ...summarizeItems(items) }))
      .sort((a,b)=> b.settledCount - a.settledCount || b.hitRate - a.hitRate);
  }

  function analyzeByTopLane(history) {
    return [...groupBy(history, (i)=>{ const n=Number(i.prediction?.topPrediction?.lane); return Number.isInteger(n)&&n>=1&&n<=6?n:null; }).entries()]
      .map(([lane, items]) => ({ lane:Number(lane), ...summarizeItems(items) }))
      .sort((a,b)=>a.lane-b.lane);
  }

  function analyzeByDangerLevel(history) {
    const labels = { low:"低", medium:"中", high:"高" };
    const grouped = groupBy(history, (i)=>String(i.prediction?.danger?.level || ""));
    return ["low","medium","high"].map((level)=>({ level, label:labels[level], ...summarizeItems(grouped.get(level)||[]) }));
  }

  function confidenceBand(value) {
    const c = Number(value);
    if (!Number.isFinite(c)) return "不明";
    if (c >= 80) return "80%以上";
    if (c >= 70) return "70～79%";
    if (c >= 60) return "60～69%";
    if (c >= 50) return "50～59%";
    return "50%未満";
  }

  function analyzeByConfidence(history) {
    const order = ["80%以上","70～79%","60～69%","50～59%","50%未満","不明"];
    const grouped = groupBy(history, (i)=>confidenceBand(i.prediction?.confidence));
    return order.map((band)=>({ band, ...summarizeItems(grouped.get(band)||[]) })).filter((i)=>i.count>0);
  }

  function analyzeByRaceCategory(history) {
    const grouped = groupBy(history, (i)=>String(i.prediction?.input?.raceCategory || ""));
    return [
      { category:"women", label:"女子レース", ...summarizeItems(grouped.get("women")||[]) },
      { category:"mixed", label:"男女混合レース", ...summarizeItems(grouped.get("mixed")||[]) }
    ];
  }

  function analyzeByBetCount(history) {
    return [...groupBy(history, (i)=>Array.isArray(i.prediction?.bets)?i.prediction.bets.length:null).entries()]
      .map(([betCount, items])=>({ betCount:Number(betCount), ...summarizeItems(items) }))
      .sort((a,b)=>a.betCount-b.betCount);
  }

  function calculateDangerAvoidanceRate(history) {
    const high = getSettledHistory(history).filter((i)=>i.prediction?.danger?.level === "high");
    const avoided = high.filter((i)=>i.prediction?.raceJudgement === "見送り推奨");
    return percentage(avoided.length, high.length);
  }

  function buildComment(report) {
    const o = report.overall;
    if (!o.settledCount) return "結果入力済みの履歴がありません。予想履歴に実際の結果を入力すると分析できます。";
    const lines = [`結果入力済み${o.settledCount}件の3連単的中率は${o.hitRate}%、本命1着率は${o.firstPlaceHitRate}%です。`];
    if (o.settledCount < 10) lines.push("履歴件数が少ないため、現段階の数値は参考値です。最低10件以上の結果を蓄積してください。");
    const venues = report.byVenue.filter((v)=>v.settledCount>=3);
    if (venues.length) {
      const best = [...venues].sort((a,b)=>b.hitRate-a.hitRate||b.settledCount-a.settledCount)[0];
      const worst = [...venues].sort((a,b)=>a.hitRate-b.hitRate||b.settledCount-a.settledCount)[0];
      lines.push(`${best.venue}は的中率${best.hitRate}%で現在最も良好です。`);
      if (worst.venue !== best.venue) lines.push(`${worst.venue}は的中率${worst.hitRate}%です。風・進入・コース特性を慎重に確認してください。`);
    }
    const high = report.byDanger.find((i)=>i.level==="high");
    if (high?.settledCount>=3 && high.hitRate < o.hitRate) lines.push(`危険ゾーン「高」の的中率は${high.hitRate}%です。見送りを優先する運用が適しています。`);
    const women = report.byCategory.find((i)=>i.category==="women");
    if (women?.settledCount) lines.push(`女子レースの的中率は${women.hitRate}%です。女子戦補正の有効性を継続評価します。`);
    return lines.join("\n");
  }

  function createReport(historyInput) {
    const history = normalizeHistory(historyInput);
    const byCategory = analyzeByRaceCategory(history);
    const settled = getSettledHistory(history);
    const report = {
      moduleVersion: MODULE_VERSION,
      generatedAt: new Date().toISOString(),
      sourceCount: history.length,
      overall: summarizeItems(history),
      womenHitRate: byCategory.find((i)=>i.category==="women")?.hitRate || 0,
      womenSettledCount: byCategory.find((i)=>i.category==="women")?.settledCount || 0,
      dangerAvoidanceRate: calculateDangerAvoidanceRate(history),
      averageConfidence: round(average(settled.map((i)=>Number(i.prediction?.confidence)).filter(Number.isFinite)),1),
      byVenue: analyzeByVenue(history),
      byTopLane: analyzeByTopLane(history),
      byDanger: analyzeByDangerLevel(history),
      byConfidence: analyzeByConfidence(history),
      byCategory,
      byBetCount: analyzeByBetCount(history),
      comment: ""
    };
    report.comment = buildComment(report);
    return report;
  }

  global.AnalysisEngine = Object.freeze({
    version: MODULE_VERSION,
    createReport,
    createEmptyReport: () => createReport([]),
    summarizeItems,
    analyzeByVenue,
    analyzeByTopLane,
    analyzeByDangerLevel,
    analyzeByConfidence,
    analyzeByRaceCategory,
    analyzeByBetCount
  });
})(window);

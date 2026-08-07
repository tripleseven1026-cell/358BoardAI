/* =========================================================
   358BoardAI
   history.js
   Version 1.0.0

   役割:
   - 予想履歴の保存
   - LocalStorageからの読込
   - 実際の結果入力
   - 的中判定
   - 履歴集計
   - 履歴削除
   ========================================================= */

"use strict";

(function initializeHistoryModule(global) {
  const MODULE_VERSION = "1.0.0";
  const STORAGE_KEY = "358BoardAI.history.v1";

  function createId() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }

    return [
      Date.now().toString(36),
      Math.random().toString(36).slice(2, 10),
      Math.random().toString(36).slice(2, 10)
    ].join("-");
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function safeParse(json, fallback) {
    try {
      return JSON.parse(json);
    } catch (error) {
      console.error("履歴データの解析に失敗しました。", error);
      return fallback;
    }
  }

  function normalizeInteger(value, minimum, maximum, fallback = null) {
    if (value === "" || value === null || typeof value === "undefined") {
      return fallback;
    }

    const number = Number(value);

    if (!Number.isInteger(number)) {
      return fallback;
    }

    if (number < minimum || number > maximum) {
      return fallback;
    }

    return number;
  }

  function normalizeMoney(value) {
    if (value === "" || value === null || typeof value === "undefined") {
      return null;
    }

    const number = Number(value);

    if (!Number.isFinite(number) || number < 0) {
      return null;
    }

    return Math.round(number);
  }

  function normalizeDateString(value) {
    const text = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
  }

  function normalizeStoredHistory(raw) {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: String(item.id || createId()),
        createdAt: String(item.createdAt || new Date().toISOString()),
        updatedAt: String(item.updatedAt || item.createdAt || new Date().toISOString()),
        prediction: item.prediction && typeof item.prediction === "object"
          ? item.prediction
          : null,
        actualResult: item.actualResult && typeof item.actualResult === "object"
          ? item.actualResult
          : null,
        settlement: item.settlement && typeof item.settlement === "object"
          ? item.settlement
          : null
      }))
      .filter((item) => item.prediction);
  }

  function loadHistory() {
    const raw = global.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    return normalizeStoredHistory(safeParse(raw, []));
  }

  function saveHistory(history) {
    const normalized = normalizeStoredHistory(history);
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return clone(normalized);
  }

  function getAll() {
    return loadHistory().sort((a, b) => {
      const aDate = new Date(a.createdAt).getTime();
      const bDate = new Date(b.createdAt).getTime();
      return bDate - aDate;
    });
  }

  function getById(id) {
    const targetId = String(id || "");
    return getAll().find((item) => item.id === targetId) || null;
  }

  function validatePredictionResult(predictionResult) {
    const errors = [];

    if (!predictionResult || typeof predictionResult !== "object") {
      errors.push("保存する予想データがありません。");
      return {
        valid: false,
        errors
      };
    }

    if (!predictionResult.input) {
      errors.push("レース入力データがありません。");
    }

    if (!predictionResult.topPrediction) {
      errors.push("本命予想データがありません。");
    }

    if (!Array.isArray(predictionResult.bets) || predictionResult.bets.length === 0) {
      errors.push("買い目データがありません。");
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  function createHistoryRecord(predictionResult) {
    const validation = validatePredictionResult(predictionResult);

    if (!validation.valid) {
      const error = new Error(validation.errors.join("\n"));
      error.name = "HistoryValidationError";
      error.details = validation;
      throw error;
    }

    const now = new Date().toISOString();

    return {
      id: createId(),
      createdAt: now,
      updatedAt: now,
      prediction: clone(predictionResult),
      actualResult: null,
      settlement: null
    };
  }

  function add(predictionResult) {
    const history = loadHistory();
    const record = createHistoryRecord(predictionResult);

    history.push(record);
    saveHistory(history);

    return clone(record);
  }

  function remove(id) {
    const targetId = String(id || "");
    const history = loadHistory();
    const next = history.filter((item) => item.id !== targetId);

    if (next.length === history.length) {
      return false;
    }

    saveHistory(next);
    return true;
  }

  function clear() {
    global.localStorage.removeItem(STORAGE_KEY);
  }

  function validateActualResult(result) {
    const first = normalizeInteger(result?.first, 1, 6);
    const second = normalizeInteger(result?.second, 1, 6);
    const third = normalizeInteger(result?.third, 1, 6);
    const payoutAmount = normalizeMoney(result?.payoutAmount);

    const errors = [];

    if (!first) {
      errors.push("1着を選択してください。");
    }

    if (!second) {
      errors.push("2着を選択してください。");
    }

    if (!third) {
      errors.push("3着を選択してください。");
    }

    const order = [first, second, third].filter(Boolean);

    if (new Set(order).size !== order.length) {
      errors.push("1着・2着・3着に同じ艇は指定できません。");
    }

    return {
      valid: errors.length === 0,
      errors,
      result: {
        first,
        second,
        third,
        combination: first && second && third
          ? `${first}-${second}-${third}`
          : "",
        payoutAmount
      }
    };
  }

  function evaluateSettlement(record, actualResult) {
    const bets = Array.isArray(record.prediction?.bets)
      ? record.prediction.bets
      : [];

    const topPredictionLane = normalizeInteger(
      record.prediction?.topPrediction?.lane,
      1,
      6
    );

    const exactHit = bets.some((bet) => {
      return String(bet.combination || "") === actualResult.combination;
    });

    const firstPlaceHit = topPredictionLane === actualResult.first;

    const matchedBet = exactHit
      ? bets.find((bet) => String(bet.combination || "") === actualResult.combination)
      : null;

    return {
      status: exactHit ? "hit" : "miss",
      exactHit,
      firstPlaceHit,
      predictedTopLane: topPredictionLane,
      actualCombination: actualResult.combination,
      matchedBet: matchedBet ? clone(matchedBet) : null,
      settledAt: new Date().toISOString()
    };
  }

  function updateResult(id, rawResult) {
    const targetId = String(id || "");
    const validation = validateActualResult(rawResult);

    if (!validation.valid) {
      const error = new Error(validation.errors.join("\n"));
      error.name = "ResultValidationError";
      error.details = validation;
      throw error;
    }

    const history = loadHistory();
    const index = history.findIndex((item) => item.id === targetId);

    if (index < 0) {
      const error = new Error("対象の履歴が見つかりません。");
      error.name = "HistoryNotFoundError";
      throw error;
    }

    const record = history[index];
    const settlement = evaluateSettlement(record, validation.result);

    const updated = {
      ...record,
      updatedAt: new Date().toISOString(),
      actualResult: {
        ...validation.result,
        enteredAt: new Date().toISOString()
      },
      settlement
    };

    history[index] = updated;
    saveHistory(history);

    return clone(updated);
  }

  function clearResult(id) {
    const targetId = String(id || "");
    const history = loadHistory();
    const index = history.findIndex((item) => item.id === targetId);

    if (index < 0) {
      return false;
    }

    history[index] = {
      ...history[index],
      updatedAt: new Date().toISOString(),
      actualResult: null,
      settlement: null
    };

    saveHistory(history);
    return true;
  }

  function getSummary(historyInput = null) {
    const history = Array.isArray(historyInput)
      ? normalizeStoredHistory(historyInput)
      : getAll();

    const settled = history.filter((item) => item.settlement);
    const hits = settled.filter((item) => item.settlement.status === "hit");
    const misses = settled.filter((item) => item.settlement.status === "miss");
    const firstPlaceHits = settled.filter((item) => item.settlement.firstPlaceHit);

    const totalPayout = settled.reduce((sum, item) => {
      const amount = Number(item.actualResult?.payoutAmount);
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0);

    return {
      totalCount: history.length,
      settledCount: settled.length,
      pendingCount: history.length - settled.length,
      hitCount: hits.length,
      missCount: misses.length,
      hitRate: settled.length > 0
        ? Math.round((hits.length / settled.length) * 1000) / 10
        : 0,
      firstPlaceHitCount: firstPlaceHits.length,
      firstPlaceHitRate: settled.length > 0
        ? Math.round((firstPlaceHits.length / settled.length) * 1000) / 10
        : 0,
      totalPayout
    };
  }

  function filterHistory(filters = {}) {
    const venue = String(filters.venue || "");
    const result = String(filters.result || "");
    const dateFrom = normalizeDateString(filters.dateFrom);
    const dateTo = normalizeDateString(filters.dateTo);

    return getAll().filter((item) => {
      const raceVenue = String(item.prediction?.input?.raceVenue || "");
      const raceDate = String(item.prediction?.input?.raceDate || "");
      const settlementStatus = item.settlement?.status || "pending";

      if (venue && raceVenue !== venue) {
        return false;
      }

      if (result && settlementStatus !== result) {
        return false;
      }

      if (dateFrom && raceDate < dateFrom) {
        return false;
      }

      if (dateTo && raceDate > dateTo) {
        return false;
      }

      return true;
    });
  }

  function getVenueOptions() {
    return [...new Set(
      getAll()
        .map((item) => String(item.prediction?.input?.raceVenue || ""))
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, "ja"));
  }

  function exportData() {
    const payload = {
      application: "358BoardAI",
      moduleVersion: MODULE_VERSION,
      exportedAt: new Date().toISOString(),
      history: getAll()
    };

    return JSON.stringify(payload, null, 2);
  }

  function importData(jsonText, options = {}) {
    const parsed = safeParse(String(jsonText || ""), null);

    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.history)) {
      const error = new Error("358BoardAIの有効な履歴データではありません。");
      error.name = "HistoryImportError";
      throw error;
    }

    const imported = normalizeStoredHistory(parsed.history);
    const current = loadHistory();

    let next;

    if (options.replace === true) {
      next = imported;
    } else {
      const map = new Map();

      [...current, ...imported].forEach((item) => {
        map.set(item.id, item);
      });

      next = [...map.values()];
    }

    saveHistory(next);

    return {
      importedCount: imported.length,
      totalCount: next.length
    };
  }

  function isStorageAvailable() {
    try {
      const testKey = "__358boardai_storage_test__";
      global.localStorage.setItem(testKey, "1");
      global.localStorage.removeItem(testKey);
      return true;
    } catch (error) {
      console.error("LocalStorageを利用できません。", error);
      return false;
    }
  }

  global.HistoryManager = Object.freeze({
    version: MODULE_VERSION,
    storageKey: STORAGE_KEY,
    isStorageAvailable,
    getAll,
    getById,
    add,
    remove,
    clear,
    updateResult,
    clearResult,
    getSummary,
    filterHistory,
    getVenueOptions,
    exportData,
    importData,
    validateActualResult
  });
})(window);

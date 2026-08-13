/* =========================================================
   358BoardAI
   app.js
   Version 1.0.0

   役割:
   - 画面切替
   - 入力値の取得
   - AI予想実行
   - 結果表示
   - 履歴保存・一覧表示
   - 実績入力
   - 分析画面表示
   - 設定保存
   ========================================================= */

"use strict";

(function initializeApp(global) {
  const APP_VERSION = "1.1.1";
  const SETTINGS_KEY = "358BoardAI.settings.v1";
  const LAST_INPUT_KEY = "358BoardAI.lastInput.v1";

  const OFFICIAL_BASE_URL = "https://www.boatrace.jp/owpc/pc/race";

  const VENUE_CODES = Object.freeze({
    "桐生": "01", "戸田": "02", "江戸川": "03", "平和島": "04",
    "多摩川": "05", "浜名湖": "06", "蒲郡": "07", "常滑": "08",
    "津": "09", "三国": "10", "びわこ": "11", "住之江": "12",
    "尼崎": "13", "鳴門": "14", "丸亀": "15", "児島": "16",
    "宮島": "17", "徳山": "18", "下関": "19", "若松": "20",
    "芦屋": "21", "福岡": "22", "唐津": "23", "大村": "24"
  });

  function compactDate(dateString) {
    return String(dateString || "").replaceAll("-", "");
  }

  function buildOfficialUrl(kind, raceDate, venue, raceNumber) {
    const jcd = VENUE_CODES[venue];
    const hd = compactDate(raceDate);
    const rno = Number(raceNumber);

    if (!jcd || !/^\d{8}$/.test(hd) || !Number.isInteger(rno) || rno < 1 || rno > 12) {
      throw new Error("開催日・開催場・レース番号を確認してください。");
    }

    return `${OFFICIAL_BASE_URL}/${kind}?hd=${hd}&jcd=${jcd}&rno=${rno}`;
  }

  function parseNumber(text) {
    const match = String(text || "").replaceAll(",", "").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function normalizeSpaces(text) {
    return String(text || "")
      .replace(/\u3000/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseOfficialRaceListHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = [...doc.querySelectorAll("tr")];
    const racers = [];

    for (const row of rows) {
      const text = normalizeSpaces(row.textContent);
      const laneMatch = text.match(/^([1-6１-６])\s/);
      if (!laneMatch) continue;

      const lane = Number(
        laneMatch[1]
          .replace("１","1").replace("２","2").replace("３","3")
          .replace("４","4").replace("５","5").replace("６","6")
      );

      if (racers.some((racer) => racer.lane === lane)) continue;

      const cells = [...row.querySelectorAll("th,td")]
        .map((cell) => normalizeSpaces(cell.textContent))
        .filter(Boolean);

      const racerCell = cells.find((cell) => /\d{4}\s*\/\s*(A1|A2|B1|B2)/.test(cell));
      if (!racerCell) continue;

      const classMatch = racerCell.match(/\d{4}\s*\/\s*(A1|A2|B1|B2)\s+(.+?)(?:\s+[^\s\/]+\/[^\s\/]+|\s+\d+歳)/);
      const racerClass = classMatch ? classMatch[1] : "";
      const racerName = classMatch ? normalizeSpaces(classMatch[2]) : "";

      const weightMatch = racerCell.match(/(\d{2}(?:\.\d)?)kg/);
      const weight = weightMatch ? Number(weightMatch[1]) : null;

      const stCell = cells.find((cell) => /F\d/.test(cell) && /L\d/.test(cell));
      let averageStart = null;
      if (stCell) {
        const nums = stCell.match(/0\.\d{2}/g);
        if (nums?.length) averageStart = Number(nums[nums.length - 1]);
      }

      const numericCells = cells.filter((cell) => {
        const nums = cell.match(/\d+(?:\.\d+)?/g);
        return nums && nums.length >= 2 && !/歳|kg|F\d|L\d/.test(cell);
      });

      const extractNumbers = (cell) => {
        const nums = (cell || "").match(/\d+(?:\.\d+)?/g) || [];
        return nums.map(Number);
      };

      const national = extractNumbers(numericCells[0]);
      const local = extractNumbers(numericCells[1]);
      const motor = extractNumbers(numericCells[2]);
      const boat = extractNumbers(numericCells[3]);

      racers.push({
        lane,
        racerName,
        racerClass,
        weight,
        averageStart,
        nationalWinRate: national[0] ?? null,
        localWinRate: local[0] ?? null,
        motorPlaceRate: motor.length >= 2 ? motor[motor.length - 2] : null,
        boatPlaceRate: boat.length >= 2 ? boat[boat.length - 2] : null
      });
    }

    return racers.sort((a, b) => a.lane - b.lane);
  }

  function parseOfficialBeforeInfoHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = [...doc.querySelectorAll("tr")];
    const racers = [];

    for (const row of rows) {
      const cells = [...row.querySelectorAll("th,td")]
        .map((cell) => normalizeSpaces(cell.textContent))
        .filter(Boolean);

      const text = normalizeSpaces(row.textContent);
      const laneMatch = text.match(/^([1-6１-６])\s/);
      if (!laneMatch) continue;

      const lane = Number(
        laneMatch[1]
          .replace("１","1").replace("２","2").replace("３","3")
          .replace("４","4").replace("５","5").replace("６","6")
      );

      if (racers.some((racer) => racer.lane === lane)) continue;

      const weightCell = cells.find((cell) => /^\d{2}(?:\.\d)?kg$/.test(cell));
      const weight = weightCell ? parseNumber(weightCell) : null;

      const exhibitionCell = cells.find((cell) => /^6\.\d{2}$/.test(cell));
      const exhibitionTime = exhibitionCell ? Number(exhibitionCell) : null;

      racers.push({ lane, weight, exhibitionTime });
    }

    const validTimes = racers
      .filter((racer) => Number.isFinite(racer.exhibitionTime))
      .sort((a, b) => a.exhibitionTime - b.exhibitionTime);

    validTimes.forEach((racer, index) => {
      racer.exhibitionRank = index + 1;
    });

    return racers.sort((a, b) => a.lane - b.lane);
  }

  async function fetchOfficialHtml(url) {
    const response = await fetch(url, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      credentials: "omit"
    });

    if (!response.ok) {
      throw new Error(`公式データ取得に失敗しました（HTTP ${response.status}）。`);
    }

    return response.text();
  }

  function applyOfficialRaceData(raceList, beforeInfo) {
    if (!Array.isArray(raceList) || raceList.length !== 6) {
      throw new Error("公式出走表から6艇分を正しく読み取れませんでした。");
    }

    raceList.forEach((racer) => {
      const lane = racer.lane;
      setInputValue(`racerName${lane}`, racer.racerName);
      setInputValue(`racerClass${lane}`, racer.racerClass);
      setInputValue(`nationalWinRate${lane}`, racer.nationalWinRate);
      setInputValue(`localWinRate${lane}`, racer.localWinRate);
      setInputValue(`motorPlaceRate${lane}`, racer.motorPlaceRate);
      setInputValue(`boatPlaceRate${lane}`, racer.boatPlaceRate);
      setInputValue(`averageStart${lane}`, racer.averageStart);
      setInputValue(`weight${lane}`, racer.weight);
      setInputValue(`entryCourse${lane}`, lane);
    });

    if (Array.isArray(beforeInfo)) {
      beforeInfo.forEach((racer) => {
        const lane = racer.lane;
        if (Number.isFinite(racer.weight)) setInputValue(`weight${lane}`, racer.weight);
        if (Number.isFinite(racer.exhibitionTime)) setInputValue(`exhibitionTime${lane}`, racer.exhibitionTime);
        if (Number.isInteger(racer.exhibitionRank)) setInputValue(`exhibitionRank${lane}`, racer.exhibitionRank);
      });
    }
  }

  async function importOfficialData() {
    const button = $("importDataButton");
    const raceDate = $("raceDate").value;
    const venue = $("raceVenue").value;
    const raceNumber = $("raceNumber").value;

    if (!raceDate || !venue || !raceNumber) {
      showToast("開催日・開催場・レース番号を先に選択してください。");
      return;
    }

    const raceListUrl = buildOfficialUrl("racelist", raceDate, venue, raceNumber);
    const beforeInfoUrl = buildOfficialUrl("beforeinfo", raceDate, venue, raceNumber);

    button.disabled = true;
    button.textContent = "公式データ取得中…";
    setStatus("データ取得中", "warning");

    try {
      const raceListHtml = await fetchOfficialHtml(raceListUrl);
      const raceList = parseOfficialRaceListHtml(raceListHtml);

      let beforeInfo = [];
      try {
        const beforeInfoHtml = await fetchOfficialHtml(beforeInfoUrl);
        beforeInfo = parseOfficialBeforeInfoHtml(beforeInfoHtml);
      } catch (beforeError) {
        console.warn("直前情報はまだ取得できませんでした。", beforeError);
      }

      applyOfficialRaceData(raceList, beforeInfo);
      saveLastInput();

      const hasExhibition = beforeInfo.some((item) => Number.isFinite(item.exhibitionTime));

      showToast(
        hasExhibition
          ? "公式出走表・直前情報を入力しました。"
          : "公式出走表を入力しました。展示情報は公開後に再取得してください。",
        4200
      );
      setStatus("公式データ取得済み");
    } catch (error) {
      console.error(error);

      const corsLikely =
        error instanceof TypeError ||
        /Failed to fetch|NetworkError|CORS/i.test(String(error?.message));

      if (corsLikely) {
        showToast(
          "ブラウザの外部通信制限で公式サイトへ直接接続できません。次段階で中継方式を追加します。",
          5200
        );
        setStatus("自動取得接続待ち", "warning");
      } else {
        showToast(error.message || "公式データ取得に失敗しました。", 4800);
        setStatus("取得エラー", "danger");
      }
    } finally {
      button.disabled = false;
      button.textContent = "公式データを取得";
    }
  }

  const state = {
    currentPrediction: null,
    currentScreen: "predictionScreen",
    history: [],
    settings: {
      predictionPolicy: "hit-rate",
      dangerSensitivity: "high",
      minimumConfidence: 60,
      autoSaveSetting: "off"
    }
  };

  function $(id) {
    return document.getElementById(id);
  }

  function $all(selector) {
    return [...document.querySelectorAll(selector)];
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (error) {
      console.error("JSONの解析に失敗しました。", error);
      return fallback;
    }
  }

  function setText(id, value) {
    const element = $(id);
    if (element) {
      element.textContent = String(value ?? "");
    }
  }

  function showToast(message, duration = 2800) {
    const toast = $("toast");
    if (!toast) return;

    toast.textContent = message;
    toast.hidden = false;

    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.hidden = true;
    }, duration);
  }

  function setStatus(message, type = "ready") {
    const status = $("systemStatus");
    if (!status) return;

    status.textContent = message;
    status.className = "status-badge";

    if (type === "warning") {
      status.classList.add("status-warning");
    } else if (type === "danger") {
      status.classList.add("status-danger");
    } else {
      status.classList.add("status-ready");
    }
  }

  function formatPercent(value, digits = 1) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0.0%";
    return `${number.toFixed(digits)}%`;
  }

  function formatDateTime(value) {
    if (!value) return "";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function formatCurrency(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";

    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency: "JPY",
      maximumFractionDigits: 0
    }).format(number);
  }

  function loadSettings() {
    const saved = safeJsonParse(
      global.localStorage.getItem(SETTINGS_KEY),
      null
    );

    if (saved && typeof saved === "object") {
      state.settings = {
        ...state.settings,
        ...saved
      };
    }

    $("predictionPolicy").value = state.settings.predictionPolicy;
    $("dangerSensitivity").value = state.settings.dangerSensitivity;
    $("minimumConfidence").value = String(state.settings.minimumConfidence);
    $("autoSaveSetting").value = state.settings.autoSaveSetting;
  }

  function saveSettings() {
    state.settings = {
      predictionPolicy: $("predictionPolicy").value,
      dangerSensitivity: $("dangerSensitivity").value,
      minimumConfidence: Number($("minimumConfidence").value) || 60,
      autoSaveSetting: $("autoSaveSetting").value
    };

    global.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify(state.settings)
    );
  }

  function switchScreen(screenId) {
    $all(".screen").forEach((screen) => {
      const active = screen.id === screenId;
      screen.classList.toggle("is-active", active);
      screen.hidden = !active;
    });

    $all(".nav-button").forEach((button) => {
      button.classList.toggle(
        "is-active",
        button.dataset.screen === screenId
      );
    });

    state.currentScreen = screenId;

    if (screenId === "historyScreen") {
      renderHistory();
    }

    if (screenId === "analysisScreen") {
      renderAnalysis();
    }

    global.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function getRacerInput(lane) {
    return {
      racerName: $(`racerName${lane}`).value.trim(),
      racerClass: $(`racerClass${lane}`).value,
      nationalWinRate: $(`nationalWinRate${lane}`).value,
      localWinRate: $(`localWinRate${lane}`).value,
      coursePlaceRate: $(`coursePlaceRate${lane}`).value,
      motorPlaceRate: $(`motorPlaceRate${lane}`).value,
      boatPlaceRate: $(`boatPlaceRate${lane}`).value,
      averageStart: $(`averageStart${lane}`).value,
      exhibitionTime: $(`exhibitionTime${lane}`).value,
      exhibitionRank: $(`exhibitionRank${lane}`).value,
      weight: $(`weight${lane}`).value,
      adjustWeight: $(`adjustWeight${lane}`).value,
      entryCourse: $(`entryCourse${lane}`).value
    };
  }

  function collectRaceInput() {
    return {
      raceDate: $("raceDate").value,
      raceVenue: $("raceVenue").value,
      raceNumber: $("raceNumber").value,
      raceCategory: $("raceCategory").value,
      deadlineTime: $("deadlineTime").value,
      entryPattern: $("entryPattern").value,
      weather: $("weather").value,
      windDirection: $("windDirection").value,
      windSpeed: $("windSpeed").value,
      waveHeight: $("waveHeight").value,
      airTemperature: $("airTemperature").value,
      waterTemperature: $("waterTemperature").value,
      raceMemo: $("raceMemo").value,
      racers: Array.from({ length: 6 }, (_, index) => {
        return getRacerInput(index + 1);
      })
    };
  }

  function setInputValue(id, value) {
    const element = $(id);
    if (!element) return;

    element.value = value ?? "";
  }

  function fillRaceInput(input) {
    if (!input || typeof input !== "object") return;

    setInputValue("raceDate", input.raceDate);
    setInputValue("raceVenue", input.raceVenue);
    setInputValue("raceNumber", input.raceNumber);
    setInputValue("raceCategory", input.raceCategory || "women");
    setInputValue("deadlineTime", input.deadlineTime);
    setInputValue("entryPattern", input.entryPattern || "枠なり");
    setInputValue("weather", input.weather);
    setInputValue("windDirection", input.windDirection);
    setInputValue("windSpeed", input.windSpeed);
    setInputValue("waveHeight", input.waveHeight);
    setInputValue("airTemperature", input.airTemperature);
    setInputValue("waterTemperature", input.waterTemperature);
    setInputValue("raceMemo", input.raceMemo);

    (input.racers || []).forEach((racer, index) => {
      const lane = index + 1;

      setInputValue(`racerName${lane}`, racer.racerName);
      setInputValue(`racerClass${lane}`, racer.racerClass);
      setInputValue(`nationalWinRate${lane}`, racer.nationalWinRate);
      setInputValue(`localWinRate${lane}`, racer.localWinRate);
      setInputValue(`coursePlaceRate${lane}`, racer.coursePlaceRate);
      setInputValue(`motorPlaceRate${lane}`, racer.motorPlaceRate);
      setInputValue(`boatPlaceRate${lane}`, racer.boatPlaceRate);
      setInputValue(`averageStart${lane}`, racer.averageStart);
      setInputValue(`exhibitionTime${lane}`, racer.exhibitionTime);
      setInputValue(`exhibitionRank${lane}`, racer.exhibitionRank);
      setInputValue(`weight${lane}`, racer.weight);
      setInputValue(`adjustWeight${lane}`, racer.adjustWeight);
      setInputValue(`entryCourse${lane}`, racer.entryCourse || lane);
    });
  }

  function saveLastInput() {
    try {
      global.localStorage.setItem(
        LAST_INPUT_KEY,
        JSON.stringify(collectRaceInput())
      );
    } catch (error) {
      console.error("前回入力の保存に失敗しました。", error);
    }
  }

  function loadLastInput() {
    const saved = safeJsonParse(
      global.localStorage.getItem(LAST_INPUT_KEY),
      null
    );

    if (!saved) {
      showToast("前回入力は保存されていません。");
      return;
    }

    fillRaceInput(saved);
    showToast("前回入力を呼び出しました。");
  }

  function resetRaceInput() {
    const confirmed = global.confirm(
      "現在の入力内容をすべて消去します。よろしいですか？"
    );

    if (!confirmed) return;

    const fields = $all(
      "#predictionScreen input, #predictionScreen select, #predictionScreen textarea"
    );

    fields.forEach((field) => {
      if (field.id === "raceCategory") {
        field.value = "women";
      } else if (field.id === "entryPattern") {
        field.value = "枠なり";
      } else if (field.id.startsWith("entryCourse")) {
        const lane = field.id.replace("entryCourse", "");
        field.value = lane;
      } else if (field.id === "betCount") {
        field.value = "5";
      } else {
        field.value = "";
      }
    });

    state.currentPrediction = null;
    $("predictionResultPanel").hidden = true;
    setText("validationMessage", "");
    setStatus("入力待ち");
    setTodayAsDefault();
  }

  function setTodayAsDefault() {
    if (!$("raceDate").value) {
      const today = new Date();
      const localDate = new Date(
        today.getTime() - (today.getTimezoneOffset() * 60000)
      ).toISOString().slice(0, 10);

      $("raceDate").value = localDate;
    }
  }

  function getPredictionSettings() {
    return {
      policy: state.settings.predictionPolicy,
      dangerSensitivity: state.settings.dangerSensitivity,
      minimumConfidence: state.settings.minimumConfidence,
      betCount: Number($("betCount").value) || 5
    };
  }

  function renderEvaluationTable(evaluations) {
    const body = $("evaluationTableBody");
    body.innerHTML = "";

    evaluations.forEach((item) => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${item.rank}</td>
        <td><strong>${item.lane}号艇</strong></td>
        <td>${escapeHtml(item.racerName)}</td>
        <td>${Number(item.score).toFixed(1)}</td>
        <td>${formatPercent(item.winProbability * 100, 1)}</td>
        <td><span class="badge badge-info">${item.grade}</span></td>
      `;

      body.appendChild(row);
    });
  }

  function renderBets(bets) {
    const container = $("bettingRecommendations");
    container.innerHTML = "";

    bets.forEach((bet) => {
      const item = document.createElement("article");
      item.className = "bet-item";

      item.innerHTML = `
        <span class="bet-item-rank">第${bet.rank}候補</span>
        <strong class="bet-item-combination">${escapeHtml(bet.combination)}</strong>
        <span class="bet-item-score">比重 ${Number(bet.relativeStrength).toFixed(1)}%</span>
      `;

      container.appendChild(item);
    });
  }

  function renderDangerReasons(reasons) {
    const list = $("dangerReasonList");
    list.innerHTML = "";

    reasons.forEach((reason) => {
      const item = document.createElement("li");
      item.textContent = reason;
      list.appendChild(item);
    });
  }

  function renderPrediction(result) {
    state.currentPrediction = result;

    $("predictionResultPanel").hidden = false;

    setText(
      "topPrediction",
      `${result.topPrediction.lane}号艇 ${result.topPrediction.racerName}`
    );
    setText("confidenceScore", formatPercent(result.confidence, 1));
    setText("raceJudgement", result.raceJudgement);
    setText("dangerZoneStatus", result.danger.label);
    setText("predictionGeneratedAt", formatDateTime(result.generatedAt));
    setText("predictionComment", result.comment);

    const dangerElement = $("dangerZoneStatus");
    dangerElement.className = "";

    if (result.danger.level === "high") {
      dangerElement.classList.add("text-danger");
    } else if (result.danger.level === "medium") {
      dangerElement.classList.add("text-warning");
    } else {
      dangerElement.classList.add("text-success");
    }

    renderEvaluationTable(result.evaluations);
    renderBets(result.bets);
    renderDangerReasons(result.danger.reasons);

    $("predictionResultPanel").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function runPrediction() {
    setText("validationMessage", "");
    setStatus("計算中", "warning");

    try {
      if (!global.PredictionEngine) {
        throw new Error("prediction.jsが読み込まれていません。");
      }

      const input = collectRaceInput();
      const result = global.PredictionEngine.runPrediction(
        input,
        getPredictionSettings()
      );

      renderPrediction(result);
      saveLastInput();

      if (result.warnings.length > 0) {
        setText("validationMessage", result.warnings.join(" "));
      }

      if (result.danger.level === "high") {
        setStatus("危険ゾーン高", "danger");
      } else {
        setStatus("予想完了");
      }

      if (state.settings.autoSaveSetting === "on") {
        saveCurrentPrediction(true);
      }
    } catch (error) {
      console.error(error);
      setStatus("入力エラー", "danger");
      setText(
        "validationMessage",
        error.message || "予想計算中にエラーが発生しました。"
      );
    }
  }

  function saveCurrentPrediction(silent = false) {
    if (!state.currentPrediction) {
      showToast("先にAI予想を実行してください。");
      return;
    }

    try {
      if (!global.HistoryManager) {
        throw new Error("history.jsが読み込まれていません。");
      }

      global.HistoryManager.add(state.currentPrediction);

      if (!silent) {
        showToast("予想を履歴に保存しました。");
      }

      renderHistory();
    } catch (error) {
      console.error(error);
      showToast(error.message || "履歴の保存に失敗しました。");
    }
  }

  function refreshHistoryState() {
    state.history = global.HistoryManager
      ? global.HistoryManager.getAll()
      : [];
  }

  function renderHistorySummary() {
    const summary = global.HistoryManager
      ? global.HistoryManager.getSummary(state.history)
      : {
          totalCount: 0,
          settledCount: 0,
          hitCount: 0,
          hitRate: 0
        };

    setText("historyTotalCount", summary.totalCount);
    setText("historySettledCount", summary.settledCount);
    setText("historyHitCount", summary.hitCount);
    setText("historyHitRate", formatPercent(summary.hitRate, 1));
  }

  function renderHistoryVenueOptions() {
    const select = $("historyVenueFilter");
    const current = select.value;
    const venues = global.HistoryManager
      ? global.HistoryManager.getVenueOptions()
      : [];

    select.innerHTML = '<option value="">すべて</option>';

    venues.forEach((venue) => {
      const option = document.createElement("option");
      option.value = venue;
      option.textContent = venue;
      select.appendChild(option);
    });

    select.value = venues.includes(current) ? current : "";
  }

  function getFilteredHistory() {
    if (!global.HistoryManager) return [];

    return global.HistoryManager.filterHistory({
      venue: $("historyVenueFilter").value,
      result: $("historyResultFilter").value
    });
  }

  function createHistoryActionButton(label, className, action, id) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.id = id;
    return button;
  }

  function renderHistoryTable() {
    const history = getFilteredHistory();
    const table = $("historyTable");
    const body = $("historyTableBody");
    const empty = $("historyEmptyState");

    body.innerHTML = "";

    if (history.length === 0) {
      table.hidden = true;
      empty.hidden = false;
      return;
    }

    table.hidden = false;
    empty.hidden = true;

    history.forEach((record) => {
      const prediction = record.prediction;
      const input = prediction.input || {};
      const result = record.actualResult;
      const settlement = record.settlement;

      const row = document.createElement("tr");

      const resultText = result
        ? result.combination
        : "未入力";

      let judgement = '<span class="badge badge-warning">未入力</span>';

      if (settlement?.status === "hit") {
        judgement = '<span class="badge badge-success">的中</span>';
      } else if (settlement?.status === "miss") {
        judgement = '<span class="badge badge-danger">不的中</span>';
      }

      row.innerHTML = `
        <td>${escapeHtml(input.raceDate || "-")}</td>
        <td>${escapeHtml(input.raceVenue || "-")}</td>
        <td>${escapeHtml(String(input.raceNumber || "-"))}R</td>
        <td>${prediction.topPrediction?.lane || "-"}号艇</td>
        <td>${formatPercent(prediction.confidence || 0, 1)}</td>
        <td>${escapeHtml(resultText)}</td>
        <td>${judgement}</td>
        <td class="history-action-cell"></td>
      `;

      const actionCell = row.querySelector(".history-action-cell");

      actionCell.appendChild(
        createHistoryActionButton(
          result ? "結果修正" : "結果入力",
          "secondary-button",
          "result",
          record.id
        )
      );

      actionCell.appendChild(
        createHistoryActionButton(
          "削除",
          "danger-button",
          "delete",
          record.id
        )
      );

      body.appendChild(row);
    });
  }

  function renderHistory() {
    if (!global.HistoryManager) return;

    refreshHistoryState();
    renderHistorySummary();
    renderHistoryVenueOptions();
    renderHistoryTable();
  }

  function clearAllHistory() {
    if (!global.HistoryManager) return;

    const confirmed = global.confirm(
      "保存されている履歴をすべて削除します。この操作は元に戻せません。"
    );

    if (!confirmed) return;

    global.HistoryManager.clear();
    renderHistory();
    renderAnalysis();
    showToast("履歴をすべて削除しました。");
  }

  function deleteHistory(id) {
    if (!global.HistoryManager) return;

    const confirmed = global.confirm(
      "この履歴を削除します。よろしいですか？"
    );

    if (!confirmed) return;

    global.HistoryManager.remove(id);
    renderHistory();
    renderAnalysis();
    showToast("履歴を削除しました。");
  }

  function openResultDialog(id) {
    const record = global.HistoryManager?.getById(id);

    if (!record) {
      showToast("対象の履歴が見つかりません。");
      return;
    }

    $("resultHistoryId").value = id;
    $("actualFirst").value = record.actualResult?.first || "";
    $("actualSecond").value = record.actualResult?.second || "";
    $("actualThird").value = record.actualResult?.third || "";
    $("payoutAmount").value = record.actualResult?.payoutAmount ?? "";
    setText("resultInputMessage", "");

    $("resultInputDialog").showModal();
  }

  function closeResultDialog() {
    $("resultInputDialog").close();
  }

  function saveActualResult(event) {
    event.preventDefault();

    const id = $("resultHistoryId").value;

    try {
      const updated = global.HistoryManager.updateResult(id, {
        first: $("actualFirst").value,
        second: $("actualSecond").value,
        third: $("actualThird").value,
        payoutAmount: $("payoutAmount").value
      });

      closeResultDialog();
      renderHistory();
      renderAnalysis();

      showToast(
        updated.settlement.status === "hit"
          ? "的中として保存しました。"
          : "結果を保存しました。"
      );
    } catch (error) {
      console.error(error);
      setText(
        "resultInputMessage",
        error.message || "結果の保存に失敗しました。"
      );
    }
  }

  function renderVenueAnalysis(rows) {
    const table = $("venueAnalysisTable");
    const body = $("venueAnalysisTableBody");
    const empty = $("venueAnalysisEmpty");

    body.innerHTML = "";

    if (!rows.length) {
      table.hidden = true;
      empty.hidden = false;
      return;
    }

    table.hidden = false;
    empty.hidden = true;

    rows.forEach((item) => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${escapeHtml(item.venue)}</td>
        <td>${item.settledCount}</td>
        <td>${item.hitCount}</td>
        <td>${formatPercent(item.hitRate, 1)}</td>
      `;

      body.appendChild(row);
    });
  }

  function renderLaneAnalysis(rows) {
    const table = $("laneAnalysisTable");
    const body = $("laneAnalysisTableBody");
    const empty = $("laneAnalysisEmpty");

    body.innerHTML = "";

    if (!rows.length) {
      table.hidden = true;
      empty.hidden = false;
      return;
    }

    table.hidden = false;
    empty.hidden = true;

    rows.forEach((item) => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${item.lane}号艇</td>
        <td>${item.settledCount}</td>
        <td>${item.hitCount}</td>
        <td>${formatPercent(item.hitRate, 1)}</td>
      `;

      body.appendChild(row);
    });
  }

  function renderAnalysis() {
    if (!global.AnalysisEngine || !global.HistoryManager) return;

    const history = global.HistoryManager.getAll();
    const report = global.AnalysisEngine.createReport(history);

    setText(
      "analysisOverallHitRate",
      formatPercent(report.overall.hitRate, 1)
    );
    setText(
      "analysisWomenHitRate",
      formatPercent(report.womenHitRate, 1)
    );
    setText(
      "analysisDangerAvoidanceRate",
      formatPercent(report.dangerAvoidanceRate, 1)
    );
    setText(
      "analysisAverageConfidence",
      formatPercent(report.averageConfidence, 1)
    );
    setText("analysisComment", report.comment);

    renderVenueAnalysis(
      report.byVenue.filter((item) => item.settledCount > 0)
    );
    renderLaneAnalysis(
      report.byTopLane.filter((item) => item.settledCount > 0)
    );
  }

  function openSettingsDialog() {
    $("predictionPolicy").value = state.settings.predictionPolicy;
    $("dangerSensitivity").value = state.settings.dangerSensitivity;
    $("minimumConfidence").value = String(state.settings.minimumConfidence);
    $("autoSaveSetting").value = state.settings.autoSaveSetting;
    $("settingsDialog").showModal();
  }

  function closeSettingsDialog() {
    $("settingsDialog").close();
  }

  function submitSettings(event) {
    event.preventDefault();
    saveSettings();
    closeSettingsDialog();
    showToast("設定を保存しました。");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function bindEvents() {
    $all(".nav-button").forEach((button) => {
      button.addEventListener("click", () => {
        switchScreen(button.dataset.screen);
      });
    });

    $("runPredictionButton").addEventListener("click", runPrediction);
    $("savePredictionButton").addEventListener(
      "click",
      () => saveCurrentPrediction(false)
    );
    $("resetRaceButton").addEventListener("click", resetRaceInput);
    $("copyPreviousRaceButton").addEventListener("click", loadLastInput);
    $("importDataButton").addEventListener("click", importOfficialData);

    $("historyVenueFilter").addEventListener("change", renderHistoryTable);
    $("historyResultFilter").addEventListener("change", renderHistoryTable);
    $("clearHistoryButton").addEventListener("click", clearAllHistory);

    $("historyTableBody").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const id = button.dataset.id;
      const action = button.dataset.action;

      if (action === "result") {
        openResultDialog(id);
      }

      if (action === "delete") {
        deleteHistory(id);
      }
    });

    $("resultInputForm").addEventListener("submit", saveActualResult);
    $("closeResultDialogButton").addEventListener(
      "click",
      closeResultDialog
    );
    $("cancelResultButton").addEventListener(
      "click",
      closeResultDialog
    );

    $("openSettingsButton").addEventListener(
      "click",
      openSettingsDialog
    );
    $("settingsForm").addEventListener("submit", submitSettings);
    $("closeSettingsButton").addEventListener(
      "click",
      closeSettingsDialog
    );
    $("cancelSettingsButton").addEventListener(
      "click",
      closeSettingsDialog
    );

    $("refreshAnalysisButton").addEventListener(
      "click",
      renderAnalysis
    );

    $("betCount").addEventListener("change", () => {
      if (state.currentPrediction) {
        runPrediction();
      }
    });

    global.addEventListener("beforeunload", saveLastInput);
  }

  function verifyModules() {
    const missing = [];

    if (!global.PredictionEngine) missing.push("prediction.js");
    if (!global.HistoryManager) missing.push("history.js");
    if (!global.AnalysisEngine) missing.push("analysis.js");

    if (missing.length > 0) {
      setStatus("ファイル不足", "danger");
      setText(
        "validationMessage",
        `必要なファイルが読み込まれていません: ${missing.join(", ")}`
      );
      return false;
    }

    return true;
  }

  function initialize() {
    setText("appVersion", `Version ${APP_VERSION}`);
    const importButton = $("importDataButton");
    if (importButton) {
      importButton.disabled = false;
      importButton.textContent = "公式データを取得";
    }
    setTodayAsDefault();
    loadSettings();
    bindEvents();

    if (!verifyModules()) {
      return;
    }

    if (!global.HistoryManager.isStorageAvailable()) {
      setStatus("保存不可", "danger");
      showToast("このブラウザでは履歴保存を利用できません。");
    } else {
      setStatus("入力待ち");
    }

    renderHistory();
    renderAnalysis();
  }

  document.addEventListener("DOMContentLoaded", initialize);
})(window);

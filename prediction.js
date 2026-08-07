/* =========================================================
   358BoardAI
   prediction.js
   Version 1.0.0

   役割:
   - 入力データの正規化
   - 選手・モーター・コース・展示の評価
   - 女子レース補正
   - 危険ゾーン判定
   - 1着確率の推定
   - 3連単買い目の生成
   ========================================================= */

"use strict";

(function initializePredictionModule(global) {
  const MODULE_VERSION = "1.0.0";

  const CLASS_SCORE = Object.freeze({
    A1: 100,
    A2: 82,
    B1: 62,
    B2: 45
  });

  const DEFAULT_SETTINGS = Object.freeze({
    policy: "hit-rate",
    dangerSensitivity: "high",
    minimumConfidence: 60,
    betCount: 5
  });

  const VENUE_CHARACTERISTICS = Object.freeze({
    桐生: { inside: 1.05, outside: 0.95 },
    戸田: { inside: 0.92, outside: 1.08 },
    江戸川: { inside: 0.90, outside: 1.10 },
    平和島: { inside: 0.96, outside: 1.04 },
    多摩川: { inside: 1.01, outside: 0.99 },
    浜名湖: { inside: 1.00, outside: 1.00 },
    蒲郡: { inside: 1.06, outside: 0.94 },
    常滑: { inside: 1.04, outside: 0.96 },
    津: { inside: 1.02, outside: 0.98 },
    三国: { inside: 1.01, outside: 0.99 },
    びわこ: { inside: 0.98, outside: 1.02 },
    住之江: { inside: 1.07, outside: 0.93 },
    尼崎: { inside: 1.02, outside: 0.98 },
    鳴門: { inside: 0.98, outside: 1.02 },
    丸亀: { inside: 1.03, outside: 0.97 },
    児島: { inside: 1.04, outside: 0.96 },
    宮島: { inside: 1.00, outside: 1.00 },
    徳山: { inside: 1.08, outside: 0.92 },
    下関: { inside: 1.05, outside: 0.95 },
    若松: { inside: 1.02, outside: 0.98 },
    芦屋: { inside: 1.07, outside: 0.93 },
    福岡: { inside: 0.97, outside: 1.03 },
    唐津: { inside: 1.03, outside: 0.97 },
    大村: { inside: 1.10, outside: 0.90 }
  });

  const SCORE_WEIGHTS = Object.freeze({
    nationalWinRate: 0.18,
    localWinRate: 0.08,
    classScore: 0.08,
    coursePlaceRate: 0.18,
    motorPlaceRate: 0.14,
    boatPlaceRate: 0.05,
    averageStart: 0.12,
    exhibitionTime: 0.08,
    exhibitionRank: 0.05,
    laneBase: 0.04
  });

  const LANE_BASE_SCORE = Object.freeze({
    1: 100,
    2: 78,
    3: 70,
    4: 63,
    5: 53,
    6: 44
  });

  function toFiniteNumber(value, fallback = null) {
    if (value === "" || value === null || typeof value === "undefined") {
      return fallback;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function round(value, digits = 1) {
    const scale = 10 ** digits;
    return Math.round((value + Number.EPSILON) * scale) / scale;
  }

  function normalize(value, minimum, maximum, reverse = false) {
    if (!Number.isFinite(value) || maximum <= minimum) {
      return 0;
    }

    const ratio = clamp((value - minimum) / (maximum - minimum), 0, 1);
    return (reverse ? 1 - ratio : ratio) * 100;
  }

  function average(values) {
    const valid = values.filter(Number.isFinite);
    if (valid.length === 0) {
      return null;
    }

    return valid.reduce((sum, current) => sum + current, 0) / valid.length;
  }

  function standardDeviation(values) {
    const valid = values.filter(Number.isFinite);
    if (valid.length < 2) {
      return 0;
    }

    const mean = average(valid);
    const variance = valid.reduce((sum, value) => {
      return sum + ((value - mean) ** 2);
    }, 0) / valid.length;

    return Math.sqrt(variance);
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function getVenueFactor(venue, course) {
    const characteristics = VENUE_CHARACTERISTICS[venue] || {
      inside: 1,
      outside: 1
    };

    if (course === 1) {
      return characteristics.inside;
    }

    if (course >= 4) {
      return characteristics.outside;
    }

    return 1;
  }

  function getWindCourseAdjustment(course, windDirection, windSpeed) {
    if (!Number.isFinite(windSpeed) || windSpeed < 3) {
      return 0;
    }

    let adjustment = 0;

    if (windDirection === "向かい風") {
      if (course === 1) adjustment -= windSpeed * 0.8;
      if (course === 3 || course === 4) adjustment += windSpeed * 0.45;
    }

    if (windDirection === "追い風") {
      if (course === 1) adjustment += windSpeed * 0.35;
      if (course >= 5) adjustment -= windSpeed * 0.35;
    }

    if (windDirection === "左横風" || windDirection === "右横風") {
      if (course >= 4) adjustment -= windSpeed * 0.18;
    }

    return adjustment;
  }

  function getWaveAdjustment(course, waveHeight) {
    if (!Number.isFinite(waveHeight) || waveHeight < 5) {
      return 0;
    }

    if (course === 1) {
      return -Math.min(7, waveHeight * 0.12);
    }

    if (course >= 5) {
      return -Math.min(5, waveHeight * 0.08);
    }

    return -Math.min(3, waveHeight * 0.05);
  }

  function normalizeRacer(rawRacer, lane) {
    const entryCourse = clamp(
      Math.trunc(toFiniteNumber(rawRacer.entryCourse, lane)),
      1,
      6
    );

    return {
      lane,
      racerName: String(rawRacer.racerName || "").trim(),
      racerClass: String(rawRacer.racerClass || "").trim(),
      nationalWinRate: toFiniteNumber(rawRacer.nationalWinRate),
      localWinRate: toFiniteNumber(rawRacer.localWinRate),
      coursePlaceRate: toFiniteNumber(rawRacer.coursePlaceRate),
      motorPlaceRate: toFiniteNumber(rawRacer.motorPlaceRate),
      boatPlaceRate: toFiniteNumber(rawRacer.boatPlaceRate),
      averageStart: toFiniteNumber(rawRacer.averageStart),
      exhibitionTime: toFiniteNumber(rawRacer.exhibitionTime),
      exhibitionRank: toFiniteNumber(rawRacer.exhibitionRank),
      weight: toFiniteNumber(rawRacer.weight),
      adjustWeight: toFiniteNumber(rawRacer.adjustWeight, 0),
      entryCourse
    };
  }

  function normalizeRaceInput(rawInput) {
    const racers = Array.from({ length: 6 }, (_, index) => {
      const lane = index + 1;
      return normalizeRacer(rawInput.racers?.[index] || {}, lane);
    });

    return {
      raceDate: String(rawInput.raceDate || ""),
      raceVenue: String(rawInput.raceVenue || ""),
      raceNumber: toFiniteNumber(rawInput.raceNumber),
      raceCategory: String(rawInput.raceCategory || "women"),
      deadlineTime: String(rawInput.deadlineTime || ""),
      entryPattern: String(rawInput.entryPattern || "枠なり"),
      weather: String(rawInput.weather || ""),
      windDirection: String(rawInput.windDirection || ""),
      windSpeed: toFiniteNumber(rawInput.windSpeed, 0),
      waveHeight: toFiniteNumber(rawInput.waveHeight, 0),
      airTemperature: toFiniteNumber(rawInput.airTemperature),
      waterTemperature: toFiniteNumber(rawInput.waterTemperature),
      raceMemo: String(rawInput.raceMemo || "").trim(),
      racers
    };
  }

  function validateRaceInput(rawInput) {
    const input = normalizeRaceInput(rawInput);
    const errors = [];
    const warnings = [];

    if (!input.raceDate) {
      errors.push("開催日を入力してください。");
    }

    if (!input.raceVenue) {
      errors.push("開催場を選択してください。");
    }

    if (!Number.isInteger(input.raceNumber) || input.raceNumber < 1 || input.raceNumber > 12) {
      errors.push("レース番号を1Rから12Rの範囲で選択してください。");
    }

    const racerNames = input.racers.map((racer) => racer.racerName);

    if (racerNames.some((name) => !name)) {
      errors.push("6艇すべての選手名を入力してください。");
    }

    const duplicateNames = racerNames.filter((name, index) => {
      return name && racerNames.indexOf(name) !== index;
    });

    if (duplicateNames.length > 0) {
      warnings.push("同じ選手名が複数入力されています。入力内容を確認してください。");
    }

    const entryCourses = input.racers.map((racer) => racer.entryCourse);

    if (unique(entryCourses).length !== 6) {
      errors.push("進入コースは1から6を重複せず入力してください。");
    }

    input.racers.forEach((racer) => {
      const prefix = `${racer.lane}号艇`;

      if (!CLASS_SCORE[racer.racerClass]) {
        errors.push(`${prefix}の級別を選択してください。`);
      }

      if (!Number.isFinite(racer.nationalWinRate)) {
        errors.push(`${prefix}の全国勝率を入力してください。`);
      }

      if (!Number.isFinite(racer.coursePlaceRate)) {
        errors.push(`${prefix}のコース別2連対率を入力してください。`);
      }

      if (!Number.isFinite(racer.motorPlaceRate)) {
        errors.push(`${prefix}のモーター2連対率を入力してください。`);
      }

      if (!Number.isFinite(racer.averageStart)) {
        errors.push(`${prefix}の平均STを入力してください。`);
      }

      if (!Number.isFinite(racer.exhibitionTime)) {
        errors.push(`${prefix}の展示タイムを入力してください。`);
      }

      if (!Number.isFinite(racer.exhibitionRank)) {
        errors.push(`${prefix}の展示順位を入力してください。`);
      }

      if (Number.isFinite(racer.nationalWinRate) &&
          (racer.nationalWinRate < 0 || racer.nationalWinRate > 10)) {
        errors.push(`${prefix}の全国勝率は0から10で入力してください。`);
      }

      if (Number.isFinite(racer.localWinRate) &&
          (racer.localWinRate < 0 || racer.localWinRate > 10)) {
        errors.push(`${prefix}の当地勝率は0から10で入力してください。`);
      }

      [
        ["コース別2連対率", racer.coursePlaceRate],
        ["モーター2連対率", racer.motorPlaceRate],
        ["ボート2連対率", racer.boatPlaceRate]
      ].forEach(([label, value]) => {
        if (Number.isFinite(value) && (value < 0 || value > 100)) {
          errors.push(`${prefix}の${label}は0から100で入力してください。`);
        }
      });

      if (Number.isFinite(racer.averageStart) &&
          (racer.averageStart < 0 || racer.averageStart > 1)) {
        errors.push(`${prefix}の平均STは0から1で入力してください。`);
      }

      if (Number.isFinite(racer.exhibitionRank) &&
          (!Number.isInteger(racer.exhibitionRank) ||
           racer.exhibitionRank < 1 ||
           racer.exhibitionRank > 6)) {
        errors.push(`${prefix}の展示順位は1から6で入力してください。`);
      }
    });

    if (input.raceCategory !== "women") {
      warnings.push("女子レース特化補正は男女混合レースでは弱めに適用されます。");
    }

    if (input.entryPattern === "進入変化あり" || input.entryPattern === "不明") {
      warnings.push("進入が不確定なため、コース評価の信頼度が下がります。");
    }

    if (input.windSpeed >= 6) {
      warnings.push("強風条件です。スタートと展開の再現性が下がる可能性があります。");
    }

    if (input.waveHeight >= 10) {
      warnings.push("波高が高く、展示タイムだけでは判断しにくい条件です。");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      input
    };
  }

  function calculateExhibitionScore(racer, racers) {
    const times = racers.map((item) => item.exhibitionTime).filter(Number.isFinite);
    const minimum = Math.min(...times);
    const maximum = Math.max(...times);

    const timeScore = minimum === maximum
      ? 70
      : normalize(racer.exhibitionTime, minimum, maximum, true);

    const rankScore = normalize(racer.exhibitionRank, 1, 6, true);

    return {
      timeScore,
      rankScore,
      combined: (timeScore * 0.62) + (rankScore * 0.38)
    };
  }

  function calculateStartScore(averageStart) {
    if (!Number.isFinite(averageStart)) {
      return 0;
    }

    if (averageStart <= 0.10) return 100;
    if (averageStart <= 0.13) return 92;
    if (averageStart <= 0.15) return 84;
    if (averageStart <= 0.17) return 74;
    if (averageStart <= 0.19) return 63;
    if (averageStart <= 0.22) return 50;
    return clamp(50 - ((averageStart - 0.22) * 120), 20, 50);
  }

  function calculateWomenRaceAdjustment(racer, input) {
    if (input.raceCategory !== "women") {
      return 0;
    }

    let adjustment = 0;

    if (racer.weight !== null) {
      const actualWeight = racer.weight + (racer.adjustWeight || 0);

      if (actualWeight <= 47.0) adjustment += 2.2;
      else if (actualWeight <= 49.0) adjustment += 1.2;
      else if (actualWeight >= 53.0) adjustment -= 1.2;
    }

    if (racer.averageStart !== null && racer.averageStart <= 0.15) {
      adjustment += 1.4;
    }

    if (racer.exhibitionRank !== null && racer.exhibitionRank <= 2) {
      adjustment += 1.2;
    }

    if (racer.entryCourse === 1 && racer.coursePlaceRate >= 60) {
      adjustment += 1.8;
    }

    return adjustment;
  }

  function calculateRacerScore(racer, input) {
    const exhibition = calculateExhibitionScore(racer, input.racers);
    const classScore = CLASS_SCORE[racer.racerClass] || 0;
    const localWinRate = Number.isFinite(racer.localWinRate)
      ? racer.localWinRate
      : racer.nationalWinRate;

    const baseComponents = {
      nationalWinRate: normalize(racer.nationalWinRate, 2.5, 8.5),
      localWinRate: normalize(localWinRate, 2.5, 8.5),
      classScore,
      coursePlaceRate: normalize(racer.coursePlaceRate, 5, 85),
      motorPlaceRate: normalize(racer.motorPlaceRate, 15, 60),
      boatPlaceRate: Number.isFinite(racer.boatPlaceRate)
        ? normalize(racer.boatPlaceRate, 15, 60)
        : 50,
      averageStart: calculateStartScore(racer.averageStart),
      exhibitionTime: exhibition.timeScore,
      exhibitionRank: exhibition.rankScore,
      laneBase: LANE_BASE_SCORE[racer.entryCourse] || 40
    };

    const weightedBase = Object.entries(SCORE_WEIGHTS).reduce((total, [key, weight]) => {
      return total + (baseComponents[key] * weight);
    }, 0);

    const venueFactor = getVenueFactor(input.raceVenue, racer.entryCourse);
    const womenAdjustment = calculateWomenRaceAdjustment(racer, input);
    const windAdjustment = getWindCourseAdjustment(
      racer.entryCourse,
      input.windDirection,
      input.windSpeed
    );
    const waveAdjustment = getWaveAdjustment(racer.entryCourse, input.waveHeight);

    let entryAdjustment = 0;

    if (input.entryPattern === "進入変化あり") {
      entryAdjustment = -1.5;
    } else if (input.entryPattern === "不明") {
      entryAdjustment = -2.5;
    }

    const finalScore = clamp(
      (weightedBase * venueFactor) +
      womenAdjustment +
      windAdjustment +
      waveAdjustment +
      entryAdjustment,
      1,
      100
    );

    return {
      lane: racer.lane,
      entryCourse: racer.entryCourse,
      racerName: racer.racerName,
      racerClass: racer.racerClass,
      score: round(finalScore, 2),
      components: {
        ...baseComponents,
        exhibitionCombined: exhibition.combined,
        venueFactor,
        womenAdjustment,
        windAdjustment,
        waveAdjustment,
        entryAdjustment
      }
    };
  }

  function softmax(scores, temperature = 13) {
    const maximum = Math.max(...scores);
    const exponentials = scores.map((score) => {
      return Math.exp((score - maximum) / temperature);
    });
    const total = exponentials.reduce((sum, value) => sum + value, 0);

    return exponentials.map((value) => value / total);
  }

  function determineGrade(score, probability) {
    if (score >= 85 && probability >= 0.35) return "S";
    if (score >= 78) return "A";
    if (score >= 68) return "B";
    if (score >= 58) return "C";
    return "D";
  }

  function calculateConfidence(evaluations, dangerResult, input, settings) {
    const sortedScores = evaluations
      .map((item) => item.score)
      .sort((a, b) => b - a);

    const scoreGap = sortedScores[0] - sortedScores[1];
    const topProbability = evaluations[0]?.winProbability || 0;
    const spread = standardDeviation(sortedScores);

    let confidence =
      42 +
      (scoreGap * 2.25) +
      (topProbability * 48) +
      (spread * 0.45);

    if (dangerResult.level === "high") confidence -= 18;
    if (dangerResult.level === "medium") confidence -= 8;

    if (input.entryPattern === "進入変化あり") confidence -= 5;
    if (input.entryPattern === "不明") confidence -= 8;
    if (input.windSpeed >= 6) confidence -= 5;
    if (input.waveHeight >= 10) confidence -= 5;

    if (settings.policy === "hit-rate") {
      confidence -= 2;
    }

    return round(clamp(confidence, 15, 95), 1);
  }

  function detectDangerZone(evaluations, input, settings) {
    const reasons = [];
    let dangerPoints = 0;

    const sorted = [...evaluations].sort((a, b) => b.score - a.score);
    const top = sorted[0];
    const second = sorted[1];
    const firstCourseRacer = evaluations.find((item) => item.entryCourse === 1);

    const topGap = top.score - second.score;

    if (topGap < 3.5) {
      dangerPoints += 3;
      reasons.push("上位2艇の評価差が小さく、本命を1艇に絞りにくい状態です。");
    } else if (topGap < 6) {
      dangerPoints += 1;
      reasons.push("上位艇の評価差が小さめです。");
    }

    if (firstCourseRacer) {
      if (firstCourseRacer.components.coursePlaceRate < 55) {
        dangerPoints += 3;
        reasons.push("1コース艇のコース別2連対率が低めです。");
      }

      if (firstCourseRacer.components.averageStart < 58) {
        dangerPoints += 2;
        reasons.push("1コース艇の平均ST評価が低く、逃げ遅れの注意が必要です。");
      }

      if (firstCourseRacer.components.exhibitionCombined < 45) {
        dangerPoints += 2;
        reasons.push("1コース艇の展示評価が低めです。");
      }
    }

    const strongMotorCount = evaluations.filter((item) => {
      return item.components.motorPlaceRate >= 78;
    }).length;

    if (strongMotorCount >= 3) {
      dangerPoints += 1;
      reasons.push("モーター評価の高い艇が複数あり、展開が割れやすい状態です。");
    }

    if (input.entryPattern === "進入変化あり") {
      dangerPoints += 3;
      reasons.push("進入変化があり、枠番通りの展開にならない可能性があります。");
    }

    if (input.entryPattern === "不明") {
      dangerPoints += 4;
      reasons.push("進入が不明で、コース評価の信頼性が下がっています。");
    }

    if (input.windSpeed >= 6) {
      dangerPoints += 2;
      reasons.push("風速6m以上でスタートと旋回への影響が大きい条件です。");
    }

    if (input.waveHeight >= 10) {
      dangerPoints += 2;
      reasons.push("波高10cm以上で水面が不安定です。");
    }

    const exhibitionTimes = input.racers
      .map((racer) => racer.exhibitionTime)
      .filter(Number.isFinite);

    if (exhibitionTimes.length === 6) {
      const timeSpread = Math.max(...exhibitionTimes) - Math.min(...exhibitionTimes);

      if (timeSpread < 0.08) {
        dangerPoints += 1;
        reasons.push("展示タイム差が小さく、機力差を判断しにくい状態です。");
      }
    }

    if (settings.dangerSensitivity === "high") {
      dangerPoints += 1;
    } else if (settings.dangerSensitivity === "low") {
      dangerPoints -= 1;
    }

    dangerPoints = Math.max(0, dangerPoints);

    let level = "low";
    let label = "低";

    if (dangerPoints >= 7) {
      level = "high";
      label = "高";
    } else if (dangerPoints >= 4) {
      level = "medium";
      label = "中";
    }

    if (reasons.length === 0) {
      reasons.push("大きな危険要因は検出されませんでした。");
    }

    return {
      level,
      label,
      points: dangerPoints,
      reasons
    };
  }

  function calculateConditionalFinishProbabilities(evaluations, firstLane) {
    const remaining = evaluations.filter((item) => item.lane !== firstLane);
    const probabilities = softmax(
      remaining.map((item) => item.score),
      15
    );

    return remaining.map((item, index) => ({
      lane: item.lane,
      probability: probabilities[index]
    }));
  }

  function generateTrifectaCandidates(evaluations) {
    const candidates = [];

    evaluations.forEach((first) => {
      const secondProbabilities = calculateConditionalFinishProbabilities(
        evaluations,
        first.lane
      );

      secondProbabilities.forEach((second) => {
        const thirdPool = evaluations.filter((item) => {
          return item.lane !== first.lane && item.lane !== second.lane;
        });

        const thirdProbabilities = softmax(
          thirdPool.map((item) => item.score),
          17
        );

        thirdPool.forEach((third, index) => {
          const probability =
            first.winProbability *
            second.probability *
            thirdProbabilities[index];

          candidates.push({
            first: first.lane,
            second: second.lane,
            third: third.lane,
            combination: `${first.lane}-${second.lane}-${third.lane}`,
            probability
          });
        });
      });
    });

    return candidates.sort((a, b) => b.probability - a.probability);
  }

  function selectDiversifiedBets(candidates, count, dangerLevel) {
    const selected = [];
    const topFirstLanes = [];

    for (const candidate of candidates) {
      if (selected.length >= count) {
        break;
      }

      const sameFirstCount = selected.filter((item) => {
        return item.first === candidate.first;
      }).length;

      const maximumSameFirst = dangerLevel === "high"
        ? Math.ceil(count * 0.45)
        : Math.ceil(count * 0.7);

      if (sameFirstCount >= maximumSameFirst) {
        continue;
      }

      selected.push(candidate);
      topFirstLanes.push(candidate.first);
    }

    if (selected.length < count) {
      for (const candidate of candidates) {
        if (selected.length >= count) {
          break;
        }

        if (!selected.some((item) => item.combination === candidate.combination)) {
          selected.push(candidate);
        }
      }
    }

    const totalProbability = selected.reduce((sum, item) => {
      return sum + item.probability;
    }, 0);

    return selected.map((item, index) => ({
      rank: index + 1,
      ...item,
      relativeStrength: totalProbability > 0
        ? round((item.probability / totalProbability) * 100, 1)
        : 0,
      estimatedProbability: round(item.probability * 100, 2)
    }));
  }

  function buildAnalysisComment(evaluations, dangerResult, input, confidence) {
    const top = evaluations[0];
    const second = evaluations[1];
    const third = evaluations[2];
    const comments = [];

    comments.push(
      `総合評価1位は${top.lane}号艇 ${top.racerName}で、` +
      `1着推定確率は${round(top.winProbability * 100, 1)}%です。`
    );

    if (top.entryCourse === 1) {
      comments.push("1コース艇が総合評価首位で、逃げを中心に組み立てます。");
    } else {
      comments.push(
        `${top.entryCourse}コース想定の${top.lane}号艇が1コース艇を上回っており、` +
        "センター・外側からの攻めを警戒します。"
      );
    }

    comments.push(
      `相手本線は${second.lane}号艇、次点は${third.lane}号艇です。`
    );

    if (dangerResult.level === "high") {
      comments.push(
        "危険ゾーンは高判定です。本命固定を避け、見送りも含めて慎重に判断してください。"
      );
    } else if (dangerResult.level === "medium") {
      comments.push(
        "危険ゾーンは中判定です。買い目を絞りすぎず、直前気配を再確認してください。"
      );
    } else {
      comments.push(
        "危険ゾーンは低判定ですが、確実な的中を保証するものではありません。"
      );
    }

    if (confidence < 60) {
      comments.push(
        "信頼度が低いため、的中率重視の設定では見送り候補です。"
      );
    }

    if (input.raceCategory === "women") {
      comments.push(
        "女子レース補正として、体重・平均ST・展示順位・1コース適性を追加評価しています。"
      );
    }

    return comments.join("\n");
  }

  function determineRaceJudgement(confidence, dangerLevel, minimumConfidence) {
    if (dangerLevel === "high" || confidence < minimumConfidence - 8) {
      return "見送り推奨";
    }

    if (dangerLevel === "medium" || confidence < minimumConfidence) {
      return "慎重";
    }

    if (confidence >= 75 && dangerLevel === "low") {
      return "勝負候補";
    }

    return "購入候補";
  }

  function runPrediction(rawInput, rawSettings = {}) {
    const validation = validateRaceInput(rawInput);

    if (!validation.valid) {
      const error = new Error(validation.errors.join("\n"));
      error.name = "PredictionValidationError";
      error.details = validation;
      throw error;
    }

    const settings = {
      ...DEFAULT_SETTINGS,
      ...rawSettings
    };

    const input = validation.input;

    const scored = input.racers.map((racer) => {
      return calculateRacerScore(racer, input);
    });

    const winProbabilities = softmax(
      scored.map((item) => item.score),
      settings.policy === "hit-rate" ? 11.5 : 13.5
    );

    let evaluations = scored.map((item, index) => ({
      ...item,
      winProbability: winProbabilities[index]
    }));

    evaluations = evaluations
      .sort((a, b) => b.score - a.score)
      .map((item, index) => ({
        ...item,
        rank: index + 1,
        grade: determineGrade(item.score, item.winProbability)
      }));

    const danger = detectDangerZone(evaluations, input, settings);
    const confidence = calculateConfidence(
      evaluations,
      danger,
      input,
      settings
    );

    const betCount = clamp(
      Math.trunc(toFiniteNumber(settings.betCount, DEFAULT_SETTINGS.betCount)),
      1,
      20
    );

    const trifectaCandidates = generateTrifectaCandidates(evaluations);
    const bets = selectDiversifiedBets(
      trifectaCandidates,
      betCount,
      danger.level
    );

    const raceJudgement = determineRaceJudgement(
      confidence,
      danger.level,
      toFiniteNumber(
        settings.minimumConfidence,
        DEFAULT_SETTINGS.minimumConfidence
      )
    );

    const comment = buildAnalysisComment(
      evaluations,
      danger,
      input,
      confidence
    );

    return {
      moduleVersion: MODULE_VERSION,
      generatedAt: new Date().toISOString(),
      input,
      settings,
      warnings: validation.warnings,
      evaluations,
      topPrediction: evaluations[0],
      confidence,
      raceJudgement,
      danger,
      bets,
      comment
    };
  }

  function createEmptyResult() {
    return {
      moduleVersion: MODULE_VERSION,
      generatedAt: null,
      input: null,
      settings: { ...DEFAULT_SETTINGS },
      warnings: [],
      evaluations: [],
      topPrediction: null,
      confidence: 0,
      raceJudgement: "未実行",
      danger: {
        level: "low",
        label: "低",
        points: 0,
        reasons: []
      },
      bets: [],
      comment: ""
    };
  }

  global.PredictionEngine = Object.freeze({
    version: MODULE_VERSION,
    defaultSettings: { ...DEFAULT_SETTINGS },
    normalizeRaceInput,
    validateRaceInput,
    runPrediction,
    createEmptyResult
  });
})(window);

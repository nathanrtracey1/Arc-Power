/**
 * Address-bar-style scoring: tiered ranking (exact > prefix > word-start > acronym > fuzzy).
 * Title weight 0.7, URL weight 0.3. Frecency is applied in command-content.js.
 */

var WORD_BOUNDARY = /[\s\/.\-_]+/;

/** Score for acronym/initialism: pattern "gh" matches "GitHub" (first letters of words). */
function scoreAcronym(pattern, str) {
  pattern = String(pattern || "").trim().toLowerCase();
  str = String(str || "").toLowerCase();
  if (!pattern.length || !str.length || pattern.length > str.length) return -Infinity;
  var words = str.split(WORD_BOUNDARY).filter(Boolean);
  var patternIdx = 0;
  var score = 0;
  for (var w = 0; w < words.length && patternIdx < pattern.length; w++) {
    var word = words[w];
    if (word[0] === pattern[patternIdx]) {
      patternIdx++;
      score += 20;
      if (word.length <= 3) score += 5;
    }
  }
  if (patternIdx !== pattern.length) return -Infinity;
  score -= (str.length - pattern.length) * 0.1;
  return score;
}

function scoreString(pattern, str) {
  pattern = String(pattern || "").trim().toLowerCase();
  str = String(str || "").toLowerCase();
  if (!pattern.length) return 0;
  if (!str.length) return -Infinity;

  var patternLen = pattern.length;
  var strLen = str.length;

  // Tier 1: Exact prefix of full string
  if (str.indexOf(pattern) === 0) {
    return 280 - (strLen - patternLen) * 0.1;
  }

  // Tier 2: Prefix at word/path boundary
  var idx = str.indexOf(pattern);
  if (idx !== -1) {
    var prev = str[idx - 1];
    if (prev === " " || prev === "/" || prev === "." || prev === "-" || prev === "_") {
      return 220 - idx * 0.5 - (strLen - patternLen) * 0.1;
    }
    // Tier 3: Substring (contains)
    return 150 - idx * 0.5 - (strLen - patternLen) * 0.1;
  }

  // Tier 4: Acronym / initialism
  var acronymScore = scoreAcronym(pattern, str);
  if (acronymScore > -Infinity) return acronymScore;

  // Multi-word: each word must appear (in order) as substring
  var words = pattern.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    var lastIdx = -1;
    var totalScore = 80;
    for (var i = 0; i < words.length; i++) {
      var wi = str.indexOf(words[i], lastIdx + 1);
      if (wi === -1) return -Infinity;
      totalScore += 25 - wi * 0.2;
      lastIdx = wi;
    }
    totalScore -= (strLen - patternLen) * 0.1;
    return totalScore;
  }

  // Tier 5: Fuzzy (pattern chars in order)
  var patternIdx = 0;
  var score = 0;
  var atWordStart = true;
  for (var i = 0; i < str.length && patternIdx < pattern.length; i++) {
    var c = str[i];
    var p = pattern[patternIdx];
    if (c === p) {
      patternIdx++;
      score += 10;
      if (atWordStart) score += 12;
    } else {
      score -= 1;
      atWordStart = WORD_BOUNDARY.test(c) || c === "-";
    }
  }
  if (patternIdx !== pattern.length) return -Infinity;
  score -= (strLen - patternLen) * 0.15;
  return Math.max(20, score);
}

/** Simple contains score – used as fallback so we never miss obvious matches */
function scoreContains(pattern, str) {
  pattern = String(pattern || "").trim().toLowerCase();
  str = String(str || "").toLowerCase();
  if (!pattern.length || !str.length) return -Infinity;
  const idx = str.indexOf(pattern);
  if (idx === -1) return -Infinity;
  let score = 80;
  if (idx === 0) score += 40;
  score -= (str.length - pattern.length) * 0.05;
  return score;
}

function fuzzySearch(query, items, key) {
  var q = String(query || "").trim();
  if (!items || !items.length) return [];
  if (!q.length) return items.slice(0, 20).map(function (item) { return Object.assign({}, item, { score: 0 }); });

  var TITLE_WEIGHT = 0.7;
  var URL_WEIGHT = 0.3;

  var scored = items.map(function (item) {
    var titleVal = item[key] != null ? String(item[key]) : "";
    var urlVal = item.url != null ? String(item.url) : "";
    var titleScore = scoreString(q, titleVal);
    var urlScore = scoreString(q, urlVal);
    var score;
    if (titleScore > -Infinity && urlScore > -Infinity) {
      score = TITLE_WEIGHT * titleScore + URL_WEIGHT * urlScore + 8;
    } else {
      score = Math.max(titleScore, urlScore);
    }
    if (score === -Infinity) return Object.assign({}, item, { score: -Infinity });
    if (item.pinned) score += 25;
    if (item.type === "tab") score += 15;
    if (item.type === "recent") score += 10;
    if (item.type === "history" && (item.visitCount > 1 || item.lastVisit)) {
      var recency = item.lastVisit ? (Date.now() - item.lastVisit) / (24 * 60 * 60 * 1000) : 999;
      score += Math.max(0, 10 - recency * 0.15);
    }
    return Object.assign({}, item, { score: score });
  });

  var result = scored.filter(function (r) { return r.score > -Infinity; }).sort(function (a, b) { return b.score - a.score; });

  if (result.length === 0 && q.length > 0) {
    var fallback = items.map(function (item) {
      var titleVal = item[key] != null ? String(item[key]) : "";
      var urlVal = item.url != null ? String(item.url) : "";
      var ts = scoreContains(q, titleVal);
      var us = scoreContains(q, urlVal);
      var score = ts > -Infinity && us > -Infinity ? TITLE_WEIGHT * ts + URL_WEIGHT * us : Math.max(ts, us);
      if (item.pinned) score += 25;
      if (item.type === "tab") score += 15;
      if (item.type === "recent") score += 10;
      return Object.assign({}, item, { score: score });
    });
    result = fallback.filter(function (r) { return r.score > -Infinity; }).sort(function (a, b) { return b.score - a.score; });
  }

  return result;
}

// Legacy export for any code that called fuzzyMatch directly
function fuzzyMatch(pattern, str) {
  const s = scoreString(pattern, str);
  return s === -Infinity ? -Infinity : s;
}


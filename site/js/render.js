/*
 * Изрисуване на екрана: лентата с дните и списъкът с мачове, групирани по лига.
 */

var prefs = loadPrefs(); // { day, search, onlyTips }

function loadPrefs() {
  try {
    return Object.assign({ day: "", search: "", onlyTips: true }, JSON.parse(localStorage.getItem(PREFS_KEY)));
  } catch (e) {
    return { day: "", search: "", onlyTips: true };
  }
}
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (e) {}
}

// Мачовете, групирани по ден (местно време)
function matchesByDay() {
  var days = {};
  (tips ? tips.matches : []).forEach(function (m) {
    var key = dayKey(m.kickoff);
    (days[key] = days[key] || []).push(m);
  });
  return days;
}

// Кой ден да е избран: запазеният, ако го има, иначе днес или първият наличен
function currentDay(days) {
  var keys = Object.keys(days).sort();
  if (prefs.day && days[prefs.day]) return prefs.day;
  var today = dayKey(Date.now());
  if (days[today]) return today;
  return keys.find((k) => k >= today) || keys[keys.length - 1] || today;
}

function renderStatus() {
  var el = $("status");
  if (lastError) {
    el.textContent = lastError;
    el.classList.add("warn");
  } else if (tips) {
    el.textContent = "Обновено " + ago(tips.generatedAt) + ", " + tips.withTip + " прогнози";
    el.classList.remove("warn");
  } else {
    el.textContent = "Зареждам…";
  }
}

function renderDays(days, selected) {
  var keys = Object.keys(days).sort();
  $("days").innerHTML = keys
    .map(function (key) {
      var label = dayLabel(key);
      var count = days[key].filter((m) => m.tip).length;
      return `<button class="day" role="tab" data-day="${key}" aria-selected="${key === selected}">
        ${label.name}<small>${label.date}</small>
      </button>`;
    })
    .join("");
  var active = $("days").querySelector('[aria-selected="true"]');
  if (active) active.scrollIntoView({ block: "nearest", inline: "center" });
}

function renderList(list) {
  var box = $("list");
  if (!tips) {
    box.innerHTML = '<div class="empty">Прогнозите се зареждат. Нужен е интернет при първото отваряне.</div>';
    return;
  }

  var q = norm(prefs.search);
  var shown = list.filter(function (m) {
    if (prefs.onlyTips && !m.tip) return false;
    if (!q) return true;
    return norm(m.home + " " + m.away + " " + m.league).includes(q);
  });

  if (!shown.length) {
    box.innerHTML = q
      ? `<div class="empty">Няма мач, който съдържа „${esc(prefs.search)}“ в този ден.</div>`
      : '<div class="empty">За този ден още няма прогнози. Провери другите дни или махни отметката „Само с прогноза“.</div>';
    return;
  }

  // групиране по лига, в реда на първия мач
  var groups = [];
  var byLeague = {};
  shown.forEach(function (m) {
    var key = m.league || "Други";
    if (!byLeague[key]) groups.push((byLeague[key] = { name: key, matches: [] }));
    byLeague[key].matches.push(m);
  });

  box.innerHTML = groups.map(renderGroup).join("");
}

// „International - UEFA Champions League“ → страна + лига
function renderGroup(group) {
  var parts = group.name.split(" - ");
  var title = parts.length > 1 ? `${esc(parts[0])} <b>${esc(parts.slice(1).join(" - "))}</b>` : `<b>${esc(group.name)}</b>`;
  return `<h2 class="league">${title}</h2><div class="matches">${group.matches.map(renderMatch).join("")}</div>`;
}

function renderMatch(m) {
  var started = Date.parse(m.kickoff) < Date.now();
  var tip = describeTip(m.tip);

  var slip = tip
    ? `<span class="slip"><span class="code">${esc(tip.code || "✓")}</span>${m.odd ? `<span class="odd">${esc(m.odd)}</span>` : ""}</span>`
    : '<span class="slip none">Още няма прогноза</span>';

  var pickText = tip
    ? `<div class="pick-text"><b>${esc(tip.text)}</b>${tip.text !== tip.original ? `<br>${esc(tip.original)}` : ""}</div>`
    : "";

  return `
    <a class="match${started ? " past" : ""}" href="${esc(m.url)}" target="_blank" rel="noopener">
      <span class="kick">${timeLabel(m.kickoff)}${started ? "<small>започнал</small>" : ""}</span>
      <span class="teams">
        <div class="t">${esc(m.home)}</div>
        <div class="t">${esc(m.away)}</div>
        ${pickText}
      </span>
      ${slip}
    </a>`;
}

function renderAll() {
  var days = matchesByDay();
  var selected = currentDay(days);
  renderDays(days, selected);
  renderList(days[selected] || []);
  renderStatus();
}

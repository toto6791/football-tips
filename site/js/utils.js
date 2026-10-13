/*
 * Малки помощни функции, ползвани навсякъде.
 */

function $(id) {
  return document.getElementById(id);
}

// Защитава текст, преди да се покаже в страницата
function esc(text) {
  var map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => map[c]);
}

function norm(text) {
  return String(text || "").trim().toLowerCase();
}

var toastTimer;
function toast(message) {
  var el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

/* ---- Дати ---- */

// Дата като ключ: „2026-10-13“ (по местно време)
function dayKey(date) {
  var d = new Date(date);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// „Днес“, „Утре“ или „Чт“ + „15.10“
var WEEKDAYS = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
function dayLabel(key) {
  var today = dayKey(Date.now());
  var tomorrow = dayKey(Date.now() + 864e5);
  var yesterday = dayKey(Date.now() - 864e5);
  var [y, m, d] = key.split("-");
  var date = d + "." + m;
  if (key === today) return { name: "Днес", date: date };
  if (key === tomorrow) return { name: "Утре", date: date };
  if (key === yesterday) return { name: "Вчера", date: date };
  return { name: WEEKDAYS[new Date(+y, m - 1, +d).getDay()], date: date };
}

// Час по местно време: „22:00“
function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString("bg-BG", { hour: "2-digit", minute: "2-digit" });
}

// „преди 5 мин“, „преди 2 ч“
function ago(iso) {
  var min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "току-що";
  if (min < 60) return "преди " + min + " мин";
  var h = Math.round(min / 60);
  if (h < 24) return "преди " + h + " ч";
  return "преди " + Math.round(h / 24) + " дни";
}

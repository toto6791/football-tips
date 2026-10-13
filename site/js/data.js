/*
 * Зареждане на прогнозите.
 * Взима tips.json от сайта. Ако няма интернет, показва последните запазени прогнози.
 */

var tips = loadCached(); // { generatedAt, matches: [...] }
var loading = false;

function loadCached() {
  try {
    var v = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (v && Array.isArray(v.matches)) return v;
  } catch (e) {}
  return null;
}

// Тегли новите прогнози. manual = true при натиснат бутон „Обнови“.
async function loadTips(manual) {
  if (loading) return;
  loading = true;
  $("refresh").classList.add("spin");
  try {
    var res = await fetch(TIPS_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("status " + res.status);
    var fresh = await res.json();
    if (!fresh || !Array.isArray(fresh.matches)) throw new Error("bad data");

    var changed = !tips || tips.generatedAt !== fresh.generatedAt;
    tips = fresh;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
    } catch (e) {}
    lastError = "";
    if (changed) renderAll();
    if (manual) toast(changed ? "Прогнозите са обновени." : "Няма нови прогнози.");
  } catch (e) {
    lastError = navigator.onLine
      ? "Не успях да заредя прогнозите. Опитай пак след малко."
      : "Няма интернет. Показвам последните запазени прогнози.";
    if (manual) toast(lastError);
  }
  loading = false;
  $("refresh").classList.remove("spin");
  renderStatus();
}
var lastError = "";

/*
 * Свързва всичко: бутони, търсене, автоматично обновяване и старт.
 */

// Избор на ден
$("days").addEventListener("click", function (e) {
  var btn = e.target.closest("[data-day]");
  if (!btn) return;
  prefs.day = btn.dataset.day;
  savePrefs();
  renderAll();
  window.scrollTo(0, 0);
});

$("refresh").addEventListener("click", () => loadTips(true));

$("search").addEventListener("input", function () {
  prefs.search = this.value;
  renderAll();
});

$("onlyTips").addEventListener("change", function () {
  prefs.onlyTips = this.checked;
  savePrefs();
  renderAll();
});

// Автоматично обновяване: при отваряне, на всеки REFRESH_MINUTES минути и при връщане в приложението
var lastLoad = 0;
function maybeReload() {
  if (Date.now() - lastLoad > 60000) {
    lastLoad = Date.now();
    loadTips(false);
  }
}
setInterval(() => loadTips(false), REFRESH_MINUTES * 60000);
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible") maybeReload();
});
window.addEventListener("online", maybeReload);
// надписът „Обновено преди …“ се опреснява всяка минута
setInterval(renderStatus, 60000);

/* ---- Старт ---- */

$("onlyTips").checked = prefs.onlyTips;
prefs.search = "";
renderAll();
maybeReload();

if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}

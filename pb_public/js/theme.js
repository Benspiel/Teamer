// Setzt das Farbschema vor dem ersten Rendern (klassisches Skript, CSP-konform),
// damit Dark Mode ohne Aufblitzen startet. Logik spiegelt js/prefs.js.
(function () {
  var theme = "light";
  try {
    theme = (JSON.parse(localStorage.getItem("crew.prefs") || "{}") || {}).theme || "light";
  } catch (_) {}
  document.documentElement.setAttribute("data-theme", theme);
})();

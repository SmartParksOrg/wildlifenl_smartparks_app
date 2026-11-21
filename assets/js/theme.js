// Loaded in <head> before the first paint so the page never flashes the wrong theme.
// The choice ("light", "dark" or "system") lives in localStorage under "wnl-theme".
(function () {
  var KEY = "wnl-theme";
  function choice() {
    try {
      return localStorage.getItem(KEY) || "system";
    } catch (e) {
      return "system";
    }
  }
  function apply() {
    var value = choice();
    var dark = value === "dark" || (value === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var root = document.documentElement;
    var changed = root.classList.contains("dark") !== dark;
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
    if (changed) document.dispatchEvent(new CustomEvent("themechange"));
  }
  window.wnlTheme = {
    get: choice,
    set: function (value) {
      try {
        localStorage.setItem(KEY, value);
      } catch (e) {
        /* private mode: the choice lasts for this page only */
      }
      apply();
    },
  };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", apply);
  apply();
})();

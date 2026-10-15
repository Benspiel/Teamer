/**
 * Minimaler History-Router. Links mit [data-link] werden clientseitig
 * aufgelöst; alles andere verhält sich wie normale Links.
 */

let handler = () => {};

export function currentPath() {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

export function navigate(path, { replace = false, state = null } = {}) {
  const same = path === currentPath();
  if (replace || same) {
    window.history.replaceState(state, "", path);
  } else {
    window.history.pushState(state, "", path);
  }
  handler(currentPath(), window.history.state);
}

export function startRouter(onRoute) {
  handler = onRoute;

  window.addEventListener("popstate", () => handler(currentPath(), window.history.state));

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[data-link]");
    if (!link) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    event.preventDefault();
    navigate(url.pathname);
  });

  handler(currentPath(), window.history.state);
}

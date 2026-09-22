// target="_blank" inside a standalone (home-screen-installed) iOS PWA
// is a well-documented source of the app's own tab going blank —
// standalone mode has no real concept of a separate tab to open into,
// so iOS can leave the originating WebView in a broken state instead.
// A plain link with no target attribute lets iOS hand off to the
// target app (WhatsApp, Phone, Maps) or Safari correctly without that
// side effect. Only relevant in standalone mode specifically — a
// normal mobile browser tab handles target="_blank" completely
// correctly. Same naming convention as this app's existing
// isIosNonStandalone() in pushNotifications.js.
export function isIosStandalone() {
  const ua = window.navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua);
  const standalone = window.navigator.standalone === true;
  return isIos && standalone;
}

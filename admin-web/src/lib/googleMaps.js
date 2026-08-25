export function loadGoogleMaps(key, onAuthFail) {
  if (window.__gmapsAuthFailed) {
    return Promise.reject(new Error("Google Maps key rejected"));
  }
  if (window.google?.maps && window.__gmapsOk) return Promise.resolve();
  if (window.__gmapsLoading) return window.__gmapsLoading;

  window.__gmapsLoading = new Promise((resolve, reject) => {
    window.gm_authFailure = () => {
      window.__gmapsAuthFailed = true;
      if (typeof onAuthFail === "function") onAuthFail();
      reject(new Error("Google Maps key rejected"));
    };
    const cb = "__gmapsReady";
    window[cb] = () => {
      setTimeout(() => {
        if (window.__gmapsAuthFailed) return;
        window.__gmapsOk = true;
        resolve();
      }, 500);
    };
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${cb}`;
    s.async = true;
    s.onerror = () => reject(new Error("Google Maps script failed to load"));
    document.head.appendChild(s);
  });
  return window.__gmapsLoading;
}

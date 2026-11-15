// Archivo mínimo para que el bot se pueda instalar como app.
// No guarda nada en caché: siempre carga la versión más nueva del bot.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

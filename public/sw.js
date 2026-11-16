// Archivo para que el bot se pueda instalar como app y reciba avisos.
// No guarda el bot en caché: siempre carga la versión más nueva.
const API = "https://bot-animalitos-api.onrender.com";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

const h12 = (h) => { const [a, m] = String(h || "").split(":").map(Number); if (isNaN(a)) return h || ""; return ((a % 12) || 12) + ":" + String(m || 0).padStart(2, "0") + (a < 12 ? " a. m." : " p. m."); };

async function leerCache(nombre, def) {
  try { const c = await caches.open("avisos"); const r = await c.match(nombre); return r ? await r.json() : def; } catch (e) { return def; }
}
async function guardarCache(nombre, val) {
  try { const c = await caches.open("avisos"); await c.put(nombre, new Response(JSON.stringify(val))); } catch (e) {}
}

async function mostrarAvisos() {
  let ult = {};
  try { const r = await fetch(API + "/api/avisos/ultimos", { cache: "no-store" }); ult = (await r.json()).ultimos || {}; } catch (e) {}
  const prefs = await leerCache("prefs", null);
  const vistos = await leerCache("vistos", {});
  const lista = Object.values(ult).filter((x) => x && x.clave && vistos[x.lot] !== x.clave && Date.now() - x.ts < 3 * 3600000 && (!prefs || prefs.includes(x.lot)));
  if (!lista.length) {
    await self.registration.showNotification("Bot de Animalitos", { body: "Hay un resultado nuevo. Toca para ver qué jugar.", icon: "icon-192.png", badge: "icon-192.png", tag: "bot-aviso" });
    return;
  }
  for (const x of lista) {
    vistos[x.lot] = x.clave;
    const titulo = x.lotNombre + " · " + h12(x.hora) + ": salió " + (x.emoji ? x.emoji + " " : "") + x.num + " " + (x.nombre || "");
    const cuerpo = x.picks && x.picks.length ? "🎯 Para jugar: " + x.picks.join(" · ") : "Toca para ver qué jugar";
    await self.registration.showNotification(titulo, { body: cuerpo, icon: "icon-192.png", badge: "icon-192.png", tag: "lot-" + x.lot, renotify: true, data: { lot: x.lot } });
  }
  await guardarCache("vistos", vistos);
}

self.addEventListener("push", (e) => e.waitUntil(mostrarAvisos()));

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const lot = (e.notification.data && e.notification.data.lot) || "";
  const url = new URL("./?lot=" + lot, self.registration.scope).href;
  e.waitUntil((async () => {
    const ws = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of ws) { try { if (w.navigate) await w.navigate(url); return w.focus(); } catch (err) {} }
    return self.clients.openWindow(url);
  })());
});

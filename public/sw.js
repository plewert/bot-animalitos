// Archivo para que el bot se pueda instalar como app y reciba avisos.
// 📴 Siempre intenta traer la versión más nueva del servidor. Si no hay conexión
// (o se corta), abre la última copia guardada del bot en el teléfono.
const API = "https://bot-animalitos-api.onrender.com";
const APP = "app-v1";
const FIJOS = ["manifest.json", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(APP).then((c) => c.addAll(FIJOS)).catch(() => {})); });
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

function conTiempo(p, ms) { return new Promise((ok, mal) => { const t = setTimeout(() => mal(new Error("tiempo")), ms); p.then((r) => { clearTimeout(t); ok(r); }, (e) => { clearTimeout(t); mal(e); }); }); }

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url; try { url = new URL(req.url); } catch (x) { return; }
  if (url.origin !== self.location.origin) return;            // el servidor de resultados va directo, nunca se guarda
  if (req.mode === "navigate") {                                // la página del bot
    e.respondWith((async () => {
      try {
        const r = await conTiempo(fetch(req, { cache: "no-store" }), 12000);
        if (r && r.ok) { const c = await caches.open(APP); await c.put("bot", r.clone()); }
        return r;
      } catch (x) {
        const c = await caches.open(APP); const g = await c.match("bot");
        if (g) return g;
        throw x;
      }
    })());
    return;
  }
  const nom = url.pathname.split("/").pop();
  if (FIJOS.includes(nom)) {                                    // íconos y manifest
    e.respondWith((async () => {
      try { const r = await fetch(req); if (r && r.ok) { const c = await caches.open(APP); await c.put(nom, r.clone()); } return r; }
      catch (x) { const c = await caches.open(APP); const g = await c.match(nom); if (g) return g; throw x; }
    })());
  }
});

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
    const cuerpoF = cuerpo + (x.ciclo && x.ciclo.length ? "\n🔄 En su punto: " + x.ciclo.join(" · ") : "");
    await self.registration.showNotification(titulo, { body: cuerpoF, icon: "icon-192.png", badge: "icon-192.png", tag: "lot-" + x.lot, renotify: true, data: { lot: x.lot } });
    if (x.ia && x.ia.tri && x.ia.tri.length) await self.registration.showNotification("🤖 Tripletas IA para mañana · " + x.lotNombre, { body: "Para el " + x.ia.para + ":\n" + x.ia.tri.map((t, i) => (i + 1) + ") " + t).join("\n"), icon: "icon-192.png", badge: "icon-192.png", tag: "ia-" + x.lot, renotify: true, data: { lot: x.lot } });
    if (x.pat && x.pat.length) await self.registration.showNotification("🔥 Patrón activo · " + x.lotNombre, { body: x.pat.join("\n"), icon: "icon-192.png", badge: "icon-192.png", tag: "pat-" + x.lot, renotify: true, data: { lot: x.lot } });
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

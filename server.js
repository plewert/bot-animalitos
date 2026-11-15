// Servidor de resultados para el Bot de animalitos.
// No necesita librerías: solo Node 18 o más nuevo (Render lo trae).
// Lee las páginas de lotoven.com y entrega los datos al bot en formato JSON.

const http = require("http");

// ===================== CONFIGURACIÓN =====================
// Enlaces de cada lotería. "estadisticas" = tabla de última fecha / días sin salir.
// "resultados" = página con los sorteos del día. Si un enlace está vacío (""), esa parte se apaga.
const FUENTES = {
  activo: {
    nombre: "Lotto Activo",
    estadisticas: "https://lotoven.com/animalito/lottoactivo/estadisticas/",
    resultados: "https://lotoven.com/animalito/lottoactivo/resultados/", // por confirmar
  },
  granjita: { nombre: "La Granjita", estadisticas: "", resultados: "" },
  guacharo: { nombre: "Guácharo", estadisticas: "", resultados: "" },
  inter: { nombre: "Lotto Internacional", estadisticas: "", resultados: "" },
};
const MINUTOS_CACHE = 5;           // cada cuánto se vuelve a leer la página como máximo
const ZONA = "America/Caracas";     // hora de Venezuela
// =========================================================

const MAX_NUM = { activo: 36, granjita: 36, guacharo: 75, inter: 36 };
const cache = new Map();

function horaVE() {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  return p.replace(/^24/, "00"); // HH:MM
}
function hoyVE() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p; // YYYY-MM-DD
}

async function leer(url) {
  const c = cache.get(url);
  if (c && Date.now() - c.t < MINUTOS_CACHE * 60000) return c.html;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (BotAnimalitos)", "Accept": "text/html" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error("La página respondió " + r.status);
  const html = await r.text();
  cache.set(url, { t: Date.now(), html });
  return html;
}

// Convierte el HTML en texto plano, una celda/bloque por línea.
function aTexto(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, " $1 ")
    .replace(/<\/(td|th|tr|li|p|div|h\d|span|a)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/[ \t]+/g, " ")
    .split("\n").map(s => s.trim()).filter(Boolean).join("\n");
}

function normNum(t, max) {
  if (t === "00") return "00";
  const n = parseInt(t, 10);
  if (isNaN(n) || n > max) return null;
  return n === 0 ? "0" : String(n).padStart(2, "0");
}

// Tabla de estadísticas: "3 Ciempies  2026-10-25  20"
function parseEstadisticas(html, lot) {
  const txt = aTexto(html).replace(/\n/g, " ");
  const re = /(?:^|\s)(00|\d{1,2})\s+([A-Za-zÁÉÍÓÚÑÜáéíóúñü][A-Za-zÁÉÍÓÚÑÜáéíóúñü ]{1,20}?)\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,4}))?/g;
  const out = {};
  let m;
  while ((m = re.exec(txt))) {
    const n = normNum(m[1], MAX_NUM[lot]);
    if (n && !out[n]) out[n] = { fecha: m[3], dias: m[4] ? +m[4] : null, nombre: m[2].trim() };
  }
  return out;
}

// Resultados del día: busca horas (9:00 AM, 09:00 a. m., 13:00) y el animal más cercano.
function hora24(h) {
  const m = h.toLowerCase().replace(/\s|\./g, "").match(/^(\d{1,2}):(\d{2})(am|pm)?$/);
  if (!m) return null;
  let hh = +m[1];
  if (m[3] === "pm" && hh < 12) hh += 12;
  if (m[3] === "am" && hh === 12) hh = 0;
  if (hh > 23) return null;
  return String(hh).padStart(2, "0") + ":" + m[2];
}
function parseResultados(html, lot) {
  const txt = aTexto(html).replace(/\n/g, "  ");
  const horas = [];
  const reH = /\b(\d{1,2}:\d{2}\s*(?:[ap]\.?\s?m\.?)?)/gi;
  let m;
  while ((m = reH.exec(txt))) { const h = hora24(m[1]); if (h) horas.push({ i: m.index, fin: m.index + m[0].length, h }); }
  const reA = /(?:^|[\s\-–:(])(00|\d{1,2})\s*[-–]?\s*([A-Za-zÁÉÍÓÚÑÜáéíóúñü]{3,}(?:\s[A-Za-zÁÉÍÓÚÑÜáéíóúñü]{3,})?)/g;
  const anim = [];
  while ((m = reA.exec(txt))) {
    const n = normNum(m[1], MAX_NUM[lot]);
    if (n) anim.push({ i: m.index, n, nombre: m[2] });
  }
  const porHora = new Map();
  for (const h of horas) {
    // primer animal que aparece después de la hora, dentro de 120 caracteres
    const a = anim.find(x => x.i >= h.fin && x.i - h.fin < 120 && !horas.some(o => o.i > h.fin && o.i < x.i));
    if (a && !porHora.has(h.h)) porHora.set(h.h, { hora: h.h, num: a.n, nombre: a.nombre });
  }
  return [...porHora.values()].sort((a, b) => a.hora.localeCompare(b.hora));
}

function enviar(res, code, obj, tipo) {
  res.writeHead(code, {
    "Content-Type": tipo || "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(typeof obj === "string" ? obj : JSON.stringify(obj));
}

async function datos(lot, que) {
  const f = FUENTES[lot];
  if (!f) throw new Error("Lotería desconocida");
  const url = f[que];
  if (!url) return { lot, que, activo: false, mensaje: "Sin enlace configurado" };
  const html = await leer(url);
  if (que === "estadisticas") {
    const d = parseEstadisticas(html, lot);
    return { lot, que, activo: true, hoy: hoyVE(), total: Object.keys(d).length, datos: d };
  }
  const r = parseResultados(html, lot);
  // Si la página todavía muestra sorteos con hora posterior a la hora actual,
  // son de AYER (pasa después de medianoche): no se entregan como de hoy.
  const ahora = horaVE();
  const margen = (h) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
  if (r.length && r.some(x => margen(x.hora) > margen(ahora) + 20)) {
    return { lot, que, activo: true, hoy: hoyVE(), total: 0, datos: [], mensaje: "La página aún muestra los sorteos de ayer" };
  }
  return { lot, que, activo: true, hoy: hoyVE(), total: r.length, datos: r };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (req.method === "OPTIONS") return enviar(res, 204, "");
    if (u.pathname === "/" || u.pathname === "/salud") return enviar(res, 200, { ok: true, hoy: hoyVE(), loterias: Object.keys(FUENTES) });

    // /api/todo?lot=activo  -> estadísticas y resultados juntos
    if (u.pathname === "/api/todo") {
      const lot = u.searchParams.get("lot") || "activo";
      const [e, r] = await Promise.allSettled([datos(lot, "estadisticas"), datos(lot, "resultados")]);
      return enviar(res, 200, {
        lot, hoy: hoyVE(),
        estadisticas: e.status === "fulfilled" ? e.value : { activo: false, error: String(e.reason && e.reason.message || e.reason) },
        resultados: r.status === "fulfilled" ? r.value : { activo: false, error: String(r.reason && r.reason.message || r.reason) },
      });
    }

    // /prueba -> página para revisar qué está leyendo el servidor
    if (u.pathname === "/prueba") {
      let html = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;background:#0b1020;color:#e8f1ff;padding:14px"><h2>Prueba del servidor · ${hoyVE()}</h2>`;
      for (const lot of Object.keys(FUENTES)) {
        html += `<h3 style="color:#2ef2ff">${FUENTES[lot].nombre}</h3>`;
        for (const que of ["estadisticas", "resultados"]) {
          try {
            const d = await datos(lot, que);
            if (!d.activo) { html += `<p>${que}: <i>sin enlace</i></p>`; continue; }
            const muestra = que === "estadisticas"
              ? Object.entries(d.datos).slice(0, 6).map(([n, v]) => `${n} ${v.nombre} · ${v.fecha}`).join("<br>")
              : d.datos.map(x => `${x.hora} → ${x.num} ${x.nombre}`).join("<br>");
            html += `<p><b>${que}</b>: ${d.total} encontrados ${d.total ? "✅" : "⚠️"}${d.mensaje ? " · " + d.mensaje : ""}<br><small>${muestra || "nada"}</small></p>`;
          } catch (e) { html += `<p><b>${que}</b>: ❌ ${String(e.message || e)}</p>`; }
        }
      }
      return enviar(res, 200, html + "</body>", "text/html; charset=utf-8");
    }
    enviar(res, 404, { error: "No encontrado" });
  } catch (e) {
    enviar(res, 500, { error: String(e.message || e) });
  }
});

const PORT = process.env.PORT || 10000;
if (require.main === module) server.listen(PORT, () => console.log("Servidor de resultados listo en el puerto " + PORT));

module.exports = { parseEstadisticas, parseResultados, aTexto, hoyVE, horaVE };

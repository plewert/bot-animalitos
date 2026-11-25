// Servidor de resultados para el Bot de animalitos.
// No necesita librerías: solo Node 18 o más nuevo (Render lo trae).
// Lee las páginas de lotoven.com y entrega los datos al bot en formato JSON.

const http = require("http");
const crypto = require("crypto");
const zlib = require("zlib");

// ===================== CONFIGURACIÓN =====================
// Enlaces de cada lotería. "estadisticas" = tabla de última fecha / días sin salir.
// "resultados" = página de resultados; el servidor le agrega la fecha de hoy (…/resultados/2026-11-15/).
// Si un enlace está vacío (""), esa parte se apaga.
const FUENTES = {
  activo: {
    nombre: "Lotto Activo",
    estadisticas: "https://lotoven.com/animalito/lottoactivo/estadisticas/",
    resultados: "https://lotoven.com/animalito/lottoactivo/resultados/",
  },
  granjita: {
    nombre: "La Granjita",
    estadisticas: "https://lotoven.com/animalito/lagranjita/estadisticas/",
    resultados: "https://lotoven.com/animalito/lagranjita/resultados/",
  },
  guacharo: {
    nombre: "Guácharo",
    estadisticas: "https://lotoven.com/animalito/guacharoactivo/estadisticas/",
    resultados: "https://lotoven.com/animalito/guacharoactivo/resultados/",
  },
  inter: {
    nombre: "Lotto Internacional",
    estadisticas: "https://lotoven.com/animalito/lottoactivordint/estadisticas/",
    resultados: "https://lotoven.com/animalito/lottoactivordint/resultados/",
  },
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
  // Quitar "animales" que en realidad son parte de una hora (ej. "00 AM")
  const enHora = (i) => horas.some(h => i >= h.i - 1 && i < h.fin);
  const A2 = anim.filter(a => !enHora(a.i));
  // Mezclar horas y animales en el orden en que aparecen y ver cuál va primero:
  // "09:00 AM  27 Perro" (hora antes) o "27 Perro  09:00 AM" (animal antes).
  const fila = [...horas.map(h => ({ t: "H", i: h.i, h })), ...A2.map(a => ({ t: "A", i: a.i, a }))].sort((x, y) => x.i - y.i);
  let ha = 0, ah = 0;
  for (let k = 0; k + 1 < fila.length; k++) {
    if (fila[k].t === "H" && fila[k + 1].t === "A") ha++;
    if (fila[k].t === "A" && fila[k + 1].t === "H") ah++;
  }
  const animalAntes = ah > ha;
  const porHora = new Map();
  for (let k = 0; k < fila.length; k++) {
    if (fila[k].t !== "H") continue;
    const vecino = animalAntes ? fila[k - 1] : fila[k + 1];
    if (!vecino || vecino.t !== "A") continue;
    const h = fila[k].h, a = vecino.a;
    if (Math.abs(a.i - h.i) > 160) continue;
    if (!porHora.has(h.h)) porHora.set(h.h, { hora: h.h, num: a.n, nombre: a.nombre });
  }
  return [...porHora.values()].sort((a, b) => a.hora.localeCompare(b.hora));
}

function enviar(res, code, obj, tipo) {
  const cuerpo = typeof obj === "string" ? obj : JSON.stringify(obj);
  const h = {
    "Content-Type": tipo || "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Clave",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Accept-Encoding",
  };
  // 📦 comprimido (gzip): las respuestas grandes, como el historial, pesan mucho menos
  let ae = ""; try { ae = String((res.req && res.req.headers["accept-encoding"]) || ""); } catch (e) {}
  if (cuerpo.length > 1024 && /\bgzip\b/.test(ae)) {
    try { const z = zlib.gzipSync(cuerpo); h["Content-Encoding"] = "gzip"; res.writeHead(code, h); return res.end(z); } catch (e) {}
  }
  res.writeHead(code, h);
  res.end(cuerpo);
}

async function datos(lot, que) {
  const f = FUENTES[lot];
  if (!f) throw new Error("Lotería desconocida");
  let url = f[que];
  if (!url) return { lot, que, activo: false, mensaje: "Sin enlace configurado" };
  if (que === "resultados" && /\/resultados\/?$/.test(url)) url = url.replace(/\/?$/, "/") + hoyVE() + "/";
  let html;
  try { html = await leer(url); }
  catch (e) {
    // La página del día todavía no existe (nadie ha jugado hoy): no es un error.
    if (que === "resultados" && /404/.test(String(e.message))) return { lot, que, activo: true, hoy: hoyVE(), total: 0, datos: [], mensaje: "Todavía no hay sorteos hoy" };
    throw e;
  }
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


// ===================== CÓDIGOS (un dispositivo por código) =====================
// Guarda en Upstash Redis qué dispositivo usa cada código y desde cuándo.
// Variables en Render (Environment): UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, ADMIN_CLAVE
const DIAS = 7, DIAS_OK = [2, 4, 7, 14, 30], ACTIVAR_ANTES = "2026-12-31";
const CODIGOS = new Set(["14gat7m66cu", "rqrxoytdtf", "gm6i7ht7jp", "10o6ajpujw1", "125d1selcsh", "1nhjhao2hs1", "26pm5tofx3f", "y6p8qnr1af", "359pq4oy10", "jkm9c38d1w", "2cq7u9phnu2", "xsdrqx0swc", "1lah7i3pm7z", "2e5t20hp67o", "22dgpgvjygj", "14q10rmpqh6", "wr6xje4hbc", "2c7qwhaaz1s", "1wnb7igg6sv", "1mhsyzq5p4q", "1vs14asr7bh", "1ixjk7vo6bl", "18p6v9zzgka", "9jx8t7y9vr", "y6st0galuf", "162t9pohu2o", "26ls882ju64", "15008dtai3o", "3fefjgqa8i", "284hxm9stst", "ch89qxhdt0", "1bux781n9t4", "8adt2athro", "ytkzv3dp1e", "1220dtxx3fo", "20sdcq9qcfz", "1zpjzzptch6", "1idnagh9jkr", "2aakjoogwb5", "14yfu80lndw", "u7j3kpla0f", "15m2m3n7vkd", "23k1fxgiy62", "1olnoes7tly", "16y3fhvnien", "hcgarkck4y", "26ppazi62z9", "13b2k5vcwrb", "27avjvk8h80", "jrrr6ftgdu", "11aznlbutgh", "1v5hl0romd5", "1r0lm4kkgkx", "1kwq39t0sp7", "190hsb28xo", "195mmrvgeo2", "dzqll3vea6", "gnma17pb4", "bwmb4evvgy", "2cv59qh21ug", "2cvurfpk05e", "vl78qdr1fz", "2axtfla9piu", "slzmdo89na", "2a00fgx8s37", "1f403ot17lm", "141551813z3", "8e5n1ouqz1", "27zypw7ze4g", "yyme9pxcz0", "2gnxqy7rcff", "2ctdrjzni88", "2d9lhrl3km6", "24gw0d8xo65", "1ch0c0m9usb", "loutb0fq0s", "9onawau68v", "yu8fmajs3i", "rv773kohjc", "2dl03w7sxi1", "2eszpqridp0", "17k15idcnlx", "2f53fnqp6ws", "xcssihwxge", "fvx0jcvsos", "qitl16z2l5", "8cgdhcbdhp", "1c5t85pkzj9", "kqzvoxgfv2", "1u0n8u75zvk", "1pwqupjdpq1", "138qwpw6sg6", "15er547glhg", "2b0decpif4", "1fukcp1tsad", "1axxoxc0afg", "1e5ian7m518", "17gjq9r3bu5", "1049kf9pscv", "mya45h6lza", "ahdyefzrmi", "xutcpatghh", "nzob9wwknx", "2lhgbnkk2d", "2b613v8donw", "df79mzcfrt", "jbhfcfhcf3", "y2oqzb2uid", "2165hxhga9h", "1qgpq2e0w1z", "13hk926sir", "27rjzk2hy2m", "liw37aupt5", "1z0jsmr4uig", "26kj3n5fraa", "4e5q2h4j5x", "uu1skskl22", "1x6wlxpmvso", "pvf9o9w7do", "1jz5p4qglyq", "qetz5erlur", "28h3jvdskhm", "twuoyflspp", "259xfsiz7gl", "17w6cpq3wlm", "1lwz54lpcd1", "l0nfzg90ck", "6exjud2xmn", "jpuxq69rpt", "23672w1sl6", "1v4eiztwcm0", "q4g5801r0e", "1z21eupvuif", "20u1k7e7va7", "1c7phfyfiew", "1a50fdzxbph", "yrncobkn51", "1x31b4drjn8", "yn4ho7zna4", "13sltzf1do3"]); // huellas de los códigos válidos (no los códigos en sí)
const R_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const R_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const CLAVE = process.env.ADMIN_CLAVE || "";
async function redis(cmd) {
  if (!R_URL || !R_TOK) throw new Error("no_config");
  const r = await fetch(R_URL, { method: "POST", headers: { Authorization: "Bearer " + R_TOK, "Content-Type": "application/json" }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(10000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
async function leerCuerpo(req) {
  let d = ""; for await (const c of req) { d += c; if (d.length > 5000) break; }
  try { return JSON.parse(d || "{}"); } catch (e) { return {}; }
}
const finDe = (ini, d) => ini + (d || DIAS) * 86400000;   // d = días del código (2, 4, 7, 14 o 30)
// 🚫 Códigos eliminados desde el panel de admin: dejan de funcionar
const cyrb53S = (str, seed = 7) => { let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed; for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36); };
const normCodeS = (c) => { const t = String(c || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, ""); return t.length === 11 && t.startsWith("BOT") ? "BOT-" + t.slice(3, 7) + "-" + t.slice(7) : String(c || "").trim().toUpperCase(); };
const anulado = async (hash) => !!(await redis(["GET", "anu:" + hash]));
// ➕ Códigos generados desde el panel (y los que agregas a tu lista): se guardan en Upstash como "gen:<huella>"
const existeCodigo = async (hash) => CODIGOS.has(hash) || !!(await redis(["GET", "gen:" + hash]));
const ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
async function generarCodigos(n, dias) {
  dias = DIAS_OK.includes(+dias) ? +dias : DIAS;
  n = Math.max(1, Math.min(50, parseInt(n, 10) || 0)); const out = [];
  for (let k = 0; out.length < n && k < n * 20; k++) {
    const r = () => Array.from(crypto.randomBytes(4), (b) => ABC[b % ABC.length]).join("");
    const c = "BOT-" + r() + "-" + r(), h = cyrb53S(c);
    if (CODIGOS.has(h) || out.some((x) => x.h === h) || (await redis(["GET", "gen:" + h]))) continue;
    out.push({ c, h });
  }
  const t = Date.now();
  for (const x of out) await redis(["SET", "gen:" + x.h, JSON.stringify({ codigo: x.c, t, gen: true, dias })]);
  return out.map((x) => x.c);
}
async function agregarALista(texto) {
  const cods = [...new Set((String(texto || "").toUpperCase().match(/BOT[-\s]?[A-Z0-9]{4}[-\s]?[A-Z0-9]{4}/g) || []).map(normCodeS))];
  let ok = 0, ya = 0; const malos = [];
  for (const c of cods) { const h = cyrb53S(c);
    if (!CODIGOS.has(h)) { if (await redis(["GET", "gen:" + h])) ya++; else malos.push(c); continue; }
    if (await redis(["GET", "gen:" + h])) { ya++; continue; }
    await redis(["SET", "gen:" + h, JSON.stringify({ codigo: c, t: Date.now(), lista: true })]); ok++; }
  return { ok: true, agregados: ok, ya, malos };
}
async function usarCodigo(b) {
  const hash = String(b.hash || ""), dev = String(b.dev || "").slice(0, 64);
  if (!(await existeCodigo(hash))) return { ok: false, motivo: "no_existe" };
  if (await anulado(hash)) return { ok: false, motivo: "anulado" };
  if (!dev) return { ok: false, motivo: "sin_dispositivo" };
  const key = "cod:" + hash;
  let rec = await redis(["GET", key]); rec = rec ? JSON.parse(rec) : null;
  const ahora = Date.now();
  if (!rec) {
    if (!b.activar) return { ok: false, motivo: "no_activado" };
    if (CODIGOS.has(hash) && ahora > Date.parse(ACTIVAR_ANTES + "T23:59:59-04:00")) return { ok: false, motivo: "no_activable" };
    let dias = DIAS; try { const g = await redis(["GET", "gen:" + hash]); if (g) dias = DIAS_OK.includes(+JSON.parse(g).dias) ? +JSON.parse(g).dias : DIAS; } catch (e) {}
    rec = { codigo: String(b.codigo || "").slice(0, 20), dev, ua: String(b.ua || "").slice(0, 20), ini: ahora, uso: ahora, dias };
    await redis(["SET", key, JSON.stringify(rec)]);
    return { ok: true, fin: finDe(rec.ini, rec.dias) };
  }
  if (ahora > finDe(rec.ini, rec.dias)) return { ok: false, motivo: "vencido", fin: finDe(rec.ini, rec.dias) };
  if (!rec.dev) { // liberado: lo toma este dispositivo, la semana sigue igual
    if (!b.activar) return { ok: false, motivo: "no_activado" };
    rec.dev = dev; rec.ua = String(b.ua || "").slice(0, 20);
  }
  if (rec.dev !== dev) return { ok: false, motivo: "en_uso" };
  rec.uso = ahora; if (!rec.codigo && b.codigo) rec.codigo = String(b.codigo).slice(0, 20);
  await redis(["SET", key, JSON.stringify(rec)]);
  return { ok: true, fin: finDe(rec.ini, rec.dias) };
}
// 🎁 Regalo de Navidad: 1 intento por teléfono al día, 10 premios en total, máximo 1 premio por día
const REGALO = { premios: 10, prob: 200, maxDia: 1 };
const fechaVE = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);
function temporadaRegalo() { const f = fechaVE(), m = +f.slice(5, 7), d = +f.slice(8, 10); return (m === 11 && d >= 21) || m === 12 || (m === 1 && d <= 7); }
async function regaloEstado() {
  const n = +(await redis(["GET", "reg:n"])) || 0;
  return { ok: true, activo: temporadaRegalo(), quedan: Math.max(0, REGALO.premios - n), total: REGALO.premios };
}
async function abrirRegalo(b, ip) {
  if (!temporadaRegalo()) return { ok: false, motivo: "fuera" };
  const dev = String(b.dev || "").slice(0, 80); if (!dev) return { ok: false, motivo: "sin_dispositivo" };
  const f = fechaVE(), kd = "reg:dia:" + f + ":" + dev;
  const ya = await redis(["GET", kd]); if (ya) return Object.assign({ ok: true, repetido: true }, JSON.parse(ya), await regaloEstado());
  let res = { gano: false };
  const est = await regaloEstado();
  if (est.quedan <= 0) res = { gano: false, agotado: true };
  else if (crypto.randomInt(REGALO.prob) === 0) {
    const nd = await redis(["INCR", "reg:d:" + f]); await redis(["EXPIRE", "reg:d:" + f, 172800]);
    if (nd > REGALO.maxDia) await redis(["DECR", "reg:d:" + f]);
    else {
      const n = await redis(["INCR", "reg:n"]);
      if (n > REGALO.premios) { await redis(["DECR", "reg:n"]); await redis(["DECR", "reg:d:" + f]); }
      else {
        const [c] = await generarCodigos(1);
        const h = cyrb53S(c), g = JSON.parse((await redis(["GET", "gen:" + h])) || "{}"); g.regalo = true;
        await redis(["SET", "gen:" + h, JSON.stringify(g)]);
        await redis(["SET", "reg:gan:" + h, JSON.stringify({ codigo: c, t: Date.now(), ua: String(b.ua || "").slice(0, 20), donde: String(b.donde || "").slice(0, 10) })]);
        res = { gano: true, codigo: c };
      }
    }
  }
  await redis(["SET", kd, JSON.stringify(res), "EX", 172800]);
  return Object.assign({ ok: true }, res, await regaloEstado());
}
// Prueba gratis: una por dispositivo
const DEMO_MIN = 30;
async function usarDemo(b) {
  const dev = String(b.dev || "").slice(0, 80);
  if (!dev) return { ok: false, motivo: "sin_dispositivo" };
  const key = "demo:" + dev, ahora = Date.now();
  let v = await redis(["GET", key]);
  if (!v) { v = JSON.stringify({ ini: ahora, ua: String(b.ua || "").slice(0, 40) }); await redis(["SET", key, v]); }
  const fin = JSON.parse(v).ini + DEMO_MIN * 60000;
  return ahora < fin ? { ok: true, fin } : { ok: false, motivo: "usada" };
}


// ===================== AVISOS AL TELÉFONO (notificaciones) =====================
// El servidor revisa los resultados cada 2 minutos (de 7 a. m. a 9 p. m.) y,
// cuando sale uno nuevo, avisa a los teléfonos suscritos a esa lotería.
// Las claves de los avisos se crean solas y se guardan en Upstash.
const AVISO_GUIA = {"activo": {"nombre": "Lotto Activo", "A": {"0": ["Delfín", "🐬"], "10": ["Tigre", "🐯"], "11": ["Gato", "🐱"], "12": ["Caballo", "🐴"], "13": ["Mono", "🐒"], "14": ["Paloma", "🕊️"], "15": ["Zorro", "🦊"], "16": ["Oso", "🐻"], "17": ["Pavo", "🦃"], "18": ["Burro", "🫏"], "19": ["Chivo", "🐐"], "20": ["Cochino", "🐷"], "21": ["Gallo", "🐓"], "22": ["Camello", "🐫"], "23": ["Cebra", "🦓"], "24": ["Iguana", "🦎"], "25": ["Gallina", "🐔"], "26": ["Vaca", "🐄"], "27": ["Perro", "🐶"], "28": ["Zamuro", "🪶"], "29": ["Elefante", "🐘"], "30": ["Caimán", "🐊"], "31": ["Lapa", "🐹"], "32": ["Ardilla", "🐿️"], "33": ["Pescado", "🐟"], "34": ["Venado", "🦌"], "35": ["Jirafa", "🦒"], "36": ["Culebra", "🐍"], "00": ["Ballena", "🐋"], "01": ["Carnero", "🐏"], "02": ["Toro", "🐂"], "03": ["Ciempiés", "🐛"], "04": ["Alacrán", "🦂"], "05": ["León", "🦁"], "06": ["Rana", "🐸"], "07": ["Perico", "🦜"], "08": ["Ratón", "🐭"], "09": ["Águila", "🦅"]}, "sig": {"0": ["03", "11", "18", "28", "30"], "10": ["05", "09", "11", "18", "25"], "11": ["03", "04", "05", "18", "25", "33", "35", "36"], "12": ["0", "00", "04", "05", "15", "16", "19", "21", "31", "36"], "13": ["0", "00", "15", "16", "30", "31", "34"], "14": ["0", "00", "04", "17", "35"], "15": ["07", "12", "20", "26", "30"], "16": ["05", "12", "16", "19", "28"], "17": ["0", "00", "02", "14", "15", "20", "22", "26", "29", "31"], "18": ["01", "10", "15"], "19": ["02", "07", "12", "14", "32"], "20": ["03", "07", "09", "30", "35"], "21": ["05", "07", "13"], "22": ["0", "00", "16", "28", "33"], "23": ["03", "05", "06", "09", "14", "24", "30", "32", "36"], "24": ["0", "00", "02", "03", "07", "08", "16", "20", "30", "32", "35"], "25": ["01", "10", "26", "29", "33"], "26": ["02", "15", "17", "20", "24", "29", "34", "35", "36"], "27": ["0", "03", "04", "13", "26", "30", "32", "34"], "28": ["01", "11", "19", "22"], "29": ["01", "02", "03", "15", "17", "20", "24", "26", "36"], "30": ["0", "02", "03", "04", "07", "16", "20", "24", "27", "31", "32"], "31": ["01", "03", "04", "29"], "32": ["06", "13", "27", "30", "31"], "33": ["07", "14", "23", "26", "34"], "34": ["11", "15", "36"], "35": ["03", "04", "10", "11", "27", "33", "36"], "36": ["01", "05", "10", "11", "35"], "00": ["16", "19", "22", "33", "36"], "01": ["0", "05", "12", "21", "28"], "02": ["01", "03", "07", "15", "17", "19", "20", "24", "26", "29", "30", "35"], "03": ["0", "02", "04", "07", "11", "18", "20", "24", "27", "30", "32", "33", "35", "36"], "04": ["0", "00", "03", "07", "11", "12", "15", "19", "27", "30", "32", "33", "35", "36"], "05": ["03", "04", "16", "19", "28"], "06": ["04", "05", "08", "09", "21", "23", "32", "36"], "07": ["02", "03", "04", "15", "20", "24", "30", "33"], "08": ["0", "00", "12", "15", "16", "24", "28", "32"], "09": ["05", "06", "08", "12", "20", "23", "32", "34", "36"]}}, "granjita": {"nombre": "La Granjita", "A": {"0": ["Delfín", "🐬"], "10": ["Tigre", "🐯"], "11": ["Gato", "🐱"], "12": ["Caballo", "🐴"], "13": ["Mono", "🐒"], "14": ["Paloma", "🕊️"], "15": ["Zorro", "🦊"], "16": ["Oso", "🐻"], "17": ["Pavo", "🦃"], "18": ["Burro", "🫏"], "19": ["Chivo", "🐐"], "20": ["Cochino", "🐷"], "21": ["Gallo", "🐓"], "22": ["Camello", "🐫"], "23": ["Cebra", "🦓"], "24": ["Iguana", "🦎"], "25": ["Gallina", "🐔"], "26": ["Vaca", "🐄"], "27": ["Perro", "🐶"], "28": ["Zamuro", "🪶"], "29": ["Elefante", "🐘"], "30": ["Caimán", "🐊"], "31": ["Lapa", "🐹"], "32": ["Ardilla", "🐿️"], "33": ["Pescado", "🐟"], "34": ["Venado", "🦌"], "35": ["Jirafa", "🦒"], "36": ["Culebra", "🐍"], "00": ["Ballena", "🐋"], "01": ["Carnero", "🐏"], "02": ["Toro", "🐂"], "03": ["Ciempiés", "🐛"], "04": ["Alacrán", "🦂"], "05": ["León", "🦁"], "06": ["Rana", "🐸"], "07": ["Perico", "🦜"], "08": ["Ratón", "🐭"], "09": ["Águila", "🦅"]}, "sig": {"0": ["03", "11", "18", "28", "30"], "10": ["05", "09", "11", "18", "25"], "11": ["03", "04", "05", "18", "25", "33", "35", "36"], "12": ["0", "00", "04", "05", "15", "16", "19", "21", "31", "36"], "13": ["0", "00", "15", "16", "30", "31", "34"], "14": ["0", "00", "04", "17", "35"], "15": ["07", "12", "20", "26", "30"], "16": ["05", "12", "16", "19", "28"], "17": ["0", "00", "02", "14", "15", "20", "22", "26", "29", "31"], "18": ["01", "10", "15"], "19": ["02", "07", "12", "14", "32"], "20": ["03", "07", "09", "30", "35"], "21": ["05", "07", "13"], "22": ["0", "00", "16", "28", "33"], "23": ["03", "05", "06", "09", "14", "24", "30", "32", "36"], "24": ["0", "00", "02", "03", "07", "08", "16", "20", "30", "32", "35"], "25": ["01", "10", "26", "29", "33"], "26": ["02", "15", "17", "20", "24", "29", "34", "35", "36"], "27": ["0", "03", "04", "13", "26", "30", "32", "34"], "28": ["01", "11", "19", "22"], "29": ["01", "02", "03", "15", "17", "20", "24", "26", "36"], "30": ["0", "02", "03", "04", "07", "16", "20", "24", "27", "31", "32"], "31": ["01", "03", "04", "29"], "32": ["06", "13", "27", "30", "31"], "33": ["07", "14", "23", "26", "34"], "34": ["11", "15", "36"], "35": ["03", "04", "10", "11", "27", "33", "36"], "36": ["01", "05", "10", "11", "35"], "00": ["16", "19", "22", "33", "36"], "01": ["0", "05", "12", "21", "28"], "02": ["01", "03", "07", "15", "17", "19", "20", "24", "26", "29", "30", "35"], "03": ["0", "02", "04", "07", "11", "18", "20", "24", "27", "30", "32", "33", "35", "36"], "04": ["0", "00", "03", "07", "11", "12", "15", "19", "27", "30", "32", "33", "35", "36"], "05": ["03", "04", "16", "19", "28"], "06": ["04", "05", "08", "09", "21", "23", "32", "36"], "07": ["02", "03", "04", "15", "20", "24", "30", "33"], "08": ["0", "00", "12", "15", "16", "24", "28", "32"], "09": ["05", "06", "08", "12", "20", "23", "32", "34", "36"]}}, "guacharo": {"nombre": "Guácharo", "A": {"0": ["Delfín", "🐬"], "10": ["Tigre", "🐯"], "11": ["Gato", "🐱"], "12": ["Caballo", "🐴"], "13": ["Mono", "🐒"], "14": ["Paloma", "🕊️"], "15": ["Zorro", "🦊"], "16": ["Oso", "🐻"], "17": ["Pavo", "🦃"], "18": ["Burro", "🫏"], "19": ["Chivo", "🐐"], "20": ["Cochino", "🐷"], "21": ["Gallo", "🐓"], "22": ["Camello", "🐫"], "23": ["Cebra", "🦓"], "24": ["Iguana", "🦎"], "25": ["Gallina", "🐔"], "26": ["Vaca", "🐄"], "27": ["Perro", "🐶"], "28": ["Zamuro", "🪶"], "29": ["Elefante", "🐘"], "30": ["Caimán", "🐊"], "31": ["Lapa", "🐹"], "32": ["Ardilla", "🐿️"], "33": ["Pescado", "🐟"], "34": ["Venado", "🦌"], "35": ["Jirafa", "🦒"], "36": ["Culebra", "🐍"], "37": ["Tortuga", "🐢"], "38": ["Búfalo", "🐃"], "39": ["Lechuza", "🦉"], "40": ["Avispa", "🐝"], "41": ["Canguro", "🦘"], "42": ["Tucán", "🐦"], "43": ["Mariposa", "🦋"], "44": ["Chigüire", "🦫"], "45": ["Garza", "🦢"], "46": ["Puma", "🐆"], "47": ["Pavo Real", "🦚"], "48": ["Puercoespín", "🦔"], "49": ["Pereza", "🦥"], "50": ["Canario", "🐤"], "51": ["Pelícano", "🦤"], "52": ["Pulpo", "🐙"], "53": ["Caracol", "🐌"], "54": ["Grillo", "🦗"], "55": ["Oso Hormiguero", "🦡"], "56": ["Tiburón", "🦈"], "57": ["Pato", "🦆"], "58": ["Hormiga", "🐜"], "59": ["Pantera", "🐈‍⬛"], "60": ["Camaleón", "🦎"], "61": ["Panda", "🐼"], "62": ["Cachicamo", "🐾"], "63": ["Cangrejo", "🦀"], "64": ["Gavilán", "🦅"], "65": ["Araña", "🕷️"], "66": ["Lobo", "🐺"], "67": ["Avestruz", "🦩"], "68": ["Jaguar", "🐆"], "69": ["Conejo", "🐰"], "70": ["Bisonte", "🦬"], "71": ["Guacamaya", "🦜"], "72": ["Gorila", "🦍"], "73": ["Hipopótamo", "🦛"], "74": ["Turpial", "🐦"], "75": ["Guácharo", "🦇"], "00": ["Ballena", "🐋"], "01": ["Carnero", "🐏"], "02": ["Toro", "🐂"], "03": ["Ciempiés", "🐛"], "04": ["Alacrán", "🦂"], "05": ["León", "🦁"], "06": ["Rana", "🐸"], "07": ["Perico", "🦜"], "08": ["Ratón", "🐭"], "09": ["Águila", "🦅"]}, "sig": {"0": ["00", "06", "14", "17", "24", "37", "56", "66"], "10": ["16", "22", "31", "49", "74", "75"], "11": ["27", "37", "49", "50", "59"], "12": ["26", "34", "50", "72", "73"], "13": ["0", "00", "06", "26", "29", "31", "51", "59"], "14": ["0", "00", "08", "17", "21", "40", "52", "72"], "15": ["02", "20", "24", "26", "29", "35", "53", "56", "60"], "16": ["10", "48", "52", "54", "63", "67"], "17": ["0", "00", "09", "14", "28", "55", "59", "63"], "18": ["27", "56", "64", "73", "74"], "19": ["13", "16", "18", "56", "57", "70"], "20": ["02", "15", "21", "26", "29", "58", "67"], "21": ["03", "08", "54", "56", "59"], "22": ["06", "44", "60", "62", "71"], "23": ["05", "10", "16", "43", "61"], "24": ["01", "04", "48", "57", "62"], "25": ["01", "23", "32", "44", "52", "63"], "26": ["02", "04", "15", "16", "20", "29", "42", "51", "64", "68"], "27": ["25", "28", "52", "61", "66", "73"], "28": ["15", "47", "62", "66", "71"], "29": ["02", "09", "15", "20", "26", "27", "54", "67", "72"], "30": ["33", "68"], "31": ["19", "38", "53"], "32": ["03", "14", "70"], "33": ["0", "71"], "34": ["04", "05", "40", "43", "50", "72"], "35": ["12", "37", "73"], "36": ["10", "74"], "37": ["23", "51", "53"], "38": ["16", "33", "48"], "39": ["01", "10", "16", "35", "53", "57", "61", "75"], "40": ["02", "07", "16", "20", "24", "70"], "41": ["01", "03"], "42": ["04", "66", "69"], "43": ["05", "32", "35"], "44": ["27", "53", "56"], "45": ["12", "38", "62"], "46": ["04", "08", "18"], "47": ["06", "12", "64"], "48": ["57", "58", "62"], "49": ["11", "21", "24"], "50": ["12", "17", "57"], "51": ["23", "29", "61"], "52": ["14", "15", "27", "41", "72"], "53": ["01", "15", "23", "32", "33", "38", "51"], "54": ["03", "16", "39"], "55": ["17", "34", "56"], "56": ["13", "18"], "57": ["01", "38", "64"], "58": ["20", "32"], "59": ["21", "28", "49"], "60": ["09", "22", "37"], "61": ["0", "23", "53"], "62": ["24", "71", "74"], "63": ["05", "67"], "64": ["24", "42", "45", "47", "74"], "65": ["15", "27", "39"], "66": ["27", "30", "46", "54"], "67": ["18", "36", "45"], "68": ["33", "53", "57"], "69": ["20", "47", "52"], "70": ["01", "02", "47"], "71": ["15", "16", "43"], "72": ["52", "69"], "73": ["04", "37", "40", "69"], "74": ["10", "56", "62"], "75": ["39", "47", "61"], "00": ["0", "09", "14", "17", "23", "31", "37", "54", "56"], "01": ["24", "26", "39", "43", "53", "57"], "02": ["15", "17", "20", "26", "29", "40", "52", "65", "70"], "03": ["11", "18", "40", "41", "68"], "04": ["18", "24", "42", "43", "48", "60"], "05": ["08", "10", "29", "43", "47"], "06": ["19", "37", "38", "44", "53", "70"], "07": ["24", "33", "38", "45", "57"], "08": ["07", "39", "42", "46", "51", "55", "63", "64"], "09": ["17", "27", "28", "44", "66"]}}, "inter": {"nombre": "Lotto Internacional", "A": {"0": ["Delfín", "🐬"], "10": ["Tigre", "🐯"], "11": ["Gato", "🐱"], "12": ["Caballo", "🐴"], "13": ["Mono", "🐒"], "14": ["Paloma", "🕊️"], "15": ["Zorro", "🦊"], "16": ["Oso", "🐻"], "17": ["Pavo", "🦃"], "18": ["Burro", "🫏"], "19": ["Chivo", "🐐"], "20": ["Cochino", "🐷"], "21": ["Gallo", "🐓"], "22": ["Camello", "🐫"], "23": ["Cebra", "🦓"], "24": ["Iguana", "🦎"], "25": ["Gallina", "🐔"], "26": ["Vaca", "🐄"], "27": ["Perro", "🐶"], "28": ["Zamuro", "🪶"], "29": ["Elefante", "🐘"], "30": ["Caimán", "🐊"], "31": ["Lapa", "🐹"], "32": ["Ardilla", "🐿️"], "33": ["Pescado", "🐟"], "34": ["Venado", "🦌"], "35": ["Jirafa", "🦒"], "36": ["Culebra", "🐍"], "00": ["Ballena", "🐋"], "01": ["Carnero", "🐏"], "02": ["Toro", "🐂"], "03": ["Ciempiés", "🐛"], "04": ["Alacrán", "🦂"], "05": ["León", "🦁"], "06": ["Rana", "🐸"], "07": ["Perico", "🦜"], "08": ["Ratón", "🐭"], "09": ["Águila", "🦅"]}, "sig": {"0": ["03", "11", "18", "28", "30"], "10": ["05", "09", "11", "18", "25"], "11": ["03", "04", "05", "18", "25", "33", "35", "36"], "12": ["0", "00", "04", "05", "15", "16", "19", "21", "31", "36"], "13": ["0", "00", "15", "16", "30", "31", "34"], "14": ["0", "00", "04", "17", "35"], "15": ["07", "12", "20", "26", "30"], "16": ["05", "12", "16", "19", "28"], "17": ["0", "00", "02", "14", "15", "20", "22", "26", "29", "31"], "18": ["01", "10", "15"], "19": ["02", "07", "12", "14", "32"], "20": ["03", "07", "09", "30", "35"], "21": ["05", "07", "13"], "22": ["0", "00", "16", "28", "33"], "23": ["03", "05", "06", "09", "14", "24", "30", "32", "36"], "24": ["0", "00", "02", "03", "07", "08", "16", "20", "30", "32", "35"], "25": ["01", "10", "26", "29", "33"], "26": ["02", "15", "17", "20", "24", "29", "34", "35", "36"], "27": ["0", "03", "04", "13", "26", "30", "32", "34"], "28": ["01", "11", "19", "22"], "29": ["01", "02", "03", "15", "17", "20", "24", "26", "36"], "30": ["0", "02", "03", "04", "07", "16", "20", "24", "27", "31", "32"], "31": ["01", "03", "04", "29"], "32": ["06", "13", "27", "30", "31"], "33": ["07", "14", "23", "26", "34"], "34": ["11", "15", "36"], "35": ["03", "04", "10", "11", "27", "33", "36"], "36": ["01", "05", "10", "11", "35"], "00": ["16", "19", "22", "33", "36"], "01": ["0", "05", "12", "21", "28"], "02": ["01", "03", "07", "15", "17", "19", "20", "24", "26", "29", "30", "35"], "03": ["0", "02", "04", "07", "11", "18", "20", "24", "27", "30", "32", "33", "35", "36"], "04": ["0", "00", "03", "07", "11", "12", "15", "19", "27", "30", "32", "33", "35", "36"], "05": ["03", "04", "16", "19", "28"], "06": ["04", "05", "08", "09", "21", "23", "32", "36"], "07": ["02", "03", "04", "15", "20", "24", "30", "33"], "08": ["0", "00", "12", "15", "16", "24", "28", "32"], "09": ["05", "06", "08", "12", "20", "23", "32", "34", "36"]}}};
let VAPID = null;
async function vapid() {
  if (VAPID) return VAPID;
  const v = await redis(["GET", "vapid"]);
  if (v) { VAPID = JSON.parse(v); return VAPID; }
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pub = publicKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
  VAPID = { jwk: privateKey.export({ format: "jwk" }), pub: raw.toString("base64url") };
  await redis(["SET", "vapid", JSON.stringify(VAPID)]);
  return VAPID;
}
async function empujar(endpoint) {
  const v = await vapid();
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const sinFirma = b64({ typ: "JWT", alg: "ES256" }) + "." + b64({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "https://bot-animalitos.onrender.com" });
  const firma = crypto.sign("sha256", Buffer.from(sinFirma), { key: crypto.createPrivateKey({ key: v.jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }).toString("base64url");
  const r = await fetch(endpoint, { method: "POST", headers: { TTL: "3600", Urgency: "high", Authorization: "vapid t=" + sinFirma + "." + firma + ", k=" + v.pub, "Content-Length": "0" } });
  return r.status;
}
const subKey = (endpoint) => "sub:" + crypto.createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 24);
async function suscribir(b) {
  const sub = b.sub || {}, endpoint = String(sub.endpoint || "");
  if (!/^https:\/\//.test(endpoint)) return { ok: false, motivo: "sin_suscripcion" };
  const lots = (Array.isArray(b.lots) ? b.lots : []).filter((l) => FUENTES[l]);
  if (!lots.length) { await redis(["DEL", subKey(endpoint)]); return { ok: true, lots: [] }; }
  const hash = String(b.hash || ""), dev = String(b.dev || "").slice(0, 64);
  let rec = await redis(["GET", "cod:" + hash]); rec = rec ? JSON.parse(rec) : null;
  if (!rec || !(await existeCodigo(hash))) return { ok: false, motivo: "sin_codigo" };
  if (await anulado(hash)) { await redis(["DEL", subKey(endpoint)]); return { ok: false, motivo: "anulado" }; }
  if (rec.dev !== dev) return { ok: false, motivo: "en_uso" };
  const fin = finDe(rec.ini, rec.dias); if (Date.now() > fin) return { ok: false, motivo: "vencido" };
  await redis(["SET", subKey(endpoint), JSON.stringify({ sub, lots, hash, fin, t: Date.now() })]);
  return { ok: true, lots };
}

// ---- 🔥 Patrones confirmados (el mismo cálculo que el bot): se buscan en 9 meses y se prueban en los últimos 3 ----
const PATS = new Map();
function patFr(h) { return parseInt(h, 10) <= 13 ? "m" : "t"; }
function patTail(k, n, p) {
  if (k <= 0) return 1; if (p <= 0) return 0; if (p >= 1) return 1;
  const lf = [0]; for (let i = 1; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i);
  let s = 0; for (let i = k; i <= n; i++) s += Math.exp(lf[n] - lf[i] - lf[n - i] + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, s);
}
function patStats(A, dias) {
  const S = { T: 0, cnt: {}, na: {}, cab: {}, nd: 0, dh: {}, cp: {} };
  const inc = (o, k) => (o[k] = (o[k] || 0) + 1);
  dias.forEach(([f, it]) => {
    const its = it.filter((x) => A[x[1]]).slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); if (!its.length) return;
    S.nd++;
    its.forEach(([h, n], i) => { S.T++; inc(S.cnt, n); if (i < its.length - 1) { inc(S.na, n); inc(S.cab, n + "|" + its[i + 1][1]); } });
    const u = [...new Set(its.map((x) => x[1]))]; u.forEach((n) => inc(S.dh, n));
    for (let i = 0; i < u.length; i++) for (let j = 0; j < u.length; j++) if (i !== j) inc(S.cp, u[i] + "|" + u[j]);
  });
  return S;
}
async function patronesLot(lot) {
  const hoy = hoyVE(), c = PATS.get(lot); if (c && c.fecha === hoy) return c.conf;
  const g = AVISO_GUIA[lot]; if (!g) return [];
  const A = g.A, order = Object.keys(A);
  const H = await historial(lot), dd = (H.dias || []).filter((x) => x[0] < hoy).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (dd.length < 150) { PATS.set(lot, { fecha: hoy, conf: [] }); return []; }
  const lim = new Date(dd[dd.length - 1][0] + "T12:00:00Z"); lim.setUTCDate(lim.getUTCDate() - 90);
  const fl = lim.toISOString().slice(0, 10), Aa = patStats(A, dd.filter((x) => x[0] < fl)), B = patStats(A, dd.filter((x) => x[0] >= fl));
  const gg = (o, k) => o[k] || 0, conf = [];
  const ok = (tn, tk, tp) => tn >= 15 && tk >= 4 && tk / tn >= tp * 1.4 && patTail(tk, tn, tp) < 0.001;
  order.forEach((a) => {
    if (gg(Aa.na, a) >= 20) order.forEach((b) => { const cc = gg(Aa.cab, a + "|" + b), r = cc / Aa.na[a], base = gg(Aa.cnt, b) / Aa.T;
      if (cc >= 4 && base && r >= base * 1.6) { const tn = gg(B.na, a), tk = gg(B.cab, a + "|" + b), tp = gg(B.cnt, b) / (B.T || 1); if (ok(tn, tk, tp)) conf.push({ tipo: "seq", a, b, k: tk, n: tn, p: tp }); } });
    if (gg(Aa.dh, a) >= 15) order.forEach((b) => { if (b === a || !(a < b)) return; const cc = gg(Aa.cp, a + "|" + b), r = cc / Aa.dh[a], base = gg(Aa.dh, b) / Aa.nd;
      if (cc >= 8 && base && r >= base * 1.3) { const tn = gg(B.dh, a), tk = gg(B.cp, a + "|" + b), tp = gg(B.dh, b) / (B.nd || 1); if (ok(tn, tk, tp)) conf.push({ tipo: "par", a, b, k: tk, n: tn, p: tp }); } });
  });
  PATS.set(lot, { fecha: hoy, conf });
  return conf;
}
async function alertasPatron(lot, num, deHoy) {
  try {
    const conf = await patronesLot(lot), A = (AVISO_GUIA[lot] || {}).A || {}, nom = (n) => ((A[n] || [])[1] ? A[n][1] + " " : "") + n + " " + ((A[n] || [])[0] || "");
    const salio = new Set(deHoy), out = [];
    conf.forEach((c) => {
      if (c.tipo === "seq" && c.a === num) out.push("Después del " + num + " suele salir el " + nom(c.b));
      if (c.tipo === "par" && (c.a === num || c.b === num)) { const o = c.a === num ? c.b : c.a; if (!salio.has(o)) out.push("El " + num + " suele salir el mismo día que el " + nom(o)); }
    });
    return out.slice(0, 3);
  } catch (e) { return []; }
}

// ---- 🔀 Cruces entre loterías: un animal sale en una lotería y después en otra el mismo día ----
let CRUCES = { fecha: "", conf: [] };
async function crucesConf() {
  const hoy = hoyVE(); if (CRUCES.fecha === hoy) return CRUCES.conf;
  const ids = Object.keys(FUENTES).filter((id) => AVISO_GUIA[id]), por = {}, fset = new Set();
  for (const id of ids) { const H = await historial(id); por[id] = {}; (H.dias || []).forEach(([f, it]) => { if (f < hoy) { por[id][f] = it.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); fset.add(f); } }); }
  const ok_ = ids.filter((id) => Object.keys(por[id]).length >= 150);
  if (ok_.length < 2) { CRUCES = { fecha: hoy, conf: [] }; return []; }
  const comun = Object.keys(AVISO_GUIA[ok_[0]].A).filter((n) => ok_.every((id) => AVISO_GUIA[id].A[n]));
  const fechas = [...fset].sort(), lim = new Date(fechas[fechas.length - 1] + "T12:00:00Z"); lim.setUTCDate(lim.getUTCDate() - 90);
  const fl = lim.toISOString().slice(0, 10), freq = {};
  ok_.forEach((id) => { const c = {}; let T = 0; fechas.filter((f) => f < fl).forEach((f) => (por[id][f] || []).forEach(([h, n]) => { c[n] = (c[n] || 0) + 1; T++; })); freq[id] = { c, T }; });
  const ev = (X, Y, n, test) => { let N = 0, K = 0, P = 0; const r = (freq[Y].c[n] || 0) / (freq[Y].T || 1);
    fechas.forEach((f) => { if ((f >= fl) !== test) return; const ix = (por[X][f] || []).find((x) => x[1] === n); if (!ix) return; const ys = por[Y][f]; if (!ys || !ys.length) return;
      const rest = ys.filter((y) => y[0] > ix[0]); if (!rest.length) return; N++; if (rest.some((y) => y[1] === n)) K++; P += 1 - Math.pow(1 - r, rest.length); });
    return { n: N, k: K, p: N ? P / N : 0 }; };
  const conf = [];
  ok_.forEach((X) => ok_.forEach((Y) => { if (X === Y) return; comun.forEach((n) => {
    const A = ev(X, Y, n, false); if (A.n < 15 || A.k < 5 || !A.p || A.k / A.n < A.p * 1.4) return;
    const B = ev(X, Y, n, true); if (B.n >= 15 && B.k >= 5 && B.k / B.n >= B.p * 1.4 && patTail(B.k, B.n, B.p) < 0.002) conf.push({ a: n, x: X, y: Y, k: B.k, n: B.n, p: B.p }); }); }));
  CRUCES = { fecha: hoy, conf };
  return conf;
}
async function alertasCruce(lot, num) {
  try {
    const conf = await crucesConf(), hoy = hoyVE(), out = [];
    for (const c of conf) {
      if (c.x !== lot || c.a !== num) continue;
      const H = await historial(c.y), d = (H.dias || []).find((x) => x[0] === hoy);
      if (d && d[1].some((x) => x[1] === num)) continue;
      out.push("🔀 El " + num + " suele cruzar a " + ((AVISO_GUIA[c.y] || {}).nombre || c.y) + " hoy");
    }
    return out;
  } catch (e) { return []; }
}
// 🔄 Ciclo: de los animales de la guía para el próximo sorteo, los 2 que mejor están en su ciclo
// (cuántos sorteos llevan sin salir). En Guácharo no se usa: en la prueba de 1 año no mejoró.
const CYC_EDG = [2, 5, 12, 24, 48, 96, 200];
const cycBinS = (g) => { if (g >= 99999) return 8; for (let i = 0; i < CYC_EDG.length; i++) if (g <= CYC_EDG[i]) return i; return 7; };
async function cicloAviso(lot, x) {
  if (lot === "guacharo") return [];
  const g = AVISO_GUIA[lot]; if (!g) return [];
  const cand = (g.sig[x] || []).filter((k) => k !== x); if (!cand.length) return [];
  const h = await historial(lot); const seq = [];
  (h.dias || []).forEach(([f, it]) => (it || []).slice().sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(([hr, n]) => { if (g.A[n]) seq.push(n); }));
  if (seq.length < 1500) return [];
  const an = Object.keys(g.A), N = an.length, hit = {}, esp = {}, li = {};
  seq.forEach((n, i) => { if (i > 300) an.forEach((a) => { const b = cycBinS(a in li ? i - li[a] : 99999); esp[b] = (esp[b] || 0) + 1 / N; if (a === n) hit[b] = (hit[b] || 0) + 1; }); li[n] = i; });
  const tasa = (k) => { const b = cycBinS(k in li ? seq.length - li[k] : 99999); return ((hit[b] || 0) + 5) / ((esp[b] || 0) + 5); };
  return cand.map((k) => [k, tasa(k)]).filter(([, r]) => r >= 1.2).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => ((g.A[k] || [])[1] || "") + " " + k);
}
// ---- 🤖 Tripletas IA para mañana (mismo cálculo que el bot: ciclo por días, probado ×1.50) ----
const fijBinS = (g) => (g <= 1 ? 0 : g <= 2 ? 1 : g <= 4 ? 2 : g <= 8 ? 3 : g <= 16 ? 4 : 5);
async function iaManana(lot) {
  const g = AVISO_GUIA[lot]; if (!g) return null;
  const A = g.A, rk = (k) => (k === "0" ? -2 : k === "00" ? -1 : +k), order = Object.keys(A).sort((a, b) => rk(a) - rk(b)), N = order.length;
  const h = await historial(lot); const D = (h.dias || []).slice().sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (D.length < 60) return null;
  const hh = {}, e = {}, ls = {}; let i = 0;
  D.forEach(([f, it]) => { const s = new Set((it || []).map((x) => x[1]).filter((n) => A[n])); const d0 = new Date(f + "T12:00:00Z");
    if (i++ > 30 && s.size >= 8) { const base = s.size / N; order.forEach((a) => { if (!ls[a]) return; const b = fijBinS(Math.round((d0 - new Date(ls[a] + "T12:00:00Z")) / 864e5)); e[b] = (e[b] || 0) + base; if (s.has(a)) hh[b] = (hh[b] || 0) + 1; }); }
    s.forEach((n) => (ls[n] = f)); });
  const T = {}; Object.keys(e).forEach((b) => (T[b] = ((hh[b] || 0) + 5) / (e[b] + 5)));
  const man = new Date(hoyVE() + "T12:00:00Z"); man.setUTCDate(man.getUTCDate() + 1);
  const gap = (a) => Math.round((man - new Date(ls[a] + "T12:00:00Z")) / 864e5);
  const four = order.filter((a) => ls[a]).map((a) => ({ n: a, g: gap(a), r: T[fijBinS(gap(a))] || 1 })).sort((x, y) => y.r - x.r || x.g - y.g || order.indexOf(x.n) - order.indexOf(y.n)).slice(0, 4);
  if (four.length < 4) return null;
  const nm = (n) => ((A[n] || [])[1] ? A[n][1] + " " : "") + n;
  const tri = []; for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) for (let c = b + 1; c < 4; c++) tri.push([four[a].n, four[b].n, four[c].n].map(nm).join(" - "));
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  return { para: dias[man.getUTCDay()] + " " + man.getUTCDate() + "/" + (man.getUTCMonth() + 1), tri };
}
async function enviarAvisos(lot) {
  const keys = (await redis(["KEYS", "sub:*"])) || [];
  if (!keys.length) return 0;
  const vals = await redis(["MGET", ...keys]);
  const anu = new Set((((await redis(["KEYS", "anu:*"])) || [])).map((k) => k.slice(4)));
  let n = 0;
  for (let i = 0; i < keys.length; i++) {
    if (!vals[i]) continue;
    const s = JSON.parse(vals[i]);
    if (Date.now() > s.fin || (s.hash && anu.has(s.hash))) { await redis(["DEL", keys[i]]); continue; }
    if (!s.lots.includes(lot)) continue;
    try { const st = await empujar(s.sub.endpoint); if (st === 404 || st === 410) await redis(["DEL", keys[i]]); else n++; } catch (e) {}
  }
  return n;
}
let vigilando = false;
async function vigilar() {
  if (!R_URL || !R_TOK || vigilando) return;
  const hh = +horaVE().split(":")[0]; if (hh < 7 || hh > 21) return;
  vigilando = true;
  try {
    for (const lot of Object.keys(FUENTES)) {
      try {
        const r = await datos(lot, "resultados");
        if (!r.datos || !r.datos.length) continue;
        try { await guardarDia(lot, hoyVE(), r.datos.map((x) => [x.hora, x.num])); for (const k of [...HISTCACHE.keys()]) if (k.startsWith(lot + ":")) HISTCACHE.delete(k); } catch (e) {}
        const u = r.datos[r.datos.length - 1];
        const clave = hoyVE() + " " + u.hora + " " + u.num;
        const prev = await redis(["GET", "ult:" + lot]);
        if (prev && JSON.parse(prev).clave === clave) continue;
        const g = AVISO_GUIA[lot] || { A: {}, sig: {} }, a = g.A[u.num] || [u.nombre || "", ""];
        const pat = (await alertasPatron(lot, u.num, r.datos.slice(0, -1).map((x) => x.num))).concat(await alertasCruce(lot, u.num));
        let ciclo = []; try { ciclo = await cicloAviso(lot, u.num); } catch (e) {}
        let ia = null;
        if (+String(u.hora).split(":")[0] >= 19) { try { const ya = await redis(["GET", "ia:" + lot]); if (ya !== hoyVE()) { ia = await iaManana(lot); if (ia) await redis(["SET", "ia:" + lot, hoyVE()]); } } catch (e) {} }
        await redis(["SET", "ult:" + lot, JSON.stringify({ lot, clave, hora: u.hora, num: u.num, nombre: a[0], emoji: a[1], picks: (g.sig[u.num] || []).map((k) => ((g.A[k] || [])[1] || "") + " " + k), ciclo, pat, ia, ts: Date.now() })]);
        if (prev) await enviarAvisos(lot); // la primera vez solo se guarda, para no avisar algo viejo
      } catch (e) {}
    }
  } finally { vigilando = false; }
}
async function ultimos() {
  const lots = Object.keys(FUENTES);
  const vals = await redis(["MGET", ...lots.map((l) => "ult:" + l)]);
  const o = {}; lots.forEach((l, i) => { if (vals[i]) o[l] = Object.assign(JSON.parse(vals[i]), { lotNombre: (AVISO_GUIA[l] || {}).nombre || l }); });
  return o;
}

// ===================== HISTORIAL DE 1 AÑO =====================
// Guarda en Upstash los sorteos de cada día: clave "h:<lotería>:<AAAA-MM-DD>" = [["13:00","09"], ...]
// Al arrancar, completa poco a poco los días que falten del último año (sin apuro, para no cargar a lotoven).
const HIST_DIAS = 365;   // lo que usa el bot
const HIST_MAX = 2920;   // 8 años guardados para estudiar los datos (/api/historial?lot=x&dias=2920)
const fechaMenos = (n) => { const d = new Date(hoyVE() + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
async function bajarDia(lot, fecha) {
  const url = FUENTES[lot].resultados.replace(/\/?$/, "/") + fecha + "/";
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (BotAnimalitos)", "Accept": "text/html" }, signal: AbortSignal.timeout(20000) });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error("La página respondió " + r.status);
  return parseResultados(await r.text(), lot).map((x) => [x.hora, x.num]);
}
async function guardarDia(lot, fecha, items) { await redis(["SET", "h:" + lot + ":" + fecha, JSON.stringify(items)]); }
const HIST = { corriendo: false, hechos: 0, faltan: 0, errores: 0, ultimo: "" };
async function completarHistorial() {
  if (!R_URL || !R_TOK || HIST.corriendo) return;
  HIST.corriendo = true;
  try {
    for (const [desde, hasta] of [[1, HIST_DIAS], [HIST_DIAS + 1, HIST_MAX]]) for (const lot of Object.keys(FUENTES)) {
      const fechas = []; for (let i = desde; i <= hasta; i++) fechas.push(fechaMenos(i));
      const ya = [];
      for (let i = 0; i < fechas.length; i += 100) ya.push(...(await redis(["MGET", ...fechas.slice(i, i + 100).map((f) => "h:" + lot + ":" + f)])));
      const pend = fechas.filter((f, i) => ya[i] == null);
      HIST.faltan += pend.length;
      for (const f of pend) {
        try { await guardarDia(lot, f, await bajarDia(lot, f)); HIST.hechos++; HIST.ultimo = lot + " " + f; }
        catch (e) { HIST.errores++; }
        HIST.faltan--;
        await new Promise((ok) => setTimeout(ok, 2500));
      }
    }
  } finally { HIST.corriendo = false; HISTCACHE.clear(); }
}
const HISTCACHE = new Map();
async function historial(lot, nd = HIST_DIAS) {
  const ck = lot + ":" + nd, c = HISTCACHE.get(ck); if (c && Date.now() - c.t < 10 * 60000) return c.d;
  const fechas = []; for (let i = nd; i >= 0; i--) fechas.push(fechaMenos(i));
  const vals = [];
  for (let i = 0; i < fechas.length; i += 100) vals.push(...(await redis(["MGET", ...fechas.slice(i, i + 100).map((f) => "h:" + lot + ":" + f)])));
  const dias = []; fechas.forEach((f, i) => { if (vals[i]) { const it = JSON.parse(vals[i]); if (it.length) dias.push([f, it]); } });
  const d = { ok: true, lot, desde: dias.length ? dias[0][0] : null, hasta: dias.length ? dias[dias.length - 1][0] : null, dias, cargando: HIST.corriendo, faltan: HIST.faltan };
  HISTCACHE.set(ck, { t: Date.now(), d });
  return d;
}

async function listaCodigos() {
  const keys = (await redis(["KEYS", "cod:*"])) || [];
  const vals = keys.length ? await redis(["MGET", ...keys]) : [];
  const ahora = Date.now();
  const demos = ((await redis(["KEYS", "demo:*"])) || []).length;
  const ak = (await redis(["KEYS", "anu:*"])) || [], av = ak.length ? await redis(["MGET", ...ak]) : [];
  const anu = {}; ak.forEach((k, i) => { try { anu[k.slice(4)] = JSON.parse(av[i] || "{}"); } catch (e) { anu[k.slice(4)] = {}; } });
  const gk = (await redis(["KEYS", "gen:*"])) || [], gv = gk.length ? await redis(["MGET", ...gk]) : [];
  const gen = {}; gk.forEach((k, i) => { try { gen[k.slice(4)] = JSON.parse(gv[i] || "{}"); } catch (e) { gen[k.slice(4)] = {}; } });
  const usadoH = new Set(keys.map((k) => k.slice(4)));
  const rk = (await redis(["KEYS", "reg:gan:*"])) || [], rv = rk.length ? await redis(["MGET", ...rk]) : [];
  const regalos = rv.map((v) => { try { return JSON.parse(v); } catch (e) { return null; } }).filter(Boolean).sort((a, b) => b.t - a.t);
  return {
    anulados: Object.keys(anu).filter((h) => !usadoH.has(h)).map((h) => ({ hash: h, codigo: anu[h].codigo || (gen[h] && gen[h].codigo) || "(código sin activar)", t: anu[h].t })),
    regalos, regaloTotal: REGALO.premios, regaloProb: REGALO.prob,
    sinUsar: Object.keys(gen).filter((h) => !usadoH.has(h) && !anu[h]).map((h) => ({ hash: h, codigo: gen[h].codigo, t: gen[h].t, gen: !!gen[h].gen, dias: +gen[h].dias || DIAS })).sort((a, b) => (b.t || 0) - (a.t || 0)),
    demos,
    total: CODIGOS.size + Object.keys(gen).filter((h) => !CODIGOS.has(h)).length,
    usados: keys.map((k, i) => { const r = JSON.parse(vals[i] || "{}"); const fin = finDe(r.ini || 0, r.dias);
      return { hash: k.slice(4), codigo: r.codigo || "(sin nombre)", ua: r.ua || "", ini: r.ini, fin, uso: r.uso, dias: r.dias || DIAS, libre: !r.dev, estado: anu[k.slice(4)] ? "anulado" : ahora > fin ? "vencido" : "activo" }; })
      .sort((a, b) => (b.ini || 0) - (a.ini || 0)),
  };
}
const ADMIN_HTML = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin · Bot de animalitos</title>
<style>body{margin:0;background:#070b18;color:#e8f1ff;font:15px/1.45 system-ui,sans-serif;padding:16px}h1{font-size:19px;color:#2ef2ff;margin:0 0 12px}
input,button{font:inherit;border-radius:10px;border:1px solid #2b3550;background:#0b1124;color:#e8f1ff;padding:9px 12px}button{cursor:pointer}
.b1{background:linear-gradient(90deg,#2ef2ff,#ff3df2);color:#05060c;border:0;font-weight:700}
.it{display:flex;gap:10px;align-items:center;border:1px solid #24304f;border-radius:12px;padding:10px;margin:8px 0;background:#0b1124;flex-wrap:wrap}
.it b{font-family:monospace;font-size:15px}.s{color:#8a9bbd;font-size:13px}.ok{color:#2dff8a}.ve{color:#ff8ea0}.li{color:#ffd23f}
.lb{margin-left:auto;border-color:rgba(255,59,92,.6);color:#ff8ea0}#msg{color:#ff8ea0;margin:8px 0}
.el{border-color:#ff3b5c;background:#2a0710;color:#ff8ea0}.rs{margin-left:auto;border-color:#2dff8a;color:#2dff8a}.an{color:#ff3b5c;font-weight:700}
.fil{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.fil button{border-radius:999px;padding:6px 12px;font-size:13.5px}.fil .on{background:#2dff8a22;border-color:#2dff8a;color:#2dff8a;font-weight:700}
.cp{margin-left:auto;border-color:#2ef2ff;color:#2ef2ff}.gbox{border-color:#2dff8a88!important}.gres{margin-top:6px;padding:8px;border-radius:10px;background:#0f2a1a;border:1px solid #2dff8a55}.gl{font-family:monospace;font-size:15px;line-height:1.7}.gres .cp{margin:6px 0 0}
.dz{font-size:11.5px;font-weight:800;padding:2px 8px;border-radius:999px;border:1px solid #2b3550;color:#8a9bbd;vertical-align:middle}.dz.d2,.dz.d4{color:#ff9fd8;border-color:#ff9fd888}.dz.d14{color:#2ef2ff;border-color:#2ef2ff88}.dz.d30{color:#ffd76a;border-color:#ffd76a88}
.rbox{border-color:#ffd76a88!important;background:#1a0f05}.abox{display:block}.abox summary{cursor:pointer;color:#8a9bbd}.abox textarea{width:100%;box-sizing:border-box;min-height:80px;margin:8px 0;border-radius:10px;background:#0b1124;color:#e8f1ff;border:1px solid #2b3550;font:inherit}
.ebox{border:1px dashed #ff3b5c88;border-radius:12px;padding:10px;margin:10px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center}.ebox input{flex:1;min-width:150px}</style></head><body>
<h1>◆ Códigos · Bot de animalitos</h1>
<div id="login"><input id="cl" type="password" placeholder="Clave de administrador"> <button class="b1" id="en">Entrar</button><div id="msg"></div></div>
<div id="pan" style="display:none"><div class="s" id="res"></div><div class="ebox rbox" id="reg"></div>
<div class="ebox gbox"><span>➕ Generar códigos nuevos:</span><input id="gn" type="number" min="1" max="50" value="5" style="max-width:70px;flex:none"><span>de</span><select id="gd" style="font:inherit;border-radius:10px;border:1px solid #2b3550;background:#0b1124;color:#e8f1ff;padding:9px 10px"><option value="2">2 días</option><option value="4">4 días</option><option value="7" selected>7 días</option><option value="14">14 días</option><option value="30">30 días</option></select><button class="b1" id="gbtn">Generar</button><div id="gout" style="width:100%"></div></div>
<div class="ebox"><span>🚫 Eliminar un código (aunque no esté activado):</span><input id="ecod" placeholder="BOT-XXXX-XXXX"><button class="el" id="ebtn">Eliminar</button><span class="s" id="emsg"></span></div>
<div class="fil" id="fil"></div>
<input id="bus" placeholder="Buscar código" style="width:100%;margin:6px 0;box-sizing:border-box"><div id="lis"></div>
<details class="ebox abox"><summary>📋 Agregar a "Sin usar" los códigos que ya tenías (pega la lista)</summary><textarea id="atx" placeholder="BOT-XXXX-XXXX&#10;BOT-XXXX-XXXX"></textarea><button class="b1" id="abtn">Guardar en mi lista</button><span class="s" id="amsg"></span></details></div>
<script>
let C=sessionStorage.getItem("cl")||"";const f=d=>new Date(d).toLocaleString("es-VE",{day:"2-digit",month:"2-digit",hour:"numeric",minute:"2-digit"});
async function api(p,b){const r=await fetch(p,{method:b?"POST":"GET",headers:{"X-Clave":C,"Content-Type":"application/json"},body:b?JSON.stringify(b):undefined});if(r.status===401)throw new Error("Clave incorrecta");const j=await r.json();if(j.error)throw new Error(j.error);return j;}
let D=null, FIL="uso";
async function cargar(){try{D=await api("/admin/api/lista");sessionStorage.setItem("cl",C);document.getElementById("login").style.display="none";document.getElementById("pan").style.display="";pintar();}catch(e){document.getElementById("msg").textContent=e.message;}}
function copiar(t,b){const ok=()=>{const o=b.textContent;b.textContent="✅ Copiado";setTimeout(()=>b.textContent=o,1500);};try{navigator.clipboard.writeText(t).then(ok,()=>{prompt("Copia:",t);});}catch(e){prompt("Copia:",t);}}
function pintar(){const q=document.getElementById("bus").value.trim().toUpperCase();
const U=D.usados, SU=D.sinUsar||[], AN=D.anulados||[];
const uso=U.filter(x=>x.estado==="activo"), ven=U.filter(x=>x.estado==="vencido"), elim=U.filter(x=>x.estado==="anulado");
const nEl=elim.length+AN.length, nSin=Math.max(0,D.total-U.length-AN.length);
const RG=D.regalos||[];document.getElementById("reg").innerHTML='<div style="width:100%"><b>🎁 Regalo de Navidad:</b> '+RG.length+' de '+(D.regaloTotal||10)+' premios entregados · probabilidad 1 en '+(D.regaloProb||200)+(RG.length?'<div class="s" style="margin-top:4px">'+RG.map(x=>'🏆 <b>'+x.codigo+'</b> · '+f(x.t)+' · '+(x.ua||"")+(x.donde==="entrada"?" · gente nueva":(x.donde==="bot"?" · cliente":""))).join("<br>")+'</div>':'<div class="s">Todavía nadie ha ganado.</div>')+'</div>';
document.getElementById("res").textContent=D.total+" códigos · "+uso.length+" en uso ahora · "+ven.length+" vencidos · "+nEl+" eliminados · "+nSin+" sin usar · "+(D.demos||0)+" pruebas gratis";
const T=[["uso","🟢 En uso",uso.length],["sin","🆕 Sin usar",SU.length],["ven","⏰ Vencidos",ven.length],["eli","🚫 Eliminados",nEl],["tod","Todos",""]];
document.getElementById("fil").innerHTML=T.map(t=>'<button data-f="'+t[0]+'" class="'+(FIL===t[0]?"on":"")+'">'+t[1]+(t[2]!==""?" ("+t[2]+")":"")+'</button>').join("");
document.querySelectorAll("#fil button").forEach(b=>b.onclick=()=>{FIL=b.dataset.f;pintar();});
const m=x=>!q||String(x.codigo).includes(q);
const fU=x=>'<div class="it"><div><b>'+x.codigo+'</b> <span class="dz d'+(x.dias||7)+'">'+(x.dias||7)+' días</span><div class="s">'+(x.libre?"liberado, esperando otro dispositivo":(x.ua||"dispositivo"))+' · desde '+f(x.ini)+'</div></div>'+(x.estado==="anulado"?'<div class="an">🚫 Eliminado</div><button class="rs" data-h="'+x.hash+'">Restaurar</button>':'<div class="'+(x.estado==="vencido"?"ve":(x.libre?"li":"ok"))+'">'+(x.estado==="vencido"?"Vencido "+f(x.fin):"Activo · vence "+f(x.fin))+'</div>'+(x.libre||x.estado==="vencido"?"":'<button class="lb" data-h="'+x.hash+'">Liberar</button>')+'<button class="el" data-h="'+x.hash+'">Eliminar</button>')+'</div>';
const fS=x=>'<div class="it"><div><b>'+x.codigo+'</b> <span class="dz d'+(x.dias||7)+'">'+(x.dias||7)+' días</span><div class="s">Nunca activado · '+(x.gen?"creado ":"agregado ")+(x.t?f(x.t):"")+'</div></div><button class="cp" data-c="'+x.codigo+'">⧉ Copiar</button><button class="el" data-h="'+x.hash+'">Eliminar</button></div>';
const fA=x=>'<div class="it"><div><b>'+x.codigo+'</b><div class="s">sin activar · eliminado '+(x.t?f(x.t):"")+'</div></div><div class="an">🚫 Eliminado</div><button class="rs" data-h="'+x.hash+'">Restaurar</button></div>';
let h="";
if(FIL==="uso") h=uso.filter(m).map(fU).join("")||'<div class="s">Nadie está usando un código ahora mismo.</div>';
else if(FIL==="sin") h=(SU.filter(m).map(fS).join("")||'<div class="s">No hay códigos sin usar en tu lista. Genera nuevos arriba o pega los que ya tenías abajo.</div>')+(nSin>SU.length?'<div class="s" style="margin:6px 0">Hay '+(nSin-SU.length)+' códigos más sin usar que no están en tu lista (de los que te mandaron antes). Pégalos abajo para verlos aquí.</div>':"");
else if(FIL==="ven") h=ven.filter(m).map(fU).join("")||'<div class="s">No hay códigos vencidos.</div>';
else if(FIL==="eli") h=(elim.filter(m).map(fU).join("")+AN.filter(m).map(fA).join(""))||'<div class="s">No hay códigos eliminados.</div>';
else h=(U.filter(m).map(fU).join("")+SU.filter(m).map(fS).join("")+AN.filter(m).map(fA).join(""))||'<div class="s">Sin códigos.</div>';
document.getElementById("lis").innerHTML=h;
document.querySelectorAll(".it .cp").forEach(b=>b.onclick=()=>copiar(b.dataset.c,b));
document.querySelectorAll(".it .el").forEach(b=>b.onclick=async()=>{if(!confirmar(b,"Eliminar"))return;await api("/admin/api/eliminar",{hash:b.dataset.h});cargar();});
document.querySelectorAll(".rs").forEach(b=>b.onclick=async()=>{if(!confirmar(b,"Restaurar"))return;await api("/admin/api/restaurar",{hash:b.dataset.h});cargar();});
document.querySelectorAll(".lb").forEach(b=>b.onclick=async()=>{if(!confirmar(b))return;await api("/admin/api/liberar",{hash:b.dataset.h});cargar();});}
document.getElementById("gbtn").onclick=async()=>{const b=document.getElementById("gbtn"),o=document.getElementById("gout"),n=+document.getElementById("gn").value||0;if(n<1||n>50){o.innerHTML='<div class="ve">Escribe un número del 1 al 50.</div>';return;}b.disabled=true;o.innerHTML='<div class="s">Generando…</div>';
try{const dd=+document.getElementById("gd").value||7;const r=await api("/admin/api/generar",{n,dias:dd});const L=r.codigos||[];o.innerHTML='<div class="gres"><div class="ok"><b>✅ '+L.length+' código'+(L.length>1?"s":"")+' nuevo'+(L.length>1?"s":"")+' de '+(r.dias||dd)+' días listo'+(L.length>1?"s":"")+' (funcionan ya):</b></div><div class="gl">'+L.join("<br>")+'</div><button class="cp" id="gcp">⧉ Copiar '+(L.length>1?"los "+L.length:"")+'</button></div>';document.getElementById("gcp").onclick=e=>copiar(L.join("\\n"),e.target);FIL="sin";cargar();}catch(e){o.innerHTML='<div class="ve">'+e.message+'</div>';}b.disabled=false;};
document.getElementById("abtn").onclick=async()=>{const m=document.getElementById("amsg"),t=document.getElementById("atx").value;if(!t.trim()){m.textContent="Pega los códigos primero";return;}
try{const r=await api("/admin/api/agregar",{texto:t});m.textContent="✅ "+r.agregados+" agregados"+(r.ya?" · "+r.ya+" ya estaban":"")+(r.malos.length?" · ❌ no existen: "+r.malos.join(", "):"");document.getElementById("atx").value="";FIL="sin";cargar();}catch(e){m.textContent=e.message;}};
function confirmar(b,t){t=t||"Liberar";if(b.dataset.c)return true;b.dataset.c=1;b.textContent="¿Seguro? Toca otra vez";setTimeout(()=>{b.dataset.c="";b.textContent=t},4000);return false;}
document.getElementById("ebtn").onclick=async()=>{const b=document.getElementById("ebtn"),m=document.getElementById("emsg"),c=document.getElementById("ecod").value.trim();if(!c){m.textContent="Escribe el código";return;}if(!confirmar(b,"Eliminar"))return;try{await api("/admin/api/eliminar",{codigo:c});m.textContent="✅ "+c.toUpperCase()+" eliminado";document.getElementById("ecod").value="";cargar();}catch(e){m.textContent=e.message;}};
document.getElementById("en").onclick=()=>{C=document.getElementById("cl").value;cargar();};
document.getElementById("bus").oninput=pintar; if(C)cargar();
</script></body></html>`;


// ===================== ⚽ FÚTBOL (football-data.org, plan gratis) =====================
// Variable en Render (Environment): FOOTBALL_DATA_KEY
// Descarga las temporadas 1 vez cada 12 horas y los partidos de -3 a +4 días cada 30 min (solo cuando alguien abre la pestaña).
// Nada en vivo: solo pronósticos antes del partido y el resultado final después.
const FD_KEY = process.env.FOOTBALL_DATA_KEY || "";
const FUT_COMPS = { CL: "Champions", PL: "Premier League", PD: "LaLiga", SA: "Serie A", BL1: "Bundesliga", FL1: "Ligue 1", DED: "Eredivisie", PPL: "Portugal", BSA: "Brasil" };
const FUT_PRIOR = { PL: 0, PD: -0.08, SA: -0.08, BL1: -0.1, FL1: -0.18, PPL: -0.25, DED: -0.25, BSA: -0.2, OTRO: -0.4 };
const FUT_LR = 0.05, FUT_LR_LIGA = 0.03, FUT_LRC = 0.02;   // probado: en ligas funciona mejor cambiar más despacio; Champions igual
const FUT = { matches: new Map(), teams: {}, meta: {}, preds: {}, model: null, cargado: false, ocupado: false, winAt: 0, builtAt: 0, err: "" };

let fdUlt = 0, fdCola = Promise.resolve();
async function fdReal(path) {
  if (!FD_KEY) throw new Error("sin_clave");
  const espera = fdUlt + (+process.env.FD_GAP || 6500) - Date.now();          // plan gratis: 10 consultas por minuto
  if (espera > 0) await new Promise(r => setTimeout(r, espera));
  fdUlt = Date.now();
  const r = await fetch("https://api.football-data.org/v4" + path, { headers: { "X-Auth-Token": FD_KEY }, signal: AbortSignal.timeout(25000) });
  if (r.status === 429) { fdUlt = Date.now() + 60000; throw new Error("limite"); }
  if (!r.ok) throw new Error("fd_" + r.status);
  return r.json();
}
function fd(path) { const p = fdCola.then(() => fdReal(path)); fdCola = p.catch(() => {}); return p; }

function futCompacta(m, comp) {
  const s = m.score || {};
  const ft = (s.regularTime && s.regularTime.home != null) ? s.regularTime : (s.fullTime || {});   // resultado a los 90 minutos
  const h = m.homeTeam || {}, a = m.awayTeam || {};
  if (h.id) FUT.teams[h.id] = h.shortName || h.name || FUT.teams[h.id] || "?";
  if (a.id) FUT.teams[a.id] = a.shortName || a.name || FUT.teams[a.id] || "?";
  return { id: m.id, d: m.utcDate, c: comp || (m.competition && m.competition.code), h: h.id, a: a.id, st: m.status, hg: ft.home, ag: ft.away, stg: m.stage || "" };
}
const futRedis = async (cmd) => { try { return await redis(cmd); } catch (e) { return null; } };

async function futCargar() {
  if (FUT.cargado) return;
  FUT.cargado = true;
  try {
    const [meta, teams, preds] = await Promise.all([futRedis(["GET", "fut:meta"]), futRedis(["GET", "fut:teams"]), futRedis(["GET", "fut:preds"])]);
    FUT.meta = meta ? JSON.parse(meta) : {};
    FUT.teams = teams ? JSON.parse(teams) : {};
    FUT.preds = preds ? JSON.parse(preds) : {};
    const claves = Object.keys(FUT.meta.keys || {});
    if (claves.length) {
      const vals = await futRedis(["MGET", ...claves]) || [];
      vals.forEach(v => { if (v) JSON.parse(v).forEach(m => FUT.matches.set(m.id, m)); });
    }
    FUT.builtAt = FUT.meta.at || 0;
    futModelo();
  } catch (e) { FUT.err = String(e.message || e); }
}

// Descarga la temporada actual de cada liga (y la anterior, 1 vez por semana)
async function futTemporadas() {
  if (!FD_KEY || FUT.ocupado) return;
  FUT.ocupado = true;
  try {
    await futCargar();
    FUT.meta.keys = FUT.meta.keys || {}; FUT.meta.prev = FUT.meta.prev || {};
    for (const comp of Object.keys(FUT_COMPS)) {
      let j;
      try { j = await fd("/competitions/" + comp + "/matches"); } catch (e) { FUT.err = comp + ": " + e.message; if (e.message === "limite") break; continue; }
      const ms = (j.matches || []);
      const temp = parseInt((j.filters && j.filters.season) || (ms[0] && ms[0].season && String(ms[0].season.startDate).slice(0, 4)), 10);
      const lista = ms.map(m => futCompacta(m, comp));
      lista.forEach(m => FUT.matches.set(m.id, m));
      const k = "fut:m:" + comp + ":" + temp;
      FUT.meta.keys[k] = Date.now();
      await futRedis(["SET", k, JSON.stringify(lista)]);
      if (temp && (!FUT.meta.prev[comp] || Date.now() - FUT.meta.prev[comp] > 7 * 86400000)) {
        try {
          const jp = await fd("/competitions/" + comp + "/matches?season=" + (temp - 1));
          const lp = (jp.matches || []).map(m => futCompacta(m, comp));
          lp.forEach(m => FUT.matches.set(m.id, m));
          const kp = "fut:m:" + comp + ":" + (temp - 1);
          FUT.meta.keys[kp] = Date.now();
          await futRedis(["SET", kp, JSON.stringify(lp)]);
        } catch (e) { if (e.message === "limite") break; }
        FUT.meta.prev[comp] = Date.now();
      }
    }
    // Solo se guardan las 2 temporadas más nuevas de cada liga
    const porComp = {};
    Object.keys(FUT.meta.keys).forEach(k => { const [, , c, t] = k.split(":"); (porComp[c] = porComp[c] || []).push(+t); });
    for (const c in porComp) { porComp[c].sort((x, y) => y - x).slice(2).forEach(t => { delete FUT.meta.keys["fut:m:" + c + ":" + t]; futRedis(["DEL", "fut:m:" + c + ":" + t]); }); }
    FUT.meta.at = Date.now(); FUT.builtAt = FUT.meta.at;
    await futRedis(["SET", "fut:meta", JSON.stringify(FUT.meta)]);
    await futRedis(["SET", "fut:teams", JSON.stringify(FUT.teams)]);
    futModelo();
  } finally { FUT.ocupado = false; }
}

// Modelo: fuerza de ataque y defensa de cada equipo (Poisson), igual que en la prueba
function futModelo() {
  const todos = [...FUT.matches.values()];
  const pais = {};
  for (const m of todos) if (m.c !== "CL" && m.h && m.a) { pais[m.h] = pais[m.h] || m.c; pais[m.a] = pais[m.a] || m.c; }
  const ms = todos.filter(m => m.st === "FINISHED" && m.hg != null && m.ag != null && m.h && m.a).sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
  const ca = { ...FUT_PRIOR }, cd = { ...FUT_PRIOR }, att = {}, dfn = {}, base = {}, ha = {};
  const P = t => pais[t] || "OTRO";
  const ini = t => { if (!(t in att)) { att[t] = ca[P(t)] || 0; dfn[t] = cd[P(t)] || 0; } };
  for (const m of ms) {
    ini(m.h); ini(m.a);
    if (!(m.c in base)) { base[m.c] = Math.log(1.35); ha[m.c] = 0.25; }
    const neutral = m.stg === "FINAL";
    const lh = Math.exp(base[m.c] + (neutral ? 0 : ha[m.c]) + att[m.h] - dfn[m.a]), la = Math.exp(base[m.c] + att[m.a] - dfn[m.h]);
    const eh = m.hg - lh, ea = m.ag - la;
    const lr = m.c === "CL" ? FUT_LR : FUT_LR_LIGA;
    att[m.h] += lr * eh; dfn[m.a] -= lr * eh; att[m.a] += lr * ea; dfn[m.h] -= lr * ea;
    const ph = P(m.h), pa = P(m.a);
    ca[ph] += FUT_LRC * eh; cd[pa] -= FUT_LRC * eh; ca[pa] += FUT_LRC * ea; cd[ph] -= FUT_LRC * ea;
    base[m.c] += 0.005 * (eh + ea) / 2; ha[m.c] += 0.003 * (eh - ea) / 2;
  }
  FUT.model = { att, dfn, base, ha, ca, cd, pais, n: ms.length };
}

function futProbs(lh, la) {
  const f = [1]; for (let i = 1; i <= 10; i++) f[i] = f[i - 1] * i;
  const ph = [], pa = [];
  for (let i = 0; i <= 10; i++) { ph[i] = Math.exp(-lh) * lh ** i / f[i]; pa[i] = Math.exp(-la) * la ** i / f[i]; }
  let p1 = 0, px = 0, p2 = 0, ov = 0, tot = 0;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const p = ph[i] * pa[j]; tot += p;
    if (i > j) p1 += p; else if (i === j) px += p; else p2 += p;
    if (i + j >= 3) ov += p;
  }
  return [p1 / tot, px / tot, p2 / tot, ov / tot];
}
function futPred(m) {
  const M = FUT.model; if (!M) return null;
  const P = t => M.pais[t] || (m.c !== "CL" ? m.c : "OTRO");
  const A = t => (t in M.att ? M.att[t] : (M.ca[P(t)] || 0)), D = t => (t in M.dfn ? M.dfn[t] : (M.cd[P(t)] || 0));
  const b = m.c in M.base ? M.base[m.c] : Math.log(1.35), h = m.c in M.ha ? M.ha[m.c] : 0.25;
  const neutral = m.stg === "FINAL";
  const lh = Math.min(5, Math.exp(b + (neutral ? 0 : h) + A(m.h) - D(m.a))), la = Math.min(5, Math.exp(b + A(m.a) - D(m.h)));
  const [p1, px, p2, ov] = futProbs(lh, la);
  const pr = { "1": p1, "X": px, "2": p2 };
  const top = Object.keys(pr).reduce((x, y) => (pr[y] > pr[x] ? y : x));
  const low = Object.keys(pr).reduce((x, y) => (pr[y] < pr[x] ? y : x));
  let k, kp;
  if (pr[top] >= 0.6) { k = top; kp = pr[top]; } else { k = low === "2" ? "1X" : low === "1" ? "X2" : "12"; kp = 1 - pr[low]; }
  const g = ov >= 0.55 ? "+" : ov <= 0.45 ? "-" : "=";
  const r = n => Math.round(n * 100);
  return { p: [r(p1), r(px), r(p2)], o: r(ov), k, kp: r(kp), g };
}
function futAcierto(pr, hg, ag) {
  if (!pr || hg == null || ag == null) return null;
  const res = hg > ag ? "1" : hg === ag ? "X" : "2";
  return { r: pr.k.includes(res), g: pr.g === "=" ? null : ((hg + ag >= 3) === (pr.g === "+")) };
}
function futSumDias(f, n) { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// Partidos de 3 días atrás a 4 días adelante (1 sola consulta)
async function futVentana() {
  const hoy = hoyVE();
  const j = await fd("/matches?dateFrom=" + futSumDias(hoy, -3) + "&dateTo=" + futSumDias(hoy, 4));
  let nuevos = false;
  const lista = [];
  for (const m of (j.matches || [])) {
    const comp = m.competition && m.competition.code;
    if (!FUT_COMPS[comp]) continue;
    const c = futCompacta(m, comp);
    const prev = FUT.matches.get(c.id);
    if (c.st === "FINISHED" && (!prev || prev.st !== "FINISHED")) nuevos = true;
    FUT.matches.set(c.id, c); lista.push(c);
  }
  if (nuevos) futModelo();
  const ahora = Date.now();
  for (const m of lista) {
    const empezo = new Date(m.d).getTime() <= ahora || !/^(SCHEDULED|TIMED)$/.test(m.st);
    if (!empezo) { const p = futPred(m); if (p) FUT.preds[m.id] = Object.assign(p, { t: m.d }); }   // se congela al empezar el partido
    if (m.st === "FINISHED" && FUT.preds[m.id]) FUT.preds[m.id].res = [m.hg, m.ag];
  }
  for (const id in FUT.preds) if (ahora - new Date(FUT.preds[id].t).getTime() > 10 * 86400000) delete FUT.preds[id];
  FUT.win = lista; FUT.winAt = ahora;
  await futRedis(["SET", "fut:preds", JSON.stringify(FUT.preds)]);
  await futRedis(["SET", "fut:teams", JSON.stringify(FUT.teams)]);
}

async function futRespuesta() {
  if (!FD_KEY) return { ok: false, motivo: "sin_clave" };
  await futCargar();
  if (!FUT.win || Date.now() - FUT.winAt > 30 * 60000) {
    try { await futVentana(); } catch (e) { FUT.err = String(e.message || e); if (!FUT.win) return { ok: false, motivo: "error", error: FUT.err }; }
  }
  if ((!FUT.builtAt || Date.now() - FUT.builtAt > 12 * 3600000) && !FUT.ocupado) futTemporadas().catch(e => { FUT.err = String(e.message || e); });
  const T = id => FUT.teams[id] || "?";
  const partidos = FUT.win.map(m => {
    const pr = FUT.preds[m.id] || null;
    return { id: m.id, c: m.c, t: m.d, st: m.st, h: T(m.h), a: T(m.a), pr: pr ? { p: pr.p, o: pr.o, k: pr.k, kp: pr.kp, g: pr.g } : null,
      res: m.st === "FINISHED" ? [m.hg, m.ag] : null, ac: m.st === "FINISHED" ? futAcierto(pr, m.hg, m.ag) : null };
  }).sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : 0));
  // Cuántas acertó el bot en los últimos 7 días (pronóstico hecho antes del partido)
  let n = 0, ok = 0, ns = 0, oks = 0;
  for (const id in FUT.preds) {
    const p = FUT.preds[id]; if (!p.res || Date.now() - new Date(p.t).getTime() > 7 * 86400000) continue;
    const a = futAcierto(p, p.res[0], p.res[1]); n++; if (a.r) ok++;
    if (p.k.length === 1) { ns++; if (a.r) oks++; }
  }
  return { ok: true, at: FUT.winAt, comps: FUT_COMPS, preparando: !FUT.model || FUT.model.n < 50, stats: { n, ok, ns, oks }, partidos };
}

async function futTalVez() { await futCargar(); if (FD_KEY && Date.now() - FUT.builtAt > 12 * 3600000) await futTemporadas(); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (req.method === "OPTIONS") return enviar(res, 204, "");
    if (u.pathname === "/" || u.pathname === "/salud") return enviar(res, 200, { ok: true, hoy: hoyVE(), loterias: Object.keys(FUENTES), codigos: !!(R_URL && R_TOK) });

    // Códigos de un solo dispositivo
    if (u.pathname === "/api/codigo" && req.method === "POST") {
      const b = await leerCuerpo(req);
      try { return enviar(res, 200, await usarCodigo(b)); }
      catch (e) { return enviar(res, 503, { ok: false, motivo: String(e.message) === "no_config" ? "no_config" : "error" }); }
    }
    if (u.pathname === "/api/regalo/estado") { try { return enviar(res, 200, await regaloEstado()); } catch (e) { return enviar(res, 503, { ok: false }); } }
    if (u.pathname === "/api/regalo" && req.method === "POST") {
      const b = await leerCuerpo(req), ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      try { return enviar(res, 200, await abrirRegalo(b, ip)); } catch (e) { return enviar(res, 503, { ok: false, motivo: "error" }); }
    }
    if (u.pathname === "/api/demo" && req.method === "POST") {
      const b = await leerCuerpo(req);
      try { return enviar(res, 200, await usarDemo(b)); }
      catch (e) { return enviar(res, 503, { ok: false, motivo: String(e.message) === "no_config" ? "no_config" : "error" }); }
    }
    if (u.pathname === "/api/avisos/clave") { try { return enviar(res, 200, { ok: true, pub: (await vapid()).pub }); } catch (e) { return enviar(res, 503, { ok: false }); } }
    if (u.pathname === "/api/avisos/ultimos") { try { return enviar(res, 200, { ok: true, ultimos: await ultimos() }); } catch (e) { return enviar(res, 503, { ok: false }); } }
    if (u.pathname === "/api/avisos/sub" && req.method === "POST") {
      const b = await leerCuerpo(req);
      try { return enviar(res, 200, await suscribir(b)); } catch (e) { return enviar(res, 503, { ok: false, motivo: "error" }); }
    }
    if (u.pathname === "/api/historial") {
      const lot = u.searchParams.get("lot");
      if (!FUENTES[lot]) return enviar(res, 400, { ok: false, motivo: "loteria" });
      const nd = Math.min(HIST_MAX, Math.max(1, parseInt(u.searchParams.get("dias"), 10) || HIST_DIAS));
      try { return enviar(res, 200, await historial(lot, nd)); } catch (e) { return enviar(res, 503, { ok: false, motivo: String(e.message) === "no_config" ? "no_config" : "error" }); }
    }
    if (u.pathname === "/api/futbol") { try { return enviar(res, 200, await futRespuesta()); } catch (e) { return enviar(res, 503, { ok: false, motivo: "error" }); } }
    if (u.pathname === "/api/historial/estado") return enviar(res, 200, { ok: true, corriendo: HIST.corriendo, hechos: HIST.hechos, faltan: HIST.faltan, errores: HIST.errores, ultimo: HIST.ultimo });
    if (u.pathname === "/admin") return enviar(res, 200, ADMIN_HTML, "text/html; charset=utf-8");
    if (u.pathname.startsWith("/admin/api/")) {
      if (!CLAVE || req.headers["x-clave"] !== CLAVE) return enviar(res, 401, { error: "Clave incorrecta" });
      if (u.pathname === "/admin/api/lista") return enviar(res, 200, await listaCodigos());
      if (u.pathname === "/admin/api/generar" && req.method === "POST") { const b = await leerCuerpo(req); return enviar(res, 200, { ok: true, codigos: await generarCodigos(b.n, b.dias), dias: DIAS_OK.includes(+b.dias) ? +b.dias : DIAS }); }
      if (u.pathname === "/admin/api/agregar" && req.method === "POST") { const b = await leerCuerpo(req); return enviar(res, 200, await agregarALista(b.texto)); }
      if (u.pathname === "/admin/api/liberar" && req.method === "POST") {
        const b = await leerCuerpo(req), key = "cod:" + String(b.hash || "");
        const v = await redis(["GET", key]); if (!v) return enviar(res, 404, { error: "No existe" });
        const rec = JSON.parse(v); rec.dev = null; await redis(["SET", key, JSON.stringify(rec)]);
        return enviar(res, 200, { ok: true });
      }
      if (u.pathname === "/admin/api/eliminar" && req.method === "POST") {
        const b = await leerCuerpo(req); let hash = String(b.hash || ""), codigo = "";
        if (!hash && b.codigo) { codigo = normCodeS(b.codigo); hash = cyrb53S(codigo); }
        if (!(await existeCodigo(hash))) return enviar(res, 404, { error: "Ese código no existe" });
        if (!codigo) { const v = await redis(["GET", "cod:" + hash]); if (v) codigo = JSON.parse(v).codigo || ""; }
        if (!codigo) { const g = await redis(["GET", "gen:" + hash]); if (g) codigo = JSON.parse(g).codigo || ""; }
        await redis(["SET", "anu:" + hash, JSON.stringify({ t: Date.now(), codigo })]);
        return enviar(res, 200, { ok: true });
      }
      if (u.pathname === "/admin/api/restaurar" && req.method === "POST") {
        const b = await leerCuerpo(req); await redis(["DEL", "anu:" + String(b.hash || "")]);
        return enviar(res, 200, { ok: true });
      }
    }

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
if (require.main === module) {
  server.listen(PORT, () => console.log("Servidor de resultados listo en el puerto " + PORT));
  setTimeout(vigilar, 20000); setInterval(vigilar, 2 * 60000);
  setTimeout(completarHistorial, 60000); setInterval(completarHistorial, 6 * 3600000);
  if (FD_KEY) { setTimeout(() => futTalVez().catch(() => {}), 90000); setInterval(() => futTalVez().catch(() => {}), 3 * 3600000); }
}

module.exports = { futRespuesta, futModelo, futPred, futVentana, futTemporadas, FUT, futAcierto, bajarDia, historial, completarHistorial, HIST, parseEstadisticas, parseResultados, aTexto, hoyVE, horaVE, vigilar, empujar, suscribir, ultimos, enviarAvisos };

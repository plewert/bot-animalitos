// Servidor de resultados para el Bot de animalitos.
// No necesita librerías: solo Node 18 o más nuevo (Render lo trae).
// Lee las páginas de lotoven.com y entrega los datos al bot en formato JSON.

const http = require("http");
const crypto = require("crypto");

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
  res.writeHead(code, {
    "Content-Type": tipo || "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Clave",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
  });
  res.end(typeof obj === "string" ? obj : JSON.stringify(obj));
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
const DIAS = 7, ACTIVAR_ANTES = "2026-12-31";
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
const finDe = (ini) => ini + DIAS * 86400000;
// 🚫 Códigos eliminados desde el panel de admin: dejan de funcionar
const cyrb53S = (str, seed = 7) => { let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed; for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36); };
const normCodeS = (c) => { const t = String(c || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, ""); return t.length === 11 && t.startsWith("BOT") ? "BOT-" + t.slice(3, 7) + "-" + t.slice(7) : String(c || "").trim().toUpperCase(); };
const anulado = async (hash) => !!(await redis(["GET", "anu:" + hash]));
async function usarCodigo(b) {
  const hash = String(b.hash || ""), dev = String(b.dev || "").slice(0, 64);
  if (!CODIGOS.has(hash)) return { ok: false, motivo: "no_existe" };
  if (await anulado(hash)) return { ok: false, motivo: "anulado" };
  if (!dev) return { ok: false, motivo: "sin_dispositivo" };
  const key = "cod:" + hash;
  let rec = await redis(["GET", key]); rec = rec ? JSON.parse(rec) : null;
  const ahora = Date.now();
  if (!rec) {
    if (!b.activar) return { ok: false, motivo: "no_activado" };
    if (ahora > Date.parse(ACTIVAR_ANTES + "T23:59:59-04:00")) return { ok: false, motivo: "no_activable" };
    rec = { codigo: String(b.codigo || "").slice(0, 20), dev, ua: String(b.ua || "").slice(0, 20), ini: ahora, uso: ahora };
    await redis(["SET", key, JSON.stringify(rec)]);
    return { ok: true, fin: finDe(rec.ini) };
  }
  if (ahora > finDe(rec.ini)) return { ok: false, motivo: "vencido", fin: finDe(rec.ini) };
  if (!rec.dev) { // liberado: lo toma este dispositivo, la semana sigue igual
    if (!b.activar) return { ok: false, motivo: "no_activado" };
    rec.dev = dev; rec.ua = String(b.ua || "").slice(0, 20);
  }
  if (rec.dev !== dev) return { ok: false, motivo: "en_uso" };
  rec.uso = ahora; if (!rec.codigo && b.codigo) rec.codigo = String(b.codigo).slice(0, 20);
  await redis(["SET", key, JSON.stringify(rec)]);
  return { ok: true, fin: finDe(rec.ini) };
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
const AVISO_GUIA = {"activo":{"nombre":"Lotto Activo","A":{"0":["Delfín","🐬"],"10":["Tigre","🐯"],"11":["Gato","🐱"],"12":["Caballo","🐴"],"13":["Mono","🐒"],"14":["Paloma","🕊️"],"15":["Zorro","🦊"],"16":["Oso","🐻"],"17":["Pavo","🦃"],"18":["Burro","🫏"],"19":["Chivo","🐐"],"20":["Cochino","🐷"],"21":["Gallo","🐓"],"22":["Camello","🐫"],"23":["Cebra","🦓"],"24":["Iguana","🦎"],"25":["Gallina","🐔"],"26":["Vaca","🐄"],"27":["Perro","🐶"],"28":["Zamuro","🪶"],"29":["Elefante","🐘"],"30":["Caimán","🐊"],"31":["Lapa","🐹"],"32":["Ardilla","🐿️"],"33":["Pescado","🐟"],"34":["Venado","🦌"],"35":["Jirafa","🦒"],"36":["Culebra","🐍"],"00":["Ballena","🐋"],"01":["Carnero","🐏"],"02":["Toro","🐂"],"03":["Ciempiés","🐛"],"04":["Alacrán","🦂"],"05":["León","🦁"],"06":["Rana","🐸"],"07":["Perico","🦜"],"08":["Ratón","🐭"],"09":["Águila","🦅"]},"sig":{"0":["03","11","18","28","30"],"10":["05","09","11","18","25"],"11":["03","04","05","18","25","33","35","36"],"12":["0","00","04","05","15","16","19","21","31","36"],"13":["0","00","15","16","30","31","34"],"14":["0","00","04","17","35"],"15":["07","12","20","26","30"],"16":["05","12","16","19","28"],"17":["0","00","02","14","15","20","22","26","29","31"],"18":["01","10","15"],"19":["0","00","04","07","12","14","15","21","36"],"20":["03","07","09","30","35"],"21":["05","07","13"],"22":["0","00","16","28","33"],"23":["03","05","06","09","14","24","30","32","36"],"24":["0","00","02","03","07","08","16","20","30","32","35"],"25":["01","10","26","29","33"],"26":["02","15","17","20","24","29","34","35","36"],"27":["0","03","04","13","26","30","32","34"],"28":["01","11","19","22"],"29":["01","02","03","15","17","20","24","26","36"],"30":["0","02","03","04","07","16","20","24","27","31","32"],"31":["01","03","04","29"],"32":["0","00","03","04","05","06","08","09","13","16","23","24","27","30","31","36"],"33":["07","14","23","26","34"],"34":["11","15","36"],"35":["03","04","10","11","27","33","36"],"36":["01","05","10","11","35"],"00":["16","19","22","33","36"],"01":["0","05","12","21","28"],"02":["01","03","07","15","17","19","20","24","26","29","30","35"],"03":["0","02","04","07","11","18","20","24","27","30","32","33","35","36"],"04":["0","00","03","07","11","12","15","19","27","30","32","33","35","36"],"05":["03","04","16","19","28"],"06":["04","05","08","09","21","23","32","36"],"07":["02","03","04","15","20","24","30","33"],"08":["0","00","12","15","16","24","28","32"],"09":["05","06","08","12","20","23","32","34","36"]}},"granjita":{"nombre":"La Granjita","A":{"0":["Delfín","🐬"],"10":["Tigre","🐯"],"11":["Gato","🐱"],"12":["Caballo","🐴"],"13":["Mono","🐒"],"14":["Paloma","🕊️"],"15":["Zorro","🦊"],"16":["Oso","🐻"],"17":["Pavo","🦃"],"18":["Burro","🫏"],"19":["Chivo","🐐"],"20":["Cochino","🐷"],"21":["Gallo","🐓"],"22":["Camello","🐫"],"23":["Cebra","🦓"],"24":["Iguana","🦎"],"25":["Gallina","🐔"],"26":["Vaca","🐄"],"27":["Perro","🐶"],"28":["Zamuro","🪶"],"29":["Elefante","🐘"],"30":["Caimán","🐊"],"31":["Lapa","🐹"],"32":["Ardilla","🐿️"],"33":["Pescado","🐟"],"34":["Venado","🦌"],"35":["Jirafa","🦒"],"36":["Culebra","🐍"],"00":["Ballena","🐋"],"01":["Carnero","🐏"],"02":["Toro","🐂"],"03":["Ciempiés","🐛"],"04":["Alacrán","🦂"],"05":["León","🦁"],"06":["Rana","🐸"],"07":["Perico","🦜"],"08":["Ratón","🐭"],"09":["Águila","🦅"]},"sig":{"0":["03","11","18","28","30"],"10":["05","09","11","18","25","26"],"11":["03","04","05","07","09","18","20","23","25","27","33","34","35","36"],"12":["0","00","04","05","08","15","16","19","21","24","29","31","34","36"],"13":["0","00","06","14","15","16","30","31","34"],"14":["0","00","04","17","19","20","35"],"15":["07","12","20","26","30"],"16":["05","12","16","19","28"],"17":["0","00","02","05","13","14","15","20","22","26","29","31"],"18":["0","01","03","10","11","15","22","34"],"19":["0","00","02","04","06","07","12","14","15","21","28","36"],"20":["03","07","09","30","35"],"21":["05","07","08","13"],"22":["0","00","16","28","33"],"23":["0","00","01","05","06","09","14","24","28","30","32","33","36"],"24":["0","00","02","03","05","07","08","09","16","20","26","30","32","35"],"25":["01","10","26","29","33"],"26":["02","09","15","17","20","25","27","29","34","35","36"],"27":["0","03","04","13","26","30","32","34","35"],"28":["01","11","16","17","19","22"],"29":["01","02","03","10","15","17","20","24","26","36"],"30":["0","02","03","04","07","15","16","20","23","24","27","31","32"],"31":["03","04","17","29","30"],"32":["0","00","02","03","04","05","06","08","09","10","13","15","16","19","23","24","27","30","31","36"],"33":["07","14","23","26","34"],"34":["09","11","13","15","20","23","27","30","36"],"35":["03","04","11","20","26","29","31","32","33","36"],"36":["01","05","10","11","35"],"00":["16","19","22","33","36"],"01":["0","05","12","21","28"],"02":["01","03","07","09","14","15","17","19","20","24","26","29","30","35"],"03":["0","02","04","07","10","11","18","20","23","24","27","29","30","32","33","34","35","36"],"04":["0","00","03","06","07","11","12","14","15","19","27","30","31","32","33","35","36"],"05":["03","04","16","19","28"],"06":["04","05","08","09","21","23","27","32","36"],"07":["02","03","04","15","19","20","24","30","33"],"08":["0","00","06","09","16","22","24","28","31","32"],"09":["05","06","07","08","11","12","20","21","23","26","32","34","36"]}},"guacharo":{"nombre":"Guácharo","A":{"0":["Delfín","🐬"],"10":["Tigre","🐯"],"11":["Gato","🐱"],"12":["Caballo","🐴"],"13":["Mono","🐒"],"14":["Paloma","🕊️"],"15":["Zorro","🦊"],"16":["Oso","🐻"],"17":["Pavo","🦃"],"18":["Burro","🫏"],"19":["Chivo","🐐"],"20":["Cochino","🐷"],"21":["Gallo","🐓"],"22":["Camello","🐫"],"23":["Cebra","🦓"],"24":["Iguana","🦎"],"25":["Gallina","🐔"],"26":["Vaca","🐄"],"27":["Perro","🐶"],"28":["Zamuro","🪶"],"29":["Elefante","🐘"],"30":["Caimán","🐊"],"31":["Lapa","🐹"],"32":["Ardilla","🐿️"],"33":["Pescado","🐟"],"34":["Venado","🦌"],"35":["Jirafa","🦒"],"36":["Culebra","🐍"],"37":["Tortuga","🐢"],"38":["Búfalo","🐃"],"39":["Lechuza","🦉"],"40":["Avispa","🐝"],"41":["Canguro","🦘"],"42":["Tucán","🐦"],"43":["Mariposa","🦋"],"44":["Chigüire","🦫"],"45":["Garza","🦢"],"46":["Puma","🐆"],"47":["Pavo Real","🦚"],"48":["Puercoespín","🦔"],"49":["Pereza","🦥"],"50":["Canario","🐤"],"51":["Pelícano","🦤"],"52":["Pulpo","🐙"],"53":["Caracol","🐌"],"54":["Grillo","🦗"],"55":["Oso Hormiguero","🦡"],"56":["Tiburón","🦈"],"57":["Pato","🦆"],"58":["Hormiga","🐜"],"59":["Pantera","🐈‍⬛"],"60":["Camaleón","🦎"],"61":["Panda","🐼"],"62":["Cachicamo","🐾"],"63":["Cangrejo","🦀"],"64":["Gavilán","🦅"],"65":["Araña","🕷️"],"66":["Lobo","🐺"],"67":["Avestruz","🦩"],"68":["Jaguar","🐆"],"69":["Conejo","🐰"],"70":["Bisonte","🦬"],"71":["Guacamaya","🦜"],"72":["Gorila","🦍"],"73":["Hipopótamo","🦛"],"74":["Turpial","🐦"],"75":["Guácharo","🦇"],"00":["Ballena","🐋"],"01":["Carnero","🐏"],"02":["Toro","🐂"],"03":["Ciempiés","🐛"],"04":["Alacrán","🦂"],"05":["León","🦁"],"06":["Rana","🐸"],"07":["Perico","🦜"],"08":["Ratón","🐭"],"09":["Águila","🦅"]},"sig":{"0":["00","06","14","17","24","37","56","66"],"10":["16","22","31","49","74","75"],"11":["27","37","49","50","59"],"12":["26","34","50","72","73"],"13":["0","00","06","26","29","31","51","59"],"14":["0","00","08","17","21","40","52","72"],"15":["02","20","24","26","29","35","53","56","60"],"16":["10","48","52","54","63","67"],"17":["0","00","09","14","28","55","59","63"],"18":["27","56","64","73","74"],"19":["13","16","18","56","57","70"],"20":["02","15","21","26","29","58","67"],"21":["03","08","54","56","59"],"22":["06","44","60","62","71"],"23":["05","10","16","43","61"],"24":["01","04","48","57","62"],"25":["01","23","32","44","52","63"],"26":["02","04","15","16","20","29","42","51","64","68"],"27":["25","28","52","61","66","73"],"28":["15","47","62","66","71"],"29":["02","09","15","20","26","27","54","67","72"],"30":["33","68"],"31":["19","38","53"],"32":["03","14","70"],"33":["0","71"],"34":["04","05","40","43","50","72"],"35":["12","37","73"],"36":["10","74"],"37":["23","51","53"],"38":["16","33","48"],"39":["01","10","16","35","53","57","61","75"],"40":["02","07","16","20","24","70"],"41":["01","03"],"42":["04","66","69"],"43":["05","32","35"],"44":["27","53","56"],"45":["12","38","62"],"46":["04","08","18"],"47":["06","12","64"],"48":["57","58","62"],"49":["11","21","24"],"50":["12","17","57"],"51":["23","29","61"],"52":["14","15","27","41","72"],"53":["01","15","23","32","33","38","51"],"54":["03","16","39"],"55":["17","34","56"],"56":["13","18"],"57":["01","38","64"],"58":["20","32"],"59":["21","28","49"],"60":["09","22","37"],"61":["0","23","53"],"62":["24","71","74"],"63":["05","67"],"64":["24","42","45","47","74"],"65":["15","27","39"],"66":["27","30","46","54"],"67":["18","36","45"],"68":["33","53","57"],"69":["20","47","52"],"70":["01","02","47"],"71":["15","16","43"],"72":["52","69"],"73":["04","37","40","69"],"74":["10","56","62"],"75":["39","47","61"],"00":["0","09","14","17","23","31","37","54","56"],"01":["24","26","39","43","53","57"],"02":["15","17","20","26","29","40","52","65","70"],"03":["11","18","40","41","68"],"04":["18","24","42","43","48","60"],"05":["08","10","29","43","47"],"06":["19","37","38","44","53","70"],"07":["24","33","38","45","57"],"08":["07","39","42","46","51","55","63","64"],"09":["17","27","28","44","66"]}},"inter":{"nombre":"Lotto Internacional","A":{"0":["Delfín","🐬"],"10":["Tigre","🐯"],"11":["Gato","🐱"],"12":["Caballo","🐴"],"13":["Mono","🐒"],"14":["Paloma","🕊️"],"15":["Zorro","🦊"],"16":["Oso","🐻"],"17":["Pavo","🦃"],"18":["Burro","🫏"],"19":["Chivo","🐐"],"20":["Cochino","🐷"],"21":["Gallo","🐓"],"22":["Camello","🐫"],"23":["Cebra","🦓"],"24":["Iguana","🦎"],"25":["Gallina","🐔"],"26":["Vaca","🐄"],"27":["Perro","🐶"],"28":["Zamuro","🪶"],"29":["Elefante","🐘"],"30":["Caimán","🐊"],"31":["Lapa","🐹"],"32":["Ardilla","🐿️"],"33":["Pescado","🐟"],"34":["Venado","🦌"],"35":["Jirafa","🦒"],"36":["Culebra","🐍"],"00":["Ballena","🐋"],"01":["Carnero","🐏"],"02":["Toro","🐂"],"03":["Ciempiés","🐛"],"04":["Alacrán","🦂"],"05":["León","🦁"],"06":["Rana","🐸"],"07":["Perico","🦜"],"08":["Ratón","🐭"],"09":["Águila","🦅"]},"sig":{"0":["03","11","18","28","30"],"10":["05","09","11","18","25","26"],"11":["03","04","05","07","09","18","20","23","25","27","33","34","35","36"],"12":["0","00","04","05","08","15","16","19","21","24","29","31","34","36"],"13":["0","00","06","14","15","16","30","31","34"],"14":["0","00","04","17","19","20","35"],"15":["07","12","20","26","30"],"16":["05","12","16","19","28"],"17":["0","00","02","05","13","14","15","20","22","26","29","31"],"18":["0","01","03","10","11","15","22","34"],"19":["0","00","02","04","06","07","12","14","15","21","28","36"],"20":["03","07","09","30","35"],"21":["05","07","08","13"],"22":["0","00","16","28","33"],"23":["0","00","01","05","06","09","14","24","28","30","32","33","36"],"24":["0","00","02","03","05","07","08","09","16","20","26","30","32","35"],"25":["01","10","26","29","33"],"26":["02","09","15","17","20","25","27","29","34","35","36"],"27":["0","03","04","13","26","30","32","34","35"],"28":["01","11","16","17","19","22"],"29":["01","02","03","10","15","17","20","24","26","36"],"30":["0","02","03","04","07","15","16","20","23","24","27","31","32"],"31":["03","04","17","29","30"],"32":["0","00","02","03","04","05","06","08","09","10","13","15","16","19","23","24","27","30","31","36"],"33":["07","14","23","26","34"],"34":["09","11","13","15","20","23","27","30","36"],"35":["03","04","11","20","26","29","31","32","33","36"],"36":["01","05","10","11","35"],"00":["16","19","22","33","36"],"01":["0","05","12","21","28"],"02":["01","03","07","09","14","15","17","19","20","24","26","29","30","35"],"03":["0","02","04","07","10","11","18","20","23","24","27","29","30","32","33","34","35","36"],"04":["0","00","03","06","07","11","12","14","15","19","27","30","31","32","33","35","36"],"05":["03","04","16","19","28"],"06":["04","05","08","09","21","23","27","32","36"],"07":["02","03","04","15","19","20","24","30","33"],"08":["0","00","06","09","16","22","24","28","31","32"],"09":["05","06","07","08","11","12","20","21","23","26","32","34","36"]}}};
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
  if (!CODIGOS.has(hash) || !rec) return { ok: false, motivo: "sin_codigo" };
  if (await anulado(hash)) { await redis(["DEL", subKey(endpoint)]); return { ok: false, motivo: "anulado" }; }
  if (rec.dev !== dev) return { ok: false, motivo: "en_uso" };
  const fin = finDe(rec.ini); if (Date.now() > fin) return { ok: false, motivo: "vencido" };
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
        try { await guardarDia(lot, hoyVE(), r.datos.map((x) => [x.hora, x.num])); HISTCACHE.delete(lot); } catch (e) {}
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
  return {
    anulados: Object.keys(anu).filter((h) => !keys.includes("cod:" + h)).map((h) => ({ hash: h, codigo: anu[h].codigo || "(código sin activar)", t: anu[h].t })),
    demos,
    total: CODIGOS.size,
    usados: keys.map((k, i) => { const r = JSON.parse(vals[i] || "{}"); const fin = finDe(r.ini || 0);
      return { hash: k.slice(4), codigo: r.codigo || "(sin nombre)", ua: r.ua || "", ini: r.ini, fin, uso: r.uso, libre: !r.dev, estado: anu[k.slice(4)] ? "anulado" : ahora > fin ? "vencido" : "activo" }; })
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
.ebox{border:1px dashed #ff3b5c88;border-radius:12px;padding:10px;margin:10px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center}.ebox input{flex:1;min-width:150px}</style></head><body>
<h1>◆ Códigos · Bot de animalitos</h1>
<div id="login"><input id="cl" type="password" placeholder="Clave de administrador"> <button class="b1" id="en">Entrar</button><div id="msg"></div></div>
<div id="pan" style="display:none"><div class="s" id="res"></div>
<div class="ebox"><span>🚫 Eliminar un código (aunque no esté activado):</span><input id="ecod" placeholder="BOT-XXXX-XXXX"><button class="el" id="ebtn">Eliminar</button><span class="s" id="emsg"></span></div><input id="bus" placeholder="Buscar código" style="width:100%;margin:10px 0;box-sizing:border-box"><div id="lis"></div></div>
<script>
let C=sessionStorage.getItem("cl")||"";const f=d=>new Date(d).toLocaleString("es-VE",{day:"2-digit",month:"2-digit",hour:"numeric",minute:"2-digit"});
async function api(p,b){const r=await fetch(p,{method:b?"POST":"GET",headers:{"X-Clave":C,"Content-Type":"application/json"},body:b?JSON.stringify(b):undefined});if(r.status===401)throw new Error("Clave incorrecta");const j=await r.json();if(j.error)throw new Error(j.error);return j;}
let D=null;
async function cargar(){try{D=await api("/admin/api/lista");sessionStorage.setItem("cl",C);document.getElementById("login").style.display="none";document.getElementById("pan").style.display="";pintar();}catch(e){document.getElementById("msg").textContent=e.message;}}
function pintar(){const q=document.getElementById("bus").value.trim().toUpperCase();const a=D.usados.filter(x=>!q||x.codigo.includes(q));
const act=D.usados.filter(x=>x.estado==="activo").length;
document.getElementById("res").textContent=D.total+" códigos · "+D.usados.length+" usados ("+act+" activos) · "+(D.total-D.usados.length)+" sin usar · "+(D.demos||0)+" pruebas gratis"+((D.anulados||[]).length+D.usados.filter(x=>x.estado==="anulado").length?" · "+((D.anulados||[]).length+D.usados.filter(x=>x.estado==="anulado").length)+" eliminados":"");
const an=(D.anulados||[]).filter(x=>!q||x.codigo.includes(q));
document.getElementById("lis").innerHTML=a.map(x=>'<div class="it"><div><b>'+x.codigo+'</b><div class="s">'+(x.libre?"liberado, esperando otro dispositivo":(x.ua||"dispositivo"))+' · desde '+f(x.ini)+'</div></div>'+(x.estado==="anulado"?'<div class="an">🚫 Eliminado</div><button class="rs" data-h="'+x.hash+'">Restaurar</button>':'<div class="'+(x.estado==="vencido"?"ve":(x.libre?"li":"ok"))+'">'+(x.estado==="vencido"?"Vencido "+f(x.fin):"Activo · vence "+f(x.fin))+'</div>'+(x.libre||x.estado==="vencido"?"":'<button class="lb" data-h="'+x.hash+'">Liberar</button>')+'<button class="el" data-h="'+x.hash+'">Eliminar</button>')+'</div>').join("")
+an.map(x=>'<div class="it"><div><b>'+x.codigo+'</b><div class="s">sin activar · eliminado '+(x.t?f(x.t):"")+'</div></div><div class="an">🚫 Eliminado</div><button class="rs" data-h="'+x.hash+'">Restaurar</button></div>').join("")||'<div class="s">Ningún código usado todavía.</div>';
document.querySelectorAll(".it .el").forEach(b=>b.onclick=async()=>{if(!confirmar(b,"Eliminar"))return;await api("/admin/api/eliminar",{hash:b.dataset.h});cargar();});
document.querySelectorAll(".rs").forEach(b=>b.onclick=async()=>{if(!confirmar(b,"Restaurar"))return;await api("/admin/api/restaurar",{hash:b.dataset.h});cargar();});
document.querySelectorAll(".lb").forEach(b=>b.onclick=async()=>{if(!confirmar(b))return;await api("/admin/api/liberar",{hash:b.dataset.h});cargar();});}
function confirmar(b,t){t=t||"Liberar";if(b.dataset.c)return true;b.dataset.c=1;b.textContent="¿Seguro? Toca otra vez";setTimeout(()=>{b.dataset.c="";b.textContent=t},4000);return false;}
document.getElementById("ebtn").onclick=async()=>{const b=document.getElementById("ebtn"),m=document.getElementById("emsg"),c=document.getElementById("ecod").value.trim();if(!c){m.textContent="Escribe el código";return;}if(!confirmar(b,"Eliminar"))return;try{await api("/admin/api/eliminar",{codigo:c});m.textContent="✅ "+c.toUpperCase()+" eliminado";document.getElementById("ecod").value="";cargar();}catch(e){m.textContent=e.message;}};
document.getElementById("en").onclick=()=>{C=document.getElementById("cl").value;cargar();};
document.getElementById("bus").oninput=pintar; if(C)cargar();
</script></body></html>`;

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
    if (u.pathname === "/api/historial/estado") return enviar(res, 200, { ok: true, corriendo: HIST.corriendo, hechos: HIST.hechos, faltan: HIST.faltan, errores: HIST.errores, ultimo: HIST.ultimo });
    if (u.pathname === "/admin") return enviar(res, 200, ADMIN_HTML, "text/html; charset=utf-8");
    if (u.pathname.startsWith("/admin/api/")) {
      if (!CLAVE || req.headers["x-clave"] !== CLAVE) return enviar(res, 401, { error: "Clave incorrecta" });
      if (u.pathname === "/admin/api/lista") return enviar(res, 200, await listaCodigos());
      if (u.pathname === "/admin/api/liberar" && req.method === "POST") {
        const b = await leerCuerpo(req), key = "cod:" + String(b.hash || "");
        const v = await redis(["GET", key]); if (!v) return enviar(res, 404, { error: "No existe" });
        const rec = JSON.parse(v); rec.dev = null; await redis(["SET", key, JSON.stringify(rec)]);
        return enviar(res, 200, { ok: true });
      }
      if (u.pathname === "/admin/api/eliminar" && req.method === "POST") {
        const b = await leerCuerpo(req); let hash = String(b.hash || ""), codigo = "";
        if (!hash && b.codigo) { codigo = normCodeS(b.codigo); hash = cyrb53S(codigo); }
        if (!CODIGOS.has(hash)) return enviar(res, 404, { error: "Ese código no existe" });
        if (!codigo) { const v = await redis(["GET", "cod:" + hash]); if (v) codigo = JSON.parse(v).codigo || ""; }
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
}

module.exports = { bajarDia, historial, completarHistorial, HIST, parseEstadisticas, parseResultados, aTexto, hoyVE, horaVE, vigilar, empujar, suscribir, ultimos, enviarAvisos };

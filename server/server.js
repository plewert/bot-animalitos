// Servidor de resultados para el Bot de animalitos.
// No necesita librerías: solo Node 18 o más nuevo (Render lo trae).
// Lee las páginas de lotoven.com y entrega los datos al bot en formato JSON.

const http = require("http");

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
const CODIGOS = new Set(["14gat7m66cu", "rqrxoytdtf", "gm6i7ht7jp", "10o6ajpujw1", "125d1selcsh", "1nhjhao2hs1", "26pm5tofx3f", "y6p8qnr1af", "359pq4oy10", "jkm9c38d1w", "2cq7u9phnu2", "xsdrqx0swc", "1lah7i3pm7z", "2e5t20hp67o", "22dgpgvjygj", "14q10rmpqh6", "wr6xje4hbc", "2c7qwhaaz1s", "1wnb7igg6sv", "1mhsyzq5p4q", "1vs14asr7bh", "1ixjk7vo6bl", "18p6v9zzgka", "9jx8t7y9vr", "y6st0galuf", "162t9pohu2o", "26ls882ju64", "15008dtai3o", "3fefjgqa8i", "284hxm9stst", "ch89qxhdt0", "1bux781n9t4", "8adt2athro", "ytkzv3dp1e", "1220dtxx3fo", "20sdcq9qcfz", "1zpjzzptch6", "1idnagh9jkr", "2aakjoogwb5", "14yfu80lndw", "u7j3kpla0f", "15m2m3n7vkd", "23k1fxgiy62", "1olnoes7tly", "16y3fhvnien", "hcgarkck4y", "26ppazi62z9", "13b2k5vcwrb", "27avjvk8h80", "jrrr6ftgdu", "11aznlbutgh", "1v5hl0romd5", "1r0lm4kkgkx", "1kwq39t0sp7", "190hsb28xo", "195mmrvgeo2", "dzqll3vea6", "gnma17pb4", "bwmb4evvgy", "2cv59qh21ug", "2cvurfpk05e", "vl78qdr1fz", "2axtfla9piu", "slzmdo89na", "2a00fgx8s37", "1f403ot17lm", "141551813z3", "8e5n1ouqz1", "27zypw7ze4g", "yyme9pxcz0"]); // huellas de los códigos válidos (no los códigos en sí)
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
async function usarCodigo(b) {
  const hash = String(b.hash || ""), dev = String(b.dev || "").slice(0, 64);
  if (!CODIGOS.has(hash)) return { ok: false, motivo: "no_existe" };
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

async function listaCodigos() {
  const keys = (await redis(["KEYS", "cod:*"])) || [];
  const vals = keys.length ? await redis(["MGET", ...keys]) : [];
  const ahora = Date.now();
  const demos = ((await redis(["KEYS", "demo:*"])) || []).length;
  return {
    demos,
    total: CODIGOS.size,
    usados: keys.map((k, i) => { const r = JSON.parse(vals[i] || "{}"); const fin = finDe(r.ini || 0);
      return { hash: k.slice(4), codigo: r.codigo || "(sin nombre)", ua: r.ua || "", ini: r.ini, fin, uso: r.uso, libre: !r.dev, estado: ahora > fin ? "vencido" : "activo" }; })
      .sort((a, b) => (b.ini || 0) - (a.ini || 0)),
  };
}
const ADMIN_HTML = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin · Bot de animalitos</title>
<style>body{margin:0;background:#070b18;color:#e8f1ff;font:15px/1.45 system-ui,sans-serif;padding:16px}h1{font-size:19px;color:#2ef2ff;margin:0 0 12px}
input,button{font:inherit;border-radius:10px;border:1px solid #2b3550;background:#0b1124;color:#e8f1ff;padding:9px 12px}button{cursor:pointer}
.b1{background:linear-gradient(90deg,#2ef2ff,#ff3df2);color:#05060c;border:0;font-weight:700}
.it{display:flex;gap:10px;align-items:center;border:1px solid #24304f;border-radius:12px;padding:10px;margin:8px 0;background:#0b1124;flex-wrap:wrap}
.it b{font-family:monospace;font-size:15px}.s{color:#8a9bbd;font-size:13px}.ok{color:#2dff8a}.ve{color:#ff8ea0}.li{color:#ffd23f}
.lb{margin-left:auto;border-color:rgba(255,59,92,.6);color:#ff8ea0}#msg{color:#ff8ea0;margin:8px 0}</style></head><body>
<h1>◆ Códigos · Bot de animalitos</h1>
<div id="login"><input id="cl" type="password" placeholder="Clave de administrador"> <button class="b1" id="en">Entrar</button><div id="msg"></div></div>
<div id="pan" style="display:none"><div class="s" id="res"></div><input id="bus" placeholder="Buscar código" style="width:100%;margin:10px 0;box-sizing:border-box"><div id="lis"></div></div>
<script>
let C=sessionStorage.getItem("cl")||"";const f=d=>new Date(d).toLocaleString("es-VE",{day:"2-digit",month:"2-digit",hour:"numeric",minute:"2-digit"});
async function api(p,b){const r=await fetch(p,{method:b?"POST":"GET",headers:{"X-Clave":C,"Content-Type":"application/json"},body:b?JSON.stringify(b):undefined});if(r.status===401)throw new Error("Clave incorrecta");const j=await r.json();if(j.error)throw new Error(j.error);return j;}
let D=null;
async function cargar(){try{D=await api("/admin/api/lista");sessionStorage.setItem("cl",C);document.getElementById("login").style.display="none";document.getElementById("pan").style.display="";pintar();}catch(e){document.getElementById("msg").textContent=e.message;}}
function pintar(){const q=document.getElementById("bus").value.trim().toUpperCase();const a=D.usados.filter(x=>!q||x.codigo.includes(q));
const act=D.usados.filter(x=>x.estado==="activo").length;
document.getElementById("res").textContent=D.total+" códigos · "+D.usados.length+" usados ("+act+" activos) · "+(D.total-D.usados.length)+" sin usar · "+(D.demos||0)+" pruebas gratis";
document.getElementById("lis").innerHTML=a.map(x=>'<div class="it"><div><b>'+x.codigo+'</b><div class="s">'+(x.libre?"liberado, esperando otro dispositivo":(x.ua||"dispositivo"))+' · desde '+f(x.ini)+'</div></div><div class="'+(x.estado==="vencido"?"ve":(x.libre?"li":"ok"))+'">'+(x.estado==="vencido"?"Vencido "+f(x.fin):"Activo · vence "+f(x.fin))+'</div>'+(x.libre||x.estado==="vencido"?"":'<button class="lb" data-h="'+x.hash+'">Liberar</button>')+'</div>').join("")||'<div class="s">Ningún código usado todavía.</div>';
document.querySelectorAll(".lb").forEach(b=>b.onclick=async()=>{if(!confirmar(b))return;await api("/admin/api/liberar",{hash:b.dataset.h});cargar();});}
function confirmar(b){if(b.dataset.c)return true;b.dataset.c=1;b.textContent="¿Seguro? Toca otra vez";setTimeout(()=>{b.dataset.c="";b.textContent="Liberar"},4000);return false;}
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
if (require.main === module) server.listen(PORT, () => console.log("Servidor de resultados listo en el puerto " + PORT));

module.exports = { parseEstadisticas, parseResultados, aTexto, hoyVE, horaVE };

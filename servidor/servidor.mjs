// Servidor de Precios súper: la app le pide solo lo que va a mostrar (una búsqueda, una ficha, una comparación)
// y el teléfono no descarga los datos de todas las tiendas.
//
// Lee los mismos archivos data/<tienda>.json que la versión de GitHub y usa la misma lógica (core.js), así que
// los resultados son iguales. Sin dependencias: solo Node 22 o superior.
//
// Uso: node servidor/servidor.mjs            (puerto 8787; PUERTO=xxxx para otro)
//      ORIGENES="https://therenadeus.github.io,http://localhost:4180" para los sitios que pueden consultarlo.
import http from 'node:http';
import vm from 'node:vm';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATOS || join(RAIZ, 'data');
const PUERTO = +process.env.PUERTO || 8787;
const ORIGENES = (process.env.ORIGENES || 'https://therenadeus.github.io,http://localhost:4180').split(',').map(s => s.trim());

const NOMBRES = { jumbo: 'Jumbo', santaisabel: 'Santa Isabel', tottus: 'Tottus', unimarc: 'Unimarc', acuenta: 'aCuenta', alvi: 'Alvi',
  centralmayorista: 'Central Mayorista', lider: 'Líder', super10: 'Super10', sodimac: 'Sodimac', easy: 'Easy' };
const RUBROS = {
  super: { tiendas: ['jumbo', 'santaisabel', 'tottus', 'unimarc', 'acuenta', 'alvi', 'centralmayorista', 'lider', 'super10'],
    leidas: ['jumbo', 'santaisabel', 'tottus', 'unimarc', 'acuenta', 'alvi', 'centralmayorista'], aportes: true },
  ferreteria: { tiendas: ['sodimac', 'easy'], leidas: ['sodimac', 'easy'], aportes: false },
};
const REGIONES = new Set(['AP', 'TA', 'AN', 'AT', 'CO', 'VA', 'RM', 'LI', 'ML', 'NB', 'BI', 'AR', 'LR', 'LL', 'AI', 'MA']);

// ---------- Contextos: uno por rubro y zona, con core.js y los datos cargados ----------
let CORE = '', VERSION = '', contextos = new Map();
const leerJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
function versionDatos() {
  // Cambia cuando cambia cualquier archivo de datos o core.js: entonces se recargan los contextos.
  const archivos = [join(RAIZ, 'core.js'), ...readdirSync(DATA).filter(f => f.endsWith('.json')).map(f => join(DATA, f))];
  return archivos.map(f => existsSync(f) ? statSync(f).mtimeMs : 0).join('|');
}
function revisarDatos() {
  const v = versionDatos();
  if (v === VERSION) return;
  VERSION = v; CORE = readFileSync(join(RAIZ, 'core.js'), 'utf8'); contextos = new Map();
  console.log(new Date().toISOString(), 'datos (re)cargados');
}
function contexto(rubro, zona) {
  revisarDatos();
  const k = rubro + '|' + (zona || '');
  if (contextos.has(k)) return contextos.get(k);
  const R = RUBROS[rubro];
  const dbs = Object.fromEntries(R.leidas.map(s => [s, leerJson(join(DATA, s + '.json'))]));
  const aportes = R.aportes ? (leerJson(join(DATA, 'aportes.json'))?.aportes || []) : [];
  const ctx = vm.createContext({ console, __dbs: dbs, __aportes: aportes });
  vm.runInContext(`const TIENDAS = ${JSON.stringify(R.tiendas)}; const LEIDAS = ${JSON.stringify(R.leidas)};
    const NOMBRES = ${JSON.stringify(NOMBRES)}; const ALL = []; const BYKEY = new Map(); const ESTADO = {};
    let HOY = ''; const DATES = []; const ZONA = ${JSON.stringify(zona || null)};
    const REPO = 'https://github.com/TheRenadeus/precios-super'; const APORTE_DIAS = 14;
    ${CORE}
    cargarDatos(__dbs, __aportes); grupos();
    globalThis.api = { ALL, BYKEY, ESTADO, DATES, get HOY() { return HOY; }, TIENDAS, LEIDAS, GRUPO_DE, grupos, equivalentes, changeSince, porUno,
      esPaquete, gana, enCat, indice, elegir, ofertas, norm };`, ctx, { timeout: 60000 });
  const c = ctx.api;
  c.categorias = [...new Set(c.ALL.flatMap(p => p.t))].sort((a, b) => a.localeCompare(b, 'es'));
  c.indices = {};
  contextos.set(k, c);
  return c;
}

// ---------- Resumen de un producto para la app ----------
function resumen(c, p, { h = false } = {}) {
  const g = c.GRUPO_DE.get(p.key);
  const o = { key: p.key, store: p.store, id: p.id, n: p.n, m: p.m, u: p.u, i: p.i, t: p.t, v: p.v, out: p.out, price: p.price, normal: p.normal,
    card: p.card, fresh: p.fresh, k: p.k, steps: p.steps, size: p.size, unit: p.unit, ap: p.ap, c30: c.changeSince(p, 30) };
  if (g) o.grp = { n: g.miembros.length, min: g.min, gana: c.gana(p, g), primero: { store: g.miembros[0].store, uno: c.porUno(g.miembros[0]), paquete: !!c.esPaquete(g.miembros[0]) } };
  if (h) o.h = p.h;
  return o;
}

// ---------- Vistas ----------
function inicio(c) {
  const DAYS = 7;
  const movs = c.ALL.filter(p => p.fresh).map(p => ({ p, ch: c.changeSince(p, DAYS) })).filter(o => o.ch != null && Math.abs(o.ch) >= 0.5);
  const ups = movs.filter(o => o.ch > 0).sort((a, b) => b.ch - a.ch).slice(0, 8);
  const downs = movs.filter(o => o.ch < 0).sort((a, b) => a.ch - b.ch).slice(0, 8);
  const conteos = {};
  for (const s of c.TIENDAS) {
    const ap = c.ALL.filter(p => p.store === s && p.ap);
    conteos[s] = { n: c.ALL.filter(p => p.store === s && p.fresh && !p.ap).length, ap: ap.length, apUlt: ap.reduce((m, p) => p.v > m ? p.v : m, '') };
  }
  const indices = {};
  if (c.DATES.length >= 2) for (const d of [30, 90, 365, 0]) indices[d] = c.indices[d] || (c.indices[d] = c.indice(d));
  return { hoy: c.HOY, dias: c.DATES.length, estado: c.ESTADO, conteos, categorias: c.categorias, indices,
    ups: ups.map(o => ({ ...resumen(c, o.p), ch: o.ch })), downs: downs.map(o => ({ ...resumen(c, o.p), ch: o.ch })) };
}

function buscar(c, q) {
  const texto = c.norm(q.q || '');
  const words = texto ? texto.split(' ') : [];
  const sel = new Set((q.tiendas || c.TIENDAS.join(',')).split(',').filter(s => c.TIENDAS.includes(s)));
  const cat = q.cat || '', sort = q.orden || 'rel';
  const f = { oferta: q.oferta === '1', baja: q.baja === '1', varias: q.varias === '1', hoy: q.hoy === '1', marca: q.marca || '', uni: q.uni || '',
    min: q.min ? +q.min : null, max: q.max ? +q.max : null };
  const nf = [f.oferta, f.baja, f.varias, f.hoy, f.marca, f.uni, f.min != null, f.max != null].filter(Boolean).length;
  const pasa = p => (!f.oferta || p.normal) && (!f.baja || (c.changeSince(p, 30) ?? 0) < -0.5)
    && (!f.varias || (c.GRUPO_DE.get(p.key)?.miembros.length || 0) > 1) && (!f.hoy || p.fresh)
    && (!f.uni || (f.uni === 'u' ? !p.unit || p.unit.u === 'c/u' : p.unit && p.unit.u === f.uni))
    && (f.min == null || p.price >= f.min) && (f.max == null || p.price <= f.max);
  let r = c.ALL.filter(p => sel.has(p.store) && (!cat || p.t.includes(cat)) && words.every(w => p.search.includes(w)) && pasa(p));
  // Marcas de lo que cumple los demás filtros (la elegida se aplica después).
  const por = new Map();
  for (const p of r) {
    const k = c.norm(p.m); if (!k) continue;
    if (!por.has(k)) por.set(k, { n: 0, grafias: new Map() });
    const o = por.get(k); o.n++; o.grafias.set(p.m, (o.grafias.get(p.m) || 0) + 1);
  }
  const marcas = [...por].map(([k, o]) => [k, [...o.grafias].sort((a, b) => b[1] - a[1])[0][0], o.n])
    .sort((a, b) => a[1].localeCompare(b[1], 'es', { sensitivity: 'base' }));
  if (f.marca) r = r.filter(p => c.norm(p.m) === f.marca);
  // El mismo producto en varias tiendas va en una sola fila: la más barata (por unidad) entre las tiendas marcadas.
  const filaDe = new Map(), unicos = [];
  for (const p of r) {
    const g = c.GRUPO_DE.get(p.key);
    if (!g) { unicos.push(p); continue; }
    const i = filaDe.get(g);
    if (i === undefined) { filaDe.set(g, unicos.length); unicos.push(p); }
    else if (c.porUno(p) < c.porUno(unicos[i])) unicos[i] = p;
  }
  r = unicos;
  const score = p => (p.fresh ? 0 : 1000) + (texto && p.t.some(t => c.norm(t) === texto || texto.startsWith(c.norm(t))) ? 0 : 2) + (texto && p.search.startsWith(texto) ? 0 : 1);
  const ch = new Map(); const c30 = p => { if (!ch.has(p.key)) ch.set(p.key, c.changeSince(p, 30)); return ch.get(p.key); };
  const orden = {
    rel: (a, b) => score(a) - score(b) || a.price - b.price,
    price: (a, b) => a.price - b.price,
    unit: (a, b) => (a.unit ? a.unit.v : Infinity) - (b.unit ? b.unit.v : Infinity),
    disc: (a, b) => (b.normal ? 1 - b.price / b.normal : 0) - (a.normal ? 1 - a.price / a.normal : 0),
    up30: (a, b) => (c30(b) ?? -1e9) - (c30(a) ?? -1e9),
    down30: (a, b) => (c30(a) ?? 1e9) - (c30(b) ?? 1e9),
  };
  const portada = !texto && !cat && sort === 'rel' && !nf;
  r.sort(portada ? (a, b) => (b.fresh - a.fresh) || orden.disc(a, b) : (orden[sort] || orden.rel));
  const desde = Math.max(0, +q.desde || 0), n = Math.min(200, Math.max(1, +q.n || 60));
  return { total: r.length, portada, marcas, filas: r.slice(desde, desde + n).map(p => resumen(c, p)) };
}

function producto(c, k) {
  const p = c.BYKEY.get(k);
  if (!p) return null;
  return { p: resumen(c, p, { h: true }), eq: c.equivalentes(p).map(e => ({ q: resumen(c, e.q), exact: e.exact })) };
}

function comparar(c, q) {
  const cat = q.cat || '';
  const G = c.grupos().filter(g => c.enCat(g, cat));
  const MIN_T = c.TIENDAS.length > 3 ? 3 : 2;
  const G3 = G.filter(g => g.miembros.length >= MIN_T);
  const mediana = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
  const st = c.TIENDAS.map(s => {
    let wins = 0; const difs = [];
    for (const g of G3) { const m = g.miembros.find(x => x.store === s); if (!m) continue; if (c.gana(m, g)) wins++; difs.push(c.porUno(m) / g.min - 1); }
    return { s, n: difs.length, wins, prom: difs.length ? mediana(difs) * 100 : null };
  });
  const MIN_N = Math.min(15, Math.max(4, Math.round(G3.length * 0.2)));
  const rk = st.filter(x => x.n >= MIN_N).sort((a, b) => a.prom - b.prom);
  const fuera = st.filter(x => x.n < MIN_N).map(x => x.s);
  const atrasadas = c.TIENDAS.filter(s => c.ESTADO[s] && c.ESTADO[s].fecha && c.ESTADO[s].fecha < c.HOY);
  // Cara a cara
  const A = q.a, B = q.b;
  let vs = null, pares = [];
  if (A && B && A !== B) {
    pares = G.map(g => ({ g, a: g.miembros.find(m => m.store === A), b: g.miembros.find(m => m.store === B) }))
      .filter(x => x.a && x.b).map(x => ({ ...x, r: c.porUno(x.a) / c.porUno(x.b) }));
    if (pares.length) {
      const aGana = pares.filter(x => x.r < 0.995).length, bGana = pares.filter(x => x.r > 1.005).length;
      vs = { n: pares.length, aGana, bGana, iguales: pares.length - aGana - bGana, geo: Math.exp(pares.reduce((s, x) => s + Math.log(x.r), 0) / pares.length) };
      pares.sort((x, y) => Math.abs(Math.log(y.r)) - Math.abs(Math.log(x.r)));
    }
  }
  const nv = Math.min(500, +q.nv || 20), ng = Math.min(500, +q.ng || 30);
  const lista = G.slice().sort((x, y) => y.miembros.length - x.miembros.length || (c.porUno(y.miembros.at(-1)) / y.min) - (c.porUno(x.miembros.at(-1)) / x.min));
  const grupo = g => ({ p: resumen(c, g.p), miembros: g.miembros.map(m => resumen(c, m)), min: g.min });
  return { g3: G3.length, minT: MIN_T, rk, fuera, atrasadas, vs,
    pares: pares.slice(0, nv).map(x => ({ g: grupo(x.g), a: resumen(c, x.a), b: resumen(c, x.b), r: x.r })), paresTotal: pares.length,
    grupos: lista.slice(0, ng).map(grupo), gruposTotal: lista.length };
}

// ---------- HTTP ----------
function responder(req, res, codigo, cuerpo) {
  const origen = req.headers.origin;
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (origen && ORIGENES.includes(origen)) { h['Access-Control-Allow-Origin'] = origen; h['Vary'] = 'Origin'; }
  res.writeHead(codigo, h);
  res.end(JSON.stringify(cuerpo));
}

const servidor = http.createServer((req, res) => {
  const t0 = Date.now();
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { responder(req, res, 204, null); return; }
    if (req.method !== 'GET') { responder(req, res, 405, { error: 'solo GET' }); return; }
    const q = Object.fromEntries(url.searchParams);
    if (url.pathname === '/api/salud') { revisarDatos(); responder(req, res, 200, { ok: true }); return; }
    const m = url.pathname.match(/^\/api\/(super|ferreteria)\/(inicio|buscar|producto|productos|elegir|ofertas|comparar)$/);
    if (!m) { responder(req, res, 404, { error: 'no existe' }); return; }
    const [, rubro, vista] = m;
    const zona = rubro === 'super' && REGIONES.has(q.zona) ? q.zona : null;
    const c = contexto(rubro, zona);
    const claves = (q.k || '').split(',').filter(Boolean).slice(0, 200);
    let out;
    if (vista === 'inicio') out = inicio(c);
    else if (vista === 'buscar') out = buscar(c, q);
    else if (vista === 'producto') out = producto(c, q.k);
    else if (vista === 'productos') out = claves.map(k => c.BYKEY.get(k)).filter(Boolean).map(p => resumen(c, p, { h: true }));
    else if (vista === 'elegir') out = c.elegir(q.q || '', Math.min(20, +q.n || 6)).map(p => resumen(c, p));
    else if (vista === 'ofertas') out = Object.fromEntries(claves.map(k => c.BYKEY.get(k)).filter(Boolean).map(p => [p.key, [...c.ofertas(p).values()].map(x => resumen(c, x))]));
    else if (vista === 'comparar') out = comparar(c, q);
    if (out == null) { responder(req, res, 404, { error: 'producto no encontrado' }); return; }
    responder(req, res, 200, out);
  } catch (e) {
    console.error(e);
    responder(req, res, 500, { error: 'error interno' });
  } finally {
    if (process.env.REGISTRO) console.log(req.method, req.url, Date.now() - t0, 'ms');
  }
});
servidor.listen(PUERTO, () => console.log(`Precios súper: servidor en el puerto ${PUERTO}`));

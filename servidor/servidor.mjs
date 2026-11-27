// Servidor de Precios súper: la app le pide solo lo que va a mostrar (una búsqueda, una ficha, una comparación)
// y el teléfono no descarga los datos de todas las tiendas.
//
// Lee los mismos archivos data/<tienda>.json que la versión de GitHub y usa la misma lógica (core.js), así que
// los resultados son iguales. Sin dependencias: Node 18 o superior.
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

// ---------- Contextos: uno por rubro y zona, con core.js, vistas.js y los datos cargados ----------
let CODIGO = '', VERSION = '', contextos = new Map();
const leerJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const CODIGOS = ['core.js', 'vistas.js', 'categorias.json'].map(f => join(RAIZ, f));
function versionDatos() {
  // Cambia cuando cambia cualquier archivo de datos, el código compartido o las categorías: entonces se recargan los contextos.
  const archivos = [...CODIGOS, ...readdirSync(DATA).filter(f => f.endsWith('.json')).map(f => join(DATA, f))];
  return archivos.map(f => existsSync(f) ? statSync(f).mtimeMs : 0).join('|');
}
function revisarDatos() {
  const v = versionDatos();
  if (v === VERSION) return;
  VERSION = v; contextos = new Map();
  CODIGO = ['core.js', 'vistas.js'].map(f => readFileSync(join(RAIZ, f), 'utf8')).join(';\n');
  console.log(new Date().toISOString(), 'datos (re)cargados');
}
function contexto(rubro, zona) {
  revisarDatos();
  const k = rubro + '|' + (zona || '');
  if (contextos.has(k)) return contextos.get(k);
  const R = RUBROS[rubro];
  const dbs = Object.fromEntries(R.leidas.map(s => [s, leerJson(join(DATA, s + '.json'))]));
  const aportes = R.aportes ? (leerJson(join(DATA, 'aportes.json'))?.aportes || []) : [];
  const cats = leerJson(join(RAIZ, 'categorias.json'))?.[rubro] || {};
  const ctx = vm.createContext({ console, __dbs: dbs, __aportes: aportes });
  vm.runInContext(`const TIENDAS = ${JSON.stringify(R.tiendas)}; const LEIDAS = ${JSON.stringify(R.leidas)};
    const NOMBRES = ${JSON.stringify(NOMBRES)}; const ALL = []; const BYKEY = new Map(); const ESTADO = {};
    let HOY = ''; const DATES = []; const ZONA = ${JSON.stringify(zona || null)}; const CATS = ${JSON.stringify(cats)};
    const REPO = 'https://github.com/TheRenadeus/precios-super'; const APORTE_DIAS = 14;
    ${CODIGO}
    cargarDatos(__dbs, __aportes); grupos();
    globalThis.__vistas = VISTAS;`, ctx, { timeout: 60000 });
  const c = ctx.__vistas;
  contextos.set(k, c);
  return c;
}

// ---------- HTTP ----------
function responder(req, res, codigo, cuerpo) {
  const origen = req.headers.origin;
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (origen && ORIGENES.includes(origen)) {
    h['Access-Control-Allow-Origin'] = origen; h['Vary'] = 'Origin';
    // Chrome pregunta antes de que una página de internet consulte un servidor de la red local (este, sin Tailscale).
    if (req.headers['access-control-request-private-network']) h['Access-Control-Allow-Private-Network'] = 'true';
  }
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
    const m = url.pathname.match(/^\/api\/(super|ferreteria)\/(inicio|indice|buscar|producto|productos|elegir|ofertas|comparar)$/);
    if (!m) { responder(req, res, 404, { error: 'no existe' }); return; }
    const [, rubro, vista] = m;
    const zona = rubro === 'super' && REGIONES.has(q.zona) ? q.zona : null;
    const c = contexto(rubro, zona);
    // Cada vista viene de vistas.js (la misma que usa la app sin servidor). El resultado sale de otro contexto: se copia como JSON.
    const out = c[vista](q);
    if (out == null && vista === 'producto') { responder(req, res, 404, { error: 'producto no encontrado' }); return; }
    responder(req, res, 200, out);
  } catch (e) {
    console.error(e);
    responder(req, res, 500, { error: 'error interno' });
  } finally {
    if (process.env.REGISTRO) console.log(req.method, req.url, Date.now() - t0, 'ms');
  }
});
servidor.listen(PUERTO, () => console.log(`Precios súper: servidor en el puerto ${PUERTO}`));

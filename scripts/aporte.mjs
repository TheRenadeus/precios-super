// Guarda en data/aportes.json el precio que alguien aportó con el formulario de GitHub
// (.github/ISSUE_TEMPLATE/aportar-precio.yml). Lo corre .github/workflows/aportes.yml.
//
// - Aviso nuevo o editado: revisa los datos y agrega (o corrige) el aporte de ese aviso.
// - Etiqueta "rechazado" en el aviso: quita el aporte de la app.
// Deja la respuesta para el aviso en el archivo $RESPUESTA y dice en $GITHUB_OUTPUT si cerrarlo.
//
// Prueba local: GITHUB_EVENT_PATH=evento.json RESPUESTA=r.md node scripts/aporte.mjs
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ARCHIVO = 'data/aportes.json';
const TIENDAS = { 'Líder': 'lider', 'Tottus': 'tottus', 'Super10': 'super10' };
// Mismos nombres que el formulario; el código es el que usa la app (index.html, REGIONES).
const REGIONES = { 'Arica y Parinacota': 'AP', 'Tarapacá': 'TA', 'Antofagasta': 'AN', 'Atacama': 'AT', 'Coquimbo': 'CO', 'Valparaíso': 'VA',
  'Metropolitana': 'RM', "O'Higgins": 'LI', 'Maule': 'ML', 'Ñuble': 'NB', 'Biobío': 'BI', 'La Araucanía': 'AR', 'Los Ríos': 'LR',
  'Los Lagos': 'LL', 'Aysén': 'AI', 'Magallanes': 'MA' };
const MAX_POR_DIA = 40; // aportes por persona y día
const APP = 'https://therenadeus.github.io/precios-super/';

const ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const issue = ev.issue;
const etiquetas = (issue.labels || []).map(l => l.name);
const db = existsSync(ARCHIVO) ? JSON.parse(readFileSync(ARCHIVO, 'utf8')) : { aportes: [] };

let respuesta = '', cerrar = '', cambio = false;

const diaChile = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(iso));
const fmt = n => '$' + n.toLocaleString('es-CL');
const c_region = r => Object.keys(REGIONES).find(k => REGIONES[k] === r) || r;
const fDia = d => d.split('-').reverse().join('-');
function quitar() {
  const antes = db.aportes.length;
  db.aportes = db.aportes.filter(a => a.id !== issue.number);
  return db.aportes.length !== antes;
}

// El formulario llega como "### Etiqueta\n\nvalor" por cada campo.
function campos(body) {
  const out = {};
  const partes = (body || '').split(/^### +(.+)$/m);
  for (let i = 1; i < partes.length; i += 2) {
    const v = partes[i + 1].trim();
    out[partes[i].trim()] = v === '_No response_' ? '' : v;
  }
  return out;
}
const limpio = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const pesos = s => { const t = String(s || '').replace(/[$.\s]/g, '').replace(/,\d{1,2}$/, ''); return /^\d+$/.test(t) ? Number(t) : NaN; };
function fecha(s, hoy) {
  if (!s) return hoy;
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? s : null;
}

function revisar() {
  const c = campos(issue.body);
  const hoy = diaChile(issue.created_at || new Date().toISOString());
  const errores = [];
  const tienda = TIENDAS[c['Supermercado']];
  if (!tienda) errores.push('Elige el supermercado: Líder, Tottus o Super10.');
  const n = limpio(c['Producto'], 120), m = limpio(c['Marca'], 40), l = limpio(c['Local o comuna'], 80);
  if (n.length < 3) errores.push('Escribe el nombre del producto, con su tamaño.');
  else if (!/\d/.test(n)) errores.push('Al nombre del producto le falta el tamaño (por ejemplo 1 L, 500 g o 12 rollos).');
  const r = REGIONES[c['Región']];
  if (!r) errores.push('Elige la región del supermercado.');
  if (!m) errores.push('Escribe la marca (o "sin marca").');
  if (!l) errores.push('Escribe el local o la comuna.');
  if ([n, m, l].some(t => /https?:|www\.|\.(com|cl|net)\b/i.test(t))) errores.push('No se aceptan enlaces en el aporte.');
  const p = pesos(c['Precio que pagas, en pesos']);
  if (!(p >= 50 && p <= 5000000)) errores.push('El precio debe ser un número en pesos, por ejemplo 1290.');
  let o = null;
  if (c['Precio normal, si está en oferta'] && p >= 50) {
    o = pesos(c['Precio normal, si está en oferta']);
    if (!(o > p && o <= 5000000)) errores.push('El precio normal debe ser un número mayor que el precio de oferta, o quedar vacío.');
  }
  const f = fecha(c['Fecha, si no es hoy'], hoy);
  const hace60 = new Date(Date.parse(hoy) - 60 * 864e5).toISOString().slice(0, 10);
  if (!f || isNaN(Date.parse(f))) errores.push('La fecha debe ir como día-mes-año, por ejemplo 24-11-2026, o quedar vacía.');
  else if (f > hoy || f < hace60) errores.push('La fecha debe ser de los últimos 60 días.');
  // Firma de quien aporta, sin guardar su usuario: solo para limitar los aportes por día.
  const s = createHash('sha256').update('precios-super:' + (issue.user?.id ?? issue.user?.login ?? '')).digest('hex').slice(0, 10);
  const hoyDeEsa = db.aportes.filter(a => a.s === s && a.c === hoy && a.id !== issue.number).length;
  if (hoyDeEsa >= MAX_POR_DIA) errores.push(`Por hoy ya van ${MAX_POR_DIA} aportes tuyos; mañana puedes seguir.`);
  return { errores, aporte: { id: issue.number, t: tienda, n, m, p, o, l, r, f, c: hoy, s } };
}

if (etiquetas.includes('rechazado')) {
  // Moderación: quien administra el repositorio le pone la etiqueta "rechazado".
  cambio = quitar();
  if (cambio) respuesta = 'Este precio se quitó de la app.';
  cerrar = 'not planned';
} else if (ev.action === 'labeled' || (ev.action === 'edited' && !ev.changes?.body)) {
  // Al crear el aviso también llega "labeled" (la etiqueta del formulario): eso ya lo atiende "opened".
} else if (etiquetas.includes('aporte-precio')) {
  const { errores, aporte } = revisar();
  if (errores.length) {
    cambio = quitar();
    respuesta = 'No se pudo guardar este precio:\n\n' + errores.map(e => '- ' + e).join('\n') +
      '\n\nEdita el aviso (menú «…» → Edit) y se revisa de nuevo solo.';
  } else {
    const i = db.aportes.findIndex(a => a.id === aporte.id);
    if (i >= 0) db.aportes[i] = aporte; else db.aportes.push(aporte);
    db.aportes.sort((a, b) => a.id - b.id);
    cambio = true;
    const nombre = Object.keys(TIENDAS).find(k => TIENDAS[k] === aporte.t);
    respuesta = `Listo, gracias: **${aporte.n}** (${aporte.m}) a **${fmt(aporte.p)}**` +
      (aporte.o ? ` (normal ${fmt(aporte.o)})` : '') + ` en **${nombre}**, ${aporte.l} (${c_region(aporte.r)}), el ${fDia(aporte.f)}.\n\n` +
      `En unos minutos aparece en ${APP}. Si algo quedó mal, edita el aviso y se corrige solo.`;
    cerrar = 'completed';
  }
}

if (cambio) {
  db.actualizado = new Date().toISOString();
  // Un aporte por línea: así el historial de git muestra claro qué cambió.
  const lineas = db.aportes.map(a => '  ' + JSON.stringify(a));
  writeFileSync(ARCHIVO, `{"actualizado":${JSON.stringify(db.actualizado)},"aportes":[\n${lineas.join(',\n')}\n]}\n`);
}
if (process.env.RESPUESTA) writeFileSync(process.env.RESPUESTA, respuesta);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `cambio=${cambio}\ncerrar=${cerrar}\n`);
console.log(cambio ? 'Aportes actualizados.' : 'Sin cambios.', respuesta ? '\n' + respuesta : '');

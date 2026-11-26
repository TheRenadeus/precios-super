// Busca los productos de canasta.json en cada supermercado y guarda sus precios del día.
// Lo ejecuta una tarea de GitHub cada mañana (.github/workflows/precios.yml).
//
// Archivos que escribe, uno por supermercado: data/<tienda>.json
//   { tienda, nombre, actualizado, productos: { <id>: { n, m, u, i, t: [términos], v: última fecha vista,
//     h: [[fecha, precio, precioNormal|null, precioTarjeta|null], ...] } } }
// El historial 'h' solo agrega una fila cuando el precio cambia; 'v' dice hasta qué día siguió igual.
// Así el archivo crece poco aunque se ejecute todos los días.
// Cada archivo guarda también 'estado': cómo salió la última lectura de esa tienda. Así, cada tienda
// toca solo su propio archivo y se puede leer desde lugares distintos (GitHub o tu computador) sin choques.
//
// Uso: node scripts/update-prices.mjs [tienda ...]   (sin argumentos, todas)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const DIR = 'data';
// El script se identifica como lo que es (no como un navegador). Algunas tiendas, como Alvi, rechazan a los
// programas que se hacen pasar por navegador, pero dejan leer a un agente que se identifica.
const UA = 'precios-super-bot/1.0 (lectura diaria de precios publicos, 1 consulta cada 1.5 s)';
const PAUSA_MS = 1500; // espera entre páginas de una misma tienda, para no cargar sus servidores
const OLVIDAR_DIAS = 120; // productos que no aparecen hace más de esto se borran

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
const dormir = ms => new Promise(r => setTimeout(r, ms));

async function getHtml(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'es-CL,es;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`${new URL(url).host} respondió ${r.status}`);
  return r.text();
}
const motivo = e => (e.cause && (e.cause.code || e.cause.message)) ? `${e.message} (${e.cause.code || e.cause.message})` : e.message;

// Jumbo y Santa Isabel (Cencosud) publican los resultados como lista schema.org (JSON-LD).
function leerJsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let d;
    try { d = JSON.parse(m[1]); } catch { continue; }
    if (d['@type'] !== 'ItemList' || !Array.isArray(d.itemListElement)) continue;
    for (const el of d.itemListElement) {
      const it = el.item || {};
      const of = it.offers || {};
      const precio = Number(of.price);
      if (!it.name || !it.url || !precio) continue;
      const specs = Array.isArray(of.priceSpecification) ? of.priceSpecification : [];
      const tachado = specs.find(s => String(s.priceType || '').includes('StrikethroughPrice'));
      const normal = tachado ? Number(tachado.price) : null;
      const path = new URL(it.url).pathname.replace(/\/p\/?$/, '').replace(/^\//, '');
      out.push({
        id: path,
        n: it.name.trim(),
        m: (it.brand && it.brand.name || '').trim(),
        u: it.url,
        i: it.image || '',
        precio,
        normal: normal && normal > precio ? normal : null,
        tarjeta: null,
        disponible: !of.availability || String(of.availability).includes('InStock'),
      });
    }
  }
  return out;
}

const numCLP = s => Number(String(Array.isArray(s) ? s[0] : s).replace(/[^\d]/g, '')) || null;

// Tottus (Falabella) es una app Next.js: los resultados vienen en __NEXT_DATA__.
function leerTottus(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Tottus: la página no trae __NEXT_DATA__ (¿cambió el sitio?)');
  const pp = JSON.parse(m[1]).props?.pageProps || {};
  const out = [];
  for (const x of pp.results || []) {
    if (x.isSponsored) continue; // los patrocinados no siempre tienen que ver con la búsqueda
    const ps = x.prices || [];
    const de = t => { const p = ps.find(p => p.type === t); return p ? numCLP(p.price) : null; };
    const precio = de('internetPrice') || de('eventPrice') || numCLP(ps.find(p => !p.crossed)?.price);
    if (!precio || !x.productId) continue;
    const normal = de('normalPrice');
    const tarjeta = de('cmrPrice');
    out.push({
      id: String(x.productId),
      n: String(x.displayName || '').trim(),
      m: String(x.brand || '').trim(),
      u: x.url,
      i: (x.mediaUrls && x.mediaUrls[0]) || '',
      precio,
      normal: normal && normal > precio ? normal : null,
      tarjeta: tarjeta && tarjeta < precio ? tarjeta : null,
      disponible: true,
    });
  }
  return out;
}

// Alvi (SMU) es una app Next.js: los resultados vienen en __NEXT_DATA__ (intelliSearchData).
// Vende por unidad con precios por cantidad (priceSteps): se guardan en 'e' como [[desde, precio], ...].
function leerAlvi(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Alvi: la página no trae __NEXT_DATA__ (¿cambió el sitio?)');
  const d = JSON.parse(m[1]).props?.pageProps?.intelliSearchData || {};
  const out = [];
  for (const [lista, disponible] of [[d.availableProducts, true], [d.notAvailableProducts, false]]) {
    for (const x of lista || []) {
      const s = (x.sellers || [])[0] || {};
      const precio = Number(s.price);
      if (!precio || !x.productId || !x.detailUrl) continue;
      const normal = Number(s.listPrice) || null;
      const escalas = (x.priceSteps || [])
        .map(e => [Number(e.minQuantity), Number(e.promotionalPrice)])
        .filter(([q, p]) => q > 1 && p > 0 && p < precio)
        .sort((a, b) => a[0] - b[0]);
      // Fotos de VTEX: '/ids/<n>/' → '/ids/<n>-300-300/' entrega 300 px (~25 KB) en vez del original.
      const foto = String((x.images || [])[0] || '').replace(/\/ids\/(\d+)\//, '/ids/$1-300-300/');
      out.push({
        id: String(x.productId),
        // 'name' es el nombre limpio ('nameComplete' a veces repite texto); si no trae el tamaño, se suma 'format'.
        n: (/\d/.test(x.name || '') || !x.format ? String(x.name || '') : `${x.name} ${x.format}`).trim(),
        m: String(x.brand || '').trim(),
        u: 'https://www.alvi.cl' + x.detailUrl,
        i: foto,
        precio,
        normal: normal && normal > precio ? normal : null,
        tarjeta: null,
        disponible,
        e: escalas.length ? escalas : undefined,
      });
    }
  }
  return out;
}

// aCuenta y Central Mayorista (Walmart) usan la plataforma Instaleap: la página de búsqueda no trae los
// productos en el HTML, los pide a esta API con la misma consulta que hace el navegador de cualquier visitante
// (sin cuenta). Los precios son los de un local de referencia: el que cada sitio muestra por defecto.
const INSTALEAP_API = 'https://nextgentheadless.instaleap.io/api/v3';
const INSTALEAP_QUERY = `query Buscar($i: SearchProductsInput!) {
  searchProducts(searchProductsInput: $i) {
    products { name price previousPrice sku slug brand photosUrl isAvailable unit subUnit subQty }
  }
}`;
// Las fotos vienen a 2000 px (~260 KB). El servicio de imágenes entrega una versión de 300 px en WebP (~5-10 KB).
const fotoInstaleap = u => !u ? '' : /&sink$/.test(u) ? u.replace(/&sink$/, '&scale=size[300x300]&sink=format[webp],quality[75]') : u;

function instaleap({ nombre, clientId, local, sitio }) {
  return async function buscar(q, p) {
    const r = await fetch(INSTALEAP_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Origin': sitio, 'Referer': sitio + '/' },
      body: JSON.stringify({
        operationName: 'Buscar',
        query: INSTALEAP_QUERY,
        variables: { i: { clientId, storeReference: local, search: [{ query: q }], pageSize: 40, currentPage: p } },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`${nombre} respondió ${r.status}`);
    const j = await r.json();
    if (j.errors?.length) throw new Error(`${nombre}: ${j.errors[0].message}`);
    const out = [];
    for (const x of j.data?.searchProducts?.products || []) {
      const precio = Number(x.price);
      if (!precio || !x.sku || !x.slug) continue;
      const normal = Number(x.previousPrice) || null;
      // Mayoristas: 'Caja', 'Manga', 'Pack'... con subUnit 'UN' y subQty = unidades del paquete.
      // El nombre no siempre lo dice (p. ej. 'BEBIDA 350ML COCA COLA' es un pack de 6), así que se guarda aparte.
      const k = x.unit && x.unit !== 'Unidad' && x.subUnit === 'UN' && Number(x.subQty) > 1 ? Math.round(Number(x.subQty)) : 1;
      let n = String(x.name || '').replace(/\.+$/, '').replace(/\s+/g, ' ').trim();
      if (k > 1 && !new RegExp(`x\\s*${k}\\b|\\b${k}\\s*(un|u|unidades)\\b`, 'i').test(n)) n += ` ${x.unit.toUpperCase()}x${k}`;
      out.push({
        id: String(x.sku),
        n,
        m: String(x.brand || '').trim(),
        u: `${sitio}/p/${x.slug}`,
        i: fotoInstaleap(x.photosUrl && x.photosUrl[0]),
        precio,
        normal: normal && normal > precio ? normal : null,
        tarjeta: null,
        disponible: x.isAvailable !== false,
        k,
      });
    }
    return out;
  };
}

const TIENDAS = {
  jumbo: {
    nombre: 'Jumbo',
    url: (q, p) => `https://www.jumbo.cl/busqueda?ft=${encodeURIComponent(q)}${p > 1 ? `&page=${p}` : ''}`,
    leer: leerJsonLd,
  },
  santaisabel: {
    nombre: 'Santa Isabel',
    url: (q, p) => `https://www.santaisabel.cl/busqueda?ft=${encodeURIComponent(q)}${p > 1 ? `&page=${p}` : ''}`,
    leer: leerJsonLd,
  },
  tottus: {
    nombre: 'Tottus',
    url: (q, p) => `https://www.tottus.cl/tottus-cl/buscar?Ntt=${encodeURIComponent(q)}${p > 1 ? `&page=${p}` : ''}`,
    leer: leerTottus,
  },
  // buscar(q, p) en vez de url + leer: consulta la API y devuelve los productos.
  acuenta: {
    nombre: 'aCuenta',
    buscar: instaleap({ nombre: 'aCuenta', clientId: 'SUPER_BODEGA', local: '580', sitio: 'https://www.acuenta.cl' }), // local El Monte
  },
  alvi: {
    nombre: 'Alvi',
    url: (q, p) => `https://www.alvi.cl/search?q=${encodeURIComponent(q)}${p > 1 ? `&page=${p}` : ''}`,
    leer: leerAlvi,
  },
  centralmayorista: {
    nombre: 'Central Mayorista',
    buscar: instaleap({ nombre: 'Central Mayorista', clientId: 'CENTRAL_MAYORISTA', local: '159', sitio: 'https://www.centralmayorista.cl' }), // local Macul
  },
};

function cargar(file, def) {
  if (!existsSync(file)) return def;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return def; }
}

function diasEntre(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }

async function actualizarTienda(clave, canasta) {
  const t = TIENDAS[clave];
  const file = `${DIR}/${clave}.json`;
  const db = cargar(file, { tienda: clave, nombre: t.nombre, productos: {} });
  const vistos = new Map();
  let paginasOk = 0, paginasError = 0, ultimoError = '';

  for (const termino of canasta.terminos) {
    for (let p = 1; p <= (canasta.paginas || 1); p++) {
      try {
        const items = t.buscar ? await t.buscar(termino, p) : t.leer(await getHtml(t.url(termino, p)));
        paginasOk++;
        for (const it of items) {
          const prev = vistos.get(it.id);
          if (prev) { if (!prev.t.includes(termino)) prev.t.push(termino); continue; }
          vistos.set(it.id, { ...it, t: [termino] });
        }
        if (items.length === 0) break;
      } catch (e) {
        paginasError++;
        ultimoError = motivo(e);
        console.warn(`  ${t.nombre} "${termino}" pág. ${p}: ${ultimoError}`);
        break;
      }
      await dormir(PAUSA_MS);
    }
  }

  if (vistos.size === 0) {
    return guardar(file, db, t, { ok: false, productos: 0, error: ultimoError || 'sin resultados' });
  }

  for (const [id, it] of vistos) {
    const fila = [hoy, it.precio, it.normal, it.tarjeta];
    const p = db.productos[id] || (db.productos[id] = { h: [] });
    p.n = it.n; p.m = it.m; p.u = it.u; p.i = it.i; p.v = hoy;
    p.t = it.t;
    if (!it.disponible) p.x = 1; else delete p.x;
    if (it.k > 1) p.k = it.k; else delete p.k; // unidades por paquete (mayoristas)
    if (it.e) p.e = it.e; else delete p.e; // precios por cantidad de hoy: [[desde, precio], ...] (mayoristas)
    // Si hoy ya hubo una ejecución, se reemplaza la fila de hoy.
    if (p.h.length && p.h[p.h.length - 1][0] === hoy) p.h.pop();
    const ult = p.h[p.h.length - 1];
    if (!ult || ult[1] !== fila[1] || ult[2] !== fila[2] || ult[3] !== fila[3]) p.h.push(fila);
  }
  for (const [id, p] of Object.entries(db.productos)) {
    if (diasEntre(p.v, hoy) > OLVIDAR_DIAS) delete db.productos[id];
  }

  db.actualizado = new Date().toISOString();
  db.fecha = hoy;
  return guardar(file, db, t, { ok: true, productos: vistos.size, error: paginasError ? ultimoError : '' });
}

function guardar(file, db, t, r) {
  const antes = db.estado || {};
  db.nombre = t.nombre;
  db.estado = {
    ok: r.ok,
    productos: r.productos,
    error: r.error || '',
    intento: new Date().toISOString(),
    ultimoOk: r.ok ? hoy : (antes.ultimoOk || db.fecha || null),
  };
  writeFileSync(file, JSON.stringify(db) + '\n');
  return r;
}

const canasta = JSON.parse(readFileSync('canasta.json', 'utf8'));
const pedidas = process.argv.slice(2);
const claves = pedidas.length ? pedidas : Object.keys(TIENDAS);
mkdirSync(DIR, { recursive: true });

// Las tiendas se consultan en paralelo; dentro de cada una, las páginas van de a una.
const resultados = await Promise.all(claves.map(async clave => {
  if (!TIENDAS[clave]) { console.error(`Tienda desconocida: ${clave}. Opciones: ${Object.keys(TIENDAS).join(', ')}`); return false; }
  console.log(`${TIENDAS[clave].nombre}: buscando ${canasta.terminos.length} términos…`);
  let r;
  try { r = await actualizarTienda(clave, canasta); } catch (e) { r = { ok: false, productos: 0, error: e.message }; }
  console.log(`${TIENDAS[clave].nombre}: ${r.ok ? `${r.productos} productos` : `falló (${r.error})`}`);
  return r.ok;
}));

if (!resultados.some(Boolean)) {
  console.error('Ninguna tienda respondió.');
  process.exit(1);
}

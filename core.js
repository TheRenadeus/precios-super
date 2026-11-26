// Lógica compartida entre la app (navegador) y el servidor (Node, con vm): tamaños, precio por unidad,
// emparejar el mismo producto entre tiendas, grupos, índice de precios y búsqueda de productos.
// Es un script clásico: define funciones globales. Necesita que existan antes estas globales:
//   TIENDAS (tiendas del rubro), NOMBRES, ALL, BYKEY, ESTADO, HOY, DATES, ZONA, REPO, APORTE_DIAS.

const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.,%\s]/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- Tamaño y precio por unidad ----------
const UNI = { kg: ['kg', 1000], kgs: ['kg', 1000], kilo: ['kg', 1000], kilos: ['kg', 1000], g: ['kg', 1], gr: ['kg', 1], grs: ['kg', 1], gramos: ['kg', 1],
  l: ['L', 1000], lt: ['L', 1000], lts: ['L', 1000], litro: ['L', 1000], litros: ['L', 1000], ml: ['L', 1], cc: ['L', 1] };
function tamano(nombre) {
  const s = norm(nombre).replace(/(\d),(\d)/g, '$1.$2');
  let mult = 1;
  const pack = s.match(/\bpack\s*(?:de\s*)?(\d+)\s*(?:un|u|unidades)?\b/) || s.match(/\b(\d+)\s*(?:un|u|unidades)\.?\s+(?=.*\d\s*(?:kg|g|gr|l|lt|ml|cc)\b)/)
    || s.match(/\d\s*(?:kg|kgs|g|gr|grs|l|lt|lts|ml|cc)\b.*?\b(\d+)\s*(?:un|u|unidades)\b/); // "200 g 6 un.": la cantidad después del tamaño
  const multi = s.match(/\b(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|kgs|g|gr|grs|l|lt|lts|ml|cc)\b/);
  // pk: unidades del paquete que ya se leyeron del nombre (para no volver a multiplicar por k).
  if (multi) { const [b, f] = UNI[multi[3]]; return { base: b, qty: +multi[1] * +multi[2] * f, pk: +multi[1] }; }
  if (pack) mult = +pack[1];
  const one = s.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|kilos?|g|gr|grs|gramos|l|lt|lts|litros?|ml|cc)\b/);
  if (one) { const [b, f] = UNI[one[2]]; return { base: b, qty: mult * +one[1] * f, pk: mult }; }
  const un = s.match(/\b(\d+)\s*(?:un|unidades|u)\b/);
  if (un) return { base: 'un', qty: +un[1], pk: +un[1] };
  return null;
}
// Mayoristas: k = unidades por paquete (dato de la tienda, no siempre en el nombre). 'uno' es el tamaño de una
// unidad: sirve para encontrar el mismo producto en tiendas que lo venden suelto.
function tamanoPaquete(nombre, k) {
  const t = tamano(nombre);
  if (!(k > 1)) return t && { ...t, uno: t.qty };
  if (!t) return { base: 'un', qty: k, uno: 1 };
  if (t.pk === k) return { ...t, uno: t.qty / k }; // "60UN" o "6UN 50GR": el nombre ya trae la cantidad del paquete
  return { base: t.base, qty: t.qty * k, uno: t.qty };
}
function unitPrice(p) {
  const t = p.size;
  if (!t || !t.qty) return null;
  if (t.base === 'un') return t.qty > 1 ? { v: p.price / t.qty, u: 'c/u' } : null;
  return { v: p.price / (t.qty / 1000), u: t.base === 'kg' ? 'kg' : 'L' };
}

// ---------- Historial ----------
function priceAt(p, d) {
  if (d < p.h[0][0] || d > p.v) return null;
  let r = null;
  for (const row of p.h) { if (row[0] <= d) r = row; else break; }
  return r ? r[1] : null;
}
function changeSince(p, days) {
  const from = addDays(p.v, -days);
  if (from < p.h[0][0]) return null;
  const a = priceAt(p, from);
  return a ? (p.price / a - 1) * 100 : null;
}

// ---------- Cargar datos ----------
// dbs: { tienda: contenido de data/<tienda>.json }, aportes: lista de data/aportes.json
function cargarDatos(dbs, aportes) {
  let min = null, max = null;
  for (const s of Object.keys(dbs)) {
    const db = dbs[s];
    if (!db || !db.productos) continue;
    ESTADO[s] = { ...(db.estado || { ok: true, ultimoOk: db.fecha }), fecha: db.fecha };
    for (const [id, p] of Object.entries(db.productos)) {
      if (!p.h || !p.h.length) continue;
      const last = p.h[p.h.length - 1];
      const o = { key: s + ':' + id, store: s, id, n: p.n, m: p.m, u: p.u, i: p.i, t: p.t || [], v: p.v, h: p.h, out: !!p.x,
        price: last[1], normal: last[2], card: last[3], fresh: p.v === db.fecha, k: p.k || 1, steps: p.e || null };
      o.size = tamanoPaquete(o.n, o.k);
      o.unit = unitPrice(o);
      o.search = norm(o.n + ' ' + o.m);
      ALL.push(o); BYKEY.set(o.key, o);
      if (!min || p.h[0][0] < min) min = p.h[0][0];
      if (!max || p.v > max) max = p.v;
    }
  }
  HOY = max || '';
  // Una tienda que dejó de leerse (por ejemplo Tottus) no compite con precios de hace días.
  for (const p of ALL) if (p.fresh && ESTADO[p.store].fecha < addDays(HOY, -3)) p.fresh = false;
  for (const o of productosAportados(aportes || [])) {
    ALL.push(o); BYKEY.set(o.key, o);
    if (!min || o.h[0][0] < min) min = o.h[0][0];
  }
  if (min) for (let d = min; d <= max; d = addDays(d, 1)) DATES.push(d);
}

// Precios que aporta la gente con el formulario de GitHub (scripts/aporte.mjs).
// Los avisos del mismo producto en la misma tienda forman su historial; el mismo día vale el último aviso.
function productosAportados(lista) {
  const por = new Map();
  for (const a of lista) {
    if (!TIENDAS.includes(a.t) || !a.f || a.f > HOY) continue;
    if (ZONA && a.r && a.r !== ZONA) continue; // con zona elegida, solo los aportes de esa región
    // Cada región por separado: el mismo producto puede costar distinto en otra región.
    const id = 'ap-' + (a.r ? a.r.toLowerCase() + '-' : '') + norm(a.n + ' ' + a.m).replace(/[^a-z0-9]+/g, '-');
    if (!por.has(a.t + ':' + id)) por.set(a.t + ':' + id, { s: a.t, id, xs: [] });
    por.get(a.t + ':' + id).xs.push(a);
  }
  const out = [];
  for (const [key, { s, id, xs }] of por) {
    xs.sort((a, b) => a.f < b.f ? -1 : a.f > b.f ? 1 : a.id - b.id);
    const h = [];
    for (const a of xs) {
      const fila = [a.f, a.p, a.o || null, null], ult = h[h.length - 1];
      if (ult && ult[0] === a.f) h[h.length - 1] = fila;
      else if (!ult || ult[1] !== fila[1] || ult[2] !== fila[2]) h.push(fila);
    }
    const u = xs[xs.length - 1], last = h[h.length - 1];
    const marca = /^sin marca$/i.test(u.m) ? '' : u.m;
    // La marca va también en el nombre (como en las tiendas): así se empareja con el mismo producto.
    const nombre = marca && !norm(u.n).includes(norm(marca)) ? u.n + ' ' + marca : u.n;
    const o = { key, store: s, id, n: nombre, m: marca, u: REPO + '/issues/' + u.id, i: '', t: [], v: u.f, h, out: false,
      price: last[1], normal: last[2], card: null, fresh: u.f >= addDays(HOY, -APORTE_DIAS), k: 1, steps: null, ap: { l: u.l, r: u.r, n: xs.length } };
    o.size = tamanoPaquete(o.n, o.k);
    o.unit = unitPrice(o);
    o.search = norm(o.n + ' ' + o.m);
    out.push(o);
  }
  return out;
}

// ---------- Índice de precios por tienda ----------
function indice(days) {
  const end = HOY;
  const start = days ? (addDays(end, -days) < DATES[0] ? DATES[0] : addDays(end, -days)) : DATES[0];
  const dates = DATES.filter(d => d >= start && d <= end);
  const out = {};
  for (const s of TIENDAS) {
    const prods = ALL.filter(p => p.store === s);
    // Índice encadenado: cada día se compara con el anterior usando solo los productos que tienen
    // precio ambos días (media geométrica). Así no lo distorsionan productos que aparecen o desaparecen.
    const vals = dates.map(() => null);
    const counts = dates.map(() => 0);
    const sums = dates.map(() => 0);
    for (const p of prods) {
      let prev = null;
      dates.forEach((d, i) => {
        const v = priceAt(p, d);
        if (v != null && prev != null) { sums[i] += Math.log(v / prev); counts[i]++; }
        if (v != null) counts[0] += i === 0 ? 1 : 0;
        prev = v;
      });
    }
    let acc = null;
    dates.forEach((d, i) => {
      if (acc == null) { if (counts[i]) acc = 100; vals[i] = acc; return; }
      if (counts[i]) acc *= Math.exp(sums[i] / counts[i]);
      vals[i] = acc;
    });
    out[s] = { vals, n: counts[counts.length - 1] || 0 };
  }
  return { dates, out };
}

// ---------- El mismo producto en otras tiendas ----------
// Precio de una unidad: en una caja de 12 es el precio dividido por 12. Así se compara con el producto suelto.
const porUno = p => p.size && p.size.qty ? p.price * p.size.uno / p.size.qty : p.price;
const esPaquete = p => p.size && p.size.qty !== p.size.uno && p.k > 1;
const CATALOGO_COMUN = new Set(['jumbo', 'santaisabel']); // comparten identificadores de producto
const tokens = s => new Set(norm(s).split(' ').map(w => w.replace(/[.,]+$/, '')).filter(w => w.length > 1 && !/^\d/.test(w)));
// Índice por tamaño de una unidad (log, cubetas de ~1 %): solo se comparan productos de tamaño parecido.
let INDICE = null;
const cubeta = u => Math.round(Math.log(u) * 100);
function indiceTamanos() {
  if (INDICE) return INDICE;
  INDICE = new Map();
  for (const q of ALL) {
    q.tok = tokens(q.n); q.mn = norm(q.m);
    if (!q.size || !(q.size.uno > 0)) {
      // Sin tamaño (herramientas, por ejemplo): se buscan por marca.
      if (q.mn) { const k = 'marca|' + q.mn; if (!INDICE.has(k)) INDICE.set(k, []); INDICE.get(k).push(q); }
      continue;
    }
    const k = q.size.base + '|' + cubeta(q.size.uno);
    if (!INDICE.has(k)) INDICE.set(k, []);
    INDICE.get(k).push(q);
  }
  return INDICE;
}
// Palabras que distinguen variantes del mismo producto: si una está en un nombre y no en el otro, no son iguales
// (leche "chocolate" vs leche sola, porotos "granados" vs "negros", "sin lactosa", "semidescremada"...).
const VARIANTE = new Set(('chocolate vainilla frutilla platano manjar durazno pina mango coco caramelo limon naranja frambuesa berries '
  + 'lactosa zerolacto deslactosada a2 light zero diet proteina descremada semidescremada entera negro negros negra granado granados hallado hallados '
  + 'tinto tintos integral rojo rojos roja verde verdes blanco blancos blanca amarillo amarilla dulce picante ahumado '
  + 'pollo carne vacuno cerdo atun jurel salmon queso jamon mantequilla aceituna '
  + 'ultra premium stevia sucralosa basmati jazmin arborio g1 g2 descafeinado minions hass edranol whitening').split(/\s+/));
const gas = s => /\b(con gas|gasificada|gasificado)\b/.test(norm(s)) ? 'con' : /\bsin gas\b/.test(norm(s)) ? 'sin' : null;
const metros = s => { const m = norm(s).replace(/(\d),(\d)/g, '$1.$2').match(/(\d+(?:\.\d+)?)\s*(?:m|mt|mts|metros)\b/); return m ? +m[1] : null; };
// Códigos de modelo ("dcd7781d2"): letras y números juntos, que no sean una medida (18v, 13mm, 2ah).
const MEDIDA = /^\d+([.,]\d+)?(v|ah|mah|mm|cm|m|mts|w|kw|kg|g|gr|grs|l|lt|lts|ml|cc|nm|rpm|hp|pulg|gl|gal|un|u|x\d+)$/;
const codigos = p => p.cod || (p.cod = new Set([...p.tok].filter(w => w.length >= 4 && /\d/.test(w) && /[a-z]/.test(w) && !MEDIDA.test(w))));
function mismoProducto(p, q) {
  for (const w of p.tok) if (VARIANTE.has(w) && !q.tok.has(w)) return false;
  for (const w of q.tok) if (VARIANTE.has(w) && !p.tok.has(w)) return false;
  if (p.mt === undefined) p.mt = metros(p.n);
  if (q.mt === undefined) q.mt = metros(q.n);
  if (p.mt && q.mt && Math.abs(p.mt - q.mt) > 0.05 * p.mt) return false; // papel higiénico de 30 m ≠ 18 m
  const gp = gas(p.n), gq = gas(q.n);
  if (gp && gq && gp !== gq) return false; // agua con gas ≠ sin gas
  if ((p.size?.pk || 1) !== (q.size?.pk || 1)) return false; // botella de 3 L ≠ pack de 6 de 500 cc
  return true;
}
// Parecido entre dos productos sin tamaño de la misma marca: nombre parecido y, si ambos traen código de modelo, uno en común.
function parecidoSinTamano(a, b) {
  if (!a.mn || !b.mn || (a.mn !== b.mn && !a.mn.includes(b.mn) && !b.mn.includes(a.mn))) return -1;
  if (!mismoProducto(a, b)) return -1;
  const ca = codigos(a), cb = codigos(b);
  const comun = [...ca].some(c => cb.has(c));
  if (ca.size && cb.size && !comun) return -1;
  let inter = 0; for (const w of a.tok) if (b.tok.has(w)) inter++;
  return inter / (a.tok.size + b.tok.size - inter) + (comun ? 0.3 : 0);
}
// Dos productos de tiendas distintas son comparables (mismo criterio que equivalentes, pero entre cualquier par).
function compatibles(a, b) {
  if (CATALOGO_COMUN.has(a.store) && CATALOGO_COMUN.has(b.store) && a.id === b.id) return true;
  if (!a.size && !b.size) return parecidoSinTamano(a, b) >= 0.5;
  if (!a.size || !b.size || a.size.base !== b.size.base || Math.abs(a.size.uno - b.size.uno) > 0.01 * a.size.uno) return false;
  if (a.mn && b.mn && a.mn !== b.mn && !a.mn.includes(b.mn) && !b.mn.includes(a.mn)) return false;
  if (!mismoProducto(a, b)) return false;
  let inter = 0; for (const w of a.tok) if (b.tok.has(w)) inter++;
  return inter / (a.tok.size + b.tok.size - inter) - (!a.mn || !b.mn ? 0.2 : 0) >= 0.5;
}
function equivalentes(p, { soloFrescos = false } = {}) {
  const I = indiceTamanos();
  const a = p.tok, ma = p.mn;
  const mejor = new Map(); // tienda → { q, sc }
  if (p.size && p.size.uno > 0) {
    const c = cubeta(p.size.uno);
    for (const d of [-1, 0, 1]) for (const q of I.get(p.size.base + '|' + (c + d)) || []) {
      if (q.store === p.store || (soloFrescos && !q.fresh) || Math.abs(q.size.uno - p.size.uno) > 0.01 * p.size.uno) continue;
      const mb = q.mn;
      if (ma && mb && ma !== mb && !ma.includes(mb) && !mb.includes(ma)) continue;
      if (!mismoProducto(p, q)) continue;
      let inter = 0; for (const w of a) if (q.tok.has(w)) inter++;
      let sc = inter / (a.size + q.tok.size - inter);
      if (!ma || !mb) sc -= 0.2; // sin marca en uno de los dos: se exige más parecido en el nombre
      const b = mejor.get(q.store);
      if (!b || sc > b.sc) mejor.set(q.store, { q, sc });
    }
  } else if (p.mn) {
    for (const q of I.get('marca|' + p.mn) || []) {
      if (q.store === p.store || (soloFrescos && !q.fresh)) continue;
      const sc = parecidoSinTamano(p, q);
      const b = mejor.get(q.store);
      if (sc >= 0.5 && (!b || sc > b.sc)) mejor.set(q.store, { q, sc });
    }
  }
  const out = [];
  for (const s of TIENDAS) {
    if (s === p.store) continue;
    // Jumbo y Santa Isabel comparten catálogo: mismo identificador = mismo producto.
    const exacto = BYKEY.get(s + ':' + p.id);
    if (exacto && CATALOGO_COMUN.has(p.store) && CATALOGO_COMUN.has(s) && (!soloFrescos || exacto.fresh)) { out.push({ q: exacto, exact: true }); continue; }
    const b = mejor.get(s);
    if (b && b.sc >= 0.5) out.push({ q: b.q, exact: false });
  }
  return out;
}

// ---------- Grupos: el mismo producto en varias tiendas ----------
let GRUPOS = null;
const GRUPO_DE = new Map(); // clave de producto → su grupo
function grupos() {
  if (GRUPOS) return GRUPOS;
  indiceTamanos();
  const usados = new Set();
  GRUPOS = [];
  for (const p of ALL) {
    if (!p.fresh || usados.has(p.key)) continue;
    const eq = equivalentes(p, { soloFrescos: true }).filter(e => !usados.has(e.q.key));
    // Cada producto que entra debe ser comparable con todos los que ya están, no solo con el primero.
    const miembros = [p];
    for (const e of eq) if (miembros.every(m => compatibles(m, e.q))) miembros.push(e.q);
    if (miembros.length < 2) continue;
    miembros.sort((x, y) => porUno(x) - porUno(y));
    // Un precio aportado no trae categoría: toma la del mismo producto en otras tiendas.
    for (const m of miembros) if (m.ap && !m.t.length) m.t = [...new Set(miembros.flatMap(x => x.t))];
    miembros.forEach(m => usados.add(m.key));
    const g = { p, miembros, min: porUno(miembros[0]), t: [...new Set(miembros.flatMap(m => m.t))] };
    GRUPOS.push(g);
    miembros.forEach(m => GRUPO_DE.set(m.key, g));
  }
  return GRUPOS;
}
const enCat = (g, cat) => !cat || g.t.includes(cat);
const gana = (m, g) => porUno(m) <= g.min * 1.005; // empate si la diferencia es menor a 0,5 %

// Buscador chico (canasta y producto a producto): primero los que están en más tiendas, después los más baratos.
function elegir(q, limite = 6) {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const r = ALL.filter(p => p.fresh && words.every(w => p.search.includes(w)));
  r.sort((a, b) => ((GRUPO_DE.get(b.key)?.miembros.length || 1) - (GRUPO_DE.get(a.key)?.miembros.length || 1)) || a.price - b.price);
  const vistos = new Set(), out = [];
  for (const p of r) { const g = GRUPO_DE.get(p.key); const id = g ? g.p.key : p.key; if (vistos.has(id)) continue; vistos.add(id); out.push(g ? g.p : p); if (out.length >= limite) break; }
  return out;
}
function ofertas(p) { // tienda → producto equivalente con precio de hoy
  const m = new Map();
  const g = GRUPO_DE.get(p.key);
  for (const q of g ? g.miembros : (p.fresh ? [p] : [])) m.set(q.store, q);
  return m;
}

// Lo que muestra cada pantalla de la app, calculado a partir de los datos (core.js).
// Lo usan la app (cuando lee los archivos de GitHub) y el servidor (cuando la app le pregunta a él): las dos
// formas dan exactamente el mismo resultado, y la app dibuja igual venga de donde venga.
// Es un script clásico. Necesita core.js cargado antes, con sus datos, y la global CATS (categorías del rubro).
// Cada vista devuelve objetos simples (sin Map ni Set), que se pueden mandar como JSON.

// Resumen de un producto: lo que necesita la app para dibujarlo. h = historial (solo para gráficos).
function resumen(p, { h = false } = {}) {
  const g = GRUPOS && GRUPO_DE.get(p.key);
  const o = { key: p.key, store: p.store, id: p.id, n: p.n, m: p.m, u: p.u, i: p.i, t: p.t, v: p.v, out: p.out, price: p.price, normal: p.normal,
    card: p.card, fresh: p.fresh, k: p.k, steps: p.steps, size: p.size, unit: p.unit, ap: p.ap, c30: changeSince(p, 30) };
  if (g) o.grp = { n: g.miembros.length, min: g.min, gana: gana(p, g), primero: { store: g.miembros[0].store, uno: porUno(g.miembros[0]), paquete: !!esPaquete(g.miembros[0]) } };
  if (h) o.h = p.h;
  return o;
}
const grupoResumido = g => ({ p: resumen(g.p), miembros: g.miembros.map(m => resumen(m)), min: g.min });

const VISTAS = {
  // Portada: estado de cada tienda, categorías, mayores alzas y bajas de la semana.
  inicio() {
    grupos();
    // Alzas y bajas de la semana; si hay menos de 7 días de datos, desde el primer día (antes salían vacías).
    const DAYS = 7, movDesde = DATES.length ? (addDays(HOY, -DAYS) < DATES[0] ? DATES[0] : addDays(HOY, -DAYS)) : HOY;
    const movs = ALL.filter(p => p.fresh && p.h[0][0] <= movDesde).map(p => {
      const antes = priceAt(p, movDesde);
      return { p, antes, ch: antes ? (p.price / antes - 1) * 100 : null };
    }).filter(o => o.ch != null && Math.abs(o.ch) >= 0.5);
    const ups = movs.filter(o => o.ch > 0).sort((a, b) => b.ch - a.ch).slice(0, 8);
    const downs = movs.filter(o => o.ch < 0).sort((a, b) => a.ch - b.ch).slice(0, 8);
    const conteos = {};
    for (const s of TIENDAS) {
      const ap = ALL.filter(p => p.store === s && p.ap);
      conteos[s] = { n: ALL.filter(p => p.store === s && p.fresh && !p.ap).length, ap: ap.length, apUlt: ap.reduce((m, p) => p.v > m ? p.v : m, ''),
        total: ALL.filter(p => p.store === s).length };
    }
    // Categorías con subcategorías, solo las que tienen productos.
    const hay = new Set(ALL.flatMap(p => p.t));
    const categorias = Object.entries(CATS).map(([cat, subs]) => [cat, Object.entries(subs).filter(([, ts]) => ts.some(t => hay.has(t))).map(([sub]) => sub)])
      .filter(([, subs]) => subs.length);
    const mov = o => ({ ...resumen(o.p), ch: o.ch, antes: o.antes });
    return { hoy: HOY, dias: DATES.length, estado: ESTADO, conteos, categorias,
      caracteristicas: Object.entries(CARACTERISTICAS).map(([k, [nombre]]) => [k, nombre]),
      movDesde, ups: ups.map(mov), downs: downs.map(mov) };
  },

  // Índice de precios de cada tienda en los últimos d días (0 = todo).
  indice(q) {
    if (DATES.length < 2) return null;
    const d = +q.d || 0;
    if (!VISTAS._indices) VISTAS._indices = {};
    return VISTAS._indices[d] || (VISTAS._indices[d] = indice(d));
  },

  // Buscar con filtros. Devuelve una página de resultados (desde, n), el total y las marcas para el filtro.
  buscar(q) {
    grupos();
    const texto = norm(q.q || '');
    const words = texto ? texto.split(' ') : [];
    const sel = new Set((q.tiendas || TIENDAS.join(',')).split(',').filter(s => TIENDAS.includes(s)));
    const cat = q.cat || '', sort = q.orden || 'rel';
    const ts = terminosCategoria(CATS, cat, q.sub || '');
    const car = (q.car || '').split(',').filter(k => CARACTERISTICAS[k]);
    const f = { oferta: q.oferta === '1', baja: q.baja === '1', varias: q.varias === '1', hoy: q.hoy === '1', marca: q.marca || '', uni: q.uni || '',
      min: q.min ? +q.min : null, max: q.max ? +q.max : null, desc: +q.desc || 0, tarjeta: q.tarjeta === '1', disp: q.disp === '1' };
    const nf = [f.oferta, f.baja, f.varias, f.hoy, f.marca, f.uni, f.min != null, f.max != null, f.desc, f.tarjeta, f.disp, car.length].filter(Boolean).length;
    const pasa = p => (!f.oferta || p.normal) && (!f.baja || (changeSince(p, 30) ?? 0) < -0.5)
      && (!f.varias || (GRUPO_DE.get(p.key)?.miembros.length || 0) > 1) && (!f.hoy || p.fresh)
      && (!f.uni || (f.uni === 'u' ? !p.unit || p.unit.u === 'c/u' : p.unit && p.unit.u === f.uni))
      && (f.min == null || p.price >= f.min) && (f.max == null || p.price <= f.max)
      && (!f.desc || descuento(p) >= f.desc) && (!f.tarjeta || p.card) && (!f.disp || !p.out) && car.every(k => tieneCaracteristica(p, k));
    let r = ALL.filter(p => sel.has(p.store) && enTerminos(p, ts) && words.every(w => p.search.includes(w)) && pasa(p));
    // Marcas de lo que cumple los demás filtros (la elegida se aplica después), sin repetir por mayúsculas o tildes.
    const por = new Map();
    for (const p of r) {
      const k = norm(p.m); if (!k) continue;
      if (!por.has(k)) por.set(k, { n: 0, grafias: new Map() });
      const o = por.get(k); o.n++; o.grafias.set(p.m, (o.grafias.get(p.m) || 0) + 1);
    }
    if (f.marca && !por.has(f.marca)) {
      const p = ALL.find(p => norm(p.m) === f.marca);
      por.set(f.marca, { n: 0, grafias: new Map([[p ? p.m : f.marca, 1]]) });
    }
    const marcas = [...por].map(([k, o]) => [k, [...o.grafias].sort((a, b) => b[1] - a[1])[0][0], o.n])
      .sort((a, b) => a[1].localeCompare(b[1], 'es', { sensitivity: 'base' }));
    if (f.marca) r = r.filter(p => norm(p.m) === f.marca);
    // El mismo producto en varias tiendas va en una sola fila: la más barata (por unidad) entre las tiendas marcadas.
    const filaDe = new Map(), unicos = [];
    for (const p of r) {
      const g = GRUPO_DE.get(p.key);
      if (!g) { unicos.push(p); continue; }
      const i = filaDe.get(g);
      if (i === undefined) { filaDe.set(g, unicos.length); unicos.push(p); }
      else if (porUno(p) < porUno(unicos[i])) unicos[i] = p;
    }
    r = unicos;
    const score = p => (p.fresh ? 0 : 1000) + (texto && p.t.some(t => norm(t) === texto || texto.startsWith(norm(t))) ? 0 : 2) + (texto && p.search.startsWith(texto) ? 0 : 1);
    const ch = new Map(); const c30 = p => { if (!ch.has(p.key)) ch.set(p.key, changeSince(p, 30)); return ch.get(p.key); };
    const orden = {
      rel: (a, b) => score(a) - score(b) || a.price - b.price,
      price: (a, b) => a.price - b.price,
      unit: (a, b) => (a.unit ? a.unit.v : Infinity) - (b.unit ? b.unit.v : Infinity),
      disc: (a, b) => (b.normal ? 1 - b.price / b.normal : 0) - (a.normal ? 1 - a.price / a.normal : 0),
      up30: (a, b) => (c30(b) ?? -1e9) - (c30(a) ?? -1e9),
      down30: (a, b) => (c30(a) ?? 1e9) - (c30(b) ?? 1e9),
    };
    const portada = !texto && !ts && sort === 'rel' && !nf;
    r.sort(portada ? (a, b) => (b.fresh - a.fresh) || orden.disc(a, b) : (orden[sort] || orden.rel));
    const desde = Math.max(0, +q.desde || 0), n = Math.min(200, Math.max(1, +q.n || 60));
    return { total: r.length, portada, marcas, filas: r.slice(desde, desde + n).map(p => resumen(p)) };
  },

  // Ficha: el producto con su historial, las fechas del gráfico y el mismo producto en otras tiendas.
  producto(q) {
    grupos();
    const p = BYKEY.get(q.k);
    if (!p) return null;
    return { p: resumen(p, { h: true }), fechas: DATES.filter(d => d >= p.h[0][0] && d <= p.v),
      eq: equivalentes(p).map(e => ({ q: resumen(e.q), exact: e.exact })) };
  },

  // Varios productos por clave (seguidos, canasta, producto a producto). h=1: con historial.
  productos(q) {
    grupos();
    return (q.k || '').split(',').filter(Boolean).slice(0, 200).map(k => BYKEY.get(k)).filter(Boolean).map(p => resumen(p, { h: q.h === '1' }));
  },

  // Buscador chico (canasta y producto a producto).
  elegir(q) {
    grupos();
    return elegir(q.q || '', Math.min(20, +q.n || 6)).map(p => resumen(p));
  },

  // Para cada clave: el mismo producto con precio de hoy en cada tienda.
  ofertas(q) {
    grupos();
    const claves = (q.k || '').split(',').filter(Boolean).slice(0, 200);
    return Object.fromEntries(claves.map(k => BYKEY.get(k)).filter(Boolean).map(p => [p.key, [...ofertas(p).values()].map(x => resumen(x))]));
  },

  // Comparar: ranking de tiendas, cara a cara entre dos (a y b) y productos en varias tiendas, en una categoría.
  comparar(q) {
    const ts = terminosCategoria(CATS, q.cat || '', q.sub || '');
    const G = grupos().filter(g => !ts || g.t.some(t => ts.has(t)));
    const MIN_T = TIENDAS.length > 3 ? 3 : 2; // con dos tiendas basta con que el producto esté en las dos
    const G3 = G.filter(g => g.miembros.length >= MIN_T);
    // Mediana (no promedio): un emparejamiento equivocado no mueve el resultado.
    const mediana = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
    const st = TIENDAS.map(s => {
      let wins = 0; const difs = [];
      for (const g of G3) { const m = g.miembros.find(x => x.store === s); if (!m) continue; if (gana(m, g)) wins++; difs.push(porUno(m) / g.min - 1); }
      return { s, n: difs.length, wins, prom: difs.length ? mediana(difs) * 100 : null };
    });
    const MIN_N = Math.min(15, Math.max(4, Math.round(G3.length * 0.2))); // en categorías chicas basta con menos productos
    const rk = st.filter(x => x.n >= MIN_N).sort((a, b) => a.prom - b.prom);
    const fuera = st.filter(x => x.n < MIN_N).map(x => x.s);
    const atrasadas = TIENDAS.filter(s => ESTADO[s] && ESTADO[s].fecha && ESTADO[s].fecha < HOY);
    // Cara a cara
    const A = q.a, B = q.b;
    let vs = null, pares = [];
    if (A && B && A !== B) {
      pares = G.map(g => ({ g, a: g.miembros.find(m => m.store === A), b: g.miembros.find(m => m.store === B) }))
        .filter(x => x.a && x.b).map(x => ({ ...x, r: porUno(x.a) / porUno(x.b) }));
      if (pares.length) {
        const aGana = pares.filter(x => x.r < 0.995).length, bGana = pares.filter(x => x.r > 1.005).length;
        vs = { n: pares.length, aGana, bGana, iguales: pares.length - aGana - bGana, geo: Math.exp(pares.reduce((s, x) => s + Math.log(x.r), 0) / pares.length) };
        pares.sort((x, y) => Math.abs(Math.log(y.r)) - Math.abs(Math.log(x.r)));
      }
    }
    const nv = Math.min(500, +q.nv || 20), ng = Math.min(500, +q.ng || 30);
    // Productos comparados: los que están en más tiendas primero.
    const lista = G.slice().sort((x, y) => y.miembros.length - x.miembros.length || (porUno(y.miembros.at(-1)) / y.min) - (porUno(x.miembros.at(-1)) / x.min));
    return { g3: G3.length, minT: MIN_T, rk, fuera, atrasadas, vs,
      pares: pares.slice(0, nv).map(x => ({ g: grupoResumido(x.g), a: resumen(x.a), b: resumen(x.b), r: x.r })), paresTotal: pares.length,
      grupos: lista.slice(0, ng).map(grupoResumido), gruposTotal: lista.length };
  },
};

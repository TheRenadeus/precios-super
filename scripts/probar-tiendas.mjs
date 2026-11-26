// Prueba, desde tu computador, si otros supermercados dejan leer su búsqueda pública.
// Desde los servidores de la nube todos responden "Access Denied"; desde una conexión de casa puede ser distinto.
// Solo hace una visita a robots.txt y una búsqueda por tienda, y muestra el resultado. No guarda nada.
//
// Uso: node scripts/probar-tiendas.mjs
// Copia lo que imprime y compártelo con Claude para ver cuáles se pueden agregar.

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIENDAS = [
  ['Unimarc', 'https://www.unimarc.cl', '/search?q=leche'],
  ['aCuenta', 'https://www.acuenta.cl', '/search?q=leche'],
  ['Alvi', 'https://www.alvi.cl', '/search?q=leche'],
  ['Mayorista 10', 'https://www.mayorista10.cl', '/search?q=leche'],
  ['Cugat', 'https://www.cugat.cl', '/?s=leche&post_type=product'],
  ['Telemercados', 'https://www.telemercados.cl', '/busca?q=leche'],
];

async function pedir(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-CL,es;q=0.9' }, signal: AbortSignal.timeout(20000) });
    return { status: r.status, url: r.url, body: await r.text() };
  } catch (e) {
    return { status: 0, error: (e.cause && e.cause.code) || e.message, body: '' };
  }
}

for (const [nombre, base, busqueda] of TIENDAS) {
  const robots = await pedir(base + '/robots.txt');
  const pag = await pedir(base + busqueda);
  const prohibe = /disallow:\s*\/(search|busca|\?s=|\s*$)/im.test(robots.body);
  const datos = [
    /application\/ld\+json/.test(pag.body) && 'JSON-LD',
    /__NEXT_DATA__/.test(pag.body) && '__NEXT_DATA__',
    /"price"\s*:/i.test(pag.body) && 'precios en la página',
  ].filter(Boolean);
  console.log(`\n${nombre}`);
  console.log(`  robots.txt: ${robots.status || robots.error}${prohibe ? ' (prohíbe la búsqueda)' : ''}`);
  console.log(`  búsqueda:   ${pag.status || pag.error}${pag.url && pag.url !== base + busqueda ? ` → ${pag.url}` : ''} · ${pag.body.length} bytes`);
  console.log(`  datos:      ${datos.length ? datos.join(', ') : 'ninguno reconocible'}`);
}

// Lee precios desde TU computador y los sube a GitHub.
// Sirve para las tiendas que bloquean a los servidores de GitHub (por ahora, Tottus).
//
// Uso (dentro de la carpeta del repositorio):
//   node scripts/precios-local.mjs            → lee Tottus
//   node scripts/precios-local.mjs tottus ... → lee las tiendas que indiques
//
// Necesita Node.js 22 o superior y git con permiso para subir a este repositorio.
// Cada tienda guarda solo su archivo (data/<tienda>.json), así que no choca con la tarea de GitHub.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const tiendas = process.argv.slice(2).length ? process.argv.slice(2) : ['tottus'];

function correr(cmd, args, { permitirFallo = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: raiz, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0 && !permitirFallo) {
    console.error(`\nFalló: ${cmd} ${args.join(' ')}`);
    process.exit(r.status || 1);
  }
  return r.status === 0;
}

// 1. Traer lo último de GitHub (incluye lo que subió la tarea diaria).
correr('git', ['pull', '--rebase', '--autostash', '--quiet']);

// 2. Leer precios. Si falla, igual se sube el archivo: queda registrado que esa tienda no respondió.
const ok = correr(process.execPath, ['scripts/update-prices.mjs', ...tiendas], { permitirFallo: true });

// 3. Subir solo los archivos de esas tiendas.
const archivos = tiendas.map(t => `data/${t}.json`);
correr('git', ['add', '--', ...archivos]);
const sinCambios = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: raiz }).status === 0;
if (sinCambios) {
  console.log('Sin cambios que subir.');
} else {
  correr('git', ['commit', '--quiet', '-m', `Actualizar precios (${tiendas.join(', ')}) desde computador`]);
  let subido = false;
  for (let i = 0; i < 3 && !subido; i++) {
    subido = correr('git', ['pull', '--rebase', '--quiet'], { permitirFallo: true }) && correr('git', ['push', '--quiet'], { permitirFallo: true });
  }
  if (!subido) { console.error('No se pudo subir a GitHub. Revisa tu conexión o tus permisos.'); process.exit(1); }
  console.log('Precios subidos a GitHub.');
}
process.exit(ok ? 0 : 1);

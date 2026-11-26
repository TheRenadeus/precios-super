# Precios súper

Precios diarios de supermercados en Chile y cómo cambian en el tiempo.
Funciona como app web instalable (PWA) desde GitHub Pages.

- **Tendencia:** un índice por supermercado (100 = primer día del período) y los productos que más
  subieron o bajaron en los últimos 7 días.
- **Buscar:** todos los productos, con filtros por tienda y categoría, precio por kg o litro y descuento del día.
  Cada producto muestra su gráfico de precio y el mismo producto en los otros supermercados.
- **Seguidos:** los productos que marcas con la estrella (se guardan solo en tu teléfono).

Supermercados: **Jumbo, Santa Isabel, Tottus y aCuenta**. Líder, Unimarc, Alvi y Mayorista 10 bloquean
la lectura automática de sus páginas desde servidores en la nube.

aCuenta no trae los productos en el HTML de su búsqueda: se leen de la API de su plataforma (Instaleap), con la
misma consulta que hace el navegador de cualquier visitante. Los precios son los del local El Monte, el que el
sitio muestra por defecto (`ACUENTA_LOCAL` en `scripts/update-prices.mjs`).

## 1. Publicar

1. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, elige `main` y `/ (root)`.
   La app queda en `https://TU_USUARIO.github.io/precios-super/`.
2. **Settings → Actions → General → Workflow permissions** → **Read and write permissions**.
3. En el celular, abre la dirección en Chrome → menú ⋮ → **Instalar app**.

## 2. Cómo se llenan los precios

`scripts/update-prices.mjs` busca cada término de `canasta.json` en la búsqueda pública de cada
supermercado y guarda los precios en `data/<tienda>.json`. Solo agrega una fila cuando un precio cambia,
así los archivos crecen poco. Cada archivo guarda también cómo salió su última lectura (`estado`).

Para seguir más productos, agrega términos a `canasta.json`.

### Jumbo y Santa Isabel: GitHub, todos los días

La tarea `.github/workflows/precios.yml` los lee cada mañana cerca de las 8:15.
Para ejecutarla a mano: **Actions → Actualizar precios → Run workflow**.

### Tottus: desde tu computador

Tottus bloquea a los servidores de GitHub, pero responde a una conexión normal de casa.
Necesitas [Node.js 22 o superior](https://nodejs.org) y git con este repositorio clonado:

```bash
git clone https://github.com/TU_USUARIO/precios-super.git
```

Luego, dentro de esa carpeta:

```bash
node scripts/precios-local.mjs
```

Trae lo último de GitHub, lee Tottus y sube solo `data/tottus.json`.

**Para que se ejecute solo cada día:**

- **Windows:** abre *Programador de tareas* → *Crear tarea básica* → diaria, 8:30 →
  *Iniciar un programa*: programa `node`, argumentos `scripts\precios-local.mjs`,
  *Iniciar en*: la carpeta del repositorio (por ejemplo `C:\Users\TU_USUARIO\precios-super`).
- **Mac o Linux:** `crontab -e` y agrega (cambiando la ruta):

  ```
  30 8 * * * cd ~/precios-super && node scripts/precios-local.mjs >> precios.log 2>&1
  ```

Si un día el computador está apagado, la app muestra los últimos precios de Tottus y lo indica.

### ¿Se pueden sumar más supermercados?

Desde tu computador, ejecuta:

```bash
node scripts/probar-tiendas.mjs
```

Revisa si Unimarc, aCuenta, Alvi, Mayorista 10, Cugat y Telemercados responden desde tu conexión y si sus
reglas (`robots.txt`) lo permiten. Si alguno responde con datos, se puede agregar.
Líder no se incluye: sus reglas prohíben la lectura automática de su supermercado.

## 3. Publicar cambios en la página

1. Edita `index.html`.
2. En `sw.js`, sube el número de versión (`precios-v1` → `precios-v2`).
3. `git commit` y `git push`.

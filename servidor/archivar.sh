#!/bin/sh
# Guarda en la VM una copia de los precios de cada día, fuera del repositorio: ~/historial/AAAA-MM-DD/<tienda>.json.gz
#
# Los archivos de data/ ya traen el historial de cada producto, pero borran los productos que no aparecen hace
# más de 120 días. Esta copia no borra nada: queda cómo estaban los precios cada día, aunque el repositorio cambie.
# Recorre los cambios de data/ en git, así que también rellena los días en que la VM estuvo apagada.
# De cada día guarda la última versión. Lo corre precios-actualizar.service después de cada git pull.
set -eu
REPO=$(cd "$(dirname "$0")/.." && pwd)
DEST=${HISTORIAL:-$HOME/historial}
mkdir -p "$DEST"
cd "$REPO"

vistos=' '
TZ=America/Santiago git log --format='%H %cd' --date=format-local:%Y-%m-%d -- data | while read -r c dia; do
  # git log va del más nuevo al más antiguo: el primero de cada día es la última versión de ese día.
  case "$vistos" in *" $dia "*) continue ;; esac
  vistos="$vistos$dia "
  [ "$(cat "$DEST/$dia/.commit" 2>/dev/null)" = "$c" ] && continue
  tmp="$DEST/.$dia.tmp"
  rm -rf "$tmp"; mkdir -p "$tmp"
  git ls-tree --name-only "$c" data/ | grep '\.json$' | while read -r f; do
    git show "$c:$f" | gzip -9 > "$tmp/$(basename "$f").gz"
  done
  echo "$c" > "$tmp/.commit"
  rm -rf "$DEST/$dia"; mv "$tmp" "$DEST/$dia"
  echo "historial: $dia guardado ($(ls "$DEST/$dia" | wc -l) archivos)"
done

#!/bin/sh
# Premier — сжатие PNG-картинок сайта (иконки, превью для соцсетей). Запуск: sh deploy/optimize-images.sh
# Нужен хотя бы один инструмент:  sudo apt install pngquant optipng   (или oxipng)
# pngquant — с минимальной потерей качества (в 3–5 раз меньше), optipng/oxipng — без потерь (на 10–30%).
set -e
cd "$(dirname "$0")/../public"
FILES="icon-p-2.png icon-p.png og.png og-en.png og-protrial.png icons/icon-512.png icons/maskable-512.png icons/icon-192.png icons/apple-touch-icon.png icons/badge-96.png"
for f in $FILES; do
  [ -f "$f" ] || continue
  before=$(wc -c <"$f")
  if command -v pngquant >/dev/null 2>&1; then pngquant --force --skip-if-larger --quality=80-95 --strip --output "$f" "$f" || true; fi
  if command -v oxipng >/dev/null 2>&1; then oxipng -o 4 --strip safe -q "$f"; elif command -v optipng >/dev/null 2>&1; then optipng -quiet -o5 "$f"; fi
  echo "$f: $before -> $(wc -c <"$f") байт"
done
echo "Готово. Браузеры подтянут новые картинки сами (ETag)."

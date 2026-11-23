#!/usr/bin/env bash
# Облачный компьютер: не пускать контейнеры пользователей к самому серверу (его порты, SSH, базы), во внутренние
# сети и к адресу метаданных облака (169.254.169.254). В интернет — можно.
#
#   sudo bash scripts/cloud-firewall.sh apply   — поставить недостающие правила и проверить (по умолчанию)
#   sudo bash scripts/cloud-firewall.sh check   — только проверить; код 1, если чего-то нет
#   sudo bash scripts/cloud-firewall.sh remove  — убрать правила и отметку (перед удалением сети или Premier)
#
# Правила живут в памяти ядра и пропадают при перезагрузке, поэтому скрипт запускает systemd:
# deploy/premier-cloud-firewall.service (после docker.service) и таймер раз в минуту. Каждый запуск пишет отметку
# (CLOUD_FIREWALL_STATE, по умолчанию /run/premier-cloud/firewall.json). Сервер Premier без свежей отметки
# «правила на месте» контейнеры не запускает (cloud-net.js), а /healthz показывает причину.
# Повторный запуск безопасен: правило добавляется, только если его нет.
#
# Обычный (rootful) Docker — правила в сети сервера. Rootless Docker (DOCKER_HOST=unix:///run/user/<uid>/docker.sock) —
# правила ставятся внутри сетевого пространства rootless-демона (nsenter), туда же добавляются адреса самого сервера.
set -uo pipefail
ACTION="${1:-apply}"
case "$ACTION" in apply|check|remove) ;; *) echo "Использование: $0 [apply|check|remove]" >&2; exit 2 ;; esac
ENV="${PREMIER_ENV:-/etc/premier/premier.env}"
if [ -r "$ENV" ]; then set -a; . "$ENV"; set +a; fi
NET="${CLOUD_NETWORK:-premier-cloud}"
STATE="${CLOUD_FIREWALL_STATE:-/run/premier-cloud/firewall.json}"
# внутренние сети и служебные диапазоны: частные сети, link-local (метаданные облака), CGNAT (метаданные Alibaba, Tailscale), стенды
RANGES="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 198.18.0.0/15 ${CLOUD_FIREWALL_EXTRA_DROP:-}"
NETID=""; BR=""; MODE="rootful"; NS=""; MISSING=()

state() { # state true|false "причина"
  local dir tmp reason
  dir="$(dirname "$STATE")"; mkdir -p "$dir" 2>/dev/null; chmod 755 "$dir" 2>/dev/null
  reason="$(printf '%s' "${2:-}" | tr -d '"\\\n\r' | cut -c1-300)"
  tmp="$STATE.$$"
  printf '{"v":1,"ok":%s,"at":%s,"network":"%s","netId":"%s","bridge":"%s","mode":"%s","reason":"%s"}\n' "$1" "$(date +%s)" "$NET" "$NETID" "$BR" "$MODE" "$reason" > "$tmp" \
    && chmod 644 "$tmp" && mv -f "$tmp" "$STATE"
}
die() { echo "Ошибка: $1" >&2; state false "$1"; exit 1; }

if [ "${CLOUD_RUNNER:-docker}" != docker ]; then echo "CLOUD_RUNNER=${CLOUD_RUNNER} — контейнеров нет, правила не нужны"; rm -f "$STATE"; exit 0; fi
if [ "$NET" = none ]; then echo "CLOUD_NETWORK=none — у контейнеров нет сети, правила не нужны"; rm -f "$STATE"; exit 0; fi
if ! command -v docker >/dev/null 2>&1; then echo "Docker не установлен — облачный компьютер не работает, правила не нужны"; rm -f "$STATE"; exit 0; fi
[ "$(id -u)" = 0 ] || { echo "Запустите через sudo: правила iptables ставит только root" >&2; exit 1; }
case "$NET" in host|bridge) die "CLOUD_NETWORK=$NET не поддерживается: нужна отдельная сеть (premier-cloud) или none" ;; esac
command -v iptables >/dev/null 2>&1 || die "нет команды iptables (apt install iptables)"

# rootless Docker: сокет лежит в /run/user/<uid>/, правила нужны внутри сетевого пространства его демона
case "${DOCKER_HOST:-}" in
  unix:///run/user/*/docker.sock)
    MODE="rootless"; RT="${DOCKER_HOST#unix://}"; RT="${RT%/docker.sock}"
    PID="$(cat "$RT/docker.pid" 2>/dev/null || true)"
    [ -n "$PID" ] && [ -d "/proc/$PID" ] || die "rootless Docker не запущен (нет $RT/docker.pid)"
    command -v nsenter >/dev/null 2>&1 || die "нет команды nsenter (apt install util-linux)"
    NS="nsenter -n -t $PID" ;;
esac

docker info >/dev/null 2>&1 || die "Docker недоступен (docker info)"
if ! docker network inspect "$NET" >/dev/null 2>&1; then
  [ "$ACTION" = apply ] || die "сети Docker $NET нет"
  # та же сеть, что создаёт сервер: без связи между контейнерами
  docker network create --driver bridge -o com.docker.network.bridge.enable_icc=false --label premier.pc=1 "$NET" >/dev/null || die "не удалось создать сеть $NET"
fi
NETID="$(docker network inspect -f '{{.Id}}' "$NET" 2>/dev/null)"; [ -n "$NETID" ] || die "не удалось прочитать сеть $NET"
[ "$(docker network inspect -f '{{.Driver}}' "$NET")" = bridge ] || die "сеть $NET должна быть типа bridge"
[ "$(docker network inspect -f '{{index .Options "com.docker.network.bridge.enable_icc"}}' "$NET")" = false ] || die "в сети $NET включена связь между контейнерами: удалите её (docker network rm $NET) и запустите скрипт снова"
[ "$(docker network inspect -f '{{.EnableIPv6}}' "$NET")" = false ] || die "в сети $NET включён IPv6: пересоздайте её без --ipv6"
BR="$(docker network inspect -f '{{index .Options "com.docker.network.bridge.name"}}' "$NET")"
[ -n "$BR" ] || BR="br-$(printf '%s' "$NETID" | cut -c1-12)"
$NS ip link show "$BR" >/dev/null 2>&1 || die "нет сетевого моста $BR сети $NET"
$NS iptables -w 5 -S DOCKER-USER >/dev/null 2>&1 || die "нет цепочки DOCKER-USER: Docker должен работать с iptables (iptables: true, firewall-backend не nftables)"

V6=0
if [ -e /proc/sys/net/ipv6 ]; then command -v ip6tables >/dev/null 2>&1 || die "нет команды ip6tables, а IPv6 на сервере включён"; V6=1; fi
# адреса самого сервера: в rootless-режиме пакет к ним уходит наружу через slirp4netns, а не в INPUT — закрываем явно
HOSTS=""
if [ "$MODE" = rootless ]; then HOSTS="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | sort -u | tr '\n' ' ') 10.0.2.2"; fi

ipt() { local v="$1"; shift; if [ "$v" = 6 ]; then $NS ip6tables -w 5 "$@"; else $NS iptables -w 5 "$@"; fi; }
have() { local v="$1"; shift; ipt "$v" -C "$@" 2>/dev/null || MISSING+=("ip${v/4/}tables $*"); }
del() { local v="$1"; shift; while ipt "$v" -C "$@" 2>/dev/null; do ipt "$v" -D "$@" || break; done; }
put() { local v="$1"; shift; ipt "$v" -C "$@" 2>/dev/null || ipt "$v" -I "$@" || MISSING+=("ip${v/4/}tables $* (не добавилось)"); }
rules() { # rules have|put|del — один список правил и для установки, и для проверки
  local op="$1" d
  "$op" 4 INPUT -i "$BR" -j DROP                                             # сам сервер (все его адреса и порты)
  for d in $RANGES $HOSTS; do "$op" 4 DOCKER-USER -i "$BR" -d "$d" -j DROP; done   # внутренние сети и метаданные
  if [ "$V6" = 1 ]; then "$op" 6 INPUT -i "$BR" -j DROP; "$op" 6 FORWARD -i "$BR" -j DROP; fi   # IPv6 из этой сети закрыт целиком
}

# Правило есть — ещё не значит, что пакет до него доходит: чужое правило ACCEPT или RETURN выше по цепочке обошло бы
# его, а «iptables -C» по-прежнему отвечал бы «на месте». Поэтому наши правила обязаны стоять в начале цепочки,
# раньше любых чужих. apply возвращает их наверх (сначала ставит копии сверху, потом убирает нижние — без окна,
# когда правил нет); check при неверном порядке пишет отметку «нет защиты».
# «Наше» — только правило, которое ставит этот скрипт, в точности: другие запреты администратора на этом же мосту
# (например, DROP на отдельный адрес) считаются чужими, и перестановка их не удаляет.
norm() { # 10.1.2.3/8 → 10.0.0.0/8, 1.2.3.4 → 1.2.3.4/32 — так адрес печатает «iptables -S»
  local ip="${1%/*}" len=32 a b c d n m
  case "$1" in */*) len="${1#*/}" ;; esac
  IFS=. read -r a b c d <<< "$ip"
  n=$(( (a << 24) | (b << 16) | (c << 8) | d ))
  if [ "$len" -eq 0 ]; then m=0; else m=$(( (0xffffffff << (32 - len)) & 0xffffffff )); fi
  n=$(( n & m ))
  printf '%d.%d.%d.%d/%d' $(( (n >> 24) & 255 )) $(( (n >> 16) & 255 )) $(( (n >> 8) & 255 )) $(( n & 255 )) "$len"
}
OURS4=" "; for d in $RANGES $HOSTS; do OURS4="$OURS4$(norm "$d") "; done
ours() { # ours 4|6 ЦЕПОЧКА СТРОКА — строка из «iptables -S»
  local v="$1" c="$2" rest="${3#"-A $2 "}" d
  [ "$rest" = "-i $BR -j DROP" ] && { [ "$c" = INPUT ] || { [ "$v" = 6 ] && [ "$c" = FORWARD ]; }; } && return 0
  if [ "$v" = 4 ] && [ "$c" = DOCKER-USER ]; then
    case "$rest" in "-d "*" -i $BR -j DROP") d="${rest#-d }"; d="${d%% *}"; [ "$rest" = "-d $d -i $BR -j DROP" ] || return 1
      case "$OURS4" in *" $d "*) return 0 ;; esac ;;
    esac
  fi
  return 1
}
late() { # late 4|6 ЦЕПОЧКА — номера наших правил, стоящих ниже первого чужого (по убыванию)
  local v="$1" c="$2" n=0 foreign=0 line out=""
  while IFS= read -r line; do
    case "$line" in "-A $c "*) ;; *) continue ;; esac
    n=$((n + 1))
    if ours "$v" "$c" "$line"; then [ "$foreign" = 1 ] && out="$n $out"; else foreign=1; fi
  done < <(ipt "$v" -S "$c" 2>/dev/null)
  printf '%s' "$out"
}
CHAINS="4:INPUT 4:DOCKER-USER"; [ "$V6" = 1 ] && CHAINS="$CHAINS 6:INPUT 6:FORWARD"
REDO=""
top() { local v="$1" c="$2"; shift 2; case " $REDO " in *" $v:$c "*) ipt "$v" -I "$c" 1 "$@" || true ;; esac; }
reorder() {
  local vc n
  REDO=""; for vc in $CHAINS; do [ -n "$(late "${vc%%:*}" "${vc#*:}")" ] && REDO="$REDO $vc"; done
  [ -n "$REDO" ] || return 0
  rules top
  for vc in $REDO; do for n in $(late "${vc%%:*}" "${vc#*:}"); do ipt "${vc%%:*}" -D "${vc#*:}" "$n" || true; done; done
  echo "Порядок правил восстановлен (выше стояли чужие правила):$REDO"
}

if [ "$ACTION" = apply ]; then rules put; reorder; fi
if [ "$ACTION" = remove ]; then rules del; rm -f "$STATE"; echo "Правила сети $NET ($BR) убраны. Пока их нет, сервер Premier контейнеры не запускает."; exit 0; fi
MISSING=(); rules have
for vc in $CHAINS; do [ -z "$(late "${vc%%:*}" "${vc#*:}")" ] || MISSING+=("ip$( [ "${vc%%:*}" = 6 ] && echo 6 )tables ${vc#*:}: выше правил защиты стоит чужое правило — пакеты могут до них не доходить"); done
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "Не хватает правил (${#MISSING[@]}):" >&2; printf '  %s\n' "${MISSING[@]}" >&2
  state false "нет правил: ${MISSING[0]}$([ "${#MISSING[@]}" -gt 1 ] && echo " и ещё $(( ${#MISSING[@]} - 1 ))")"
  exit 1
fi
state true "" || { echo "Ошибка: не удалось записать отметку $STATE" >&2; exit 1; }
echo "Готово ($MODE): контейнеры сети $NET ($BR) не видят сервер, внутренние сети и адрес метаданных; отметка — $STATE"

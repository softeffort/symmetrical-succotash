# Облачный компьютер Premier: образ для постоянных контейнеров пользователей (см. cloud.js).
# Сборка (один раз, из папки проекта): docker build -t premier-cloud -f sandbox/cloud.Dockerfile sandbox
# Контейнер запускается без root, с файловой системой только для чтения: пользователь ставит пакеты в домашнюю
# папку (pip install / npm install — см. PIP_USER и NPM_CONFIG_PREFIX в cloud.js).
# Версии закреплены (OPS-20): базовый образ — по sha256, пакеты Python — точные версии в cloud.requirements.txt.
# Обновление — осознанное: docker pull node:22-bookworm-slim, взять новый sha256 из
#   docker image inspect node:22-bookworm-slim --format '{{index .RepoDigests 0}}'
# поправить версии в cloud.requirements.txt, пересобрать и прогнать scripts/cloud-check.sh.
# Служебные программы сервер зовёт по полным путям (cloud.js, BIN): /usr/local/bin/node, /usr/bin/python3,
# /usr/bin/timeout, /bin/bash — сборка ниже проверяет, что они на месте.
FROM node@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv git curl wget ca-certificates zip unzip xz-utils nano less procps file jq sqlite3 build-essential fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* && ln -s /usr/bin/python3 /usr/local/bin/python
COPY cloud.requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --break-system-packages --no-deps -r /tmp/requirements.txt && pip check \
    && rm /tmp/requirements.txt && python3 -c "import matplotlib.pyplot, bs4, lxml"
RUN test -x /usr/local/bin/node && test -x /usr/bin/python3 && test -x /usr/bin/timeout && test -x /bin/bash
# uid 1000 в образе Node зовётся node — в терминале пусть будет premier@cloud
RUN usermod -l premier -d /home/premier node && groupmod -n premier node
WORKDIR /home/premier

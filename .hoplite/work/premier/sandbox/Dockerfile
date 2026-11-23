# Образ для выполнения Python-кода моделью. Сборка (один раз, из папки проекта):
#   docker build -t premier-python sandbox
# Версии закреплены (OPS-20): базовый образ — по sha256, пакеты Python — точные версии в python.requirements.txt.
# Обновление — осознанное: docker pull python:3.12-slim, взять новый sha256 из
#   docker image inspect python:3.12-slim --format '{{index .RepoDigests 0}}'
# поправить версии в python.requirements.txt, пересобрать и прогнать scripts/cloud-check.sh.
FROM python@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY python.requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --no-deps -r /tmp/requirements.txt && pip check && rm /tmp/requirements.txt
RUN python -c "import matplotlib.pyplot"
WORKDIR /work

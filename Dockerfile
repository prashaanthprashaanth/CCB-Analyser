FROM python:3.14-slim

LABEL org.opencontainers.image.title="CCB Fault Analyser" \
      org.opencontainers.image.description="Shared LAN CCB Event Log analyser"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Kolkata

RUN groupadd --gid 10001 ccb \
    && useradd --uid 10001 --gid ccb --no-create-home --shell /usr/sbin/nologin ccb \
    && mkdir -p /app/DATABASE_FOR_APPROVAL /data \
    && chown -R ccb:ccb /app /data

WORKDIR /app

COPY --chown=ccb:ccb server.py index.html styles.css parser.js database.js app.js ./
COPY --chown=ccb:ccb DATABASE_FOR_APPROVAL/import_ccb_to_sqlite.py ./DATABASE_FOR_APPROVAL/

# An empty named volume receives this existing database on first deployment.
# Later image rebuilds retain the volume's expanded database.
COPY --chown=ccb:ccb ccb_fleet.sqlite /data/ccb_fleet.sqlite

USER ccb

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=3).read()"]

CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8080", "--database", "/data/ccb_fleet.sqlite"]

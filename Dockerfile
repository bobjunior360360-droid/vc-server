FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://github.com/storytold/vectorcraft/releases/download/v0.18.0/vectorcraft-0.18.0-linux-x86_64.deb" -o /tmp/vc.deb \
 && apt-get update && apt-get install -y /tmp/vc.deb \
 && rm -rf /tmp/vc.deb /var/lib/apt/lists/*
RUN mkdir -p /work/out /app
COPY vc-pt-proxy.mjs /app/vc-pt-proxy.mjs
CMD npx -y supergateway \
  --stdio "node /app/vc-pt-proxy.mjs" \
  --outputTransport streamableHttp --port ${PORT:-10000}

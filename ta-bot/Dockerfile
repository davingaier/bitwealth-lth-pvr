FROM denoland/deno:2.9.7

WORKDIR /app
COPY deno.json ./
COPY worker ./worker

# Warm the module cache and type-check at build time so a bad deploy fails here, not at boot.
RUN deno cache worker/main.ts && deno check worker/main.ts

USER deno
EXPOSE 8080
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "worker/main.ts"]

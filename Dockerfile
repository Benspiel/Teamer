# syntax=docker/dockerfile:1
#
# Crew – PocketBase-Image (Backend + statisches Frontend aus pb_public/).
# Lädt eine gepinnte PocketBase-Version und läuft als unprivilegierter User.

ARG ALPINE_VERSION=3.22

# --------------------------------------------------------------- Download
FROM alpine:${ALPINE_VERSION} AS download

ARG PB_VERSION=0.40.5
# Optional: SHA-256 der Release-ZIP (aus checksums.txt des GitHub-Releases).
ARG PB_SHA256=""
ARG TARGETARCH

RUN apk add --no-cache ca-certificates unzip wget

RUN set -eux; \
    arch="${TARGETARCH:-amd64}"; \
    wget -qO /tmp/pb.zip \
      "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${arch}.zip"; \
    if [ -n "${PB_SHA256}" ]; then echo "${PB_SHA256}  /tmp/pb.zip" | sha256sum -c -; fi; \
    unzip -j /tmp/pb.zip pocketbase -d /out; \
    chmod 0755 /out/pocketbase

# ---------------------------------------------------------------- Runtime
FROM alpine:${ALPINE_VERSION}

# Alpine bringt CA-Zertifikate und BusyBox-wget (Healthcheck) bereits mit.
RUN addgroup -S -g 10001 pocketbase \
 && adduser -S -D -H -u 10001 -G pocketbase -s /sbin/nologin pocketbase \
 && mkdir -p /pb/pb_data \
 && chown pocketbase:pocketbase /pb/pb_data

WORKDIR /pb

COPY --from=download /out/pocketbase /usr/local/bin/pocketbase
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY pb_migrations ./pb_migrations
COPY pb_hooks ./pb_hooks
COPY pb_public ./pb_public

USER pocketbase

EXPOSE 8090
VOLUME ["/pb/pb_data"]

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8090/api/health >/dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["serve", "--http=0.0.0.0:8090"]

# Public HTTPS entrypoint

`docker-compose.yml` binds every host port to `127.0.0.1`. For a public deployment,
use `docker-compose.production.yml` to expose only Nginx on ports 80 and 443.

1. Point `PUBLIC_HOST` at the server and set it in the environment or `.env`.
2. Place the certificate chain at `ops/tls/fullchain.pem` and its private key at
   `ops/tls/privkey.pem`. These files are ignored by Git. Keep private key access
   limited to the operator and the Nginx container.
3. Run `docker compose -f docker-compose.yml -f docker-compose.production.yml config`
   and then `docker compose -f docker-compose.yml -f docker-compose.production.yml up -d`.
4. From a machine outside the trusted network, verify HTTP redirects to HTTPS,
   the certificate is valid, `/internal/call/notify` and
   `/internal/videos/webhook` return 404 through Nginx, and ports 3000, 5173,
   5432, 6379, 8080, 9000 and 9001 cannot be reached directly.

The proxy forwards only public API paths, the two WebSocket paths, and signed
MinIO object requests under `/${MINIO_BUCKET}/`. Production sets
`MINIO_PUBLIC_ENDPOINT=https://${PUBLIC_HOST}` for URL signing while backend
storage operations continue over the Docker network. Preserve the original
Host header and path for these signed requests.

Frontend
production defaults to its own HTTPS/WSS origin. Set `VITE_API_BASE_URL` and
`VITE_WS_BASE_URL` only when the public entrypoint differs; both must use secure
schemes. The internal call notify and MinIO webhook continue to use their
shared secrets on the Docker network. Keep external firewall rules limited to
80 and 443.

This configuration does not provision a certificate or prove the firewall and
DNS topology. Verify those in the actual deployment before public release.

# Deployment guide — Ubuntu 24.04 LTS

Production deployment for **TradeitX Platform** (Next.js 15 + Fastify + Socket.io + PostgreSQL) behind Nginx with
Let's Encrypt SSL, managed by PM2.

Assumed hostname: `tradeitx.example.com` — replace everywhere.

---

## 0. Prerequisites

| Item | Value |
|---|---|
| VPS | 2 vCPU / 4 GB RAM / 40 GB SSD (Hetzner CX22, DigitalOcean, Vultr…) |
| OS | Ubuntu 24.04 LTS |
| Domain | A record `tradeitx.example.com` → VPS IPv4, AAAA if IPv6 |
| Ports | 22, 80, 443 only |

```bash
ssh root@YOUR_SERVER_IP
```

---

## 1. Base system

```bash
apt update && apt upgrade -y
apt install -y curl git ufw fail2ban unzip build-essential

# non-root deploy user
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

# firewall
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# time sync
timedatectl set-timezone UTC
```

Harden SSH (`/etc/ssh/sshd_config`): `PermitRootLogin no`, `PasswordAuthentication no`, then `systemctl restart ssh`.

```bash
su - deploy
```

---

## 2. Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v    # v20.x
npm -v
sudo npm i -g pm2
```

---

## 3. PostgreSQL 16

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql

sudo -u postgres psql <<'SQL'
CREATE USER tradeitx WITH PASSWORD 'CHANGE_ME_STRONG';
CREATE DATABASE tradeitx OWNER tradeitx;
GRANT ALL PRIVILEGES ON DATABASE tradeitx TO tradeitx;
SQL
```

Verify:

```bash
psql "postgresql://tradeitx:CHANGE_ME_STRONG@127.0.0.1:5432/tradeitx" -c "select version();"
```

Harden `pg_hba.conf` so only localhost uses `scram-sha-256` (default on 24.04), and keep PostgreSQL listening on
`127.0.0.1` only (`listen_addresses = 'localhost'`).

---

## 4. Redis

Redis is used for rate-limit counters and (optionally) the Socket.io adapter when you run more than one API instance.

```bash
sudo apt install -y redis-server
sudo sed -i 's/^# requirepass .*/requirepass CHANGE_ME_REDIS/' /etc/redis/redis.conf
sudo sed -i 's/^bind .*/bind 127.0.0.1 ::1/' /etc/redis/redis.conf
sudo systemctl enable --now redis-server

redis-cli -a CHANGE_ME_REDIS ping   # PONG
```

> The single-instance deployment below runs without Redis. To scale API workers horizontally, install
> `@socket.io/redis-adapter` + `redis`, attach the adapter in `server/realtime.ts`, and set `instances: 2+` in PM2.
> Sticky sessions are not required for websocket-only transport, but keep `transports: ['websocket','polling']`
> behind an Nginx `ip_hash` upstream if you enable polling across replicas.

---

## 5. Application

```bash
sudo mkdir -p /var/www /var/log/tradeitx
sudo chown -R deploy:deploy /var/www /var/log/tradeitx

cd /var/www
git clone https://github.com/ashyamctommy-eng/TradeitX-clone.git tradeitx
cd tradeitx
npm ci
```

### 5.1 Switch Prisma to PostgreSQL

```bash
sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
```

### 5.2 Environment

```bash
cp .env.example .env
nano .env
```

```ini
DATABASE_URL="postgresql://tradeitx:CHANGE_ME_STRONG@127.0.0.1:5432/tradeitx?schema=public"
JWT_SECRET="<openssl rand -hex 32>"
API_PORT=4000
API_URL="http://127.0.0.1:4000"
PUBLIC_URL="https://tradeitx.example.com"
ENABLE_LIVE_PAYMENTS=false        # flip to true only when licensed + KYC live
PALPLUSS_API_KEY=""
PALPLUSS_ENV="live"
NOWPAYMENTS_API_KEY=""
NOWPAYMENTS_IPN_SECRET=""
TELEGRAM_BOT_TOKEN=""
TELEGRAM_ADMIN_CHAT_ID=""
NODE_ENV=production
```

`chmod 600 .env`.

### 5.3 Schema + seed + build

```bash
npx prisma generate
npx prisma db push          # first deploy; use `prisma migrate deploy` once you keep migrations in git
npm run db:seed
npm run build
```

> For repeatable production migrations, run `npx prisma migrate dev --name init` locally, commit `prisma/migrations/`,
> and use `npx prisma migrate deploy` on the server instead of `db push`.

---

## 6. PM2

`ecosystem.config.js` is in the repo root (API on :4000, web on :3000).

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u deploy --hp /home/deploy   # run the printed command with sudo
pm2 status
pm2 logs tradeitx-api --lines 50
```

Health checks:

```bash
curl -s localhost:4000/api/health
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/dashboard
```

---

## 7. Nginx reverse proxy

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/tradeitx
```

```nginx
upstream tradeitx_web { server 127.0.0.1:3000; keepalive 32; }
upstream tradeitx_api { server 127.0.0.1:4000; keepalive 32; }

server {
    listen 80;
    listen [::]:80;
    server_name tradeitx.example.com;

    client_max_body_size 10m;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript image/svg+xml;

    # Socket.io (prices, trades, support, ai:telemetry)
    location /socket.io/ {
        proxy_pass http://tradeitx_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Payment webhooks hit Fastify directly
    location /api/webhooks/ {
        proxy_pass http://tradeitx_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Everything else (Next rewrites /api/* to Fastify)
    location / {
        proxy_pass http://tradeitx_web;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # long-lived static assets
    location /_next/static/ {
        proxy_pass http://tradeitx_web;
        proxy_cache_valid 200 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/tradeitx /etc/nginx/sites-enabled/tradeitx
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## 8. SSL (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tradeitx.example.com --agree-tos -m ops@example.com --redirect
sudo certbot renew --dry-run
```

Certbot installs a systemd timer; verify with `systemctl list-timers | grep certbot`.

Then set `PUBLIC_URL=https://tradeitx.example.com` and `pm2 restart tradeitx-api --update-env`.

---

## 9. Webhooks

Point both providers at the public host:

| Provider | URL |
|---|---|
| PalPluss STK | `https://tradeitx.example.com/api/webhooks/palpluss/stk` |
| PalPluss B2C | `https://tradeitx.example.com/api/webhooks/palpluss/b2c` |
| NOWPayments IPN | `https://tradeitx.example.com/api/webhooks/nowpayments` |

Or configure PalPluss from **`/brabicana → Gateways`** — the panel shows the exact URLs and stores the key, environment,
rates and default channel. The app builds `callbackUrl` from `PUBLIC_URL`, so keep it correct.

> PalPluss callbacks must be public HTTPS; `localhost` and RFC1918 addresses are rejected by their retry queue.

---

## 10. Backups

```bash
sudo mkdir -p /var/backups/tradeitx
sudo tee /usr/local/bin/tradeitx-backup >/dev/null <<'SH'
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%F-%H%M)
export PGPASSWORD="CHANGE_ME_STRONG"
pg_dump -h 127.0.0.1 -U tradeitx -Fc tradeitx > "/var/backups/tradeitx/tradeitx-$STAMP.dump"
find /var/backups/tradeitx -name '*.dump' -mtime +14 -delete
SH
sudo chmod +x /usr/local/bin/tradeitx-backup
sudo crontab -l 2>/dev/null | { cat; echo "15 2 * * * /usr/local/bin/tradeitx-backup"; } | sudo crontab -
```

Restore: `pg_restore -h 127.0.0.1 -U tradeitx -d tradeitx --clean --if-exists file.dump`.

---

## 11. Operations

```bash
# deploy a new commit
cd /var/www/tradeitx && git pull && npm ci && npx prisma migrate deploy && npm run build && pm2 reload all

# logs
pm2 logs --lines 100
sudo tail -f /var/log/nginx/error.log

# restart API only (after engine/env changes)
pm2 restart tradeitx-api --update-env

# rollback
git checkout <previous-tag> && npm ci && npm run build && pm2 reload all
```

Monitoring: `pm2 monit`, `htop`, `df -h`. Add uptime checks against `/api/health` (200) and `/dashboard` (200).

---

## 12. Go-live checklist

- [ ] `JWT_SECRET` rotated, `.env` chmod 600, seeds changed (**do not** ship default passwords)
- [ ] `ENABLE_LIVE_PAYMENTS=false` until licensing, KYC and a PSP contract are in place
- [ ] PalPluss key saved in `/brabicana → Gateways`, connection test green, service wallet funded
- [ ] At least one payment channel created and set as default (`NO_DEFAULT_CHANNEL` otherwise)
- [ ] B2C KYC approved with PalPluss before enabling withdrawals
- [ ] NOWPayments IPN secret set; webhook test returns 401 on a bad signature and 200 on a valid one
- [ ] `PUBLIC_URL` is the public HTTPS origin
- [ ] Backups verified by restoring into a scratch database
- [ ] TLS renewal dry-run passes
- [ ] `npm run audit` passes against the production host

---

## 13. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `NO_DEFAULT_CHANNEL` on STK | No default channel — set one in Gateways or pass `channelId` |
| `402 INSUFFICIENT_SERVICE_BALANCE` | Top up the PalPluss service wallet (fees are charged at initiation) |
| Sockets disconnect every ~60 s | Nginx `/socket.io/` missing `Upgrade`/`Connection` headers or a short `proxy_read_timeout` |
| `P1001` from Prisma | PostgreSQL not running / wrong `DATABASE_URL` / `pg_hba.conf` auth |
| 502 from Nginx | PM2 process down — `pm2 status`, `pm2 logs` |
| Webhook retries then gives up | Handler must return 2xx within 30 s; check Nginx access logs and `PUBLIC_URL` |
| Cookies not set behind proxy | Ensure `X-Forwarded-Proto` is passed and the site is served over HTTPS |

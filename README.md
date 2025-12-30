# Cloudflare DDNS

A private Dynamic DNS service using Cloudflare Workers and a lightweight client with Web UI.

![License](https://img.shields.io/github/license/allecsro/cloudflare-ddns)

## Overview

This project provides a complete DDNS solution:

1. **Cloudflare Worker** - Receives update requests and modifies DNS records via Cloudflare API
2. **DDNS Client** - Runs on your home server, detects IP changes, and notifies the worker

```
┌─────────────────────┐      ┌───────────────────┐      ┌──────────────┐
│   Home Server       │      │  Cloudflare       │      │  Cloudflare  │
│   (DDNS Client)     │─────▶│  Worker           │─────▶│  DNS         │
│   - IP Detection    │ HTTPS│  - Auth           │ API  │  - A Record  │
│   - Web UI :8080    │      │  - DNS Update     │      │  - AAAA      │
└─────────────────────┘      └───────────────────┘      └──────────────┘
```

## Features

- **Multi-provider IP detection** - Uses ipify, Cloudflare, icanhazip, and more
- **IPv4 and IPv6 support** - Update A and AAAA records
- **Web UI Dashboard** - Monitor records, history, and trigger manual updates
- **Lightweight** - Small Docker image, minimal resource usage
- **Secure** - Pre-shared secret authentication, HTTPS only
- **Persistent state** - Survives container restarts

## Quick Start

### 1. Deploy the Cloudflare Worker

```bash
# Install Wrangler CLI
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Configure secrets
wrangler secret put PRESHARED_SECRET
wrangler secret put API_TOKEN

# Deploy
wrangler deploy
```

### 2. Run the DDNS Client

```bash
docker run -d \
  --name cloudflare-ddns \
  -p 8080:8080 \
  -e WORKER_URL=https://your-worker.workers.dev/dyndns/update \
  -e PRESHARED_SECRET=your-secret \
  -e HOSTNAMES=home.example.com \
  -v ddns-data:/data \
  ghcr.io/allecsro/cloudflare-ddns-client:latest
```

### 3. Access Web UI

Open `http://your-server:8080` to view the dashboard.

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WORKER_URL` | Yes | - | Full URL to your Cloudflare Worker |
| `PRESHARED_SECRET` | Yes | - | Secret code for authentication (min 16 chars) |
| `HOSTNAMES` | Yes | - | Comma-separated list of hostnames to update |
| `CHECK_INTERVAL` | No | `300` | IP check interval in seconds |
| `IP_VERSION` | No | `4` | IP version: `4`, `6`, or `both` |
| `IP_PROVIDERS` | No | `all` | Comma-separated: `ipify,cloudflare,icanhazip,ifconfig,ipinfo,seeip` |
| `SERVER_PORT` | No | `8080` | Web UI port |
| `LOG_LEVEL` | No | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `DATA_DIR` | No | `/data` | Directory for persistent state |

### Docker Compose

```yaml
version: '3.8'

services:
  ddns-client:
    image: ghcr.io/allecsro/cloudflare-ddns-client:latest
    container_name: cloudflare-ddns
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - WORKER_URL=https://your-worker.workers.dev/dyndns/update
      - PRESHARED_SECRET=your-secret-minimum-16-chars
      - HOSTNAMES=home.example.com,server.example.com
      - CHECK_INTERVAL=300
      - IP_VERSION=4
    volumes:
      - ddns-data:/data

volumes:
  ddns-data:
```

## TrueNAS Scale Deployment

See [docs/GHCR_SETUP.md](docs/GHCR_SETUP.md) for detailed instructions on:

1. Setting up GitHub Container Registry (private)
2. Configuring TrueNAS to pull from GHCR
3. Deploying as a Custom App

## API Endpoints

### Client API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Get overall status and all records |
| `/api/records` | GET | Get all DNS records |
| `/api/records/:hostname` | GET | Get specific record details |
| `/api/update` | POST | Trigger manual IP check and update |
| `/api/health` | GET | Health check endpoint |

### Worker API

| Endpoint | Method | Parameters |
|----------|--------|------------|
| `/dyndns/update` | GET | `code`, `hostname`, `myip` (optional), `myipv6` (optional) |

## Development

### Prerequisites

- Node.js 20+
- Docker (optional)

### Build Client

```bash
cd client
npm install
npm run build
npm start
```

### Build Docker Image

```bash
cd client
docker build -t cloudflare-ddns-client .
docker run -p 8080:8080 \
  -e WORKER_URL=... \
  -e PRESHARED_SECRET=... \
  -e HOSTNAMES=... \
  cloudflare-ddns-client
```

### Build Multi-Architecture Image

If you're building on Apple Silicon (M1/M2/M3) and deploying to an x86 server (like TrueNAS), you need to build a multi-architecture image:

```bash
# Set up buildx builder (one-time)
docker buildx create --name multiarch --use

# Build and push for both amd64 and arm64
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/YOUR_USERNAME/cloudflare-ddns-client:latest \
  --push \
  ./client
```

> **Note:** The `--push` flag is required because multi-arch builds can't be loaded locally. The image is pushed directly to the registry.

## Project Structure

```
cloudflare-ddns/
├── worker.js                 # Cloudflare Worker
├── client/                   # DDNS Client
│   ├── src/
│   │   ├── index.ts         # Main entry point
│   │   ├── config/          # Configuration management
│   │   ├── ip-fetcher/      # IP detection providers
│   │   ├── notifier/        # Worker notification
│   │   ├── persistence/     # State persistence
│   │   └── server/          # Web UI and API
│   ├── Dockerfile
│   └── docker-compose.yml
├── docs/
│   └── GHCR_SETUP.md        # GHCR setup guide
└── .github/
    └── workflows/
        └── docker-publish.yml
```

## License

MIT

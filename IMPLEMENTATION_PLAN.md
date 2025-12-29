# Cloudflare Dynamic DNS Service - Implementation Plan

## Overview

This plan outlines the implementation of a private dynamic DNS service that:
1. **Home Server Client**: Detects public IP changes and sends updates
2. **Cloudflare Worker**: Receives updates and modifies DNS records via Cloudflare API

## Current State Analysis

### Existing Implementation (`worker.js`)

Your current Cloudflare Worker already provides:
- Endpoint: `/dyndns/update` with query parameters
- Pre-shared secret authentication (`code` parameter)
- Automatic IP detection via `CF-Connecting-IP` header
- DNS record lookup and update via Cloudflare API
- IPv4 validation

### Gaps Identified (compared to ddns-updater)

| Feature | Current | ddns-updater | Priority |
|---------|---------|--------------|----------|
| IPv6 support | No | Yes | High |
| Record creation | No (requires pre-existing record) | Yes | Medium |
| Proxied toggle | No | Yes | Medium |
| TTL configuration | No | Yes | Low |
| Multiple hostnames | No | Yes | Medium |
| Notifications | No | Yes (Shoutrrr) | Low |
| IP change detection | N/A (server-side) | Client-side | High |
| Update history/logging | No | Yes | Medium |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        HOME SERVER                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    DDNS Client                               ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   ││
│  │  │ IP Fetcher   │──│ Change       │──│ Worker Notifier  │   ││
│  │  │ (multi-src)  │  │ Detector     │  │ (HTTP client)    │   ││
│  │  └──────────────┘  └──────────────┘  └──────────────────┘   ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS (with pre-shared secret)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE WORKER                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Auth         │──│ Request      │──│ Cloudflare API       │   │
│  │ Middleware   │  │ Handler      │  │ Client               │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Cloudflare API
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE DNS                                │
│                    (A/AAAA Records)                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Enhance Cloudflare Worker

#### 1.1 Add IPv6 Support
**File**: `worker.js`

- Add IPv6 regex validation alongside IPv4
- Support both A (IPv4) and AAAA (IPv6) record types
- Accept `ipv6` query parameter for explicit IPv6 updates

```javascript
// IPv6 validation regex
const IPV6_REGEX = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^(([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4})?::(([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4})?$/
```

#### 1.2 Add Record Creation Capability
**File**: `worker.js`

- If DNS record doesn't exist, create it (POST to `/zones/{zoneId}/dns_records`)
- Add `create` query parameter to control auto-creation behavior
- Default to update-only for backwards compatibility

#### 1.3 Add Proxied Toggle Support
**File**: `worker.js`

- Add `proxied` query parameter (boolean)
- Preserve existing proxied state if not specified
- Include in both create and update operations

#### 1.4 Improve Error Handling and Responses
**File**: `worker.js`

- Return JSON responses with structured error details
- Add response headers for debugging (e.g., `X-Previous-IP`, `X-New-IP`)
- Implement proper HTTP status codes

#### 1.5 Add Update Logging (Optional - KV Storage)
**File**: `worker.js`

- Store update history in Cloudflare KV
- Track: timestamp, hostname, old IP, new IP, success/failure
- Add endpoint to retrieve update history

---

### Phase 2: Create Home Server Client

#### 2.1 Project Structure

```
client/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           # Main entry point
│   ├── config.ts          # Configuration management
│   ├── ip-fetcher/
│   │   ├── index.ts       # IP fetcher orchestrator
│   │   ├── providers/
│   │   │   ├── ipify.ts
│   │   │   ├── ifconfig.ts
│   │   │   ├── cloudflare.ts
│   │   │   └── index.ts
│   │   └── types.ts
│   ├── change-detector.ts # IP change detection logic
│   ├── notifier.ts        # Worker notification client
│   ├── persistence.ts     # Store last known IP
│   └── logger.ts          # Logging utility
├── Dockerfile
└── docker-compose.yml
```

#### 2.2 IP Fetcher Module
**Purpose**: Detect current public IP using multiple providers

**Providers to implement** (inspired by ddns-updater):
| Provider | IPv4 URL | IPv6 URL |
|----------|----------|----------|
| ipify | `https://api.ipify.org` | `https://api6.ipify.org` |
| ifconfig | `https://ifconfig.io/ip` | `https://ifconfig.io/ip` |
| icanhazip | `https://ipv4.icanhazip.com` | `https://ipv6.icanhazip.com` |
| cloudflare | `https://1.1.1.1/cdn-cgi/trace` | `https://[2606:4700:4700::1111]/cdn-cgi/trace` |

**Features**:
- Round-robin or random provider selection
- Retry logic with exponential backoff
- Provider health tracking (skip failing providers)
- Configurable timeout per provider

#### 2.3 Change Detector Module
**Purpose**: Determine if IP has changed since last check

**Logic**:
```typescript
interface ChangeDetector {
  hasChanged(currentIP: string): Promise<boolean>
  updateStoredIP(ip: string): Promise<void>
  getStoredIP(): Promise<string | null>
}
```

**Storage options**:
- File-based (JSON file in data directory)
- SQLite (for more robust persistence)
- Environment variable (for stateless containers)

#### 2.4 Worker Notifier Module
**Purpose**: Send IP updates to Cloudflare Worker

**Features**:
- Configurable worker URL
- Pre-shared secret authentication
- Support for multiple hostnames
- Retry logic with exponential backoff
- Response validation

#### 2.5 Configuration System

**Environment Variables**:
```bash
# Worker Configuration
WORKER_URL=https://your-worker.workers.dev/dyndns/update
PRESHARED_SECRET=your-secret-code

# Hostnames to update (comma-separated)
HOSTNAMES=home.example.com,server.example.com

# IP Detection
IP_PROVIDERS=ipify,cloudflare,ifconfig
IP_VERSION=4                    # 4, 6, or "both"
CHECK_INTERVAL=300              # seconds (5 minutes)

# Persistence
DATA_DIR=/data
STATE_FILE=ip-state.json

# Logging
LOG_LEVEL=info

# Optional: Notifications (Shoutrrr)
SHOUTRRR_URLS=discord://token@id,telegram://token@telegram
```

**Config File** (alternative to env vars):
```json
{
  "worker": {
    "url": "https://your-worker.workers.dev/dyndns/update",
    "secret": "your-secret-code"
  },
  "hostnames": ["home.example.com"],
  "ipProviders": ["ipify", "cloudflare"],
  "checkInterval": 300,
  "ipVersion": "4"
}
```

#### 2.6 Main Loop

```typescript
async function main() {
  const config = loadConfig()
  const ipFetcher = new IPFetcher(config.ipProviders)
  const changeDetector = new ChangeDetector(config.dataDir)
  const notifier = new WorkerNotifier(config.worker)

  while (true) {
    try {
      const currentIP = await ipFetcher.fetch(config.ipVersion)

      if (await changeDetector.hasChanged(currentIP)) {
        logger.info(`IP changed to ${currentIP}`)

        for (const hostname of config.hostnames) {
          await notifier.update(hostname, currentIP)
          logger.info(`Updated ${hostname} to ${currentIP}`)
        }

        await changeDetector.updateStoredIP(currentIP)
      }
    } catch (error) {
      logger.error('Update failed', error)
    }

    await sleep(config.checkInterval * 1000)
  }
}
```

---

### Phase 3: Dockerization

#### 3.1 Client Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/

VOLUME /data
ENV DATA_DIR=/data

CMD ["node", "dist/index.js"]
```

#### 3.2 Docker Compose

```yaml
version: '3.8'
services:
  ddns-client:
    build: ./client
    restart: unless-stopped
    environment:
      - WORKER_URL=${WORKER_URL}
      - PRESHARED_SECRET=${PRESHARED_SECRET}
      - HOSTNAMES=${HOSTNAMES}
      - CHECK_INTERVAL=300
    volumes:
      - ddns-data:/data

volumes:
  ddns-data:
```

---

### Phase 4: Optional Enhancements

#### 4.1 Notifications (Shoutrrr Integration)

Add notification support for:
- IP change events
- Update failures
- Service start/stop

**Shoutrrr services**:
- Discord
- Telegram
- Slack
- Email (SMTP)
- Pushover
- Generic webhooks

#### 4.2 Web UI Dashboard

Simple status page showing:
- Current IP address
- Last update time
- Update history
- Health status of IP providers

#### 4.3 Health Check Endpoint

Add `/health` endpoint to worker for monitoring:
```json
{
  "status": "healthy",
  "lastUpdate": "2025-01-15T10:30:00Z",
  "recordCount": 2
}
```

---

## File Structure (Final)

```
cloudflare-ddns/
├── worker/                      # Cloudflare Worker
│   ├── src/
│   │   ├── index.ts            # Main worker entry
│   │   ├── handlers/
│   │   │   ├── update.ts       # DNS update handler
│   │   │   └── health.ts       # Health check handler
│   │   ├── cloudflare-api.ts   # Cloudflare API client
│   │   ├── auth.ts             # Authentication middleware
│   │   ├── validators.ts       # IP validation
│   │   └── types.ts
│   ├── wrangler.toml
│   └── package.json
│
├── client/                      # Home server client
│   ├── src/
│   │   ├── index.ts
│   │   ├── config.ts
│   │   ├── ip-fetcher/
│   │   ├── change-detector.ts
│   │   ├── notifier.ts
│   │   └── logger.ts
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── package.json
│
├── README.md
└── .github/
    └── workflows/
        └── deploy.yml          # CI/CD for worker deployment
```

---

## Implementation Order

### Step 1: Worker Improvements (worker.js → TypeScript)
1. Convert to TypeScript with Wrangler
2. Add IPv6 validation and support
3. Add record creation capability
4. Add proxied toggle support
5. Improve error responses (JSON format)
6. Add health endpoint
7. Deploy and test

### Step 2: Client Core
1. Set up TypeScript project
2. Implement IP fetcher with multiple providers
3. Implement change detector with file persistence
4. Implement worker notifier
5. Create main loop with scheduling
6. Add configuration system

### Step 3: Client Packaging
1. Create Dockerfile
2. Create docker-compose.yml
3. Test containerized deployment

### Step 4: Polish & Optional Features
1. Add comprehensive logging
2. Add Shoutrrr notifications (optional)
3. Add health check endpoint
4. Write documentation
5. Create GitHub Actions for CI/CD

---

## API Reference

### Worker Endpoints

#### POST/GET `/dyndns/update`

Update DNS record with new IP address.

**Query Parameters**:
| Parameter | Required | Description |
|-----------|----------|-------------|
| `code` | Yes | Pre-shared authentication secret |
| `hostname` | Yes | FQDN to update (e.g., `home.example.com`) |
| `myip` | No | IP address (auto-detected from `CF-Connecting-IP` if omitted) |
| `myipv6` | No | IPv6 address for AAAA record |
| `proxied` | No | Enable Cloudflare proxy (`true`/`false`) |
| `create` | No | Create record if not exists (`true`/`false`) |
| `ttl` | No | TTL in seconds (default: 1 = auto) |

**Response**:
```json
{
  "success": true,
  "hostname": "home.example.com",
  "previousIP": "1.2.3.4",
  "newIP": "5.6.7.8",
  "recordType": "A",
  "message": "DNS record updated successfully"
}
```

#### GET `/health`

Health check endpoint.

**Response**:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

---

## Security Considerations

1. **Pre-shared Secret**: Use a strong, randomly generated secret (32+ characters)
2. **HTTPS Only**: Worker automatically uses HTTPS
3. **API Token Scope**: Use minimal permissions (Zone:DNS:Edit for specific zones)
4. **Rate Limiting**: Consider adding rate limiting to prevent abuse
5. **IP Validation**: Validate IPs to prevent injection attacks
6. **Logging**: Don't log sensitive data (secrets, full API tokens)

---

## Testing Checklist

- [ ] Worker accepts valid update requests
- [ ] Worker rejects invalid authentication
- [ ] Worker handles missing parameters gracefully
- [ ] Worker creates new records when enabled
- [ ] Worker updates existing records
- [ ] Client detects IP changes correctly
- [ ] Client handles provider failures gracefully
- [ ] Client persists state across restarts
- [ ] Docker container runs correctly
- [ ] End-to-end: IP change → Client detection → Worker update → DNS updated

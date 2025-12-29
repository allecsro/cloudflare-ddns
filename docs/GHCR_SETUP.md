# GitHub Container Registry (GHCR) Setup Guide

This guide covers setting up a private container registry using GitHub Container Registry (GHCR) for your Cloudflare DDNS client.

## Overview

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  Your Machine   │      │     GitHub      │      │  TrueNAS Scale  │
│                 │      │                 │      │                 │
│  docker build   │─────▶│  ghcr.io/user/  │◀─────│  docker pull    │
│  docker push    │      │  ddns-client    │      │  (Custom App)   │
└─────────────────┘      └─────────────────┘      └─────────────────┘
        │                        ▲
        │    OR via CI/CD        │
        │                        │
        └────────────────────────┘
          GitHub Actions
          (automatic builds)
```

---

## Step 1: Create a Personal Access Token (PAT)

GHCR requires a **Personal Access Token (classic)** - fine-grained tokens are not supported.

### 1.1 Navigate to Token Settings

1. Go to [GitHub.com](https://github.com) → Click your profile picture → **Settings**
2. Scroll down to **Developer settings** (bottom of left sidebar)
3. Click **Personal access tokens** → **Tokens (classic)**
4. Click **Generate new token** → **Generate new token (classic)**

### 1.2 Configure Token Permissions

| Setting | Value |
|---------|-------|
| **Note** | `GHCR TrueNAS Access` (or any descriptive name) |
| **Expiration** | Choose based on your needs (90 days, 1 year, or no expiration) |

**Required Scopes:**

| Scope | Purpose |
|-------|---------|
| ☑️ `write:packages` | Push images to GHCR |
| ☑️ `read:packages` | Pull images from GHCR |
| ☑️ `delete:packages` | Delete old image versions (optional) |
| ☑️ `repo` | Access private repositories (if your code is private) |

### 1.3 Save Your Token

1. Click **Generate token**
2. **Copy the token immediately** - you won't see it again!
3. Store it securely (password manager recommended)

```bash
# Save as environment variable (add to ~/.bashrc or ~/.zshrc)
export GHCR_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

---

## Step 2: Login to GHCR

### On Your Development Machine

```bash
# Method 1: Using environment variable
echo $GHCR_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# Method 2: Interactive (paste token when prompted)
docker login ghcr.io -u YOUR_GITHUB_USERNAME

# Expected output:
# Login Succeeded
```

### Verify Login

```bash
# Check Docker config
cat ~/.docker/config.json | grep ghcr
# Should show: "ghcr.io": { ... }
```

---

## Step 3: Build and Push Images (Manual)

### 3.1 Build the Image

```bash
cd /path/to/cloudflare-ddns/client

# Build with proper naming for GHCR
docker build -t ghcr.io/YOUR_GITHUB_USERNAME/cloudflare-ddns-client:latest .

# Build with version tag
docker build -t ghcr.io/YOUR_GITHUB_USERNAME/cloudflare-ddns-client:1.0.0 .
```

### 3.2 Add Labels for Repository Linking (Recommended)

Add these labels to your Dockerfile to link the image to your repository:

```dockerfile
LABEL org.opencontainers.image.source="https://github.com/YOUR_GITHUB_USERNAME/cloudflare-ddns"
LABEL org.opencontainers.image.description="Cloudflare DDNS Client"
LABEL org.opencontainers.image.licenses="MIT"
```

### 3.3 Push to GHCR

```bash
# Push latest
docker push ghcr.io/YOUR_GITHUB_USERNAME/cloudflare-ddns-client:latest

# Push specific version
docker push ghcr.io/YOUR_GITHUB_USERNAME/cloudflare-ddns-client:1.0.0
```

### 3.4 Verify Upload

1. Go to your GitHub profile → **Packages** tab
2. You should see `cloudflare-ddns-client` listed
3. Click on it to see available tags and pull commands

---

## Step 4: Set Up GitHub Actions (Automated Builds)

Create `.github/workflows/docker-publish.yml` in your repository:

```yaml
name: Build and Push Docker Image

on:
  push:
    branches:
      - main
    paths:
      - 'client/**'
      - '.github/workflows/docker-publish.yml'
  release:
    types: [published]
  workflow_dispatch:  # Allow manual triggers

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository_owner }}/cloudflare-ddns-client

jobs:
  build-and-push:
    runs-on: ubuntu-latest

    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata (tags, labels)
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,prefix=
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: ./client
          file: ./client/Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          platforms: linux/amd64,linux/arm64
```

### How It Works

| Trigger | Tags Created |
|---------|--------------|
| Push to `main` | `latest`, `main`, `<sha>` |
| Release `v1.2.3` | `1.2.3`, `1.2`, `latest` |
| Manual dispatch | `latest`, `<branch>`, `<sha>` |

### Enable GitHub Actions

1. Go to your repository → **Settings** → **Actions** → **General**
2. Under "Workflow permissions", select **Read and write permissions**
3. Check **Allow GitHub Actions to create and approve pull requests**
4. Click **Save**

---

## Step 5: Configure Package Visibility

By default, new packages are **private**. To keep it private but allow TrueNAS access:

### 5.1 Navigate to Package Settings

1. Go to your GitHub profile → **Packages**
2. Click on `cloudflare-ddns-client`
3. Click **Package settings** (right sidebar)

### 5.2 Configure Access

**For Private Package (Recommended):**
- Keep visibility as **Private**
- Under "Manage Actions access", add your repository if using GitHub Actions

**For Public Package:**
- Click **Change visibility** → **Public**
- Anyone can pull without authentication

---

## Step 6: Configure TrueNAS Scale

### 6.1 Add GHCR Registry Credentials

1. Go to **Apps** → **Settings** (gear icon)
2. Click **Manage Docker Registries**
3. Click **Add Registry**

| Field | Value |
|-------|-------|
| **Name** | `GitHub Container Registry` |
| **URI** | Select **Other Registry** |
| **Registry URI** | `ghcr.io` |
| **Username** | Your GitHub username |
| **Password** | Your Personal Access Token (from Step 1) |

4. Click **Save**

### 6.2 Verify Registry Connection

```bash
# SSH into TrueNAS and test
ssh root@truenas

# Test pull (should work without errors)
docker pull ghcr.io/YOUR_GITHUB_USERNAME/cloudflare-ddns-client:latest
```

---

## Step 7: Deploy as Custom App on TrueNAS

### 7.1 Using the Custom App Wizard

1. Go to **Apps** → **Discover Apps** → **Custom App**
2. Configure:

| Setting | Value |
|---------|-------|
| **Application Name** | `cloudflare-ddns-client` |
| **Image Repository** | `ghcr.io/YOUR_GITHUB_USERNAME/cloudflare-ddns-client` |
| **Image Tag** | `latest` |
| **Pull Policy** | `Always` (to get updates) |

### 7.2 Environment Variables

Click **Add** for each variable:

| Name | Value |
|------|-------|
| `WORKER_URL` | `https://your-worker.your-subdomain.workers.dev/dyndns/update` |
| `PRESHARED_SECRET` | `your-secret-code` |
| `HOSTNAMES` | `home.example.com,server.example.com` |
| `CHECK_INTERVAL` | `300` |
| `LOG_LEVEL` | `info` |

### 7.3 Storage Configuration

| Type | Host Path | Mount Path |
|------|-----------|------------|
| Host Path | `/mnt/pool/apps/ddns-client` | `/data` |

### 7.4 Deploy

1. Review all settings
2. Click **Install**
3. Wait for the app to start

---

## Step 8: Verify Deployment

### Check App Status

1. Go to **Apps** → **Installed Apps**
2. Click on `cloudflare-ddns-client`
3. Check the status shows **Running**

### View Logs

```bash
# SSH into TrueNAS
ssh root@truenas

# Find container ID
docker ps | grep ddns

# View logs
docker logs -f <container_id>
```

Expected output:
```
[INFO] Starting DDNS client...
[INFO] Current IP: 203.0.113.42
[INFO] Checking for IP changes every 300 seconds
```

---

## Updating the Image

### Manual Update

```bash
# On your dev machine
docker build -t ghcr.io/YOUR_GITHUB_USERNAME/cloudflare-ddns-client:latest ./client
docker push ghcr.io/YOUR_GITHUB_USERNAME/cloudflare-ddns-client:latest
```

Then on TrueNAS:
1. Go to **Apps** → **Installed Apps**
2. Click on `cloudflare-ddns-client`
3. Click **Update** or restart the app

### Automatic Updates with GitHub Actions

Just push to `main` or create a release - GitHub Actions will build and push automatically.

---

## Troubleshooting

### "unauthorized: authentication required"

**Cause:** Invalid or expired PAT, or wrong username

**Fix:**
```bash
# Re-login
docker logout ghcr.io
docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

On TrueNAS: Update the registry credentials in Apps → Settings → Manage Docker Registries

### "manifest unknown"

**Cause:** Image tag doesn't exist

**Fix:**
```bash
# List available tags
curl -s -H "Authorization: Bearer $GHCR_TOKEN" \
  https://ghcr.io/v2/YOUR_GITHUB_USERNAME/cloudflare-ddns-client/tags/list
```

### "denied: permission denied"

**Cause:** PAT doesn't have required scopes

**Fix:** Generate a new PAT with `write:packages` and `read:packages` scopes

### GitHub Actions fails with "permission denied"

**Cause:** Workflow doesn't have package write permission

**Fix:** Add to your workflow:
```yaml
permissions:
  contents: read
  packages: write
```

---

## Quick Reference

```bash
# Login to GHCR
echo $GHCR_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Build image
docker build -t ghcr.io/USERNAME/cloudflare-ddns-client:latest ./client

# Push image
docker push ghcr.io/USERNAME/cloudflare-ddns-client:latest

# Pull image
docker pull ghcr.io/USERNAME/cloudflare-ddns-client:latest

# List packages (API)
curl -H "Authorization: Bearer $GHCR_TOKEN" \
  https://api.github.com/user/packages?package_type=container

# Delete a package version (API)
curl -X DELETE -H "Authorization: Bearer $GHCR_TOKEN" \
  https://api.github.com/user/packages/container/cloudflare-ddns-client/versions/VERSION_ID
```

---

## Security Best Practices

1. **Use short-lived tokens** - Set expiration to 90 days and rotate regularly
2. **Minimal scopes** - Only grant `read:packages` for TrueNAS if not pushing from there
3. **Keep packages private** - Only make public if you want to share
4. **Use GitHub Actions** - Avoids storing tokens on your dev machine
5. **Separate tokens** - Use different PATs for CI/CD vs personal use

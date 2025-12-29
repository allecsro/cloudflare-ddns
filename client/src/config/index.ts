import type { Config, IPVersion } from '../types.js';

const DEFAULT_IP_PROVIDERS = ['ipify', 'cloudflare', 'icanhazip', 'ifconfig'];

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parseHostnames(value: string): string[] {
  return value
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
}

function parseIPProviders(value: string): string[] {
  if (!value || value.toLowerCase() === 'all') {
    return DEFAULT_IP_PROVIDERS;
  }
  return value
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
}

function parseIPVersion(value: string): IPVersion {
  const normalized = value.trim().toLowerCase();
  if (normalized === '4' || normalized === 'ipv4') return '4';
  if (normalized === '6' || normalized === 'ipv6') return '6';
  if (normalized === 'both' || normalized === 'dual') return 'both';
  return '4';
}

export function loadConfig(): Config {
  return {
    worker: {
      url: getEnvOrThrow('WORKER_URL'),
      secret: getEnvOrThrow('PRESHARED_SECRET'),
    },
    hostnames: parseHostnames(getEnvOrThrow('HOSTNAMES')),
    ipProviders: parseIPProviders(getEnvOrDefault('IP_PROVIDERS', 'all')),
    checkInterval: parseInt(getEnvOrDefault('CHECK_INTERVAL', '300'), 10),
    ipVersion: parseIPVersion(getEnvOrDefault('IP_VERSION', '4')),
    dataDir: getEnvOrDefault('DATA_DIR', '/data'),
    server: {
      port: parseInt(getEnvOrDefault('SERVER_PORT', '8080'), 10),
      host: getEnvOrDefault('SERVER_HOST', '0.0.0.0'),
    },
    logLevel: getEnvOrDefault('LOG_LEVEL', 'info'),
  };
}

export function validateConfig(config: Config): void {
  if (!config.worker.url.startsWith('http')) {
    throw new Error('WORKER_URL must be a valid HTTP(S) URL');
  }

  if (config.worker.secret.length < 16) {
    throw new Error('PRESHARED_SECRET should be at least 16 characters for security');
  }

  if (config.hostnames.length === 0) {
    throw new Error('At least one hostname must be specified');
  }

  if (config.checkInterval < 30) {
    throw new Error('CHECK_INTERVAL must be at least 30 seconds');
  }

  for (const hostname of config.hostnames) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-_.]+[a-zA-Z0-9]$/.test(hostname)) {
      throw new Error(`Invalid hostname format: ${hostname}`);
    }
  }
}

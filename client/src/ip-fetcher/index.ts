import type { IPVersion } from '../types.js';
import { getProvider, type IPProvider } from './providers.js';
import { createLogger } from '../logger.js';

const logger = createLogger('ip-fetcher');

const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const IPV6_REGEX = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$|^(?:[0-9a-fA-F]{1,4}:){0,6}::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}$/;

export interface IPFetcherOptions {
  providers: string[];
  timeout?: number;
  retries?: number;
}

export interface FetchResult {
  ipv4?: string;
  ipv6?: string;
  usedProvider?: string;
}

export class IPFetcher {
  private providers: IPProvider[];
  private timeout: number;
  private retries: number;
  private currentProviderIndex: number = 0;

  constructor(options: IPFetcherOptions) {
    this.providers = options.providers
      .map((name) => getProvider(name))
      .filter((p): p is IPProvider => p !== undefined);

    if (this.providers.length === 0) {
      throw new Error('No valid IP providers configured');
    }

    this.timeout = options.timeout ?? 10000;
    this.retries = options.retries ?? 3;

    logger.info(`Initialized with ${this.providers.length} providers: ${this.providers.map((p) => p.name).join(', ')}`);
  }

  async fetch(version: IPVersion): Promise<FetchResult> {
    const result: FetchResult = {};

    if (version === '4' || version === 'both') {
      result.ipv4 = await this.fetchIPv4();
    }

    if (version === '6' || version === 'both') {
      result.ipv6 = await this.fetchIPv6();
    }

    return result;
  }

  async fetchIPv4(): Promise<string | undefined> {
    return this.fetchWithRetry('4');
  }

  async fetchIPv6(): Promise<string | undefined> {
    return this.fetchWithRetry('6');
  }

  private async fetchWithRetry(version: '4' | '6'): Promise<string | undefined> {
    const startIndex = this.currentProviderIndex;
    let attempts = 0;

    while (attempts < this.providers.length * this.retries) {
      const provider = this.providers[this.currentProviderIndex];
      const url = version === '4' ? provider.ipv4Url : provider.ipv6Url;

      if (!url) {
        this.rotateProvider();
        attempts++;
        continue;
      }

      try {
        const ip = await this.fetchFromProvider(provider, url, version);
        if (ip) {
          logger.debug(`Got IPv${version} ${ip} from ${provider.name}`);
          return ip;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.warn(`Failed to fetch IPv${version} from ${provider.name}: ${message}`);
      }

      this.rotateProvider();
      attempts++;

      // If we've gone through all providers once, add a small delay before retrying
      if (this.currentProviderIndex === startIndex) {
        await this.sleep(1000);
      }
    }

    logger.error(`Failed to fetch IPv${version} after ${attempts} attempts`);
    return undefined;
  }

  private async fetchFromProvider(
    provider: IPProvider,
    url: string,
    version: '4' | '6'
  ): Promise<string | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'cloudflare-ddns-client/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const body = await response.text();
      const ip = provider.parseResponse(body);

      if (!ip) {
        throw new Error('Failed to parse IP from response');
      }

      if (!this.validateIP(ip, version)) {
        throw new Error(`Invalid IPv${version} address: ${ip}`);
      }

      return ip;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private validateIP(ip: string, version: '4' | '6'): boolean {
    if (version === '4') {
      return IPV4_REGEX.test(ip);
    }
    return IPV6_REGEX.test(ip);
  }

  private rotateProvider(): void {
    this.currentProviderIndex = (this.currentProviderIndex + 1) % this.providers.length;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

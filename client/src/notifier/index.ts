import type { WorkerUpdateResult } from '../types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('notifier');

export interface NotifierOptions {
  workerUrl: string;
  secret: string;
  timeout?: number;
}

export class WorkerNotifier {
  private workerUrl: string;
  private secret: string;
  private timeout: number;

  constructor(options: NotifierOptions) {
    this.workerUrl = options.workerUrl;
    this.secret = options.secret;
    this.timeout = options.timeout ?? 30000;
  }

  async update(
    hostname: string,
    ip: string,
    ipVersion: '4' | '6' = '4'
  ): Promise<WorkerUpdateResult> {
    const url = new URL(this.workerUrl);
    url.searchParams.set('code', this.secret);
    url.searchParams.set('hostname', hostname);

    if (ipVersion === '4') {
      url.searchParams.set('myip', ip);
    } else {
      url.searchParams.set('myipv6', ip);
    }

    logger.info(`Updating ${hostname} with IPv${ipVersion} ${ip}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'cloudflare-ddns-client/1.0',
        },
      });

      const text = await response.text();

      if (!response.ok) {
        logger.error(`Worker returned ${response.status}: ${text}`);
        return {
          success: false,
          hostname,
          newIP: ip,
          errorMessage: `HTTP ${response.status}: ${text}`,
        };
      }

      // Try to parse as JSON, fall back to plain text
      let result: WorkerUpdateResult;
      try {
        const json = JSON.parse(text);
        result = {
          success: json.success ?? true,
          hostname,
          previousIP: json.previousIP,
          newIP: ip,
          message: json.message,
          errorMessage: json.error,
        };
      } catch {
        // Plain text response (like "OK")
        result = {
          success: true,
          hostname,
          newIP: ip,
          message: text,
        };
      }

      logger.info(`Successfully updated ${hostname} to ${ip}`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to update ${hostname}: ${message}`);

      return {
        success: false,
        hostname,
        newIP: ip,
        errorMessage: message,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async updateBatch(
    hostnames: string[],
    ip: string,
    ipVersion: '4' | '6' = '4'
  ): Promise<Map<string, WorkerUpdateResult>> {
    const results = new Map<string, WorkerUpdateResult>();

    for (const hostname of hostnames) {
      const result = await this.update(hostname, ip, ipVersion);
      results.set(hostname, result);

      // Small delay between requests to avoid rate limiting
      if (hostnames.indexOf(hostname) < hostnames.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return results;
  }
}

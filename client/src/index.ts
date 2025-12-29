import { loadConfig, validateConfig } from './config/index.js';
import { IPFetcher } from './ip-fetcher/index.js';
import { Persistence } from './persistence/index.js';
import { WorkerNotifier } from './notifier/index.js';
import { createServer } from './server/index.js';
import { createLogger } from './logger.js';
import type { AppState, DNSRecord, UpdateHistoryEntry } from './types.js';

const logger = createLogger('main');

class DDNSClient {
  private config = loadConfig();
  private ipFetcher: IPFetcher;
  private persistence: Persistence;
  private notifier: WorkerNotifier;
  private state: AppState;
  private updateTimer?: NodeJS.Timeout;
  private isUpdating = false;

  constructor() {
    validateConfig(this.config);

    this.ipFetcher = new IPFetcher({
      providers: this.config.ipProviders,
    });

    this.persistence = new Persistence(this.config.dataDir);

    this.notifier = new WorkerNotifier({
      workerUrl: this.config.worker.url,
      secret: this.config.worker.secret,
    });

    this.state = {
      records: new Map(),
      startedAt: new Date(),
      isRunning: false,
    };

    // Initialize records from config
    for (const hostname of this.config.hostnames) {
      this.state.records.set(hostname, {
        hostname,
        status: 'unknown',
        updateHistory: [],
      });
    }
  }

  async start(): Promise<void> {
    logger.info('Starting Cloudflare DDNS Client');
    logger.info(`Configured hostnames: ${this.config.hostnames.join(', ')}`);
    logger.info(`Check interval: ${this.config.checkInterval} seconds`);
    logger.info(`IP version: ${this.config.ipVersion}`);

    // Load persisted state
    await this.persistence.load();

    // Restore record state from persistence
    for (const hostname of this.config.hostnames) {
      const persisted = this.persistence.getRecord(hostname);
      if (persisted) {
        this.state.records.set(hostname, {
          ...persisted,
          status: 'unknown',
        });
      }
    }

    // Restore last known IPs
    this.state.currentIPv4 = this.persistence.getLastIPv4();
    this.state.currentIPv6 = this.persistence.getLastIPv6();

    this.state.isRunning = true;

    // Start web server
    createServer(
      this.config.server,
      () => this.state,
      () => this.runUpdate()
    );

    // Run initial update
    await this.runUpdate();

    // Schedule periodic updates
    this.updateTimer = setInterval(
      () => this.runUpdate(),
      this.config.checkInterval * 1000
    );

    logger.info('DDNS Client started successfully');
  }

  async runUpdate(): Promise<void> {
    if (this.isUpdating) {
      logger.debug('Update already in progress, skipping');
      return;
    }

    this.isUpdating = true;

    try {
      logger.debug('Starting IP check...');

      // Fetch current public IP
      const { ipv4, ipv6 } = await this.ipFetcher.fetch(this.config.ipVersion);

      this.state.lastIPCheck = new Date();

      const ipv4Changed = ipv4 && ipv4 !== this.state.currentIPv4;
      const ipv6Changed = ipv6 && ipv6 !== this.state.currentIPv6;

      if (!ipv4Changed && !ipv6Changed) {
        logger.debug('No IP changes detected');
        // Update check time on all records
        for (const [hostname, record] of this.state.records) {
          record.lastChecked = new Date();
          record.status = 'current';
          this.state.records.set(hostname, record);
        }
        return;
      }

      // IP has changed, update all hostnames
      if (ipv4Changed) {
        logger.info(`IPv4 changed: ${this.state.currentIPv4 || 'none'} -> ${ipv4}`);
        await this.updateHostnames(ipv4, '4');
        this.state.currentIPv4 = ipv4;
      }

      if (ipv6Changed) {
        logger.info(`IPv6 changed: ${this.state.currentIPv6 || 'none'} -> ${ipv6}`);
        await this.updateHostnames(ipv6, '6');
        this.state.currentIPv6 = ipv6;
      }

      // Persist state
      this.persistence.setLastIP(ipv4, ipv6);
      await this.persistence.save();

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Update failed: ${message}`);
    } finally {
      this.isUpdating = false;
    }
  }

  private async updateHostnames(ip: string, version: '4' | '6'): Promise<void> {
    for (const hostname of this.config.hostnames) {
      const record = this.state.records.get(hostname) as DNSRecord;
      const previousIP = version === '4' ? record.ipv4 : record.ipv6;

      record.status = 'updating';
      this.state.records.set(hostname, record);

      try {
        const result = await this.notifier.update(hostname, ip, version);

        const historyEntry: UpdateHistoryEntry = {
          timestamp: new Date(),
          previousIP,
          newIP: ip,
          ipVersion: version,
          success: result.success,
          errorMessage: result.errorMessage,
        };

        record.updateHistory.unshift(historyEntry);
        if (record.updateHistory.length > 100) {
          record.updateHistory = record.updateHistory.slice(0, 100);
        }

        if (result.success) {
          if (version === '4') {
            record.ipv4 = ip;
          } else {
            record.ipv6 = ip;
          }
          record.lastUpdated = new Date();
          record.status = 'current';
          record.errorMessage = undefined;
        } else {
          record.status = 'error';
          record.errorMessage = result.errorMessage;
        }

        // Persist record state
        this.persistence.updateRecord(hostname, record);
        this.persistence.addHistoryEntry(hostname, historyEntry);

      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        record.status = 'error';
        record.errorMessage = message;
      }

      record.lastChecked = new Date();
      this.state.records.set(hostname, record);
    }
  }

  async stop(): Promise<void> {
    logger.info('Stopping DDNS Client...');
    this.state.isRunning = false;

    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }

    await this.persistence.save();
    logger.info('DDNS Client stopped');
  }
}

// Main entry point
const client = new DDNSClient();

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  await client.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await client.stop();
  process.exit(0);
});

// Start the client
client.start().catch((error) => {
  logger.error(`Failed to start: ${error.message}`);
  process.exit(1);
});

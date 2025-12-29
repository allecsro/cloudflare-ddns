import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { DNSRecord, UpdateHistoryEntry } from '../types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('persistence');

interface PersistedData {
  version: number;
  lastIPv4?: string;
  lastIPv6?: string;
  records: Record<string, PersistedRecord>;
}

interface PersistedRecord {
  hostname: string;
  ipv4?: string;
  ipv6?: string;
  lastUpdated?: string;
  updateHistory: Array<{
    timestamp: string;
    previousIP?: string;
    newIP: string;
    ipVersion: '4' | '6';
    success: boolean;
    errorMessage?: string;
  }>;
}

const DATA_VERSION = 1;
const MAX_HISTORY_ENTRIES = 100;

export class Persistence {
  private filePath: string;
  private data: PersistedData;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'ddns-state.json');
    this.data = {
      version: DATA_VERSION,
      records: {},
    };
  }

  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(content) as PersistedData;

      if (parsed.version !== DATA_VERSION) {
        logger.warn(`Data version mismatch (expected ${DATA_VERSION}, got ${parsed.version}), migrating...`);
        // Handle migrations here if needed
      }

      this.data = parsed;
      logger.info(`Loaded state from ${this.filePath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info('No existing state file found, starting fresh');
      } else {
        logger.warn(`Failed to load state file: ${error}`);
      }
    }
  }

  async save(): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
      logger.debug('State saved');
    } catch (error) {
      logger.error(`Failed to save state: ${error}`);
      throw error;
    }
  }

  getLastIPv4(): string | undefined {
    return this.data.lastIPv4;
  }

  getLastIPv6(): string | undefined {
    return this.data.lastIPv6;
  }

  setLastIP(ipv4?: string, ipv6?: string): void {
    if (ipv4) this.data.lastIPv4 = ipv4;
    if (ipv6) this.data.lastIPv6 = ipv6;
  }

  getRecord(hostname: string): DNSRecord | undefined {
    const persisted = this.data.records[hostname];
    if (!persisted) return undefined;

    return {
      hostname: persisted.hostname,
      ipv4: persisted.ipv4,
      ipv6: persisted.ipv6,
      lastUpdated: persisted.lastUpdated ? new Date(persisted.lastUpdated) : undefined,
      status: 'unknown',
      updateHistory: persisted.updateHistory.map((h) => ({
        ...h,
        timestamp: new Date(h.timestamp),
      })),
    };
  }

  getAllRecords(): DNSRecord[] {
    return Object.values(this.data.records).map((persisted) => ({
      hostname: persisted.hostname,
      ipv4: persisted.ipv4,
      ipv6: persisted.ipv6,
      lastUpdated: persisted.lastUpdated ? new Date(persisted.lastUpdated) : undefined,
      status: 'unknown' as const,
      updateHistory: persisted.updateHistory.map((h) => ({
        ...h,
        timestamp: new Date(h.timestamp),
      })),
    }));
  }

  updateRecord(hostname: string, update: Partial<DNSRecord>): void {
    if (!this.data.records[hostname]) {
      this.data.records[hostname] = {
        hostname,
        updateHistory: [],
      };
    }

    const record = this.data.records[hostname];

    if (update.ipv4 !== undefined) record.ipv4 = update.ipv4;
    if (update.ipv6 !== undefined) record.ipv6 = update.ipv6;
    if (update.lastUpdated) record.lastUpdated = update.lastUpdated.toISOString();
  }

  addHistoryEntry(hostname: string, entry: UpdateHistoryEntry): void {
    if (!this.data.records[hostname]) {
      this.data.records[hostname] = {
        hostname,
        updateHistory: [],
      };
    }

    const record = this.data.records[hostname];
    record.updateHistory.unshift({
      ...entry,
      timestamp: entry.timestamp.toISOString(),
    });

    // Keep only the last N entries
    if (record.updateHistory.length > MAX_HISTORY_ENTRIES) {
      record.updateHistory = record.updateHistory.slice(0, MAX_HISTORY_ENTRIES);
    }
  }
}

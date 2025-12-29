export type IPVersion = '4' | '6' | 'both';

export type RecordStatus = 'current' | 'updating' | 'error' | 'unknown';

export interface DNSRecord {
  hostname: string;
  ipv4?: string;
  ipv6?: string;
  lastUpdated?: Date;
  lastChecked?: Date;
  status: RecordStatus;
  errorMessage?: string;
  updateHistory: UpdateHistoryEntry[];
}

export interface UpdateHistoryEntry {
  timestamp: Date;
  previousIP?: string;
  newIP: string;
  ipVersion: '4' | '6';
  success: boolean;
  errorMessage?: string;
}

export interface Config {
  worker: {
    url: string;
    secret: string;
  };
  hostnames: string[];
  ipProviders: string[];
  checkInterval: number;
  ipVersion: IPVersion;
  dataDir: string;
  server: {
    port: number;
    host: string;
  };
  logLevel: string;
}

export interface IPFetchResult {
  ipv4?: string;
  ipv6?: string;
  provider: string;
  timestamp: Date;
}

export interface WorkerUpdateResult {
  success: boolean;
  hostname: string;
  previousIP?: string;
  newIP: string;
  message?: string;
  errorMessage?: string;
}

export interface AppState {
  records: Map<string, DNSRecord>;
  currentIPv4?: string;
  currentIPv6?: string;
  lastIPCheck?: Date;
  startedAt: Date;
  isRunning: boolean;
}

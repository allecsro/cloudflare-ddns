import express, { type Request, type Response } from 'express';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppState, DNSRecord } from '../types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('server');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerOptions {
  port: number;
  host: string;
}

interface APIRecord {
  hostname: string;
  ipv4?: string;
  ipv6?: string;
  status: string;
  lastUpdated?: string;
  lastChecked?: string;
  errorMessage?: string;
  updateHistory: Array<{
    timestamp: string;
    previousIP?: string;
    newIP: string;
    ipVersion: string;
    success: boolean;
    errorMessage?: string;
  }>;
}

interface APIStatus {
  status: 'running' | 'stopped';
  currentIPv4?: string;
  currentIPv6?: string;
  lastIPCheck?: string;
  uptime: number;
  records: APIRecord[];
}

export function createServer(
  options: ServerOptions,
  getState: () => AppState,
  triggerUpdate: () => Promise<void>
) {
  const app = express();

  app.use(express.json());

  // Serve static files
  app.use(express.static(path.join(__dirname, 'public')));

  // API: Get status
  app.get('/api/status', (_req: Request, res: Response) => {
    const state = getState();
    const records: APIRecord[] = [];

    for (const [, record] of state.records) {
      records.push(formatRecord(record));
    }

    const response: APIStatus = {
      status: state.isRunning ? 'running' : 'stopped',
      currentIPv4: state.currentIPv4,
      currentIPv6: state.currentIPv6,
      lastIPCheck: state.lastIPCheck?.toISOString(),
      uptime: Math.floor((Date.now() - state.startedAt.getTime()) / 1000),
      records,
    };

    res.json(response);
  });

  // API: Get all records
  app.get('/api/records', (_req: Request, res: Response) => {
    const state = getState();
    const records: APIRecord[] = [];

    for (const [, record] of state.records) {
      records.push(formatRecord(record));
    }

    res.json(records);
  });

  // API: Get single record
  app.get('/api/records/:hostname', (req: Request, res: Response) => {
    const state = getState();
    const record = state.records.get(req.params.hostname);

    if (!record) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }

    res.json(formatRecord(record));
  });

  // API: Trigger manual update
  app.post('/api/update', async (_req: Request, res: Response) => {
    try {
      logger.info('Manual update triggered via API');
      await triggerUpdate();
      res.json({ success: true, message: 'Update triggered' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ success: false, error: message });
    }
  });

  // API: Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // Serve index.html for all other routes (SPA support)
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  const server = app.listen(options.port, options.host, () => {
    logger.info(`Web UI available at http://${options.host}:${options.port}`);
  });

  return server;
}

function formatRecord(record: DNSRecord): APIRecord {
  return {
    hostname: record.hostname,
    ipv4: record.ipv4,
    ipv6: record.ipv6,
    status: record.status,
    lastUpdated: record.lastUpdated?.toISOString(),
    lastChecked: record.lastChecked?.toISOString(),
    errorMessage: record.errorMessage,
    updateHistory: record.updateHistory.map((h) => ({
      timestamp: h.timestamp.toISOString(),
      previousIP: h.previousIP,
      newIP: h.newIP,
      ipVersion: h.ipVersion,
      success: h.success,
      errorMessage: h.errorMessage,
    })),
  };
}

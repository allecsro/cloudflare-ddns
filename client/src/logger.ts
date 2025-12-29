import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

const transport = process.stdout.isTTY
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    }
  : undefined;

export const rootLogger = pino({
  level,
  transport,
});

export function createLogger(name: string) {
  return rootLogger.child({ name });
}

export interface IPProvider {
  name: string;
  ipv4Url?: string;
  ipv6Url?: string;
  parseResponse: (body: string) => string | null;
}

const parseCloudflareTrace = (body: string): string | null => {
  const match = body.match(/ip=([^\n]+)/);
  return match ? match[1].trim() : null;
};

const parsePlainText = (body: string): string | null => {
  const ip = body.trim();
  return ip.length > 0 ? ip : null;
};

export const providers: Record<string, IPProvider> = {
  ipify: {
    name: 'ipify',
    ipv4Url: 'https://api.ipify.org',
    ipv6Url: 'https://api6.ipify.org',
    parseResponse: parsePlainText,
  },
  cloudflare: {
    name: 'cloudflare',
    ipv4Url: 'https://1.1.1.1/cdn-cgi/trace',
    ipv6Url: 'https://[2606:4700:4700::1111]/cdn-cgi/trace',
    parseResponse: parseCloudflareTrace,
  },
  icanhazip: {
    name: 'icanhazip',
    ipv4Url: 'https://ipv4.icanhazip.com',
    ipv6Url: 'https://ipv6.icanhazip.com',
    parseResponse: parsePlainText,
  },
  ifconfig: {
    name: 'ifconfig',
    ipv4Url: 'https://ifconfig.me/ip',
    ipv6Url: 'https://ifconfig.me/ip',
    parseResponse: parsePlainText,
  },
  ipinfo: {
    name: 'ipinfo',
    ipv4Url: 'https://ipinfo.io/ip',
    ipv6Url: 'https://ipinfo.io/ip',
    parseResponse: parsePlainText,
  },
  seeip: {
    name: 'seeip',
    ipv4Url: 'https://ipv4.seeip.org',
    ipv6Url: 'https://ipv6.seeip.org',
    parseResponse: parsePlainText,
  },
};

export function getProvider(name: string): IPProvider | undefined {
  return providers[name.toLowerCase()];
}

export function getAvailableProviders(): string[] {
  return Object.keys(providers);
}

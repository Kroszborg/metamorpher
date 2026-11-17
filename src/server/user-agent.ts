/**
 * Coarse classification of a user-agent string. The raw string is never
 * stored: only these labels are, and only for usage statistics and the
 * account's session list ("Firefox on Linux").
 */
export type Coarse = { browser: string; os: string; device: 'desktop' | 'mobile' | 'tablet'; bot: boolean };

const BOT =
  /bot\b|bot\/|crawl|spider|slurp|scrap|headless|lighthouse|pagespeed|preview|monitor|uptime|curl\/|wget|python|httpclient|okhttp|axios|node-fetch|undici|go-http|java\/|libwww|phantom|puppeteer|playwright|selenium|facebookexternalhit|embedly|whatsapp|telegram/i;

export function classifyUserAgent(ua: string | null | undefined, mobileHint?: string | null): Coarse {
  const s = ua ?? '';
  const bot = s.length < 20 || BOT.test(s);

  let browser = 'Other';
  if (/Edg(e|A|iOS)?\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/SamsungBrowser\//.test(s)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS\//.test(s)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = 'Safari';

  let os = 'Other';
  if (/Windows NT/.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/.test(s)) os = 'macOS';
  else if (/Linux/.test(s)) os = 'Linux';

  let device: Coarse['device'] = 'desktop';
  if (/iPad|Tablet/.test(s) || (/Android/.test(s) && !/Mobile/.test(s))) device = 'tablet';
  else if (mobileHint === '?1' || /Mobi|iPhone|iPod/.test(s)) device = 'mobile';

  return { browser, os, device, bot };
}

export function sessionLabel(ua: string | null | undefined): string {
  const c = classifyUserAgent(ua);
  return `${c.browser} on ${c.os}`;
}

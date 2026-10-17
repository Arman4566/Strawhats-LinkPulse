'use strict';

// Known crawlers, link-preview fetchers, scripted clients and uptime monitors.
// A match means the request is logged but never counted as a real visit.
const BOT_PATTERN = new RegExp([
  'bot', 'crawl', 'spider', 'slurp', 'scrape', 'fetch', 'preview', 'monitor', 'uptime', 'headless',
  'lighthouse', 'pingdom', 'facebookexternalhit', 'whatsapp', 'telegram', 'discord', 'slack',
  'curl', 'wget', 'python-requests', 'python-urllib', 'aiohttp', 'httpclient', 'http-client',
  'axios', 'node-fetch', 'undici', 'go-http-client', 'java/', 'libwww', 'postman', 'insomnia',
  'phantomjs', 'puppeteer', 'playwright', 'selenium',
].join('|'), 'i');

function parseUserAgent(ua) {
  const s = String(ua || '');
  const isBot = !s.trim() || BOT_PATTERN.test(s);

  let browser = 'Other';
  if (/edg(e|a|ios)?\//i.test(s)) browser = 'Edge';
  else if (/opr\/|opera/i.test(s)) browser = 'Opera';
  else if (/samsungbrowser/i.test(s)) browser = 'Samsung Internet';
  else if (/firefox|fxios/i.test(s)) browser = 'Firefox';
  else if (/chrome|crios|chromium/i.test(s)) browser = 'Chrome';
  else if (/safari/i.test(s) && /version\//i.test(s)) browser = 'Safari';
  else if (/safari/i.test(s)) browser = 'Safari';

  let os = 'Other';
  if (/windows/i.test(s)) os = 'Windows';
  else if (/android/i.test(s)) os = 'Android';
  else if (/iphone|ipad|ipod|ios/i.test(s)) os = 'iOS';
  else if (/mac os x|macintosh/i.test(s)) os = 'macOS';
  else if (/cros/i.test(s)) os = 'ChromeOS';
  else if (/linux/i.test(s)) os = 'Linux';

  let device = 'desktop';
  if (isBot) device = 'bot';
  else if (/ipad|tablet/i.test(s) || (/android/i.test(s) && !/mobile/i.test(s))) device = 'tablet';
  else if (/mobi|iphone|ipod|android/i.test(s)) device = 'mobile';

  return { isBot, browser: isBot && !s.trim() ? 'None' : browser, os, device };
}

module.exports = { parseUserAgent };

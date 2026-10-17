'use strict';
/**
 * Demo data: one demo user, two campaigns, a mix of active / expired / disabled / limited links
 * and a month of realistic clicks (including bots), so the dashboard looks alive on first open.
 * Run with: npm run seed   (or set SEED_DEMO=1 to seed an empty database on start)
 */
const { tx, openDb, insertMany } = require('./db');
const auth = require('./auth');
const config = require('./config');

// Small deterministic random generator so the demo looks the same every time.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const AGENTS = {
  chromeAndroid: { ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36', device: 'mobile', browser: 'Chrome', os: 'Android' },
  safariIphone: { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1', device: 'mobile', browser: 'Safari', os: 'iOS' },
  chromeWin: { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36', device: 'desktop', browser: 'Chrome', os: 'Windows' },
  edgeWin: { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0', device: 'desktop', browser: 'Edge', os: 'Windows' },
  firefoxLinux: { ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0', device: 'desktop', browser: 'Firefox', os: 'Linux' },
  safariMac: { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', device: 'desktop', browser: 'Safari', os: 'macOS' },
};
const AGENT_LIST = Object.values(AGENTS);
const REFERRERS = ['', '', '', 'instagram.com', 'instagram.com', 'whatsapp.com', 'google.com', 'facebook.com', 'linkedin.com', 't.co'];
const COUNTRIES = ['India', 'India', 'India', 'India', 'India', 'United States', 'United Arab Emirates', 'Nepal'];

async function seed(db) {
  const rand = rng(42);
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();

  await tx(db, async (t) => {
    await t.run('INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
      [config.ADMIN_EMAIL, 'Admin', auth.hashPassword(config.ADMIN_PASSWORD), 'admin', iso(now - 40 * 86400_000)]);
    await t.run('INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
      ['demo@linkpulse.test', 'Demo User', auth.hashPassword('demo1234'), 'user', iso(now - 35 * 86400_000)]);
    const demo = (await t.get("SELECT id FROM users WHERE email = 'demo@linkpulse.test'")).id;

    const camp = async (name, description) => (await t.get(
      'INSERT INTO campaigns (owner_id, name, description, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (owner_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id',
      [demo, name, description, iso(now - 30 * 86400_000)])).id;
    const fest = await camp('Tech Fest 2026', 'Posters, QR standees and social posts for the college fest');
    const cafe = await camp('Cafe Menu', 'QR menu cards on the cafe tables');
    const club = await camp('Club Recruitment', 'Sign-up forms for the new semester');

    const mk = async (code, dest, title, campaign, opts = {}) => {
      const at = iso(now - (opts.ageDays ?? 28) * 86400_000);
      const id = (await t.get(`INSERT INTO links (owner_id, campaign_id, short_code, destination_url, title, status, disabled_reason, expires_at, click_limit, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, [
        demo, campaign, code, dest, title, opts.status || 'active', opts.reason || null, opts.expires || null,
        opts.limit || null, opts.password ? auth.hashPassword(opts.password) : null, at, at])).id;
      for (const tag of opts.tags || []) {
        const tid = (await t.get('INSERT INTO tags (owner_id, name) VALUES (?, ?) ON CONFLICT (owner_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id', [demo, tag])).id;
        await t.run('INSERT INTO link_tags (link_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [id, tid]);
      }
      return { id, weight: opts.weight ?? 1, ageDays: opts.ageDays ?? 28, qrShare: opts.qrShare ?? 0.2, ...opts };
    };

    const L = [];
    const add = async (...a) => { L.push(await mk(...a)); };
    await add('fest-reg', 'https://example.com/tech-fest/register', 'Fest registration form', fest, { weight: 9, tags: ['poster', 'registration'], qrShare: 0.45 });
    await add('fest-sched', 'https://example.com/tech-fest/schedule', 'Fest schedule', fest, { weight: 5, tags: ['poster'], qrShare: 0.35 });
    await add('fest-hack', 'https://example.com/tech-fest/hackathon', 'Hackathon page', fest, { weight: 6, tags: ['social'], qrShare: 0.1 });
    await add('fest-ig', 'https://example.com/tech-fest/instagram-giveaway', 'Instagram giveaway', fest, { weight: 4, tags: ['social'], qrShare: 0.02, expires: iso(now + 3 * 86400_000) });
    await add('fest-early', 'https://example.com/tech-fest/early-bird', 'Early bird tickets', fest, { weight: 5, tags: ['registration'], limit: 120 });
    await add('fest-old', 'https://example.com/tech-fest/last-year', 'Last year recap', fest, { weight: 2, ageDays: 29, expires: iso(now - 4 * 86400_000) });
    await add('cafe-menu', 'https://example.com/cafe/menu', 'Table QR menu', cafe, { weight: 8, tags: ['qr'], qrShare: 0.9 });
    await add('cafe-offer', 'https://example.com/cafe/weekend-offer', 'Weekend offer', cafe, { weight: 3, tags: ['qr', 'offer'], qrShare: 0.6 });
    await add('cafe-feed', 'https://example.com/cafe/feedback', 'Feedback form', cafe, { weight: 2, qrShare: 0.7 });
    await add('cafe-staff', 'https://example.com/cafe/staff-rota', 'Staff rota', cafe, { weight: 1, password: 'cafe1234', tags: ['internal'] });
    await add('club-join', 'https://example.com/club/join', 'Join the club', club, { weight: 6, tags: ['poster'], qrShare: 0.5 });
    await add('club-wa', 'https://example.com/club/whatsapp-community', 'WhatsApp community', club, { weight: 4, tags: ['social'] });
    await add('club-bad', 'https://example.com/club/old-signup', 'Old signup form', club, { weight: 2, ageDays: 20, status: 'disabled', reason: 'Replaced by the new form' });
    await add('club-ad', 'https://example.com/club/sponsor-offer', 'Sponsor offer', club, { weight: 1, ageDays: 10, tags: ['offer'] });

    const rows = [];      // collected, then inserted in a few big batches (one round trip each)
    const pool = Array.from({ length: 140 }, (_, i) => `v${i.toString(16).padStart(4, '0')}${(i * 7919).toString(16)}`.slice(0, 16));
    for (const l of L) {
      const days = Math.min(l.ageDays, 30);
      for (let d = days; d >= 0; d--) {
        // more traffic on weekends and around the "event" days, with a little noise
        const dayMs = now - d * 86400_000;
        const dow = new Date(dayMs).getUTCDay();
        const base = l.weight * (dow === 0 || dow === 6 ? 1.6 : 1) * (1 + 1.5 * Math.exp(-((d - 4) ** 2) / 18));
        const n = Math.round(base * (0.5 + rand()) * 1.4);
        for (let i = 0; i < n; i++) {
          const a = AGENT_LIST[Math.floor(rand() * AGENT_LIST.length)];
          const at = dayMs - Math.floor(rand() * 86400_000);
          if (at > now) continue;
          const qr = rand() < l.qrShare;
          rows.push([l.id, iso(at), qr ? '' : REFERRERS[Math.floor(rand() * REFERRERS.length)], a.device, a.browser, a.os,
            COUNTRIES[Math.floor(rand() * COUNTRIES.length)], qr ? 'qr' : 'direct', pool[Math.floor(rand() * pool.length)], 0]);
        }
        if (rand() < 0.35) {      // a few crawler / preview hits that must never count
          rows.push([l.id, iso(dayMs - Math.floor(rand() * 86400_000)), '', 'bot', 'Other', 'Other', 'Unknown', 'direct', 'botbotbotbotbot0', 1]);
        }
      }
    }
    await insertMany(t, 'clicks', ['link_id', 'clicked_at', 'referrer', 'device', 'browser', 'os', 'country', 'source', 'visitor_hash', 'is_bot'], rows);
    // keep each link's counter equal to its real clicks
    await t.exec('UPDATE links SET click_count = (SELECT COUNT(*) FROM clicks c WHERE c.link_id = links.id AND c.is_bot = 0)');
    // the early-bird link has a cap; make it nearly used up for the alert panel
    await t.exec("UPDATE links SET click_limit = GREATEST(click_count + 8, 20) WHERE short_code = 'fest-early'");
    await t.run('INSERT INTO blocked_domains (domain, added_by, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
      ['malware-example.test', null, iso(now - 5 * 86400_000)]);
  });
}

if (require.main === module) {
  (async () => {
    const db = await openDb(config.DATABASE_URL);
    if (await db.get('SELECT 1 FROM links LIMIT 1')) {
      console.log('Database already has links, so nothing was seeded. Use a fresh Neon branch/database to re-seed.');
    } else {
      await seed(db);
      console.log('Seeded. Log in as demo@linkpulse.test / demo1234 or admin@linkpulse.test / ' + config.ADMIN_PASSWORD);
    }
    await db.close();
  })().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { seed };

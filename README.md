# LinkPulse

**URL shortener with live analytics, QR codes and link-in-bio pages.**
Team Strawhats · GEHU Tech Geeks hackathon · Round 2

**Live link:** https://linkpluse-hackathon.onrender.com
**Accounts details**
Admin:- 
Email:admin@linkpulse.test
Pass:@dmin123
Demo account:-
Email:demo@linkpulse.test
Pass:demo1234

#Note:We have coded the project together offline and only the team leader has push the code on Github

![Login page](docs/screenshots/01-login.png)

## Problem statement

Clubs, cafes and event teams share links everywhere: posters, QR standees, WhatsApp groups, Instagram bios. Long links are ugly and break in messages, and once a link is out in the world nobody knows whether it is working: how many people used it, from which place or device, whether a QR poster is earning its print cost, or whether a link has quietly started pointing at something harmful. Free shorteners hide the numbers behind paywalls, count crawlers and link previews as real visitors, and give you no control once a link is shared.

## Solution

LinkPulse turns every shared link into something you can see and control. It shortens links with custom aliases, protects them with expiry dates, passwords and click limits, and records every visit with bots filtered out so the numbers are real. Dashboards and plain-English insights show what is working, QR codes are tracked separately from clicks, and a link-in-bio page puts all of a person's links behind one address. Admins can take down abusive links, and a takedown cannot be undone by the link's owner.

## Features

**Links**
- Short links with custom aliases (live validation), optional title, tags and campaigns
- Expiry date, click limit and password protection. The click limit is enforced by one atomic database update, so the last click can never be handed out twice
- Bulk import from CSV with a preview of valid, duplicate and error rows before anything is saved
- **Share button on every link** (WhatsApp, Telegram, X, LinkedIn, Facebook, email, the phone's own share sheet, copy)
- Safety scan on every destination, alias suggestions, and an automatic warning for `http://` links

**QR codes**
- Every link has a QR code, tracked as its own source ("QR scans" are separate from clicks)
- **Download** as PNG or SVG, **Share** (as a link, or as the image where the device supports it, or copy the image) and **Full screen** for projectors and posters

**Link-in-bio pages**
- One public page per user at `/@your-name` with a name, short bio, theme (Ocean, Sunset, Forest, Midnight, Paper) and an ordered list of buttons
- Every button is one of your short links, so every tap appears in that link's analytics (source "bio")
- Live preview while editing; switched-off, expired or used-up links disappear from the public page by themselves; share button on the page; publish or hide it any time

**Analytics**
- Dashboard with clicks, unique visitors, QR scans, bot hits filtered, charts by day, referrer, device, browser and country, and alerts for expiring, nearly-full and suddenly-busy links
- Smart insights written in plain words (trend, best time to share, QR share), and **Ask AI**: type "clicks from mobile last week" and get the answer
- Bots and link previews are recorded but never counted. Raw IP addresses are never stored

**Admin and safety**
- Admin console: all links, risk radar (look-alike domains, raw IPs, pressure words), blocklist, reports from visitors, latency panel
- **Admin lock:** when an admin disables a link, or blocks its domain, **only an admin can switch it back on**. The owner sees a "Locked by admin" notice and the reason, and can still edit the link's other details
- Admin takedowns apply to the very next click and the history is kept

## Tech stack

| Part | Technology |
| --- | --- |
| Server | Node.js 22 (`node:http`, `node:crypto`), no web framework |
| Database | **Neon** (serverless PostgreSQL) through the `pg` driver |
| Front end | React 19 + Vite |
| Auth | scrypt password hashing, signed JWT (HS256), roles checked on every request |
| Optional AI | Google Gemini (falls back to built-in rules when no key is set) |
| Hosting | Render (web service) + Neon (database) |

## Setup instructions

You need Node.js 22.13 or newer and a free Neon account.

**1. Get the code and install**
```
git clone https://github.com/Arman4566/Strawhats-LinkPulse.git
cd strawhats-linkpulse
npm install
```

**2. Create the Neon database** (about 5 minutes)
1. Sign up at https://neon.tech and create a project (choose the region closest to where you deploy).
2. Click **Connect**, tick **Connection pooling**, and copy the connection string. It looks like
   `postgresql://user:pass@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require`

**3. Configure**
```
cp .env.example .env
```
Open `.env` and set `DATABASE_URL` (the string from step 2) and `JWT_SECRET` (a long random value; the file shows how to generate one). `.env` is listed in `.gitignore`, so your secrets never reach GitHub.

**4. Run**
```
npm start                # http://localhost:3000   (tables are created automatically)
SEED_DEMO=1 npm start    # first run on an empty database: adds demo data (14 links, a month of clicks)
```
Logins (change before deploying): admin `admin@linkpulse.test` / `@dmin1234` (override with `ADMIN_EMAIL`, `ADMIN_PASSWORD`); demo user `demo@linkpulse.test` / `demo1234`.

**5. Tests** (optional)
```
TEST_DATABASE_URL="postgresql://..." npm test      # 23 automated tests
```
Use a separate Neon **branch** (or any local Postgres). Each run works in its own temporary schema and deletes it at the end, so real data is never touched.

**6. Change the front end** (optional; the built site is already in `public/`)
```
npm run build:client   # installs client deps, builds into public/
npm run dev:client     # hot reload on :5173, proxies /api to :3000
```

### Environment variables
`DATABASE_URL` (Neon connection string, required) · `JWT_SECRET` · `PORT` · `BASE_URL` (public address, e.g. https://linkpulse.onrender.com) · `ADMIN_EMAIL` · `ADMIN_PASSWORD` · `SEED_DEMO=1` · `GEMINI_API_KEY` (optional; also `AI_MODEL`, default `gemini-2.5-flash`) · `PG_POOL_MAX` (default 10)

### Deploy on Render
New Web Service from the repo, runtime Node 22, build command `npm install`, start command `npm start`. Add the environment variables above (`DATABASE_URL`, `JWT_SECRET` and `BASE_URL` matter most). No disk is needed: the data lives in Neon, so redeploys keep everything. Health check path: `/health`. After the first deploy, put the Render address in the **Live link** line at the top of this file. Country shows "Unknown" unless the host sends a country header (Cloudflare `cf-ipcountry` works).

## Screenshots
You Can Also see here:https://drive.google.com/drive/folders/1KFjYvZ79_ONKc-13ajr3E_OAjmU2Bwl5?usp=sharing
| | |
| --- | --- |
| ![Dashboard](docs/screenshots/02-dashboard.png) **Dashboard** with live numbers and smart insights | ![Share menu](docs/screenshots/03-links-share.png) **Share** from the links list |
| ![QR code](docs/screenshots/04-link-analytics-qr.png) **Link analytics** with the QR code: download, share, full screen | ![Full screen QR](docs/screenshots/05-qr-fullscreen.png) **Full-screen QR** for projectors and posters |
| ![Bio editor](docs/screenshots/06-bio-editor.png) **Link-in-bio editor** with live preview | ![Bio page](docs/screenshots/07-bio-page.png) **Public bio page** at `/@name` |

**Admin lock:** a link an admin disabled shows the reason and can only be switched on by an admin.

![Admin lock](docs/screenshots/08-admin-lock.png)

## How it works

Redirect checks, in order: exists, not disabled, not expired, password, click limit (one atomic SQL update), then `302`. The click is written after the response, in batches, and links without a limit are counted in that same batch, so the visitor never waits on the database. Bots are recorded but never counted. A daily-salted hash (not the IP) is used for unique visitors.

Database notes: timestamps are `timestamptz`; short codes, emails, blocked domains and bio-page names are `citext` (case-insensitive and unique). The pool reconnects by itself when Neon suspends an idle database, so the first request after a long pause can take a second or two. Existing databases are upgraded automatically on start (new tables and columns are added; nothing is dropped).


## Team and contributing

Repository rules we follow (GEHU Tech Geeks):
- The repo is **public** and named `teamname-projectname`, i.e. `strawhats-linkpulse`
- This README covers the problem statement, solution, features, tech stack, setup instructions, live link and screenshots
- **`.env` is never committed**: it is listed in `.gitignore`, and `.env.example` shows what to set
- Commit regularly with meaningful messages, for example `feat: add login`, `fix: stop admin-locked links being re-enabled`
- Every team member commits from their own GitHub account

## Team Strawhats

*1.Arman Ahamad-Backend
2.Harshit Nainwal -Backend
3.Anshul Prashad-Frontend
4.Pankaj Pandey-Frontend
5.Mohit Singh Bora-UI/UX & Tester*

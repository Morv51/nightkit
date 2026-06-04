# NightKit — Architektur

Stand: 2026-05-28. Dieses Dokument beschreibt, wie NightKit als skalierbares
SaaS aufgebaut wird, vom aktuellen Mini-MVP bis zum zahlenden Kundenstamm
mit Stripe, eigener Domain und Multi-Template-Bibliothek.

Grundprinzipien:

- **Konvention vor Konfiguration** — Templates und Kategorien kommen aus dem
  Dateisystem, nicht aus Listen im Code.
- **Schichten isolieren** — Auth weiß nichts von Stripe, Stripe weiß nichts
  von Templates. Jede Schicht kann unabhängig erweitert werden.
- **Forward-kompatibles Schema** — DB-Spalten für Stripe, Usage-Limits und
  Plan-Verwaltung existieren ab Tag 1, auch wenn sie erst später benutzt
  werden. Das spart später Migrationen mit Downtime.
- **Nichts erfinden, was es nicht braucht** — Native Node `http` bleibt,
  bis Express tatsächlich Mehrwert bringt (= bei Auth-Routes).

---

## 0. Aktueller Stand

```
nightkit/
├── server.js              Bootstrap (3.9 KB)
├── lib/                   Backend-Module
├── public/                Frontend (HTML + CSS + ES-Module)
└── templates/             Aktuell nur default.png
```

Backend ist modular, Frontend ist modular. Was fehlt: Persistenz (DB),
Auth, Stripe, Template-Vielfalt, Landing-Demo.

---

## 1. Ordnerstruktur (Ziel)

```
nightkit/
├── server.js                       Bootstrap, lädt Module, startet HTTP
├── package.json
├── .env.example                    Liste aller benötigten Env-Variablen
├── ARCHITECTURE.md
├── CLAUDE.md
│
├── lib/
│   ├── server/
│   │   ├── http.js                 readJson, sendJson, CORS
│   │   ├── router.js               Pattern-Router (existiert)
│   │   ├── static.js               Static-Serving (existiert)
│   │   ├── proxy.js                /api/proxy mit Host-Whitelist (existiert)
│   │   ├── convert.js              webm → mp4 (existiert)
│   │   ├── jobs.js                 In-Memory-Job-Store mit TTL (existiert)
│   │   │
│   │   ├── db/
│   │   │   ├── pool.js             pg.Pool, gelesen aus DATABASE_URL
│   │   │   ├── migrate.js          Liest migrations/*.sql in Order, idempotent
│   │   │   ├── users.js            CRUD: findByEmail, create, updateStripeId
│   │   │   ├── generations.js     CRUD: insert, countForUserThisPeriod
│   │   │   └── stripeEvents.js     CRUD: insertIfNew (Idempotency)
│   │   │
│   │   ├── auth/
│   │   │   ├── password.js         bcrypt.hash / compare, COST=12
│   │   │   ├── session.js          express-session + connect-pg-simple
│   │   │   ├── middleware.js       requireAuth, requireVerified
│   │   │   ├── service.js          register, login, logout — KENNT KEIN STRIPE
│   │   │   └── routes.js           POST /api/auth/{register,login,logout,me}
│   │   │
│   │   ├── billing/                (Phase 2 — leer bis Stripe dran ist)
│   │   │   ├── stripe.js           SDK-Wrapper, Customer & Sub anlegen
│   │   │   ├── plans.js            Hardcoded Plan-Definitionen
│   │   │   ├── middleware.js       requireSubscription("pro")
│   │   │   ├── webhook.js          /api/billing/webhook, signature-verify
│   │   │   └── routes.js           POST /api/billing/checkout, /portal
│   │   │
│   │   ├── ai/
│   │   │   ├── ideogram.js         Bild-Edit (existiert)
│   │   │   ├── prompt.js           buildPrompt(event, templateMeta) (existiert)
│   │   │   └── caption.js          (Phase 3) Claude/OpenAI für Captions
│   │   │
│   │   └── templates/
│   │       ├── registry.js         walkDir → in-memory cache
│   │       ├── manifest.js         Parsen + validieren von template.json
│   │       └── routes.js           GET /api/templates, /api/templates/:id
│   │
│   └── shared/                     (von Server UND Frontend lesbar — nur reine Daten)
│       └── plans.json              Plan-Limits, im Frontend für Pricing
│
├── migrations/
│   ├── 001_users.sql
│   ├── 002_sessions.sql
│   ├── 003_generations.sql
│   └── 004_stripe_events.sql
│
├── templates/
│   ├── _meta.json                  optional, Kategorie-Labels
│   ├── techno/
│   │   ├── neon-pulse/
│   │   │   ├── source.png          Original für Ideogram-Edit (1080×1920)
│   │   │   ├── thumb.jpg           Vorschau (400×534, ~30 KB)
│   │   │   └── template.json       Manifest (Name, Tags, Hints)
│   │   └── industrial/
│   ├── house/
│   ├── hiphop/
│   ├── rnb/
│   ├── halloween/
│   └── minimal/
│
├── public/
│   ├── landing.html
│   ├── app.html
│   ├── login.html                  (Phase 1)
│   ├── account.html                (Phase 1)
│   ├── pricing.html                (Phase 2)
│   ├── mp4-muxer.js
│   ├── assets/
│   │   └── crowd.jpg
│   ├── css/
│   │   ├── tokens.css              CSS-Variablen, von allen geteilt
│   │   ├── landing.css
│   │   ├── app.css                 (existiert)
│   │   └── auth.css
│   └── js/
│       ├── shared/                 dom.js, api.js (existieren)
│       ├── app/                    Generator-Module (existieren)
│       ├── landing/
│       │   └── demo.js             Scrollytelling-Demo
│       └── auth/
│           ├── login.js
│           └── register.js
│
└── scripts/
    ├── add-template.sh             Scaffold für neues Template
    └── seed-dev.js                 Erstellt Dev-User in lokaler DB
```

**Was sich gegenüber heute ändert:**

- `lib/` bekommt einen `server/`-Subordner, damit später ggf. ein
  `client/`-Subordner mit shared Code dazukommen kann.
- `templates/` wird hierarchisch — Server entdeckt Templates automatisch.
- `migrations/` als versionierte SQL-Files, kein ORM.
- `public/js/` bekommt eigene Subordner pro Seite (`app/`, `landing/`,
  `auth/`) — schon jetzt liegen die Generator-Module dort flach, das ziehen
  wir in `app/` um, wenn `landing/`-JS dazukommt.

---

## 2. Auth + Stripe

### Datenbank-Schema (ab Tag 1)

Forward-kompatibel: Stripe-Spalten und Usage-Tracking sind bereits in
`users` enthalten, bleiben aber `NULL` / `0` bis Phase 2.

**`migrations/001_users.sql`**

```sql
CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  email           CITEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  email_verified  BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  -- Stripe (alles NULL bis Phase 2)
  stripe_customer_id     TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  subscription_status    TEXT NOT NULL DEFAULT 'free',
    -- 'free' | 'trialing' | 'active' | 'past_due' | 'canceled'
  subscription_plan      TEXT,
    -- 'starter' | 'pro' | 'agency' (siehe lib/server/billing/plans.js)
  trial_ends_at          TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,

  -- Usage-Limits
  generations_used_this_period INT NOT NULL DEFAULT 0,
  generations_quota_override   INT,
  last_generation_at           TIMESTAMPTZ
);

CREATE INDEX users_stripe_customer_idx ON users (stripe_customer_id);
CREATE INDEX users_stripe_subscription_idx ON users (stripe_subscription_id);
```

`CITEXT` macht die E-Mail case-insensitiv. Extension einmalig anlegen:

```sql
CREATE EXTENSION IF NOT EXISTS citext;
```

**`migrations/002_sessions.sql`** — Standard-Schema von `connect-pg-simple`:

```sql
CREATE TABLE sessions (
  sid    VARCHAR     NOT NULL PRIMARY KEY,
  sess   JSON        NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX sessions_expire_idx ON sessions (expire);
```

**`migrations/003_generations.sql`**

```sql
CREATE TABLE generations (
  id            SERIAL PRIMARY KEY,
  user_id       INT REFERENCES users(id) ON DELETE CASCADE,
  template_id   TEXT NOT NULL,
  prompt        TEXT,
  result_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX generations_user_idx ON generations (user_id, created_at DESC);
```

**`migrations/004_stripe_events.sql`** — für Webhook-Idempotenz:

```sql
CREATE TABLE stripe_events (
  id          TEXT PRIMARY KEY,          -- Stripe event.id
  type        TEXT NOT NULL,
  user_id     INT REFERENCES users(id),
  payload     JSONB NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Schichten-Trennung Auth ↔ Stripe

Regel: `lib/server/auth/` kennt nur die Basis-Spalten (id, email, password_hash).
`lib/server/billing/` schreibt und liest die `stripe_*`-Spalten. Beide reden
nur über das `users`-Repo (`lib/server/db/users.js`).

```js
// lib/server/db/users.js
const { pool } = require("./pool");

async function createUser({ email, passwordHash }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash)
     VALUES ($1, $2) RETURNING id, email, created_at`,
    [email, passwordHash]
  );
  return rows[0];
}

async function findByEmail(email) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
  return rows[0] || null;
}

async function attachStripe(userId, { customerId, subscriptionId, plan, status, periodEnd }) {
  await pool.query(
    `UPDATE users SET
       stripe_customer_id     = $1,
       stripe_subscription_id = $2,
       subscription_plan      = $3,
       subscription_status    = $4,
       current_period_end     = $5,
       updated_at             = NOW()
     WHERE id = $6`,
    [customerId, subscriptionId, plan, status, periodEnd, userId]
  );
}

module.exports = { createUser, findByEmail, attachStripe, /* ... */ };
```

Auth schreibt nur die linken Spalten, Billing nur die rechten. Niemand
muss bei Stripe-Integration Auth-Code anfassen.

### Express einführen — wann und wie

Native `http` reicht für Bildgenerierung; sobald Sessions ins Spiel kommen,
lohnt Express. Migrationspfad:

```js
// server.js (Phase 1)
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(session({
  store: new pgSession({ pool: require("./lib/server/db/pool").pool, tableName: "sessions" }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    domain: process.env.COOKIE_DOMAIN || undefined,  // ".nightkit.de" in prod
    maxAge: 1000 * 60 * 60 * 24 * 30,
  },
}));

app.use("/api/auth",    require("./lib/server/auth/routes"));
app.use("/api/billing", require("./lib/server/billing/routes"));   // Phase 2
app.use("/api/templates", require("./lib/server/templates/routes"));
// ... weitere Routes
app.use(require("./lib/server/static").middleware());

app.listen(process.env.PORT || 3000);
```

Die bestehenden `lib/`-Module bleiben — sie werden als Express-Handler
gewrappt, die Logik wandert nicht.

### Auth-Routen (Phase 1)

```js
// lib/server/auth/routes.js
const router = require("express").Router();
const { register, login } = require("./service");

router.post("/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: "Email und Passwort (>=8) erforderlich" });
  }
  try {
    const user = await register({ email, password });
    req.session.userId = user.id;
    res.json({ user: { id: user.id, email: user.email } });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Email bereits registriert" });
    throw e;
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await login({ email, password });
  if (!user) return res.status(401).json({ error: "Email oder Passwort falsch" });
  req.session.userId = user.id;
  res.json({ user: { id: user.id, email: user.email } });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/me", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not logged in" });
  const user = await require("../db/users").findById(req.session.userId);
  res.json({ user: { id: user.id, email: user.email, plan: user.subscription_plan, status: user.subscription_status } });
});

module.exports = router;
```

### Stripe-Anschluss (Phase 2)

Keine Änderung an Auth nötig. Zusätzlich:

```js
// lib/server/billing/routes.js
router.post("/checkout", requireAuth, async (req, res) => {
  const user = await db.users.findById(req.session.userId);
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } });
    customerId = customer.id;
    await db.users.setStripeCustomerId(user.id, customerId);
  }
  const sess = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: plans[req.body.plan].stripePriceId, quantity: 1 }],
    success_url: `${process.env.BASE_URL}/app?welcome=1`,
    cancel_url:  `${process.env.BASE_URL}/pricing`,
    subscription_data: { trial_period_days: 7 },
  });
  res.json({ url: sess.url });
});

router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET); }
  catch (e) { return res.status(400).send("Bad signature"); }

  if (await db.stripeEvents.exists(event.id)) return res.json({ ok: true });  // Idempotenz
  await db.stripeEvents.insert(event);

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await syncSubscriptionToUser(event.data.object);
      break;
    case "customer.subscription.deleted":
      await markUserCanceled(event.data.object);
      break;
  }
  res.json({ received: true });
});
```

### Gating

```js
// lib/server/billing/middleware.js
async function requireSubscription(req, res, next) {
  const user = await db.users.findById(req.session.userId);
  const active = ["active", "trialing"].includes(user.subscription_status);
  if (!active) return res.status(402).json({ error: "Abo erforderlich", upgrade: "/pricing" });
  next();
}

// in /api/generate:
router.post("/generate", requireAuth, requireSubscription, async (req, res) => { ... });
```

In der MVP-Phase (vor Stripe) kann `requireSubscription` auf einen
einfachen Quota-Check umgestellt werden (3 Generierungen gratis):

```js
async function requireQuota(req, res, next) {
  const user = await db.users.findById(req.session.userId);
  if (user.subscription_status === "active") return next();
  const limit = user.generations_quota_override || 3;
  if (user.generations_used_this_period >= limit) {
    return res.status(402).json({ error: "Kostenloses Limit erreicht", upgrade: "/pricing" });
  }
  next();
}
```

---

## 3. Template-System

### Template-Format

Jedes Template lebt in einem eigenen Ordner unter `templates/<kategorie>/<id>/`
und enthält drei Dateien:

- `source.png` — das Original, das zur Bild-KI geschickt wird (volle Auflösung)
- `thumb.jpg` — kleine Vorschau für die Template-Auswahl im Generator
- `template.json` — Manifest mit Metadaten

**`templates/halloween/blood-drip/template.json`**

```json
{
  "name": "Blood Drip Halloween",
  "description": "Dunkler Horror-Flyer mit Blutspritzern",
  "tags": ["halloween", "horror"],
  "aspectRatio": "9x16",
  "fields": ["name", "date", "djs", "time", "entry"],
  "promptHints": {
    "style": "horror, dark, cinematic",
    "preserve": ["blood splatter", "candle smoke"]
  },
  "version": 1
}
```

Pflichtfelder im Manifest: `name`. Alles andere optional mit Defaults.

### Auto-Discovery beim Start

```js
// lib/server/templates/registry.js
const fs = require("fs/promises");
const path = require("path");
const { parseManifest } = require("./manifest");

const ROOT = path.join(__dirname, "..", "..", "..", "templates");
let cache = null;

async function discover() {
  const out = [];
  const cats = await fs.readdir(ROOT, { withFileTypes: true });
  for (const cat of cats) {
    if (!cat.isDirectory() || cat.name.startsWith("_")) continue;
    const catDir = path.join(ROOT, cat.name);
    const items = await fs.readdir(catDir, { withFileTypes: true });
    for (const item of items) {
      if (!item.isDirectory()) continue;
      const dir = path.join(catDir, item.name);
      try {
        const manifest = parseManifest(JSON.parse(
          await fs.readFile(path.join(dir, "template.json"), "utf8")
        ));
        out.push({
          id: `${cat.name}/${item.name}`,
          category: cat.name,
          ...manifest,
          source: `/templates/${cat.name}/${item.name}/source.png`,
          thumb:  `/templates/${cat.name}/${item.name}/thumb.jpg`,
        });
      } catch (e) {
        console.warn(`[templates] Skipped ${cat.name}/${item.name}: ${e.message}`);
      }
    }
  }
  return out;
}

async function list() {
  if (!cache) cache = await discover();
  return cache;
}

async function get(id) {
  const all = await list();
  return all.find((t) => t.id === id) || null;
}

function clearCache() { cache = null; }

module.exports = { list, get, clearCache };
```

`parseManifest` validiert Pflichtfelder und füllt Defaults — kaputte
Templates werden geloggt und übersprungen, der Server startet trotzdem.

In Development kann `fs.watch(ROOT, { recursive: true })` den Cache
invalidieren. Production: Cache hält bis Restart, das ist OK für die
geringen Update-Frequenzen.

### Kategorien

Ergeben sich aus den Top-Level-Ordnern. Pretty Labels über optionales
`templates/_meta.json`:

```json
{
  "techno":    "Techno",
  "house":     "House",
  "hiphop":    "Hip-Hop",
  "rnb":       "R&B",
  "halloween": "Halloween",
  "minimal":   "Minimal"
}
```

```js
// lib/server/templates/registry.js (Erweiterung)
async function categories() {
  const meta = await readJsonSafe(path.join(ROOT, "_meta.json"), {});
  const templates = await list();
  const seen = new Set(templates.map((t) => t.category));
  return Array.from(seen).map((id) => ({ id, label: meta[id] || id }));
}
```

### API

```
GET  /api/templates              → { templates: [...], categories: [...] }
GET  /api/templates/:cat/:id     → { template: {...} }
GET  /templates/:cat/:id/thumb.jpg → static
GET  /templates/:cat/:id/source.png → static (nur für Ideogram)
```

`source.png` darf öffentlich sein — kein Schaden, wenn jemand das
Original lädt. Wenn du Templates später kommerziell schützen willst,
verschiebt sich `source.png` hinter Auth.

### Vorschau im Tool

Bleibt wie heute: Client lädt `thumb.jpg`, malt Text-Overlay live auf
Canvas. `thumb.jpg` ist klein (~30 KB), Browser cached aggressiv.

### Generierung-Flow

```
1. Client wählt Template aus, Nutzer füllt Felder
2. POST /api/generate { templateId: "halloween/blood-drip", fields: {...} }
3. Server lädt template.json + source.png aus Registry
4. Server baut Prompt: buildPrompt(fields, manifest.promptHints)
5. Server schickt source.png + Prompt an Ideogram
6. Job läuft im Hintergrund, Client pollt /api/status/:jobId
7. Ergebnis wird in `generations` geloggt (user_id, template_id, result_url)
```

`buildPrompt(fields, hints)` bekommt zusätzlich `hints` aus dem Manifest
und kann damit Template-spezifische Anweisungen einbauen (z.B. "preserve
blood splatter when replacing text").

### Neues Template hinzufügen — wirklich nur 3 Schritte

```
1. mkdir templates/<kategorie>/<id>
2. Kopiere source.png + thumb.jpg in den Ordner
3. Schreibe template.json mit Name + Tags
```

Restart genügt — die Auto-Discovery findet es. Ein optionales
`scripts/add-template.sh` kann das scaffolden.

---

## 4. Landing-Demo

Eine animierte Demo-Sektion auf der Landing Page, die zeigt:
Template → Texteingabe → Generierung → Ergebnis → Video-Export → Caption.

### Technischer Ansatz

- **Pre-rendered Assets** — kein echter API-Call. Die "generierten" Flyer
  liegen als statische Bilder unter `public/assets/demo/` (1 reales
  Ideogram-Ergebnis pro Demo-Step).
- **Scrollytelling** — sticky Section, IntersectionObserver triggert
  Steps; alternativ Auto-Play mit Loop.
- **CSS + Canvas** — Tipp-Animation per JS-Timer, Result-Fade per CSS,
  Video-Loop per `<video autoplay loop muted>` mit kurzem MP4 (~3s, 200 KB).

### State-Machine

```js
// public/js/landing/demo.js
const STEPS = [
  { id: "intro",        ms: 800 },
  { id: "show-template",ms: 1200 },
  { id: "type-name",    text: "Halloween Night",          ms: 1400 },
  { id: "type-date",    text: "31.10.2026",               ms: 800 },
  { id: "type-djs",     text: "Crazy Cutz, Marveles",     ms: 1400 },
  { id: "generating",   ms: 2200 },
  { id: "reveal",       ms: 1800 },
  { id: "video",        ms: 3200 },
  { id: "caption",      ms: 2800 },
  { id: "outro",        ms: 1200 },
];

class Demo {
  constructor(root) {
    this.root = root;
    this.idx = 0;
    this.running = false;
  }
  start() { this.running = true; this.tick(); }
  stop()  { this.running = false; }
  async tick() {
    while (this.running) {
      const step = STEPS[this.idx];
      this.root.dataset.step = step.id;
      await this.run(step);
      this.idx = (this.idx + 1) % STEPS.length;
    }
  }
  async run(step) {
    if (step.text) await typeInto(this.root.querySelector(`[data-field="${step.id.replace("type-","")}"]`), step.text);
    await sleep(step.ms);
  }
}

new IntersectionObserver((entries) => {
  for (const e of entries) {
    const demo = e.target._demo ||= new Demo(e.target);
    if (e.isIntersecting) demo.start(); else demo.stop();
  }
}, { threshold: 0.3 }).observe(document.getElementById("demo"));
```

### HTML-Struktur

```html
<section class="demo" id="demo">
  <div class="demo-frame">
    <!-- Mock-UI vom Generator -->
    <div class="demo-form">
      <input data-field="name" readonly>
      <input data-field="date" readonly>
      <input data-field="djs"  readonly>
    </div>
    <div class="demo-stage">
      <img class="demo-template" src="/assets/demo/template.jpg">
      <img class="demo-result"   src="/assets/demo/result.jpg">
      <video class="demo-video" src="/assets/demo/result.mp4" muted loop playsinline></video>
      <div class="demo-caption">"Halloween Night – 31.10. Wer fehlt? @crazycutz @marveles"</div>
    </div>
  </div>
  <div class="demo-captions">
    <p data-step-active="show-template">1. Template auswählen</p>
    <p data-step-active="type-name type-date type-djs">2. Event-Daten eintragen</p>
    <p data-step-active="generating reveal">3. KI generiert Flyer</p>
    <p data-step-active="video">4. Video-Export auf einen Klick</p>
    <p data-step-active="caption">5. Caption automatisch erstellt</p>
  </div>
</section>
```

CSS regelt Sichtbarkeit per Step:

```css
.demo-result, .demo-video, .demo-caption { opacity: 0; transition: opacity .5s; }
.demo[data-step="reveal"]  .demo-result   { opacity: 1; }
.demo[data-step="video"]   .demo-video    { opacity: 1; }
.demo[data-step="caption"] .demo-caption  { opacity: 1; }
.demo-captions p { opacity: .25; transition: opacity .3s; }
.demo-captions p[data-active] { opacity: 1; }
```

`typeInto(el, text)` ist eine 10-Zeilen-Funktion, die Buchstabe für
Buchstabe in das Input setzt mit ~50ms Delay.

### Performance

- `result.mp4` < 300 KB, kurz und loopt
- Assets lazy-loaded, Demo startet erst beim Scrollen in den Viewport
- `prefers-reduced-motion: reduce` → Auto-Animation aus, statische Reihenfolge

---

## 5. Skalierung — was jetzt richtig sitzen muss

### a) Eigene Domain (nightkit.de)

Was jetzt schon richtig sein muss:

- **Keine absoluten URLs im Code**. Wo Links auf das eigene System
  zeigen, immer relativ (`/app` statt `https://nightkit.onrender.com/app`).
- Wo doch Absolutes nötig ist (Stripe-Redirect, OG-Tags), `process.env.BASE_URL`
  benutzen.
- Cookie-Domain via Env: `COOKIE_DOMAIN=.nightkit.de` in Production,
  leer in Dev.
- `app: trust proxy = 1` setzen, damit `req.secure` hinter Render-LB
  korrekt ist.

Render → eigene Domain: CNAME `www.nightkit.de` auf
`<service>.onrender.com`, im Render-Dashboard Custom Domain anlegen,
TLS macht Render automatisch. Code-Änderung = `BASE_URL` und
`COOKIE_DOMAIN` setzen.

In den aktuellen `landing.html`-Buttons stehen bereits absolute Links auf
`nightkit.onrender.com` — die müssen vor dem Domain-Switch auf relative
Pfade umgestellt werden.

### b) Mehr Templates

Schon in Kapitel 3 designt. Wichtig zusätzlich:

- Pro Template < 3 MB Gesamtgröße (source.png + thumb.jpg)
- Wenn die Bibliothek auf > 50 Templates wächst: Templates in eine
  CDN-fähige Storage (R2, S3), `template.json` bleibt im Repo,
  `source` / `thumb` zeigen auf CDN-URL
- API `/api/templates` paginieren wenn > 100 Templates

### c) Video-Export

Heute komplett im Browser (VideoEncoder + mp4-muxer). Skaliert für
moderne Chrome/Edge/Safari problemlos. Wenn du serverseitig willst
(Firefox-User, schwache Geräte):

- `lib/server/video/render.js` rendert Frames in Headless-Chromium
  (Puppeteer) oder direkt mit `node-canvas` (kein Browser nötig, schneller)
- Encoder bleibt `ffmpeg-static` (existiert schon in `lib/server/convert.js`)
- Background-Queue via Redis BullMQ wenn > 5 Exporte parallel laufen

Für MVP nicht nötig — client-side reicht.

### d) Caption-Erstellung

```js
// lib/server/ai/caption.js (Phase 3)
const Anthropic = require("@anthropic-ai/sdk");
const client = new Anthropic();

async function generateCaptions({ eventName, date, djs, vibe }) {
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [{
      role: "user",
      content: `Erzeuge 3 kurze Instagram-Captions (max 200 Zeichen) für ein Club-Event:
Event: ${eventName} am ${date}
DJs: ${djs}
Vibe: ${vibe || "energetic"}
Format: JSON-Array von Strings, keine Hashtags inline, am Ende 3-5 Hashtags.`
    }],
  });
  return JSON.parse(msg.content[0].text);
}
```

API: `POST /api/caption` body `{ eventName, date, djs }`, gated wie
`/api/generate`. Cache nicht nötig — Generierung kostet 0.1 ct pro Call.

### e) Stripe-Abo

Schon in Kapitel 2 designt. Was jetzt schon richtig sitzen muss:

- DB-Spalten existieren (siehe `migrations/001_users.sql`)
- `subscription_status` ist nie `NULL`, immer `'free'` als Default →
  Code muss nie auf NULL prüfen
- `requireQuota` (MVP) und `requireSubscription` (mit Stripe) sind
  zwei verschiedene Middlewares im selben `billing/`-Modul — die Route
  bleibt gleich, nur die Middleware wird ausgetauscht

### Beobachten / Logs

Render zeigt stdout. Wichtig:

- `console.log(JSON.stringify({ event, userId, ... }))` statt
  unstrukturierter Strings, sobald > 100 Generierungen/Tag
- Pro Generation in `generations` loggen — gibt dir Reports ohne extra
  Tooling

---

## 6. Empfohlene Reihenfolge zum zahlenden Kunden

Realistisch: Phase 1 + 2 = 2-3 Wochen zu MVP mit Trial-Limit;
Phase 3 = +1 Woche bis erste echte Stripe-Zahlung.

### Phase 0 — Done

- [x] Backend modular
- [x] Frontend modular
- [x] Basis-Template-System

### Phase 1 — Auth + DB (Tage 1-5)

1. Render PostgreSQL anlegen, `DATABASE_URL` ins Env
2. `pg`, `bcrypt`, `express`, `express-session`, `connect-pg-simple` installieren
3. `lib/server/db/pool.js`, `migrate.js`, `users.js` schreiben
4. `migrations/001_users.sql`, `002_sessions.sql`, `003_generations.sql`,
   `004_stripe_events.sql` schreiben
5. `npm run migrate` Skript anlegen (führt Migrationen idempotent aus)
6. Express einführen, Session-Middleware konfigurieren
7. `lib/server/auth/` mit register, login, logout, /me
8. `public/login.html`, `public/account.html` + JS
9. `requireAuth` Middleware vor `/api/generate`
10. `generations` bei jedem erfolgreichen Job loggen

**Akzeptanzkriterium**: User kann sich registrieren, einloggen,
generieren, sieht eigene letzte Flyer.

### Phase 2 — Quota + Pricing (Tage 6-10)

1. `requireQuota` Middleware (3 kostenlose Generierungen)
2. `generations_used_this_period` zählen, `last_generation_at` setzen
3. Account-Seite zeigt "X von 3 verbleibend"
4. `pricing.html` mit Preis und CTA "Jetzt freischalten"
5. Wenn Quota erreicht → 402 → Pricing-Seite

**Akzeptanzkriterium**: Mensch nutzt 3× gratis, sieht dann Paywall.
Funktioniert ohne Stripe.

### Phase 3 — Stripe (Tage 11-15)

1. Stripe-Account, Product "NightKit Pro €149/Mo", Test- und Live-Keys
2. `lib/server/billing/` mit `stripe.js`, `routes.js`, `webhook.js`
3. Webhook-Endpoint öffentlich, Signatur prüfen, Events idempotent verarbeiten
4. Checkout-Flow: Button auf `pricing.html` → POST `/api/billing/checkout` → redirect
5. Stripe-Customer-Portal für Cancellation: `/api/billing/portal` → redirect
6. `requireSubscription` Middleware ersetzt `requireQuota` für `/api/generate`
7. `subscription_status` Banner in Account zeigt active / past_due / trial

**Akzeptanzkriterium**: Echter Bezahlvorgang mit Test-Karte funktioniert
end-to-end. Webhook setzt User auf `active`. `/api/generate` läuft.

### Phase 4 — Template-Ausbau (Tage 16-20)

1. `templates/` Auto-Discovery aus Kapitel 3 implementieren
2. 5-10 reale Templates pro Kategorie produzieren (techno, house, hiphop, halloween)
3. Filter-UI im Generator schon vorhanden — funktioniert dann mit echten Daten

**Akzeptanzkriterium**: User wählt aus echter Bibliothek statt 1 Default.

### Phase 5 — Landing-Demo + Domain (Tage 21-25)

1. Demo-Sektion aus Kapitel 4
2. Eigene Domain nightkit.de auf Render verlinken
3. `BASE_URL`, `COOKIE_DOMAIN` in Production-Env setzen
4. Absolute Links in Landing entfernen
5. OG-Tags + Twitter-Card-Bild

**Akzeptanzkriterium**: nightkit.de zeigt überzeugende Demo, leitet
zum Generator weiter.

### Phase 6 — Caption + Polish (Tage 26-30)

1. `/api/caption` Endpoint
2. Caption-UI im Generator nach erfolgreicher Generierung
3. Onboarding-Email (Welcome + Reset Password)
4. Erste echte Kunden ansprechen (Beta-Liste, Cold Outreach lokal)

---

## 7. Anhang: Env-Variablen

```
# .env.example

# Core
PORT=3000
NODE_ENV=development
BASE_URL=http://localhost:3000

# Auth
SESSION_SECRET=<32-byte-random>
COOKIE_DOMAIN=

# Database
DATABASE_URL=postgres://localhost/nightkit_dev

# AI
IDEOGRAM_API_KEY=
ANTHROPIC_API_KEY=               # Phase 6 (Captions)

# Stripe (Phase 3)
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO=price_xxx
```

In Production auf Render: dieselben Variablen, mit Live-Werten.

---

## 8. Was dieser Plan bewusst NICHT vorschreibt

- **Kein Frontend-Framework** — Vanilla JS + ES-Module reichen für die
  geplante Komplexität. React/Vue erst, wenn echte Datenmodelle im
  Frontend leben.
- **Kein ORM** — `pg` direkt mit Template-Literals. Bei < 10 Tabellen
  zahlt sich Prisma/Drizzle nicht aus.
- **Keine Background-Queue** — `lib/server/jobs.js` (in-memory) reicht,
  bis du > 5 parallele Generierungen hast. Dann Redis + BullMQ.
- **Keine Tests-Pflicht** — schreiben, wenn ein Bug zweimal kommt. Für
  reine Flyer-UI ist E2E (Playwright) wertvoller als Unit-Tests.

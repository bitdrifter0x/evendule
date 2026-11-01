# Evendule

A ticketing platform built as microservices, engineered around one promise: **you can never oversell a ticket.** A hot event goes on sale, thousands of people hit **Book** in the same second, and only 50 tickets exist. Evendule makes sure exactly 50 of them get a booking, and everyone else lands on a waitlist that promotes them automatically if a seat frees up.

Users browse events, book general admission or pick seats on a seat map, join waitlists and get notified. Admins manage events and watch live analytics. Behind it sit a gateway and four services (auth, catalog, booking, notify) on Postgres and Redis, with a React + Chakra UI frontend.

---

## Table of Contents

1. [What this project proves](#what-this-project-proves)
2. [How to run it](#how-to-run-it)
3. [The demo flow](#the-demo-flow)
4. [Architecture](#architecture)
5. [The hard problems and how they're solved](#the-hard-problems-and-how-theyre-solved)
6. [Folder walkthrough](#folder-walkthrough)
7. [Tests](#tests)
8. [What's NOT real](#whats-not-real)
9. [Honest limitations](#honest-limitations)
10. [Troubleshooting](#troubleshooting)

---

## What this project proves

1. **Tickets are never oversold, even under a stampede.** 200 concurrent requests for 50 tickets produce exactly 50 bookings. 50 users racing for one seat produce exactly one winner. (One conditional `UPDATE` in a transaction, backed by a `CHECK` constraint.)
2. **Events are never lost and never applied twice.** A booking and the event announcing it commit together, and consumers apply each event exactly once. (Transactional outbox, Redis Streams, idempotent consumers.)
3. **Retries and races are safe.** A double-click can't double-book, and two admins editing the same event can't silently overwrite each other. (`Idempotency-Key` and `If-Match` versioning.)

---

## How to run it

**Prerequisite:** Docker (Docker Desktop on Windows/Mac). No local Node.js, Postgres or Redis needed.

```bash
docker compose up --build
```

The first run builds six images, so give it a few minutes.

| | |
|---|---|
| Web app | http://localhost:3000 |
| API docs (Swagger) | http://localhost:8080/docs |
| Service health | http://localhost:8080/health/services |
| Admin login | `admin@evendule.dev` / `admin12345` |

The admin account is created automatically on first start. Anyone else can register with **Create account**.

- `Ctrl+C` stops the stack.
- `docker compose down -v` stops it **and deletes the database** for a completely fresh start.

**Optional demo data** (needs Node.js 20.12+): a fresh stack has only the admin. To get sample events, users and a sold-out event with a waitlist, run with the stack up:

```bash
npm install
cp .env.example .env        # PowerShell: copy .env.example .env
npm run seed
```

This creates `alice@`, `bob@`, `carol@`, `dan@`, `erin@` and `frank@evendule.dev`, all with password `password123`.

---

## The demo flow

1. **Create an event as admin.** Sign in, open **Manage events**, create an event (general admission or reserved seating). The catalog service stores it and booking-service owns its capacity and seats.
2. **Book as a user.** Register, pick seats (or let the app choose the *best available* with your party kept together) and book. Check **My bookings** (with **Add to calendar**) and the notification bell. Every booking carries an `Idempotency-Key`, so a double-click returns the same booking.
3. **Waitlist promotion** *(seeded data)*. *Sunrise Yoga* is sold out, with Dan #1 on the waitlist (1 ticket) and Erin #2 (2 tickets). Cancel Alice's booking and refresh as Dan: he's booked automatically, marked "From waitlist". Erin keeps her place because only 1 ticket is free.
4. **Admin safety checks.** Try setting an event's capacity below the tickets already sold (refused with `CAPACITY_BELOW_BOOKED`). Open one event in two tabs and save both (the second gets a "someone else changed this" message). Then open **Analytics**: sales, revenue, utilization, daily trends and a green integrity badge.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                      BROWSER  (React + Chakra UI)                     │
└──────────────────────────────────┬────────────────────────────────────┘
                                   │ http://localhost:3000  (nginx)
                                   ▼
┌───────────────────────────────────────────────────────────────────────┐
│  GATEWAY :8080   auth check · rate limiting · routing · Swagger UI    │
└───────┬─────────────────┬─────────────────┬─────────────────┬─────────┘
        ▼                 ▼                 ▼                 ▼
 ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
 │ auth  :4001 │   │catalog :4002│   │booking :4003│   │notify  :4004│
 │ users, JWT  │   │ events,     │──▶│ capacity,   │   │notifications│
 │             │   │ search      │   │ seats,      │   │ + analytics │
 │             │   │             │   │ bookings,   │   │ read models │
 │             │   │             │   │ waitlist    │   │             │
 └──────┬──────┘   └──────┬──────┘   └──────┬──────┘   └──────▲──────┘
        │                 │      sync       │ outbox          │ consume
        │                 │  capacity check │                 │
        ▼                 ▼                 ▼                 │
 ┌───────────────────────────────────────────────┐   ┌───────┴───────┐
 │   PostgreSQL 17  (one schema per service)     │   │  Redis 7      │
 │   outbox table lives next to the data         │──▶│  Streams,     │
 └───────────────────────────────────────────────┘   │  cache, rates │
                                                     └───────────────┘
```

Services are stateless. They call each other over HTTP only when the caller needs an immediate yes or no, and communicate through Redis Streams for everything else. The machine-readable API spec is [`services/gateway/openapi.yaml`](services/gateway/openapi.yaml), served as Swagger UI at `/docs`.

---

## The hard problems and how they're solved

### 1. Two people buy the last ticket at the same instant

Reading the remaining count, checking it, then writing the new count lets two requests both read "1 left" and both succeed.

**Solution: one conditional update that checks and writes together.**

```sql
UPDATE inventory
   SET booked_count = booked_count + n
 WHERE event_id = … AND booked_count + n <= capacity
```

Postgres row-locks the event, so concurrent buyers queue up and each one re-checks the guard against the latest committed value. If the guard fails, zero rows change and the booking is refused. A `CHECK` constraint backs it up in the schema. Optimistic locking was rejected here: on a hot event, collisions plus retries turn a stampede into a retry storm.

### 2. The booking succeeded, but the announcement got lost

Committing to the database and then publishing to Redis can lose the event if the process crashes in between.

**Solution: the transactional outbox.** The event is written to an `outbox` table in the same transaction as the booking, and a relay publishes it to Redis Streams afterwards. If Redis is down, bookings still commit and events wait. Delivery is at-least-once, so each consumer records processed event IDs in the same transaction as its own update. A duplicate is recognized and skipped, which makes the effect exactly-once.

### 3. Double-clicks and network retries

**Solution: idempotent bookings.** Every booking carries an `Idempotency-Key`. Repeating a request returns the original result instead of creating a second booking.

### 4. Two admins edit the same event

**Solution: optimistic locking with `If-Match`.** Each edit sends the version it started from, and if someone else saved first the server answers `412`. Capacity changes are checked synchronously against booking-service, so an edit that would drop capacity below tickets sold is rolled back.

### 5. Waitlist fairness

**Solution: promote inside the cancellation transaction.** Freed tickets go to waiting users in the same transaction as the cancellation, so nobody can snipe them. Promotion is first-fit, so a party that needs more tickets than are free doesn't block smaller requests behind it. Each promotion runs in a savepoint, so one failure can't undo the cancellation.

---

## Folder walkthrough

```
evendule/
├── services/
│   ├── gateway/           Public entry point: auth, rate limiting, routing, Swagger UI
│   ├── auth-service/      Users, registration, login, JWT
│   ├── catalog-service/   Event catalog, search, admin event management
│   ├── booking-service/   Capacity, seats, bookings, waitlist, calendar export
│   └── notify-service/    Notifications and analytics read models
├── frontend/              React 19 + Vite + Chakra UI app (theme in src/theme/system.ts)
├── packages/shared/       Shared library: HTTP, Postgres, outbox/streams, API contracts
├── scripts/               Seed data and the end-to-end load test
├── .github/workflows/     CI: type-check, tests, build, Docker image build
├── docker-compose.yml     Runs the whole stack
├── Dockerfile             Shared image for the backend services
└── .env.example           Template for local (non-Docker) development
```

---

## Tests

```bash
docker compose up -d postgres redis
npm test                                          # concurrency, integrity and API contract tests
npm run loadtest -- --users 250 --capacity 100    # end-to-end oversell check
```

These need Node.js and a running Postgres and Redis. The integration tests run against real Postgres. The load test pushes 250 users at 100 tickets through the whole stack and passes only if exactly 100 are sold and the integrity audit agrees. A contract test fails if the OpenAPI spec and the gateway routing disagree. CI runs everything on each push.

For hot-reload development, run `docker compose up -d postgres redis`, then `npm run dev` (web app at http://localhost:5173).

---

## What's NOT real

| In this project | In production |
|---|---|
| One Postgres and one Redis container | Managed services with replicas, backups and failover |
| Placeholder secrets in `docker-compose.yml` | Real secrets from a secret manager |
| Admin account with a published password | Provisioned admin with a unique password |
| No payment step: a booking is a reservation | Payment provider integration and refunds |
| Docker Compose on one machine | Orchestrator behind a load balancer |
| One booking-service database | Booking-service sharded by event |

The concurrency and event-delivery code is the production-shaped part. The infrastructure around it is what changes.

---

## Honest limitations

- **The booking service is the bottleneck by design.** One service owning capacity, seats and bookings is what makes overselling impossible, but every booking for an event passes through one database row. Scaling further means sharding by event.
- **Browsing can be a few seconds stale.** Availability on the event list is cached briefly, but booking always checks the live count.
- **First-fit promotion isn't strictly first-come.** A large party can wait longer than a smaller one behind them, which keeps tickets from sitting unused.
- **Overload shows up as fast `503`s, not queues.** Retries are safe because of idempotency keys.

---

## Troubleshooting

**`port is already allocated`**: something else is using `3000`, `8080`, `5432` or `6379`. Stop it, or change the left side of the mapping in `docker-compose.yml` (for example `"5433:5432"`).

**`npm error ECONNRESET` during the build**: the connection to the npm registry dropped. Run `docker compose up --build` again. Finished steps are cached.

**Can't log in as the admin**: the admin is created on first start. Run `docker compose down -v` to wipe the database and start fresh.

**`cp` is not recognized in PowerShell**: use `copy .env.example .env`.

---

**Tech stack:** Node.js, TypeScript, Express 5, PostgreSQL 17, Redis 7 (Streams, cache, rate limits), Zod, pino, JWT/bcrypt · React 19, Vite, Chakra UI v3, TanStack Query, React Router, Recharts · Docker, Docker Compose, GitHub Actions.
# coldTrace

coldTrace is an incident management platform for software engineering teams. It is built as a modular monolith to help engineering organizations monitor services, coordinate real-time incident triage and resolution, record updates, calculate dynamic service health, preserve an immutable audit history, and communicate status publicly.

---

## Features (Tier 1 MVP)

- **Authentication & Sessions**: Registration with bcrypt password hashing (cost factor 10), short-lived JWT access tokens (15m), and server-side revocable refresh sessions stored in PostgreSQL with rotation and instant revocation.
- **Organization & Membership Management**: Multi-tenant organizations with creator ADMIN assignment, member invitation of registered users, role updates, and last-administrator protection.
- **Role-Based Access Control (RBAC)**: Enforced permission matrix across `ADMIN`, `MEMBER`, and `VIEWER` roles.
- **Service Management**: Software service catalog with organization-scoped slugs and soft-deletion / archiving to preserve relational post-mortem history.
- **Incident Management**: Incident creation with `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` severity, assignments to organization members, and associations to multiple services.
- **Incident Lifecycle State Machine**: Deterministic lifecycle enforcement (`TRIGGERED → ACKNOWLEDGED → RESOLVED → CLOSED`) with concurrency protection.
- **Incident Updates & Audit Timeline**: Author-tracked updates with `INTERNAL` or `PUBLIC` visibility, chronological incident activity timeline, and organization-level audit log history.
- **Dynamic Service Health**: Automatic derivation of service health (`OPERATIONAL`, `DEGRADED`, `MAJOR_OUTAGE`) based on active incidents without external polling agents.
- **Public Status Page**: Unauthenticated public status page exposing real-time service health and public incident updates without leaking internal discussions, author emails, or database identifiers.
- **Integrated Frontend**: Clean, responsive, light-themed single-page interface built with vanilla HTML, CSS, and modern ES modules.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime & Language | Node.js 24, JavaScript (ES modules) |
| Backend Framework | Express.js 5 |
| Database | PostgreSQL 18 |
| ORM | Prisma ORM 7 with `@prisma/adapter-pg` driver adapter |
| Authentication | JSON Web Tokens (`jsonwebtoken`), `bcrypt` |
| Validation | Zod |
| Frontend | Vanilla HTML, CSS, JavaScript (no framework) |
| Testing | Node.js Test Runner (`node --test`), Supertest |
| API Tooling | Postman collection and environment |

---

## Architecture and Project Layout

```text
public/
  css/style.css             Responsive styling (light mode)
  js/api.js                 API fetch wrapper with JWT refresh rotation
  js/app.js                 SPA controller for authenticated workspace
  js/status.js              Controller for public status page
  index.html                Authenticated workspace template
  status.html               Public status page template
src/
  app.js                    Express application setup & routing
  server.js                 HTTP server listener
  config/prisma.js          Shared Prisma Client & pg driver adapter
  controllers/              HTTP request/response handlers
  middleware/               Auth, RBAC, Zod validation, error handling
  routes/                   Domain route definitions
  services/                 Business workflows, state machine, ACID transactions
  utils/                    Password, token, slug, and health calculation helpers
  validators/               Zod schema definitions
prisma/
  schema.prisma             Relational database models and indexes
  migrations/               Versioned SQL migrations
tests/                      Automated test suites (Node.js Test Runner + Supertest)
docs/
  architecture.md           System architecture and data flows
  engineering-decisions.md  Architectural Decision Records (ADR)
  interview-notes-tier-1.md Senior engineering interview guide
postman/
  coldtrace.postman_collection.json   Postman collection
  coldtrace.postman_environment.json  Postman environment template
```

---

## Local Setup

### Prerequisites
- Node.js 24+
- PostgreSQL 18+

### 1. Installation
```sh
npm install
```

### 2. Database Setup
Create local PostgreSQL databases and role:
```sql
CREATE ROLE coldtrace_app WITH LOGIN PASSWORD 'YOUR_PASSWORD';
CREATE DATABASE coldtrace_dev OWNER coldtrace_app;
CREATE DATABASE coldtrace_shadow OWNER coldtrace_app;
CREATE DATABASE coldtrace_test OWNER coldtrace_app;
```

### 3. Environment Configuration
Copy `.env.example` to `.env` and `.env.test`:
```sh
cp .env.example .env
```
Ensure `.env` contains:
```dotenv
PORT=4000
DATABASE_URL="postgresql://coldtrace_app:YOUR_PASSWORD@localhost:5432/coldtrace_dev?schema=public"
SHADOW_DATABASE_URL="postgresql://coldtrace_app:YOUR_PASSWORD@localhost:5432/coldtrace_shadow?schema=public"
JWT_SECRET="coldtrace-super-secret-development-jwt-key-2026"
JWT_ACCESS_EXPIRES_IN="15m"
REFRESH_TOKEN_EXPIRES_DAYS=7
NODE_ENV="development"
```

### 4. Apply Migrations & Generate Client
```sh
npx prisma migrate deploy
npx prisma generate
```

### 5. Start the Application
- Development mode (with file watcher):
  ```sh
  npm run dev
  ```
- Production mode:
  ```sh
  npm start
  ```
Visit the authenticated dashboard at `http://localhost:4000/` or the public status page at `http://localhost:4000/status/:orgSlug`.

---

## Running Tests

Run the full automated test suite (executed safely against dedicated `coldtrace_test` database):
```sh
npm test
```

All 71 integration and end-to-end tests verify:
- Registration, password hashing, and login
- JWT access tokens, session rotation, and logout revocation
- Organization creation and creator ADMIN role assignment
- Membership management and last-administrator protection
- Multi-tenant data isolation and IDOR prevention
- Service catalog CRUD and soft-deletion / archiving
- Incident creation, member assignment, and multi-service linking
- Valid and invalid incident lifecycle state transitions
- Internal and public incident updates with authorship
- Chronological incident activity and organization audit timelines
- Deterministic service-health derivation
- Public status page data isolation (preventing internal leaks)
- Frontend static asset delivery

---

## API Summary

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | Public | Register new user account |
| `POST` | `/api/auth/login` | Public | Authenticate user, return JWT + refresh cookie |
| `POST` | `/api/auth/refresh` | Public / Cookie | Rotate refresh session, issue new tokens |
| `POST` | `/api/auth/logout` | Public / Cookie | Revoke refresh session and clear cookie |
| `GET` | `/api/auth/me` | Authenticated | Get authenticated user profile |
| `POST` | `/api/organizations` | Authenticated | Create organization (assigns creator as ADMIN) |
| `GET` | `/api/organizations` | Authenticated | List organizations user belongs to |
| `GET` | `/api/organizations/:id` | Org Member | Get organization details |
| `GET` | `/api/organizations/:id/health` | Org Member | Get private system health rollup |
| `GET` | `/api/organizations/:id/members` | Org Member | List organization team members |
| `POST` | `/api/organizations/:id/members` | Org Admin | Add existing registered user to organization |
| `PATCH` | `/api/organizations/:id/members/:memberId` | Org Admin | Update member role |
| `DELETE` | `/api/organizations/:id/members/:memberId` | Org Admin | Remove member from organization |
| `GET` | `/api/organizations/:id/services` | Org Member | List active services |
| `POST` | `/api/organizations/:id/services` | Org Admin | Create new service |
| `GET` | `/api/organizations/:id/services/:serviceId` | Org Member | Get service details |
| `PATCH` | `/api/organizations/:id/services/:serviceId` | Org Admin | Update service details |
| `DELETE` | `/api/organizations/:id/services/:serviceId` | Org Admin | Archive service |
| `GET` | `/api/organizations/:id/incidents` | Org Member | List incidents (with pagination & filters) |
| `POST` | `/api/organizations/:id/incidents` | Admin / Member | Create incident |
| `GET` | `/api/organizations/:id/incidents/:incidentId` | Org Member | Get incident details |
| `PATCH` | `/api/organizations/:id/incidents/:incidentId` | Admin / Member | Update incident details |
| `POST` | `/api/organizations/:id/incidents/:id/acknowledge` | Admin / Member | Transition incident to ACKNOWLEDGED |
| `POST` | `/api/organizations/:id/incidents/:id/resolve` | Admin / Member | Transition incident to RESOLVED |
| `POST` | `/api/organizations/:id/incidents/:id/close` | Admin / Member | Transition incident to CLOSED |
| `POST` | `/api/organizations/:id/incidents/:id/updates` | Admin / Member | Post internal or public update |
| `GET` | `/api/organizations/:id/incidents/:id/updates` | Org Member | List incident updates |
| `GET` | `/api/organizations/:id/incidents/:id/timeline` | Org Member | Get chronological incident audit timeline |
| `GET` | `/api/organizations/:id/audit-logs` | Org Member | Get organization audit logs |
| `GET` | `/api/public/status/:orgSlug` | Public | Unauthenticated public status page data |

---

## Limitations and Future Scope (Tier 2 / Tier 3)

- **External Integrations**: Webhook ingestion (PagerDuty, Datadog, Slack, OpsGenie) is planned for Tier 2.
- **On-Call Scheduling**: Escalation policies and on-call rotation schedules are deferred to Tier 2.
- **Real-time Push**: Real-time WebSocket or Server-Sent Events (SSE) updates for live incident dashboards are planned for Tier 2.
- **Metrics & Post-Mortem Reports**: Mean Time to Acknowledge (MTTA), Mean Time to Resolve (MTTR), and automated post-mortem document generation belong to Tier 3.

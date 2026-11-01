# coldTrace — Senior Engineering Interview Guide (Tier 1 MVP)

This document prepares you for technical interviews based on the actual architecture, code, and trade-offs implemented in coldTrace.

---

## 1. Authentication vs Authorization

- **In coldTrace**:
  - *Authentication* (`src/middleware/auth.middleware.js`): Verifies identity by validating the JWT Bearer token and checking that the user exists in PostgreSQL. Sets `req.user = { id, email, name }`.
  - *Authorization* (`src/middleware/rbac.middleware.js`): Verifies access rights by checking whether `req.user.id` has an active membership row in the target organization and whether their role (`ADMIN`, `MEMBER`, `VIEWER`) permits the action.
- **Why this way**: Separating authentication from authorization prevents conflating identity with organizational tenancy. A user is authenticated once per request, but can belong to multiple organizations with different roles in each.
- **Interview Question**: *"What is the difference between 401 Unauthorized and 403 Forbidden?"*
  - **Sample Answer**: *"401 Unauthorized actually means unauthenticated—the client did not provide valid credentials, or the token is missing/expired. 403 Forbidden means the server recognizes who the client is, but that authenticated user does not have permission to access that specific resource. In coldTrace, an invalid JWT returns 401, while a valid user attempting to modify another company's service or a VIEWER attempting to create an incident returns 403."*
- **Follow-up Question**: *"Should you return 403 or 404 when a user requests an ID they don't have access to?"*
  - **Sample Answer**: *"Returning 404 instead of 403 prevents entity enumeration (an attacker discovering which IDs exist by fishing for 403s vs 404s). In coldTrace, if a resource does not belong to the user's organization, we return 404."*

---

## 2. JWT vs Session-Based Authentication

- **In coldTrace**: Hybrid model. Short-lived (15-minute) stateless JWT access tokens for API requests, combined with stateful, server-side revocable refresh sessions stored in PostgreSQL and delivered via `httpOnly` cookies.
- **Why this way**: Avoids database lookups on 99% of requests while retaining the ability to immediately revoke refresh sessions on logout or account compromise.
- **Interview Question**: *"Why not just use stateless JWTs with a 7-day expiration?"*
  - **Sample Answer**: *"Pure stateless JWTs have an unavoidable revocation problem. Once signed, a token remains valid until it expires. If a user logs out, changes their password, or gets their token intercepted, you cannot revoke that token without building a distributed denylist, which turns your stateless tokens into stateful tokens anyway. By pairing 15-minute JWTs with a revocable refresh session stored in PostgreSQL, coldTrace bounds the vulnerability window to at most 15 minutes while keeping API request latency sub-millisecond."*
- **Follow-up Question**: *"Where should tokens be stored on the frontend?"*
  - **Sample Answer**: *"Access tokens should be stored in memory or short-lived sessionStorage, never in long-lived localStorage where they are vulnerable to XSS. Refresh tokens should be kept in httpOnly, SameSite=Lax, Secure cookies, which JavaScript cannot read."*

---

## 3. bcrypt and Password Hashing

- **In coldTrace**: `bcrypt.hash(password, 10)` in `src/utils/password.js`. Salt rounds = 10 (~65ms hashing time).
- **Why this way**: bcrypt incorporates an adaptive work factor and per-user random salt, defeating precomputed rainbow tables and high-speed ASIC / GPU brute-forcing.
- **Interview Question**: *"Why can't we hash passwords with SHA-256 or MD5?"*
  - **Sample Answer**: *"SHA-256 and MD5 are cryptographic digest algorithms designed to be as fast as possible for data integrity. A modern GPU cluster can compute over 100 billion SHA-256 hashes per second, making dictionary attacks trivial. Password hashing algorithms like bcrypt and Argon2 are deliberately designed to be computationally slow and tunable via work factors."*
- **Follow-up Question**: *"What happens if you increase bcrypt cost to 16?"*
  - **Sample Answer**: *"Each increment in bcrypt cost factor doubles the hashing time ($2^{\text{cost}}$ iterations). At cost 10, hashing takes ~65ms. At cost 16, hashing takes $2^6 = 64$ times longer (~4 seconds per hash), which would saturate Node's CPU event loop under concurrent registration requests and cause denial-of-service."*

---

## 4. Express Middleware Architecture

- **In coldTrace**: Composed pipeline:
  `express.json() -> cookieParser() -> route -> authenticate -> requireOrgMember -> requireRole -> validate -> controller -> errorHandler`.
- **Why this way**: Keeps controllers thin and guarantees cross-cutting security checks happen before any controller or business logic runs.
- **Interview Question**: *"How does Express centralized error handling work?"*
  - **Sample Answer**: *"Express recognizes an error-handling middleware by its 4-parameter signature: `(err, req, res, next)`. When an error is thrown or passed via `next(err)` anywhere in the chain, Express bypasses all remaining route handlers and jumps straight to the error handler. In coldTrace, our `errorHandler` maps `AppError` status codes and strips internal stack traces from 500 errors to prevent leaking database details to clients."*

---

## 5. Role-Based Access Control (RBAC)

- **In coldTrace**: Organization-level permissions: `ADMIN`, `MEMBER`, `VIEWER`.
- **Interview Question**: *"How do you test RBAC effectively?"*
  - **Sample Answer**: *"We test both positive and negative authorization matrices. For every endpoint, we test: (1) an authorized ADMIN succeeds, (2) an authorized MEMBER succeeds or receives 403 based on the permission matrix, (3) a VIEWER receives 403 on mutations, and (4) an authenticated user outside the organization receives 403 on tenant entry."*

---

## 6. Multi-Tenancy & IDOR Defense

- **In coldTrace**: Tenant isolation enforced at the data layer by requiring `where: { id, organizationId }` on every query.
- **Interview Question**: *"What is an Insecure Direct Object Reference (IDOR) and how did you prevent it in coldTrace?"*
  - **Sample Answer**: *"An IDOR occurs when an application retrieves a record using an untrusted client-supplied identifier without verifying that the requesting user owns or has access to that record. For example, if User A in Organization 1 changes the URL from `/api/organizations/1/incidents/100` to `/api/organizations/2/incidents/200`. In coldTrace, we prevent IDOR via two layers: first, `requireOrgMember` verifies the caller's membership in Organization 2; second, every database query includes `where: { id: incidentId, organizationId }`. Even if a user knows an ID from another organization, the query returns 404."*

---

## 7. Primary Keys: UUID vs Auto-Incrementing Integers

- **In coldTrace**: UUIDv4 primary keys across all tables (`@id @default(uuid()) @db.Uuid`).
- **Why this way**:
  - Prevents ID scraping/enumeration attacks (an attacker cannot guess the next incident or organization ID by incrementing `+1`).
  - IDs can be generated on the client or application layer before writing to the database.
  - Safe for distributed sharding and database migrations.
- **Trade-off**: UUIDs consume 16 bytes vs 4/8 bytes for integers, and random UUIDv4 can cause B-tree index fragmentation at massive scale (mitigated in PostgreSQL by UUID column type).

---

## 8. Many-to-Many Relationships & Junction Models

- **In coldTrace**: `IncidentService` junction table connecting `incidents` and `services`.
- **Why this way**: An incident can affect multiple services, and a service can experience multiple incidents. We used an explicit model (`IncidentService`) with `@@unique([incidentId, serviceId])` and reverse index `@@index([serviceId, incidentId])` so we can query in both directions (find all services for an incident, or find all incidents for a service).

---

## 9. Database Indexing Strategy

- **Interview Question**: *"How did you decide which columns to index in coldTrace?"*
  - **Sample Answer**: *"Indexes in coldTrace directly reflect query patterns and filter clauses:
    1. Composite index `(organization_id, status, created_at)` on `incidents`: Supports filtering active incidents by status sorted chronologically without in-memory sorting.
    2. Compound unique index `(organization_id, slug)` on `services`: Enforces that service slugs are unique within an organization while permitting identical slugs in different organizations.
    3. Compound index `(service_id, incident_id)` on `incident_services`: Enables fast lookups of active incidents for health rollups.
    Every index adds a write penalty, so we only added indexes justified by actual query access patterns."*

---

## 10. Database Transactions and ACID

- **In coldTrace**: `prisma.$transaction(async (tx) => { ... })`.
- **Interview Question**: *"Where did you use transactions in coldTrace and why?"*
  - **Sample Answer**: *"We used transactions wherever multiple database writes must succeed or fail together:
    1. Organization creation: Creating the organization, creating the creator's ADMIN membership, and writing the audit log must be atomic. If membership creation failed, an orphaned organization would exist.
    2. Incident creation: Writing the Incident record, creating `IncidentService` junction rows, and writing the initial audit log.
    3. Incident status transitions: Reading current status, verifying the state machine, updating status, and writing the audit log must be atomic to prevent race conditions."*

---

## 11. REST API Design Best Practices

- **In coldTrace**: Resource-oriented routing, plural nouns (`/services`, `/incidents`), HTTP verbs for actions (`GET`, `POST`, `PATCH`, `DELETE`), consistent JSON envelopes `{ status: "success", data: { ... } }`, and meaningful status codes.

---

## 12. HTTP Status Codes

- `200 OK`: Successful read or update.
- `201 Created`: Successful creation of user, organization, service, incident, or update.
- `400 Bad Request`: Validation failure or invalid lifecycle transition.
- `401 Unauthorized`: Unauthenticated (missing/invalid token).
- `403 Forbidden`: Authenticated, but insufficient role or not an organization member.
- `404 Not Found`: Entity does not exist or belongs to another tenant.
- `409 Conflict`: Unique constraint violation (duplicate email, duplicate org slug).
- `500 Internal Server Error`: Unexpected server failure (sanitized generic message).

---

## 13. Request Validation with Zod

- **In coldTrace**: Strict schema validation on request bodies, route parameters, and query parameters before reaching controllers.
- **Interview Question**: *"Why validate on the backend when the frontend already validates input?"*
  - **Sample Answer**: *"Frontend validation is exclusively a user experience optimization; it provides zero security. Any client can bypass frontend JavaScript by sending raw curl or Postman requests. Backend validation is the actual security perimeter."*

---

## 14. Incident State Machine

- **In coldTrace**: `TRIGGERED -> ACKNOWLEDGED -> RESOLVED -> CLOSED`.
- **Interview Question**: *"Why enforce the lifecycle in code rather than letting users update the status column directly?"*
  - **Sample Answer**: *"An incident is a business process, not just a database column. Direct updates allow skipping critical operational steps (e.g., closing an incident without resolving it, which bypasses root-cause analysis). Enforcing the state machine in the service layer guarantees operational compliance and emits audit records for every verified transition."*

---

## 15. Audit Logs & Accountability

- **In coldTrace**: Polymorphic `audit_logs` table capturing `organizationId`, `actorId`, `action`, `entityType`, `entityId`, and `metadata`.
- **Interview Question**: *"Why does `entity_id` in `audit_logs` not have a foreign key to the entity table?"*
  - **Sample Answer**: *"Because audit logs are polymorphic—`entity_type` can be `Incident`, `Service`, `Membership`, or `Organization`. In relational databases, foreign keys cannot point to dynamic tables. Furthermore, even if an entity is deleted or archived, the audit log must survive permanently for compliance."*

---

## 16. Race Conditions in Incident Transitions

- **Interview Question**: *"What happens if two responders click 'Resolve' at the exact same millisecond?"*
  - **Sample Answer**: *"In coldTrace, transitions run inside a database transaction. The transaction reads the current status and validates it against `ALLOWED_TRANSITIONS`. If both requests arrive concurrently from `ACKNOWLEDGED`, the first acquires the row lock, transitions to `RESOLVED`, and commits. The second transaction reads the updated status (`RESOLVED`); since `RESOLVED -> RESOLVED` is already achieved, the second request is treated idempotently or rejected, preventing invalid jumps."*

---

## 17. Pagination: Offset vs Cursor

- **In coldTrace**: Offset pagination (`page`, `limit`, `skip = (page - 1) * limit`, `take = limit`).
- **Trade-off**: Offset pagination is simple and allows jumping to arbitrary page numbers, but as offsets grow large ($>100,000$), performance degrades because PostgreSQL must scan and discard skipped rows.
- **Future scaling**: For massive timeline streams, cursor-based pagination using `where: { createdAt: { lt: cursorDate } }` provides $O(1)$ index seek performance.

---

## 18. SQL Query Performance (N+1 Prevention)

- **In coldTrace**: Prisma `include` clauses execute eager joins or grouped batch queries (`WHERE id IN (...)`) rather than fetching child records in a loop.

---

## 19. Modular Monolith vs Microservices

- **Interview Question**: *"When should coldTrace migrate to microservices?"*
  - **Sample Answer**: *"Only when organizational or scaling boundaries demand it. Specifically: (1) when independent engineering teams need independent deployment pipelines without stepping on each other, or (2) when a specific component has wildly divergent scaling characteristics (e.g., ingestion of 100,000 telemetry events/sec). Prematurely adopting microservices before achieving product-market fit introduces massive distributed systems complexity without business benefit."*

---

## 20. Deterministic Service-Health Calculation

- **Interview Question**: *"How does coldTrace calculate service health?"*
  - **Sample Answer**: *"coldTrace derives service health dynamically from active incidents associated with that service. Active incidents are those in `TRIGGERED` or `ACKNOWLEDGED` status. If there are no active incidents, the service is `OPERATIONAL`. If the highest active incident severity is `LOW` or `MEDIUM`, the service is `DEGRADED`. If the highest active severity is `HIGH` or `CRITICAL`, the service is in `MAJOR_OUTAGE`. When the incident is `RESOLVED` or `CLOSED`, it becomes inactive and the service health automatically returns to `OPERATIONAL`. This eliminates state drift between incidents and health."*

---

## 21. Public vs Private Data Isolation on Status Pages

- **Interview Question**: *"How do you guarantee that internal incident discussions don't leak onto the public status page?"*
  - **Sample Answer**: *"We enforce a strict separation of models and query projections. Internal updates have `visibility: INTERNAL` and public updates have `visibility: PUBLIC`. The public endpoint does not simply filter an internal response; it executes a separate query selecting only public services, public incident titles, and updates explicitly marked `PUBLIC`. User emails, author IDs, user IDs, internal notes, and audit logs are never queried or included in the public response DTO."*

---

## 22. Last Administrator Protection Invariant

- **Interview Question**: *"How do you prevent an organization from becoming orphaned without any admins?"*
  - **Sample Answer**: *"Before removing a member or demoting an `ADMIN` to `MEMBER`/`VIEWER`, coldTrace counts the remaining active administrators in the organization (`prisma.membership.count({ where: { organizationId, role: 'ADMIN' } })`). If the count is $\le 1$, the operation is rejected with a `400 Bad Request` ('Cannot remove/demote the last administrator in the organization')."*

# coldTrace — Senior Engineering Interview Guide (Tier 1 MVP)

This document prepares you for technical interviews based on the actual architecture, code, and trade-offs implemented in coldTrace. Every topic maps directly to real source files and functions in the repository so you can navigate directly to the code during discussions.

---

## 1. Authentication vs Authorization

- **Implementation**:
  - `src/middleware/auth.middleware.js`: `authenticate`
  - `src/middleware/rbac.middleware.js`: `requireOrgMember`, `requireRole`
- **What it means in simple language**:
  - *Authentication* answers "Who are you?" (verifying credentials and token validity).
  - *Authorization* answers "Are you allowed to do this here?" (verifying tenancy and role permissions).
- **In coldTrace**:
  - `authenticate` validates the JWT Bearer token in memory, checks that the user exists in PostgreSQL, and attaches `req.user = { id, email, name }`.
  - `requireOrgMember` verifies whether `req.user.id` has an active record in the `memberships` table for the target `organizationId`.
  - `requireRole(["ADMIN", "MEMBER"])` inspects the membership role to ensure the caller has sufficient privileges.
- **Why this approach**: Separating authentication from authorization prevents conflating identity with organizational tenancy. A user is authenticated once per request, but can belong to multiple organizations with different roles in each.
- **Alternatives**: Embedding organization and role in the JWT payload.
  - *Trade-off*: If an admin changes a user's role or removes them from an organization, a stateless JWT would retain the old permissions until the token expires (up to 15 minutes), creating an authorization lag. Resolving membership on-request guarantees real-time permission revocation.
- **Likely Interview Question**: *"What is the difference between 401 Unauthorized and 403 Forbidden?"*
  - **Answer**: *"401 Unauthorized actually means unauthenticated—the client did not provide valid credentials, or the token is missing/expired. 403 Forbidden means the server recognizes who the client is, but that authenticated user does not have permission to access that specific resource. In coldTrace, an invalid JWT returns 401, while a valid user attempting to modify another company's service or a VIEWER attempting to create an incident returns 403."*
- **Follow-up Question**: *"Should you return 403 or 404 when a user requests an ID they don't have access to?"*
  - **Answer**: *"Returning 404 instead of 403 prevents entity enumeration (an attacker discovering which IDs exist by fishing for 403s vs 404s). In coldTrace, if a resource does not belong to the user's organization, we return 404."*

---

## 2. JWT vs Session-Based Authentication

- **Implementation**:
  - `src/utils/token.js`: `generateAccessToken`, `generateRefreshToken`, `hashToken`
  - `src/services/auth.service.js`: `loginUser`, `refreshAccessToken`, `logoutUser`
- **What it means in simple language**:
  - Pure JWTs are stateless (no database check on every request, but cannot be immediately revoked).
  - Traditional sessions are stateful (stored in DB/Redis, easily revoked, but requires a database lookup on every single request).
- **In coldTrace**: Hybrid model.
  - Short-lived (15-minute) stateless JWT access tokens for API requests (`Authorization: Bearer <token>`).
  - 7-day stateful, server-side revocable refresh sessions stored in PostgreSQL (`sessions` table) and delivered via `httpOnly`, `SameSite=Lax`, `Secure` cookies.
- **Why this approach**: Avoids database lookups on 99% of requests while retaining the ability to immediately revoke refresh sessions on logout or account compromise.
- **Alternatives**:
  - Pure session cookies (requires database/Redis lookup on every request).
  - Long-lived stateless JWTs (impossible to revoke without a distributed blacklist).
- **Likely Interview Question**: *"Why not just use stateless JWTs with a 7-day expiration?"*
  - **Answer**: *"Pure stateless JWTs have an unavoidable revocation problem. Once signed, a token remains valid until it expires. If a user logs out, changes their password, or gets their token intercepted, you cannot revoke that token without building a distributed denylist, which turns your stateless tokens into stateful tokens anyway. By pairing 15-minute JWTs with a revocable refresh session stored in PostgreSQL, coldTrace bounds the vulnerability window to at most 15 minutes while keeping API request latency sub-millisecond."*
- **Follow-up Question**: *"Where should tokens be stored on the frontend?"*
  - **Answer**: *"Access tokens should be stored in memory or short-lived sessionStorage, never in long-lived localStorage where they are vulnerable to XSS. Refresh tokens should be kept in httpOnly, SameSite=Lax, Secure cookies, which JavaScript cannot read."*

---

## 3. bcrypt and Password Hashing

- **Implementation**:
  - `src/utils/password.js`: `hashPassword`, `verifyPassword`
  - `src/services/auth.service.js`: `registerUser`, `loginUser`
- **What it means in simple language**: Storing passwords in plain text is a critical vulnerability. Hashing produces a one-way mathematical fingerprint of the password.
- **In coldTrace**: `bcrypt.hash(password, 10)`. Cost factor = 10 (~65ms hashing time).
- **Why this approach**: bcrypt incorporates an adaptive work factor and per-user random salt, defeating precomputed rainbow tables and high-speed ASIC / GPU brute-forcing.
- **Alternatives**: PBKDF2, Argon2id, scrypt.
- **Likely Interview Question**: *"Why can't we hash passwords with SHA-256 or MD5?"*
  - **Answer**: *"SHA-256 and MD5 are cryptographic digest algorithms designed to be as fast as possible for data integrity. A modern GPU cluster can compute over 100 billion SHA-256 hashes per second, making dictionary attacks trivial. Password hashing algorithms like bcrypt and Argon2 are deliberately designed to be computationally slow and tunable via work factors."*
- **Follow-up Question**: *"What happens if you increase bcrypt cost to 16?"*
  - **Answer**: *"Each increment in bcrypt cost factor doubles the hashing time ($2^{\text{cost}}$ iterations). At cost 10, hashing takes ~65ms. At cost 16, hashing takes $2^6 = 64$ times longer (~4 seconds per hash), which would saturate Node's CPU event loop under concurrent registration requests and cause denial-of-service."*

---

## 4. Express Middleware Architecture

- **Implementation**:
  - `src/app.js`: Express pipeline configuration
  - `src/middleware/error.middleware.js`: `notFoundHandler`, `errorHandler`
  - `src/middleware/validate.middleware.js`: `validate`
- **What it means in simple language**: Middleware functions are sequential filters that an incoming HTTP request passes through before reaching the controller, and during error handling.
- **In coldTrace**: Pipeline order:
  `express.json() -> cookieParser() -> route -> authenticate -> requireOrgMember -> requireRole -> validate -> controller -> errorHandler`.
- **Why this approach**: Guarantees security and validation boundaries execute before any controller or business logic runs, keeping controllers lean.
- **Likely Interview Question**: *"How does Express centralized error handling work?"*
  - **Answer**: *"Express recognizes an error-handling middleware by its 4-parameter signature: `(err, req, res, next)`. When an error is thrown or passed via `next(err)` anywhere in the chain, Express bypasses all remaining route handlers and jumps straight to the error handler. In coldTrace, our `errorHandler` maps `AppError` status codes and strips internal stack traces from 500 errors to prevent leaking database details to clients."*

---

## 5. Role-Based Access Control (RBAC)

- **Implementation**:
  - `src/middleware/rbac.middleware.js`: `requireRole`
  - `src/routes/organization.routes.js`, `src/routes/service.routes.js`, `src/routes/incident.routes.js`
- **In coldTrace**: Roles are scoped per organization:
  - `ADMIN`: Full access (services CRUD, team management, incident management, public updates).
  - `MEMBER`: Responder access (incident creation, status transitions, incident updates). Cannot manage team members or delete/archive services.
  - `VIEWER`: Read-only access across the organization.
- **Likely Interview Question**: *"How do you test RBAC effectively?"*
  - **Answer**: *"We test both positive and negative authorization matrices. For every endpoint, we test: (1) an authorized ADMIN succeeds, (2) an authorized MEMBER succeeds or receives 403 based on the permission matrix, (3) a VIEWER receives 403 on mutations, and (4) an authenticated user outside the organization receives 403 on tenant entry."*

---

## 6. Multi-Tenancy & IDOR Defense

- **Implementation**:
  - `src/middleware/rbac.middleware.js`: `requireOrgMember`
  - `src/services/incident.service.js`: `validateAssignee`, `validateServices`, `getIncidentById`
  - `src/services/service.service.js`: `getServiceById`, `updateService`
- **What it means in simple language**: An Insecure Direct Object Reference (IDOR) happens when an attacker accesses another tenant's data by guessing or altering an ID in the request URL.
- **In coldTrace**: Two-layer defense:
  1. `requireOrgMember` verifies membership in the requested organization.
  2. Every database query includes `organizationId` in the `where` filter: `where: { id: incidentId, organizationId }`.
  3. Cross-tenant references are strictly validated: when assigning an incident or associating services, `validateAssignee` and `validateServices` explicitly verify that the user and services belong to the same `organizationId`.
- **Likely Interview Question**: *"Why can't we rely on SQL foreign keys alone to prevent cross-tenant data corruption?"*
  - **Answer**: *"Foreign keys only guarantee referential integrity—that the referenced ID exists in the `users` or `services` table. They do not enforce tenant boundaries. Without explicit application-level checks, a user in Organization A could assign an incident to an employee in Organization B or link Organization B's database service to an Organization A incident."*

---

## 7. Primary Keys: UUID vs Auto-Incrementing Integers

- **Implementation**:
  - `prisma/schema.prisma`: `@id @default(uuid()) @db.Uuid` on all tables
- **Why this approach**:
  - Eliminates enumeration attacks (an attacker cannot guess the next incident ID by adding `+1`).
  - IDs can be generated on client or application layer before writing to the database.
  - Simplifies distributed sharding and database migrations.
- **Trade-offs**: Consumes 16 bytes vs 4/8 bytes for integers, and random UUIDv4 can cause B-tree index fragmentation at massive scale (mitigated in PostgreSQL by the native `UUID` column type).

---

## 8. Many-to-Many Relationships & Junction Models

- **Implementation**:
  - `prisma/schema.prisma`: `model IncidentService`
  - `src/services/incident.service.js`: `createIncident`, `updateIncident`
- **In coldTrace**: Explicit `IncidentService` junction table connecting `incidents` and `services` with `@@unique([incidentId, serviceId])` and reverse index `@@index([serviceId, incidentId])`.
- **Why this approach**: Allows bidirectional queries (find all services for an incident, or find all active incidents for a service to compute health) while supporting metadata on the relation if needed.

---

## 9. Database Indexing Strategy

- **Implementation**:
  - `prisma/schema.prisma`:
    - `Incident`: `@@index([organizationId, status, createdAt])`, `@@index([organizationId, severity])`
    - `Service`: `@@unique([organizationId, slug])`
    - `IncidentService`: `@@unique([incidentId, serviceId])`, `@@index([serviceId, incidentId])`
    - `AuditLog`: `@@index([organizationId, createdAt])`, `@@index([organizationId, entityType, entityId])`
- **Likely Interview Question**: *"How did you decide which columns to index in coldTrace?"*
  - **Answer**: *"Indexes directly reflect query patterns and filter clauses:
    1. Composite index `(organization_id, status, created_at)` on `incidents`: Supports filtering active incidents by status sorted chronologically without in-memory sorting.
    2. Compound unique index `(organization_id, slug)` on `services`: Enforces that service slugs are unique within an organization while permitting identical slugs in different organizations.
    3. Compound index `(service_id, incident_id)` on `incident_services`: Enables fast lookups of active incidents for health rollups.
    Every index adds a write penalty, so we only added indexes justified by actual query access patterns."*

---

## 10. Database Transactions and ACID

- **Implementation**:
  - `src/services/organization.service.js`: `createOrganization`
  - `src/services/incident.service.js`: `createIncident`, `updateIncident`, `transitionIncidentStatus`
  - `src/services/update.service.js`: `createIncidentUpdate`
- **In coldTrace**: `prisma.$transaction(async (tx) => { ... })`.
- **Likely Interview Question**: *"Where did you use transactions in coldTrace and why?"*
  - **Answer**: *"We used transactions wherever multiple database writes must succeed or fail together:
    1. Organization creation: Creating the organization, creating the creator's ADMIN membership, and writing the audit log must be atomic. If membership creation failed, an orphaned organization would exist.
    2. Incident creation: Writing the Incident record, creating `IncidentService` junction rows, and writing the initial audit log.
    3. Incident status transitions: Reading current status, verifying the state machine, updating status, and writing the audit log must be atomic to prevent race conditions.
    4. Incident updates: Writing the update and the corresponding `INCIDENT_UPDATE_POSTED` audit log atomically."*

---

## 11. REST API Design Best Practices

- **Implementation**:
  - `src/routes/`: Resource-oriented hierarchical routing:
    - `/api/auth`
    - `/api/organizations`
    - `/api/organizations/:orgId/services`
    - `/api/organizations/:orgId/incidents`
    - `/api/organizations/:orgId/incidents/:incidentId/updates`
    - `/api/public/status/:orgSlug`
- **In coldTrace**: Standard HTTP verbs (`GET`, `POST`, `PATCH`, `DELETE`), consistent JSON envelopes `{ status: "success", data: { ... } }`, and meaningful status codes.

---

## 12. HTTP Status Codes

- `200 OK`: Successful read or update (`GET`, `PATCH`).
- `201 Created`: Successful creation of user, organization, service, incident, or update (`POST`).
- `400 Bad Request`: Validation failure or invalid lifecycle transition.
- `401 Unauthorized`: Unauthenticated (missing/invalid token).
- `403 Forbidden`: Authenticated, but insufficient role or not an organization member.
- `404 Not Found`: Entity does not exist or belongs to another tenant.
- `409 Conflict`: Unique constraint violation (duplicate email, duplicate org slug).
- `500 Internal Server Error`: Unexpected server failure (sanitized generic message).

---

## 13. Request Validation with Zod

- **Implementation**:
  - `src/middleware/validate.middleware.js`: `validate`
  - `src/validators/`: `auth.validator.js`, `organization.validator.js`, `service.validator.js`, `incident.validator.js`, `update.validator.js`
- **Likely Interview Question**: *"Why validate on the backend when the frontend already validates input?"*
  - **Answer**: *"Frontend validation is exclusively a user experience optimization; it provides zero security. Any client can bypass frontend JavaScript by sending raw curl or Postman requests. Backend validation is the actual security perimeter."*

---

## 14. Incident State Machine

- **Implementation**:
  - `src/services/incident.service.js`: `ALLOWED_TRANSITIONS`, `transitionIncidentStatus`
- **In coldTrace**: Strict one-way lifecycle:
  `TRIGGERED -> ACKNOWLEDGED -> RESOLVED -> CLOSED`.
- **Likely Interview Question**: *"Why enforce the lifecycle in code rather than letting users update the status column directly?"*
  - **Answer**: *"An incident is a business process, not just a database column. Direct updates allow skipping critical operational steps (e.g., closing an incident without resolving it, which bypasses root-cause analysis). Enforcing the state machine in the service layer guarantees operational compliance and emits audit records for every verified transition."*

---

## 15. Audit Logs & Accountability

- **Implementation**:
  - `src/services/update.service.js`: `createIncidentUpdate`, `getIncidentTimeline`, `getOrganizationAuditLogs`
  - `prisma/schema.prisma`: `model AuditLog`
- **In coldTrace**: Polymorphic `audit_logs` table capturing `organizationId`, `actorId`, `action`, `entityType`, `entityId`, and `metadata`.
- **Likely Interview Question**: *"Why does `entity_id` in `audit_logs` not have a foreign key to the entity table?"*
  - **Answer**: *"Because audit logs are polymorphic—`entity_type` can be `Incident`, `Service`, `Membership`, or `Organization`. In relational databases, foreign keys cannot point to dynamic tables. Furthermore, even if an entity is deleted or archived, the audit log must survive permanently for compliance."*

---

## 16. Race Conditions in Incident Transitions

- **Implementation**:
  - `src/services/incident.service.js`: `transitionIncidentStatus`
- **Likely Interview Question**: *"What happens if two responders click 'Resolve' at the exact same millisecond?"*
  - **Answer**: *"In coldTrace, transitions run inside a database transaction (`prisma.$transaction`). The transaction reads the current status and validates it against `ALLOWED_TRANSITIONS`. If both requests arrive concurrently from `ACKNOWLEDGED`, the first acquires the row lock, transitions to `RESOLVED`, and commits. The second transaction reads the updated status (`RESOLVED`); since `RESOLVED -> RESOLVED` is already achieved, the second request is treated idempotently or rejected, preventing invalid jumps."*

---

## 17. Pagination: Offset vs Cursor

- **Implementation**:
  - `src/services/incident.service.js`: `listIncidents`
  - `src/services/update.service.js`: `getOrganizationAuditLogs`
- **In coldTrace**: Offset pagination (`page`, `limit`, `skip = (page - 1) * limit`, `take = limit`).
- **Trade-off**: Simple to implement and allows arbitrary page jumps. However, as offsets grow large ($>100,000$), performance degrades because PostgreSQL must scan and discard skipped rows.
- **Future scaling**: For massive real-time telemetry streams, cursor-based pagination using `where: { createdAt: { lt: cursorDate } }` provides $O(1)$ index seek performance.

---

## 18. SQL Query Performance (N+1 Prevention)

- **Implementation**:
  - `src/services/health.service.js`: `getOrgHealthOverview`
  - `src/services/incident.service.js`: `listIncidents`
- **In coldTrace**: Prisma `include` clauses execute eager joins or grouped batch queries (`WHERE id IN (...)`) rather than fetching child records in a loop. In `getOrgHealthOverview`, active incidents and services are fetched in two single indexed queries and correlated in memory, completely eliminating N+1 database queries.

---

## 19. Modular Monolith vs Microservices

- **Implementation**:
  - `src/app.js`, `src/server.js`
- **Likely Interview Question**: *"When should coldTrace migrate to microservices?"*
  - **Answer**: *"Only when organizational or scaling boundaries demand it. Specifically: (1) when independent engineering teams need independent deployment pipelines without stepping on each other, or (2) when a specific component has wildly divergent scaling characteristics (e.g., ingestion of 100,000 telemetry events/sec). Prematurely adopting microservices before achieving product-market fit introduces massive distributed systems complexity without business benefit."*

---

## 20. Deterministic Service-Health Calculation

- **Implementation**:
  - `src/utils/health.js`: `calculateServiceHealth`, `calculateOverallHealth`
  - `src/services/health.service.js`: `getOrgHealthOverview`, `getPublicStatusPage`
- **Likely Interview Question**: *"How does coldTrace calculate service health?"*
  - **Answer**: *"coldTrace derives service health dynamically from active incidents associated with that service. Active incidents are those in `TRIGGERED` or `ACKNOWLEDGED` status. If there are no active incidents, the service is `OPERATIONAL`. If the highest active incident severity is `LOW` or `MEDIUM`, the service is `DEGRADED`. If the highest active severity is `HIGH` or `CRITICAL`, the service is in `MAJOR_OUTAGE`. When the incident is `RESOLVED` or `CLOSED`, it becomes inactive and the service health automatically returns to `OPERATIONAL`. This eliminates state drift between incidents and health."*

---

## 21. Public vs Private Data Isolation on Status Pages

- **Implementation**:
  - `src/services/health.service.js`: `getPublicStatusPage`
  - `src/routes/public.routes.js`: `/api/public/status/:orgSlug`
- **Likely Interview Question**: *"How do you guarantee that internal incident discussions don't leak onto the public status page?"*
  - **Answer**: *"We enforce a strict separation of models and query projections. Internal updates have `visibility: INTERNAL` and public updates have `visibility: PUBLIC`. The public endpoint does not simply filter an internal response; it executes a separate query selecting only public services, public incident titles, and updates explicitly marked `PUBLIC`. User emails, author IDs, user IDs, internal notes, and audit logs are never queried or included in the public response DTO."*

---

## 22. Last Administrator Protection Invariant

- **Implementation**:
  - `src/services/organization.service.js`: `updateMemberRole`, `removeMember`
- **Likely Interview Question**: *"How do you prevent an organization from becoming orphaned without any admins?"*
  - **Answer**: *"Before removing a member or demoting an `ADMIN` to `MEMBER`/`VIEWER`, coldTrace counts the remaining active administrators in the organization (`prisma.membership.count({ where: { organizationId, role: 'ADMIN' } })`). If the count is $\le 1$, the operation is rejected with a `400 Bad Request` ('Cannot remove/demote the last administrator in the organization')."*

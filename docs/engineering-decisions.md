# coldTrace — Engineering Decisions Record (ADR)

This document records the architectural and engineering decisions made during the implementation of coldTrace Tier 1 MVP. Each decision details the problem, alternatives evaluated, reasoning, trade-offs, and future scaling path.

---

### 1. Modular Monolith over Microservices

- **Decision**: Implement coldTrace as a modular monolith running in a single Node.js process with clean internal boundaries (`routes`, `controllers`, `services`, `middleware`, `validators`).
- **Problem**: Designing an incident management platform that balances operational simplicity, speed of development, and clear code organization without unnecessary infrastructure.
- **Alternatives**:
  - *Microservices*: Splitting services, incidents, users, and audit logs into separate independent deployables with gRPC / HTTP REST communication.
  - *Serverless Functions*: Deploying each endpoint as an AWS Lambda / Cloud Run function.
- **Reasoning**: coldTrace is in MVP phase. Microservices introduce distributed transactions (sagas), network serialization latency, operational complexity, Docker/Kubernetes management overhead, and split database schemas. A modular monolith provides strict module boundaries and strong relational integrity with instant local execution.
- **Trade-offs**: Single deployment unit (deploying a bug in one route affects the whole app). Horizontal scaling scales the entire application rather than individual bottlenecks.
- **Future scaling**: If traffic expands dramatically, domain services (`incident.service.js`, `health.service.js`) already have isolated interfaces and can be extracted into standalone services with an event bus (e.g. Kafka or RabbitMQ).

---

### 2. PostgreSQL and Relational Modeling

- **Decision**: Use PostgreSQL with strict foreign keys, unique constraints, and indexes.
- **Problem**: Storing business data with tight relationships (organizations, users, memberships, services, incidents, updates, and audit logs).
- **Alternatives**:
  - *MongoDB / Document Store*: Storing incidents with embedded updates and services.
  - *NoSQL Key-Value*: DynamoDB.
- **Reasoning**: Incident management requires relational integrity: an incident MUST belong to a real organization, an update MUST belong to a real incident, and a membership CANNOT be duplicated for a user-organization pair. Foreign key constraints and ACID transactions prevent orphan records and corrupted state.
- **Trade-offs**: Schema migrations are required when altering structures. Horizontal database scaling requires read replicas and connection pooling rather than automatic document sharding.
- **Future scaling**: PostgreSQL easily scales to millions of incidents using read replicas for dashboard/public status traffic, connection pooling (PgBouncer), and table partitioning on `incidents` and `audit_logs` by `created_at` or `organization_id`.

---

### 3. Prisma 7 with pg Driver Adapter

- **Decision**: Use Prisma 7 with `@prisma/adapter-pg` driver adapter.
- **Problem**: Need an ORM providing schema-driven migrations, typed queries, and modern PostgreSQL driver compatibility.
- **Alternatives**:
  - *Raw SQL via `pg`*: High boilerplate, manual migration tracking, prone to SQL syntax errors.
  - *Kysely / Knex query builders*: Good SQL generation, but requires manual migration tracking and type synchronization.
- **Reasoning**: Prisma provides declarative schema definitions (`schema.prisma`), safe automated migrations (`prisma migrate dev`), and a generated client. Prisma 7's PostgreSQL driver adapter connects directly through the battle-tested `pg` driver, ensuring clean connection handling on Node.js 24.
- **Trade-offs**: Generated client build step required (`prisma generate`). Complex queries occasionally need `$queryRaw`.
- **Future scaling**: Prisma supports connection pool configuration, read replicas, and query optimization logging.

---

### 4. Password Hashing with bcrypt (Cost Factor 10)

- **Decision**: Hash user passwords using `bcrypt` with a work factor (salt rounds) of 10.
- **Problem**: Securely storing user credentials against offline rainbow-table and dictionary attacks in the event of database exposure.
- **Alternatives**:
  - *Argon2id*: Excellent memory-hard algorithm, but requires additional native binary compilation dependencies.
  - *SHA-256 / PBKDF2*: Standard SHA-256 is computationally cheap and vulnerable to GPU cracking; PBKDF2 is slower without hardware-resistant benefits.
- **Reasoning**: bcrypt is the OWASP-recommended industry standard for Node.js. Cost factor 10 takes ~60-80ms per hash on modern CPUs—fast enough for user logins, but computationally expensive enough to make brute-forcing offline hashes infeasible.
- **Trade-offs**: Native C++ dependency compiled via `node-gyp-build`. Password hashing consumes CPU cycles during high registration bursts.
- **Future scaling**: Can increase salt rounds to 12 if hardware speeds increase, or migrate to Argon2id.

---

### 5. Authentication Strategy: JWT Access Tokens + Server-Side Revocable Refresh Sessions

- **Decision**: Use short-lived stateless JWT access tokens (15 minutes) combined with stateful, server-side revocable refresh sessions (7 days) stored in the database.
- **Problem**: Providing fast, secure authentication without querying the database for user sessions on every single HTTP request, while still allowing immediate session revocation upon logout.
- **Alternatives**:
  - *Pure stateless JWT*: Long-lived JWTs (e.g. 7 days). Pro: no DB lookup. Con: impossible to revoke on logout or breach without maintaining a distributed denylist.
  - *Pure stateful session cookies (express-session)*: Every request hits the DB or Redis. Con: creates database bottleneck under load.
- **Reasoning**: Hybrid model gives the best of both worlds:
  - 99% of requests verify JWT access tokens locally in CPU memory (sub-millisecond).
  - Refresh rotation occurs every 15 minutes, validating the session against the `sessions` table.
  - Logout marks the session `revokedAt = now()`. The refresh cookie is immediately cleared.
- **Trade-offs**: An already-issued JWT access token remains valid for up to 15 minutes after logout if intercepted. This is an explicit, industry-standard trade-off balanced by the short 15-minute window.
- **Future scaling**: In Tier 2, active JWT IDs (`jti`) can be stored in an in-memory Redis cache for instantaneous revocation if sub-second revocation is required for high-security compliance.

---

### 6. Role-Based Access Control (ADMIN, MEMBER, VIEWER)

- **Decision**: Implement a 3-tier organizational RBAC model (`ADMIN`, `MEMBER`, `VIEWER`) enforced via declarative Express middleware.
- **Problem**: Enforcing least-privilege access across organization team members.
- **Alternatives**:
  - *Attribute-Based Access Control (ABAC)*: Flexible but overly complex for an MVP.
  - *Binary Admin / User*: Too coarse-grained; doesn't support read-only stakeholders or responders.
- **Reasoning**:
  - `ADMIN`: Organization owners, can manage team members, services, and all incidents.
  - `MEMBER`: Incident responders, can create and triage incidents and post updates, but cannot manage team members or archive services.
  - `VIEWER`: Read-only stakeholders, auditors, and leadership who need visibility without mutation rights.
- **Trade-offs**: Roles are static enums per organization membership. Custom permission overrides are not supported in Tier 1.
- **Future scaling**: Can be extended with granular permission bitmasks or permission policies in Tier 2.

---

### 7. Multi-Tenancy via Row-Level Tenant Discriminator

- **Decision**: Enforce multi-tenancy by including `organization_id` on all operational models and verifying membership on every single request.
- **Problem**: Preventing Insecure Direct Object References (IDOR) and cross-tenant data leakage.
- **Alternatives**:
  - *Database-per-tenant*: Maximum isolation, but massive infrastructure overhead and difficult migrations across dozens of databases.
  - *Schema-per-tenant*: PostgreSQL schemas per tenant; complicates cross-tenant reporting and ORM connections.
- **Reasoning**: Row-level isolation with compound unique constraints (`[organizationId, slug]`) and composite indexes (`[organizationId, createdAt]`) is the most maintainable and efficient multi-tenant architecture for cloud SaaS.
- **Trade-offs**: Every query must explicitly include `organizationId`. A developer forgetting `where: { organizationId }` could cause an IDOR vulnerability. Mitigated by `requireOrgMember` middleware and automated multi-tenancy tests.
- **Future scaling**: Can implement PostgreSQL Row-Level Security (RLS) policies at the database engine level in Tier 2.

---

### 8. Prisma Transactions for Multi-Entity Writes

- **Decision**: Wrap related database writes in `prisma.$transaction`.
- **Problem**: Preventing partial writes when creating an organization (must create org + creator ADMIN membership + audit log), transitioning incident status (must update incident + write audit log), or creating incidents (must create incident + junction services + audit log).
- **Alternatives**:
  - *Sequential asynchronous queries without transactions*: Fast, but if step 2 fails, orphaned records remain.
- **Reasoning**: ACID guarantees ensure that either the entire business operation succeeds or all changes roll back cleanly.
- **Trade-offs**: Transactions hold database row locks for the duration of the closure. Mitigated by keeping transaction blocks short and avoiding network/API calls inside transaction callbacks.
- **Future scaling**: Fine-tuned isolation levels (e.g. `Serializable` vs `ReadCommitted`) can be applied as concurrency scales.

---

### 9. Database Indexing Strategy

- **Decision**: Index high-cardinality foreign keys and common query filters:
  - `users(email)`: Unique index for fast login/registration lookup.
  - `organizations(slug)`: Unique index for tenant resolution.
  - `memberships(user_id, organization_id)`: Unique compound index preventing duplicate membership.
  - `services(organization_id, slug)`: Unique compound index scoped to organization.
  - `incidents(organization_id, created_at)`: Timeline queries.
  - `incidents(organization_id, status, created_at)`: Filtered incident listings.
  - `audit_logs(organization_id, created_at)`: Chronological audit history.
- **Problem**: Prevent table scans as data volume grows.
- **Alternatives**:
  - *Index every column*: Degrades write performance and bloats storage.
  - *No indexes beyond primary keys*: High latency under load.
- **Reasoning**: Indexes strictly match the `WHERE` and `ORDER BY` clauses of the API queries.
- **Trade-offs**: Marginal increase in disk storage and write latency on `INSERT` / `UPDATE`.
- **Future scaling**: Use PostgreSQL `EXPLAIN ANALYZE` on production workloads to identify query plan bottlenecks.

---

### 10. Service Archiving (Soft-Delete) over Hard-Delete

- **Decision**: Add `isArchived` boolean flag on `Service` rather than `DELETE FROM services`.
- **Problem**: Deleting a service referenced by past incidents violates foreign key constraints or breaks historical post-mortem reports.
- **Alternatives**:
  - *Cascade delete*: Deletes historical incidents and audit records. Unacceptable for compliance.
  - *Set Null on FK*: Leaves historical incidents with missing context on which service was affected.
- **Reasoning**: In incident management, historical accuracy is paramount. Archiving hides the service from active creation and health calculation while preserving complete post-mortem audit trails.
- **Trade-offs**: Queries must filter `where: { isArchived: false }` by default.
- **Future scaling**: Add an automated data lifecycle policy to cold-archive services inactive for >5 years.

---

### 11. Deterministic Incident Lifecycle State Machine

- **Decision**: Enforce strict one-way lifecycle transitions:
  `TRIGGERED → ACKNOWLEDGED → RESOLVED → CLOSED`.
- **Problem**: Preventing invalid status jumps (e.g. closing an incident without resolving it) and race conditions where concurrent updates overwrite each other.
- **Alternatives**:
  - *Allow arbitrary status updates via PUT/PATCH*: Unstructured, error-prone.
  - *Bi-directional state transitions*: Re-opening closed incidents.
- **Reasoning**: Incidents represent a formal engineering workflow: trigger -> acknowledge -> resolve -> close. If an issue recurs after closure, best practice is to trigger a new incident linked to the past one rather than silently reopening an audited event.
- **Trade-offs**: A responder who accidentally closes an incident cannot reopen it directly; they must create a new incident.
- **Future scaling**: Configurable workflow transitions per organization in Tier 2.

---

### 12. Polymorphic Audit Logging

- **Decision**: Store audit logs in an `audit_logs` table with `entity_type` string and unconstrained `entity_id` string, while retaining foreign keys for `organization_id` and `actor_id`.
- **Problem**: Need an audit trail that can record actions on any domain entity (Organizations, Memberships, Services, Incidents, IncidentUpdates) without creating separate audit tables for every model.
- **Alternatives**:
  - *Separate audit table per entity*: High schema bloat and difficult cross-entity timeline queries.
  - *Event sourcing architecture*: Overly complex for MVP.
- **Reasoning**: A single polymorphic audit log allows an organization-level timeline query (`GET /api/organizations/:id/audit-logs`) to return a unified stream of all actions across all entities.
- **Trade-offs**: `entity_id` does not have a database foreign key constraint, by intentional design.
- **Future scaling**: Partition `audit_logs` by year/month as logs grow into millions of rows.

---

### 13. Dynamic Derived Service Health

- **Decision**: Calculate service health dynamically on query from active incidents rather than storing static health columns or running external background pollers.
- **Problem**: Maintaining 100% consistent service health status without status drift or synchronization bugs.
- **Alternatives**:
  - *Static health column on Service*: Requires every incident transition to update the service row. If an update fails, the service health becomes out-of-sync.
  - *Background Cron Job*: Calculates health every 60 seconds. Introduces staleness.
- **Reasoning**: Deriving health as a pure function of active incidents (`TRIGGERED`, `ACKNOWLEDGED`) guarantees zero state drift. As soon as an incident is resolved, service health immediately reverts to `OPERATIONAL`.
- **Trade-offs**: Involves a relational join/filter during health queries.
- **Future scaling**: Since active incidents in any organization are small (typically <50), this query executes in <5ms. In high-scale environments, derived health can be cached in Redis with TTL of 10s.

---

### 14. Public Status Page Privacy Isolation

- **Decision**: Use a dedicated endpoint (`/api/public/status/:orgSlug`) constructing a strictly limited DTO that strips all internal fields.
- **Problem**: Exposing operational status to external customers without leaking internal communication, responder identities, or sensitive incident details.
- **Alternatives**:
  - *Reusing internal incident endpoints with a `isPublic` query parameter*: High risk of accidental leakage due to code oversight.
- **Reasoning**: The public endpoint performs a separate, deliberate query selecting only public services, public incident titles, and updates explicitly marked `PUBLIC`. It completely omits author user IDs, responder emails, internal notes, and audit logs.
- **Trade-offs**: Two separate query paths for incident data (private vs public).
- **Future scaling**: The public status endpoint is cacheable via a CDN (e.g. Cloudflare) with a 30-second cache header, protecting the database from traffic surges during major public outages.

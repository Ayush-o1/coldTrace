# coldTrace database design

The schema is a PostgreSQL relational model managed by Prisma migrations. UUID primary keys give records stable identifiers, while explicit snake_case table and column mappings keep the SQL names conventional. Migrations preserve the history of schema changes and allow another environment to recreate the database structure; they should be reviewed and retained.

## Entities

| Entity / table | Purpose and key relationships |
| --- | --- |
| `User` / `users` | Account identity and password hash. A user can belong to many organizations and can create incidents, be assigned incidents, post incident updates, and act on audit records. Email is unique. Normalize email (for example, trim and lowercase) in application logic before storage; uniqueness alone does not make differently-cased addresses equivalent in every PostgreSQL collation. |
| `Organization` / `organizations` | Tenant boundary for a team, its services, incidents, memberships, and audit records. Its slug is globally unique. |
| `Membership` / `memberships` | Joins users to organizations and stores the user's role within that organization. Its user and organization foreign keys are required; `(user_id, organization_id)` is unique so a user cannot be added twice to one organization. |
| `Service` / `services` | Software service owned by an organization. `(organization_id, slug)` is unique, allowing the same slug in different organizations. |
| `Incident` / `incidents` | Organization-owned incident, with a required creator and optional assignee. The named creator and assignee relations distinguish two references to `User`. It has status, severity, title, and description. |
| `IncidentService` / `incident_services` | Explicit many-to-many junction between incidents and affected services. `(incident_id, service_id)` is unique to prevent duplicate pairs; the reverse index supports finding incidents for a service. |
| `IncidentUpdate` / `incident_updates` | A time-ordered message attached to an incident and authored by a user, with internal or public visibility. |
| `AuditLog` / `audit_logs` | Historical action record tied to an organization and actor. `entity_type` plus `entity_id` is intentionally polymorphic, since an event may refer to different entity types; `entity_id` has no foreign key. This keeps audit history decoupled from any single target table. |

## Keys, relations, and deletion behavior

Every entity has a UUID primary key. Foreign keys connect memberships to users and organizations; services to organizations; incidents to organizations, creators, and optional assignees; incident-service rows to both parents; updates to incidents and authors; and audit records to organizations and actors.

Relations default to restrictive deletion so parents with dependent operational or historical records cannot be casually removed. If an assignee user is deleted, `assigned_to_id` becomes null; creator, author, membership, and audit actor references are retained by restrictive foreign keys. The polymorphic audit target has no FK by design. Data-retention or archival workflows should be designed deliberately in a later phase rather than relying on cascades that can erase incident history.

## Enums and constraints

- `MembershipRole`: `ADMIN`, `MEMBER`, `VIEWER`. These are the intended organization roles; authorization rules are future application logic.
- `IncidentStatus`: `TRIGGERED`, `ACKNOWLEDGED`, `RESOLVED`, `CLOSED`.
- `IncidentSeverity`: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`.
- `UpdateVisibility`: `INTERNAL`, `PUBLIC`.
- Unique constraints enforce user email, organization slug, membership pair, organization-scoped service slug, and incident-service pair.

Enums limit stored values but do not enforce valid incident status transitions. A future incident state machine must decide which transitions are allowed. Foreign keys also cannot ensure that an assigned user or linked service belongs to the same organization as the incident. Future business logic must perform these cross-organization ownership checks (ideally in a transaction).

## Indexes

- Unique indexes support lookups by user email and organization slug.
- Membership's unique `(user_id, organization_id)` index supports a user's organization list; the separate `organization_id` index supports listing an organization's members.
- Service's unique `(organization_id, slug)` index also supports organization-scoped service lookups.
- Incident indexes support organization timelines, filtering an organization's timeline by status, and finding active assignments by user and status.
- Incident-service's unique pair supports incident-to-service lookups; `(service_id, incident_id)` supports the reverse direction.
- Incident updates are indexed by `(incident_id, created_at)` for ordered incident history.
- Audit logs are indexed by `(organization_id, created_at)` for an organization's chronological activity.

These indexes match expected access patterns for the planned application. Revisit them against actual query plans and usage rather than adding indexes speculatively; indexes consume storage and add write cost.

## Design decisions and future rules

- `Membership` is a model rather than an implicit many-to-many relation because the association carries a role and creation timestamp.
- `IncidentService` is explicit for uniqueness and future relationship metadata.
- Named incident-user relations clarify creator versus assignee and author versus actor roles where one model has multiple links to `User`.
- Audit targets are polymorphic, while the audit actor and organization retain ordinary foreign keys.
- Normalize user email before persistence. Later authentication work should also set password hashing and account lifecycle rules.
- Keep audit and incident history. Prefer deliberate archival or retention policies over cascading deletes.
- The database schema lays out membership roles, but enforcement of ADMIN, MEMBER, and VIEWER permissions belongs to a later authorization phase.
- Status transition rules and same-organization assignment/service checks are business invariants not captured by these current constraints.
- Incident health rollups, public status-page publication, and broader tenant enforcement remain future application concerns.

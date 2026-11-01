# coldTrace

coldTrace is an incident management platform for software engineering teams. It is being built as a modular monolith to help teams organize services, coordinate incident response, record updates and preserve an audit trail. This repository currently contains the Express foundation and Phase 2 database foundation.

## Technology

- Node.js 24 and JavaScript ES modules
- Express 5
- PostgreSQL 18
- Prisma ORM 7 with the `pg` driver adapter
- Node.js Test Runner and Supertest

## Architecture and project layout

The application uses a modular monolith: one Node.js application, with HTTP concerns under `src/` and database access behind a shared Prisma client. The current API exposes a health route; later product phases will add domain routes and business logic.

```text
src/
  app.js                    Express app setup (safe to import in tests)
  server.js                 HTTP server entry point
  config/prisma.js          Shared Prisma Client and PostgreSQL adapter
  middleware/               404 and centralized error handling
  routes/health.routes.js   Health endpoint
scripts/check-database.js   PostgreSQL and Prisma CRUD verification
prisma/
  schema.prisma             Database models and relations
  migrations/               Versioned SQL schema history
tests/                      HTTP tests
docs/database-design.md     Entity and relationship design
```

## Local setup

Requirements: Node.js 24, npm, and PostgreSQL 18.

1. Install dependencies with `npm install`.
2. Create a local PostgreSQL role and databases named `coldtrace_app`, `coldtrace_dev`, and `coldtrace_shadow` (the role is a PostgreSQL user; the latter two are databases). Give the app role access to both databases. Keep the app role separate from the PostgreSQL administrator.
3. Copy `.env.example` to `.env`, then set the local role password in both connection URLs. Do not commit `.env`.
4. Apply existing migrations with `npx prisma migrate deploy`.
5. Generate the client with `npx prisma generate`.
6. Start the API with `npm run dev`; `GET /api/health` should return a healthy response.

Example environment variables (replace the placeholder password locally):

```dotenv
PORT=4000
DATABASE_URL="postgresql://coldtrace_app:YOUR_PASSWORD@localhost:5432/coldtrace_dev?schema=public"
SHADOW_DATABASE_URL="postgresql://coldtrace_app:YOUR_PASSWORD@localhost:5432/coldtrace_shadow?schema=public"
```

`prisma.config.js` is the Prisma 7 configuration entry point. It specifies the schema and migration folder and reads the development and shadow database URLs from the environment. The shadow database is used by Prisma migration workflows; keep it separate from the development database.

## Database commands

```sh
npx prisma format
npx prisma validate
npx prisma migrate status
npx prisma migrate dev --name describe_schema_change # local schema development
npx prisma generate
npm run db:check
```

`npm run db:check` connects through the shared adapter-backed client, prints only the database name, verifies Prisma create/read/update/delete operations using a unique temporary user, cleans it up, and disconnects. Do not use destructive migration commands against data you need to keep.

## Tests

Run the existing HTTP tests with:

```sh
npm test
```

The tests use Node's built-in test runner and Supertest. They cover the health route, not-found behavior, and generic handling of unexpected errors.

## Next phases

Authentication, organization management, membership workflows, role-based authorization, incident APIs, and public status pages are planned follow-on work. The database foundation prepares for those features without implementing them here.

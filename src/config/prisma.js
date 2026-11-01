
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
}

// Prisma 7 uses the pg driver adapter to connect through the Node.js PostgreSQL driver.
const adapter = new PrismaPg({
    connectionString
});

// This module exports one shared client so route modules don't create a pool per request.
export const prisma = new PrismaClient({
    adapter
});

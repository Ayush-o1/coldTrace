import { randomUUID } from "node:crypto";
import { prisma } from "../src/config/prisma.js";

let temporaryUserId;

try {
    await prisma.$connect();

    const [{ name: databaseName }] = await prisma.$queryRaw`
        SELECT current_database() AS name
    `;
    console.log(`Connected to PostgreSQL database: ${databaseName}`);

    // A unique throwaway account exercises real Prisma CRUD without using personal data.
    const temporaryEmail = `phase2-${randomUUID()}@example.test`;
    const createdUser = await prisma.user.create({
        data: {
            name: "coldTrace database verification",
            email: temporaryEmail,
            passwordHash: "temporary-verification-only"
        }
    });
    temporaryUserId = createdUser.id;
    console.log("Prisma CREATE: successful");

    const foundUser = await prisma.user.findUnique({
        where: { id: temporaryUserId }
    });
    if (!foundUser) throw new Error("Prisma READ could not find the temporary user");
    console.log("Prisma READ: successful");

    const updatedUser = await prisma.user.update({
        where: { id: temporaryUserId },
        data: { name: "coldTrace database verification updated" }
    });
    if (updatedUser.name !== "coldTrace database verification updated") {
        throw new Error("Prisma UPDATE did not persist the temporary user's new name");
    }
    console.log("Prisma UPDATE: successful");

    await prisma.user.delete({ where: { id: temporaryUserId } });
    temporaryUserId = undefined;
    console.log("Prisma DELETE: successful");
} catch (error) {
    console.error("Database verification failed:", error.message);
    process.exitCode = 1;
} finally {
    // If any step failed after CREATE, remove the temporary row before disconnecting.
    if (temporaryUserId) {
        await prisma.user.deleteMany({ where: { id: temporaryUserId } })
            .catch((error) => {
                console.error("Failed to clean up the temporary user:", error.message);
                process.exitCode = 1;
            });
    }

    await prisma.$disconnect();
}

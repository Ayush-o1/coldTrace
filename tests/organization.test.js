import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";

async function createAuthenticatedUser(prefix = "user") {
    const email = `${prefix}-${randomUUID()}@example.com`;
    const password = "StrongPassword123!";
    const name = `${prefix} Name`;

    await request(app)
        .post("/api/auth/register")
        .send({ name, email, password });

    const loginRes = await request(app)
        .post("/api/auth/login")
        .send({ email, password });

    return {
        id: loginRes.body.data.user.id,
        email: loginRes.body.data.user.email,
        name,
        token: loginRes.body.data.accessToken
    };
}

test("Organization & RBAC Multi-Tenancy (Phases 4 & 5)", async (t) => {
    const adminUser = await createAuthenticatedUser("admin");
    const regularUser = await createAuthenticatedUser("regular");
    const outsideUser = await createAuthenticatedUser("outsider");

    let organizationId = "";
    let memberId = "";

    await t.test("POST /api/organizations creates org and assigns creator ADMIN role", async () => {
        const response = await request(app)
            .post("/api/organizations")
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                name: "Platform Engineering",
                slug: `platform-eng-${randomUUID().slice(0, 8)}`
            });

        assert.equal(response.status, 201);
        assert.equal(response.body.status, "success");
        assert.equal(response.body.data.organization.name, "Platform Engineering");
        assert.equal(response.body.data.organization.role, "ADMIN");
        assert.ok(response.body.data.organization.id);

        organizationId = response.body.data.organization.id;
    });

    await t.test("POST /api/organizations rejects duplicate slug with 409", async () => {
        const orgRes = await request(app)
            .get(`/api/organizations/${organizationId}`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        const existingSlug = orgRes.body.data.organization.slug;

        const duplicateRes = await request(app)
            .post("/api/organizations")
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                name: "Another Team",
                slug: existingSlug
            });

        assert.equal(duplicateRes.status, 409);
        assert.equal(duplicateRes.body.status, "error");
        assert.match(duplicateRes.body.message, /already exists/i);
    });

    await t.test("GET /api/organizations lists user's organizations", async () => {
        const response = await request(app)
            .get("/api/organizations")
            .set("Authorization", `Bearer ${adminUser.token}`);

        assert.equal(response.status, 200);
        assert.equal(response.body.status, "success");
        assert.ok(Array.isArray(response.body.data.organizations));
        const found = response.body.data.organizations.find((o) => o.id === organizationId);
        assert.ok(found);
        assert.equal(found.role, "ADMIN");
    });

    await t.test("Multi-tenancy: Non-member cannot access organization data (403)", async () => {
        const response = await request(app)
            .get(`/api/organizations/${organizationId}`)
            .set("Authorization", `Bearer ${outsideUser.token}`);

        assert.equal(response.status, 403);
        assert.equal(response.body.status, "error");
        assert.match(response.body.message, /access to this organization/i);
    });

    await t.test("POST /api/organizations/:id/members allows ADMIN to add existing user", async () => {
        const response = await request(app)
            .post(`/api/organizations/${organizationId}/members`)
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                email: regularUser.email,
                role: "MEMBER"
            });

        assert.equal(response.status, 201);
        assert.equal(response.body.status, "success");
        assert.equal(response.body.data.member.email, regularUser.email);
        assert.equal(response.body.data.member.role, "MEMBER");

        memberId = response.body.data.member.id;
    });

    await t.test("POST /api/organizations/:id/members rejects adding non-existent email (404)", async () => {
        const response = await request(app)
            .post(`/api/organizations/${organizationId}/members`)
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                email: "non-existent-user@example.test",
                role: "MEMBER"
            });

        assert.equal(response.status, 404);
        assert.match(response.body.message, /no registered user found/i);
    });

    await t.test("POST /api/organizations/:id/members rejects duplicate membership (409)", async () => {
        const response = await request(app)
            .post(`/api/organizations/${organizationId}/members`)
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                email: regularUser.email,
                role: "MEMBER"
            });

        assert.equal(response.status, 409);
        assert.match(response.body.message, /already a member/i);
    });

    await t.test("RBAC: MEMBER cannot add other members (403)", async () => {
        const response = await request(app)
            .post(`/api/organizations/${organizationId}/members`)
            .set("Authorization", `Bearer ${regularUser.token}`)
            .send({
                email: outsideUser.email,
                role: "VIEWER"
            });

        assert.equal(response.status, 403);
        assert.match(response.body.message, /requires one of \[ADMIN\]/i);
    });

    await t.test("PATCH /api/organizations/:id/members/:memberId updates role", async () => {
        const response = await request(app)
            .patch(`/api/organizations/${organizationId}/members/${memberId}`)
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                role: "VIEWER"
            });

        assert.equal(response.status, 200);
        assert.equal(response.body.data.member.role, "VIEWER");
    });

    await t.test("Last Admin Protection: cannot demote sole admin (400)", async () => {
        // Find admin's membership ID
        const membersRes = await request(app)
            .get(`/api/organizations/${organizationId}/members`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        const adminMember = membersRes.body.data.members.find((m) => m.userId === adminUser.id);
        assert.ok(adminMember);

        const demoteRes = await request(app)
            .patch(`/api/organizations/${organizationId}/members/${adminMember.id}`)
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                role: "MEMBER"
            });

        assert.equal(demoteRes.status, 400);
        assert.match(demoteRes.body.message, /cannot demote the last administrator/i);
    });

    await t.test("Last Admin Protection: cannot remove sole admin (400)", async () => {
        const membersRes = await request(app)
            .get(`/api/organizations/${organizationId}/members`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        const adminMember = membersRes.body.data.members.find((m) => m.userId === adminUser.id);

        const deleteRes = await request(app)
            .delete(`/api/organizations/${organizationId}/members/${adminMember.id}`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        assert.equal(deleteRes.status, 400);
        assert.match(deleteRes.body.message, /cannot remove the last administrator/i);
    });

    await t.test("DELETE /api/organizations/:id/members/:memberId removes regular member", async () => {
        const deleteRes = await request(app)
            .delete(`/api/organizations/${organizationId}/members/${memberId}`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        assert.equal(deleteRes.status, 200);

        // Verify member is gone
        const membersRes = await request(app)
            .get(`/api/organizations/${organizationId}/members`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        const found = membersRes.body.data.members.find((m) => m.id === memberId);
        assert.equal(found, undefined);
    });
});

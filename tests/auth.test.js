import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";
import { prisma } from "../src/config/prisma.js";

test("Authentication Flow (Phase 3)", async (t) => {
    const testEmail = `user-${randomUUID()}@example.com`;
    const testPassword = "SecurePassword123!";
    const testName = "Security Engineer";

    let accessToken = "";
    let refreshToken = "";
    let refreshCookie = "";

    await t.test("POST /api/auth/register creates user and excludes passwordHash", async () => {
        const response = await request(app)
            .post("/api/auth/register")
            .send({
                name: testName,
                email: testEmail,
                password: testPassword
            });

        assert.equal(response.status, 201);
        assert.equal(response.body.status, "success");
        assert.equal(response.body.data.user.name, testName);
        assert.equal(response.body.data.user.email, testEmail.toLowerCase());
        assert.ok(response.body.data.user.id);
        assert.equal(response.body.data.user.passwordHash, undefined, "passwordHash must never be returned");
    });

    await t.test("POST /api/auth/register rejects duplicate email with 409", async () => {
        const response = await request(app)
            .post("/api/auth/register")
            .send({
                name: "Another Name",
                email: testEmail.toUpperCase(), // Case-insensitive duplicate test
                password: "AnotherPassword123!"
            });

        assert.equal(response.status, 409);
        assert.equal(response.body.status, "error");
        assert.match(response.body.message, /already exists/i);
    });

    await t.test("POST /api/auth/register rejects weak password with 400", async () => {
        const response = await request(app)
            .post("/api/auth/register")
            .send({
                name: "Weak User",
                email: `weak-${randomUUID()}@example.com`,
                password: "short"
            });

        assert.equal(response.status, 400);
        assert.equal(response.body.status, "error");
        assert.ok(response.body.errors);
    });

    await t.test("POST /api/auth/login succeeds with correct credentials and returns JWT & cookie", async () => {
        const response = await request(app)
            .post("/api/auth/login")
            .send({
                email: testEmail,
                password: testPassword
            });

        assert.equal(response.status, 200);
        assert.equal(response.body.status, "success");
        assert.ok(response.body.data.accessToken, "Should provide JWT access token");
        assert.ok(response.body.data.refreshToken, "Should provide refresh token");
        assert.equal(response.body.data.user.email, testEmail.toLowerCase());

        accessToken = response.body.data.accessToken;
        refreshToken = response.body.data.refreshToken;

        // Verify Set-Cookie header for refresh token
        const cookies = response.headers["set-cookie"];
        assert.ok(cookies, "Should set cookies");
        const cookieStr = cookies.find((c) => c.startsWith("coldtrace_refresh="));
        assert.ok(cookieStr, "Should set coldtrace_refresh cookie");
        assert.match(cookieStr, /HttpOnly/i, "Refresh cookie must be HttpOnly");

        refreshCookie = cookieStr.split(";")[0];
    });

    await t.test("POST /api/auth/login fails with invalid password (401 generic)", async () => {
        const response = await request(app)
            .post("/api/auth/login")
            .send({
                email: testEmail,
                password: "WrongPassword999!"
            });

        assert.equal(response.status, 401);
        assert.equal(response.body.status, "error");
        assert.match(response.body.message, /invalid email or password/i);
    });

    await t.test("GET /api/auth/me succeeds with valid Bearer token", async () => {
        const response = await request(app)
            .get("/api/auth/me")
            .set("Authorization", `Bearer ${accessToken}`);

        assert.equal(response.status, 200);
        assert.equal(response.body.status, "success");
        assert.equal(response.body.data.user.email, testEmail.toLowerCase());
    });

    await t.test("GET /api/auth/me rejects missing or invalid token with 401", async () => {
        const noTokenRes = await request(app).get("/api/auth/me");
        assert.equal(noTokenRes.status, 401);

        const invalidTokenRes = await request(app)
            .get("/api/auth/me")
            .set("Authorization", "Bearer invalid.jwt.token");
        assert.equal(invalidTokenRes.status, 401);
    });

    await t.test("POST /api/auth/refresh rotates session and issues new tokens", async () => {
        const response = await request(app)
            .post("/api/auth/refresh")
            .set("Cookie", refreshCookie);

        assert.equal(response.status, 200);
        assert.equal(response.body.status, "success");
        assert.ok(response.body.data.accessToken);
        assert.notEqual(response.body.data.accessToken, accessToken);

        // Update tokens
        accessToken = response.body.data.accessToken;
        const newCookies = response.headers["set-cookie"];
        const newCookieStr = newCookies.find((c) => c.startsWith("coldtrace_refresh="));
        refreshCookie = newCookieStr.split(";")[0];
    });

    await t.test("POST /api/auth/logout revokes session and clears cookie", async () => {
        const response = await request(app)
            .post("/api/auth/logout")
            .set("Cookie", refreshCookie);

        assert.equal(response.status, 200);
        assert.equal(response.body.status, "success");

        // Now trying to refresh with the revoked session must fail with 401
        const failedRefresh = await request(app)
            .post("/api/auth/refresh")
            .set("Cookie", refreshCookie);

        assert.equal(failedRefresh.status, 401);
        assert.match(failedRefresh.body.message, /invalid or expired/i);
    });
});

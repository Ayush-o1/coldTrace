import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";

test("Frontend Integration (Phase 11)", async (t) => {
    await t.test("GET / serves the index.html single page app", async () => {
        const response = await request(app).get("/");
        assert.equal(response.status, 200);
        assert.match(response.headers["content-type"], /html/);
        assert.match(response.text, /coldTrace/);
        assert.match(response.text, /js\/app\.js/);
    });

    await t.test("GET /status/:slug serves the public status page template", async () => {
        const response = await request(app).get("/status/acme-corp");
        assert.equal(response.status, 200);
        assert.match(response.headers["content-type"], /html/);
        assert.match(response.text, /System Status/);
        assert.match(response.text, /js\/status\.js/);
    });

    await t.test("GET /css/style.css serves the stylesheet", async () => {
        const response = await request(app).get("/css/style.css");
        assert.equal(response.status, 200);
        assert.match(response.headers["content-type"], /css/);
        assert.match(response.text, /--brand/);
    });

    await t.test("GET /js/api.js and /js/app.js serve frontend modules", async () => {
        const apiRes = await request(app).get("/js/api.js");
        assert.equal(apiRes.status, 200);
        assert.match(apiRes.headers["content-type"], /javascript/);

        const appRes = await request(app).get("/js/app.js");
        assert.equal(appRes.status, 200);
        assert.match(appRes.headers["content-type"], /javascript/);
    });
});

import { apiRequest, setAccessToken, getAccessToken } from "./api.js";

// Application State
let currentUser = null;
let currentOrg = null;
let userOrganizations = [];
let activeTab = "dashboard";
let selectedIncidentId = null;

// Safe DOM helpers
function el(tag, attributes = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, val] of Object.entries(attributes)) {
        if (key.startsWith("on") && typeof val === "function") {
            element.addEventListener(key.slice(2).toLowerCase(), val);
        } else if (key === "className") {
            element.className = val;
        } else {
            element.setAttribute(key, val);
        }
    }
    for (const child of children) {
        if (typeof child === "string" || typeof child === "number") {
            element.appendChild(document.createTextNode(String(child)));
        } else if (child instanceof HTMLElement) {
            element.appendChild(child);
        }
    }
    return element;
}

function showNotification(message, type = "success") {
    const alertBox = document.getElementById("alert-container");
    if (!alertBox) return;

    alertBox.replaceChildren(
        el("div", { className: `alert alert-${type}` }, message)
    );

    setTimeout(() => {
        alertBox.replaceChildren();
    }, 4000);
}

// Initialization
document.addEventListener("DOMContentLoaded", async () => {
    await checkAuth();
});

async function checkAuth() {
    if (!getAccessToken()) {
        renderAuthView();
        return;
    }

    try {
        const response = await apiRequest("/api/auth/me");
        currentUser = response.data.user;
        await loadOrganizations();
    } catch (error) {
        setAccessToken(null);
        renderAuthView();
    }
}

// -------------------------------------------------------------
// Authentication View
// -------------------------------------------------------------
function renderAuthView() {
    const root = document.getElementById("root");
    root.replaceChildren();

    const isLoginTab = true;

    const card = el("div", { className: "auth-card" },
        el("h2", {}, "coldTrace"),
        el("p", { className: "auth-subtitle" }, "Incident management platform for engineering teams"),
        el("div", { className: "tabs", style: "margin-bottom: 1.5rem" },
            el("button", {
                id: "tab-login-btn",
                className: "tab-btn active",
                onClick: () => switchAuthForm("login")
            }, "Log In"),
            el("button", {
                id: "tab-register-btn",
                className: "tab-btn",
                onClick: () => switchAuthForm("register")
            }, "Register")
        ),
        el("div", { id: "auth-form-container" })
    );

    root.appendChild(card);
    switchAuthForm("login");
}

function switchAuthForm(formType) {
    const container = document.getElementById("auth-form-container");
    const loginBtn = document.getElementById("tab-login-btn");
    const registerBtn = document.getElementById("tab-register-btn");

    if (formType === "login") {
        loginBtn.className = "tab-btn active";
        registerBtn.className = "tab-btn";

        const emailInput = el("input", { type: "email", required: "true", placeholder: "alex@example.com" });
        const passInput = el("input", { type: "password", required: "true", placeholder: "••••••••" });

        const form = el("form", {
            onSubmit: async (e) => {
                e.preventDefault();
                try {
                    const res = await apiRequest("/api/auth/login", {
                        method: "POST",
                        body: JSON.stringify({ email: emailInput.value, password: passInput.value })
                    });
                    setAccessToken(res.data.accessToken);
                    currentUser = res.data.user;
                    await loadOrganizations();
                } catch (err) {
                    showNotification(err.message, "error");
                }
            }
        },
            el("div", { className: "form-group" }, el("label", {}, "Email address"), emailInput),
            el("div", { className: "form-group" }, el("label", {}, "Password"), passInput),
            el("button", { type: "submit", className: "btn btn-primary", style: "width: 100%" }, "Log In")
        );

        container.replaceChildren(form);
    } else {
        loginBtn.className = "tab-btn";
        registerBtn.className = "tab-btn active";

        const nameInput = el("input", { type: "text", required: "true", placeholder: "Alex Smith" });
        const emailInput = el("input", { type: "email", required: "true", placeholder: "alex@example.com" });
        const passInput = el("input", { type: "password", required: "true", placeholder: "At least 8 characters" });

        const form = el("form", {
            onSubmit: async (e) => {
                e.preventDefault();
                try {
                    await apiRequest("/api/auth/register", {
                        method: "POST",
                        body: JSON.stringify({
                            name: nameInput.value,
                            email: emailInput.value,
                            password: passInput.value
                        })
                    });
                    showNotification("Account created! Please log in.", "success");
                    switchAuthForm("login");
                } catch (err) {
                    showNotification(err.message, "error");
                }
            }
        },
            el("div", { className: "form-group" }, el("label", {}, "Full Name"), nameInput),
            el("div", { className: "form-group" }, el("label", {}, "Email address"), emailInput),
            el("div", { className: "form-group" }, el("label", {}, "Password"), passInput),
            el("button", { type: "submit", className: "btn btn-primary", style: "width: 100%" }, "Create Account")
        );

        container.replaceChildren(form);
    }
}

// -------------------------------------------------------------
// Organization Management
// -------------------------------------------------------------
async function loadOrganizations() {
    try {
        const response = await apiRequest("/api/organizations");
        userOrganizations = response.data.organizations;

        if (userOrganizations.length === 0) {
            renderCreateFirstOrgView();
        } else {
            if (!currentOrg || !userOrganizations.some((o) => o.id === currentOrg.id)) {
                currentOrg = userOrganizations[0];
            }
            renderAppView();
        }
    } catch (err) {
        showNotification(err.message, "error");
    }
}

function renderCreateFirstOrgView() {
    const root = document.getElementById("root");
    const nameInput = el("input", { type: "text", required: "true", placeholder: "Acme Corp" });

    root.replaceChildren(
        el("div", { className: "auth-card" },
            el("h2", {}, "Welcome to coldTrace"),
            el("p", { className: "auth-subtitle" }, "Create an organization to start managing services and incidents."),
            el("form", {
                onSubmit: async (e) => {
                    e.preventDefault();
                    try {
                        const res = await apiRequest("/api/organizations", {
                            method: "POST",
                            body: JSON.stringify({ name: nameInput.value })
                        });
                        currentOrg = res.data.organization;
                        await loadOrganizations();
                    } catch (err) {
                        showNotification(err.message, "error");
                    }
                }
            },
                el("div", { className: "form-group" }, el("label", {}, "Organization Name"), nameInput),
                el("button", { type: "submit", className: "btn btn-primary", style: "width: 100%" }, "Create Organization")
            )
        )
    );
}

// -------------------------------------------------------------
// Main Application View
// -------------------------------------------------------------
function renderAppView() {
    const root = document.getElementById("root");

    // Header
    const orgSelect = el("select", {
        onChange: (e) => {
            if (e.target.value === "new") {
                showCreateOrgModal();
            } else {
                currentOrg = userOrganizations.find((o) => o.id === e.target.value);
                renderMainContent();
            }
        }
    });

    userOrganizations.forEach((org) => {
        const opt = el("option", { value: org.id }, `${org.name} (${org.role})`);
        if (org.id === currentOrg?.id) opt.selected = true;
        orgSelect.appendChild(opt);
    });

    const newOrgOption = el("option", { value: "new" }, "+ New Organization...");
    orgSelect.appendChild(newOrgOption);

    const header = el("header", { className: "header" },
        el("a", { className: "brand", href: "#" },
            el("span", { className: "brand-dot" }),
            "coldTrace"
        ),
        el("div", { className: "nav-links" },
            el("div", { style: "display: flex; align-items: center; gap: 0.5rem" },
                el("span", { style: "font-weight: 500" }, "Org:"),
                orgSelect
            ),
            el("a", {
                className: "btn btn-secondary btn-sm",
                href: `/status.html?org=${currentOrg.slug}`,
                target: "_blank"
            }, "Public Status Page ↗"),
            el("button", {
                className: "btn btn-secondary btn-sm",
                onClick: async () => {
                    await apiRequest("/api/auth/logout", { method: "POST" });
                    setAccessToken(null);
                    currentUser = null;
                    currentOrg = null;
                    renderAuthView();
                }
            }, "Log Out")
        )
    );

    // Navigation Tabs
    const tabs = el("div", { className: "tabs" },
        el("button", {
            className: `tab-btn ${activeTab === "dashboard" ? "active" : ""}`,
            onClick: () => switchTab("dashboard")
        }, "Dashboard"),
        el("button", {
            className: `tab-btn ${activeTab === "incidents" ? "active" : ""}`,
            onClick: () => switchTab("incidents")
        }, "Incidents"),
        el("button", {
            className: `tab-btn ${activeTab === "services" ? "active" : ""}`,
            onClick: () => switchTab("services")
        }, "Services"),
        el("button", {
            className: `tab-btn ${activeTab === "members" ? "active" : ""}`,
            onClick: () => switchTab("members")
        }, "Team Members")
    );

    const container = el("div", { className: "app-container" },
        el("div", { id: "alert-container" }),
        tabs,
        el("div", { id: "tab-content" })
    );

    root.replaceChildren(header, container);
    renderMainContent();
}

function switchTab(tabName) {
    activeTab = tabName;
    selectedIncidentId = null;
    renderAppView();
}

function renderMainContent() {
    const content = document.getElementById("tab-content");
    if (!content) return;

    if (activeTab === "dashboard") {
        renderDashboard(content);
    } else if (activeTab === "incidents") {
        if (selectedIncidentId) {
            renderIncidentDetail(content, selectedIncidentId);
        } else {
            renderIncidentsList(content);
        }
    } else if (activeTab === "services") {
        renderServices(content);
    } else if (activeTab === "members") {
        renderMembers(content);
    }
}

// -------------------------------------------------------------
// 1. Dashboard Tab
// -------------------------------------------------------------
async function renderDashboard(container) {
    container.replaceChildren(el("p", { className: "text-muted" }, "Loading organization health..."));

    try {
        const response = await apiRequest(`/api/organizations/${currentOrg.id}/health`);
        const health = response.data;

        const statusClass = health.overallStatus.toLowerCase();

        const card = el("div", { className: "card" },
            el("div", { style: "display: flex; justify-content: space-between; align-items: center;" },
                el("div", {},
                    el("h2", { style: "font-size: 1.25rem; font-weight: 600;" }, "System Health Overview"),
                    el("p", { className: "text-muted", style: "font-size: 0.85rem;" },
                        `Real-time status calculated from ${health.services.length} services and active incidents.`
                    )
                ),
                el("span", { className: `badge badge-${statusClass}`, style: "font-size: 0.9rem; padding: 0.4rem 0.8rem;" },
                    health.overallStatus.replace("_", " ")
                )
            ),
            el("div", { className: "grid-3", style: "margin-top: 1.5rem;" },
                el("div", { className: "card", style: "background: #f8fafc;" },
                    el("div", { style: "font-size: 0.8rem; color: #64748b; font-weight: 600;" }, "ACTIVE INCIDENTS"),
                    el("div", { style: "font-size: 2rem; font-weight: 700; margin-top: 0.25rem;" }, health.activeIncidentsCount)
                ),
                el("div", { className: "card", style: "background: #f8fafc;" },
                    el("div", { style: "font-size: 0.8rem; color: #64748b; font-weight: 600;" }, "CRITICAL & HIGH"),
                    el("div", { style: "font-size: 2rem; font-weight: 700; color: #dc2626; margin-top: 0.25rem;" },
                        health.activeIncidentsBySeverity.CRITICAL + health.activeIncidentsBySeverity.HIGH
                    )
                ),
                el("div", { className: "card", style: "background: #f8fafc;" },
                    el("div", { style: "font-size: 0.8rem; color: #64748b; font-weight: 600;" }, "MONITORED SERVICES"),
                    el("div", { style: "font-size: 2rem; font-weight: 700; margin-top: 0.25rem;" }, health.services.length)
                )
            )
        );

        // Services Table
        const servicesCard = el("div", { className: "card", style: "margin-top: 1.5rem;" },
            el("h3", { style: "font-size: 1rem; margin-bottom: 1rem;" }, "Monitored Services Status"),
            health.services.length === 0
                ? el("p", { className: "empty-state" }, "No services configured yet.")
                : el("table", {},
                    el("thead", {},
                        el("tr", {},
                            el("th", {}, "Service"),
                            el("th", {}, "Slug"),
                            el("th", {}, "Status"),
                            el("th", {}, "Active Incidents")
                        )
                    ),
                    el("tbody", {},
                        ...health.services.map((s) =>
                            el("tr", {},
                                el("td", { style: "font-weight: 600;" }, s.name),
                                el("td", { style: "color: #64748b;" }, s.slug),
                                el("td", {}, el("span", { className: `badge badge-${s.healthStatus.toLowerCase()}` }, s.healthStatus.replace("_", " "))),
                                el("td", {}, s.activeIncidentsCount)
                            )
                        )
                    )
                )
        );

        container.replaceChildren(card, servicesCard);
    } catch (err) {
        container.replaceChildren(el("div", { className: "alert alert-error" }, err.message));
    }
}

// -------------------------------------------------------------
// 2. Services Management Tab
// -------------------------------------------------------------
async function renderServices(container) {
    container.replaceChildren(el("p", { className: "text-muted" }, "Loading services..."));

    try {
        const response = await apiRequest(`/api/organizations/${currentOrg.id}/services?includeArchived=true`);
        const services = response.data.services;

        const isAdmin = currentOrg.role === "ADMIN";

        const topbar = el("div", { className: "topbar" },
            el("div", {},
                el("h2", { style: "font-size: 1.25rem; font-weight: 600;" }, "Services"),
                el("p", { className: "text-muted", style: "font-size: 0.85rem;" }, "Manage the infrastructure and applications monitored by coldTrace.")
            ),
            isAdmin ? el("button", {
                className: "btn btn-primary",
                onClick: () => showCreateServiceModal()
            }, "+ New Service") : el("span")
        );

        const table = el("table", {},
            el("thead", {},
                el("tr", {},
                    el("th", {}, "Name"),
                    el("th", {}, "Slug"),
                    el("th", {}, "Status"),
                    el("th", {}, "Created"),
                    isAdmin ? el("th", {}, "Actions") : el("span")
                )
            ),
            el("tbody", {},
                ...services.map((service) =>
                    el("tr", {},
                        el("td", { style: "font-weight: 600;" }, service.name),
                        el("td", { style: "color: #64748b;" }, service.slug),
                        el("td", {},
                            service.isArchived
                                ? el("span", { className: "badge badge-closed" }, "Archived")
                                : el("span", { className: "badge badge-resolved" }, "Active")
                        ),
                        el("td", {}, new Date(service.createdAt).toLocaleDateString()),
                        isAdmin && !service.isArchived ? el("td", {},
                            el("button", {
                                className: "btn btn-danger btn-sm",
                                onClick: async () => {
                                    if (confirm(`Archive ${service.name}? It will be hidden from health calculation.`)) {
                                        try {
                                            await apiRequest(`/api/organizations/${currentOrg.id}/services/${service.id}`, { method: "DELETE" });
                                            showNotification("Service archived successfully");
                                            renderMainContent();
                                        } catch (err) {
                                            showNotification(err.message, "error");
                                        }
                                    }
                                }
                            }, "Archive")
                        ) : el("td")
                    )
                )
            )
        );

        container.replaceChildren(topbar, el("div", { className: "card" }, table));
    } catch (err) {
        container.replaceChildren(el("div", { className: "alert alert-error" }, err.message));
    }
}

function showCreateServiceModal() {
    const nameInput = el("input", { type: "text", required: "true", placeholder: "e.g. Payment Gateway" });
    const slugInput = el("input", { type: "text", placeholder: "e.g. payment-gateway (optional)" });

    const modal = el("div", {
        style: "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 50;"
    },
        el("div", { className: "auth-card", style: "margin: 0; width: 440px;" },
            el("h2", {}, "Create New Service"),
            el("p", { className: "auth-subtitle" }, "Add a new software service to this organization."),
            el("form", {
                onSubmit: async (e) => {
                    e.preventDefault();
                    try {
                        await apiRequest(`/api/organizations/${currentOrg.id}/services`, {
                            method: "POST",
                            body: JSON.stringify({
                                name: nameInput.value,
                                slug: slugInput.value || undefined
                            })
                        });
                        document.body.removeChild(modal);
                        showNotification("Service created successfully!");
                        renderMainContent();
                    } catch (err) {
                        showNotification(err.message, "error");
                    }
                }
            },
                el("div", { className: "form-group" }, el("label", {}, "Service Name"), nameInput),
                el("div", { className: "form-group" }, el("label", {}, "Custom Slug"), slugInput),
                el("div", { style: "display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem;" },
                    el("button", {
                        type: "button",
                        className: "btn btn-secondary",
                        onClick: () => document.body.removeChild(modal)
                    }, "Cancel"),
                    el("button", { type: "submit", className: "btn btn-primary" }, "Create Service")
                )
            )
        )
    );

    document.body.appendChild(modal);
}

// -------------------------------------------------------------
// 3. Incidents Tab
// -------------------------------------------------------------
async function renderIncidentsList(container) {
    container.replaceChildren(el("p", { className: "text-muted" }, "Loading incidents..."));

    try {
        const response = await apiRequest(`/api/organizations/${currentOrg.id}/incidents?limit=50`);
        const incidents = response.data.incidents;

        const isMemberOrAdmin = currentOrg.role === "ADMIN" || currentOrg.role === "MEMBER";

        const topbar = el("div", { className: "topbar" },
            el("div", {},
                el("h2", { style: "font-size: 1.25rem; font-weight: 600;" }, "Incidents"),
                el("p", { className: "text-muted", style: "font-size: 0.85rem;" }, "Coordinate triage and lifecycle response.")
            ),
            isMemberOrAdmin ? el("button", {
                className: "btn btn-primary",
                onClick: () => showCreateIncidentModal()
            }, "+ New Incident") : el("span")
        );

        if (incidents.length === 0) {
            container.replaceChildren(
                topbar,
                el("div", { className: "card empty-state" },
                    el("h3", {}, "No incidents reported"),
                    el("p", {}, "All systems are operating smoothly.")
                )
            );
            return;
        }

        const table = el("table", {},
            el("thead", {},
                el("tr", {},
                    el("th", {}, "Title"),
                    el("th", {}, "Status"),
                    el("th", {}, "Severity"),
                    el("th", {}, "Affected Services"),
                    el("th", {}, "Assignee"),
                    el("th", {}, "Reported")
                )
            ),
            el("tbody", {},
                ...incidents.map((inc) =>
                    el("tr", {
                        style: "cursor: pointer;",
                        onClick: () => {
                            selectedIncidentId = inc.id;
                            renderMainContent();
                        }
                    },
                        el("td", { style: "font-weight: 600;" }, inc.title),
                        el("td", {}, el("span", { className: `badge badge-${inc.status.toLowerCase()}` }, inc.status)),
                        el("td", {}, el("span", { className: `badge badge-${inc.severity.toLowerCase()}` }, inc.severity)),
                        el("td", {}, inc.services.map((s) => s.name).join(", ") || "—"),
                        el("td", {}, inc.assignedTo ? inc.assignedTo.name : "Unassigned"),
                        el("td", {}, new Date(inc.createdAt).toLocaleString())
                    )
                )
            )
        );

        container.replaceChildren(topbar, el("div", { className: "card" }, table));
    } catch (err) {
        container.replaceChildren(el("div", { className: "alert alert-error" }, err.message));
    }
}

async function showCreateIncidentModal() {
    // Fetch org services and members for dropdown selection
    const [servicesRes, membersRes] = await Promise.all([
        apiRequest(`/api/organizations/${currentOrg.id}/services`),
        apiRequest(`/api/organizations/${currentOrg.id}/members`)
    ]);

    const services = servicesRes.data.services;
    const members = membersRes.data.members;

    const titleInput = el("input", { type: "text", required: "true", placeholder: "e.g. Postgres Connection Pool Exhausted" });
    const descInput = el("textarea", { required: "true", placeholder: "Details regarding error symptoms and impact..." });
    const severitySelect = el("select", {},
        el("option", { value: "LOW" }, "LOW"),
        el("option", { value: "MEDIUM" }, "MEDIUM"),
        el("option", { value: "HIGH", selected: "true" }, "HIGH"),
        el("option", { value: "CRITICAL" }, "CRITICAL")
    );

    const assigneeSelect = el("select", {},
        el("option", { value: "" }, "Unassigned"),
        ...members.map((m) => el("option", { value: m.userId }, `${m.name} (${m.email})`))
    );

    const serviceCheckboxes = services.map((s) => ({
        serviceId: s.id,
        checkbox: el("input", { type: "checkbox", value: s.id }),
        name: s.name
    }));

    const modal = el("div", {
        style: "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 50;"
    },
        el("div", { className: "auth-card", style: "margin: 0; width: 520px; max-height: 90vh; overflow-y: auto;" },
            el("h2", {}, "Report New Incident"),
            el("p", { className: "auth-subtitle" }, "Trigger incident response across the organization."),
            el("form", {
                onSubmit: async (e) => {
                    e.preventDefault();
                    const selectedServices = serviceCheckboxes
                        .filter((item) => item.checkbox.checked)
                        .map((item) => item.serviceId);

                    try {
                        const res = await apiRequest(`/api/organizations/${currentOrg.id}/incidents`, {
                            method: "POST",
                            body: JSON.stringify({
                                title: titleInput.value,
                                description: descInput.value,
                                severity: severitySelect.value,
                                assignedToId: assigneeSelect.value || null,
                                serviceIds: selectedServices
                            })
                        });
                        document.body.removeChild(modal);
                        showNotification("Incident created successfully!");
                        selectedIncidentId = res.data.incident.id;
                        renderMainContent();
                    } catch (err) {
                        showNotification(err.message, "error");
                    }
                }
            },
                el("div", { className: "form-group" }, el("label", {}, "Incident Title"), titleInput),
                el("div", { className: "form-group" }, el("label", {}, "Severity Level"), severitySelect),
                el("div", { className: "form-group" }, el("label", {}, "Assignee"), assigneeSelect),
                el("div", { className: "form-group" },
                    el("label", {}, "Affected Services"),
                    el("div", { style: "display: flex; flex-direction: column; gap: 0.35rem; max-height: 120px; overflow-y: auto; border: 1px solid #e2e8f0; padding: 0.5rem; border-radius: 4px;" },
                        ...serviceCheckboxes.map((item) =>
                            el("label", { style: "display: flex; align-items: center; gap: 0.5rem; font-weight: normal;" },
                                item.checkbox,
                                item.name
                            )
                        )
                    )
                ),
                el("div", { className: "form-group" }, el("label", {}, "Description & Impact"), descInput),
                el("div", { style: "display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem;" },
                    el("button", {
                        type: "button",
                        className: "btn btn-secondary",
                        onClick: () => document.body.removeChild(modal)
                    }, "Cancel"),
                    el("button", { type: "submit", className: "btn btn-primary" }, "Create Incident")
                )
            )
        )
    );

    document.body.appendChild(modal);
}

// -------------------------------------------------------------
// 4. Incident Detail & Lifecycle View
// -------------------------------------------------------------
async function renderIncidentDetail(container, incidentId) {
    container.replaceChildren(el("p", { className: "text-muted" }, "Loading incident details..."));

    try {
        const [incRes, timelineRes] = await Promise.all([
            apiRequest(`/api/organizations/${currentOrg.id}/incidents/${incidentId}`),
            apiRequest(`/api/organizations/${currentOrg.id}/incidents/${incidentId}/timeline`)
        ]);

        const incident = incRes.data.incident;
        const timeline = timelineRes.data.timeline;

        const isMemberOrAdmin = currentOrg.role === "ADMIN" || currentOrg.role === "MEMBER";

        // Navigation header
        const topbar = el("div", { className: "topbar" },
            el("div", { style: "display: flex; align-items: center; gap: 1rem;" },
                el("button", {
                    className: "btn btn-secondary btn-sm",
                    onClick: () => {
                        selectedIncidentId = null;
                        renderMainContent();
                    }
                }, "← Back to Incidents"),
                el("h2", { style: "font-size: 1.35rem; font-weight: 700;" }, incident.title)
            ),
            el("div", { style: "display: flex; gap: 0.5rem; align-items: center;" },
                el("span", { className: `badge badge-${incident.status.toLowerCase()}`, style: "font-size: 0.85rem;" }, incident.status),
                el("span", { className: `badge badge-${incident.severity.toLowerCase()}`, style: "font-size: 0.85rem;" }, incident.severity)
            )
        );

        // Lifecycle Actions Bar
        const lifecycleControls = el("div", { className: "card", style: "display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;" },
            el("span", { style: "font-weight: 600; font-size: 0.85rem; color: #64748b;" }, "LIFECYCLE TRANSITIONS:"),
            incident.status === "TRIGGERED" && isMemberOrAdmin
                ? el("button", {
                    className: "btn btn-secondary btn-sm",
                    onClick: async () => {
                        try {
                            await apiRequest(`/api/organizations/${currentOrg.id}/incidents/${incident.id}/acknowledge`, { method: "POST" });
                            showNotification("Incident Acknowledged");
                            renderIncidentDetail(container, incidentId);
                        } catch (err) {
                            showNotification(err.message, "error");
                        }
                    }
                }, "✓ Acknowledge") : el("span"),

            incident.status === "ACKNOWLEDGED" && isMemberOrAdmin
                ? el("button", {
                    className: "btn btn-success btn-sm",
                    onClick: async () => {
                        try {
                            await apiRequest(`/api/organizations/${currentOrg.id}/incidents/${incident.id}/resolve`, { method: "POST" });
                            showNotification("Incident Resolved");
                            renderIncidentDetail(container, incidentId);
                        } catch (err) {
                            showNotification(err.message, "error");
                        }
                    }
                }, "★ Mark Resolved") : el("span"),

            incident.status === "RESOLVED" && isMemberOrAdmin
                ? el("button", {
                    className: "btn btn-secondary btn-sm",
                    onClick: async () => {
                        try {
                            await apiRequest(`/api/organizations/${currentOrg.id}/incidents/${incident.id}/close`, { method: "POST" });
                            showNotification("Incident Closed");
                            renderIncidentDetail(container, incidentId);
                        } catch (err) {
                            showNotification(err.message, "error");
                        }
                    }
                }, "🔒 Close Incident") : el("span"),

            incident.status === "CLOSED"
                ? el("span", { style: "font-size: 0.85rem; color: #64748b;" }, "This incident is closed.")
                : el("span")
        );

        // Details grid
        const detailsCard = el("div", { className: "card" },
            el("div", { className: "grid-2", style: "margin-bottom: 1rem;" },
                el("div", {},
                    el("div", { style: "font-size: 0.8rem; color: #64748b; font-weight: 600;" }, "ASSIGNED RESPONDER"),
                    el("div", { style: "font-weight: 500; margin-top: 0.2rem;" }, incident.assignedTo ? incident.assignedTo.name : "Unassigned")
                ),
                el("div", {},
                    el("div", { style: "font-size: 0.8rem; color: #64748b; font-weight: 600;" }, "AFFECTED SERVICES"),
                    el("div", { style: "font-weight: 500; margin-top: 0.2rem;" },
                        incident.services.map((s) => s.name).join(", ") || "None specified"
                    )
                )
            ),
            el("div", { style: "border-top: 1px solid #e2e8f0; padding-top: 1rem;" },
                el("div", { style: "font-size: 0.8rem; color: #64748b; font-weight: 600; margin-bottom: 0.35rem;" }, "DESCRIPTION"),
                el("p", { style: "white-space: pre-wrap; font-size: 0.95rem;" }, incident.description)
            )
        );

        // Post Update Form
        const updateMsgInput = el("textarea", { placeholder: "Write incident update for the response team or public status..." });
        const visibilitySelect = el("select", { style: "width: auto;" },
            el("option", { value: "INTERNAL" }, "Internal (Team only)"),
            el("option", { value: "PUBLIC" }, "Public (Visible on Status Page)")
        );

        const updateForm = isMemberOrAdmin ? el("div", { className: "card" },
            el("h3", { style: "font-size: 1rem; margin-bottom: 0.75rem;" }, "Post Incident Update"),
            el("form", {
                onSubmit: async (e) => {
                    e.preventDefault();
                    if (!updateMsgInput.value.trim()) return;

                    try {
                        await apiRequest(`/api/organizations/${currentOrg.id}/incidents/${incident.id}/updates`, {
                            method: "POST",
                            body: JSON.stringify({
                                message: updateMsgInput.value,
                                visibility: visibilitySelect.value
                            })
                        });
                        showNotification("Update posted!");
                        renderIncidentDetail(container, incidentId);
                    } catch (err) {
                        showNotification(err.message, "error");
                    }
                }
            },
                el("div", { className: "form-group" }, updateMsgInput),
                el("div", { style: "display: flex; justify-content: space-between; align-items: center;" },
                    el("div", { style: "display: flex; align-items: center; gap: 0.5rem;" },
                        el("label", { style: "margin: 0;" }, "Visibility:"),
                        visibilitySelect
                    ),
                    el("button", { type: "submit", className: "btn btn-primary" }, "Post Update")
                )
            )
        ) : el("span");

        // Chronological Audit Timeline
        const timelineCard = el("div", { className: "card" },
            el("h3", { style: "font-size: 1rem; margin-bottom: 1rem;" }, "Activity & Audit Timeline"),
            timeline.length === 0
                ? el("p", { className: "empty-state" }, "No timeline events recorded.")
                : el("div", { className: "timeline" },
                    ...timeline.map((event) => {
                        let actionDesc = event.action.replace(/_/g, " ");
                        if (event.metadata?.newStatus) {
                            actionDesc = `Status transitioned to ${event.metadata.newStatus}`;
                        } else if (event.metadata?.visibility) {
                            actionDesc = `Posted ${event.metadata.visibility} update`;
                        }

                        return el("div", { className: "timeline-item" },
                            el("div", { className: "timeline-header" },
                                el("strong", {}, event.actor?.name || "System"),
                                " • ",
                                new Date(event.createdAt).toLocaleString()
                            ),
                            el("div", { className: "timeline-content", style: "font-weight: 500;" }, actionDesc)
                        );
                    })
                )
        );

        container.replaceChildren(topbar, lifecycleControls, detailsCard, updateForm, timelineCard);
    } catch (err) {
        container.replaceChildren(el("div", { className: "alert alert-error" }, err.message));
    }
}

// -------------------------------------------------------------
// 5. Team Members Tab
// -------------------------------------------------------------
async function renderMembers(container) {
    container.replaceChildren(el("p", { className: "text-muted" }, "Loading team members..."));

    try {
        const response = await apiRequest(`/api/organizations/${currentOrg.id}/members`);
        const members = response.data.members;

        const isAdmin = currentOrg.role === "ADMIN";

        const topbar = el("div", { className: "topbar" },
            el("div", {},
                el("h2", { style: "font-size: 1.25rem; font-weight: 600;" }, "Team Members"),
                el("p", { className: "text-muted", style: "font-size: 0.85rem;" }, "Manage organizational membership and role permissions.")
            ),
            isAdmin ? el("button", {
                className: "btn btn-primary",
                onClick: () => showAddMemberModal()
            }, "+ Add Member") : el("span")
        );

        const table = el("table", {},
            el("thead", {},
                el("tr", {},
                    el("th", {}, "Name"),
                    el("th", {}, "Email"),
                    el("th", {}, "Role"),
                    el("th", {}, "Joined"),
                    isAdmin ? el("th", {}, "Actions") : el("span")
                )
            ),
            el("tbody", {},
                ...members.map((m) =>
                    el("tr", {},
                        el("td", { style: "font-weight: 600;" }, m.name),
                        el("td", { style: "color: #64748b;" }, m.email),
                        el("td", {}, el("span", { className: "badge badge-resolved" }, m.role)),
                        el("td", {}, new Date(m.joinedAt).toLocaleDateString()),
                        isAdmin ? el("td", {},
                            el("button", {
                                className: "btn btn-danger btn-sm",
                                onClick: async () => {
                                    if (confirm(`Remove ${m.name} from this organization?`)) {
                                        try {
                                            await apiRequest(`/api/organizations/${currentOrg.id}/members/${m.id}`, { method: "DELETE" });
                                            showNotification("Member removed");
                                            renderMainContent();
                                        } catch (err) {
                                            showNotification(err.message, "error");
                                        }
                                    }
                                }
                            }, "Remove")
                        ) : el("td")
                    )
                )
            )
        );

        container.replaceChildren(topbar, el("div", { className: "card" }, table));
    } catch (err) {
        container.replaceChildren(el("div", { className: "alert alert-error" }, err.message));
    }
}

function showAddMemberModal() {
    const emailInput = el("input", { type: "email", required: "true", placeholder: "colleague@example.com" });
    const roleSelect = el("select", {},
        el("option", { value: "MEMBER", selected: "true" }, "MEMBER (Create & respond to incidents)"),
        el("option", { value: "VIEWER" }, "VIEWER (Read-only access)"),
        el("option", { value: "ADMIN" }, "ADMIN (Full organization management)")
    );

    const modal = el("div", {
        style: "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 50;"
    },
        el("div", { className: "auth-card", style: "margin: 0; width: 440px;" },
            el("h2", {}, "Add Team Member"),
            el("p", { className: "auth-subtitle" }, "Add an existing registered user to this organization."),
            el("form", {
                onSubmit: async (e) => {
                    e.preventDefault();
                    try {
                        await apiRequest(`/api/organizations/${currentOrg.id}/members`, {
                            method: "POST",
                            body: JSON.stringify({
                                email: emailInput.value,
                                role: roleSelect.value
                            })
                        });
                        document.body.removeChild(modal);
                        showNotification("Member added successfully!");
                        renderMainContent();
                    } catch (err) {
                        showNotification(err.message, "error");
                    }
                }
            },
                el("div", { className: "form-group" }, el("label", {}, "User Email"), emailInput),
                el("div", { className: "form-group" }, el("label", {}, "Organization Role"), roleSelect),
                el("div", { style: "display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem;" },
                    el("button", {
                        type: "button",
                        className: "btn btn-secondary",
                        onClick: () => document.body.removeChild(modal)
                    }, "Cancel"),
                    el("button", { type: "submit", className: "btn btn-primary" }, "Add Member")
                )
            )
        )
    );

    document.body.appendChild(modal);
}

function showCreateOrgModal() {
    const nameInput = el("input", { type: "text", required: "true", placeholder: "e.g. Infrastructure Engineering" });

    const modal = el("div", {
        style: "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 50;"
    },
        el("div", { className: "auth-card", style: "margin: 0; width: 440px;" },
            el("h2", {}, "Create New Organization"),
            el("p", { className: "auth-subtitle" }, "You will be assigned as the ADMIN of this organization."),
            el("form", {
                onSubmit: async (e) => {
                    e.preventDefault();
                    try {
                        const res = await apiRequest("/api/organizations", {
                            method: "POST",
                            body: JSON.stringify({ name: nameInput.value })
                        });
                        document.body.removeChild(modal);
                        showNotification("Organization created!");
                        currentOrg = res.data.organization;
                        await loadOrganizations();
                    } catch (err) {
                        showNotification(err.message, "error");
                    }
                }
            },
                el("div", { className: "form-group" }, el("label", {}, "Organization Name"), nameInput),
                el("div", { style: "display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem;" },
                    el("button", {
                        type: "button",
                        className: "btn btn-secondary",
                        onClick: () => {
                            document.body.removeChild(modal);
                            renderAppView();
                        }
                    }, "Cancel"),
                    el("button", { type: "submit", className: "btn btn-primary" }, "Create")
                )
            )
        )
    );

    document.body.appendChild(modal);
}

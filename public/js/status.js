function el(tag, attributes = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, val] of Object.entries(attributes)) {
        if (key === "className") {
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

document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById("status-container");

    // Determine slug from URL query (?org=slug) or pathname (/status/slug)
    const urlParams = new URLSearchParams(window.location.search);
    let slug = urlParams.get("org");

    if (!slug) {
        const pathParts = window.location.pathname.split("/").filter(Boolean);
        if (pathParts[0] === "status" && pathParts[1]) {
            slug = pathParts[1];
        }
    }

    if (!slug) {
        container.replaceChildren(
            el("div", { className: "card empty-state" },
                el("h3", {}, "No Organization Specified"),
                el("p", {}, "Please provide an organization slug in the URL (e.g. /status.html?org=your-org-slug).")
            )
        );
        return;
    }

    try {
        const response = await fetch(`/api/public/status/${slug}`);
        if (!response.ok) {
            throw new Error(`Status page not found for organization "${slug}"`);
        }

        const json = await response.json();
        const data = json.data;

        document.title = `${data.organization.name} — Status`;

        const statusClass = data.overallStatus.toLowerCase();
        let statusText = "All Systems Operational";
        if (data.overallStatus === "DEGRADED") statusText = "Active Service Degradation";
        if (data.overallStatus === "MAJOR_OUTAGE") statusText = "Major System Outage";

        const header = el("div", { className: "status-header" },
            el("h1", { style: "font-size: 1.75rem; font-weight: 700;" }, data.organization.name),
            el("div", { className: `status-indicator ${statusClass}` },
                el("span", { style: "font-size: 1.5rem;" }, "●"),
                statusText
            ),
            el("div", { style: "font-size: 0.8rem; color: #64748b; margin-top: 0.75rem;" },
                `Last updated: ${new Date(data.updatedAt).toLocaleString()}`
            )
        );

        // Services section
        const servicesCard = el("div", { className: "card", style: "margin-top: 2rem;" },
            el("h2", { style: "font-size: 1.1rem; margin-bottom: 1rem;" }, "Services Status"),
            el("table", {},
                el("tbody", {},
                    ...data.services.map((service) =>
                        el("tr", {},
                            el("td", { style: "font-weight: 500; font-size: 0.95rem;" }, service.name),
                            el("td", { style: "text-align: right;" },
                                el("span", { className: `badge badge-${service.status.toLowerCase()}` },
                                    service.status.replace("_", " ")
                                )
                            )
                        )
                    )
                )
            )
        );

        // Active Incidents section
        const incidentsCard = el("div", { style: "margin-top: 2.5rem;" },
            el("h2", { style: "font-size: 1.1rem; margin-bottom: 1rem;" }, "Active Incidents & Updates"),
            data.incidents.length === 0
                ? el("div", { className: "card empty-state", style: "padding: 2rem;" },
                    el("p", { style: "color: #16a34a; font-weight: 500;" }, "✓ No active incidents reported.")
                )
                : el("div", {},
                    ...data.incidents.map((inc) =>
                        el("div", { className: "card", style: "margin-bottom: 1.25rem;" },
                            el("div", { style: "display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;" },
                                el("div", {},
                                    el("h3", { style: "font-size: 1.05rem; font-weight: 600;" }, inc.title),
                                    el("div", { style: "font-size: 0.8rem; color: #64748b; margin-top: 0.2rem;" },
                                        `Reported: ${new Date(inc.createdAt).toLocaleString()} • Status: ${inc.status}`
                                    )
                                ),
                                el("span", { className: `badge badge-${inc.severity.toLowerCase()}` }, inc.severity)
                            ),
                            el("div", { style: "margin-top: 1rem; border-top: 1px solid #e2e8f0; padding-top: 0.75rem;" },
                                el("h4", { style: "font-size: 0.85rem; color: #64748b; margin-bottom: 0.5rem;" }, "Public Updates:"),
                                inc.updates.length === 0
                                    ? el("p", { style: "font-size: 0.85rem; color: #64748b; font-style: italic;" }, "No public updates posted yet.")
                                    : el("div", { style: "display: flex; flex-direction: column; gap: 0.75rem;" },
                                        ...inc.updates.map((u) =>
                                            el("div", { style: "background: #f8fafc; padding: 0.6rem 0.8rem; border-radius: 4px; border-left: 3px solid #2563eb;" },
                                                el("div", { style: "font-size: 0.75rem; color: #64748b; margin-bottom: 0.2rem;" },
                                                    new Date(u.createdAt).toLocaleString()
                                                ),
                                                el("div", { style: "font-size: 0.9rem;" }, u.message)
                                            )
                                        )
                                    )
                            )
                        )
                    )
                )
        );

        container.replaceChildren(header, servicesCard, incidentsCard);
    } catch (err) {
        container.replaceChildren(
            el("div", { className: "card empty-state" },
                el("h3", { style: "color: #dc2626;" }, "Status Unavailable"),
                el("p", {}, err.message)
            )
        );
    }
});


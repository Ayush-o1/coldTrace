/**
 * coldTrace API Client
 * Centralized fetch wrapper managing JWT access tokens, refresh rotation, and uniform error handling.
 */

let accessToken = sessionStorage.getItem("coldtrace_access_token") || null;

export function setAccessToken(token) {
    accessToken = token;
    if (token) {
        sessionStorage.setItem("coldtrace_access_token", token);
    } else {
        sessionStorage.removeItem("coldtrace_access_token");
    }
}

export function getAccessToken() {
    return accessToken;
}

/**
 * Performs authenticated requests. Automatically attempts refresh rotation on 401.
 */
export async function apiRequest(endpoint, options = {}) {
    const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {})
    };

    if (accessToken) {
        headers["Authorization"] = `Bearer ${accessToken}`;
    }

    let response = await fetch(endpoint, {
        ...options,
        headers
    });

    // If access token expired, attempt token refresh using the httpOnly cookie
    if (response.status === 401 && !options._retry && !endpoint.includes("/auth/")) {
        try {
            const refreshRes = await fetch("/api/auth/refresh", {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });

            if (refreshRes.ok) {
                const refreshData = await refreshRes.json();
                setAccessToken(refreshData.data.accessToken);

                // Retry original request with fresh token
                headers["Authorization"] = `Bearer ${refreshData.data.accessToken}`;
                return fetch(endpoint, {
                    ...options,
                    headers,
                    _retry: true
                }).then(handleResponse);
            } else {
                setAccessToken(null);
            }
        } catch (e) {
            setAccessToken(null);
        }
    }

    return handleResponse(response);
}

async function handleResponse(response) {
    const contentType = response.headers.get("content-type");
    const isJson = contentType && contentType.includes("application/json");
    const data = isJson ? await response.json() : null;

    if (!response.ok) {
        const errorMsg = data?.message || `Request failed with status ${response.status}`;
        const error = new Error(errorMsg);
        error.status = response.status;
        error.errors = data?.errors;
        throw error;
    }

    return data;
}


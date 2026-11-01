/**
 * Health states supported by coldTrace.
 */
export const HEALTH_STATUS = {
    OPERATIONAL: "OPERATIONAL",
    DEGRADED: "DEGRADED",
    MAJOR_OUTAGE: "MAJOR_OUTAGE"
};

/**
 * Derives the current health status of a software service based on active incidents.
 *
 * Rules:
 * - No active incidents -> OPERATIONAL
 * - Highest active severity is LOW or MEDIUM -> DEGRADED
 * - Highest active severity is HIGH or CRITICAL -> MAJOR_OUTAGE
 *
 * Inactive incidents (RESOLVED, CLOSED) are excluded.
 *
 * @param {Array<{ severity: string, status: string }>} activeIncidents
 * @returns {string} OPERATIONAL | DEGRADED | MAJOR_OUTAGE
 */
export function calculateServiceHealth(activeIncidents = []) {
    if (!activeIncidents || activeIncidents.length === 0) {
        return HEALTH_STATUS.OPERATIONAL;
    }

    const severities = activeIncidents.map((inc) => inc.severity);

    if (severities.includes("CRITICAL") || severities.includes("HIGH")) {
        return HEALTH_STATUS.MAJOR_OUTAGE;
    }

    if (severities.includes("MEDIUM") || severities.includes("LOW")) {
        return HEALTH_STATUS.DEGRADED;
    }

    return HEALTH_STATUS.OPERATIONAL;
}

/**
 * Derives overall organization status from a collection of service health statuses.
 *
 * @param {string[]} statuses
 * @returns {string} OPERATIONAL | DEGRADED | MAJOR_OUTAGE
 */
export function calculateOverallHealth(statuses = []) {
    if (statuses.includes(HEALTH_STATUS.MAJOR_OUTAGE)) {
        return HEALTH_STATUS.MAJOR_OUTAGE;
    }

    if (statuses.includes(HEALTH_STATUS.DEGRADED)) {
        return HEALTH_STATUS.DEGRADED;
    }

    return HEALTH_STATUS.OPERATIONAL;
}


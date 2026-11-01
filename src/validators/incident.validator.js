import { z } from "zod";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const createIncidentSchema = z.object({
    title: z
        .string({ required_error: "Title is required" })
        .trim()
        .min(3, "Title must be at least 3 characters")
        .max(200, "Title cannot exceed 200 characters"),
    description: z
        .string({ required_error: "Description is required" })
        .trim()
        .min(5, "Description must be at least 5 characters"),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"], {
        errorMap: () => ({ message: "Severity must be LOW, MEDIUM, HIGH, or CRITICAL" })
    }),
    assignedToId: z
        .string()
        .regex(UUID_REGEX, "assignedToId must be a valid UUID")
        .nullable()
        .optional(),
    serviceIds: z
        .array(z.string().regex(UUID_REGEX, "Each service ID must be a valid UUID"))
        .optional()
        .default([])
});

export const updateIncidentSchema = z.object({
    title: z
        .string()
        .trim()
        .min(3, "Title must be at least 3 characters")
        .max(200, "Title cannot exceed 200 characters")
        .optional(),
    description: z
        .string()
        .trim()
        .min(5, "Description must be at least 5 characters")
        .optional(),
    severity: z
        .enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
        .optional(),
    assignedToId: z
        .string()
        .regex(UUID_REGEX, "assignedToId must be a valid UUID")
        .nullable()
        .optional(),
    serviceIds: z
        .array(z.string().regex(UUID_REGEX, "Each service ID must be a valid UUID"))
        .optional()
});

export const transitionStatusSchema = z.object({
    status: z.enum(["TRIGGERED", "ACKNOWLEDGED", "RESOLVED", "CLOSED"], {
        errorMap: () => ({ message: "Status must be TRIGGERED, ACKNOWLEDGED, RESOLVED, or CLOSED" })
    })
});

export const listIncidentsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(["TRIGGERED", "ACKNOWLEDGED", "RESOLVED", "CLOSED"]).optional(),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
    serviceId: z.string().regex(UUID_REGEX).optional(),
    assignedToId: z.string().regex(UUID_REGEX).optional()
});

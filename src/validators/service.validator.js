import { z } from "zod";

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createServiceSchema = z.object({
    name: z
        .string({ required_error: "Service name is required" })
        .trim()
        .min(2, "Service name must be at least 2 characters")
        .max(100, "Service name cannot exceed 100 characters"),
    slug: z
        .string()
        .trim()
        .toLowerCase()
        .regex(SLUG_REGEX, "Slug must contain only lowercase alphanumeric characters and single hyphens")
        .min(2, "Slug must be at least 2 characters")
        .max(60, "Slug cannot exceed 60 characters")
        .optional()
});

export const updateServiceSchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, "Service name must be at least 2 characters")
        .max(100, "Service name cannot exceed 100 characters")
        .optional(),
    slug: z
        .string()
        .trim()
        .toLowerCase()
        .regex(SLUG_REGEX, "Slug must contain only lowercase alphanumeric characters and single hyphens")
        .min(2, "Slug must be at least 2 characters")
        .max(60, "Slug cannot exceed 60 characters")
        .optional(),
    isArchived: z.boolean().optional()
});


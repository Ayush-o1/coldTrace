import { z } from "zod";

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createOrgSchema = z.object({
    name: z
        .string({ required_error: "Organization name is required" })
        .trim()
        .min(2, "Name must be at least 2 characters")
        .max(100, "Name cannot exceed 100 characters"),
    slug: z
        .string()
        .trim()
        .toLowerCase()
        .regex(SLUG_REGEX, "Slug must contain only lowercase alphanumeric characters and single hyphens")
        .min(2, "Slug must be at least 2 characters")
        .max(60, "Slug cannot exceed 60 characters")
        .optional()
});

export const addMemberSchema = z.object({
    email: z
        .string({ required_error: "User email is required" })
        .trim()
        .toLowerCase()
        .email("Must be a valid email address"),
    role: z
        .enum(["ADMIN", "MEMBER", "VIEWER"], {
            errorMap: () => ({ message: "Role must be one of: ADMIN, MEMBER, VIEWER" })
        })
        .default("MEMBER")
});

export const updateMemberRoleSchema = z.object({
    role: z.enum(["ADMIN", "MEMBER", "VIEWER"], {
        errorMap: () => ({ message: "Role must be one of: ADMIN, MEMBER, VIEWER" })
    })
});


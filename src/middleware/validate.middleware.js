import { AppError } from "../utils/app-error.js";

/**
 * Middleware factory for validating request data against a Zod schema.
 *
 * @param {import("zod").ZodSchema} schema - The Zod schema to validate against
 * @param {"body" | "query" | "params"} [source="body"] - Request property to validate
 */
export function validate(schema, source = "body") {
    return (req, res, next) => {
        const target = req[source] ?? {};
        const result = schema.safeParse(target);

        if (!result.success) {
            const formattedErrors = result.error.issues.map((issue) => ({
                field: issue.path.join("."),
                message: issue.message
            }));

            return next(new AppError("Validation failed", 400, formattedErrors));
        }

        // Replace request property with parsed and sanitized data (e.g. trimmed, transformed)
        req[source] = result.data;
        next();
    };
}

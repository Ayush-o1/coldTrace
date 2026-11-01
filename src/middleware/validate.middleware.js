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

        // Expose validated and sanitized data on req.validated and req[source]
        if (!req.validated) {
            req.validated = {};
        }
        req.validated[source] = result.data;

        if (source === "body") {
            req.body = result.data;
        }
        next();
    };
}

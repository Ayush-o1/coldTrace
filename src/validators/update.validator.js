import { z } from "zod";

export const createUpdateSchema = z.object({
    message: z
        .string({ required_error: "Update message is required" })
        .trim()
        .min(1, "Message cannot be empty")
        .max(5000, "Message cannot exceed 5000 characters"),
    visibility: z
        .enum(["INTERNAL", "PUBLIC"], {
            errorMap: () => ({ message: "Visibility must be INTERNAL or PUBLIC" })
        })
        .default("INTERNAL")
});


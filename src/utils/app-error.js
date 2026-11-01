/**
 * Custom application error for operational errors with an HTTP status code.
 */
export class AppError extends Error {
    constructor(message, statusCode = 500, errors = null) {
        super(message);
        this.statusCode = statusCode;
        if (errors) {
            this.errors = errors;
        }
    }
}


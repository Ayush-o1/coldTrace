
export function notFound(req, res, next) {
    const notFoundError = new Error(
        `Route not found: ${req.method} ${req.originalUrl}`
    );

    notFoundError.status = 404;

    // Pass the error to centralized error handling.
    next(notFoundError);
}

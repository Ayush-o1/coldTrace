export function errorHandler(err, req, res, next) {
    const requestedStatus = err.statusCode ?? err.status;

    const statusCode =
        Number.isInteger(requestedStatus) &&
        requestedStatus >= 400 &&
        requestedStatus <= 599
            ? requestedStatus
            : 500;

    // Never expose internal server errors to API consumers.
    if (statusCode >= 500) {
        console.error(err);
    }

    res.status(statusCode).json({
        status: "error",
        message:
            statusCode >= 500
                ? "Internal server error"
                : err.message
    });
}
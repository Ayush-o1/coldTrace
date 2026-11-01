import * as authService from "../services/auth.service.js";

const REFRESH_COOKIE_NAME = "coldtrace_refresh";
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

function getCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: REFRESH_COOKIE_MAX_AGE
    };
}

export async function register(req, res, next) {
    try {
        const user = await authService.register(req.body);

        res.status(201).json({
            status: "success",
            data: { user }
        });
    } catch (error) {
        next(error);
    }
}

export async function login(req, res, next) {
    try {
        const result = await authService.login(req.body);

        res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getCookieOptions());

        res.status(200).json({
            status: "success",
            data: {
                user: result.user,
                accessToken: result.accessToken,
                refreshToken: result.refreshToken
            }
        });
    } catch (error) {
        next(error);
    }
}

export async function refresh(req, res, next) {
    try {
        const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

        const result = await authService.refreshSession({ refreshToken });

        res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getCookieOptions());

        res.status(200).json({
            status: "success",
            data: {
                user: result.user,
                accessToken: result.accessToken,
                refreshToken: result.refreshToken
            }
        });
    } catch (error) {
        next(error);
    }
}

export async function logout(req, res, next) {
    try {
        const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

        await authService.logout({ refreshToken });

        res.clearCookie(REFRESH_COOKIE_NAME, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/"
        });

        res.status(200).json({
            status: "success",
            message: "Logged out successfully"
        });
    } catch (error) {
        next(error);
    }
}

export async function getMe(req, res, next) {
    try {
        const user = await authService.getUserProfile(req.user.id);

        res.status(200).json({
            status: "success",
            data: { user }
        });
    } catch (error) {
        next(error);
    }
}

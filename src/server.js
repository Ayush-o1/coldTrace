/**
 * coldTrace HTTP Server Entry Point
 *
 * Responsibilities:
 * - Reads PORT from environment variables (defaults to 3000).
 * - Binds the Express application to the network interface.
 * - Kept strictly separate from app.js so integration tests can import app without starting a listener.
 */
import app from "./app.js";
import "dotenv/config";

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
    console.log(`coldTrace API is running at port ${PORT} 🎉 🥳 🎊`);
});

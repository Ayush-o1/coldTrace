import app from "./app.js";
import "dotenv/config";

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT,() => {
    console.log(`coldTrace API is running at port ${PORT} 🎉 🥳 🎊`);
});
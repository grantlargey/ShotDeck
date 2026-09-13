import express from "express";
import cors from "cors";
import { createCorsOptions } from "./config/cors.js";
import { errorHandler } from "./middleware/error-handler.js";
import healthRoutes from "./routes/health.routes.js";
import moviesRoutes from "./routes/movies.routes.js";
import annotationsRoutes from "./routes/annotations.routes.js";
import scriptsRoutes from "./routes/scripts.routes.js";
import scriptScenesRoutes from "./routes/script-scenes.routes.js";
import screenplayFormatRoutes from "./routes/screenplay-format.routes.js";
import uploadsRoutes from "./routes/uploads.routes.js";

/**
 * Express composition root.
 *
 * App-level middleware and route modules are wired here. Feature behavior lives
 * behind controllers/services/repositories so this file remains a readable map
 * of the backend rather than a container for implementation details.
 */
export const app = express();

app.use(cors(createCorsOptions()));
app.use(screenplayFormatRoutes); // parses its own larger body (page images)
app.use(express.json({ limit: "2mb" })); // metadata only; no big file uploads

app.use(healthRoutes);
app.use(annotationsRoutes);
app.use(moviesRoutes);
app.use(scriptsRoutes);
app.use(scriptScenesRoutes);
app.use(uploadsRoutes);

app.use(errorHandler);

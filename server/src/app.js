import express from "express";
import compression from "compression";
import cors from "cors";
import { createCorsOptions, getAllowedOrigins } from "./config/cors.js";
import { createOriginCheck } from "./middleware/check-origin.js";
import { errorHandler } from "./middleware/error-handler.js";
import authRoutes from "./routes/auth.routes.js";
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
 *
 * Reads are public. Every route that changes data carries `requireAdmin`, so
 * only a signed-in admin (see routes/auth.routes.js) can write.
 */
export const app = express();

// The load balancer terminates TLS; this lets the API see the real client
// address for login rate limiting and mark the session cookie Secure.
app.set("trust proxy", 1);

app.use(compression()); // a project's stills list is mostly signed URLs and gzips ~7x smaller
app.use(cors(createCorsOptions()));
app.use(createOriginCheck(getAllowedOrigins()));
app.use(screenplayFormatRoutes); // parses its own larger body (page images)
app.use(express.json({ limit: "2mb" })); // metadata only; no big file uploads

app.use(healthRoutes);
app.use(authRoutes);
app.use(annotationsRoutes);
app.use(moviesRoutes);
app.use(scriptsRoutes);
app.use(scriptScenesRoutes);
app.use(uploadsRoutes);

app.use(errorHandler);

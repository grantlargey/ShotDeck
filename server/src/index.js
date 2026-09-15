import "./env.js";
import { app } from "./app.js";
import { pool } from "./db.js";
import { queueMissingThumbnails } from "./services/thumbnails.service.js";

const port = process.env.PORT || 4000;

app.listen(port, () => {
    console.log("ShotDeck API running on port", port);
    // Stills saved before thumbnails existed, or by the direct-database importer, get theirs in the background.
    queueMissingThumbnails(pool).catch((err) => {
        console.error("Failed to queue missing still thumbnails:", err.message);
    });
});

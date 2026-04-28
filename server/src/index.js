import "./env.js";
import { app } from "./app.js";

const port = process.env.PORT || 4000;

const server = app.listen(port, () => {
    console.log("ShotDeck API running on port", port);
});

export { server };

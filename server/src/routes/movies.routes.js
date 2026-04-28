import { Router } from "express";
import * as moviesController from "../controllers/movies.controller.js";

/**
 * Movie catalog routes.
 *
 * This file intentionally contains no SQL or validation details; it is the
 * backend's public menu for movie resources.
 */
const router = Router();

router.post("/movies", moviesController.createMovie);
router.get("/movies", moviesController.listMovies);
router.get("/movies/:id", moviesController.getMovie);
router.put("/movies/:id", moviesController.updateMovie);
router.delete("/movies/:id", moviesController.deleteMovie);

export default router;

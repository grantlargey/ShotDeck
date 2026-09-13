import * as uploadsService from "../services/uploads.service.js";

export async function presignUpload(req, res) {
    return res.json(await uploadsService.createUploadPresign(req.body));
}

export async function getViewUrl(req, res) {
    return res.json(await uploadsService.createViewUrl(req.query.key));
}

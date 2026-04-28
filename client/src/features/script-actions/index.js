import { api, assertPdfFile, uploadMediaFile } from "@/shared/api";

export async function saveScriptPdf({ movieId, file }) {
  assertPdfFile(file);
  const key = await uploadMediaFile({ movieId, type: "script", file });
  return api.saveScript(movieId, { s3_key: key });
}

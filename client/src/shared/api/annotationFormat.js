import { req } from "./request.js";

export const annotationFormatApi = {
  formatAnnotationText: (rawText) =>
    req("/api/annotations/format", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText }),
    }),
};

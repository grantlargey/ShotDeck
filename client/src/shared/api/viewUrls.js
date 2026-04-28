import { req } from "./request.js";

export const viewUrlsApi = {
  getViewUrlForKey: (key) => req(`/uploads/view-url?key=${encodeURIComponent(key)}`),
};

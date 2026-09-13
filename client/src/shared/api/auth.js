import { req } from "./request.js";

function jsonRequest(method, body) {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/**
 * Admin sign-in and account management. Passwords left undefined in
 * createAdmin / resetAdminPassword ask the API to generate a temporary one.
 */
export const authApi = {
  login: (email, password) => req("/auth/login", jsonRequest("POST", { email, password })),

  logout: () => req("/auth/logout", { method: "POST" }),

  getSession: () => req("/auth/me"),

  changePassword: ({ currentPassword, newPassword }) =>
    req("/auth/password", jsonRequest("POST", { current_password: currentPassword, new_password: newPassword })),

  listAdmins: () => req("/auth/admins"),

  createAdmin: ({ email, password }) =>
    req("/auth/admins", jsonRequest("POST", { email, password: password || undefined })),

  resetAdminPassword: (id, { password } = {}) =>
    req(`/auth/admins/${encodeURIComponent(id)}/reset-password`, jsonRequest("POST", { password: password || undefined })),

  disableAdmin: (id) => req(`/auth/admins/${encodeURIComponent(id)}/disable`, { method: "POST" }),

  enableAdmin: (id) => req(`/auth/admins/${encodeURIComponent(id)}/enable`, { method: "POST" }),
};

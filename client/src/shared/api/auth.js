import { req } from "./request.js";

/*
 * Admin sign-in and account management. Passwords left undefined in
 * createAdmin / resetAdminPassword ask the API to generate a temporary one.
 */

function jsonRequest(method, body) {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function login(email, password) {
  return req("/auth/login", jsonRequest("POST", { email, password }));
}

export function logout() {
  return req("/auth/logout", { method: "POST" });
}

export function getSession() {
  return req("/auth/me");
}

export function changePassword({ currentPassword, newPassword }) {
  return req("/auth/password", jsonRequest("POST", { current_password: currentPassword, new_password: newPassword }));
}

export function listAdmins() {
  return req("/auth/admins");
}

export function createAdmin({ email, password }) {
  return req("/auth/admins", jsonRequest("POST", { email, password: password || undefined }));
}

export function resetAdminPassword(id, { password } = {}) {
  return req(`/auth/admins/${encodeURIComponent(id)}/reset-password`, jsonRequest("POST", { password: password || undefined }));
}

export function disableAdmin(id) {
  return req(`/auth/admins/${encodeURIComponent(id)}/disable`, { method: "POST" });
}

export function enableAdmin(id) {
  return req(`/auth/admins/${encodeURIComponent(id)}/enable`, { method: "POST" });
}

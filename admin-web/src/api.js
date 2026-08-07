const API_BASE = "/v1/api";
const TOKEN_KEY = "phlebo_admin_token";
const USER_KEY = "phlebo_admin_user";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setSession(token, userdata) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(userdata || {}));
}
export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Append admin JWT for /uploads images (<img> cannot send Authorization). */
export function mediaUrl(url) {
  if (!url) return "";
  if (/^(data:)/i.test(url)) return url;
  const token = getToken();
  if (!token || !/\/uploads\//i.test(url) || /[?&]token=/.test(url)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (res.status === 401) {
    const wasSuperadmin = getUser()?.role === "superadmin";
    clearSession();
    if (!location.pathname.endsWith("/login")) {
      location.href = wasSuperadmin ? "/admin/super-login" : "/admin/login";
    }
  }

  if (!res.ok) {
    const err = new Error(data?.message || data?.msg || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function qs(params = {}) {
  return new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ""))
  ).toString();
}

export const authApi = {
  login: (email, password, keepLoggedIn = true) =>
    request("/login", { method: "POST", body: { email, password, keepLoggedIn } }),
  // Superadmin only — creates a new city Admin.
  registerAdmin: (payload) => request("/register-admin", { method: "POST", body: payload }),
  // City Admin only — creates a new Lab in their own city.
  registerLab: (payload) => request("/register-lab", { method: "POST", body: payload }),
  admins: () => request("/admins"),
  labs: (city) => request(`/labs${city ? `?city=${encodeURIComponent(city)}` : ""}`),
  setAdminStatus: (id, isActive) =>
    request(`/admins/${id}/status`, { method: "PUT", body: { isActive } }),
  resetAdminPassword: (id, password) =>
    request(`/admins/${id}/reset-password`, { method: "PUT", body: { password } }),
  setLabStatus: (id, isActive) =>
    request(`/labs/${id}/status`, { method: "PUT", body: { isActive } }),
  resetLabPassword: (id, password) =>
    request(`/labs/${id}/reset-password`, { method: "PUT", body: { password } }),
};

export const adminApi = {
  orders: (params = {}) => {
    const q = qs(params);
    return request(`/admin/orders${q ? `?${q}` : ""}`);
  },
  createOrder: (payload) => request("/admin/orders", { method: "POST", body: payload }),
  catalog: (params = {}) => {
    const q = qs(params);
    return request(`/admin/catalog${q ? `?${q}` : ""}`);
  },
  addTestToOrder: (orderId, payload) =>
    request(`/admin/orders/${orderId}/tests`, { method: "POST", body: payload }),
  removeTestFromOrder: (orderId, productId) =>
    request(`/admin/orders/${orderId}/tests/${encodeURIComponent(productId)}`, {
      method: "DELETE",
    }),
  rescheduleOrder: (orderId, payload) =>
    request(`/admin/orders/${orderId}/reschedule`, { method: "PUT", body: payload }),
  cancelOrder: (orderId, reason) =>
    request(`/admin/orders/${orderId}/cancel`, {
      method: "PUT",
      body: { reason },
    }),
  clients: () => request("/admin/clients"),
  phlebos: () => request("/admin/phlebos"),
  phlebo: (id) => request(`/admin/phlebos/${id}`),
  createPhlebo: (payload) => request("/admin/phlebos", { method: "POST", body: payload }),
  updatePhlebo: (id, payload) => request(`/admin/phlebos/${id}`, { method: "PUT", body: payload }),
  deletePhlebo: (id) => request(`/admin/phlebos/${id}`, { method: "DELETE" }),
  phleboRoutePlan: (id, date) =>
    request(`/admin/phlebos/${id}/route-plan${date ? `?date=${date}` : ""}`),
  assignPhlebo: (orderId, phleboId) =>
    request(`/admin/orders/${orderId}/assign-phlebo`, {
      method: "PUT",
      body: { phleboId },
    }),
  assignLab: (orderId, labId) =>
    request(`/admin/orders/${orderId}/assign-lab`, {
      method: "PUT",
      body: { labId },
    }),
  analytics: (params = {}) => {
    const q = qs(params);
    return request(`/admin/analytics${q ? `?${q}` : ""}`);
  },
  analyticsByCity: () => request("/admin/analytics/by-city"),
  labTat: () => request("/admin/analytics/lab-tat"),
  markReportReady: (orderId) =>
    request(`/admin/orders/${orderId}/report-ready`, { method: "PUT" }),
  settleCash: (phleboId, jobIds) =>
    request(`/admin/phlebos/${phleboId}/cash/settle`, {
      method: "POST",
      body: jobIds ? { jobIds } : {},
    }),
  inventory: () => request("/admin/inventory"),
  createInventoryItem: (payload) => request("/admin/inventory", { method: "POST", body: payload }),
  updateInventoryItem: (id, payload) =>
    request(`/admin/inventory/${id}`, { method: "PUT", body: payload }),
  kitAssignments: (phleboId) =>
    request(`/admin/kits${phleboId ? `?phleboId=${phleboId}` : ""}`),
  assignKit: (payload) => request("/admin/kits/assign", { method: "POST", body: payload }),
  addedTests: (params = {}) => {
    const q = qs(params);
    return request(`/admin/added-tests${q ? `?${q}` : ""}`);
  },
  rejectSample: (orderId, barcode, payload) =>
    request(`/admin/orders/${orderId}/samples/${encodeURIComponent(barcode)}/reject`, {
      method: "PUT",
      body: payload,
    }),
  phleboIncentive: (phleboId, date) =>
    request(`/admin/phlebos/${phleboId}/incentive${date ? `?date=${date}` : ""}`),
  attendance: (params = {}) => {
    const q = qs(params);
    return request(`/admin/attendance${q ? `?${q}` : ""}`);
  },
  collections: (date) => request(`/admin/collections${date ? `?date=${date}` : ""}`),
  markLeave: (phleboId, payload) =>
    request(`/admin/phlebos/${phleboId}/leave`, { method: "POST", body: payload }),
  phleboLeaves: (phleboId) => request(`/admin/phlebos/${phleboId}/leave`),
  cancelLeave: (leaveId) => request(`/admin/leave/${leaveId}`, { method: "DELETE" }),
  tickets: (params = {}) => {
    const q = qs(params);
    return request(`/admin/tickets${q ? `?${q}` : ""}`);
  },
  ticket: (id) => request(`/admin/tickets/${id}`),
  createTicket: (payload) => request("/admin/tickets", { method: "POST", body: payload }),
  replyTicket: (id, text) =>
    request(`/admin/tickets/${id}/messages`, { method: "POST", body: { text } }),
  setTicketStatus: (id, status) =>
    request(`/admin/tickets/${id}/status`, { method: "PATCH", body: { status } }),
};

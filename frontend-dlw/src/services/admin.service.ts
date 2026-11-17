import { API_URL } from "./downloader.service";

export interface AdminUserRow {
  id: string;
  email: string;
  provider: string;
  role: "admin" | "user";
  createdAt: string;
  lastSignInAt: string | null;
  lastActiveAt: string;
  requestsCount: number;
  downloadsCount: number;
  bytesTransferred: number;
  customBandwidthLimitBytes: number | null;
  effectiveBandwidthLimitBytes: number;
}

export interface AdminUsersResponse {
  defaultBandwidthLimitBytes: number;
  summary: {
    totalUsers: number;
    totalRequests: number;
    totalDownloads: number;
    totalBytesTransferred: number;
  };
  users: AdminUserRow[];
}

export class AdminService {
  static async getUsers(token: string): Promise<AdminUsersResponse> {
    const res = await fetch(`${API_URL}/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Error al obtener usuarios");
    }
    return res.json();
  }

  static async updateDefaultBandwidth(
    token: string,
    limitBytes: number
  ): Promise<{ defaultBandwidthLimitBytes: number }> {
    const res = await fetch(`${API_URL}/admin/settings/bandwidth`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ limitBytes }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Error al actualizar límite global");
    }
    return res.json();
  }

  static async updateUserBandwidth(
    token: string,
    userId: string,
    limitBytes: number | null
  ): Promise<void> {
    const res = await fetch(`${API_URL}/admin/users/${userId}/bandwidth`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ limitBytes }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Error al actualizar límite del usuario");
    }
  }

  static async updateUserRole(
    token: string,
    userId: string,
    role: "admin" | "user"
  ): Promise<void> {
    const res = await fetch(`${API_URL}/admin/users/${userId}/role`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Error al actualizar rol");
    }
  }
}

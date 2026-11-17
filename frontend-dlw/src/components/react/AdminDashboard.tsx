import React, { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  formatBytes,
  getAccessToken,
  signInWithEmail,
  signOut,
  supabase,
} from "../../lib/supabase";
import {
  AdminService,
  type AdminUserRow,
  type AdminUsersResponse,
} from "../../services/admin.service";

const GB_BYTES = 1024 ** 3;

export function AdminDashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<AdminUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Login form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Bandwidth settings
  const [defaultLimitGb, setDefaultLimitGb] = useState("10");
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingUserGb, setEditingUserGb] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setData(null);
        setLoading(false);
        return;
      }
      const res = await AdminService.getUsers(token);
      setData(res);
      setDefaultLimitGb((res.defaultBandwidthLimitBytes / GB_BYTES).toFixed(2).replace(/\.00$/, ""));
    } catch (err: any) {
      setError(err?.message || "No tienes permisos de administrador");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!supabase) {
      setError("Supabase no está configurado en el frontend.");
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: sessionData }) => {
      setUser(sessionData.session?.user ?? null);
      void loadDashboard();
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      void loadDashboard();
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoginLoading(true);
    try {
      await signInWithEmail(email.trim(), password);
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message || "Credenciales inválidas");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSaveGlobalBandwidth = async (e: React.FormEvent) => {
    e.preventDefault();
    const gb = parseFloat(defaultLimitGb);
    if (!Number.isFinite(gb) || gb <= 0) {
      setError("Ingresa un límite global válido en GB mayor a 0");
      return;
    }

    setSavingGlobal(true);
    setError(null);
    setFeedback(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sesión expirada");
      await AdminService.updateDefaultBandwidth(token, Math.round(gb * GB_BYTES));
      setFeedback(`Límite global actualizado a ${gb} GB.`);
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message || "Error al guardar límite global");
    } finally {
      setSavingGlobal(false);
    }
  };

  const handleSaveUserBandwidth = async (userId: string, useDefault: boolean) => {
    setError(null);
    setFeedback(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sesión expirada");

      let limitBytes: number | null = null;
      if (!useDefault) {
        const gb = parseFloat(editingUserGb);
        if (!Number.isFinite(gb) || gb <= 0) {
          setError("Ingresa un límite válido en GB mayor a 0");
          return;
        }
        limitBytes = Math.round(gb * GB_BYTES);
      }

      await AdminService.updateUserBandwidth(token, userId, limitBytes);
      setEditingUserId(null);
      setFeedback("Límite de usuario actualizado.");
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message || "Error al actualizar límite del usuario");
    }
  };

  const handleToggleRole = async (row: AdminUserRow) => {
    setError(null);
    setFeedback(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sesión expirada");
      const nextRole = row.role === "admin" ? "user" : "admin";
      await AdminService.updateUserRole(token, row.id, nextRole);
      setFeedback(`Rol de ${row.email} cambiado a ${nextRole}.`);
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message || "Error al cambiar rol");
    }
  };

  const filteredUsers = (data?.users || []).filter((u) =>
    u.email.toLowerCase().includes(search.trim().toLowerCase())
  );

  if (loading) {
    return (
      <div className="w-full max-w-6xl mx-auto p-6 font-mono text-primary text-center">
        Cargando panel de administración...
      </div>
    );
  }

  if (!user || !data) {
    return (
      <div className="w-full max-w-md mx-auto mt-8 p-6 rounded-2xl bg-surface border border-primary/40 shadow-[0_0_30px_rgba(89,242,13,0.15)] font-mono">
        <h1 className="text-xl font-black text-primary uppercase tracking-wider mb-2">
          Panel Administrador
        </h1>
        <p className="text-xs text-slate-400 mb-5">
          Ingresa con tu cuenta administrador (creada desde <code>ADMIN_EMAIL</code> en <code>.env</code> o promovida desde este panel).
        </p>

        {user && (
          <div className="mb-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/40 text-yellow-200 text-xs flex items-center justify-between gap-2">
            <span>Conectado como {user.email} (sin permisos admin)</span>
            <button
              type="button"
              onClick={() => signOut()}
              className="underline text-primary cursor-pointer shrink-0"
            >
              Cerrar sesión
            </button>
          </div>
        )}

        <form onSubmit={handleLogin} className="flex flex-col gap-3">
          <div>
            <label className="block text-[11px] text-slate-400 uppercase mb-1">
              Correo Admin
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@tudominio.cl"
              className="w-full h-10 px-3 rounded-lg bg-background-dark border border-border-color focus:border-primary outline-none text-sm text-slate-100"
            />
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 uppercase mb-1">
              Contraseña
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full h-10 px-3 rounded-lg bg-background-dark border border-border-color focus:border-primary outline-none text-sm text-slate-100"
            />
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/40 text-red-300 text-xs">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loginLoading}
            className="w-full h-11 mt-1 rounded-xl bg-primary text-background-dark font-black text-xs uppercase tracking-widest hover:bg-white transition-colors cursor-pointer disabled:opacity-50"
          >
            {loginLoading ? "Verificando..." : "Entrar al Panel"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 pb-12 font-mono text-slate-100 flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border-color pb-4">
        <div>
          <h1 className="text-2xl font-black text-primary uppercase tracking-wider">
            Panel de Administración
          </h1>
          <p className="text-xs text-slate-400">
            Sesión: {user.email} · Control de usuarios, solicitudes y ancho de banda
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="px-3 py-2 rounded-lg border border-border-color text-xs text-slate-300 hover:border-primary hover:text-primary transition-colors"
          >
            Volver al Descargador
          </a>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="px-3 py-2 rounded-lg bg-primary/15 border border-primary text-primary text-xs font-bold uppercase cursor-pointer hover:bg-primary hover:text-background-dark transition-colors"
          >
            Actualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 text-xs">
          {error}
        </div>
      )}
      {feedback && (
        <div className="p-3 rounded-xl bg-primary/10 border border-primary/40 text-primary text-xs">
          {feedback}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-surface border border-border-color">
          <div className="text-[11px] text-slate-400 uppercase">Usuarios</div>
          <div className="text-2xl font-black text-primary mt-1">
            {data.summary.totalUsers}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-border-color">
          <div className="text-[11px] text-slate-400 uppercase">Solicitudes Totales</div>
          <div className="text-2xl font-black text-slate-100 mt-1">
            {data.summary.totalRequests}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-border-color">
          <div className="text-[11px] text-slate-400 uppercase">Descargas Totales</div>
          <div className="text-2xl font-black text-slate-100 mt-1">
            {data.summary.totalDownloads}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-border-color">
          <div className="text-[11px] text-slate-400 uppercase">Ancho de Banda Total</div>
          <div className="text-2xl font-black text-cyan-400 mt-1">
            {formatBytes(data.summary.totalBytesTransferred)}
          </div>
        </div>
      </div>

      {/* Configuración global de ancho de banda */}
      <form
        onSubmit={handleSaveGlobalBandwidth}
        className="p-4 rounded-xl bg-surface border border-primary/30 flex flex-col sm:flex-row sm:items-end justify-between gap-4"
      >
        <div>
          <h2 className="text-sm font-bold text-primary uppercase tracking-wider">
            Límite de Ancho de Banda Global por Usuario
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Aplica a todos los usuarios que no tengan un límite personalizado (por defecto 10 GB).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.5"
            min="0.1"
            value={defaultLimitGb}
            onChange={(e) => setDefaultLimitGb(e.target.value)}
            className="w-28 h-10 px-3 rounded-lg bg-background-dark border border-border-color focus:border-primary outline-none text-sm text-slate-100"
          />
          <span className="text-xs text-slate-400 font-bold">GB</span>
          <button
            type="submit"
            disabled={savingGlobal}
            className="h-10 px-4 rounded-lg bg-primary text-background-dark font-bold text-xs uppercase tracking-wider hover:bg-white transition-colors cursor-pointer disabled:opacity-50"
          >
            {savingGlobal ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </form>

      {/* Filtro y tabla de usuarios */}
      <div className="rounded-xl bg-surface border border-border-color overflow-hidden">
        <div className="p-4 border-b border-border-color flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
            Usuarios Loggeados y Consumo
          </h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por correo..."
            className="w-full sm:w-64 h-9 px-3 rounded-lg bg-background-dark border border-border-color focus:border-primary outline-none text-xs text-slate-100"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border-color bg-background-dark/60 text-slate-400 uppercase">
                <th className="py-3 px-4">Correo</th>
                <th className="py-3 px-3">Método</th>
                <th className="py-3 px-3">Rol</th>
                <th className="py-3 px-3">Último Login</th>
                <th className="py-3 px-3 text-right">Solicitudes</th>
                <th className="py-3 px-3 text-right">Descargas</th>
                <th className="py-3 px-3 text-right">Banda Ancha</th>
                <th className="py-3 px-4 text-right">Límite / Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No se encontraron usuarios.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border-color/50 hover:bg-background-dark/40 transition-colors"
                  >
                    <td className="py-3 px-4 font-semibold text-slate-100">
                      {row.email}
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 uppercase text-[10px]">
                        {row.provider}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded uppercase text-[10px] font-bold ${
                          row.role === "admin"
                            ? "bg-primary/20 text-primary border border-primary/40"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {row.role}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-400">
                      {row.lastSignInAt
                        ? new Date(row.lastSignInAt).toLocaleString("es-CL")
                        : "Sin login"}
                    </td>
                    <td className="py-3 px-3 text-right font-bold">
                      {row.requestsCount}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {row.downloadsCount}
                    </td>
                    <td className="py-3 px-3 text-right text-cyan-300 font-bold">
                      {formatBytes(row.bytesTransferred)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {editingUserId === row.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="0.5"
                              min="0.1"
                              value={editingUserGb}
                              onChange={(e) => setEditingUserGb(e.target.value)}
                              className="w-16 h-7 px-1.5 rounded bg-background-dark border border-primary text-xs text-slate-100"
                            />
                            <button
                              type="button"
                              onClick={() => void handleSaveUserBandwidth(row.id, false)}
                              className="px-2 py-1 rounded bg-primary text-background-dark font-bold text-[10px] cursor-pointer"
                            >
                              OK
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSaveUserBandwidth(row.id, true)}
                              className="px-2 py-1 rounded border border-border-color text-slate-300 text-[10px] cursor-pointer"
                              title="Volver al límite global"
                            >
                              Default
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingUserId(null)}
                              className="px-1.5 py-1 text-slate-400 text-[10px] cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingUserId(row.id);
                              setEditingUserGb(
                                (row.effectiveBandwidthLimitBytes / GB_BYTES)
                                  .toFixed(2)
                                  .replace(/\.00$/, "")
                              );
                            }}
                            className="px-2 py-1 rounded border border-border-color hover:border-primary text-slate-300 hover:text-primary text-[10px] cursor-pointer"
                            title="Editar límite de ancho de banda"
                          >
                            {formatBytes(row.effectiveBandwidthLimitBytes)}
                            {row.customBandwidthLimitBytes ? " *" : ""}
                          </button>
                        )}

                        {row.id !== user.id && (
                          <button
                            type="button"
                            onClick={() => void handleToggleRole(row)}
                            className="px-2 py-1 rounded border border-border-color hover:border-primary text-slate-300 hover:text-primary text-[10px] cursor-pointer"
                          >
                            {row.role === "admin" ? "Quitar Admin" : "Hacer Admin"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { formatBytes, signOut, supabase } from "../../lib/supabase";
import { DownloaderService, type QuotaStatusResponse } from "../../services/downloader.service";
import { AuthModal, type AuthModalMode } from "./AuthModal";

export function AuthBar() {
  const [user, setUser] = useState<User | null>(null);
  const [quota, setQuota] = useState<QuotaStatusResponse | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<AuthModalMode>("login");

  const refreshQuota = async () => {
    try {
      const q = await DownloaderService.getQuota();
      setQuota(q);
    } catch {
      // Ignore silent quota refresh errors
    }
  };

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      void refreshQuota();
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user ?? null);
        if (event === "PASSWORD_RECOVERY") {
          setModalMode("reset_password");
          setModalOpen(true);
        }
        void refreshQuota();
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  if (!supabase) {
    return null;
  }

  const isAdmin =
    user?.app_metadata?.role === "admin" || quota?.isAdmin === true;

  return (
    <>
      <div className="flex items-center gap-2 sm:gap-3 font-mono text-[11px] sm:text-xs">
        {user ? (
          <>
            {quota?.authenticated &&
              typeof quota.bytesTransferred === "number" &&
              typeof quota.bandwidthLimitBytes === "number" && (
                <div
                  className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface border border-primary/30 text-slate-300"
                  title="Ancho de banda consumido / límite asignado"
                >
                  <span className="w-2 h-2 rounded-full bg-primary"></span>
                  <span>
                    {formatBytes(quota.bytesTransferred)} /{" "}
                    {formatBytes(quota.bandwidthLimitBytes)}
                  </span>
                </div>
              )}

            <span className="hidden md:inline text-slate-300 truncate max-w-[180px]">
              {user.email}
            </span>

            {isAdmin && (
              <a
                href="/admin"
                className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-primary/15 border border-primary text-primary font-bold uppercase tracking-wider hover:bg-primary hover:text-background-dark transition-colors"
              >
                Admin
              </a>
            )}

            <button
              type="button"
              onClick={() => signOut()}
              className="px-2.5 sm:px-3 py-1.5 rounded-lg border border-border-color text-slate-300 hover:border-red-400 hover:text-red-300 transition-colors cursor-pointer uppercase"
            >
              Salir
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-slate-400 text-[11px]">
              Anónimo: 2/día
            </span>
            <button
              type="button"
              onClick={() => {
                setModalMode("login");
                setModalOpen(true);
              }}
              className="px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg bg-primary text-background-dark font-bold uppercase tracking-wider hover:bg-white transition-colors shadow-[0_0_12px_rgba(89,242,13,0.4)] cursor-pointer"
            >
              Iniciar Sesión
            </button>
          </div>
        )}
      </div>

      <AuthModal
        isOpen={modalOpen}
        initialMode={modalMode}
        onClose={() => setModalOpen(false)}
        onSuccess={() => void refreshQuota()}
      />
    </>
  );
}

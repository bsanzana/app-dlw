import React, { useState } from "react";
import {
  resetPasswordForEmail,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  updatePassword,
} from "../../lib/supabase";

export type AuthModalMode = "login" | "register" | "forgot" | "reset_password";

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: AuthModalMode;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AuthModal({
  isOpen,
  initialMode = "login",
  onClose,
  onSuccess,
}: AuthModalProps) {
  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  React.useEffect(() => {
    setMode(initialMode);
    setError(null);
    setInfo(null);
  }, [initialMode, isOpen]);

  if (!isOpen) return null;

  const handleGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err?.message || "No se pudo iniciar con Google");
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      if (mode === "login") {
        await signInWithEmail(email.trim(), password);
        onSuccess?.();
        onClose();
      } else if (mode === "register") {
        const res = await signUpWithEmail(email.trim(), password);
        if (res.session) {
          onSuccess?.();
          onClose();
        } else {
          setInfo(
            "Cuenta creada. Revisa tu correo para confirmar tu cuenta (enviado vía Resend) antes de iniciar sesión."
          );
        }
      } else if (mode === "forgot") {
        await resetPasswordForEmail(email.trim());
        setInfo(
          "Te enviamos un enlace a tu correo para restablecer tu contraseña."
        );
      } else if (mode === "reset_password") {
        if (password.length < 6) {
          throw new Error("La contraseña debe tener al menos 6 caracteres");
        }
        if (password !== confirmPassword) {
          throw new Error("Las contraseñas no coinciden");
        }
        await updatePassword(password);
        setInfo("Contraseña actualizada correctamente.");
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 1200);
      }
    } catch (err: any) {
      setError(err?.message || "Ocurrió un error al autenticar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Autenticación"
    >
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-surface border border-primary/40 shadow-[0_0_35px_rgba(89,242,13,0.2)] p-4 sm:p-6 text-slate-100 font-mono">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-primary transition-colors cursor-pointer"
          aria-label="Cerrar"
        >
          <span className="material-symbols-outlined">close</span>
        </button>

        <h3 className="text-lg font-bold text-primary tracking-wider uppercase mb-1">
          {mode === "login" && "Iniciar Sesión"}
          {mode === "register" && "Crear Cuenta"}
          {mode === "forgot" && "Recuperar Contraseña"}
          {mode === "reset_password" && "Nueva Contraseña"}
        </h3>
        <p className="text-xs text-slate-400 mb-5">
          {mode === "reset_password"
            ? "Ingresa tu nueva contraseña para completar el restablecimiento."
            : "Inicia sesión para obtener 10 GB de ancho de banda y descargas sin límite diario."}
        </p>

        {mode !== "reset_password" && mode !== "forgot" && (
          <>
            <button
              type="button"
              onClick={handleGoogle}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2.5 h-11 rounded-xl bg-white text-slate-900 font-bold text-sm hover:bg-slate-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              Continuar con Google
            </button>

            <div className="flex items-center gap-3 my-4">
              <div className="h-px flex-1 bg-border-color"></div>
              <span className="text-[11px] text-slate-500 uppercase">o con correo</span>
              <div className="h-px flex-1 bg-border-color"></div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError(null);
                  setInfo(null);
                }}
                className={`py-2 text-xs font-bold uppercase rounded-lg border transition-colors cursor-pointer ${
                  mode === "login"
                    ? "bg-primary/15 border-primary text-primary"
                    : "border-border-color text-slate-400 hover:text-slate-200"
                }`}
              >
                Iniciar Sesión
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("register");
                  setError(null);
                  setInfo(null);
                }}
                className={`py-2 text-xs font-bold uppercase rounded-lg border transition-colors cursor-pointer ${
                  mode === "register"
                    ? "bg-primary/15 border-primary text-primary"
                    : "border-border-color text-slate-400 hover:text-slate-200"
                }`}
              >
                Crear Cuenta
              </button>
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {mode !== "reset_password" && (
            <div>
              <label className="block text-[11px] text-slate-400 uppercase mb-1">
                Correo electrónico
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.cl"
                className="w-full h-10 px-3 rounded-lg bg-background-dark border border-border-color focus:border-primary outline-none text-sm text-slate-100"
              />
            </div>
          )}

          {mode !== "forgot" && (
            <div>
              <label className="block text-[11px] text-slate-400 uppercase mb-1">
                {mode === "reset_password" ? "Nueva contraseña" : "Contraseña"}
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-10 px-3 rounded-lg bg-background-dark border border-border-color focus:border-primary outline-none text-sm text-slate-100"
              />
            </div>
          )}

          {mode === "reset_password" && (
            <div>
              <label className="block text-[11px] text-slate-400 uppercase mb-1">
                Confirmar contraseña
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-10 px-3 rounded-lg bg-background-dark border border-border-color focus:border-primary outline-none text-sm text-slate-100"
              />
            </div>
          )}

          {error && (
            <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/40 text-red-300 text-xs">
              {error}
            </div>
          )}

          {info && (
            <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/40 text-primary text-xs">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 mt-1 rounded-xl bg-primary text-background-dark font-black text-xs uppercase tracking-widest hover:bg-white transition-colors cursor-pointer disabled:opacity-50"
          >
            {loading
              ? "Procesando..."
              : mode === "login"
              ? "Entrar"
              : mode === "register"
              ? "Crear Cuenta"
              : mode === "forgot"
              ? "Enviar enlace de recuperación"
              : "Guardar nueva contraseña"}
          </button>

          {mode === "login" && (
            <button
              type="button"
              onClick={() => {
                setMode("forgot");
                setError(null);
                setInfo(null);
              }}
              className="text-xs text-slate-400 hover:text-primary text-center mt-1 cursor-pointer"
            >
              ¿Olvidaste tu contraseña?
            </button>
          )}

          {mode === "forgot" && (
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
                setInfo(null);
              }}
              className="text-xs text-slate-400 hover:text-primary text-center mt-1 cursor-pointer"
            >
              Volver a Iniciar Sesión
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

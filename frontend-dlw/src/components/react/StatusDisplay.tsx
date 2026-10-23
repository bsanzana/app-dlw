import React from "react";

interface StatusDisplayProps {
  message: string;
  active?: boolean;
  showLoader?: boolean;
  progressPercent?: number | null;
  downloadSpeed?: string | null;
  eta?: string | null;
}

export function StatusDisplay({
  message,
  active = false,
  showLoader = false,
  progressPercent = null,
  downloadSpeed = null,
  eta = null,
}: StatusDisplayProps) {
  if (!message) return null;

  return (
    <div className="w-full max-w-[850px] mb-2 flex flex-col gap-2.5 transition-all duration-300">
      <div className={`status-bar ${active ? "active" : ""} w-full flex items-center justify-between p-4 rounded-xl bg-surface border border-border-color shadow-lg`}>
        <div className="flex items-center gap-3.5">
          {showLoader ? (
            <div className="loader w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <span className="w-3 h-3 rounded-full bg-primary animate-pulse shadow-[0_0_10px_rgba(89,242,13,0.8)]"></span>
          )}
          <span className="font-mono text-sm font-semibold tracking-wide text-slate-100">
            {message}
          </span>
        </div>

        {(downloadSpeed || eta) && (
          <div className="flex items-center gap-3 font-mono text-xs text-primary font-bold">
            {downloadSpeed && <span>⚡ {downloadSpeed}</span>}
            {eta && <span>⏱️ ETA: {eta}</span>}
          </div>
        )}
      </div>

      {typeof progressPercent === "number" && progressPercent > 0 && progressPercent <= 100 && (
        <div className="w-full bg-surface border border-border-color rounded-full h-2.5 overflow-hidden p-0.5">
          <div
            className="bg-gradient-to-r from-primary to-cyan-400 h-full rounded-full transition-all duration-300 shadow-[0_0_12px_rgba(89,242,13,0.7)]"
            style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
          ></div>
        </div>
      )}
    </div>
  );
}

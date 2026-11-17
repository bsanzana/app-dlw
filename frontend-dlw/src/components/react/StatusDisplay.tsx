import React from "react";

export type DownloadPhase = "downloading" | "processing" | "completed" | "failed";

interface StatusDisplayProps {
  message: string;
  active?: boolean;
  showLoader?: boolean;
  progressPercent?: number | null;
  downloadSpeed?: string | null;
  eta?: string | null;
  phase?: DownloadPhase | null;
  processingSeconds?: number;
}

export function StatusDisplay({
  message,
  active = false,
  showLoader = false,
  progressPercent = null,
  downloadSpeed = null,
  eta = null,
  phase = null,
  processingSeconds = 0,
}: StatusDisplayProps) {
  if (!message) return null;

  const steps: { key: DownloadPhase; label: string }[] = [
    { key: "downloading", label: "1. Descargando" },
    { key: "processing", label: "2. Procesando" },
    { key: "completed", label: "3. Listo" },
  ];

  const stepIndex =
    phase === "downloading" ? 0 : phase === "processing" ? 1 : phase === "completed" ? 2 : -1;

  return (
    <div className="w-full max-w-[850px] mb-2 flex flex-col gap-2.5 transition-all duration-300">
      {stepIndex >= 0 && (
        <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
          {steps.map((step, idx) => {
            const isDone = idx < stepIndex || phase === "completed";
            const isCurrent = idx === stepIndex && phase !== "completed";
            return (
              <div
                key={step.key}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg border transition-all ${
                  isDone
                    ? "bg-primary/15 border-primary/50 text-primary font-bold"
                    : isCurrent
                    ? "bg-surface border-primary text-slate-100 font-bold shadow-[0_0_10px_rgba(89,242,13,0.25)]"
                    : "bg-surface/50 border-border-color/60 text-slate-500"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isDone
                      ? "bg-primary"
                      : isCurrent
                      ? "bg-primary animate-ping"
                      : "bg-slate-600"
                  }`}
                ></span>
                <span>{step.label}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className={`status-bar ${active ? "active" : ""} w-full flex items-center justify-between gap-3 p-4 rounded-xl bg-surface border border-border-color shadow-lg`}>
        <div className="flex items-center gap-3.5 min-w-0">
          {showLoader ? (
            <div className="loader w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0"></div>
          ) : (
            <span className="w-3 h-3 rounded-full bg-primary animate-pulse shadow-[0_0_10px_rgba(89,242,13,0.8)] shrink-0"></span>
          )}
          <span className="font-mono text-sm font-semibold tracking-wide text-slate-100 truncate">
            {message}
          </span>
        </div>

        {(downloadSpeed || eta || phase === "processing") && (
          <div className="flex items-center gap-3 font-mono text-xs text-primary font-bold shrink-0">
            {downloadSpeed && <span>⚡ {downloadSpeed}</span>}
            {eta && <span>⏱️ ETA: {eta}</span>}
            {phase === "processing" && !eta && (
              <span>⏱️ {processingSeconds}s</span>
            )}
          </div>
        )}
      </div>

      {typeof progressPercent === "number" && progressPercent > 0 && progressPercent <= 100 && (
        <div className="w-full bg-surface border border-border-color rounded-full h-2.5 overflow-hidden p-0.5">
          <div
            className={`bg-gradient-to-r from-primary to-cyan-400 h-full rounded-full transition-all duration-300 shadow-[0_0_12px_rgba(89,242,13,0.7)] ${
              phase === "processing" ? "animate-pulse" : ""
            }`}
            style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
          ></div>
        </div>
      )}
    </div>
  );
}

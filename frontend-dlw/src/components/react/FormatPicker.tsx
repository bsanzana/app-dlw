import React, { useState } from "react";
import type { VideoMetadata, VideoFormatOption, FormatType } from "../../services/downloader.service";

interface FormatPickerProps {
  metadata: VideoMetadata;
  onDownload: (format: VideoFormatOption) => void;
  disabled?: boolean;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return `~${mb.toFixed(1)} MB`;
}

export function FormatPicker({ metadata, onDownload, disabled = false }: FormatPickerProps) {
  const [filter, setFilter] = useState<"all" | FormatType>("all");
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);

  const formats = metadata.formats || [];

  const filteredFormats = formats.filter((f) => {
    if (filter === "all") return true;
    return f.type === filter;
  });

  const selectedFormat = formats.find((f) => f.id === selectedFormatId) || null;

  const handleDownloadClick = () => {
    if (selectedFormat && !disabled) {
      onDownload(selectedFormat);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 rounded-xl border border-border-color bg-surface shadow-md">
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex flex-col items-center gap-3 shrink-0">
          <img
            src={metadata.thumbnail}
            alt={metadata.title}
            className="w-[180px] md:w-[220px] aspect-video object-cover rounded shadow border border-border-color/50"
          />
          <span className="text-xs text-slate-400 font-mono bg-background-dark px-2.5 py-1 rounded border border-border-color/40">
            {formatDuration(metadata.duration)}
          </span>
        </div>

        <div className="flex flex-col gap-3 flex-1 min-w-0">
          <div>
            <h3 className="text-slate-100 font-bold text-lg leading-snug">
              {metadata.title}
            </h3>
            <p className="text-primary text-xs font-mono mt-1 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block"></span>
              {metadata.uploader}
            </p>
          </div>

          {/* Filtros por pestaña */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border-color/40">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`px-3 py-1 text-xs font-mono rounded transition-colors ${
                filter === "all"
                  ? "bg-primary text-background-dark font-bold shadow-[0_0_8px_rgba(89,242,13,0.4)]"
                  : "bg-background-dark text-slate-400 hover:text-slate-200 border border-border-color"
              }`}
            >
              Todos ({formats.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("video_audio")}
              className={`px-3 py-1 text-xs font-mono rounded transition-colors ${
                filter === "video_audio"
                  ? "bg-primary text-background-dark font-bold shadow-[0_0_8px_rgba(89,242,13,0.4)]"
                  : "bg-background-dark text-slate-400 hover:text-slate-200 border border-border-color"
              }`}
            >
              🎬 Video + Audio ({formats.filter((f) => f.type === "video_audio").length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("video_only")}
              className={`px-3 py-1 text-xs font-mono rounded transition-colors ${
                filter === "video_only"
                  ? "bg-primary text-background-dark font-bold shadow-[0_0_8px_rgba(89,242,13,0.4)]"
                  : "bg-background-dark text-slate-400 hover:text-slate-200 border border-border-color"
              }`}
            >
              🔇 Solo Video ({formats.filter((f) => f.type === "video_only").length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("audio_only")}
              className={`px-3 py-1 text-xs font-mono rounded transition-colors ${
                filter === "audio_only"
                  ? "bg-primary text-background-dark font-bold shadow-[0_0_8px_rgba(89,242,13,0.4)]"
                  : "bg-background-dark text-slate-400 hover:text-slate-200 border border-border-color"
              }`}
            >
              🎵 Solo Audio ({formats.filter((f) => f.type === "audio_only").length})
            </button>
          </div>
        </div>
      </div>

      {/* Grid de Formatos Disponibles (Expandible sin scroll) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
        {filteredFormats.length > 0 ? (
          filteredFormats.map((f) => {
            const isSelected = selectedFormatId === f.id;
            const sizeLabel = formatBytes(f.filesize);

            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedFormatId(f.id)}
                disabled={disabled}
                className={`flex flex-col text-left p-3 rounded border transition-all ${
                  isSelected
                    ? "border-primary bg-primary/15 shadow-[0_0_12px_rgba(89,242,13,0.3)] text-slate-100"
                    : "border-border-color bg-background-dark hover:border-primary/50 text-slate-300"
                } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={`font-bold text-sm font-mono ${isSelected ? "text-primary" : "text-slate-100"}`}>
                    {f.resolution}
                  </span>
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-surface border border-border-color uppercase">
                    {f.ext}
                  </span>
                </div>

                <div className="flex items-center justify-between mt-2 text-xs font-mono text-slate-400">
                  <span className="flex items-center gap-1">
                    {f.type === "video_audio" && "🔊 Con Audio"}
                    {f.type === "video_only" && "🔇 Mudo (Sin audio)"}
                    {f.type === "audio_only" && "🎵 Audio"}
                  </span>
                  {sizeLabel && <span>{sizeLabel}</span>}
                </div>

                {f.note && (
                  <span className="text-[10px] text-slate-500 font-mono mt-1 truncate">
                    {f.note}
                  </span>
                )}
              </button>
            );
          })
        ) : (
          <p className="text-slate-500 text-sm py-6 col-span-full text-center font-mono">
            No hay formatos en esta categoría
          </p>
        )}
      </div>

      {/* Botón de Descarga */}
      <button
        type="button"
        onClick={handleDownloadClick}
        disabled={!selectedFormat || disabled}
        className={`w-full flex items-center justify-center gap-2 px-6 py-3.5 font-bold text-sm uppercase tracking-widest rounded transition-all duration-300 border ${
          selectedFormat && !disabled
            ? "bg-primary text-background-dark hover:bg-white border-primary shadow-[0_0_15px_rgba(89,242,13,0.4)] cursor-pointer"
            : "bg-primary/20 text-primary/40 border-primary/20 cursor-not-allowed"
        }`}
      >
        <span className="material-symbols-outlined text-[20px]">download</span>
        {selectedFormat
          ? `Descargar ${selectedFormat.resolution} (${selectedFormat.ext.toUpperCase()})`
          : "Selecciona una opción de la lista"}
      </button>
    </div>
  );
}

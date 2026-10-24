import React, { useState, useRef, useEffect } from "react";
import {
  DownloaderService,
  type VideoMetadata,
  type VideoFormatOption,
} from "../../services/downloader.service";
import { FormatPicker } from "./FormatPicker";
import { StatusDisplay } from "./StatusDisplay";

export function Downloader() {
  const [url, setUrl] = useState("");
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [isStatusActive, setIsStatusActive] = useState(false);
  const [showLoader, setShowLoader] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [downloadSpeed, setDownloadSpeed] = useState<string | null>(null);
  const [eta, setEta] = useState<string | null>(null);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Typewriter placeholder logic
  const [currentPlaceholder, setCurrentPlaceholder] = useState("");
  const phrases = [
    "Ingresa la URL del video aquí...",
    "Pega el enlace de YouTube...",
    "Introduce la URL de destino...",
    "https://www.youtube.com/watch?v=...",
  ];

  useEffect(() => {
    let currentPhraseIndex = 0;
    let currentCharIndex = 0;
    let isDeleting = false;
    let typingSpeed = 100;

    const type = () => {
      const currentPhrase = phrases[currentPhraseIndex];

      if (isDeleting) {
        setCurrentPlaceholder(currentPhrase.substring(0, currentCharIndex - 1));
        currentCharIndex--;
        typingSpeed = 50;
      } else {
        setCurrentPlaceholder(currentPhrase.substring(0, currentCharIndex + 1));
        currentCharIndex++;
        typingSpeed = 100;
      }

      if (!isDeleting && currentCharIndex === currentPhrase.length) {
        isDeleting = true;
        typingSpeed = 2000;
      } else if (isDeleting && currentCharIndex === 0) {
        isDeleting = false;
        currentPhraseIndex = (currentPhraseIndex + 1) % phrases.length;
        typingSpeed = 500;
      }

      setTimeout(type, typingSpeed);
    };

    const timeoutId = setTimeout(type, typingSpeed);
    return () => clearTimeout(timeoutId);
  }, []);

  const clearPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearPolling();
  }, []);

  const setStatus = (
    message: string,
    active: boolean,
    loader: boolean,
    percent: number | null = null,
    speed: string | null = null,
    timeEta: string | null = null
  ) => {
    setStatusMessage(message);
    setIsStatusActive(active);
    setShowLoader(loader);
    setProgressPercent(percent);
    setDownloadSpeed(speed);
    setEta(timeEta);
  };

  const clearStatus = () => {
    setStatusMessage("");
    setIsStatusActive(false);
    setShowLoader(false);
    setProgressPercent(null);
    setDownloadSpeed(null);
    setEta(null);
  };

  const handleFetchMetadata = async () => {
    if (!url.trim()) return;

    clearPolling();
    setMetadata(null);
    setIsProcessing(true);
    setStatus("Analizando enlace y obteniendo formatos disponibles...", true, true);

    try {
      const data = await DownloaderService.fetchMetadata(url.trim());
      setMetadata(data);
      setStatus(`Metadatos listos: ${data.formats.length} formatos detectados`, true, false);
      setTimeout(() => clearStatus(), 2500);
    } catch (error: any) {
      setStatus(`ERROR: ${error.message}`, false, false);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = async (format: VideoFormatOption) => {
    if (!metadata) return;

    clearPolling();
    setIsProcessing(true);
    setStatus(`Iniciando descarga en el servidor (${format.resolution} - ${format.ext.toUpperCase()})...`, true, true);

    try {
      const { jobId } = await DownloaderService.startDownload(
        url.trim(),
        format.formatSelection,
        format.type,
        metadata.title
      );

      setStatus("Descargando y procesando archivo en el servidor...", true, true);

      // Polling ligero (KISS) para verificar cuándo está listo el archivo
      pollingRef.current = setInterval(async () => {
        try {
          const job = await DownloaderService.checkStatus(jobId);

          if (job.status === "downloading") {
            const pct = job.progressPercent || 0;
            const progressText = pct > 0 ? `Descargando: ${pct.toFixed(0)}%` : "Descargando y procesando...";
            const totalText = job.totalBytes ? ` de ~${job.totalBytes}` : "";
            setStatus(
              `${progressText}${totalText}`,
              true,
              true,
              pct,
              job.downloadSpeed,
              job.eta
            );
          } else if (job.status === "completed") {
            clearPolling();
            setStatus("¡Descarga lista! Transfiriendo archivo al navegador...", true, false, 100);

            // Disparar descarga directa del archivo generado
            const downloadUrl = DownloaderService.getDownloadUrl(jobId);
            window.location.href = downloadUrl;

            setIsProcessing(false);
            setTimeout(() => {
              setStatus("Archivo transferido al navegador.", true, false);
            }, 3000);
          } else if (job.status === "failed") {
            clearPolling();
            setStatus(`FALLÓ: ${job.error || "Error al procesar la descarga"}`, false, false);
            setIsProcessing(false);
          }
        } catch (pollErr: any) {
          clearPolling();
          setStatus(`ERROR: ${pollErr.message}`, false, false);
          setIsProcessing(false);
        }
      }, 1000);
    } catch (error: any) {
      setStatus(`ERROR: ${error.message}`, false, false);
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isProcessing) {
      handleFetchMetadata();
    }
  };

  // Calcular tamaño de fuente dinámico según la longitud del texto
  const getDynamicFontSize = (text: string) => {
    const len = text.length;
    if (len > 80) return "text-xs";
    if (len > 55) return "text-sm sm:text-base";
    if (len > 35) return "text-base sm:text-lg";
    return "text-base sm:text-lg md:text-xl";
  };

  return (
    <div className="w-full max-w-[850px] mt-4 flex flex-col items-center">
      {/* Contenedor principal del Formulario */}
      <div className="relative w-full group flex flex-col gap-3">
        <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 to-cyan-500/50 rounded-xl blur opacity-25 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>

        {/* Input box */}
        <div className="relative flex items-center w-full bg-surface border border-primary/40 rounded-xl min-h-[58px] sm:min-h-[66px] shadow-[0_0_20px_rgba(89,242,13,0.1)] focus-within:shadow-[0_0_30px_rgba(89,242,13,0.25)] focus-within:border-primary transition-all duration-300 px-3 sm:px-4 py-2">
          <div className="flex items-center justify-center pl-1 pr-2 text-primary shrink-0">
            <span className="text-lg sm:text-xl font-mono select-none">&gt;_</span>
          </div>
          <input
            id="url-input"
            className={`flex-1 min-w-0 bg-transparent border-none text-slate-100 ${getDynamicFontSize(
              url
            )} focus:ring-0 outline-none placeholder:text-slate-600 font-mono tracking-tight transition-all duration-200 px-1`}
            placeholder={currentPlaceholder}
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isProcessing}
            autoComplete="off"
          />
          {url.trim() && !isProcessing && (
            <button
              type="button"
              onClick={() => setUrl("")}
              className="text-slate-500 hover:text-slate-300 p-1 shrink-0 transition-colors"
              title="Limpiar"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>

        {/* Botón Ejecutar de ancho completo */}
        <button
          onClick={handleFetchMetadata}
          disabled={isProcessing || !url.trim()}
          className="relative w-full flex items-center justify-center h-12 sm:h-14 px-6 bg-primary text-background-dark font-black tracking-widest uppercase rounded-xl hover:bg-white transition-all duration-300 shadow-[0_0_15px_rgba(89,242,13,0.35)] hover:shadow-[0_0_25px_rgba(89,242,13,0.5)] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer group/btn overflow-hidden"
        >
          <span className="relative z-10 flex items-center justify-center gap-2 text-sm sm:text-base">
            <span>Ejecutar Descarga</span>
            <span className="material-symbols-outlined text-[20px] group-hover/btn:translate-y-0.5 transition-transform">
              download
            </span>
          </span>
        </button>
      </div>

      <div className="flex flex-wrap justify-between items-center gap-2 mt-2.5 px-2 w-full">
        <p className="text-[11px] sm:text-xs text-slate-500 font-mono flex items-center gap-1.5 truncate">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0"></span>{" "}
          <span className="truncate">Soporta: YouTube, TikTok, Instagram.</span>
        </p>
        <p className="text-[11px] sm:text-xs text-slate-400 font-mono flex items-center gap-1.5 bg-surface/80 px-2.5 py-1 rounded border border-border-color/60">
          <span className="material-symbols-outlined text-[14px] text-primary">data_usage</span>
          <span>Máx. 2 videos/día por IP • Hasta 1 GB</span>
        </p>
      </div>

      <div className="w-full mt-6 flex flex-col gap-6">
        {statusMessage && (
          <StatusDisplay
            message={statusMessage}
            active={isStatusActive}
            showLoader={showLoader}
            progressPercent={progressPercent}
            downloadSpeed={downloadSpeed}
            eta={eta}
          />
        )}

        {metadata && (
          <FormatPicker
            metadata={metadata}
            onDownload={handleDownload}
            disabled={isProcessing}
          />
        )}
      </div>
    </div>
  );
}

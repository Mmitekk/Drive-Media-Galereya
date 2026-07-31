"use client";

// ============================================================
// Instagram-style Story Player
//
// VIDEO PLAYBACK STRATEGY:
// 1. Use Worker /media/ proxy as the PRIMARY video source
// 2. If Worker video fails, try Google Drive iframe embed as fallback
//    (works only if files are shared via link)
// 3. If both fail, show error with "Open in Drive" button
// 4. ALWAYS have a max-duration auto-advance timer
//
// CRITICAL: For private files, only the Worker proxy can serve
// video content. The iframe embed requires "anyone with link"
// sharing which private files don't have.
// ============================================================
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
} from "react";
import type { DriveFile } from "@/lib/types";
import { getWorkerMediaUrl } from "@/lib/worker-api";
import { X, ChevronLeft, ChevronRight, SkipForward, Pause, Play, Volume2, VolumeX, ExternalLink, Repeat, Repeat1 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StoryPlayerProps {
  videos: DriveFile[];
  startIndex: number;
  onClose: () => void;
  token?: string | null;
}

// Maximum time to wait for video to start playing before showing error
const VIDEO_LOAD_TIMEOUT_MS = 15_000;
// Maximum time a story can be displayed before auto-advancing
const MAX_STORY_DURATION_MS = 45_000;

export const StoryPlayer = forwardRef(function StoryPlayer(
  { videos, startIndex, onClose, token }: StoryPlayerProps,
  ref
) {
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fallbackMode, setFallbackMode] = useState<"worker" | "iframe">("worker");
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [looping, setLooping] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const touchStartX = useRef<number | null>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = videos[currentIndex];

  // Build the Worker media URL with token for video playback
  const workerVideoUrl = current ? getWorkerMediaUrl(current.id, token || undefined) : "";
  // Google Drive iframe embed — works only for files shared via link
  const embedUrl = current ? `https://drive.google.com/file/d/${current.id}/preview` : "";

  // Clean up all timers
  const clearTimers = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    if (autoAdvanceRef.current) {
      clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }
  }, []);

  // Navigate to a specific index
  const navigateTo = useCallback(
    (newIndex: number) => {
      if (newIndex < 0 || newIndex >= videos.length) {
        onClose();
        return;
      }
      clearTimers();
      setCurrentIndex(newIndex);
      setLoading(true);
      setError(null);
      setFallbackMode("worker");
      setPaused(false);
      setProgress(0);
      // Keep looping state across navigation — user toggles it manually
    },
    [videos.length, onClose, clearTimers]
  );

  const goNext = useCallback(() => {
    navigateTo(currentIndex + 1);
  }, [currentIndex, navigateTo]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      navigateTo(currentIndex - 1);
    }
  }, [currentIndex, navigateTo]);

  // Toggle pause
  const togglePause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
    setPaused(!paused);
  }, [paused]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = !muted;
    }
    setMuted(!muted);
  }, [muted]);

  // Toggle loop
  const toggleLoop = useCallback(() => {
    const newLooping = !looping;
    setLooping(newLooping);
    // Also set the video element's loop property
    if (videoRef.current) {
      videoRef.current.loop = newLooping;
    }
  }, [looping]);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === " ") { e.preventDefault(); togglePause(); }
      if (e.key === "l" || e.key === "L" || e.key === "д" || e.key === "Д") { toggleLoop(); }
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose, goNext, goPrev, togglePause]);

  // Video event handlers
  const handleVideoLoaded = useCallback(() => {
    // Clear the load timeout — video loaded successfully
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    setLoading(false);
    setError(null);
    const video = videoRef.current;
    if (video) {
      // Sync loop property to video element whenever a new video loads
      video.loop = looping;
      video.play().catch(() => {
        // Autoplay blocked — try muted
        video.muted = true;
        setMuted(true);
        video.play().catch(() => {});
      });
    }
  }, [looping]);

  const handleVideoTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video && video.duration) {
      setProgress(video.currentTime / video.duration);
    }
  }, []);

  const handleVideoEnded = useCallback(() => {
    if (looping) {
      // Loop: restart current video
      const video = videoRef.current;
      if (video) {
        video.currentTime = 0;
        video.play().catch(() => {});
      }
    } else {
      goNext();
    }
  }, [goNext, looping]);

  const handleVideoError = useCallback(() => {
    // Immediately clear the video src to prevent native browser error overlay
    if (videoRef.current) {
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }

    const mediaError = videoRef.current?.error;
    const errorCodes: Record<number, string> = {
      1: "Aborted",
      2: "Network error",
      3: "Decode error",
      4: "Format not supported",
    };
    const errorDetail = mediaError
      ? `${errorCodes[mediaError.code] || "Unknown"} (code ${mediaError.code})`
      : "Unknown error";

    console.error(`[DMGA] Video playback error for ${current?.name}:`, errorDetail);

    // If we're in Worker mode, try iframe fallback
    if (fallbackMode === "worker") {
      console.log("[DMGA] Worker video failed, trying iframe embed fallback");
      setFallbackMode("iframe");
      setLoading(true);
    } else {
      // Both modes failed — show error
      setError(`Не удалось воспроизвести: ${errorDetail}`);
      setLoading(false);
    }
  }, [fallbackMode, current?.name]);

  // ── Load timeout: if video hasn't loaded within timeout, try fallback ──
  useEffect(() => {
    if (!current) return;
    if (!loading || error) return;

    // Clear previous timeout
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
    }

    loadTimeoutRef.current = setTimeout(() => {
      console.log(`[DMGA] Video load timeout (${VIDEO_LOAD_TIMEOUT_MS / 1000}s), ${fallbackMode} mode failed`);
      if (fallbackMode === "worker") {
        // Worker video didn't load — try iframe
        console.log("[DMGA] Switching to iframe fallback");
        if (videoRef.current) {
          videoRef.current.removeAttribute("src");
          videoRef.current.load();
        }
        setFallbackMode("iframe");
        setLoading(true);
      } else {
        // Iframe also didn't load — show error
        setError("Видео слишком долго загружалось");
        setLoading(false);
      }
    }, VIDEO_LOAD_TIMEOUT_MS);

    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
    };
  }, [currentIndex, loading, error, fallbackMode, current]);

  // ── Max-duration auto-advance: always advance after a maximum time ──
  useEffect(() => {
    if (!current) return;

    if (autoAdvanceRef.current) {
      clearTimeout(autoAdvanceRef.current);
    }

    // Auto-advance timer: disabled when looping
    if (looping) return;

    // Use video duration (if known) with some buffer, or max duration
    const durationMs = current.durationMs
      ? Math.min(current.durationMs + 5000, MAX_STORY_DURATION_MS)
      : MAX_STORY_DURATION_MS;

    autoAdvanceRef.current = setTimeout(() => {
      console.log("[DMGA] Auto-advance timer fired after", durationMs / 1000, "s");
      goNext();
    }, durationMs);

    return () => {
      if (autoAdvanceRef.current) {
        clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = null;
      }
    };
  }, [currentIndex, current, goNext, looping]);

  // ── Iframe load handler ──
  const handleIframeLoad = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    setLoading(false);
  }, []);

  // Touch swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = e.changedTouches[0].clientX - touchStartX.current;
    if (diff < -50) goNext();
    else if (diff > 50) goPrev();
    touchStartX.current = null;
  };

  if (!current) return null;

  // Use thumbnailLink as primary — direct Google CDN, works without Worker
  const thumbUrl = current.thumbnailLink
    ? current.thumbnailLink.replace(/=s\d+$/, "=s800")
    : `https://drive.google.com/thumbnail?id=${current.id}&sz=w800`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex flex-col"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Progress indicators */}
      <div className="absolute top-0 left-0 right-0 z-30 flex gap-1 px-3 pt-3">
        {videos.map((v, i) => {
          const isCurrent = i === currentIndex;
          const isPast = i < currentIndex;
          const isPlaying = isCurrent && !paused && !loading && !error;

          return (
            <div
              key={v.id}
              className="flex-1 h-[3px] rounded-full overflow-hidden mx-0.5"
              style={{ backgroundColor: "rgba(255,255,255,0.3)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: isPast ? "100%" : isCurrent ? `${progress * 100}%` : "0%",
                  backgroundColor: isCurrent ? "white" : "rgba(255,255,255,0.6)",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Top bar */}
      <div className="absolute top-7 left-0 right-0 z-20 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-white/20 overflow-hidden">
            <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
          </div>
          <div>
            <p className="text-white text-sm font-medium truncate max-w-[200px]">
              {current.name.replace(/\.[^.]+$/, "")}
            </p>
            <p className="text-white/60 text-xs">
              {currentIndex + 1} / {videos.length}
              {fallbackMode === "iframe" && " · Встроенный плеер"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {fallbackMode === "worker" && !loading && !error && (
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10"
              onClick={togglePause}
            >
              {paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
            </Button>
          )}
          {fallbackMode === "worker" && !loading && !error && (
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10"
              onClick={toggleMute}
            >
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={looping ? "text-cyan-400 hover:bg-white/10" : "text-white/60 hover:bg-white/10"}
            onClick={toggleLoop}
            title={looping ? "Убрать повтор" : "Повтор видео"}
          >
            {looping ? <Repeat1 className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10"
            onClick={onClose}
          >
            <X className="h-6 w-6" />
          </Button>
        </div>
      </div>

      {/* Video area with tap zones */}
      <div className="flex-1 relative overflow-hidden">
        {/* Left tap zone = prev */}
        <button
          className="absolute left-0 top-0 bottom-0 w-1/4 z-10 cursor-pointer"
          onClick={goPrev}
          aria-label="Предыдущее видео"
        />
        {/* Center tap zone = pause/play (only in worker video mode) */}
        {fallbackMode === "worker" && !error && (
          <button
            className="absolute left-1/4 top-0 bottom-0 w-1/2 z-10 cursor-pointer"
            onClick={togglePause}
            aria-label="Пауза/Воспроизведение"
          />
        )}
        {/* Right tap zone = next */}
        <button
          className="absolute right-0 top-0 bottom-0 w-1/4 z-10 cursor-pointer"
          onClick={goNext}
          aria-label="Следующее видео"
        />

        {error ? (
          /* Error state */
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 px-6">
            <p className="text-white/80 text-base mb-2 text-center">Не удалось воспроизвести видео</p>
            <p className="text-white/40 text-xs mb-1 text-center">{current.name}</p>
            {error && (
              <p className="text-white/30 text-xs mb-4 text-center max-w-md">{error}</p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-white border-white/30"
                onClick={goNext}
              >
                Следующее
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-white border-white/30"
                asChild
              >
                <a
                  href={embedUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-1" />
                  Открыть в Drive
                </a>
              </Button>
            </div>
          </div>
        ) : fallbackMode === "iframe" ? (
          /* Google Drive iframe embed — fallback for when Worker video fails */
          <iframe
            key={`embed-${current.id}`}
            ref={iframeRef}
            src={embedUrl}
            className="absolute inset-0 w-full h-full"
            allow="autoplay; encrypted-media"
            allowFullScreen
            onLoad={handleIframeLoad}
            style={{ border: "none" }}
          />
        ) : (
          /* Worker media proxy — PRIMARY video playback */
          <video
            key={`video-${current.id}`}
            ref={videoRef}
            src={workerVideoUrl}
            className="absolute inset-0 w-full h-full object-contain"
            playsInline
            muted={muted}
            preload="auto"
            onLoadedMetadata={handleVideoLoaded}
            onCanPlay={handleVideoLoaded}
            onTimeUpdate={handleVideoTimeUpdate}
            onEnded={handleVideoEnded}
            onError={handleVideoError}
          />
        )}

        {/* Loading spinner */}
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="animate-spin h-10 w-10 border-4 border-white/30 border-t-white rounded-full" />
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="flex items-center justify-between p-3 bg-black/50">
        <Button
          variant="ghost"
          className="text-white hover:bg-white/10 gap-2"
          onClick={goPrev}
          disabled={currentIndex === 0}
        >
          <ChevronLeft className="h-5 w-5" />
          Назад
        </Button>
        <p className="text-white/60 text-sm truncate max-w-[300px]">
          {current.name}
        </p>
        <Button
          variant="ghost"
          className="text-white hover:bg-white/10 gap-2"
          onClick={goNext}
        >
          {currentIndex < videos.length - 1 ? "Далее" : "Закрыть"}
          {currentIndex < videos.length - 1 ? (
            <ChevronRight className="h-5 w-5" />
          ) : (
            <SkipForward className="h-5 w-5" />
          )}
        </Button>
      </div>
    </div>
  );
});

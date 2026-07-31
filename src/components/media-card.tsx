"use client";

// ============================================================
// Media card — thumbnail card for image / video
//
// STRATEGY: Use thumbnailLink (Google CDN signed URL) as PRIMARY
// source — it's fast, direct, and doesn't depend on the Worker.
// Worker proxy URLs are FALLBACK only.
//
// thumbnailLink is returned by Google Drive API and is a direct
// CDN URL (lh3.googleusercontent.com) with auth embedded in the
// URL itself — works without Worker, without CORS, without any
// additional requests.
// ============================================================
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { DriveFile } from "@/lib/types";
import { getThumbnailUrl, formatDuration, formatDate, getWorkerMediaUrl, getWorkerThumbnailUrl } from "@/lib/google-drive";
import { isWorkerMode } from "@/lib/config";
import { Play, Image as ImageIcon, Clock, Folder, Video } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useAuth, getWorkerToken } from "@/lib/auth-context";

interface MediaCardProps {
  file: DriveFile;
  onClick: (file: DriveFile) => void;
  folderName?: string;
}

/**
 * Increase the size of a Google CDN thumbnail URL.
 * thumbnailLink typically ends with =s220 (220px).
 * We replace it with a larger size for better quality.
 */
function enlargeThumbnailUrl(url: string | undefined, size: number = 600): string | undefined {
  if (!url) return undefined;
  // Replace =sNNN suffix with larger size
  // Google CDN URLs: https://lh3.googleusercontent.com/...=s220
  return url.replace(/=s\d+$/, `=s${size}`);
}

export function MediaCard({ file, onClick, folderName }: MediaCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [fallbackLevel, setFallbackLevel] = useState(0);
  const folders = useAppStore((s) => s.folders);
  const { token } = useAuth();
  const workerToken = getWorkerToken(token);
  const inWorkerMode = isWorkerMode();
  const isVideo = file.mediaType === "video";

  // Fallback chain — thumbnailLink is PRIMARY (direct Google CDN):
  //
  // Worker mode — IMAGES:
  //   0: thumbnailLink (enlarged) — Google CDN, direct, fastest
  //   1: getWorkerThumbnailUrl — Worker proxy
  //   2: getWorkerMediaUrl — Worker media proxy (full image, slower)
  //   3: getThumbnailUrl — generic Drive URL (rarely works)
  //
  // Worker mode — VIDEOS:
  //   0: thumbnailLink (enlarged) — Google CDN, direct, fastest
  //   1: getWorkerThumbnailUrl — Worker proxy
  //   2: getThumbnailUrl — generic Drive URL (rarely works)
  //
  // Direct API mode:
  //   0: thumbnailLink (enlarged) — Google CDN
  //   1: getThumbnailUrl — generic Drive URL
  //   2: getWorkerThumbnailUrl — Worker proxy
  //   3: getWorkerMediaUrl — Worker media proxy

  const getThumbSrc = (): string => {
    const enlargedThumb = enlargeThumbnailUrl(file.thumbnailLink, 600);

    if (inWorkerMode) {
      if (isVideo) {
        // Video thumbnails
        switch (fallbackLevel) {
          case 0:
            // Primary: direct Google CDN thumbnail
            if (enlargedThumb) return enlargedThumb;
            // Fall through to next level if no thumbnailLink
            setFallbackLevel(1);
            return getWorkerThumbnailUrl(file.id, workerToken || undefined, 600);
          case 1:
            return getWorkerThumbnailUrl(file.id, workerToken || undefined, 600);
          case 2:
            return getThumbnailUrl(file.id, 600);
          default:
            return "";
        }
      } else {
        // Image thumbnails
        switch (fallbackLevel) {
          case 0:
            // Primary: direct Google CDN thumbnail
            if (enlargedThumb) return enlargedThumb;
            // Fall through to next level if no thumbnailLink
            setFallbackLevel(1);
            return getWorkerThumbnailUrl(file.id, workerToken || undefined, 600);
          case 1:
            return getWorkerThumbnailUrl(file.id, workerToken || undefined, 600);
          case 2:
            return getWorkerMediaUrl(file.id, workerToken || undefined);
          case 3:
            return getThumbnailUrl(file.id, 600);
          default:
            return "";
        }
      }
    } else {
      // Direct API mode
      switch (fallbackLevel) {
        case 0:
          if (enlargedThumb) return enlargedThumb;
          return getThumbnailUrl(file.id, 600);
        case 1:
          return getThumbnailUrl(file.id, 600);
        case 2:
          return getWorkerThumbnailUrl(file.id, workerToken || undefined, 600);
        case 3:
          return getWorkerMediaUrl(file.id, workerToken || undefined);
        default:
          return "";
      }
    }
  };

  const thumbSrc = getThumbSrc();
  const folder =
    folderName ?? folders.find((f) => f.id === file.parentId)?.name;

  const maxFallback = inWorkerMode ? (isVideo ? 2 : 3) : 3;

  const handleError = () => {
    if (fallbackLevel < maxFallback) {
      setFallbackLevel(fallbackLevel + 1);
      setLoaded(false);
    } else {
      setErrored(true);
    }
  };

  // Auto-timeout: if thumbnail doesn't load within 8s, try next fallback
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (loaded || errored) return;
    timerRef.current = setTimeout(() => {
      if (!loaded && !errored) {
        console.log(`[DMGA] Thumbnail timeout for ${file.name} at level ${fallbackLevel}, trying next`);
        handleError();
      }
    }, 8000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fallbackLevel, loaded, errored]);

  // For videos with no thumbnail, show a video icon with a styled background
  const showVideoPlaceholder = isVideo && errored;

  return (
    <button
      onClick={() => onClick(file)}
      className="group relative aspect-[4/3] rounded-xl overflow-hidden bg-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
    >
      {/* Thumbnail */}
      {!errored && thumbSrc ? (
        <img
          key={`${file.id}-${fallbackLevel}`}
          src={thumbSrc}
          alt={file.name}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={handleError}
          className={cn(
            "absolute inset-0 w-full h-full object-cover transition-all duration-300 group-hover:scale-105",
            loaded ? "opacity-100" : "opacity-0"
          )}
        />
      ) : showVideoPlaceholder ? (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-purple-900/40 to-pink-900/40">
          <div className="flex flex-col items-center gap-2">
            <Play className="h-10 w-10 text-white/60 fill-white/60" />
            {file.durationMs && (
              <span className="text-xs text-white/50">{formatDuration(file.durationMs)}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
        </div>
      )}

      {/* Skeleton while loading */}
      {!loaded && !errored && (
        <div className="absolute inset-0 animate-pulse bg-muted" />
      )}

      {/* Overlay gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

      {/* Video badge */}
      {isVideo && !showVideoPlaceholder && (
        <div className="absolute top-2 right-2 bg-black/60 rounded-full p-1.5 backdrop-blur-sm">
          <Play className="h-3.5 w-3.5 text-white fill-white" />
        </div>
      )}

      {/* Duration badge */}
      {isVideo && file.durationMs && !showVideoPlaceholder && (
        <div className="absolute bottom-2 right-2 bg-black/60 rounded px-1.5 py-0.5 text-xs text-white backdrop-blur-sm">
          {formatDuration(file.durationMs)}
        </div>
      )}

      {/* Bottom info on hover */}
      <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform duration-200">
        <p className="text-sm font-medium text-white truncate">{file.name}</p>
        <div className="flex items-center gap-2 mt-1 text-xs text-white/70">
          <Clock className="h-3 w-3" />
          <span>{formatDate(file.createdTime)}</span>
          {folder && (
            <>
              <Folder className="h-3 w-3 ml-1" />
              <span className="truncate">{folder}</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

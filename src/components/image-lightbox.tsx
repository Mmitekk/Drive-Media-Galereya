"use client";

// ============================================================
// Image lightbox — full-screen image viewer
//
// STRATEGY: Use thumbnailLink with large size as PRIMARY source.
// thumbnailLink is a direct Google CDN URL (lh3.googleusercontent.com)
// with auth embedded — works without Worker.
// Worker /media/ proxy is FALLBACK only.
// ============================================================
import { useState, useEffect, useCallback } from "react";
import type { DriveFile } from "@/lib/types";
import { getWorkerMediaUrl } from "@/lib/google-drive";
import { isWorkerMode } from "@/lib/config";
import { X, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImageLightboxProps {
  file: DriveFile;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  token?: string | null;
}

export function ImageLightbox({
  file,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  token,
}: ImageLightboxProps) {
  const [imgError, setImgError] = useState(false);
  const [fallbackLevel, setFallbackLevel] = useState(0);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev && onPrev) onPrev();
      if (e.key === "ArrowRight" && hasNext && onNext) onNext();
    },
    [onClose, onPrev, onNext, hasPrev, hasNext]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  // Reset error state when file changes
  useEffect(() => {
    setImgError(false);
    setFallbackLevel(0);
  }, [file.id]);

  const inWorkerMode = isWorkerMode();

  // Image URL with fallback chain:
  // 0: thumbnailLink enlarged to s0 (original size) — Google CDN, direct
  // 1: Worker /media/ proxy — streams full image
  // 2: lh3.googleusercontent.com/d/{id} — generic CDN (rarely works for private)
  const getImageUrl = (): string => {
    if (inWorkerMode) {
      switch (fallbackLevel) {
        case 0:
          // Primary: thumbnailLink with =s0 (original/full size)
          if (file.thumbnailLink) {
            return file.thumbnailLink.replace(/=s\d+$/, "=s0");
          }
          // No thumbnailLink — go to next fallback
          setFallbackLevel(1);
          return getWorkerMediaUrl(file.id, token || undefined);
        case 1:
          return getWorkerMediaUrl(file.id, token || undefined);
        case 2:
          return `https://lh3.googleusercontent.com/d/${file.id}`;
        default:
          return getWorkerMediaUrl(file.id, token || undefined);
      }
    } else {
      switch (fallbackLevel) {
        case 0:
          if (file.thumbnailLink) {
            return file.thumbnailLink.replace(/=s\d+$/, "=s0");
          }
          return `https://lh3.googleusercontent.com/d/${file.id}`;
        case 1:
          return `https://lh3.googleusercontent.com/d/${file.id}`;
        case 2:
          return getWorkerMediaUrl(file.id, token || undefined);
        default:
          return `https://lh3.googleusercontent.com/d/${file.id}`;
      }
    }
  };

  const imageUrl = getImageUrl();

  // Download URL — use Worker proxy in Worker mode, or webContentLink
  const downloadUrl = inWorkerMode
    ? getWorkerMediaUrl(file.id, token || undefined)
    : file.webContentLink;

  const handleError = () => {
    const maxLevel = inWorkerMode ? 2 : 2;
    if (fallbackLevel < maxLevel) {
      setFallbackLevel(fallbackLevel + 1);
    } else if (!imgError) {
      setImgError(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center">
      {/* Close */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 text-white hover:bg-white/10 z-10"
        onClick={onClose}
      >
        <X className="h-6 w-6" />
      </Button>

      {/* Download */}
      {downloadUrl && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-4 right-16 text-white hover:bg-white/10 z-10"
          asChild
        >
          <a href={downloadUrl} target="_blank" rel="noreferrer" download>
            <Download className="h-5 w-5" />
          </a>
        </Button>
      )}

      {/* Nav: prev */}
      {hasPrev && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/10 h-12 w-12 z-10"
          onClick={onPrev}
        >
          <ChevronLeft className="h-8 w-8" />
        </Button>
      )}

      {/* Nav: next */}
      {hasNext && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/10 h-12 w-12 z-10"
          onClick={onNext}
        >
          <ChevronRight className="h-8 w-8" />
        </Button>
      )}

      {/* Image */}
      {!imgError && (
        <img
          key={`${file.id}-${fallbackLevel}`}
          src={imageUrl}
          alt={file.name}
          className="max-h-[90vh] max-w-[90vw] object-contain"
          onError={handleError}
        />
      )}

      {/* Caption */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
        <p className="text-white text-lg font-medium truncate">{file.name}</p>
      </div>
    </div>
  );
}

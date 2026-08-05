"use client";

// ============================================================
// Media Gallery — Stories circles (Instagram-style) + grid
// Root folders: purple→pink→orange gradient
// Subfolders: blue→cyan→teal gradient
// "Watch all" button to play all videos
// ============================================================
import { useState, useMemo, useCallback } from "react";
import type { DriveFile, DriveFolder } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { useAuth, getWorkerToken } from "@/lib/auth-context";
import { MediaCard } from "./media-card";
import { StoryPlayer } from "./story-player";
import { ImageLightbox } from "./image-lightbox";
import { getWorkerThumbnailUrl, getWorkerMediaUrl, getThumbnailUrl } from "@/lib/google-drive";
import { Video, ImageIcon, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MediaGallery() {
  const { token } = useAuth();
  const workerToken = getWorkerToken(token);
  const selectedFolderId = useAppStore((s) => s.selectedFolderId);
  const folders = useAppStore((s) => s.folders);
  const filesByFolder = useAppStore((s) => s.filesByFolder);
  const filterType = useAppStore((s) => s.filterType);
  const searchQuery = useAppStore((s) => s.searchQuery);

  // Derive files reactively with useMemo on actual state dependencies
  const files = useMemo(() => {
    let result: DriveFile[];
    if (selectedFolderId) {
      const ids = collectDescendantIds(folders, selectedFolderId);
      result = ids.flatMap((id) => filesByFolder[id] || []);
    } else {
      result = Object.values(filesByFolder).flat();
    }
    if (filterType === "images") result = result.filter((f) => f.mediaType === "image");
    else if (filterType === "videos") result = result.filter((f) => f.mediaType === "video");
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((f) => f.name.toLowerCase().includes(q));
    }
    // Deduplicate
    const seen = new Set<string>();
    result = result.filter((f) => { if (seen.has(f.id)) return false; seen.add(f.id); return true; });
    return result;
  }, [selectedFolderId, folders, filesByFolder, filterType, searchQuery]);

  // Viewer state
  const [viewingFile, setViewingFile] = useState<DriveFile | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);
  const [storyVideos, setStoryVideos] = useState<DriveFile[]>([]);
  const [storyStartIndex, setStoryStartIndex] = useState(0);

  const images = useMemo(() => files.filter((f) => f.mediaType === "image"), [files]);

  // Build folder hierarchy helpers
  const getTopLevelFolders = useMemo(() => {
    const allIds = new Set(folders.map((f) => f.id));
    return folders.filter((f) => !f.parentId || !allIds.has(f.parentId));
  }, [folders]);

  const getChildFolders = useMemo(() => {
    return (parentId: string) => folders.filter((f) => f.parentId === parentId);
  }, [folders]);

  // Get videos for a folder + all its descendants
  const getVideosForFolderTree = useMemo(() => {
    return (folderId: string) => {
      const ids = collectDescendantIds(folders, folderId);
      const vids: DriveFile[] = [];
      for (const id of ids) {
        const folderFiles = filesByFolder[id] || [];
        vids.push(...folderFiles.filter((f) => f.mediaType === "video"));
      }
      // Dedupe
      const seen = new Set<string>();
      return vids.filter((v) => {
        if (seen.has(v.id)) return false;
        seen.add(v.id);
        return true;
      });
    };
  }, [folders, filesByFolder]);

  // Get first file with a thumbnail for a folder (for Stories circle)
  // Used by StoryThumb component which has multi-level fallback
  const getFolderFirstFile = useMemo(() => {
    return (folderId: string): DriveFile | null => {
      const ids = collectDescendantIds(folders, folderId);
      for (const id of ids) {
        const folderFiles = filesByFolder[id] || [];
        const first = folderFiles[0];
        if (first) return first;
      }
      return null;
    };
  }, [folders, filesByFolder]);

  // Get count of videos in folder tree
  const getVideoCount = useMemo(() => {
    return (folderId: string) => getVideosForFolderTree(folderId).length;
  }, [getVideosForFolderTree]);

  // Open story player for a specific folder
  const openFolderStory = (folderId: string) => {
    const vids = getVideosForFolderTree(folderId);
    if (vids.length === 0) return;
    setStoryVideos(vids);
    setStoryStartIndex(0);
    setStoryOpen(true);
  };

  // Open story player for all videos
  const openAllStories = () => {
    const vids = files.filter((f) => f.mediaType === "video");
    if (vids.length === 0) return;
    // Dedupe
    const seen = new Set<string>();
    const unique = vids.filter((v) => {
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    });
    setStoryVideos(unique);
    setStoryStartIndex(0);
    setStoryOpen(true);
  };

  // Click on a media card
  const handleClick = (file: DriveFile) => {
    if (file.mediaType === "video") {
      // Open Stories player with all current videos, starting from this one
      const vids = files.filter((f) => f.mediaType === "video");
      const seen = new Set<string>();
      const unique = vids.filter((v) => {
        if (seen.has(v.id)) return false;
        seen.add(v.id);
        return true;
      });
      const idx = unique.findIndex((v) => v.id === file.id);
      setStoryVideos(unique);
      setStoryStartIndex(idx >= 0 ? idx : 0);
      setStoryOpen(true);
    } else {
      setViewingFile(file);
    }
  };

  // Lightbox navigation
  const currentImageIndex = viewingFile
    ? images.findIndex((f) => f.id === viewingFile.id)
    : -1;

  const handlePrevImage = () => {
    if (currentImageIndex > 0) {
      setViewingFile(images[currentImageIndex - 1]);
    }
  };

  const handleNextImage = () => {
    if (currentImageIndex < images.length - 1) {
      setViewingFile(images[currentImageIndex + 1]);
    }
  };

  // Determine which folders to show as Stories circles
  const storiesFolders = useMemo(() => {
    if (selectedFolderId) {
      // Show selected folder + its direct children
      const parent = folders.find((f) => f.id === selectedFolderId);
      const children = getChildFolders(selectedFolderId);
      return parent ? [parent, ...children] : children;
    } else {
      // Show all top-level folders + their children
      const result: typeof folders = [];
      for (const top of getTopLevelFolders) {
        result.push(top);
        result.push(...getChildFolders(top.id));
      }
      return result;
    }
  }, [selectedFolderId, folders, getTopLevelFolders, getChildFolders]);

  const hasAnyVideos = storiesFolders.some((f) => getVideoCount(f.id) > 0);

  return (
    <>
      {/* Empty state */}
      {files.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <ImageIcon className="h-16 w-16 mb-4 opacity-40" />
          <p className="text-lg font-medium">Файлы не найдены</p>
          <p className="text-sm mt-1">Попробуйте изменить фильтры или выбрать другую папку</p>
        </div>
      )}

      {/* ── Stories row (Instagram-style circles) ── */}
      {hasAnyVideos && (
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <Video className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-lg">Сторис</h3>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto gap-2"
              onClick={openAllStories}
            >
              <Play className="h-4 w-4" />
              Смотреть все
            </Button>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
            {storiesFolders.map((folder, idx) => {
              const videoCount = getVideoCount(folder.id);
              if (videoCount === 0) return null;

              const firstFile = getFolderFirstFile(folder.id);
              const isTopLevel = !folder.parentId || !folders.some((f) => f.id === folder.parentId);
              const size = isTopLevel ? "w-[68px] h-[68px]" : "w-[58px] h-[58px]";
              const gradient = isTopLevel
                ? "from-purple-500 via-pink-500 to-orange-500"
                : "from-blue-500 via-cyan-500 to-teal-500";

              return (
                <button
                  key={folder.id}
                  onClick={() => openFolderStory(folder.id)}
                  className="shrink-0 flex flex-col items-center gap-1.5 group"
                >
                  {/* Circle with gradient border */}
                  <div
                    className={`${size} rounded-full bg-gradient-to-br ${gradient} p-[3px] group-hover:scale-105 transition-transform`}
                  >
                    <div className="w-full h-full rounded-full overflow-hidden bg-background">
                      <StoryThumb file={firstFile} workerToken={workerToken || undefined} />
                    </div>
                  </div>
                  {/* Name */}
                  <span className="text-xs text-muted-foreground truncate max-w-[72px] text-center">
                    {folder.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Gallery header */}
      {selectedFolderId && (
        <div className="flex items-center gap-2 mb-4">
          <Video className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-xl">
            {folders.find((f) => f.id === selectedFolderId)?.name}
          </h2>
        </div>
      )}

      {/* Media grid */}
      {files.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {files.map((file) => (
            <MediaCard
              key={file.id}
              file={file}
              onClick={handleClick}
            />
          ))}
        </div>
      )}

      {/* Stories player */}
      {storyOpen && storyVideos.length > 0 && (
        <StoryPlayer
          videos={storyVideos}
          startIndex={storyStartIndex}
          onClose={() => setStoryOpen(false)}
          token={workerToken}
        />
      )}

      {/* Image lightbox */}
      {viewingFile && viewingFile.mediaType === "image" && (
        <ImageLightbox
          file={viewingFile}
          onClose={() => setViewingFile(null)}
          onPrev={handlePrevImage}
          onNext={handleNextImage}
          hasPrev={currentImageIndex > 0}
          hasNext={currentImageIndex < images.length - 1}
          token={workerToken}
        />
      )}
    </>
  );
}

// ── Helper ────────────────────────────────────────────────

function collectDescendantIds(folders: DriveFolder[], parentId: string): string[] {
  const ids = [parentId];
  const children = folders.filter((f) => f.parentId === parentId);
  for (const child of children) {
    ids.push(...collectDescendantIds(folders, child.id));
  }
  return ids;
}

// ── Story thumbnail with multi-level fallback ──────────────
// Prevents broken image icons when a thumbnail URL fails.
// Fallback chain:
//   1. thumbnailLink (Google CDN — fast but may not work for private files)
//   2. Worker thumbnail proxy (/thumbnail/{fileId}?token=...)
//   3. Generic Drive thumbnail (drive.google.com/thumbnail?id=...)
//   4. Placeholder icon (Video)

function StoryThumb({ file, workerToken }: { file: DriveFile | null; workerToken?: string }) {
  const [fallbackLevel, setFallbackLevel] = useState(0);

  const handleError = useCallback(() => {
    setFallbackLevel((prev) => prev + 1);
  }, []);

  if (!file) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-muted">
        <Video className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  // Build all possible URLs (skip nulls to get a flat list)
  const urls: string[] = [];
  if (file.thumbnailLink) {
    urls.push(file.thumbnailLink.replace(/=s\d+$/, "=s400"));
  }
  if (workerToken) {
    urls.push(getWorkerThumbnailUrl(file.id, workerToken, 400));
  }
  urls.push(getThumbnailUrl(file.id, 400));

  // Current URL to try
  const currentUrl = fallbackLevel < urls.length ? urls[fallbackLevel] : null;

  // All URLs exhausted → show placeholder
  if (!currentUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-muted">
        <Video className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      key={`${file.id}-${fallbackLevel}`}
      src={currentUrl}
      alt=""
      loading="lazy"
      onError={handleError}
      className="w-full h-full object-cover"
    />
  );
}

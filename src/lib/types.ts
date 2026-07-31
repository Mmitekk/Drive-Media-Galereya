// ============================================================
// Shared TypeScript types for the Google Drive Media Gallery
// ============================================================

export type MediaType = "image" | "video" | "unknown";

export interface DriveFolder {
  id: string;
  name: string;
  parentId: string | null;
  /** ISO date string */
  createdTime: string;
  /** How many media files inside (filled after listing) */
  count?: number;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** ISO date string */
  createdTime: string;
  /** ISO date string */
  modifiedTime: string;
  /** Parent folder ID */
  parentId: string;
  /** File size in bytes */
  size?: string;
  /** Web-view link */
  webViewLink?: string;
  /** Direct download / content link */
  webContentLink?: string;
  /** Thumbnail link from Drive API */
  thumbnailLink?: string;
  /** Resolved media type */
  mediaType: MediaType;
  /** Image width (if image) */
  width?: number;
  /** Image height (if image) */
  height?: number;
  /** Video duration ms (if video) */
  durationMs?: number;
}

export interface FolderWithFiles {
  folder: DriveFolder;
  files: DriveFile[];
}

export type SortOrder = "newest" | "oldest" | "name-asc" | "name-desc";
export type FilterType = "all" | "images" | "videos";

export interface AppState {
  /** All folders discovered from the root */
  folders: DriveFolder[];
  /** Map folderId → files */
  filesByFolder: Record<string, DriveFile[]>;
  /** Currently selected folder ID (null = all) */
  selectedFolderId: string | null;
  /** Search query */
  searchQuery: string;
  /** Sort order */
  sortOrder: SortOrder;
  /** Media type filter */
  filterType: FilterType;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Whether initial load is done */
  initialized: boolean;

  // Actions
  setFolders: (folders: DriveFolder[]) => void;
  setFilesForFolder: (folderId: string, files: DriveFile[]) => void;
  selectFolder: (folderId: string | null) => void;
  setSearchQuery: (query: string) => void;
  setSortOrder: (order: SortOrder) => void;
  setFilterType: (filter: FilterType) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setInitialized: (initialized: boolean) => void;
  /** Convenience: get all files across folders (filtered, sorted) */
  getAllFiles: () => DriveFile[];
}

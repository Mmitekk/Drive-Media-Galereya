// ============================================================
// Zustand store for global app state
// ============================================================
import { create } from "zustand";
import type { AppState, DriveFile, SortOrder, FilterType, DriveFolder } from "./types";

function sortFiles(files: DriveFile[], order: SortOrder): DriveFile[] {
  const sorted = [...files];
  switch (order) {
    case "newest":
      return sorted.sort(
        (a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime()
      );
    case "oldest":
      return sorted.sort(
        (a, b) => new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime()
      );
    case "name-asc":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case "name-desc":
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    default:
      return sorted;
  }
}

/** Collect a folder ID + all its descendant folder IDs */
function collectDescendantIds(folders: DriveFolder[], parentId: string): string[] {
  const ids = [parentId];
  const children = folders.filter((f) => f.parentId === parentId);
  for (const child of children) {
    ids.push(...collectDescendantIds(folders, child.id));
  }
  return ids;
}

export const useAppStore = create<AppState>((set, get) => ({
  folders: [],
  filesByFolder: {},
  selectedFolderId: null,
  searchQuery: "",
  sortOrder: "newest",
  filterType: "all",
  loading: false,
  error: null,
  initialized: false,

  setFolders: (folders) => set({ folders }),
  setFilesForFolder: (folderId, files) =>
    set((s) => ({ filesByFolder: { ...s.filesByFolder, [folderId]: files } })),
  selectFolder: (selectedFolderId) => set({ selectedFolderId }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSortOrder: (sortOrder) => set({ sortOrder }),
  setFilterType: (filterType) => set({ filterType }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setInitialized: (initialized) => set({ initialized }),

  getAllFiles: () => {
    const { folders, filesByFolder, selectedFolderId, searchQuery, sortOrder, filterType } =
      get();

    let files: DriveFile[];

    if (selectedFolderId) {
      // Include files from the selected folder AND all its descendant subfolders
      const folderIds = collectDescendantIds(folders, selectedFolderId);
      files = folderIds.flatMap((id) => filesByFolder[id] || []);
    } else {
      files = Object.values(filesByFolder).flat();
    }

    // Filter by type
    if (filterType === "images") {
      files = files.filter((f) => f.mediaType === "image");
    } else if (filterType === "videos") {
      files = files.filter((f) => f.mediaType === "video");
    }

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      files = files.filter(
        (f) =>
          f.name.toLowerCase().includes(q)
      );
    }

    // Deduplicate (a file might appear in multiple folder lookups)
    const seen = new Set<string>();
    files = files.filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });

    return sortFiles(files, sortOrder);
  },
}));

"use client";

// ============================================================
// Folder navigation — tree sidebar with expand/collapse
// Shows hierarchy, video icons, descendant file counts
// ============================================================
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { DriveFolder } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { Folder, FolderOpen, LayoutGrid, ChevronRight, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

interface FolderNavProps {
  folders: DriveFolder[];
  fileCounts: Record<string, number>;
  className?: string;
}

export function FolderNav({ folders, fileCounts, className }: FolderNavProps) {
  const selectedFolderId = useAppStore((s) => s.selectedFolderId);
  const selectFolder = useAppStore((s) => s.selectFolder);
  const filesByFolder = useAppStore((s) => s.filesByFolder);

  // Build tree structure
  const tree = useMemo(() => buildFolderTree(folders), [folders]);

  // Count files including descendants
  const totalCount = useMemo(() => {
    return Object.values(filesByFolder).flat().length;
  }, [filesByFolder]);

  // Count files for a folder + all descendants
  const getDescendantFileCount = useMemo(() => {
    return (folderId: string) => {
      const ids = collectDescendantIds(folders, folderId);
      let count = 0;
      for (const id of ids) {
        count += (filesByFolder[id] || []).length;
      }
      return count;
    };
  }, [folders, filesByFolder]);

  // Check if folder or descendants have videos
  const hasVideos = useMemo(() => {
    return (folderId: string) => {
      const ids = collectDescendantIds(folders, folderId);
      for (const id of ids) {
        const files = filesByFolder[id] || [];
        if (files.some((f) => f.mediaType === "video")) return true;
      }
      return false;
    };
  }, [folders, filesByFolder]);

  return (
    <ScrollArea className={cn("h-full", className)}>
      <div className="space-y-1 p-2">
        {/* "All" button */}
        <Button
          variant={selectedFolderId === null ? "secondary" : "ghost"}
          className="w-full justify-start gap-2 font-normal"
          onClick={() => selectFolder(null)}
        >
          <LayoutGrid className="h-4 w-4 shrink-0" />
          <span className="truncate">Все файлы</span>
          <Badge variant="outline" className="ml-auto text-xs">
            {totalCount}
          </Badge>
        </Button>

        {/* Folder tree */}
        {tree.map((node) => (
          <FolderTreeNode
            key={node.folder.id}
            node={node}
            selectedFolderId={selectedFolderId}
            onSelect={selectFolder}
            getFileCount={getDescendantFileCount}
            hasVideos={hasVideos}
            depth={0}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

// ── Tree node ──────────────────────────────────────────────

interface TreeNode {
  folder: DriveFolder;
  children: TreeNode[];
}

function FolderTreeNode({
  node,
  selectedFolderId,
  onSelect,
  getFileCount,
  hasVideos,
  depth,
}: {
  node: TreeNode;
  selectedFolderId: string | null;
  onSelect: (id: string | null) => void;
  getFileCount: (id: string) => number;
  hasVideos: (id: string) => boolean;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isActive = selectedFolderId === node.folder.id;
  const count = getFileCount(node.folder.id);
  const showVideo = hasVideos(node.folder.id);

  return (
    <div>
      <div
        className="flex items-center gap-1"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        {/* Expand/collapse */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="shrink-0 p-0.5 hover:bg-muted rounded transition-transform"
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                expanded && "rotate-90"
              )}
            />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}

        {/* Folder button */}
        <Button
          variant={isActive ? "secondary" : "ghost"}
          className="w-full justify-start gap-2 font-normal h-8 text-sm"
          onClick={() => onSelect(isActive ? null : node.folder.id)}
        >
          {isActive ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
          ) : (
            <Folder className="h-4 w-4 shrink-0" />
          )}
          <span className="truncate flex-1 text-left">{node.folder.name}</span>
          {showVideo && (
            <Video className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          {count > 0 && (
            <Badge variant="outline" className="ml-auto text-xs shrink-0">
              {count}
            </Badge>
          )}
        </Button>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.folder.id}
              node={child}
              selectedFolderId={selectedFolderId}
              onSelect={onSelect}
              getFileCount={getFileCount}
              hasVideos={hasVideos}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────

function buildFolderTree(folders: DriveFolder[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const f of folders) {
    map.set(f.id, { folder: f, children: [] });
  }

  for (const f of folders) {
    const node = map.get(f.id)!;
    if (f.parentId && map.has(f.parentId)) {
      map.get(f.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function collectDescendantIds(folders: DriveFolder[], parentId: string): string[] {
  const ids = [parentId];
  const children = folders.filter((f) => f.parentId === parentId);
  for (const child of children) {
    ids.push(...collectDescendantIds(folders, child.id));
  }
  return ids;
}

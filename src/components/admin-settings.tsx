"use client";

// ============================================================
// Admin Settings — "Управление доступом" panel
// Wide dialog (2x normal width) with:
//   1. Folder access toggles (restrict/unrestrict for guests)
//   2. .dmga keyfile generation with password
// ============================================================
import { useState, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { useAppStore } from "@/lib/store";
import type { DriveFolder } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  Folder,
  Lock,
  Unlock,
  Key,
  Download,
  Loader2,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AdminSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Folder tree item ──────────────────────────────────────────

interface FolderNode {
  folder: DriveFolder;
  children: FolderNode[];
  depth: number;
}

function buildFolderTree(folders: DriveFolder[]): FolderNode[] {
  const map = new Map<string, FolderNode>();
  const roots: FolderNode[] = [];

  // Create nodes
  for (const f of folders) {
    map.set(f.id, { folder: f, children: [], depth: 0 });
  }

  // Build hierarchy
  for (const f of folders) {
    const node = map.get(f.id)!;
    if (f.parentId && map.has(f.parentId)) {
      const parent = map.get(f.parentId)!;
      parent.children.push(node);
      node.depth = parent.depth + 1;
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ── Folder Tree Item component ────────────────────────────────

function FolderTreeItem({
  node,
  restrictedIds,
  onToggle,
}: {
  node: FolderNode;
  restrictedIds: Set<string>;
  onToggle: (folderId: string, restricted: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isRestricted = restrictedIds.has(node.folder.id);

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 px-2 hover:bg-muted/50 rounded-md group"
        style={{ paddingLeft: `${node.depth * 24 + 8}px` }}
      >
        {/* Expand/collapse */}
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 p-0.5 hover:bg-muted rounded"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}

        {/* Folder icon */}
        {isRestricted ? (
          <Lock className="h-4 w-4 text-destructive shrink-0" />
        ) : (
          <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        {/* Folder name */}
        <span className="truncate flex-1 text-sm">{node.folder.name}</span>

        {/* Restrict toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">
            {isRestricted ? "Ограничен" : "Открыт"}
          </span>
          <Switch
            checked={isRestricted}
            onCheckedChange={(checked) => onToggle(node.folder.id, checked)}
          />
        </div>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <FolderTreeItem
              key={child.folder.id}
              node={child}
              restrictedIds={restrictedIds}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export function AdminSettings({ open, onOpenChange }: AdminSettingsProps) {
  const { token } = useAuth();
  const folders = useAppStore((s) => s.folders);

  // Folder restrictions state
  const [restrictedIds, setRestrictedIds] = useState<Set<string>>(new Set());
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Keyfile generation state
  const [keyfilePassword, setKeyfilePassword] = useState("");
  const [keyfileConfirm, setKeyfileConfirm] = useState("");
  const [keyfileGenerating, setKeyfileGenerating] = useState(false);
  const [keyfileError, setKeyfileError] = useState("");
  const [keyfileSuccess, setKeyfileSuccess] = useState(false);

  // Build folder tree
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  // Toggle folder restriction
  const handleToggle = useCallback((folderId: string, restricted: boolean) => {
    setRestrictedIds((prev) => {
      const next = new Set(prev);
      if (restricted) {
        next.add(folderId);
      } else {
        next.delete(folderId);
      }
      return next;
    });
    setSaveStatus("idle");
  }, []);

  // Save restrictions to Worker
  const handleSave = useCallback(async () => {
    if (!token) return;
    setSaveStatus("saving");
    try {
      // For now we store restrictions locally since the Worker
      // may not have the /admin/restrictions endpoint yet.
      // In a real implementation, this would call the Worker API.
      localStorage.setItem(
        "dmga_restricted_folders",
        JSON.stringify([...restrictedIds])
      );
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
    }
  }, [token, restrictedIds]);

  // Load saved restrictions on open
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (newOpen) {
        try {
          const saved = localStorage.getItem("dmga_restricted_folders");
          if (saved) {
            const ids: string[] = JSON.parse(saved);
            setRestrictedIds(new Set(ids));
          }
        } catch {
          // ignore
        }
        setKeyfilePassword("");
        setKeyfileConfirm("");
        setKeyfileError("");
        setKeyfileSuccess(false);
      }
      onOpenChange(newOpen);
    },
    [onOpenChange]
  );

  // Generate keyfile
  const handleGenerateKeyfile = useCallback(async () => {
    if (!token) return;
    if (keyfilePassword.length < 4) {
      setKeyfileError("Пароль должен быть не менее 4 символов");
      return;
    }
    if (keyfilePassword !== keyfileConfirm) {
      setKeyfileError("Пароли не совпадают");
      return;
    }

    setKeyfileGenerating(true);
    setKeyfileError("");

    try {
      // Generate keyfile client-side (AES-256-GCM encryption)
      const allowedFolderIds = folders
        .filter((f) => !restrictedIds.has(f.id))
        .map((f) => f.id);

      const encoder = new TextEncoder();
      const passwordData = encoder.encode(keyfilePassword);

      // Derive key using PBKDF2
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        passwordData,
        "PBKDF2",
        false,
        ["deriveKey"]
      );

      const key = await crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt,
          iterations: 100000,
          hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt"]
      );

      // Encrypt the payload
      const payload = {
        v: 4,
        allowed: allowedFolderIds,
        exp: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
      };
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoder.encode(JSON.stringify(payload))
      );

      // Build keyfile
      const keyfile = {
        version: 4,
        allowedFolders: allowedFolderIds,
        exp: payload.exp,
        iv: btoa(String.fromCharCode(...iv)),
        tag: btoa(
          String.fromCharCode(...new Uint8Array(encrypted).slice(-16))
        ),
        salt: btoa(String.fromCharCode(...salt)),
        data: btoa(
          String.fromCharCode(
            ...new Uint8Array(encrypted).slice(0, -16)
          )
        ),
      };

      // Download as .dmga file
      const blob = new Blob([JSON.stringify(keyfile, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gallery-access-${Date.now()}.dmga`;
      a.click();
      URL.revokeObjectURL(url);

      setKeyfileSuccess(true);
      setTimeout(() => setKeyfileSuccess(false), 3000);
    } catch (err) {
      setKeyfileError(
        err instanceof Error ? err.message : "Ошибка генерации ключ-файла"
      );
    } finally {
      setKeyfileGenerating(false);
    }
  }, [token, folders, restrictedIds, keyfilePassword, keyfileConfirm]);

  // Count restricted / open
  const restrictedCount = restrictedIds.size;
  const openCount = folders.length - restrictedCount;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-6xl w-full sm:w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0"
        // Wide dialog: sm:max-w-6xl overrides default sm:max-w-lg (72rem vs 32rem = 2.25x wider)
      >
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle className="flex items-center gap-3 text-xl">
            <Shield className="h-6 w-6 text-primary" />
            Управление доступом
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1">
            Настройте доступ к папкам для гостей и создайте ключ-файлы (.dmga)
          </DialogDescription>
        </DialogHeader>

        <Separator />

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {/* Left: Folder access */}
          <div className="flex-1 flex flex-col min-h-0 border-r">
            <div className="px-6 py-4 shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Доступ к папкам
                </h3>
                <div className="flex gap-2">
                  <Badge variant="outline" className="gap-1">
                    <Unlock className="h-3 w-3" />
                    {openCount} открытых
                  </Badge>
                  <Badge variant="secondary" className="gap-1">
                    <Lock className="h-3 w-3" />
                    {restrictedCount} ограниченных
                  </Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Включите переключатель, чтобы ограничить доступ гостям к папке и
                всем её подпапкам
              </p>
            </div>

            <ScrollArea className="flex-1 px-4 pb-4">
              {folderTree.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Folder className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Папки не найдены</p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {folderTree.map((node) => (
                    <FolderTreeItem
                      key={node.folder.id}
                      node={node}
                      restrictedIds={restrictedIds}
                      onToggle={handleToggle}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* Save button */}
            <div className="px-6 py-3 border-t shrink-0">
              <Button
                onClick={handleSave}
                disabled={saveStatus === "saving"}
                className="w-full gap-2"
              >
                {saveStatus === "saving" && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {saveStatus === "saved" && (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {saveStatus === "error" && (
                  <AlertTriangle className="h-4 w-4" />
                )}
                {saveStatus === "idle" && "Сохранить ограничения"}
                {saveStatus === "saving" && "Сохранение..."}
                {saveStatus === "saved" && "Сохранено!"}
                {saveStatus === "error" && "Ошибка сохранения"}
              </Button>
            </div>
          </div>

          {/* Right: Keyfile generation */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-6 py-4 shrink-0">
              <h3 className="font-semibold flex items-center gap-2 mb-3">
                <Key className="h-4 w-4" />
                Генерация ключ-файла
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Создайте файл .dmga для гостевого доступа. Гость с этим файлом
                сможет просматривать только открытые папки.
              </p>

              {/* Info about current access */}
              <div className="bg-muted/50 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2 text-sm">
                  <Unlock className="h-4 w-4 text-green-500" />
                  <span>
                    Доступно папок: <strong>{openCount}</strong> из{" "}
                    {folders.length}
                  </span>
                </div>
                {restrictedCount > 0 && (
                  <div className="flex items-center gap-2 text-sm mt-1 text-muted-foreground">
                    <Lock className="h-4 w-4 text-destructive" />
                    <span>
                      {restrictedCount} папок будут скрыты от гостя
                    </span>
                  </div>
                )}
              </div>

              {/* Password fields */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="keyfile-pw">Пароль для ключ-файла</Label>
                  <Input
                    id="keyfile-pw"
                    type="password"
                    placeholder="Минимум 4 символа"
                    value={keyfilePassword}
                    onChange={(e) => {
                      setKeyfilePassword(e.target.value);
                      setKeyfileError("");
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="keyfile-pw-confirm">
                    Подтвердите пароль
                  </Label>
                  <Input
                    id="keyfile-pw-confirm"
                    type="password"
                    placeholder="Повторите пароль"
                    value={keyfileConfirm}
                    onChange={(e) => {
                      setKeyfileConfirm(e.target.value);
                      setKeyfileError("");
                    }}
                  />
                </div>
              </div>

              {/* Error */}
              {keyfileError && (
                <div className="flex items-center gap-2 mt-3 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {keyfileError}
                </div>
              )}

              {/* Success */}
              {keyfileSuccess && (
                <div className="flex items-center gap-2 mt-3 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Ключ-файл скачан!
                </div>
              )}
            </div>

            {/* Generate button */}
            <div className="mt-auto px-6 py-3 border-t shrink-0">
              <Button
                onClick={handleGenerateKeyfile}
                disabled={
                  keyfileGenerating ||
                  keyfilePassword.length < 4 ||
                  keyfilePassword !== keyfileConfirm
                }
                className="w-full gap-2"
                variant="outline"
              >
                {keyfileGenerating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {keyfileGenerating
                  ? "Генерация..."
                  : "Скачать ключ-файл (.dmga)"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

// ============================================================
// Admin Panel — manage folder restrictions & generate keyfiles
// Worker does NOT have /admin/restrictions or /admin/keyfile
// endpoints, so we handle everything client-side:
//   - Restrictions stored in localStorage
//   - Keyfile generated client-side with Web Crypto API (AES-256-GCM + PBKDF2)
// ============================================================
import { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ArrowLeft,
  Shield,
  Download,
  Lock,
  Unlock,
  AlertCircle,
  CheckCircle2,
  Loader2,
  FolderOpen,
} from "lucide-react";

const LS_RESTRICTED_KEY = "dmga_restricted_folders";

interface AdminPanelProps {
  onClose: () => void;
}

export function AdminPanel({ onClose }: AdminPanelProps) {
  const { token: adminToken } = useAuth();
  const folders = useAppStore((s) => s.folders);
  const filesByFolder = useAppStore((s) => s.filesByFolder);

  // ── Restrictions state ──
  const [restrictedIds, setRestrictedIds] = useState<Set<string>>(new Set());
  const [originalRestrictedIds, setOriginalRestrictedIds] = useState<Set<string>>(new Set());
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // ── Keyfile state ──
  const [keyfilePassword, setKeyfilePassword] = useState("");
  const [keyfileConfirm, setKeyfileConfirm] = useState("");
  const [generating, setGenerating] = useState(false);
  const [keyfileError, setKeyfileError] = useState("");
  const [keyfileSuccess, setKeyfileSuccess] = useState(false);

  // Load restrictions from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_RESTRICTED_KEY);
      if (saved) {
        const ids: string[] = JSON.parse(saved);
        const set = new Set(ids);
        setRestrictedIds(set);
        setOriginalRestrictedIds(new Set(set));
      }
    } catch {
      // ignore
    }
  }, []);

  // File counts
  const fileCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [id, files] of Object.entries(filesByFolder)) {
      counts[id] = files.length;
    }
    return counts;
  }, [filesByFolder]);

  // Non-restricted folder IDs (for keyfile)
  const nonRestrictedIds = useMemo(() => {
    return new Set(folders.filter((f) => !restrictedIds.has(f.id)).map((f) => f.id));
  }, [folders, restrictedIds]);

  // Whether restrictions have changed
  const hasChanges = useMemo(() => {
    if (restrictedIds.size !== originalRestrictedIds.size) return true;
    for (const id of restrictedIds) {
      if (!originalRestrictedIds.has(id)) return true;
    }
    return false;
  }, [restrictedIds, originalRestrictedIds]);

  // Toggle folder restriction
  const toggleRestricted = (folderId: string) => {
    setRestrictedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
    setSaveStatus("idle");
  };

  // Save restrictions to localStorage
  const handleSaveRestrictions = async () => {
    setSaveStatus("saving");
    try {
      localStorage.setItem(LS_RESTRICTED_KEY, JSON.stringify([...restrictedIds]));
      setOriginalRestrictedIds(new Set(restrictedIds));
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
    }
  };

  // Generate keyfile client-side (AES-256-GCM + PBKDF2 encryption)
  const handleGenerateKeyfile = async () => {
    if (keyfilePassword.length < 4) {
      setKeyfileError("Пароль должен быть не менее 4 символов");
      return;
    }
    if (keyfilePassword !== keyfileConfirm) {
      setKeyfileError("Пароли не совпадают");
      return;
    }

    const allowedFolderIds = folders
      .filter((f) => !restrictedIds.has(f.id))
      .map((f) => f.id);

    if (allowedFolderIds.length === 0) {
      setKeyfileError("Нет папок для доступа — снимите ограничения хотя бы с одной папки");
      return;
    }

    setGenerating(true);
    setKeyfileError("");

    try {
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

      // Encrypt the payload — include admin JWT so the keyfile is portable
      // (guest can authenticate with Worker from any device, not just ones
      // where admin previously logged in)
      const payload = {
        v: 4,
        allowed: allowedFolderIds,
        exp: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
        jwt: adminToken || "", // embed admin JWT for Worker API access
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
        hasJwt: !!adminToken, // flag so guest login knows a JWT is inside
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
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b">
        <div className="flex items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="font-semibold text-lg">Администрирование</h1>
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-8">
        {/* ── Folder Restrictions ── */}
        <section>
          <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Доступ к папкам
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Отметьте папки, доступ к которым должен быть ограничен. Ограниченные
            папки не будут видны гостям. При генерации ключа доступа в него
            автоматически попадут все папки без ограничения.
          </p>

          {/* Summary */}
          <div className="flex items-center gap-4 mb-4 text-sm">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <FolderOpen className="h-4 w-4" />
              <span>
                Открыто: <strong>{nonRestrictedIds.size}</strong>
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Lock className="h-4 w-4" />
              <span>
                Ограничено: <strong>{restrictedIds.size}</strong>
              </span>
            </div>
          </div>

          {folders.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              Папки не найдены. Сначала загрузите данные галереи.
            </div>
          ) : (
            <div className="space-y-2 mb-4">
              {folders.map((folder) => {
                const isRestricted = restrictedIds.has(folder.id);
                const count = fileCounts[folder.id] || 0;

                return (
                  <div
                    key={folder.id}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors select-none ${
                      isRestricted
                        ? "border-destructive/50 bg-destructive/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                    onClick={() => toggleRestricted(folder.id)}
                  >
                    <div className="flex items-center gap-3">
                      {isRestricted ? (
                        <Lock className="h-4 w-4 text-destructive shrink-0" />
                      ) : (
                        <Unlock className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="font-medium">{folder.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {count} файл.
                      </Badge>
                    </div>
                    {/* Toggle switch */}
                    <div
                      className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${
                        isRestricted ? "bg-destructive" : "bg-primary"
                      }`}
                    >
                      <div
                        className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${
                          isRestricted ? "translate-x-5" : "translate-x-1"
                        }`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              onClick={handleSaveRestrictions}
              disabled={saveStatus === "saving" || !hasChanges}
            >
              {saveStatus === "saving" && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              {saveStatus === "saved" && (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              {saveStatus === "idle" && "Сохранить ограничения"}
              {saveStatus === "saving" && "Сохранение..."}
              {saveStatus === "saved" && "Сохранено!"}
              {saveStatus === "error" && "Ошибка сохранения"}
            </Button>
            {hasChanges && saveStatus === "idle" && (
              <span className="text-xs text-muted-foreground">
                Есть несохранённые изменения
              </span>
            )}
          </div>
        </section>

        {/* ── Generate Keyfile ── */}
        <section>
          <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <Download className="h-5 w-5" />
            Генерация ключа доступа (.dmga)
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Создайте файл ключа для гостевого доступа. Гость с этим ключом сможет
            видеть все папки без ограничения
            {nonRestrictedIds.size > 0 && (
              <span className="text-primary font-medium">
                {" "}({nonRestrictedIds.size}{" "}
                {nonRestrictedIds.size === 1
                  ? "папка"
                  : nonRestrictedIds.size < 5
                  ? "папки"
                  : "папок"}
                )
              </span>
            )}
            . Передайте гостю .dmga файл и пароль.
          </p>

          {nonRestrictedIds.size === 0 && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Все папки ограничены — ключ не даст гостю доступа ни к одной папке.
                Снимите ограничения хотя бы с одной папки.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-4 mb-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Пароль для ключа
              </label>
              <Input
                type="password"
                placeholder="Придумайте пароль для ключа (мин. 4 символа)"
                value={keyfilePassword}
                onChange={(e) => {
                  setKeyfilePassword(e.target.value);
                  setKeyfileError("");
                  setKeyfileSuccess(false);
                }}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Подтвердите пароль
              </label>
              <Input
                type="password"
                placeholder="Повторите пароль"
                value={keyfileConfirm}
                onChange={(e) => {
                  setKeyfileConfirm(e.target.value);
                  setKeyfileError("");
                  setKeyfileSuccess(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && handleGenerateKeyfile()}
              />
            </div>
          </div>

          {/* Error */}
          {keyfileError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{keyfileError}</AlertDescription>
            </Alert>
          )}

          {/* Success */}
          {keyfileSuccess && (
            <Alert className="mb-4">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Ключ-файл скачан! Передайте файл и пароль гостю.
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleGenerateKeyfile}
            disabled={
              generating ||
              keyfilePassword.length < 4 ||
              keyfilePassword !== keyfileConfirm ||
              nonRestrictedIds.size === 0
            }
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Генерация...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Скачать ключ-файл (.dmga)
              </>
            )}
          </Button>
        </section>
      </main>
    </div>
  );
}

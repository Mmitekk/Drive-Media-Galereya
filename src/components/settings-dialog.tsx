"use client";

// ============================================================
// Settings Dialog — Admin-only: manage folders & generate key-files
// ============================================================

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { generateGuestKeyFile } from "@/lib/worker-api";
import { clearSession } from "@/lib/access-control";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Settings,
  Shield,
  Download,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  FolderLock,
  LogOut,
  Key,
} from "lucide-react";

export function SettingsDialog() {
  const folders = useAppStore((s) => s.folders);
  const role = useAppStore((s) => s.role);
  const jwt = useAppStore((s) => s.jwt);
  const clearStoreSession = useAppStore((s) => s.clearSession);
  const [open, setOpen] = useState(false);

  // Folder restrictions
  const [selectedAdminFolders, setSelectedAdminFolders] = useState<string[]>([]);

  // Key-file generation
  const [guestPassword, setGuestPassword] = useState("");
  const [showGuestPwd, setShowGuestPwd] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");

  // Only admin can access settings
  if (role !== "admin") return null;

  const toggleAdminFolder = (folderId: string) => {
    setSelectedAdminFolders((prev) =>
      prev.includes(folderId)
        ? prev.filter((id) => id !== folderId)
        : [...prev, folderId]
    );
    setMessage("");
  };

  const handleGenerateKeyFile = async () => {
    if (!jwt) return;

    if (!guestPassword || guestPassword.length < 4) {
      setMessage("Пароль должен быть не менее 4 символов");
      return;
    }

    setGenerating(true);
    setMessage("");

    try {
      // Worker генерирует зашифрованный ключ-файл на сервере
      const encryptedKeyFile = await generateGuestKeyFile(
        jwt,
        guestPassword,
        selectedAdminFolders
      );

      // Скачиваем файл
      const blob = new Blob([encryptedKeyFile], {
        type: "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "gallery-guest.dmga";
      a.click();
      URL.revokeObjectURL(url);

      setMessage(
        "Ключ-файл для гостя создан. Отправьте файл и пароль ПО РАЗНЫМ каналам!"
      );
      setGuestPassword("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Ошибка создания ключ-файла");
    } finally {
      setGenerating(false);
    }
  };

  const handleLogout = async () => {
    await clearSession();
    clearStoreSession();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="ml-1">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Настройки
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Role indicator */}
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <span className="text-sm">Роль:</span>
            <Badge variant="default">Администратор</Badge>
          </div>

          <Separator />

          {/* Folder restrictions */}
          <div className="space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <FolderLock className="h-4 w-4" />
              Доступ к контенту
            </h3>
            <p className="text-sm text-muted-foreground">
              Выберите папки, которые будут видны только вам.
              Гости не увидят эти папки в галерее.
            </p>

            {folders.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                Папки ещё не загружены
              </p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto border rounded-lg p-3">
                {folders.map((folder) => (
                  <label
                    key={folder.id}
                    className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-muted cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedAdminFolders.includes(folder.id)}
                      onCheckedChange={() => toggleAdminFolder(folder.id)}
                    />
                    <span className="text-sm flex-1">{folder.name}</span>
                    {selectedAdminFolders.includes(folder.id) && (
                      <Badge variant="outline" className="text-xs">
                        Только админ
                      </Badge>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Key-file generation */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Key className="h-4 w-4" />
              Гостевой ключ-файл
            </h3>
            <p className="text-sm text-muted-foreground">
              Создайте зашифрованный ключ-файл для гостей.
              Гости увидят все папки, кроме отмеченных выше.
            </p>

            <Alert>
              <Lock className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Отправляйте ключ-файл и пароль <strong>по разным каналам</strong>!
                Файл — по ссылке, пароль — в мессенджере.
              </AlertDescription>
            </Alert>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type={showGuestPwd ? "text" : "password"}
                  placeholder="Пароль для шифрования"
                  value={guestPassword}
                  onChange={(e) => {
                    setGuestPassword(e.target.value);
                    setMessage("");
                  }}
                  className="pl-10 pr-9"
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowGuestPwd(!showGuestPwd)}
                >
                  {showGuestPwd ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <Button
                size="sm"
                onClick={handleGenerateKeyFile}
                disabled={generating || !guestPassword || guestPassword.length < 4}
                className="gap-2"
              >
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Скачать
              </Button>
            </div>

            {message && (
              <Alert>
                <AlertDescription className="text-sm">{message}</AlertDescription>
              </Alert>
            )}
          </div>

          <Separator />

          {/* Logout */}
          <Button
            variant="destructive"
            size="sm"
            onClick={handleLogout}
            className="w-full gap-2"
          >
            <LogOut className="h-4 w-4" />
            Выйти
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

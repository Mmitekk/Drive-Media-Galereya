"use client";

// ============================================================
// Main page — Google Drive Media Gallery
// Flow:
// 1. If no config → SetupGuide
// 2. If Worker mode & not authenticated → Login screen
// 3. If authenticated or direct API → Gallery
// ============================================================
import { useMemo, useState, useRef } from "react";
import { isConfigured, isWorkerMode } from "@/lib/config";
import { useAppStore } from "@/lib/store";
import { useDataLoader } from "@/hooks/use-data-loader";
import { useAuth } from "@/lib/auth-context";
import { SetupGuide } from "@/components/setup-guide";
import { FolderNav } from "@/components/folder-nav";
import { SearchFilter } from "@/components/search-filter";
import { MediaGallery } from "@/components/media-gallery";
import { AdminPanel } from "@/components/admin-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Folder,
  RefreshCw,
  Menu,
  HardDrive,
  AlertCircle,
  Lock,
  Upload,
  LogOut,
  Settings,
} from "lucide-react";
import type { KeyfilePayload } from "@/lib/worker-api";
import { getWorkerToken } from "@/lib/auth-context";

export default function Home() {
  if (!isConfigured()) {
    return <SetupGuide />;
  }

  if (isWorkerMode()) {
    return <AuthGate />;
  }

  return <GalleryApp />;
}

// ============================================================
// Auth gate — shown when Worker is configured but user is not
// yet authenticated
// ============================================================
function AuthGate() {
  const { role, token, initialized, loginAdmin, loginGuest } = useAuth();
  const [mode, setMode] = useState<"choose" | "admin" | "guest">("choose");
  const [password, setPassword] = useState("");
  const [keyfilePassword, setKeyfilePassword] = useState("");
  const [keyfileData, setKeyfileData] = useState<KeyfilePayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (role && token) {
    return <GalleryApp />;
  }

  const handleAdminLogin = async () => {
    setError("");
    setBusy(true);
    try {
      await loginAdmin(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setBusy(false);
    }
  };

  const handleKeyfileLogin = async () => {
    if (!keyfileData) {
      setError("Сначала загрузите .dmga файл");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await loginGuest(keyfileData, keyfilePassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setBusy(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data.version && data.allowedFolders && data.iv && data.salt) {
          setKeyfileData(data);
          setError("");
        } else {
          setError("Неверный формат .dmga файла");
        }
      } catch {
        setError("Не удалось прочитать .dmga файл");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <HardDrive className="h-12 w-12 mx-auto text-primary mb-3" />
          <h1 className="text-2xl font-bold">Медиа Галерея</h1>
          <p className="text-muted-foreground mt-1">Войдите для доступа к контенту</p>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {mode === "choose" && (
          <div className="space-y-3">
            <Button className="w-full gap-2" onClick={() => setMode("admin")}>
              <Lock className="h-4 w-4" />
              Вход для администратора
            </Button>
            <Button variant="outline" className="w-full gap-2" onClick={() => setMode("guest")}>
              <Upload className="h-4 w-4" />
              Вход по ключу (.dmga)
            </Button>
          </div>
        )}

        {mode === "admin" && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Пароль администратора</label>
              <Input
                type="password"
                placeholder="Введите пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
              />
            </div>
            <Button className="w-full gap-2" onClick={handleAdminLogin} disabled={busy}>
              <Lock className="h-4 w-4" />
              {busy ? "Вход..." : "Войти"}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setMode("choose")}>
              Назад
            </Button>
          </div>
        )}

        {mode === "guest" && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Файл ключа (.dmga)</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".dmga"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                {keyfileData ? "Файл загружен ✓" : "Выбрать .dmga файл"}
              </Button>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Пароль ключа</label>
              <Input
                type="password"
                placeholder="Введите пароль ключа"
                value={keyfilePassword}
                onChange={(e) => setKeyfilePassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleKeyfileLogin()}
              />
            </div>
            <Button className="w-full gap-2" onClick={handleKeyfileLogin} disabled={busy}>
              <Upload className="h-4 w-4" />
              {busy ? "Вход..." : "Войти по ключу"}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setMode("choose")}>
              Назад
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Gallery app — shown after auth (or in direct mode)
// ============================================================
function GalleryApp() {
  const { token, role, logout } = useAuth();
  const { reload, loading, initialized } = useDataLoader();
  const folders = useAppStore((s) => s.folders);
  const filesByFolder = useAppStore((s) => s.filesByFolder);
  const error = useAppStore((s) => s.error);
  const selectedFolderId = useAppStore((s) => s.selectedFolderId);
  const selectFolder = useAppStore((s) => s.selectFolder);
  const [showAdmin, setShowAdmin] = useState(false);

  const fileCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [id, files] of Object.entries(filesByFolder)) {
      counts[id] = files.length;
    }
    return counts;
  }, [filesByFolder]);

  // Reactive total file count (can't use getAllFiles in useMemo — it's a stable ref)
  const totalFiles = useAppStore((s) => Object.values(s.filesByFolder).flat().length);
  const selectedFolder = folders.find((f) => f.id === selectedFolderId);

  // Show admin panel
  if (showAdmin && role === "admin") {
    return <AdminPanel onClose={() => setShowAdmin(false)} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b">
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Mobile sidebar toggle */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="px-4 pt-4 pb-2 text-lg font-semibold flex items-center gap-2">
                <HardDrive className="h-5 w-5" />
                Папки
              </SheetTitle>
              <FolderNav
                folders={folders}
                fileCounts={fileCounts}
                className="h-[calc(100vh-4rem)]"
              />
            </SheetContent>
          </Sheet>

          {/* Logo / Title */}
          <div className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-primary hidden sm:block" />
            <h1 className="font-semibold text-lg">
              {selectedFolder ? selectedFolder.name : "Медиа Галерея"}
            </h1>
          </div>

          {/* Stats */}
          <div className="hidden sm:flex items-center gap-3 text-sm text-muted-foreground ml-2">
            <span>{totalFiles} файлов</span>
            <span>·</span>
            <span>{folders.length} папок</span>
            {role === "guest" && (
              <>
                <span>·</span>
                <span className="text-primary">Гостевой доступ</span>
              </>
            )}
          </div>

          {/* Right side buttons */}
          <div className="ml-auto flex items-center gap-1">
            {/* Admin panel (admin only) */}
            {isWorkerMode() && role === "admin" && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowAdmin(true)}
                title="Администрирование"
              >
                <Settings className="h-4 w-4" />
              </Button>
            )}
            {/* Logout (Worker mode only) */}
            {isWorkerMode() && role && (
              <Button variant="ghost" size="icon" onClick={logout} title="Выйти">
                <LogOut className="h-4 w-4" />
              </Button>
            )}
            {/* Reload */}
            <Button
              variant="ghost"
              size="icon"
              onClick={reload}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-64 border-r bg-background">
          <div className="p-3">
            <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2 px-2">
              <Folder className="h-4 w-4" />
              Папки
            </h2>
          </div>
          <FolderNav
            folders={folders}
            fileCounts={fileCounts}
            className="h-[calc(100vh-5rem)]"
          />
        </aside>

        {/* Main content */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1600px] mx-auto w-full">
          {/* Error — show as warning when we have cached data, blocking only when no data */}
          {error && (
            <Alert variant={initialized ? "default" : "destructive"} className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between">
                <span>{error}</span>
                <Button variant="outline" size="sm" onClick={reload}>
                  Повторить
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Search & Filter */}
          {initialized && (
            <SearchFilter className="mb-6" />
          )}

          {/* Loading skeleton */}
          {loading && !initialized && (
            <div className="space-y-4">
              <div className="flex gap-3 overflow-x-hidden">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="shrink-0 w-28 h-48 rounded-2xl" />
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-[4/3] rounded-xl" />
                ))}
              </div>
            </div>
          )}

          {/* Gallery — always show when initialized, even if there's an error (cached data) */}
          {initialized && <MediaGallery />}
        </main>
      </div>
    </div>
  );
}

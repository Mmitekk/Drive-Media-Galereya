"use client";

// ============================================================
// Access Screen — Admin password login + Guest key-file login
// ============================================================

import { useState, useCallback, useRef } from "react";
import { adminLogin, guestLogin } from "@/lib/worker-api";
import { saveSession } from "@/lib/access-control";
import { useAppStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Key,
  Upload,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  HardDrive,
  Shield,
  User,
} from "lucide-react";

export function AccessScreen() {
  const [tab, setTab] = useState<"admin" | "guest">("admin");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Admin fields
  const [adminPassword, setAdminPassword] = useState("");
  const [showAdminPwd, setShowAdminPwd] = useState(false);

  // Guest fields
  const [guestPassword, setGuestPassword] = useState("");
  const [showGuestPwd, setShowGuestPwd] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileContentRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setSession = useAppStore((s) => s.setSession);
  const setSessionLoaded = useAppStore((s) => s.setSessionLoaded);

  // ── Admin login ──
  const handleAdminLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");

      if (!adminPassword.trim()) {
        setError("Введите пароль администратора");
        return;
      }

      setLoading(true);
      try {
        const result = await adminLogin(adminPassword);
        await saveSession({
          jwt: result.token,
          role: result.role,
          adminFolders: result.adminFolders || [],
        });
        setSession(result.token, result.role, result.adminFolders || []);
        setSessionLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка авторизации");
      } finally {
        setLoading(false);
      }
    },
    [adminPassword, setSession, setSessionLoaded]
  );

  // ── Guest login ──
  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      fileContentRef.current = reader.result as string;
      setFileName(file.name);
      setError("");
    };
    reader.onerror = () => setError("Не удалось прочитать файл");
    reader.readAsText(file);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleGuestLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");

      if (!fileContentRef.current) {
        setError("Выберите файл ключа (.dmga)");
        return;
      }
      if (!guestPassword.trim()) {
        setError("Введите пароль");
        return;
      }

      setLoading(true);
      try {
        const result = await guestLogin(fileContentRef.current, guestPassword);
        await saveSession({
          jwt: result.token,
          role: result.role,
          adminFolders: result.adminFolders || [],
        });
        setSession(result.token, result.role, result.adminFolders || []);
        setSessionLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка авторизации");
      } finally {
        setLoading(false);
      }
    },
    [guestPassword, setSession, setSessionLoaded]
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <HardDrive className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Медиа Галерея</CardTitle>
        </CardHeader>

        <CardContent>
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as "admin" | "guest");
              setError("");
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="admin" className="gap-2">
                <Shield className="h-4 w-4" />
                Админ
              </TabsTrigger>
              <TabsTrigger value="guest" className="gap-2">
                <User className="h-4 w-4" />
                Гость
              </TabsTrigger>
            </TabsList>

            {/* Admin tab */}
            <TabsContent value="admin">
              <form onSubmit={handleAdminLogin} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="admin-pwd" className="text-sm font-medium">
                    Пароль администратора
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="admin-pwd"
                      type={showAdminPwd ? "text" : "password"}
                      placeholder="Введите пароль"
                      value={adminPassword}
                      onChange={(e) => {
                        setAdminPassword(e.target.value);
                        setError("");
                      }}
                      className="pl-10 pr-10"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowAdminPwd(!showAdminPwd)}
                    >
                      {showAdminPwd ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading || !adminPassword.trim()}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Вход...
                    </>
                  ) : (
                    <>
                      <Shield className="h-4 w-4 mr-2" />
                      Войти как админ
                    </>
                  )}
                </Button>
              </form>
            </TabsContent>

            {/* Guest tab */}
            <TabsContent value="guest">
              <form onSubmit={handleGuestLogin} className="space-y-4 mt-4">
                {/* File drop zone */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Ключ-файл (.dmga)
                  </Label>
                  <div
                    className={`
                      relative border-2 border-dashed rounded-xl p-5 text-center cursor-pointer
                      transition-colors
                      ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"}
                      ${fileName ? "border-primary bg-primary/5" : ""}
                    `}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".dmga"
                      onChange={handleFileInput}
                      className="hidden"
                    />
                    {fileName ? (
                      <div className="flex items-center justify-center gap-2">
                        <Key className="h-5 w-5 text-primary" />
                        <span className="text-sm font-medium">{fileName}</span>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Upload className="h-6 w-6 mx-auto text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">
                          Перетащите файл или нажмите
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-2">
                  <Label htmlFor="guest-pwd" className="text-sm font-medium">
                    Пароль
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="guest-pwd"
                      type={showGuestPwd ? "text" : "password"}
                      placeholder="Введите пароль"
                      value={guestPassword}
                      onChange={(e) => {
                        setGuestPassword(e.target.value);
                        setError("");
                      }}
                      className="pl-10 pr-10"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowGuestPwd(!showGuestPwd)}
                    >
                      {showGuestPwd ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading || !fileContentRef.current || !guestPassword.trim()}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Вход...
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4 mr-2" />
                      Войти как гость
                    </>
                  )}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

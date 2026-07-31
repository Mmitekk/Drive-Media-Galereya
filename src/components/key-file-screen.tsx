"use client";

// ============================================================
// Key-file / Login screen — admin password OR guest key-file
// ============================================================
import { useState, useRef } from "react";
import { useAppStore } from "@/lib/store";
import { adminLogin, guestLogin } from "@/lib/worker-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { HardDrive, Key, Upload, Eye, EyeOff, Loader2 } from "lucide-react";

export function KeyFileScreen() {
  const setSession = useAppStore((s) => s.setSession);
  const [tab, setTab] = useState("admin");

  // Admin state
  const [adminPassword, setAdminPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Guest state
  const [guestPassword, setGuestPassword] = useState("");
  const [keyFileContent, setKeyFileContent] = useState<string | null>(null);
  const [keyFileName, setKeyFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Shared state
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAdminLogin = async () => {
    if (!adminPassword.trim()) {
      setError("Введите пароль");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await adminLogin(adminPassword);
      setSession(result.token, result.role, result.adminFolders || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка авторизации");
    } finally {
      setLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    if (!keyFileContent) {
      setError("Загрузите ключ-файл (.dmga)");
      return;
    }
    if (!guestPassword.trim()) {
      setError("Введите пароль от ключ-файла");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await guestLogin(keyFileContent, guestPassword);
      setSession(result.token, result.role, result.adminFolders || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка авторизации");
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setKeyFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setKeyFileContent(reader.result as string);
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <HardDrive className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl">Медиа Галерея</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Войдите для доступа к контенту
          </p>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={(v) => { setTab(v); setError(""); }}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="admin" className="gap-2">
                <Key className="h-4 w-4" />
                Админ
              </TabsTrigger>
              <TabsTrigger value="guest" className="gap-2">
                <Upload className="h-4 w-4" />
                Гость
              </TabsTrigger>
            </TabsList>

            <TabsContent value="admin" className="space-y-4 mt-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Пароль администратора</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Введите пароль..."
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <Button
                className="w-full"
                onClick={handleAdminLogin}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Войти
              </Button>
            </TabsContent>

            <TabsContent value="guest" className="space-y-4 mt-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Ключ-файл (.dmga)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".dmga"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button
                  variant="outline"
                  className="w-full justify-start text-muted-foreground"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {keyFileName || "Выбрать файл..."}
                </Button>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Пароль от ключ-файла</label>
                <Input
                  type="password"
                  placeholder="Введите пароль..."
                  value={guestPassword}
                  onChange={(e) => setGuestPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleGuestLogin()}
                />
              </div>
              <Button
                className="w-full"
                onClick={handleGuestLogin}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Войти
              </Button>
            </TabsContent>
          </Tabs>

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

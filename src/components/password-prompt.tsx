"use client";

// ============================================================
// Password prompt dialog — shown when accessing a protected folder
// ============================================================
import { useState } from "react";
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
import { Lock, Eye, EyeOff } from "lucide-react";

interface PasswordPromptProps {
  open: boolean;
  folderName: string;
  onCorrect: () => void;
  onCancel: () => void;
  checkPassword: (password: string) => boolean;
}

export function PasswordPrompt({
  open,
  folderName,
  onCorrect,
  onCancel,
  checkPassword,
}: PasswordPromptProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (checkPassword(password)) {
      setError(false);
      setPassword("");
      onCorrect();
    } else {
      setError(true);
    }
  };

  const handleCancel = () => {
    setPassword("");
    setError(false);
    onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleCancel()}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Закрытый раздел
          </DialogTitle>
          <DialogDescription>
            Папка «{folderName}» защищена паролем. Введите пароль для доступа.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="folder-password">Пароль</Label>
            <div className="relative">
              <Input
                id="folder-password"
                type={showPassword ? "text" : "password"}
                placeholder="Введите пароль..."
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(false);
                }}
                autoFocus
                className={error ? "border-red-500 focus-visible:ring-red-500" : ""}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {error && (
              <p className="text-sm text-red-500">Неверный пароль. Попробуйте снова.</p>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={handleCancel}>
              Отмена
            </Button>
            <Button type="submit" disabled={!password}>
              Войти
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

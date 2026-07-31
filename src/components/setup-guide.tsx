"use client";

// ============================================================
// Setup Guide — shown when neither API keys nor Worker URL set
// ============================================================
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

export function SetupGuide() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-2xl">🎬 Google Drive Media Gallery</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Для работы приложения нужен API-ключ Google Drive и ID корневой папки,
              либо URL Cloudflare Worker. Настройте через переменные окружения.
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Вариант 1: Прямой доступ к Google Drive</h3>

            <h4 className="font-medium">Шаг 1: Получите API-ключ</h4>
            <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
              <li>Откройте <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" className="text-primary underline">Google Cloud Console</a></li>
              <li>Создайте проект (или выберите существующий)</li>
              <li>Включите <strong>Google Drive API</strong> (APIs & Services → Library)</li>
              <li>Перейдите в <strong>Credentials</strong> → Create API Key</li>
              <li>Ограничьте ключ только для Google Drive API</li>
            </ol>

            <h4 className="font-medium">Шаг 2: Получите ID папки</h4>
            <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
              <li>Откройте нужную папку в Google Drive</li>
              <li>URL выглядит так: <code className="bg-muted px-1.5 py-0.5 rounded text-sm">https://drive.google.com/drive/folders/<strong>1aBc...xYz</strong></code></li>
              <li>Последняя часть — это ID папки</li>
              <li>Убедитесь, что папка доступна: ПКМ → Настроить доступ → «Все, у кого есть ссылка»</li>
            </ol>

            <h4 className="font-medium">Шаг 3: Настройте переменные окружения</h4>
            <p className="text-muted-foreground">
              Добавьте в файл <code className="bg-muted px-1.5 py-0.5 rounded text-sm">.env</code>:
            </p>
            <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">
{`NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY=AIzaSy...
NEXT_PUBLIC_GOOGLE_DRIVE_ROOT_FOLDER_ID=1aBc...xYz`}
            </pre>

            <h3 className="font-semibold text-lg mt-6">Вариант 2: Через Cloudflare Worker</h3>
            <p className="text-muted-foreground">
              Если Worker уже настроен, достаточно указать его URL:
            </p>
            <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">
{`NEXT_PUBLIC_WORKER_URL=https://your-worker.workers.dev`}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              Worker должен иметь эндпоинты: /folders, /files/&#123;id&#125;, /media/&#123;id&#125;, /auth/admin, /auth/keyfile
            </p>

            <h3 className="font-semibold text-lg mt-6">После настройки</h3>
            <p className="text-muted-foreground">
              Пересоберите проект. Переменные <code className="bg-muted px-1.5 py-0.5 rounded text-sm">NEXT_PUBLIC_*</code>
              встраиваются в билд на этапе сборки.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

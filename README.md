# Drive Media Gallery (DMGA)

Медиа-галерея для Google Drive с аутентификацией, Instagram-подобными Сторис, вложенными папками и управлением доступом.

**Live:** [mmitekk.github.io/Drive-Media-Galereya](https://mmitekk.github.io/Drive-Media-Galereya)

---

## Архитектура

```
┌──────────────┐      ┌─────────────────────────┐      ┌──────────────┐
│  Пользователь │─────▶│  GitHub Pages (Static)   │─────▶│  Cloudflare  │
│  (Браузер)    │◀─────│  Next.js export (/docs)  │◀─────│   Worker     │
└──────────────┘      └─────────────────────────┘      └──────┬───────┘
                                                               │
                                                               ▼
                                                        ┌──────────────┐
                                                        │ Google Drive │
                                                        │    API       │
                                                        └──────────────┘
```

**Два режима работы:**

| Режим | Переменные | Описание |
|-------|-----------|----------|
| **Worker** (основной) | `NEXT_PUBLIC_WORKER_URL` | Все запросы через Cloudflare Worker с JWT-авторизацией |
| **Direct** (фоллбэк) | `NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY` + `NEXT_PUBLIC_GOOGLE_DRIVE_ROOT_FOLDER_ID` | Прямой доступ к Google Drive API без авторизации |

---

## Стек технологий

| Слой | Технология |
|------|-----------|
| Фреймворк | Next.js 16 (`output: 'export'` — статический сайт) |
| UI | React 19, Tailwind CSS 4, shadcn/ui, Lucide Icons |
| Состояние | Zustand 5 (глобальный store) |
| Авторизация | JWT через Cloudflare Worker, .dmga ключи (AES-256-GCM + PBKDF2) |
| Хостинг | GitHub Pages из папки `/docs` на ветке `main` |
| API-прокси | Cloudflare Worker (`dmga-api.galinakostrik2023.workers.dev`) |

---

## Структура проекта

```
src/
├── app/
│   ├── layout.tsx          # AuthProvider + favicon
│   └── page.tsx            # AuthGate + GalleryApp (основная страница)
├── components/
│   ├── admin-panel.tsx     # Панель администратора (единый список папок: toggle ограничения + автогенерация ключа)
│   ├── folder-nav.tsx      # Дерево папок с раскрытием/сворачиванием
│   ├── image-lightbox.tsx  # Полноэкранный просмотр изображений
│   ├── media-card.tsx      # Карточка медиа (превью + hover-эффекты)
│   ├── media-gallery.tsx   # Галерея: ряд Сторис + сетка + просмотрщики
│   ├── search-filter.tsx   # Поиск, фильтр по типу, сортировка
│   ├── setup-guide.tsx     # Инструкция по настройке (если не сконфигурирован)
│   ├── story-player.tsx    # Instagram-подобный плеер очереди видео
│   └── ui/                 # shadcn/ui компоненты
├── hooks/
│   ├── use-data-loader.ts  # Загрузка папок и файлов (Worker + Direct)
│   ├── use-mobile.ts       # Определение мобильного устройства
│   └── use-toast.ts        # Toast-уведомления
└── lib/
    ├── auth-context.tsx    # React Context: admin/guest авторизация, JWT
    ├── config.ts           # Конфигурация (Worker URL, API key, режимы)
    ├── db.ts               # Prisma (не используется в текущей версии)
    ├── google-drive.ts     # Прямой клиент Google Drive API
    ├── store.ts            # Zustand store (папки, файлы, фильтры, сортировка)
    ├── types.ts            # TypeScript типы (DriveFile, DriveFolder, AppState)
    ├── utils.ts            # cn() утилита
    └── worker-api.ts       # Клиент Cloudflare Worker API
```

---

## Функционал

### Авторизация (Worker-режим)

Два типа входа:

1. **Администратор** — вход по паролю, полный доступ + панель управления
2. **Гость** — вход по `.dmga` ключу + пароль, доступ только к разрешённым папкам

JWT-токен сохраняется в `localStorage` (`dmga_token`, `dmga_role`), передаётся с каждым запросом к Worker.

### Дерево папок (сайдбар)

- **Вложенная иерархия** — все папки загружаются рекурсивно, включая подпапки любого уровня
- **Раскрытие/сворачивание** — кнопка ▶/▼ для каждой папки с дочерними
- **Бейджи** — количество файлов (включая файлы из подпапок-потомков)
- **Значок видео** — иконка 📹 рядом с папками, содержащими видео
- **Выбор папки** — показывает файлы из выбранной папки + всех её подпапок

### Ряд Сторис

Наверху галереи — горизонтальный ряд кружков с видео:

- **Корневые папки** — кружки 68px с градиентом фиолет→роз→оранж
- **Подпапки** — кружки 58px с градиентом синий→голуб→бирюзовый
- **Кнопка «Смотреть все»** — запускает видео из всех папок подряд
- Адаптируется к текущей выбранной папке (показывает её + подпапки)

### StoryPlayer (Instagram-стиль)

Полноэкранный последовательный просмотр видео:

| Управление | Действие |
|-----------|----------|
| Тап слева | Предыдущее видео |
| Тап по центру | Пауза / Воспроизведение |
| Тап справа | Следующее видео |
| Свайп влево/вправо | Переключение видео (мобильные) |
| Клик на полоску прогресса | Перейти к конкретному видео (как в Instagram) |
| Пробел | Пауза / Воспроизведение |
| ← → | Предыдущее / Следующее |
| M | Вкл/Выкл звук |
| Escape | Закрыть |

Особенности:
- Полоски прогресса кликабельны — тап переключает на нужное видео
- `requestAnimationFrame` синхронизирует прогресс с `video.currentTime`
- Автопереключение на следующее видео через `onEnded`
- Видео стартуют без звука (muted) для совместимости с autoplay-политиками
- Загрузочный спиннер, обработка ошибок воспроизведения
- Poster-кадр из Google Drive thumbnail

### Галерея (сетка)

- Адаптивная сетка: 2–5 колонок
- Карточки с превью через Google Drive thumbnail (без авторизации)
- Большая кнопка Play по центру видео-карточек при наведении
- Значок видео, бейдж длительности
- Информация при наведении: имя файла, дата, папка

### Просмотр изображений

- Полноэкранный лайтбокс через Worker-прокси
- Навигация: ← →, кнопки, клавиатура
- Кнопка скачивания

### Панель администратора

Доступна только для роли `admin`. Единый список папок с переключателем доступа:

1. **Управление доступом к папкам** — одна секция с переключателем (toggle) для каждой папки:
   - 🔓 Открыта — папка видна всем (админу и гостям)
   - 🔒 Ограничена — папка видна только администратору
   - Текущие ограничения загружаются из Worker при открытии панели (поле `restricted` в ответе `/folders`)
   - Кнопка сохранения активна только при наличии несохранённых изменений
   - Индикаторы: количество открытых / ограниченных папок

2. **Генерация .dmga ключей** — ключ автоматически включает все **открытые** (неограниченные) папки:
   - Не нужно вручную выбирать папки для ключа — достаточно снять ограничения с нужных
   - Пароль минимум 4 символа
   - Предупреждение если все папки ограничены (ключ не даст доступа)
   - После генерации — скачивание .dmga файла для передачи гостю

---

## Cloudflare Worker API

**Base URL:** `https://dmga-api.galinakostrik2023.workers.dev`

### Эндпоинты

| Метод | Путь | Описание | Auth |
|-------|------|----------|------|
| `GET` | `/health` | Проверка состояния Worker | Нет |
| `POST` | `/auth/admin` | Вход администратора → JWT | Нет |
| `POST` | `/auth/keyfile` | Вход по .dmga ключу → JWT + role | Нет |
| `GET` | `/folders` | Все папки (включая вложенные) | Bearer |
| `GET` | `/files/{folderId}` | Файлы в папке | Bearer |
| `GET` | `/media/{fileId}` | Проксирование медиа-файла | Query `?token=` |
| `PUT` | `/admin/restrictions` | Обновить ограничения папок | Bearer (admin) |
| `POST` | `/admin/keyfile` | Сгенерировать .dmga ключ | Bearer (admin) |

### Формат ответов Worker

Worker может возвращать данные в разных форматах:

```js
// Вариант 1: plain array
[{ id: "...", name: "..." }, ...]

// Вариант 2: объект с ключом (Google Drive API формат)
{ folders: [{ id: "...", name: "...", parents: ["parentId"] }, ...] }

// Вариант 3: объект с ключом files
{ files: [{ id: "...", name: "...", mimeType: "video/mp4", parents: ["parentId"] }, ...] }
```

Клиент использует `extractArray()` для универсального извлечения массива и `extractParentId()` для получения ID родительской папки из обоих форматов: `parentId: "id"` или `parents: ["id"]`.

### Авторизация

- **Admin:** `POST /auth/admin { password }` → `{ token: "jwt..." }`
- **Keyfile:** `POST /auth/keyfile { keyfile: KeyfilePayload, password }` → `{ token: "jwt...", role: "guest" }`
- **Bearer:** `Authorization: Bearer <token>` в заголовке
- **Media:** `GET /media/{fileId}?token=<token>` — токен в query-параметре

### .dmga формат ключа

```json
{
  "version": 1,
  "allowedFolders": ["folderId1", "folderId2"],
  "exp": 1700000000,
  "iv": "base64...",
  "tag": "base64...",
  "salt": "base64..."
}
```

Шифрование: AES-256-GCM + PBKDF2 (пароль пользователя).

### Логика доступа (ограничения ↔ ключи)

```
Папка restricted=true   →  не видна гостям, не попадает в ключ
Папка restricted=false  →  видна гостям, автоматически включается в генерируемый ключ

Admin Panel:
  1. Админ отмечает папки как ограниченные (toggle)
  2. Сохраняет → PUT /admin/restrictions { restrictedFolderIds: [...] }
  3. Генерирует ключ → POST /admin/keyfile (allowedFolderIds = все id где restricted=false)
  4. Гость входит с ключом → видит только папки из allowedFolders ключа
```

При открытии панели администратора текущие ограничения загружаются из `GET /folders` (поле `restricted` у каждой папки).

---

## Определение типов медиа

Видео определяется трёхуровнево:

1. `mediaType === "video"` (из Worker/Drive API)
2. `mimeType.startsWith("video/")`
3. Расширение файла: `mp4`, `webm`, `mov`, `avi`, `mkv`, `m4v`, `3gp`, `flv`, `wmv`

Аналогично для изображений: `mediaType === "image"`, `mimeType.startsWith("image/")`, расширения: `jpg`, `jpeg`, `png`, `gif`, `webp`, `bmp`, `svg`.

---

## URL-стратегия для медиа

| Назначение | URL | Авторизация |
|-----------|-----|-------------|
| Превью (карточки) | `https://drive.google.com/thumbnail?id={id}&sz=w{size}` | Не нужна |
| Полное изображение | `{WORKER_URL}/media/{id}?token={jwt}` | JWT |
| Видео (воспроизведение) | `{WORKER_URL}/media/{id}?token={jwt}` | JWT |
| Poster для видео | `https://drive.google.com/thumbnail?id={id}&sz=w800` | Не нужна |

Превью используют Google Drive thumbnail service — лёгкие (до 600px шириной), не требуют авторизации. Полные медиа идут через Worker-прокси с JWT.

---

## Деплой

```bash
# Сборка статического сайта
npx next build

# Копирование в /docs для GitHub Pages
rm -rf docs && cp -r out docs && touch docs/.nojekyll

# Пуш на GitHub (автодеплой через GitHub Pages)
git add -A && git commit -m "Deploy" && git push origin main
```

### Конфигурация Next.js

```ts
// next.config.ts
{
  output: "export",           // Статический HTML
  basePath: "/Drive-Media-Galereya",
  images: { unoptimized: true }, // GitHub Pages не поддерживает оптимизацию
  trailingSlash: true,
}
```

### Переменные окружения

```env
# Основной режим (Worker)
NEXT_PUBLIC_WORKER_URL=https://dmga-api.galinakostrik2023.workers.dev

# Фоллбэк (Direct mode)
NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY=...
NEXT_PUBLIC_GOOGLE_DRIVE_ROOT_FOLDER_ID=...
```

---

## Zustand Store: ключевые методы

```ts
// Получить все файлы для текущего выбора (с учётом подпапок)
getAllFiles(): DriveFile[]

// Файлы конкретной папки (без дочерних)
getFilesInFolder(folderId: string): DriveFile[]

// Корневые папки
getTopLevelFolders(): DriveFolder[]

// Дочерние папки
getChildFolders(parentId: string): DriveFolder[]
```

При выборе папки `getAllFiles()` рекурсивно собирает файлы из выбранной папки и всех её потомков через `collectDescendantIds()`. Результаты дедуплицируются по `file.id`.

---

## Известные особенности

- GitHub Pages не поддерживает серверный рендеринг — используется `output: 'export'`
- Файл `.nojekyll` обязателен для корректной отдачи `_next/` директории
- Worker `/folders` возвращает Google Drive API формат: `parents: ["id"]` (массив), а не `parentId: "id"` — клиент конвертирует через `extractParentId()`
- Worker может оборачивать массивы в объекты: `{ folders: [...] }` — клиент обрабатывает через `extractArray()`
- Видео стартуют без звука (muted) из-за политики autoplay браузеров
- Токены сохраняются в localStorage и восстанавливаются при перезагрузке страницы

# Drive Media Gallery (DMGA)

Медиа-галерея для просмотра фотографий и видео из Google Drive с авторизацией, ограничением доступа по папкам и сторис-плеером.

---

## Архитектура

```
┌──────────────────┐       ┌─────────────────────────┐       ┌──────────────┐
│   Браузер        │──────▶│  Cloudflare Worker      │──────▶│ Google Drive │
│   (Next.js SPA)  │◀──────│  (Прокси + Авторизация) │◀──────│   API v3     │
└──────────────────┘       └─────────────────────────┘       └──────────────┘
```

- **Фронтенд** — статический сайт на Next.js (Static Export), хостится на GitHub Pages
- **Бэкенд** — Cloudflare Worker, проксирует запросы к Google Drive API и обеспечивает авторизацию
- **Хранилище** — Google Drive папка с фото/видео файлами

---

## Репозиторий

- **GitHub**: `https://github.com/mmitekk/Drive-Media-Galereya`
- **Сайт**: `https://mmitekk.github.io/Drive-Media-Galereya/`
- **Worker API**: `https://dmga-api.galinakostrik2023.workers.dev/`

---

## Авторизация

Система поддерживает два типа авторизации:

### 1. Администратор
- Вход по паролю через экран логина
- Пароль хранится в переменной `ADMIN_PASSWORD` в Cloudflare Worker
- После входа получает JWT-токен с ролью `admin`
- Доступны: все папки, панель «Управление доступом», генерация ключ-файлов

### 2. Гость (ключ-файл .dmga)
- Администратор генерирует ключ-файл `.dmga` через панель «Управление доступом»
- Ключ-файл содержит зашифрованный список доступных папок (AES-256-GCM + PBKDF2)
- Гость загружает файл `.dmga` на экране входа и вводит пароль
- Получает JWT-токен с ролью `guest` и доступ только к разрешённым папкам

### Схема ключ-файла .dmga

```json
{
  "version": 4,
  "allowedFolders": ["folderId1", "folderId2"],
  "exp": 1740000000000,
  "iv": "base64...",
  "tag": "base64...",
  "salt": "base64...",
  "data": "base64..."
}
```

- `allowedFolders` — список ID папок, к которым у гостя есть доступ
- `exp` — срок действия (Unix timestamp в миллисекундах)
- `iv`, `tag`, `salt`, `data` — криптографические параметры AES-256-GCM шифрования

---

## Cloudflare Worker API

### Эндпоинты

| Метод | Путь | Описание | Авторизация |
|-------|------|----------|-------------|
| GET | `/health` | Проверка состояния Worker | Нет |
| POST | `/auth/admin` | Вход администратора (`{password}`) → JWT | Нет |
| POST | `/auth/keyfile` | Вход по ключ-файлу (`{keyfile, password}`) → JWT | Нет |
| GET | `/folders` | Список папок | JWT |
| GET | `/files/{folderId}` | Файлы в папке | JWT |
| GET | `/media/{fileId}` | Проксирование медиа-файла (стриминг) | JWT (query param) |
| POST | `/admin/keyfile` | Генерация ключ-файла | JWT (admin) |
| PUT | `/admin/restrictions` | Обновление ограничений папок | JWT (admin) |

### Переменные окружения Worker

| Переменная | Описание |
|------------|----------|
| `ADMIN_PASSWORD` | Пароль администратора |
| `DRIVE_API_KEY` | API ключ Google Drive |
| `DRIVE_ROOT_FOLDER_ID` | ID корневой папки Google Drive |
| `GOOGLE_DRIVE_API_KEY` | Дубликат API ключа |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Дубликат ID корневой папки |
| `JWT_SECRET` | Секрет для подписи JWT-токенов |
| `TOKEN_SALT` | Соль для токенов |
| `TOKEN_SECRET` | Дополнительный секрет токенов |

### Авторизация запросов

JWT-токен передаётся:
- В заголовке `Authorization: Bearer <token>` — для `/folders`, `/files/*`, `/admin/*`
- В query-параметре `?token=<token>` — для `/media/*` (т.к. используется в `<video src>` и `<img src>`)

---

## Фронтенд

### Технологии

- **Next.js 16** (Static Export, `output: 'export'`)
- **React 19** + TypeScript
- **Tailwind CSS 4** + shadcn/ui компоненты
- **Zustand** — глобальное состояние
- **next-themes** — тёмная/светлая тема
- **basePath**: `/Drive-Media-Galereya`

### Структура файлов

```
src/
├── app/
│   ├── layout.tsx          # Корневой layout (ThemeProvider, AuthProvider)
│   ├── page.tsx            # Главная страница (экран входа / галерея)
│   └── globals.css         # Глобальные стили
├── components/
│   ├── admin-settings.tsx  # Панель «Управление доступом» (широкий диалог)
│   ├── folder-nav.tsx      # Навигация по папкам (сайдбар)
│   ├── image-lightbox.tsx  # Полноэкранный просмотр фото
│   ├── media-card.tsx      # Карточка медиа (превью + ховер)
│   ├── media-gallery.tsx   # Основная галерея (сетка + видео-ряд)
│   ├── search-filter.tsx   # Поиск и фильтрация
│   ├── setup-guide.tsx     # Инструкция настройки (если не сконфигурировано)
│   ├── story-player.tsx    # Сторис-плеер для видео (HTML5 <video>)
│   └── ui/                 # shadcn/ui компоненты
├── hooks/
│   └── use-data-loader.ts  # Загрузка данных (папки + файлы) с токеном
└── lib/
    ├── auth-context.tsx    # React Context: авторизация (admin/guest)
    ├── config.ts           # Конфигурация (Worker URL, API ключи)
    ├── google-drive.ts     # API клиент (Direct API + Worker fallback)
    ├── store.ts            # Zustand store
    ├── types.ts            # TypeScript типы
    ├── utils.ts            # Утилиты
    └── worker-api.ts       # Cloudflare Worker API клиент
```

### Режимы работы

1. **Direct API** — если заданы `NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY` + `NEXT_PUBLIC_GOOGLE_DRIVE_ROOT_FOLDER_ID`, запросы идут напрямую к Google Drive API (публичный доступ, без авторизации)
2. **Worker Mode** — если задан только `NEXT_PUBLIC_WORKER_URL`, все запросы идут через Worker с авторизацией по JWT

### Экран входа (Worker Mode)

Если Worker включён и пользователь не авторизован:
- Показывается экран входа с полем пароля администратора
- Кнопка «Загрузить ключ-файл (.dmga)» для гостевого доступа
- После успешной авторизации данные загружаются с токеном

### Медиа-прокси

В Worker Mode все медиа-файлы загружаются через Worker:
- **Фото**: `GET /media/{fileId}?token=xxx` — используется в `<img src>` для лайтбокса
- **Видео**: `GET /media/{fileId}?token=xxx` — используется в HTML5 `<video src>` для сторис-плеера
- **Превью**: `https://drive.google.com/thumbnail?id={fileId}&sz=w{size}` — публичные миниатюры Google Drive

---

## Сторис-плеер

Видео воспроизводятся в формате «сторис» (как Instagram/YouTube Shorts):

- HTML5 `<video>` через Worker прокси
- Прогресс-бар синхронизирован с `video.currentTime` через `requestAnimationFrame`
- Автопереход на следующее видео по событию `onEnded` (без преждевременной обрезки)
- Управление: пауза, звук, свайп/клик для навигации, клавиатура (←→, Space, Esc)

---

## Деплой

### Сборка и публикация

```bash
# 1. Сборка статического сайта
npm run build

# 2. Копирование в /docs (GitHub Pages source)
rm -rf docs && cp -r out docs && touch docs/.nojekyll

# 3. Пуш в GitHub
git add docs/ && git commit -m "Deploy" && git push origin main
```

### Важно

- `output: 'export'` в `next.config.ts` — обязателен для статики
- `.nojekyll` в `/docs` — обязателен для работы `_next` директории на GitHub Pages
- `basePath: '/Drive-Media-Galereya'` — обязателен для корректных путей на GitHub Pages
- GitHub Pages настроен на ветку `main`, папку `/docs`
- `NEXT_PUBLIC_WORKER_URL` встраивается при сборке (build time)

---

## Управление секретами (Cloudflare)

Секреты Worker'а управляются через Cloudflare Dashboard:
1. Откройте `https://dash.cloudflare.com`
2. Перейдите в **Workers & Pages** → **dmga-api** → **Settings** → **Variables and Secrets**
3. Для обновления секрета нажмите **Rotate** рядом с нужной переменной
4. Для пересоздания: удалите переменную (🗑) и добавьте заново через **+ Add**

> **Примечание**: Cloudflare не показывает значения секретов после сохранения. Для смены пароля используйте Rotate или удаление + пересоздание.

---

## Генерация ключ-файлов

1. Войдите как администратор
2. Нажмите иконку 🛡 (Управление доступом)
3. В левой панели включите ограничения для папок (переключатели)
4. Нажмите «Сохранить ограничения»
5. В правой панели введите пароль для ключ-файла (минимум 4 символа)
6. Подтвердите пароль
7. Нажмите «Скачать ключ-файл (.dmga)»
8. Передайте файл `.dmga` и пароль гостю

---

## Устранение неисправностей

| Проблема | Решение |
|----------|---------|
| Бесконечная загрузка | Проверьте, что Worker отвечает (`/health`), и что JWT-токен есть в localStorage |
| Видео не воспроизводится | Проверьте, что `/media/{fileId}?token=xxx` возвращает 200, а не 401 |
| Фавиконка не отображается | Проверьте путь в `layout.tsx` — должен быть `/Drive-Media-Galereya/favicon.svg` |
| SetupGuide вместо галереи | Проверьте, что `NEXT_PUBLIC_WORKER_URL` задан в `.env` при сборке |
| Ошибка 401 на `/folders` | Нужна авторизация — войдите через экран логина |

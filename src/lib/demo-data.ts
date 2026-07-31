// ============================================================
// Demo / mock data — shown when no Google Drive is connected
// ============================================================
import type { DriveFolder, DriveFile } from "./types";

// Unsplash demo images (free, no API key needed)
const DEMO_IMAGES = [
  { id: "img1", url: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=450&fit=crop", name: "Горный пейзаж.jpg" },
  { id: "img2", url: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=600&h=450&fit=crop", name: "Лесная тропа.jpg" },
  { id: "img3", url: "https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=600&h=450&fit=crop", name: "Рассвет над озером.jpg" },
  { id: "img4", url: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=600&h=450&fit=crop", name: "Туманное утро.jpg" },
  { id: "img5", url: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600&h=450&fit=crop", name: "Зелёная долина.jpg" },
  { id: "img6", url: "https://images.unsplash.com/photo-1518173946687-a1e0e2a2f637?w=600&h=450&fit=crop", name: "Закат на море.jpg" },
  { id: "img7", url: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=600&h=450&fit=crop", name: "Озеро в горах.jpg" },
  { id: "img8", url: "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=600&h=450&fit=crop", name: "Поле цветов.jpg" },
  { id: "img9", url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&h=450&fit=crop", name: "Пляж и пальмы.jpg" },
  { id: "img10", url: "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=600&h=450&fit=crop", name: "Звёздное небо.jpg" },
  { id: "img11", url: "https://images.unsplash.com/photo-1505765050516-f72dcac9c60e?w=600&h=450&fit=crop", name: "Водопад.jpg" },
  { id: "img12", url: "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=600&h=450&fit=crop", name: "Солнечный луч.jpg" },
];

const DEMO_VIDEOS = [
  { id: "vid1", url: "https://images.unsplash.com/photo-1536240478700-b869070f9279?w=400&h=700&fit=crop", name: "Волны на море.mp4", durationMs: 12000 },
  { id: "vid2", url: "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=400&h=700&fit=crop", name: "Закат в горах.mp4", durationMs: 8500 },
  { id: "vid3", url: "https://images.unsplash.com/photo-1483728642387-6c3bdd6c93e5?w=400&h=700&fit=crop", name: "Грозовые тучи.mp4", durationMs: 15200 },
  { id: "vid4", url: "https://images.unsplash.com/photo-1516912481808-3406841bd33c?w=400&h=700&fit=crop", name: "Снегопад.mp4", durationMs: 6800 },
];

export const DEMO_FOLDERS: DriveFolder[] = [
  { id: "demo-travel", name: "Путешествия", parentId: null, createdTime: "2025-06-15T10:00:00Z" },
  { id: "demo-nature", name: "Природа", parentId: null, createdTime: "2025-05-20T14:00:00Z" },
  { id: "demo-family", name: "Семья", parentId: null, createdTime: "2025-04-10T18:00:00Z" },
];

export function getDemoFilesByFolder(): Record<string, DriveFile[]> {
  const mkImage = (img: typeof DEMO_IMAGES[number], parentId: string, i: number): DriveFile => ({
    id: img.id,
    name: img.name,
    mimeType: "image/jpeg",
    createdTime: new Date(Date.now() - i * 86400000 * (1 + Math.random() * 5)).toISOString(),
    modifiedTime: new Date(Date.now() - i * 86400000).toISOString(),
    parentId,
    size: String(Math.round(1500000 + Math.random() * 3000000)),
    mediaType: "image",
    thumbnailLink: img.url,
    _demoUrl: img.url,
  } as DriveFile & { _demoUrl: string });

  const mkVideo = (vid: typeof DEMO_VIDEOS[number], parentId: string, i: number): DriveFile => ({
    id: vid.id,
    name: vid.name,
    mimeType: "video/mp4",
    createdTime: new Date(Date.now() - i * 86400000 * (2 + Math.random() * 5)).toISOString(),
    modifiedTime: new Date(Date.now() - i * 86400000 * 2).toISOString(),
    parentId,
    size: String(Math.round(10000000 + Math.random() * 50000000)),
    mediaType: "video",
    durationMs: vid.durationMs,
    thumbnailLink: vid.url,
    _demoUrl: vid.url,
  } as DriveFile & { _demoUrl: string });

  return {
    "demo-travel": [
      mkImage(DEMO_IMAGES[0], "demo-travel", 0),
      mkImage(DEMO_IMAGES[1], "demo-travel", 1),
      mkImage(DEMO_IMAGES[5], "demo-travel", 2),
      mkImage(DEMO_IMAGES[8], "demo-travel", 3),
      mkVideo(DEMO_VIDEOS[0], "demo-travel", 4),
      mkVideo(DEMO_VIDEOS[1], "demo-travel", 5),
    ],
    "demo-nature": [
      mkImage(DEMO_IMAGES[2], "demo-nature", 0),
      mkImage(DEMO_IMAGES[3], "demo-nature", 1),
      mkImage(DEMO_IMAGES[4], "demo-nature", 2),
      mkImage(DEMO_IMAGES[7], "demo-nature", 3),
      mkImage(DEMO_IMAGES[9], "demo-nature", 4),
      mkVideo(DEMO_VIDEOS[2], "demo-nature", 5),
      mkVideo(DEMO_VIDEOS[3], "demo-nature", 6),
    ],
    "demo-family": [
      mkImage(DEMO_IMAGES[6], "demo-family", 0),
      mkImage(DEMO_IMAGES[10], "demo-family", 1),
      mkImage(DEMO_IMAGES[11], "demo-family", 2),
    ],
  };
}

/** Is this file from demo data? */
export function isDemoFile(file: DriveFile): boolean {
  return file.id.startsWith("img") || file.id.startsWith("vid");
}

/** Get demo image URL (Unsplash) */
export function getDemoImageUrl(file: DriveFile): string | null {
  const extended = file as DriveFile & { _demoUrl?: string };
  return extended._demoUrl ?? null;
}

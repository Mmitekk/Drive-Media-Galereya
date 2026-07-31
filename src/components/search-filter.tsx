"use client";

// ============================================================
// Search & Filter bar
// ============================================================
import { useAppStore } from "@/lib/store";
import type { FilterType, SortOrder } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, ImageIcon, Video, LayoutGrid, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchFilterProps {
  className?: string;
}

const FILTER_OPTIONS: { value: FilterType; label: string; icon: React.ReactNode }[] = [
  { value: "all", label: "Все", icon: <LayoutGrid className="h-4 w-4" /> },
  { value: "images", label: "Фото", icon: <ImageIcon className="h-4 w-4" /> },
  { value: "videos", label: "Видео", icon: <Video className="h-4 w-4" /> },
];

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: "newest", label: "Сначала новые" },
  { value: "oldest", label: "Сначала старые" },
  { value: "name-asc", label: "Имя А→Я" },
  { value: "name-desc", label: "Имя Я→А" },
];

export function SearchFilter({ className }: SearchFilterProps) {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const sortOrder = useAppStore((s) => s.sortOrder);
  const setSortOrder = useAppStore((s) => s.setSortOrder);
  const filterType = useAppStore((s) => s.filterType);
  const setFilterType = useAppStore((s) => s.setFilterType);

  return (
    <div className={cn("flex flex-col sm:flex-row gap-3", className)}>
      {/* Search */}
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Поиск по названию..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Filter type toggle */}
      <div className="flex gap-1">
        {FILTER_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={filterType === opt.value ? "secondary" : "ghost"}
            size="sm"
            className="gap-1.5"
            onClick={() => setFilterType(opt.value)}
          >
            {opt.icon}
            <span className="hidden sm:inline">{opt.label}</span>
          </Button>
        ))}
      </div>

      {/* Sort */}
      <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as SortOrder)}>
        <SelectTrigger className="w-[180px]">
          <ArrowUpDown className="h-4 w-4 mr-2 shrink-0" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

"use client";

import { useState } from "react";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Loader2,
  Plus,
  School,
  Trash2,
  XCircle,
} from "lucide-react";
import type { Campus } from "@/lib/types";

interface CampusListProps {
  campuses: Campus[];
  loading: boolean;
  error: string | null;
  onAddCampus: (name: string, city?: string) => Promise<string | null>;
  onOpenCampus: (campus: Campus) => void;
  onDeleteCampus: (id: string) => Promise<boolean>;
}

function StatusIndicator({ status }: { status?: Campus["plannerStatus"] }) {
  switch (status) {
    case "processing":
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-inkmute">
          <Loader2 className="h-3 w-3 animate-spin" />
          Memproses…
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-forest">
          <CheckCircle2 className="h-3 w-3" />
          Terjadwal
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-warn">
          <XCircle className="h-3 w-3" />
          Gagal
        </span>
      );
    default:
      return (
        <span className="text-[11px] text-inkmute">Belum ada kalender</span>
      );
  }
}

export default function CampusList({
  campuses,
  loading,
  error,
  onAddCampus,
  onOpenCampus,
  onDeleteCampus,
}: CampusListProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleting(true);
    const ok = await onDeleteCampus(id);
    setDeleting(false);
    if (ok) setConfirmDelete(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const id = await onAddCampus(name.trim(), city.trim() || undefined);
    setSaving(false);
    if (id) {
      setName("");
      setCity("");
      setIsAdding(false);
    }
  };

  return (
    <section className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-medium tracking-tight text-ink">
            Kampus Saya
          </h1>
          <p className="mt-1 text-sm text-inksoft">
            Daftar kampus yang Anda tangani. Pilih kampus untuk mengunggah
            kalender akademiknya.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsAdding((v) => !v)}
          className="inline-flex h-9 items-center gap-2 rounded-sm bg-forest px-4 text-xs font-medium text-surface transition-[filter] hover:brightness-90"
        >
          <Plus className="h-3.5 w-3.5" />
          Tambah Kampus
        </button>
      </div>

      {isAdding && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 rounded-sm border border-line bg-surface p-6 shadow-[0_1px_0_rgba(31,34,48,0.04),0_8px_24px_-12px_rgba(31,34,48,0.18)]"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="campus-name"
                className="mb-1.5 block text-xs font-medium text-inksoft"
              >
                Nama Kampus
              </label>
              <input
                id="campus-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="cth. Universitas Nusantara"
                className="h-10 w-full rounded-sm border border-line bg-[#FFFCF5] px-3 text-sm text-ink placeholder:text-inkmute focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20"
              />
            </div>
            <div>
              <label
                htmlFor="campus-city"
                className="mb-1.5 block text-xs font-medium text-inksoft"
              >
                Kota <span className="font-normal text-inkmute">(opsional)</span>
              </label>
              <input
                id="campus-city"
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="cth. Jakarta"
                className="h-10 w-full rounded-sm border border-line bg-[#FFFCF5] px-3 text-sm text-ink placeholder:text-inkmute focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20"
              />
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="inline-flex h-9 items-center gap-2 rounded-sm bg-forest px-4 text-xs font-medium text-surface transition-[filter] hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Simpan
            </button>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="inline-flex h-9 items-center rounded-sm border border-line bg-white px-4 text-xs font-medium text-forest transition-colors hover:bg-surface2"
            >
              Batal
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="mb-6 rounded-sm border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center rounded-sm border border-line bg-surface py-16">
          <Loader2 className="h-5 w-5 animate-spin text-inkmute" />
        </div>
      ) : campuses.length === 0 ? (
        <div className="rounded-sm border border-dashed border-line bg-surface px-6 py-16 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-sm border border-line bg-surface2">
            <School className="h-5 w-5 text-inkmute" />
          </div>
          <p className="text-sm font-medium text-ink">
            Belum ada kampus terdaftar
          </p>
          <p className="mt-1 text-xs text-inkmute">
            Klik &quot;Tambah Kampus&quot; untuk mulai mendata kampus yang Anda
            tangani.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {campuses.map((campus) => (
            <li key={campus.id}>
              <button
                type="button"
                onClick={() => onOpenCampus(campus)}
                className="group relative flex w-full flex-col gap-3 overflow-hidden rounded-sm border border-line bg-surface p-5 text-left shadow-[0_1px_0_rgba(31,34,48,0.04),0_8px_24px_-12px_rgba(31,34,48,0.18)] transition-colors hover:bg-surface2"
              >
                <span className="absolute inset-x-0 top-0 h-1 bg-forest" />
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-line bg-surface2">
                    <Building2 className="h-4 w-4 text-forest" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-serif text-lg font-medium text-ink">
                      {campus.name}
                    </p>
                    {campus.city && (
                      <p className="mt-0.5 font-mono text-[11px] text-inkmute">
                        {campus.city}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <StatusIndicator status={campus.plannerStatus} />
                  <div className="flex items-center gap-2">
                    {confirmDelete === campus.id ? (
                      <>
                        <button
                          type="button"
                          disabled={deleting}
                          onClick={(e) => handleDelete(e, campus.id)}
                          className="inline-flex h-7 items-center gap-1 rounded-sm border border-warn/40 bg-warn/10 px-2 text-[11px] font-medium text-warn transition-colors hover:bg-warn/20 disabled:opacity-50"
                        >
                          {deleting && (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          )}
                          Hapus?
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDelete(null);
                          }}
                          className="inline-flex h-7 items-center rounded-sm border border-line bg-white px-2 text-[11px] text-inkmute transition-colors hover:bg-surface2"
                        >
                          Batal
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDelete(campus.id);
                          }}
                          aria-label={`Hapus ${campus.name}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-inkmute transition-colors hover:bg-warn/10 hover:text-warn"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <ArrowRight className="h-4 w-4 text-inkmute transition-colors group-hover:text-forest" />
                      </>
                    )}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

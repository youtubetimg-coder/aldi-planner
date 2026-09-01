"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Campus } from "@/lib/types";

interface UseCampusesResult {
  campuses: Campus[];
  loading: boolean;
  error: string | null;
  addCampus: (name: string, city?: string) => Promise<string | null>;
  deleteCampus: (id: string) => Promise<boolean>;
}

/**
 * Live list of campuses handled by the signed-in Account Manager.
 * Reads the `campuses` table filtered by user_id (enforced by RLS)
 * and subscribes to Postgres changes via Supabase Realtime.
 */
export function useCampuses(uid: string | null): UseCampusesResult {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [loading, setLoading] = useState(Boolean(uid));
  const [error, setError] = useState<string | null>(null);

  const fetchCampuses = useCallback(async () => {
    if (!uid || !isSupabaseConfigured) {
      setCampuses([]);
      setLoading(false);
      return;
    }
    const { data, error: fetchError } = await getSupabase()
      .from("campuses")
      .select("*")
      .order("created_at", { ascending: true });

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setCampuses(
        (data ?? []).map((row) => ({
          id: row.id as string,
          name: row.name as string,
          city: (row.city as string) || undefined,
          plannerStatus: row.planner_status as Campus["plannerStatus"],
          sourceFile: (row.source_file as string) || undefined,
        }))
      );
    }
    setLoading(false);
  }, [uid]);

  useEffect(() => {
    if (!uid || !isSupabaseConfigured) {
      setCampuses([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchCampuses();

    const channel = getSupabase()
      .channel(`campuses:${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "campuses", filter: `user_id=eq.${uid}` },
        () => fetchCampuses()
      )
      .subscribe();

    return () => {
      getSupabase().removeChannel(channel);
    };
  }, [uid, fetchCampuses]);

  const addCampus = useCallback(
    async (name: string, city?: string) => {
      if (!uid || !isSupabaseConfigured) return null;
      setError(null);
      const { data, error: insertError } = await getSupabase()
        .from("campuses")
        .insert({ user_id: uid, name, city: city ?? "", planner_status: "idle" })
        .select("id")
        .single();

      if (insertError) {
        setError(insertError.message);
        return null;
      }
      await fetchCampuses();
      return data.id as string;
    },
    [uid, fetchCampuses]
  );

  const deleteCampus = useCallback(
    async (id: string) => {
      if (!uid || !isSupabaseConfigured) return false;
      setError(null);
      // planners terhapus otomatis via ON DELETE CASCADE (schema.sql).
      // File kalender di Storage dibiarkan — bucket privat, tidak bocor,
      // dan biaya minimal. ponytail: hapus file juga kalau quota storage
      // jadi masalah.
      const { error: deleteError } = await getSupabase()
        .from("campuses")
        .delete()
        .eq("id", id);

      if (deleteError) {
        setError(deleteError.message);
        return false;
      }
      setCampuses((prev) => prev.filter((c) => c.id !== id));
      return true;
    },
    [uid]
  );

  return { campuses, loading, error, addCampus, deleteCampus };
}

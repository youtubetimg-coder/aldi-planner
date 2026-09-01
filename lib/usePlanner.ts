"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { PlannerData, PlannerStatus, TrainingModule } from "@/lib/types";

interface PlannerTarget {
  uid: string;
  campusId: string;
}

interface UsePlannerResult {
  status: PlannerStatus | "idle";
  planner: PlannerData | null;
  error: string | null;
  uploadCalendar: (target: PlannerTarget, file: File) => Promise<void>;
  listenTo: (target: PlannerTarget) => void;
  reset: () => void;
  updateModule: (
    campusId: string,
    moduleId: string,
    patch: Partial<Pick<TrainingModule, "plannedDate" | "actualDate">>
  ) => Promise<void>;
}

/**
 * Uploads a campus academic calendar to Supabase Storage at
 * `calendars/{uid}/{campusId}/{file}`, upserts the planner row for the
 * campus with status "processing", invokes the `process-calendar`
 * Edge Function for AI extraction, and live-listens via Realtime until
 * the status flips to "completed" or "failed".
 */
export function usePlanner(): UsePlannerResult {
  const [status, setStatus] = useState<PlannerStatus | "idle">("idle");
  const [planner, setPlanner] = useState<PlannerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<PlannerTarget | null>(null);

  const mapRow = useCallback(
    (row: Record<string, unknown>, t: PlannerTarget): PlannerData => ({
      status: row.status as PlannerStatus,
      campusId: t.campusId,
      sourceFile: (row.source_file as string) || undefined,
      academicEvents: (row.academic_events as PlannerData["academicEvents"]) ?? [],
      trainingModules:
        (row.training_modules as PlannerData["trainingModules"]) ?? [],
      errorMessage: (row.error_message as string) || undefined,
    }),
    []
  );

  const uploadCalendar = useCallback(
    async (nextTarget: PlannerTarget, file: File) => {
      if (!isSupabaseConfigured) {
        setError("Supabase belum dikonfigurasi. Isi kredensial di .env.local.");
        return;
      }
      setError(null);
      setStatus("processing");
      setTarget(nextTarget);

      const supabase = getSupabase();
      const safeName = file.name.replace(/[^\w.-]/g, "_");
      const storagePath = `${nextTarget.uid}/${nextTarget.campusId}/${Date.now()}-${safeName}`;

      try {
        // 1. Upload the calendar file to the private "calendars" bucket.
        const { error: uploadError } = await supabase.storage
          .from("calendars")
          .upload(storagePath, file);
        if (uploadError) throw uploadError;

        // 2. Upsert the planner row so the UI can listen immediately.
        const { error: upsertError } = await supabase.from("planners").upsert(
          {
            campus_id: nextTarget.campusId,
            user_id: nextTarget.uid,
            status: "processing",
            source_file: storagePath,
            academic_events: [],
            training_modules: [],
            error_message: null,
          },
          { onConflict: "campus_id" }
        );
        if (upsertError) throw upsertError;

        // 3. Mirror the status onto the campus row.
        await supabase
          .from("campuses")
          .update({ planner_status: "processing", source_file: storagePath })
          .eq("id", nextTarget.campusId);

        // 4. Invoke the Edge Function — AI extraction runs server-side.
        const { error: fnError } = await supabase.functions.invoke(
          "process-calendar",
          { body: { campusId: nextTarget.campusId, storagePath, userId: nextTarget.uid } }
        );
        if (fnError) {
          // The Edge Function may still flip the row; only surface a
          // local failure if the invoke call itself failed.
          throw fnError;
        }
      } catch (err) {
        setStatus("failed");
        setError(
          err instanceof Error ? err.message : "Gagal mengunggah kalender."
        );
      }
    },
    []
  );

  /** Attach the listener for an already-existing planner (e.g. reopening a campus). */
  const listenTo = useCallback((nextTarget: PlannerTarget) => {
    setError(null);
    setStatus("processing");
    setTarget(nextTarget);
  }, []);

  // 5. Listen for the Edge Function result via Realtime.
  useEffect(() => {
    if (!target || !isSupabaseConfigured) return;

    const supabase = getSupabase();

    // Fetch current state first (planner may already exist).
    supabase
      .from("planners")
      .select("*")
      .eq("campus_id", target.campusId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const mapped = mapRow(data as Record<string, unknown>, target);
        setPlanner(mapped);
        setStatus(mapped.status);
        if (mapped.status === "failed") {
          setError(mapped.errorMessage ?? "Pemrosesan AI gagal.");
        }
      });

    const channel = supabase
      .channel(`planner:${target.campusId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "planners",
          filter: `campus_id=eq.${target.campusId}`,
        },
        (payload) => {
          const mapped = mapRow(
            payload.new as Record<string, unknown>,
            target
          );
          setPlanner(mapped);
          setStatus(mapped.status);
          if (mapped.status === "failed") {
            setError(mapped.errorMessage ?? "Pemrosesan AI gagal.");
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [target, mapRow]);

  const reset = useCallback(() => {
    setStatus("idle");
    setPlanner(null);
    setError(null);
    setTarget(null);
  }, []);

  const updateModule = useCallback(
    async (
      campusId: string,
      moduleId: string,
      patch: Partial<Pick<TrainingModule, "plannedDate" | "actualDate">>
    ) => {
      if (!isSupabaseConfigured) return;
      const supabase = getSupabase();
      const { data, error: fetchErr } = await supabase
        .from("planners")
        .select("training_modules")
        .eq("campus_id", campusId)
        .maybeSingle();
      if (fetchErr || !data) return;
      const modules = (data.training_modules ?? []) as TrainingModule[];
      const updated = modules.map((m) =>
        m.id === moduleId ? { ...m, ...patch } : m
      );
      await supabase
        .from("planners")
        .update({ training_modules: updated })
        .eq("campus_id", campusId);
      setPlanner((prev) =>
        prev
          ? {
              ...prev,
              trainingModules: prev.trainingModules.map((m) =>
                m.id === moduleId ? { ...m, ...patch } : m
              ),
            }
          : prev
      );
    },
    []
  );

  return { status, planner, error, uploadCalendar, listenTo, reset, updateModule };
}

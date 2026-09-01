// Supabase Edge Function (Deno): process-calendar
// Dipanggil dari klien setelah file kalender akademik di-upload ke
// bucket Storage "calendars". Mengunduh file via service role, mengirim
// ke Gemini untuk ekstraksi, lalu menulis hasil ke tabel `planners`
// dan memirror status ke baris `campuses`.
//
// Deploy:
//   supabase functions deploy process-calendar
//   supabase secrets set GEMINI_API_KEY=... SUPABASE_SERVICE_ROLE_KEY=...

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { AI_SYSTEM_PROMPT } from "./prompts.ts";

const GEMINI_MODEL = "gemini-3.5-flash";
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/" +
  `${GEMINI_MODEL}:generateContent`;
const SUPPORTED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

interface AcademicEvent {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  description: string;
}

interface TrainingModule {
  id: string;
  moduleName: string;
  category: "core" | "support";
  scheduledDate: string;
  rationale: string;
  relatedEventId?: string;
}

interface AiExtractionResult {
  academicEvents: AcademicEvent[];
  trainingModules: TrainingModule[];
}

/** Strip markdown code fences some models add despite instructions. */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM response does not contain a JSON object.");
  }
  return candidate.slice(start, end + 1);
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** Validate the LLM payload against the expected schema. */
function validateExtraction(payload: unknown): AiExtractionResult {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("AI payload is not an object.");
  }
  const { academicEvents, trainingModules } = payload as Record<
    string,
    unknown
  >;

  if (!Array.isArray(academicEvents) || academicEvents.length === 0) {
    throw new Error("AI payload missing academicEvents array.");
  }
  if (!Array.isArray(trainingModules) || trainingModules.length === 0) {
    throw new Error("AI payload missing trainingModules array.");
  }

  const events: AcademicEvent[] = academicEvents.map((raw, i) => {
    const e = raw as Partial<AcademicEvent>;
    if (!e.id || !e.name || !isIsoDate(e.startDate) || !isIsoDate(e.endDate)) {
      throw new Error(`Invalid academicEvents[${i}] shape.`);
    }
    return {
      id: String(e.id),
      name: String(e.name),
      startDate: e.startDate,
      endDate: e.endDate,
      description: String(e.description ?? ""),
    };
  });

  const eventIds = new Set(events.map((e) => e.id));

  const modules: TrainingModule[] = trainingModules.map((raw, i) => {
    const m = raw as Partial<TrainingModule>;
    if (
      !m.id ||
      !m.moduleName ||
      (m.category !== "core" && m.category !== "support") ||
      !isIsoDate(m.scheduledDate)
    ) {
      throw new Error(`Invalid trainingModules[${i}] shape.`);
    }
    const relatedEventId =
      m.relatedEventId && eventIds.has(String(m.relatedEventId))
        ? String(m.relatedEventId)
        : undefined;
    return {
      id: String(m.id),
      moduleName: String(m.moduleName),
      category: m.category,
      scheduledDate: m.scheduledDate,
      rationale: String(m.rationale ?? ""),
      ...(relatedEventId ? { relatedEventId } : {}),
    };
  });

  return { academicEvents: events, trainingModules: modules };
}

/** Uint8Array -> base64 tanpa stack overflow untuk file besar. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Panggil Gemini REST API dengan file sebagai inline base64. */
async function extractWithGemini(
  apiKey: string,
  mimeType: string,
  bytes: Uint8Array
): Promise<AiExtractionResult> {
  // Timeout 90 detik — tanpa ini, panggilan Gemini yang hang membuat Edge
  // Function mati tanpa sempat menandai status "failed", sehingga baris
  // kampus stuck di "processing" selamanya.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);
  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: AI_SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: toBase64(bytes) } },
            {
              text:
                "Ekstrak agenda akademik dari dokumen ini dan susun jadwal " +
                "pelatihan modul sesuai instruksi sistem. Kembalikan hanya JSON.",
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    }),
  });
  clearTimeout(timeoutId);

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${detail}`);
  }

  const payload = await response.json();
  const rawText: string | undefined =
    payload?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("") || undefined;

  if (!rawText) {
    throw new Error("Gemini returned an empty response.");
  }
  return validateExtraction(JSON.parse(extractJson(rawText)));
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  let body: { campusId?: string; storagePath?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { campusId, storagePath, userId } = body;
  if (!campusId || !storagePath) {
    return new Response("campusId and storagePath are required", {
      status: 400,
      headers: corsHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Service role bypasses RLS — status tetap aman karena function hanya
  // menulis baris milik campusId yang diberikan.
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // BYOK: baca Gemini API key milik user dari tabel user_settings.
  // Fallback ke secret global jika user belum set key sendiri.
  let geminiApiKey: string | undefined;
  if (userId) {
    const { data: userSettings } = await supabase
      .from("user_settings")
      .select("gemini_api_key")
      .eq("user_id", userId)
      .maybeSingle();
    if (userSettings?.gemini_api_key) {
      geminiApiKey = userSettings.gemini_api_key;
    }
  }
  if (!geminiApiKey) {
    geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  }

  if (!geminiApiKey) {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          "Gemini API key belum diatur. Buka Settings (ikon kunci) untuk menambahkan key Anda.",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const fail = async (message: string) => {
    console.error("Calendar processing failed.", { campusId, message });
    await supabase
      .from("planners")
      .update({ status: "failed", error_message: message })
      .eq("campus_id", campusId);
    await supabase
      .from("campuses")
      .update({ planner_status: "failed" })
      .eq("id", campusId);
  };

  try {
    // Deteksi MIME dari ekstensi file.
    const lower = storagePath.toLowerCase();
    const mimeType = lower.endsWith(".pdf")
      ? "application/pdf"
      : lower.endsWith(".png")
        ? "image/png"
        : lower.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";

    if (!SUPPORTED_MIME.has(mimeType)) {
      throw new Error(`Tipe file tidak didukung: ${mimeType}`);
    }

    // Unduh file dari bucket privat via service role.
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("calendars")
      .download(storagePath);
    if (downloadError || !fileData) {
      throw new Error(
        `Gagal mengunduh file: ${downloadError?.message ?? "unknown"}`
      );
    }

    const bytes = new Uint8Array(await fileData.arrayBuffer());
    console.log("Sending calendar to Gemini.", {
      campusId,
      bytes: bytes.byteLength,
    });

    const extraction = await extractWithGemini(geminiApiKey, mimeType, bytes);

    const { error: plannerError } = await supabase
      .from("planners")
      .update({
        status: "completed",
        academic_events: extraction.academicEvents,
        training_modules: extraction.trainingModules,
        error_message: null,
      })
      .eq("campus_id", campusId);
    if (plannerError) throw new Error(plannerError.message);

    await supabase
      .from("campuses")
      .update({ planner_status: "completed" })
      .eq("id", campusId);

    console.log("Planner extraction completed.", {
      campusId,
      events: extraction.academicEvents.length,
      modules: extraction.trainingModules.length,
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown processing error";
    await fail(message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

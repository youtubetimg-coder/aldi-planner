"use client";

import { useState } from "react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import Header from "@/components/Header";
import SignIn from "@/components/SignIn";
import CampusList from "@/components/CampusList";
import UploadZone from "@/components/UploadZone";
import AcademicTimeline from "@/components/AcademicTimeline";
import TrainingPlan from "@/components/TrainingPlan";
import ProcessingState from "@/components/ProcessingState";
import SettingsModal from "@/components/SettingsModal";
import { useAuth } from "@/lib/useAuth";
import { useCampuses } from "@/lib/useCampuses";
import { usePlanner } from "@/lib/usePlanner";
import { useSettings } from "@/lib/useSettings";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  academicEvents as demoEvents,
  trainingModules as demoModules,
} from "@/lib/mockData";
import type { AcademicEvent, Campus, TrainingModule } from "@/lib/types";

type ViewMode = "campuses" | "upload" | "processing" | "dashboard";

export default function HomePage() {
  const { user, loading: authLoading, error: authError, signInWithGoogle, logout } =
    useAuth();
  const { campuses, loading: campusesLoading, error: campusesError, addCampus, deleteCampus } =
    useCampuses(user?.id ?? null);
  const { status, planner, error: plannerError, uploadCalendar, listenTo, reset } =
    usePlanner();
  const { settings, saveGeminiKey, error: settingsError } = useSettings(user?.id ?? null);

  const [view, setView] = useState<ViewMode>("campuses");
  const [activeCampus, setActiveCampus] = useState<Campus | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleOpenCampus = (campus: Campus) => {
    setDemoMode(false);
    setActiveCampus(campus);
    reset();
    if (campus.plannerStatus === "processing" && user) {
      // Reattach to the in-flight extraction for this campus.
      listenTo({ uid: user.id, campusId: campus.id });
      setView("processing");
    } else if (campus.plannerStatus === "completed" && user) {
      listenTo({ uid: user.id, campusId: campus.id });
      setView("dashboard");
    } else {
      setView("upload");
    }
  };

  const handleUpload = async (file: File) => {
    if (!user || !activeCampus) return;
    setView("processing");
    await uploadCalendar({ uid: user.id, campusId: activeCampus.id }, file);
  };

  const handleUseDemo = () => {
    reset();
    setDemoMode(true);
    setView("dashboard");
  };

  const handleBackToCampuses = () => {
    reset();
    setDemoMode(false);
    setActiveCampus(null);
    setView("campuses");
  };

  const handleReupload = () => {
    reset();
    setDemoMode(false);
    setView("upload");
  };

  const events: AcademicEvent[] = demoMode
    ? demoEvents
    : (planner?.academicEvents ?? []);
  const modules: TrainingModule[] = demoMode
    ? demoModules
    : (planner?.trainingModules ?? []);

  // Live transition: Cloud Function flipped status to "completed".
  const showDashboard =
    view === "dashboard" || (view === "processing" && status === "completed");

  return (
    <div className="min-h-screen bg-paper">
      <Header
        userName={user?.user_metadata?.full_name ?? user?.user_metadata?.name}
        userEmail={user?.email}
        userPhoto={user?.user_metadata?.avatar_url}
        onLogout={user ? logout : undefined}
        onOpenSettings={user ? () => setSettingsOpen(true) : undefined}
      />

      <main>
        {!user ? (
          <SignIn
            onSignIn={signInWithGoogle}
            error={authError}
            supabaseConfigured={isSupabaseConfigured}
          />
        ) : view === "campuses" ? (
          <CampusList
            campuses={campuses}
            loading={campusesLoading || authLoading}
            error={campusesError}
            onAddCampus={addCampus}
            onOpenCampus={handleOpenCampus}
            onDeleteCampus={deleteCampus}
          />
        ) : showDashboard ? (
          <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
            <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
              <div>
                <button
                  type="button"
                  onClick={handleBackToCampuses}
                  className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-inkmute transition-colors hover:text-ink"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Kembali ke Kampus Saya
                </button>
                <h1 className="font-serif text-3xl font-medium tracking-tight text-ink">
                  {demoMode ? "Dashboard Perencanaan" : activeCampus?.name}
                </h1>
                <p className="mt-1 text-sm text-inksoft">
                  {demoMode
                    ? "Menampilkan data demo. Unggah kalender asli untuk hasil ekstraksi AI."
                    : "Kalender akademik berhasil diproses AI. Berikut timeline dan rencana pelatihan yang direkomendasikan."}
                </p>
              </div>
              <button
                type="button"
                onClick={handleReupload}
                className="inline-flex h-9 items-center gap-2 rounded-sm border border-line bg-white px-4 text-xs font-medium text-forest transition-colors hover:bg-surface2"
              >
                <RotateCcw className="h-3.5 w-3.5 text-inkmute" />
                Unggah Ulang
              </button>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <AcademicTimeline events={events} />
              <TrainingPlan modules={modules} />
            </div>
          </div>
        ) : view === "processing" ? (
          <ProcessingState
            status={status === "idle" ? "processing" : status}
            error={plannerError}
            onReset={handleReupload}
          />
        ) : (
          <UploadZone
            onUpload={handleUpload}
            onUseDemo={handleUseDemo}
            isUploading={false}
          />
        )}
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentKey={settings?.geminiApiKey ?? ""}
        onSave={saveGeminiKey}
        error={settingsError}
      />
    </div>
  );
}

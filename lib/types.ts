export interface AcademicEvent {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  description: string;
}

export type ModuleCategory = "core" | "support";

export interface TrainingModule {
  id: string;
  moduleName: string;
  category: ModuleCategory;
  scheduledDate: string;
  rationale: string;
  relatedEventId?: string;
  /** Tanggal rencana yang diinput user (YYYY-MM-DD). */
  plannedDate?: string;
  /** Tanggal realisasi pelaksanaan (YYYY-MM-DD). */
  actualDate?: string;
}

export type PlannerStatus = "processing" | "completed" | "failed";

export interface Campus {
  id: string;
  name: string;
  city?: string;
  plannerStatus?: PlannerStatus | "idle";
  sourceFile?: string;
}

export interface PlannerData {
  status: PlannerStatus;
  campusId: string;
  sourceFile?: string;
  academicEvents: AcademicEvent[];
  trainingModules: TrainingModule[];
  errorMessage?: string;
}

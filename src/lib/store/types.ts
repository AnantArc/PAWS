import type {
  Alert,
  Command,
  CommandStageName,
  ConsoleState,
  Detection,
  FeedEvent,
  Mission,
  ScoreResult,
  ScoreWeights,
  TrailPoint,
} from "@/lib/types";
import type { TelemetryPayload } from "@/lib/contract";

export interface MissionTimeline {
  mission: Mission;
  trail: TrailPoint[];
  scoreHistory: ScoreResult[];
  events: FeedEvent[];
  detections: Detection[];
  commands: Command[];
  alerts: Alert[];
}

/**
 * One interface, two implementations:
 *  - MemoryStore   (local demo mode: in-memory + simulator, zero cloud)
 *  - SupabaseStore (production: Postgres + RLS)
 * The rest of the app never knows which one it is talking to.
 */
export interface ConsoleStore {
  readonly mode: "local" | "supabase";

  getState(): Promise<ConsoleState>;
  subscribe(fn: (s: ConsoleState) => void): () => void;
  /** Release timers/subscriptions (called when the LIVE↔DEMO switch swaps stores). */
  dispose?(): void;

  ingest(payload: TelemetryPayload): Promise<void>;
  startMission(name: string, robotId?: string): Promise<void>;
  listRobots(): Promise<Array<{ id: string; name: string }>>;
  pauseMission(): Promise<void>;
  resumeMission(): Promise<void>;
  endMission(): Promise<void>;
  issueCommand(input: {
    type: Command["type"];
    params: Record<string, string>;
    issuedBy: string;
  }): Promise<Command>;
  updateCommandStage(id: string, stage: CommandStageName, note?: string): Promise<void>;
  ackAlert(id: string, who: string): Promise<void>;
  setWeights(w: Partial<ScoreWeights>): Promise<ScoreWeights>;

  getMissionTimeline(missionId: string): Promise<MissionTimeline | null>;
  listMissions(): Promise<
    Array<{ id: string; name: string; status: string; startedAt: number; endedAt?: number }>
  >;
  health(): { uptimeSec: number; ingestCount: number; lastIngestAt: number | null };
}

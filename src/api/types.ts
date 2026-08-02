// ============================================================================
// FROZEN API CONTRACT — mobile <-> backend (DomagojBEK `mobile-app` branch)
// ============================================================================
// This is the shared shape both the mobile app and the C# backend code against.
// Mirrors the endpoint tables in Fixfly-Technician-App-Implementation-Guide.md
// §7 (W2 auth), §8 (W3 REST API), §9 (W4 resolution photos), §10 (W5 push),
// §13 (W8 chat). Keep this in sync by hand — there is no shared codegen
// between the C# backend and this TS app (see guide §3).
//
// JSON casing: ASP.NET Core in this codebase serializes camelCase
// (Program.cs sets JsonNamingPolicy.CamelCase), so these interfaces use
// camelCase field names throughout, matching the existing admin dashboard's
// DTOs (see DomagojFront `admin/models/admin.models.ts` for the same pattern).
// ============================================================================

// ── Enums (mirror backend C# enums exactly — same underlying int values) ────

// Mirrors QRTicket.Api.Models.TicketStatus
export enum TicketStatus {
  New = 0,
  ForwardedToTechnician = 1,
  Accepted = 2,
  Returned = 3,
  Done = 4,
  Closed = 5,
}

// Mirrors QRTicket.Api.Models.AgentRole
export enum AgentRole {
  Hausmajstor = 0, // "Dispatcher" in the mobile app's UI language
  Technician = 1,
}

// NEW — to be added to Agent.cs in W2/W3 (guide §7, §8 "Availability")
export enum AgentAvailability {
  Available = 0,
  OnBreak = 1,
  DayOff = 2,
}

// NEW — to be added to TicketMessage.cs in W8 (guide §13)
export enum ChatSenderType {
  Manager = 0,
  Technician = 1,
  Dispatcher = 2,
  System = 3,
  WhatsApp = 4, // legacy rows, shown greyed/labelled per the guide
}

// ── §7 — Agent auth (W2, new AgentAuthController) ───────────────────────────

export interface AgentLoginRequest {
  email: string;
  password: string;
}

export interface AgentAuthResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO 8601
  agent: AgentProfile;
}

export interface AgentRefreshRequest {
  refreshToken: string;
}

export interface AgentRevokeRequest {
  refreshToken: string;
}

// GET /api/agent/auth/me — resolves the current profile from the access
// token alone. Needed so a cold app start with a stored token can restore
// `agent` without forcing a re-login (see AuthContext.tsx).

export interface AgentProfile {
  id: number;
  name: string;
  email: string | null;
  phoneNumber: string;
  role: AgentRole;
  photoUrl: string | null;
  companyId: number;
  companyName: string;
  availability: AgentAvailability;
  technicianSpecializations: string | null; // pipe-separated, e.g. "Elektricar|Vodoinstalater"
}

// ── §8 — Tasks (W3, new AgentController) ────────────────────────────────────

// teamActive/teamCompleted are dispatcher-only: oversight of what they
// handed to technicians. The backend rejects them for a Technician.
export type TaskTab = 'active' | 'completed' | 'teamActive' | 'teamCompleted';

export interface TaskListQuery {
  tab: TaskTab;
  page?: number;
  pageSize?: number;
}

export interface TaskCategory {
  id: number;
  name: string;
  icon: string;
}

// Subset of Ticket relevant to the mobile list screen (Screen 2)
export interface TaskListItem {
  ticketId: string; // business id, e.g. "TK-LOK01-20260705-1234"
  location: string;
  locationName: string | null;
  description: string;
  status: TicketStatus;
  isUrgent: boolean;
  category: TaskCategory | null;
  roomNumber: string | null;
  createdAt: string;
  forwardedAt: string | null;
  acceptedAt: string | null;
  doneAt: string | null;
  unreadChatCount: number; // for the chat badge (Screen 2)
  assignedAgentName: string | null; // who's handling it — drives the team tabs
}

// Full detail for Screen 3 (task detail + resolve)
export interface TaskDetail extends TaskListItem {
  imageUrl: string | null; // guest-submitted photo
  latitude: number | null;
  longitude: number | null;
  reporterPhone: string | null;
  role: 'guest' | 'worker';
  resolutionComment: string | null; // W4
  resolutionPhotos: ResolutionPhoto[]; // W4
  assignmentNote: string | null; // dispatcher/admin's comment when forwarding or accepting
  assignedByName: string | null; // who forwarded/accepted this ticket last
  locationAddress: string | null;
  locationContactName: string | null;
  locationContactPhone: string | null;
}

// GET /api/agent/tasks/{id}/history — read-only activity timeline (mirrors
// the dashboard's ticket history view)
export interface TaskHistoryEvent {
  id: number;
  oldStatus: TicketStatus;
  newStatus: TicketStatus;
  changedAt: string;
  changedByName: string;
  targetAgentName: string | null;
  notes: string | null;
}

export interface ResolutionPhoto {
  id: number;
  url: string;
  uploadedByAgentId: number;
  createdAt: string;
}

// GET /api/agent/tasks response envelope
export interface TaskListResponse {
  items: TaskListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface RejectTaskRequest {
  reason: string;
}

// multipart/form-data — see W4. `images` sent as files, not JSON.
export interface ResolveTaskFields {
  comment: string; // mandatory per guide §9/§15
  // images: File[] appended separately as multipart parts named "images"
}

export interface PutAvailabilityRequest {
  availability: AgentAvailability;
}

// Dispatcher-only (Hausmajstor role) — forward to a technician
export interface ForwardTaskRequest {
  technicianAgentId: number;
}

export interface TechnicianOption {
  id: number;
  name: string;
  photoUrl: string | null;
  technicianSpecializations: string | null;
  availability: AgentAvailability;
  /**
   * Covers a trade the ticket's fault category asks for. Server-ordered so
   * these come first; true for everyone when the category names no trade.
   */
  matchesCategory: boolean;
  /** Forwarded or accepted right now — what this person already carries. */
  openTasks: number;
}

// ── §10 — Push device token (W5) ─────────────────────────────────────────────

export type DevicePlatform = 'ios' | 'android';

export interface RegisterDeviceTokenRequest {
  token: string;
  platform: DevicePlatform;
}

// Data payload carried by every push notification (guide §10) — used to
// deep-link from the OS notification into the right screen.
export interface PushDataPayload {
  type: 'task' | 'chat';
  taskId?: string; // ticketId, when type === 'task'
  ticketId?: string; // when type === 'chat'
  messageId?: string; // when type === 'chat'
  location?: string;
  priority?: 'normal' | 'urgent';
  description?: string; // short preview
}

// ── Profile stats (Screen 5) — GET /api/agent/me/stats ──────────────────────

export interface AgentStats {
  resolvedToday: number;
  avgResolutionMinutes: number;
  successRatePercent: number;
  activeTasks: number;
}

// ── §13 — Chat (W8) ──────────────────────────────────────────────────────────

/**
 * The one boundary a ticket thread has. Work is the job; Internal is the
 * management side talking about it. A technician is never told Internal
 * exists — the room you are in is the room you write to.
 */
export enum ChatRoom {
  Work = 0,
  Internal = 1,
}

/** A stretch of time one technician was on the ticket. */
export interface ChatPeriod {
  agentId: number;
  agentName: string;
  from: string;
  to: string | null;
  endReason: string | null;
}

export interface ChatAccess {
  canSeeInternal: boolean;
  /** False once a technician's period has closed — he reads, he does not write. */
  canWrite: boolean;
  /** Empty for a technician: he sees a flat thread, not the cast. */
  periods: ChatPeriod[];
}

export interface ChatMessage {
  id: number;
  ticketId: string;
  senderType: ChatSenderType;
  senderName: string;
  text: string | null;
  imageUrl: string | null;
  sentAt: string;
  clientMessageId: string | null; // for idempotent offline retries
  seen: boolean; // computed against the caller's TicketReadState
}

/**
 * A row of the Chat tab — a ticket that actually has messages, summarised by
 * its newest one. The tab used to list open tasks instead, so every row
 * previewed the ticket description and opened onto an empty thread.
 */
export interface ChatThread {
  ticketId: string;
  location: string;
  locationName: string | null;
  description: string;
  status: TicketStatus;
  lastMessageSenderName: string;
  lastMessageSenderType: ChatSenderType;
  lastMessageText: string | null; // null when the newest message is a bare image
  lastMessageHasImage: boolean;
  lastMessageAt: string;
  unreadCount: number;
}

export interface GetMessagesQuery {
  before?: string; // ISO timestamp cursor, for pull-to-load-older
  limit?: number; // default 50 per guide §13
}

// multipart/form-data — `text` + optional `image` file + `clientMessageId`
export interface SendMessageFields {
  text?: string;
  clientMessageId: string; // always required — client generates a UUID
}

// ── SignalR events (guide §12/§13 — TicketHubMethods on the C# side) ────────
// Agents join `/hubs/tickets?access_token=<agent JWT>` and call `JoinMyGroups()`
// server-side (new hub method, W7) to land in `Agent_{agentId}`.

export interface TaskAssignedToMeEvent {
  ticketId: string;
  location: string;
  isUrgent: boolean;
}

export interface TaskStatusChangedEvent {
  ticketId: string;
  oldStatus: TicketStatus;
  newStatus: TicketStatus;
  changedBy: string;
}

export interface ChatMessageReceivedEvent {
  ticketId: string;
  message: ChatMessage;
}

export interface ChatMessageReadEvent {
  ticketId: string;
  participantType: 'User' | 'Agent';
  participantId: number;
  lastReadAt: string;
}

// ── Generic error shape (mirrors ApiErrorResponse in QRTicket.Api.Models.ApiError) ──

export interface ApiErrorResponse {
  code: string;
  message: string;
  details?: string;
  validationErrors?: Record<string, string[]>;
  traceId?: string;
}

// ── Manager app (company / location admin) ──────────────────────────────────

/** Which kind of account is signed in; decides the app's whole navigation. */
export enum MobilePrincipal {
  Agent = 0,
  Manager = 1,
}

export interface ManagerProfile {
  id: number;
  name: string;
  email: string;
  role: string; // "CompanyAdmin" | "LocationAdmin"
  companyId: number | null;
  companyName: string;
  /** Set for a LocationAdmin — their whole world is this one venue. */
  locationId: number | null;
  locationName: string | null;
}

/** Exactly one of agent/manager is populated, per `principal`. */
export interface MobileAuthResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  principal: MobilePrincipal;
  agent: AgentProfile | null;
  manager: ManagerProfile | null;
}

/**
 * Why a ticket is in the manager's inbox. Ordered by how badly it needs a
 * human — a ticket nobody owns outranks one that is merely urgent, because
 * urgency at least has someone acting on it.
 */
export enum InboxReason {
  Unowned = 0,
  UrgentUnaccepted = 1,
  StaleInPool = 2,
  AcceptanceExpiring = 3,
  AwaitingClosure = 4,
}

export interface InboxItem {
  ticketId: string;
  location: string;
  locationName: string | null;
  description: string;
  status: TicketStatus;
  isUrgent: boolean;
  categoryName: string | null;
  assignedAgentName: string | null;
  createdAt: string;
  reason: InboxReason;
  /** How long it has been stuck in this state — the number that conveys urgency. */
  waitingMinutes: number;
  resolutionPhotoCount: number;
}

export interface InboxBucket {
  reason: InboxReason;
  count: number;
  items: InboxItem[];
}

export interface AdminInbox {
  totalCount: number;
  unreadChatThreads: number;
  buckets: InboxBucket[];
  /** Stalled past the horizon — cleanup, deliberately kept out of the count. */
  backlogCount: number;
  backlogHorizonDays: number;
}

export interface BacklogItem {
  ticketId: string;
  location: string;
  locationName: string | null;
  description: string;
  status: TicketStatus;
  isUrgent: boolean;
  categoryName: string | null;
  createdAt: string;
  ageDays: number;
}

export interface BacklogResponse {
  horizonDays: number;
  totalCount: number;
  items: BacklogItem[];
}

/** Full ticket as the dashboard sees it — GET /api/admin/tickets/{ticketId}. */
export interface AdminTicketDetail {
  ticketId: string;
  createdAt: string;
  location: string;
  /** Joined server-side — a manager should not read a bare location code. */
  locationName: string | null;
  locationAddress: string | null;
  locationContactName: string | null;
  locationContactPhone: string | null;
  description: string;
  reporterPhone: string | null;
  imageUrl: string | null;
  status: TicketStatus;
  isUrgent: boolean;
  category: { id: number; name: string; icon: string } | null;
  assignedAgentId: number | null;
  assignedAgent: { id: number; name: string; phoneNumber: string } | null;
  resolvedByAgent: { id: number; name: string } | null;
  roomNumber: string | null;
  /** Why a technician handed it back — the first thing a manager needs to read. */
  returnReason: string | null;
  resolutionComment: string | null;
  assignedAt: string | null;
  forwardedAt: string | null;
  acceptedAt: string | null;
  doneAt: string | null;
  resolutionPhotos: ResolutionPhoto[];
  /** Same activity trail the technician and dispatcher see on the ticket. */
  history: TaskHistoryEvent[];
}

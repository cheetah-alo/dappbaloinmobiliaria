import type { Activity, ActivityType, Actor, Approval, ApprovalKind, ApprovalStatus, Attribution, Lead, LeadStage, Property, Role } from '@balo/contracts';

export type OpsMetrics = {
  totalLeads?: number;
  pendingApprovals?: number;
  scheduledVisits?: number;
};

export type OpsDashboard = {
  actor: Actor;
  users: Actor[];
  leads: Lead[];
  properties: Property[];
  approvals: Approval[];
  activities: Activity[];
  metrics?: OpsMetrics;
};

type JsonRecord = Record<string, unknown>;

const roles: Role[] = ['admin', 'user'];
const leadStages: LeadStage[] = ['new', 'qualified', 'visit_scheduled', 'offer_received', 'closed', 'lost'];
const approvalKinds: ApprovalKind[] = ['price', 'publication', 'commission', 'discount', 'closure'];
const approvalStatuses: ApprovalStatus[] = ['pending', 'approved', 'rejected'];
const activityTypes: ActivityType[] = [
  'lead_created',
  'lead_assigned',
  'post_published',
  'visit_scheduled',
  'visit_completed',
  'offer_received',
  'approval_requested',
  'approval_decided',
  'manual_follow_up',
];
const attributionSources: Attribution['source'][] = ['website', 'whatsapp', 'instagram', 'portal', 'manual'];

export class OpsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'OpsApiError';
  }
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : fallback;
}

function normalizeActor(value: unknown): Actor | undefined {
  const input = record(value);
  if (!input || !string(input.id) || !string(input.name)) return undefined;
  return {
    id: string(input.id),
    name: string(input.name),
    role: oneOf(input.role, roles, 'user'),
    email: string(input.email) || undefined,
  };
}

function normalizeAttribution(value: unknown): Attribution {
  const input = record(value) ?? {};
  return {
    source: oneOf(input.source, attributionSources, 'manual'),
    utmSource: string(input.utmSource) || undefined,
    utmCampaign: string(input.utmCampaign) || undefined,
    qrId: string(input.qrId) || undefined,
    postId: string(input.postId) || undefined,
  };
}

function normalizeLead(value: unknown): Lead | undefined {
  const input = record(value);
  if (!input || !string(input.id) || !string(input.ownerName)) return undefined;
  const contact = record(input.contact);
  return {
    id: string(input.id),
    ownerName: string(input.ownerName),
    assigneeId: string(input.assigneeId),
    stage: oneOf(input.stage, leadStages, 'new'),
    consentAt: string(input.consentAt),
    attribution: normalizeAttribution(input.attribution),
    operation: ['sell', 'rent', 'buy', 'invest'].includes(string(input.operation)) ? string(input.operation) as Lead['operation'] : undefined,
    district: string(input.district) || undefined,
    createdAt: string(input.createdAt) || undefined,
    contact: contact && string(contact.phone) ? { phone: string(contact.phone), email: string(contact.email) || undefined } : undefined,
  };
}

function normalizeProperty(value: unknown): Property | undefined {
  const input = record(value);
  const statuses: Property['publicationStatus'][] = ['draft', 'approved', 'published', 'paused'];
  if (!input || !string(input.id) || !string(input.label)) return undefined;
  return {
    id: string(input.id),
    label: string(input.label),
    assigneeId: string(input.assigneeId),
    publicationStatus: oneOf(input.publicationStatus, statuses, 'draft'),
  };
}

function metadata(value: unknown): Record<string, string> {
  const input = record(value) ?? {};
  return Object.fromEntries(Object.entries(input).flatMap(([key, item]) => typeof item === 'string' ? [[key, item]] : []));
}

function normalizeActivity(value: unknown): Activity | undefined {
  const input = record(value);
  if (!input || !string(input.id)) return undefined;
  return {
    id: string(input.id),
    type: oneOf(input.type, activityTypes, 'manual_follow_up'),
    leadId: string(input.leadId) || undefined,
    propertyId: string(input.propertyId) || undefined,
    actorId: string(input.actorId),
    occurredAt: string(input.occurredAt),
    metadata: metadata(input.metadata),
  };
}

function normalizeApproval(value: unknown): Approval | undefined {
  const input = record(value);
  if (!input || !string(input.id) || !string(input.recordId)) return undefined;
  return {
    id: string(input.id),
    kind: oneOf(input.kind, approvalKinds, 'publication'),
    recordId: string(input.recordId),
    requestedBy: string(input.requestedBy),
    status: oneOf(input.status, approvalStatuses, 'pending'),
    approvedBy: string(input.approvedBy) || undefined,
    approvedAt: string(input.approvedAt) || undefined,
    rationale: string(input.rationale),
    decisionReason: string(input.decisionReason) || undefined,
  };
}

function unwrap(value: unknown): JsonRecord {
  const root = record(value) ?? {};
  return record(root.data) ?? root;
}

function normalizeMetrics(value: unknown): OpsMetrics | undefined {
  const input = record(value);
  if (!input) return undefined;
  const number = (item: unknown) => typeof item === 'number' && Number.isFinite(item) ? item : undefined;
  return {
    totalLeads: number(input.totalLeads),
    pendingApprovals: number(input.pendingApprovals),
    scheduledVisits: number(input.scheduledVisits),
  };
}

function normalizeDashboard(value: unknown): Omit<OpsDashboard, 'leads'> {
  const input = unwrap(value);
  const actor = normalizeActor(input.actor);
  if (!actor) throw new OpsApiError('La API no devolvió una identidad autorizada.');
  return {
    actor,
    users: list(input.users).map(normalizeActor).filter((user): user is Actor => Boolean(user)),
    properties: list(input.properties).map(normalizeProperty).filter((property): property is Property => Boolean(property)),
    approvals: list(input.approvals).map(normalizeApproval).filter((approval): approval is Approval => Boolean(approval)),
    activities: list(input.activities).map(normalizeActivity).filter((activity): activity is Activity => Boolean(activity)),
    metrics: normalizeMetrics(input.dashboard ?? input.metrics),
  };
}

function normalizeLeads(value: unknown): Lead[] {
  const input = unwrap(value);
  return list(input.leads).map(normalizeLead).filter((lead): lead is Lead => Boolean(lead));
}

export class OpsApiClient {
  readonly configured: boolean;
  private csrfToken?: string;

  constructor(private readonly baseUrl = (import.meta.env.VITE_OPS_API_URL as string | undefined)?.replace(/\/$/, '') ?? '') {
    this.configured = Boolean(baseUrl);
  }

  private async ensureCsrfToken(): Promise<void> {
    if (this.csrfToken) return;
    const payload = await this.request('/v1/ops/csrf');
    const token = string(record(payload)?.token);
    if (!token) throw new OpsApiError('La API no pudo preparar una sesión segura para esta acción.');
    this.csrfToken = token;
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) await this.ensureCsrfToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(this.csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method) ? { 'x-balo-csrf': this.csrfToken } : {}),
        ...init?.headers,
      },
    });
    const payload = await response.json().catch(() => undefined) as unknown;
    if (!response.ok) {
      if (record(payload)?.code === 'CSRF_VALIDATION_FAILED') this.csrfToken = undefined;
      const message = string(record(payload)?.message) || `La operación no se pudo completar (${response.status}).`;
      throw new OpsApiError(message, response.status);
    }
    return payload;
  }

  async snapshot(): Promise<OpsDashboard> {
    const [dashboardPayload, leadsPayload] = await Promise.all([
      this.request('/v1/ops/dashboard'),
      this.request('/v1/ops/leads'),
    ]);
    return { ...normalizeDashboard(dashboardPayload), leads: normalizeLeads(leadsPayload) };
  }

  async assignLead(leadId: string, assigneeId: string): Promise<void> {
    await this.request(`/v1/ops/leads/${encodeURIComponent(leadId)}/assign`, { method: 'POST', body: JSON.stringify({ assigneeId }) });
  }

  async createActivity(leadId: string, note: string): Promise<void> {
    await this.request(`/v1/ops/leads/${encodeURIComponent(leadId)}/activities`, {
      method: 'POST',
      body: JSON.stringify({ type: 'manual_follow_up', metadata: { note } }),
    });
  }

  async requestApproval(input: { kind: ApprovalKind; recordId: string; rationale: string }): Promise<void> {
    await this.request('/v1/ops/approvals', { method: 'POST', body: JSON.stringify(input) });
  }

  async decideApproval(approvalId: string, decision: Extract<ApprovalStatus, 'approved' | 'rejected'>, rationale: string): Promise<void> {
    await this.request(`/v1/ops/approvals/${encodeURIComponent(approvalId)}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, rationale }),
    });
  }
}

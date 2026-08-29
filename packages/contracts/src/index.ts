export const roles = ['admin', 'user'] as const;
export type Role = (typeof roles)[number];

export type Actor = {
  id: string;
  name: string;
  role: Role;
  email?: string;
};

export const leadStages = ['new', 'qualified', 'visit_scheduled', 'offer_received', 'closed', 'lost'] as const;
export type LeadStage = (typeof leadStages)[number];

export type Lead = {
  id: string;
  ownerName: string;
  assigneeId: string;
  stage: LeadStage;
  consentAt: string;
  attribution: Attribution;
  operation?: OwnerEnquiry['operation'];
  district?: string;
  createdAt?: string;
  contact?: {
    phone: string;
    email?: string;
  };
};

export type Property = {
  id: string;
  label: string;
  assigneeId: string;
  publicationStatus: 'draft' | 'approved' | 'published' | 'paused';
};

export const attributionSources = ['website', 'whatsapp', 'instagram', 'portal', 'manual'] as const;
export type Attribution = {
  source: (typeof attributionSources)[number];
  utmSource?: string;
  utmCampaign?: string;
  qrId?: string;
  postId?: string;
};

export const approvalKinds = ['price', 'publication', 'commission', 'discount', 'closure'] as const;
export type ApprovalKind = (typeof approvalKinds)[number];
export const approvalStatuses = ['pending', 'approved', 'rejected'] as const;
export type ApprovalStatus = (typeof approvalStatuses)[number];

export type Approval = {
  id: string;
  kind: ApprovalKind;
  recordId: string;
  requestedBy: string;
  status: ApprovalStatus;
  approvedBy?: string;
  approvedAt?: string;
  rationale: string;
  decisionReason?: string;
};

export const activityTypes = [
  'lead_created',
  'lead_assigned',
  'post_published',
  'visit_scheduled',
  'visit_completed',
  'offer_received',
  'approval_requested',
  'approval_decided',
  'manual_follow_up',
] as const;
export type ActivityType = (typeof activityTypes)[number];

export type Activity = {
  id: string;
  type: ActivityType;
  leadId?: string;
  propertyId?: string;
  actorId: string;
  occurredAt: string;
  metadata: Record<string, string>;
};

export type OwnerEnquiry = {
  name: string;
  phone: string;
  email?: string;
  operation: 'sell' | 'rent' | 'buy' | 'invest';
  district: string;
  consent: true;
  attribution: Attribution;
};

export type PersistedEvent = {
  eventId: string;
  eventType: 'owner_enquiry' | 'channel_webhook';
  occurredAt: string;
  payload: Record<string, unknown>;
};

export type GatewayEnvelope = {
  timestamp: string;
  signature: string;
  event: PersistedEvent;
};

export type OpsSnapshot = {
  leads: Lead[];
  properties: Property[];
  activities: Activity[];
  approvals: Approval[];
};

export type GatewayResult =
  | { ok: true; eventId: string; deduplicated: boolean }
  | { ok: false; eventId: string; code: 'GATEWAY_UNAVAILABLE' | 'GATEWAY_REJECTED'; manualFollowUp: true };

export const sensitiveApprovalKinds = new Set<ApprovalKind>([
  'price',
  'publication',
  'commission',
  'discount',
  'closure',
]);

export function canAccessAssignedRecord(actor: Actor, record: Pick<Lead | Property, 'assigneeId'>): boolean {
  return actor.role === 'admin' || actor.id === record.assigneeId;
}

export function canAssign(actor: Actor): boolean {
  return actor.role === 'admin';
}

export function canCreateActivity(actor: Actor, record: Pick<Lead | Property, 'assigneeId'>): boolean {
  return canAccessAssignedRecord(actor, record);
}

export function canRequestApproval(actor: Actor, record: Pick<Lead | Property, 'assigneeId'>): boolean {
  return canAccessAssignedRecord(actor, record);
}

export function canApprove(actor: Actor, kind: ApprovalKind): boolean {
  return actor.role === 'admin' && sensitiveApprovalKinds.has(kind);
}

export function transitionNeedsApproval(kind: ApprovalKind, approvals: Approval[]): boolean {
  return !approvals.some((approval) => approval.kind === kind && approval.status === 'approved');
}

export function manualFollowUp(eventId: string): GatewayResult {
  return { ok: false, eventId, code: 'GATEWAY_UNAVAILABLE', manualFollowUp: true };
}

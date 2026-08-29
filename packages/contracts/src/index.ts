export type Role = 'admin' | 'user';

export type Actor = {
  id: string;
  name: string;
  role: Role;
};

export type LeadStage = 'new' | 'qualified' | 'visit_scheduled' | 'offer_received' | 'closed' | 'lost';

export type Lead = {
  id: string;
  ownerName: string;
  assigneeId: string;
  stage: LeadStage;
  consentAt: string;
  attribution: Attribution;
};

export type Property = {
  id: string;
  label: string;
  assigneeId: string;
  publicationStatus: 'draft' | 'approved' | 'published' | 'paused';
};

export type Attribution = {
  source: 'website' | 'whatsapp' | 'instagram' | 'portal' | 'manual';
  utmSource?: string;
  utmCampaign?: string;
  qrId?: string;
  postId?: string;
};

export type ApprovalKind = 'price' | 'publication' | 'commission' | 'discount' | 'closure';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type Approval = {
  id: string;
  kind: ApprovalKind;
  recordId: string;
  requestedBy: string;
  status: ApprovalStatus;
  approvedBy?: string;
  approvedAt?: string;
  rationale: string;
};

export type ActivityType = 'lead_created' | 'post_published' | 'visit_scheduled' | 'offer_received' | 'approval_requested' | 'manual_follow_up';

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

export function canApprove(actor: Actor, kind: ApprovalKind): boolean {
  return actor.role === 'admin' && sensitiveApprovalKinds.has(kind);
}

export function transitionNeedsApproval(kind: ApprovalKind, approvals: Approval[]): boolean {
  return !approvals.some((approval) => approval.kind === kind && approval.status === 'approved');
}

export function manualFollowUp(eventId: string): GatewayResult {
  return { ok: false, eventId, code: 'GATEWAY_UNAVAILABLE', manualFollowUp: true };
}

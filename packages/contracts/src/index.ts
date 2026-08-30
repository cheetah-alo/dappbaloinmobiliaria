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

export const propertyPublicationStatuses = [
  'draft',
  'pending_review',
  'approved',
  'publishing',
  'published',
  'publish_failed',
  'paused',
] as const;
export type PropertyPublicationStatus = (typeof propertyPublicationStatuses)[number];

export const propertyAvailabilityStatuses = ['available', 'reserved', 'sold', 'rented', 'withdrawn'] as const;
export type PropertyAvailabilityStatus = (typeof propertyAvailabilityStatuses)[number];

export const propertyOperations = ['sale', 'rent'] as const;
export type PropertyOperation = (typeof propertyOperations)[number];

export const priceVisibilities = ['consult', 'public'] as const;
export type PriceVisibility = (typeof priceVisibilities)[number];

export const propertyImageCategories = ['cover', 'balcony', 'living', 'kitchen', 'bedroom', 'bathroom', 'study', 'laundry', 'parking', 'building', 'other'] as const;
export type PropertyImageCategory = (typeof propertyImageCategories)[number];

export type Property = {
  id: string;
  slug: string;
  label: string;
  assigneeId: string;
  publicationStatus: PropertyPublicationStatus;
  availabilityStatus: PropertyAvailabilityStatus;
  version: number;
  activeRevisionId?: string;
  draftRevisionId?: string;
  lastVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type Money = {
  currency: 'PEN' | 'USD';
  amount: number;
};

export type PropertyRevision = {
  id: string;
  propertyId: string;
  revision: number;
  title: string;
  operation: PropertyOperation;
  district: string;
  zone?: string;
  builtAreaM2: number;
  totalAreaM2?: number;
  bedrooms: number;
  bathrooms: number;
  parking: number;
  studies: number;
  summary: string;
  features: string[];
  priceVisibility: PriceVisibility;
  askingPrice?: Money;
  priceApprovalId?: string;
  photoApprovalId?: string;
  publicationApprovalId?: string;
  photoAuthorizationConfirmedBy?: string;
  photoAuthorizationConfirmedAt?: string;
  sourceUrl?: string;
  instagramUrl?: string;
  postId?: string;
  privateDetails: {
    exactAddress?: string;
    ownerReference?: string;
    documentNotes?: string;
    negotiationNotes?: string;
  };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type PropertyImage = {
  id: string;
  propertyId: string;
  revisionId: string;
  category: PropertyImageCategory;
  alt: string;
  sortOrder: number;
  isCover: boolean;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: 'image/webp';
  privateObjectKey: string;
  publicObjectKey?: string;
  thumbnailObjectKey?: string;
  status: 'uploading' | 'uploaded' | 'approved' | 'rejected';
  uploadedAt?: string;
};

export type PublicationJob = {
  id: string;
  propertyId: string;
  revisionId: string;
  requestedBy: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  snapshotVersion: number;
  requestedAt: string;
  completedAt?: string;
  deploymentUrl?: string;
  errorCode?: string;
};

export type CatalogImage = {
  id: string;
  url: string;
  thumbnailUrl: string;
  alt: string;
  category: PropertyImageCategory;
  width: number;
  height: number;
  sortOrder: number;
  isCover: boolean;
};

export type CatalogProperty = {
  id: string;
  slug: string;
  title: string;
  operation: PropertyOperation;
  district: string;
  zone?: string;
  builtAreaM2: number;
  totalAreaM2?: number;
  bedrooms: number;
  bathrooms: number;
  parking: number;
  studies: number;
  summary: string;
  features: string[];
  priceVisibility: PriceVisibility;
  price?: Money;
  availabilityStatus: Exclude<PropertyAvailabilityStatus, 'withdrawn'>;
  lastVerifiedAt: string;
  images: CatalogImage[];
  instagramUrl?: string;
  postId?: string;
  publicationApprovalId: string;
};

export type CatalogExport = {
  snapshotVersion: number;
  generatedAt: string;
  properties: CatalogProperty[];
};

export const availabilityFreshnessPolicy = {
  warnAfterDays: 7,
  hideAfterDays: 14,
} as const;
export type AvailabilityFreshness = 'unverified' | 'fresh' | 'warning' | 'expired';

export function propertyAvailabilityFreshness(lastVerifiedAt: string | undefined, now = new Date()): AvailabilityFreshness {
  if (!lastVerifiedAt) return 'unverified';
  const verifiedAt = new Date(lastVerifiedAt);
  if (Number.isNaN(verifiedAt.valueOf()) || verifiedAt > now) return 'unverified';
  const elapsedDays = (now.valueOf() - verifiedAt.valueOf()) / 86_400_000;
  if (elapsedDays >= availabilityFreshnessPolicy.hideAfterDays) return 'expired';
  if (elapsedDays >= availabilityFreshnessPolicy.warnAfterDays) return 'warning';
  return 'fresh';
}

export const attributionSources = ['website', 'whatsapp', 'instagram', 'portal', 'manual'] as const;
export type Attribution = {
  source: (typeof attributionSources)[number];
  utmSource?: string;
  utmCampaign?: string;
  qrId?: string;
  postId?: string;
};

export const approvalKinds = ['price', 'photographs', 'publication', 'commission', 'discount', 'closure'] as const;
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
  'photographs',
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

export function canCreateProperty(actor: Actor): boolean {
  return actor.role === 'admin' || actor.role === 'user';
}

export function canEditProperty(actor: Actor, property: Pick<Property, 'assigneeId'>): boolean {
  return canAccessAssignedRecord(actor, property);
}

export function canPublishProperty(actor: Actor): boolean {
  return actor.role === 'admin';
}

export function canChangePropertyAvailability(actor: Actor): boolean {
  return actor.role === 'admin';
}

function publicMediaUrl(baseUrl: string, objectKey: string): string {
  const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
  return `${baseUrl.replace(/\/$/, '')}/${encodedKey}`;
}

export function toCatalogProperty(
  property: Property,
  revision: PropertyRevision,
  images: PropertyImage[],
  mediaBaseUrl: string,
  publicationTarget: 'active' | 'candidate' = 'active',
): CatalogProperty | null {
  const targetsExpectedRevision = publicationTarget === 'candidate'
    ? property.publicationStatus === 'publishing' && property.draftRevisionId === revision.id
    : property.publicationStatus !== 'paused' && property.activeRevisionId === revision.id;
  if (
    !targetsExpectedRevision
    || property.availabilityStatus === 'withdrawn'
    || !property.lastVerifiedAt
    || !revision.publicationApprovalId
    || !revision.photoApprovalId
    || !revision.photoAuthorizationConfirmedAt
    || !revision.photoAuthorizationConfirmedBy
  ) return null;

  const publicImages = images
    .filter((image) => image.revisionId === revision.id && image.status === 'approved' && image.publicObjectKey && image.thumbnailObjectKey)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((image) => ({
      id: image.id,
      url: publicMediaUrl(mediaBaseUrl, image.publicObjectKey!),
      thumbnailUrl: publicMediaUrl(mediaBaseUrl, image.thumbnailObjectKey!),
      alt: image.alt,
      category: image.category,
      width: image.width,
      height: image.height,
      sortOrder: image.sortOrder,
      isCover: image.isCover,
    }));

  if (!publicImages.length || !publicImages.some((image) => image.isCover)) return null;
  const canExposePrice = revision.priceVisibility === 'public' && Boolean(revision.askingPrice && revision.priceApprovalId);

  return {
    id: property.id,
    slug: property.slug,
    title: revision.title,
    operation: revision.operation,
    district: revision.district,
    ...(revision.zone ? { zone: revision.zone } : {}),
    builtAreaM2: revision.builtAreaM2,
    ...(revision.totalAreaM2 ? { totalAreaM2: revision.totalAreaM2 } : {}),
    bedrooms: revision.bedrooms,
    bathrooms: revision.bathrooms,
    parking: revision.parking,
    studies: revision.studies,
    summary: revision.summary,
    features: revision.features,
    priceVisibility: canExposePrice ? 'public' : 'consult',
    ...(canExposePrice ? { price: revision.askingPrice } : {}),
    availabilityStatus: property.availabilityStatus,
    lastVerifiedAt: property.lastVerifiedAt,
    images: publicImages,
    ...(revision.instagramUrl ? { instagramUrl: revision.instagramUrl } : {}),
    ...(revision.postId ? { postId: revision.postId } : {}),
    publicationApprovalId: revision.publicationApprovalId,
  };
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

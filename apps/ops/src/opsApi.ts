import type {
  Activity,
  ActivityType,
  Actor,
  Approval,
  ApprovalKind,
  ApprovalStatus,
  Attribution,
  Lead,
  LeadStage,
  Property,
  PropertyAvailabilityStatus,
  PropertyImage,
  PropertyImageCategory,
  PropertyOperation,
  PropertyPublicationStatus,
  PropertyRevision,
  PublicationJob,
  Role,
} from '@balo/contracts';

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

export type PropertyDraftInput = {
  expectedVersion: number;
  slug: string;
  label: string;
  assigneeId: string;
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
  priceVisibility: PropertyRevision['priceVisibility'];
  askingPrice?: PropertyRevision['askingPrice'];
  sourceUrl?: string;
  instagramUrl?: string;
  postId?: string;
  privateDetails: PropertyRevision['privateDetails'];
};

export type PropertyWorkspace = {
  property: Property;
  revision: PropertyRevision;
  images: PropertyImage[];
  publicationJobs: PublicationJob[];
};

export type PropertyMediaIntent = {
  intentId: string;
  imageId: string;
  uploadUrl: string | null;
  thumbnailUploadUrl: string | null;
  expiresAt: string;
  uploadToken: string;
  thumbnailUploadToken: string;
  objectKey: string;
  mode: 'r2-proxy' | 'local-metadata';
};

export type CompletePropertyImageInput = {
  uploadToken: string;
  thumbnailUploadToken: string;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: 'image/webp';
  sha256: string;
};

const roles: Role[] = ['admin', 'user'];
const leadStages: LeadStage[] = ['new', 'qualified', 'visit_scheduled', 'offer_received', 'closed', 'lost'];
const approvalKinds: ApprovalKind[] = ['price', 'photographs', 'publication', 'commission', 'discount', 'closure'];
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
const propertyPublicationStatuses: PropertyPublicationStatus[] = ['draft', 'pending_review', 'approved', 'publishing', 'published', 'publish_failed', 'paused'];
const propertyAvailabilityStatuses: PropertyAvailabilityStatus[] = ['available', 'reserved', 'sold', 'rented', 'withdrawn'];
const propertyOperations: PropertyOperation[] = ['sale', 'rent'];
const propertyImageCategories: PropertyImageCategory[] = ['cover', 'balcony', 'living', 'kitchen', 'bedroom', 'bathroom', 'study', 'laundry', 'parking', 'building', 'other'];

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

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return string(value) || undefined;
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
  if (!input || !string(input.id) || !string(input.label)) return undefined;
  return {
    id: string(input.id),
    slug: string(input.slug),
    label: string(input.label),
    assigneeId: string(input.assigneeId),
    publicationStatus: oneOf(input.publicationStatus, propertyPublicationStatuses, 'draft'),
    availabilityStatus: oneOf(input.availabilityStatus, propertyAvailabilityStatuses, 'available'),
    version: number(input.version),
    activeRevisionId: optionalString(input.activeRevisionId),
    draftRevisionId: optionalString(input.draftRevisionId),
    lastVerifiedAt: optionalString(input.lastVerifiedAt),
    createdAt: string(input.createdAt),
    updatedAt: string(input.updatedAt),
  };
}

function normalizeRevision(value: unknown): PropertyRevision | undefined {
  const input = record(value);
  if (!input || !string(input.id) || !string(input.propertyId) || !string(input.title)) return undefined;
  const privateDetails = record(input.privateDetails) ?? {};
  const askingPrice = record(input.askingPrice);
  return {
    id: string(input.id),
    propertyId: string(input.propertyId),
    revision: number(input.revision),
    title: string(input.title),
    operation: oneOf(input.operation, propertyOperations, 'sale'),
    district: string(input.district),
    zone: optionalString(input.zone),
    builtAreaM2: number(input.builtAreaM2),
    totalAreaM2: typeof input.totalAreaM2 === 'number' ? number(input.totalAreaM2) : undefined,
    bedrooms: number(input.bedrooms),
    bathrooms: number(input.bathrooms),
    parking: number(input.parking),
    studies: number(input.studies),
    summary: string(input.summary),
    features: list(input.features).flatMap((item) => typeof item === 'string' ? [item] : []),
    priceVisibility: oneOf(input.priceVisibility, ['consult', 'public'] as const, 'consult'),
    askingPrice: askingPrice && number(askingPrice.amount) > 0
      ? { currency: oneOf(askingPrice.currency, ['PEN', 'USD'] as const, 'PEN'), amount: number(askingPrice.amount) }
      : undefined,
    priceApprovalId: optionalString(input.priceApprovalId),
    photoApprovalId: optionalString(input.photoApprovalId),
    publicationApprovalId: optionalString(input.publicationApprovalId),
    photoAuthorizationConfirmedBy: optionalString(input.photoAuthorizationConfirmedBy),
    photoAuthorizationConfirmedAt: optionalString(input.photoAuthorizationConfirmedAt),
    sourceUrl: optionalString(input.sourceUrl),
    instagramUrl: optionalString(input.instagramUrl),
    postId: optionalString(input.postId),
    privateDetails: {
      exactAddress: optionalString(privateDetails.exactAddress),
      ownerReference: optionalString(privateDetails.ownerReference),
      documentNotes: optionalString(privateDetails.documentNotes),
      negotiationNotes: optionalString(privateDetails.negotiationNotes),
    },
    createdBy: string(input.createdBy),
    createdAt: string(input.createdAt),
    updatedAt: string(input.updatedAt),
  };
}

function normalizePropertyImage(value: unknown): PropertyImage | undefined {
  const input = record(value);
  if (!input || !string(input.id) || !string(input.propertyId) || !string(input.revisionId)) return undefined;
  return {
    id: string(input.id),
    propertyId: string(input.propertyId),
    revisionId: string(input.revisionId),
    category: oneOf(input.category, propertyImageCategories, 'other'),
    alt: string(input.alt),
    sortOrder: number(input.sortOrder),
    isCover: Boolean(input.isCover),
    width: number(input.width),
    height: number(input.height),
    sizeBytes: number(input.sizeBytes),
    mimeType: 'image/webp',
    privateObjectKey: string(input.privateObjectKey),
    publicObjectKey: optionalString(input.publicObjectKey),
    thumbnailObjectKey: optionalString(input.thumbnailObjectKey),
    status: oneOf(input.status, ['uploading', 'uploaded', 'approved', 'rejected'] as const, 'uploaded'),
    uploadedAt: optionalString(input.uploadedAt),
  };
}

function normalizePublicationJob(value: unknown): PublicationJob | undefined {
  const input = record(value);
  if (!input || !string(input.id) || !string(input.propertyId) || !string(input.revisionId)) return undefined;
  return {
    id: string(input.id),
    propertyId: string(input.propertyId),
    revisionId: string(input.revisionId),
    requestedBy: string(input.requestedBy),
    status: oneOf(input.status, ['queued', 'running', 'succeeded', 'failed'] as const, 'queued'),
    snapshotVersion: number(input.snapshotVersion),
    requestedAt: string(input.requestedAt),
    completedAt: optionalString(input.completedAt),
    deploymentUrl: optionalString(input.deploymentUrl),
    errorCode: optionalString(input.errorCode),
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

function normalizeProperties(value: unknown): Property[] {
  const input = unwrap(value);
  return list(input.properties).map(normalizeProperty).filter((property): property is Property => Boolean(property));
}

function normalizePropertyWorkspace(value: unknown): PropertyWorkspace {
  const input = unwrap(value);
  const property = normalizeProperty(input.property);
  const revision = normalizeRevision(input.revision);
  if (!property || !revision) throw new OpsApiError('La API no devolvió una ficha de propiedad válida.');
  return {
    property,
    revision,
    images: list(input.images).map(normalizePropertyImage).filter((image): image is PropertyImage => Boolean(image)),
    publicationJobs: list(input.publicationJobs).map(normalizePublicationJob).filter((job): job is PublicationJob => Boolean(job)),
  };
}

function normalizeMediaIntent(value: unknown): PropertyMediaIntent {
  const input = unwrap(value);
  const intent = record(input.intent) ?? record(list(input.intents)[0]) ?? input;
  const intentId = string(intent.intentId) || string(intent.id);
  const imageId = string(intent.imageId);
  if (!intentId || !imageId || !string(intent.uploadToken) || !string(intent.thumbnailUploadToken)) throw new OpsApiError('La API no devolvió una autorización de carga válida.');
  return {
    intentId,
    imageId,
    uploadUrl: optionalString(intent.uploadUrl) ?? null,
    thumbnailUploadUrl: optionalString(intent.thumbnailUploadUrl) ?? null,
    expiresAt: string(intent.expiresAt),
    uploadToken: string(intent.uploadToken),
    thumbnailUploadToken: string(intent.thumbnailUploadToken),
    objectKey: string(intent.objectKey),
    mode: oneOf(intent.mode, ['r2-proxy', 'local-metadata'] as const, 'local-metadata'),
  };
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
    const [dashboardPayload, leadsPayload, propertiesPayload] = await Promise.all([
      this.request('/v1/ops/dashboard'),
      this.request('/v1/ops/leads'),
      this.request('/v1/ops/properties'),
    ]);
    return { ...normalizeDashboard(dashboardPayload), leads: normalizeLeads(leadsPayload), properties: normalizeProperties(propertiesPayload) };
  }

  async createProperty(input: PropertyDraftInput): Promise<PropertyWorkspace> {
    const revision = {
      title: input.title,
      operation: input.operation,
      district: input.district,
      zone: input.zone,
      builtAreaM2: input.builtAreaM2,
      totalAreaM2: input.totalAreaM2,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      parking: input.parking,
      studies: input.studies,
      summary: input.summary,
      features: input.features,
      priceVisibility: input.priceVisibility,
      askingPrice: input.askingPrice,
      sourceUrl: input.sourceUrl,
      instagramUrl: input.instagramUrl,
      postId: input.postId,
      privateDetails: input.privateDetails,
    };
    const payload = await this.request('/v1/ops/properties', {
      method: 'POST',
      body: JSON.stringify({ property: { slug: input.slug, label: input.label, assigneeId: input.assigneeId }, revision }),
    });
    return normalizePropertyWorkspace(payload);
  }

  async property(propertyId: string): Promise<PropertyWorkspace> {
    return normalizePropertyWorkspace(await this.request(`/v1/ops/properties/${encodeURIComponent(propertyId)}`));
  }

  async saveProperty(propertyId: string, input: PropertyDraftInput): Promise<PropertyWorkspace> {
    const { expectedVersion, label, slug, assigneeId, ...revision } = input;
    await this.request(`/v1/ops/properties/${encodeURIComponent(propertyId)}`, {
      method: 'PUT',
      body: JSON.stringify({ expectedVersion, property: { slug, label, assigneeId }, revision }),
    });
    return this.property(propertyId);
  }

  async createPropertyMediaIntent(propertyId: string, input: {
    expectedVersion: number;
    revisionId: string;
    category: PropertyImageCategory;
    alt: string;
    sortOrder: number;
    isCover: boolean;
    sizeBytes: number;
    sha256: string;
  }): Promise<PropertyMediaIntent> {
    const payload = await this.request(`/v1/ops/properties/${encodeURIComponent(propertyId)}/media/intents`, {
      method: 'POST',
      body: JSON.stringify({
        expectedVersion: input.expectedVersion,
        revisionId: input.revisionId,
        files: [{
          category: input.category,
          alt: input.alt,
          sortOrder: input.sortOrder,
          isCover: input.isCover,
          sizeBytes: input.sizeBytes,
          mimeType: 'image/webp',
          sha256: input.sha256,
        }],
      }),
    });
    return normalizeMediaIntent(payload);
  }

  async uploadPropertyImage(intent: PropertyMediaIntent, main: Blob, thumbnail: Blob): Promise<void> {
    if (intent.mode === 'local-metadata') return;
    if (!intent.uploadUrl) throw new OpsApiError('La autorización no incluye una URL para cargar la fotografía.');
    const uploadHeaders = { 'content-type': 'image/webp', ...(this.csrfToken ? { 'x-balo-csrf': this.csrfToken } : {}) };
    const mainResponse = await fetch(intent.uploadUrl, { method: 'PUT', body: main, credentials: 'include', headers: uploadHeaders });
    if (!mainResponse.ok) throw new OpsApiError(`La fotografía no se cargó (${mainResponse.status}).`, mainResponse.status);
    if (intent.thumbnailUploadUrl) {
      const thumbnailResponse = await fetch(intent.thumbnailUploadUrl, { method: 'PUT', body: thumbnail, credentials: 'include', headers: uploadHeaders });
      if (!thumbnailResponse.ok) throw new OpsApiError(`La miniatura no se cargó (${thumbnailResponse.status}).`, thumbnailResponse.status);
    }
  }

  async completePropertyMedia(intentId: string, input: CompletePropertyImageInput): Promise<PropertyImage> {
    const payload = unwrap(await this.request(`/v1/ops/media/intents/${encodeURIComponent(intentId)}/complete`, {
      method: 'POST',
      body: JSON.stringify(input),
    }));
    const image = normalizePropertyImage(payload.image);
    if (!image) throw new OpsApiError('La API no confirmó la fotografía procesada.');
    return image;
  }

  async updatePropertyMedia(propertyId: string, expectedVersion: number, images: Array<Pick<PropertyImage, 'id' | 'category' | 'alt' | 'sortOrder' | 'isCover'>>): Promise<PropertyWorkspace> {
    await this.request(`/v1/ops/properties/${encodeURIComponent(propertyId)}/media`, {
      method: 'PATCH',
      body: JSON.stringify({ expectedVersion, images }),
    });
    return this.property(propertyId);
  }

  async submitProperty(propertyId: string, expectedVersion: number, photoAuthorizationConfirmed: true): Promise<PropertyWorkspace> {
    await this.request(`/v1/ops/properties/${encodeURIComponent(propertyId)}/submit`, {
      method: 'POST',
      body: JSON.stringify({ expectedVersion, photoAuthorizationConfirmed }),
    });
    return this.property(propertyId);
  }

  async publishProperty(propertyId: string, expectedVersion: number): Promise<PropertyWorkspace> {
    await this.request(`/v1/ops/properties/${encodeURIComponent(propertyId)}/publish`, {
      method: 'POST',
      body: JSON.stringify({ expectedVersion }),
    });
    return this.property(propertyId);
  }

  async changePropertyAvailability(propertyId: string, input: { expectedVersion: number; availabilityStatus: PropertyAvailabilityStatus; reason: string }): Promise<PropertyWorkspace> {
    await this.request(`/v1/ops/properties/${encodeURIComponent(propertyId)}/availability`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return this.property(propertyId);
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

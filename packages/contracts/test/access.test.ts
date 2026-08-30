import { describe, expect, it } from 'vitest';
import { canAccessAssignedRecord, canApprove, canAssign, canChangePropertyAvailability, canCreateActivity, canCreateProperty, canEditProperty, canPublishProperty, canRequestApproval, manualFollowUp, propertyAvailabilityFreshness, toCatalogProperty, transitionNeedsApproval, type Actor, type Approval, type Property, type PropertyImage, type PropertyRevision } from '../src/index';
import { ownerEnquirySchema, propertyDraftSchema, propertyMediaIntentSchema } from '../src/validation';

const orlando: Actor = { id: 'orlando', name: 'Orlando', role: 'admin' };
const gestor: Actor = { id: 'gestor-ana', name: 'Ana', role: 'user' };
const otherGestor: Actor = { id: 'gestor-luis', name: 'Luis', role: 'user' };

describe('permisos del piloto', () => {
  it('restringe al gestor a sus registros asignados y permite a Orlando supervisar', () => {
    const assignedLead = { assigneeId: gestor.id };
    expect(canAccessAssignedRecord(gestor, assignedLead)).toBe(true);
    expect(canAccessAssignedRecord(otherGestor, assignedLead)).toBe(false);
    expect(canAccessAssignedRecord(orlando, assignedLead)).toBe(true);
  });

  it('solo permite aprobar decisiones sensibles al administrador', () => {
    expect(canApprove(orlando, 'price')).toBe(true);
    expect(canApprove(orlando, 'photographs')).toBe(true);
    expect(canApprove(gestor, 'price')).toBe(false);
  });

  it('reserva las asignaciones al administrador y permite que un gestor trabaje su caso', () => {
    const assignedLead = { assigneeId: gestor.id };
    expect(canAssign(orlando)).toBe(true);
    expect(canAssign(gestor)).toBe(false);
    expect(canCreateActivity(gestor, assignedLead)).toBe(true);
    expect(canRequestApproval(gestor, assignedLead)).toBe(true);
    expect(canCreateActivity(otherGestor, assignedLead)).toBe(false);
  });

  it('bloquea una decisión hasta que una aprobación haya quedado registrada', () => {
    const pending: Approval[] = [{ id: 'ap-1', kind: 'publication', recordId: 'p-1', requestedBy: gestor.id, status: 'pending', rationale: 'Salida inicial' }];
    expect(transitionNeedsApproval('publication', pending)).toBe(true);
    expect(transitionNeedsApproval('publication', [{ ...pending[0], status: 'approved', approvedBy: orlando.id, approvedAt: '2026-08-29T10:00:00.000Z' }])).toBe(false);
  });

  it('no inventa confirmación cuando el registro externo falla', () => {
    expect(manualFollowUp('evt-123')).toEqual({ ok: false, eventId: 'evt-123', code: 'GATEWAY_UNAVAILABLE', manualFollowUp: true });
  });

  it('solo acepta la captación cuando hay consentimiento y atribución válida', () => {
    expect(ownerEnquirySchema.safeParse({
      name: 'Propietaria demo',
      phone: '+51 999 111 222',
      operation: 'sell',
      district: 'Miraflores',
      consent: true,
      attribution: { source: 'website', qrId: 'qr-demo' },
    }).success).toBe(true);
    expect(ownerEnquirySchema.safeParse({
      name: 'Propietaria demo',
      phone: '+51 999 111 222',
      operation: 'sell',
      district: 'Miraflores',
      consent: false,
      attribution: { source: 'website' },
    }).success).toBe(false);
  });

  it('separa edición asignada de publicación y disponibilidad reservadas a Orlando', () => {
    const property: Property = {
      id: 'property-1', slug: 'departamento-demo', label: 'Departamento demo', assigneeId: gestor.id,
      publicationStatus: 'draft', availabilityStatus: 'available', version: 1,
      createdAt: '2026-08-30T10:00:00.000Z', updatedAt: '2026-08-30T10:00:00.000Z',
    };
    expect(canCreateProperty(gestor)).toBe(true);
    expect(canEditProperty(gestor, property)).toBe(true);
    expect(canEditProperty(otherGestor, property)).toBe(false);
    expect(canPublishProperty(gestor)).toBe(false);
    expect(canPublishProperty(orlando)).toBe(true);
    expect(canChangePropertyAvailability(gestor)).toBe(false);
    expect(canChangePropertyAvailability(orlando)).toBe(true);
  });

  it('valida borradores sin hacer pública la dirección ni aceptar precio público incompleto', () => {
    const draft = {
      expectedVersion: 0,
      slug: 'departamento-107m2-jesus-maria', label: 'JM 107', assigneeId: gestor.id,
      title: 'Departamento de 107 m² en Jesús María', operation: 'sale', district: 'Jesús María',
      builtAreaM2: 107, bedrooms: 3, bathrooms: 2, parking: 1, studies: 1,
      summary: 'Un departamento amplio y luminoso con estudio independiente y distribución funcional.',
      features: ['Estudio independiente'], priceVisibility: 'consult',
      privateDetails: { exactAddress: 'Dirección privada de demostración' },
    };
    expect(propertyDraftSchema.safeParse(draft).success).toBe(true);
    expect(propertyDraftSchema.safeParse({ ...draft, priceVisibility: 'public' }).success).toBe(false);
  });

  it('limita intenciones de carga a formatos de imagen y doce megabytes', () => {
    const intent = { expectedVersion: 1, revisionId: 'rev-1', files: [{ category: 'living', alt: 'Sala luminosa', sortOrder: 0, isCover: true, mimeType: 'image/webp', sha256: 'a'.repeat(64), sizeBytes: 1_000_000 }] };
    expect(propertyMediaIntentSchema.safeParse(intent).success).toBe(true);
    expect(propertyMediaIntentSchema.safeParse({ ...intent, files: [{ ...intent.files[0], mimeType: 'text/html' }] }).success).toBe(false);
    expect(propertyMediaIntentSchema.safeParse({ ...intent, files: [{ ...intent.files[0], sizeBytes: 13 * 1024 * 1024 }] }).success).toBe(false);
  });

  it('exporta únicamente campos públicos y oculta el precio sin aprobación vigente', () => {
    const property: Property = {
      id: 'property-1', slug: 'departamento-demo', label: 'Departamento demo', assigneeId: gestor.id,
      publicationStatus: 'published', availabilityStatus: 'available', version: 3,
      activeRevisionId: 'revision-2', lastVerifiedAt: '2026-08-30T10:00:00.000Z',
      createdAt: '2026-08-29T10:00:00.000Z', updatedAt: '2026-08-30T10:00:00.000Z',
    };
    const revision: PropertyRevision = {
      id: 'revision-2', propertyId: property.id, revision: 2, title: 'Departamento luminoso en Jesús María',
      operation: 'sale', district: 'Jesús María', builtAreaM2: 107, bedrooms: 3, bathrooms: 2, parking: 1,
      studies: 1, summary: 'Departamento de demostración con distribución funcional y ambientes luminosos para una familia.',
      features: ['Estudio independiente'], priceVisibility: 'public', askingPrice: { currency: 'PEN', amount: 987654 },
      publicationApprovalId: 'approval-publication', photoApprovalId: 'approval-photographs', photoAuthorizationConfirmedBy: orlando.id,
      photoAuthorizationConfirmedAt: '2026-08-30T09:00:00.000Z', privateDetails: { exactAddress: 'Dirección privada' },
      createdBy: gestor.id, createdAt: '2026-08-30T08:00:00.000Z', updatedAt: '2026-08-30T09:00:00.000Z',
    };
    const images: PropertyImage[] = [{
      id: 'image-1', propertyId: property.id, revisionId: revision.id, category: 'cover', alt: 'Sala luminosa',
      sortOrder: 0, isCover: true, width: 1600, height: 1200, sizeBytes: 500000, mimeType: 'image/webp',
      privateObjectKey: 'private/property-1/image-1.webp', publicObjectKey: 'public/property-1/revision-2/image-1.webp',
      thumbnailObjectKey: 'public/property-1/revision-2/image-1-thumb.webp', status: 'approved',
    }];
    const exported = toCatalogProperty(property, revision, images, 'https://media.example');
    expect(exported).toMatchObject({ id: property.id, priceVisibility: 'consult' });
    expect(exported).not.toHaveProperty('price');
    expect(JSON.stringify(exported)).not.toContain('Dirección privada');
    expect(toCatalogProperty(property, { ...revision, priceApprovalId: 'approval-price' }, images, 'https://media.example')).toMatchObject({
      priceVisibility: 'public', price: { currency: 'PEN', amount: 987654 },
    });
    expect(toCatalogProperty(property, { ...revision, photoApprovalId: undefined }, images, 'https://media.example')).toBeNull();
    const candidate = {
      ...property,
      publicationStatus: 'publishing' as const,
      activeRevisionId: 'revision-1',
      draftRevisionId: revision.id,
    };
    expect(toCatalogProperty(candidate, revision, images, 'https://media.example')).toBeNull();
    expect(toCatalogProperty(candidate, revision, images, 'https://media.example', 'candidate')).toMatchObject({ id: property.id });
    const activeRevision = { ...revision, id: 'revision-1' };
    const activeImages = images.map((image) => ({ ...image, revisionId: activeRevision.id }));
    expect(toCatalogProperty({ ...candidate, publicationStatus: 'publish_failed' }, activeRevision, activeImages, 'https://media.example')).toMatchObject({ id: property.id });
  });

  it('distingue disponibilidad vigente, por validar y vencida sin publicar contenido nuevo', () => {
    const now = new Date('2026-08-30T12:00:00.000Z');
    expect(propertyAvailabilityFreshness(undefined, now)).toBe('unverified');
    expect(propertyAvailabilityFreshness('2026-08-24T12:00:01.000Z', now)).toBe('fresh');
    expect(propertyAvailabilityFreshness('2026-08-23T12:00:00.000Z', now)).toBe('warning');
    expect(propertyAvailabilityFreshness('2026-08-16T12:00:00.000Z', now)).toBe('expired');
  });
});

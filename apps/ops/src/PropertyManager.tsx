import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  canChangePropertyAvailability,
  canCreateProperty,
  canEditProperty,
  canPublishProperty,
  propertyAvailabilityFreshness,
  type Actor,
  type Property,
  type PropertyAvailabilityStatus,
  type PropertyImage,
  type PropertyImageCategory,
  type PropertyRevision,
} from '@balo/contracts';
import {
  OpsApiClient,
  OpsApiError,
  type PropertyDraftInput,
  type PropertyWorkspace,
} from './opsApi';
import {
  ACCEPTED_PROPERTY_IMAGE_TYPES,
  MAX_PROPERTY_IMAGES,
  processPropertyImage,
  type ProcessedPropertyImage,
} from './propertyImages';

type EditorImage = PropertyImage & {
  previewUrl?: string;
  processed?: ProcessedPropertyImage;
  pending: boolean;
};

type EditableWorkspace = Omit<PropertyWorkspace, 'images'> & { images: EditorImage[] };

type Props = {
  actor: Actor;
  users: Actor[];
  properties: Property[];
  demoMode: boolean;
  api: OpsApiClient;
  onRefresh: () => Promise<boolean>;
};

const NOW = '2026-08-30T12:00:00.000Z';

export const demoProperties: Property[] = [
  {
    id: 'BALO-JM-112', slug: 'departamento-112m2-jesus-maria', label: 'JM 112', assigneeId: 'ana',
    publicationStatus: 'draft', availabilityStatus: 'available', version: 1,
    draftRevisionId: 'revision-demo-jm-112', createdAt: NOW, updatedAt: NOW,
  },
  {
    id: 'BALO-JM-HUASCAR-107', slug: 'departamento-107m2-jesus-maria', label: 'JM 107 con estudio', assigneeId: 'luis',
    publicationStatus: 'draft', availabilityStatus: 'available', version: 1,
    draftRevisionId: 'revision-demo-jm-107', createdAt: NOW, updatedAt: NOW,
  },
];

const summaries: Record<string, string> = {
  'BALO-JM-112': 'Departamento amplio y luminoso, con ambientes bien distribuidos y un balcón que conecta el interior con la ciudad.',
  'BALO-JM-HUASCAR-107': 'Departamento luminoso con estudio independiente, cocina abierta y una distribución pensada para vivir y trabajar con comodidad.',
};

function demoWorkspace(property: Property, actorId: string): EditableWorkspace {
  const isStudy = property.id === 'BALO-JM-HUASCAR-107';
  return {
    property,
    revision: {
      id: property.draftRevisionId ?? `revision-${property.id}`,
      propertyId: property.id,
      revision: 1,
      title: isStudy ? 'Departamento de 107 m² con estudio en Jesús María' : 'Departamento de 112 m² en Jesús María',
      operation: 'sale',
      district: 'Jesús María',
      builtAreaM2: isStudy ? 107 : 112,
      bedrooms: 3,
      bathrooms: 2,
      parking: 1,
      studies: isStudy ? 1 : 0,
      summary: summaries[property.id],
      features: isStudy ? ['Estudio independiente', 'Cocina abierta', 'Balcón con vista'] : ['Balcón amplio', 'Vista abierta', 'Ambientes luminosos'],
      priceVisibility: 'consult',
      privateDetails: {},
      createdBy: actorId,
      createdAt: NOW,
      updatedAt: NOW,
    },
    images: [],
    publicationJobs: [],
  };
}

const publicationLabels: Record<Property['publicationStatus'], string> = {
  draft: 'Borrador', pending_review: 'Pendiente de revisión', approved: 'Aprobada', publishing: 'Publicando',
  published: 'Publicada', publish_failed: 'Falló la publicación', paused: 'Pausada',
};

const availabilityLabels: Record<PropertyAvailabilityStatus, string> = {
  available: 'Disponible', reserved: 'Reservada', sold: 'Vendida', rented: 'Alquilada', withdrawn: 'Retirada',
};

const categoryLabels: Record<PropertyImageCategory, string> = {
  cover: 'Portada', balcony: 'Balcón', living: 'Sala', kitchen: 'Cocina', bedroom: 'Dormitorio', bathroom: 'Baño',
  study: 'Estudio', laundry: 'Lavandería', parking: 'Cochera', building: 'Edificio', other: 'Otro ambiente',
};

const emptyDraft = (actor: Actor): PropertyDraftInput => ({
  expectedVersion: 0,
  slug: '',
  label: '',
  assigneeId: actor.role === 'admin' ? '' : actor.id,
  title: '',
  operation: 'sale',
  district: '',
  builtAreaM2: 0,
  bedrooms: 0,
  bathrooms: 0,
  parking: 0,
  studies: 0,
  summary: '',
  features: [],
  priceVisibility: 'consult',
  privateDetails: {},
});

function draftFromWorkspace(workspace: EditableWorkspace): PropertyDraftInput {
  const { property, revision } = workspace;
  return {
    expectedVersion: property.version,
    slug: property.slug,
    label: property.label,
    assigneeId: property.assigneeId,
    title: revision.title,
    operation: revision.operation,
    district: revision.district,
    zone: revision.zone,
    builtAreaM2: revision.builtAreaM2,
    totalAreaM2: revision.totalAreaM2,
    bedrooms: revision.bedrooms,
    bathrooms: revision.bathrooms,
    parking: revision.parking,
    studies: revision.studies,
    summary: revision.summary,
    features: revision.features,
    priceVisibility: revision.priceVisibility,
    askingPrice: revision.askingPrice,
    sourceUrl: revision.sourceUrl,
    instagramUrl: revision.instagramUrl,
    postId: revision.postId,
    privateDetails: revision.privateDetails,
  };
}

function editableWorkspace(workspace: PropertyWorkspace): EditableWorkspace {
  return { ...workspace, images: workspace.images.map((image) => ({ ...image, pending: false })) };
}

function uiError(error: unknown): string {
  if (error instanceof OpsApiError && error.status === 409) return 'La ficha cambió en otra sesión. Recarga antes de guardar para no perder información.';
  if (error instanceof Error) return error.message;
  return 'No pudimos completar esta acción.';
}

function localPropertyId(slug: string): string {
  const compact = slug.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `BALO-${compact || Date.now()}`;
}

function revisionFromDraft(propertyId: string, draft: PropertyDraftInput, actorId: string, revision = 1): PropertyRevision {
  return {
    id: `revision-${propertyId}-${revision}`,
    propertyId,
    revision,
    title: draft.title,
    operation: draft.operation,
    district: draft.district,
    zone: draft.zone,
    builtAreaM2: draft.builtAreaM2,
    totalAreaM2: draft.totalAreaM2,
    bedrooms: draft.bedrooms,
    bathrooms: draft.bathrooms,
    parking: draft.parking,
    studies: draft.studies,
    summary: draft.summary,
    features: draft.features,
    priceVisibility: draft.priceVisibility,
    askingPrice: draft.askingPrice,
    sourceUrl: draft.sourceUrl,
    instagramUrl: draft.instagramUrl,
    postId: draft.postId,
    privateDetails: draft.privateDetails,
    createdBy: actorId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function validateDraft(draft: PropertyDraftInput): string | undefined {
  if (!draft.slug.match(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)) return 'La URL debe usar minúsculas, números y guiones.';
  if (draft.label.trim().length < 3 || draft.title.trim().length < 8) return 'Completa el nombre interno y el título público.';
  if (!draft.assigneeId) return 'Asigna una persona responsable.';
  if (draft.district.trim().length < 2 || draft.builtAreaM2 <= 0) return 'Completa el distrito y el área construida.';
  if (draft.summary.trim().length < 40) return 'La descripción debe tener al menos 40 caracteres.';
  if (draft.priceVisibility === 'public' && !draft.askingPrice?.amount) return 'Indica el precio que Orlando aprobará para mostrar públicamente.';
  if (draft.totalAreaM2 && draft.totalAreaM2 < draft.builtAreaM2) return 'El área total no puede ser menor al área construida.';
  return undefined;
}

function availabilityFreshness(lastVerifiedAt?: string): { level: 'missing' | 'fresh' | 'warning' | 'expired'; message: string } {
  const level = propertyAvailabilityFreshness(lastVerifiedAt);
  if (level === 'unverified') return { level: 'missing', message: 'Disponibilidad pendiente de validar antes de publicar.' };
  if (level === 'expired') return { level, message: 'Han pasado 14 días o más: la ficha debe ocultarse hasta reconfirmar disponibilidad.' };
  const days = Math.floor((Date.now() - Date.parse(lastVerifiedAt!)) / 86_400_000);
  if (level === 'warning') return { level, message: `Última validación hace ${days} días: Orlando debe reconfirmarla.` };
  return { level: 'fresh', message: `Disponibilidad validada hace ${Math.max(0, days)} día${days === 1 ? '' : 's'}.` };
}

export function PropertyManager({ actor, users, properties, demoMode, api, onRefresh }: Props) {
  const [propertyList, setPropertyList] = useState(properties);
  const [workspaces, setWorkspaces] = useState<Record<string, EditableWorkspace>>({});
  const [selectedId, setSelectedId] = useState(properties[0]?.id ?? '');
  const [draft, setDraft] = useState<PropertyDraftInput>(() => emptyDraft(actor));
  const [features, setFeatures] = useState('');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [creating, setCreating] = useState(false);
  const [photoAuthorized, setPhotoAuthorized] = useState(false);
  const [galleryDirty, setGalleryDirty] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const previewUrls = useRef(new Set<string>());

  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
  }, []);

  useEffect(() => {
    if (!demoMode) {
      setPropertyList(properties);
      setWorkspaces((current) => Object.fromEntries(Object.entries(current).filter(([propertyId, cached]) => {
        const latest = properties.find((property) => property.id === propertyId);
        return latest
          && latest.version === cached.property.version
          && latest.publicationStatus === cached.property.publicationStatus
          && latest.availabilityStatus === cached.property.availabilityStatus
          && latest.updatedAt === cached.property.updatedAt;
      })));
    }
  }, [demoMode, properties]);

  const visibleProperties = useMemo(
    () => propertyList.filter((property) => canEditProperty(actor, property)),
    [actor, propertyList],
  );
  const workspace = selectedId ? workspaces[selectedId] : undefined;
  const editorImages = workspace?.images ?? [];

  useEffect(() => {
    if (creating) return;
    if (visibleProperties.length && !visibleProperties.some((property) => property.id === selectedId)) {
      setSelectedId(visibleProperties[0].id);
    }
  }, [creating, selectedId, visibleProperties]);

  useEffect(() => {
    if (!selectedId || creating || workspaces[selectedId]) return;
    const selected = propertyList.find((property) => property.id === selectedId);
    if (!selected) return;
    if (demoMode) {
      const loaded = demoWorkspace(selected, actor.id);
      setWorkspaces((current) => ({ ...current, [selectedId]: loaded }));
      setDraft(draftFromWorkspace(loaded));
      setFeatures(loaded.revision.features.join('\n'));
      setPhotoAuthorized(Boolean(loaded.revision.photoAuthorizationConfirmedAt));
      setGalleryDirty(false);
      return;
    }
    setBusy('load'); setError(undefined);
    void api.property(selectedId).then((result) => {
      const loaded = editableWorkspace(result);
      setWorkspaces((current) => ({ ...current, [selectedId]: loaded }));
      setDraft(draftFromWorkspace(loaded));
      setFeatures(loaded.revision.features.join('\n'));
      setPhotoAuthorized(Boolean(loaded.revision.photoAuthorizationConfirmedAt));
      setGalleryDirty(false);
    }).catch((requestError) => setError(`No pudimos abrir la ficha. ${uiError(requestError)}`)).finally(() => setBusy(undefined));
  }, [actor.id, api, creating, demoMode, propertyList, selectedId, workspaces]);

  function selectProperty(propertyId: string): void {
    setCreating(false); setSelectedId(propertyId); setStep(1); setNotice(undefined); setError(undefined);
    const cached = workspaces[propertyId];
    if (cached) {
      setDraft(draftFromWorkspace(cached));
      setFeatures(cached.revision.features.join('\n'));
      setPhotoAuthorized(Boolean(cached.revision.photoAuthorizationConfirmedAt));
      setGalleryDirty(false);
    }
  }

  function startProperty(): void {
    setCreating(true); setSelectedId(''); setDraft(emptyDraft(actor)); setFeatures(''); setPhotoAuthorized(false); setStep(1); setNotice(undefined); setError(undefined);
    setGalleryDirty(false);
  }

  function patchDraft(patch: Partial<PropertyDraftInput>): void {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function patchPrivateDetails(patch: Partial<PropertyRevision['privateDetails']>): void {
    setDraft((current) => ({ ...current, privateDetails: { ...current.privateDetails, ...patch } }));
  }

  function updateWorkspace(next: EditableWorkspace): void {
    setWorkspaces((current) => ({ ...current, [next.property.id]: next }));
    setPropertyList((current) => {
      const found = current.some((property) => property.id === next.property.id);
      return found ? current.map((property) => property.id === next.property.id ? next.property : property) : [next.property, ...current];
    });
    setSelectedId(next.property.id);
    setDraft(draftFromWorkspace(next));
    setFeatures(next.revision.features.join('\n'));
  }

  async function saveInformation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalized = { ...draft, features: features.split('\n').map((item) => item.trim()).filter(Boolean) };
    const invalid = validateDraft(normalized);
    if (invalid) { setError(invalid); return; }
    setBusy('save'); setNotice(undefined); setError(undefined);
    try {
      if (demoMode) {
        const propertyId = creating ? localPropertyId(normalized.slug) : selectedId;
        const current = workspaces[propertyId];
        const version = creating ? 1 : (current?.property.version ?? normalized.expectedVersion) + 1;
        const now = new Date().toISOString();
        const property: Property = {
          id: propertyId, slug: normalized.slug, label: normalized.label, assigneeId: normalized.assigneeId,
          publicationStatus: 'draft',
          availabilityStatus: current?.property.availabilityStatus ?? 'available', version,
          activeRevisionId: current?.property.activeRevisionId,
          draftRevisionId: `revision-${propertyId}-${version}`,
          lastVerifiedAt: current?.property.lastVerifiedAt,
          createdAt: current?.property.createdAt ?? now,
          updatedAt: now,
        };
        const next: EditableWorkspace = {
          property,
          revision: revisionFromDraft(propertyId, normalized, actor.id, version),
          images: current?.images ?? [],
          publicationJobs: current?.publicationJobs ?? [],
        };
        updateWorkspace(next);
        setCreating(false);
        setNotice('Borrador guardado en esta sesión de demostración.');
      } else {
        const result = creating ? await api.createProperty(normalized) : await api.saveProperty(selectedId, normalized);
        updateWorkspace(editableWorkspace(result));
        setCreating(false);
        setNotice('Borrador guardado con control de versión.');
      }
      setStep(2);
    } catch (requestError) {
      setError(`El borrador no se guardó. ${uiError(requestError)}`);
    } finally { setBusy(undefined); }
  }

  async function addImages(files: FileList | null): Promise<void> {
    if (!workspace || !files?.length) return;
    if (workspace.images.length + files.length > MAX_PROPERTY_IMAGES) {
      setError(`La ficha admite un máximo de ${MAX_PROPERTY_IMAGES} fotografías.`); return;
    }
    setBusy('process-images'); setNotice(undefined); setError(undefined);
    const accepted: EditorImage[] = [];
    try {
      for (const file of Array.from(files)) {
        const processed = await processPropertyImage(file);
        previewUrls.current.add(processed.previewUrl);
        const id = crypto.randomUUID();
        const order = workspace.images.length + accepted.length;
        accepted.push({
          id, propertyId: workspace.property.id, revisionId: workspace.revision.id,
          category: order === 0 ? 'cover' : 'other', alt: `${workspace.revision.title} · fotografía ${order + 1}`,
          sortOrder: order, isCover: order === 0, width: processed.width, height: processed.height,
          sizeBytes: processed.sizeBytes, mimeType: 'image/webp', privateObjectKey: `pending/${id}.webp`,
          status: 'uploading', previewUrl: processed.previewUrl, processed, pending: true,
        });
      }
      setWorkspaces((current) => ({ ...current, [workspace.property.id]: { ...workspace, images: [...workspace.images, ...accepted] } }));
      setGalleryDirty(true);
      setNotice(`${accepted.length} fotografía${accepted.length === 1 ? '' : 's'} procesada${accepted.length === 1 ? '' : 's'} a WebP sin metadatos. Guarda la galería para registrarlas.`);
    } catch (processingError) {
      accepted.forEach((image) => {
        if (image.previewUrl) { URL.revokeObjectURL(image.previewUrl); previewUrls.current.delete(image.previewUrl); }
      });
      setError(uiError(processingError));
    } finally { setBusy(undefined); }
  }

  function updateImages(update: (images: EditorImage[]) => EditorImage[]): void {
    if (!workspace) return;
    setWorkspaces((current) => ({ ...current, [workspace.property.id]: { ...workspace, images: update(workspace.images).map((image, index) => ({ ...image, sortOrder: index })) } }));
    setGalleryDirty(true);
  }

  function moveImage(imageId: string, direction: -1 | 1): void {
    updateImages((images) => {
      const index = images.findIndex((image) => image.id === imageId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= images.length) return images;
      const next = [...images];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function setCover(imageId: string): void {
    updateImages((images) => images.map((image) => ({ ...image, isCover: image.id === imageId, category: image.id === imageId ? 'cover' : image.category === 'cover' ? 'other' : image.category })));
  }

  function patchImage(imageId: string, patch: Partial<EditorImage>): void {
    updateImages((images) => images.map((image) => image.id === imageId ? { ...image, ...patch } : image));
  }

  function removePendingImage(imageId: string): void {
    updateImages((images) => {
      const found = images.find((image) => image.id === imageId);
      if (!found?.pending) return images;
      if (found.previewUrl) { URL.revokeObjectURL(found.previewUrl); previewUrls.current.delete(found.previewUrl); }
      const remaining = images.filter((image) => image.id !== imageId);
      if (found.isCover && remaining[0]) remaining[0] = { ...remaining[0], isCover: true, category: 'cover' };
      return remaining;
    });
  }

  async function saveGallery(): Promise<void> {
    if (!workspace) return;
    const pending = workspace.images.filter((image) => image.pending && image.processed);
    if (!pending.length && !galleryDirty) { setNotice('La galería ya está guardada.'); return; }
    setBusy('save-images'); setNotice(undefined); setError(undefined);
    try {
      const completed = new Map<string, EditorImage>();
      for (const image of pending) {
        if (!image.processed) continue;
        if (demoMode) {
          completed.set(image.id, { ...image, status: 'uploaded', pending: false, processed: undefined, privateObjectKey: `demo/${image.id}.webp` });
          continue;
        }
        const intent = await api.createPropertyMediaIntent(workspace.property.id, {
          expectedVersion: workspace.property.version,
          revisionId: workspace.revision.id,
          category: image.category,
          alt: image.alt,
          sortOrder: image.sortOrder,
          isCover: image.isCover,
          sizeBytes: image.processed.sizeBytes,
          sha256: image.processed.sha256,
        });
        await api.uploadPropertyImage(intent, image.processed.main, image.processed.thumbnail);
        const saved = await api.completePropertyMedia(intent.intentId, {
          uploadToken: intent.uploadToken,
          thumbnailUploadToken: intent.thumbnailUploadToken,
          width: image.width, height: image.height, sizeBytes: image.sizeBytes,
          mimeType: 'image/webp', sha256: image.processed.sha256,
        });
        completed.set(image.id, { ...saved, previewUrl: image.previewUrl, pending: false });
      }
      const completedImages = workspace.images.map((image) => completed.get(image.id) ?? image);
      if (demoMode) {
        setWorkspaces((current) => ({ ...current, [workspace.property.id]: { ...workspace, images: completedImages } }));
      } else {
        const savedWorkspace = editableWorkspace(await api.updatePropertyMedia(workspace.property.id, workspace.property.version, completedImages.map(({ id, category, alt, sortOrder, isCover }) => ({ id, category, alt, sortOrder, isCover }))));
        const previewById = new Map(completedImages.flatMap((image) => image.previewUrl ? [[image.id, image.previewUrl] as const] : []));
        savedWorkspace.images = savedWorkspace.images.map((image) => ({ ...image, previewUrl: previewById.get(image.id) }));
        updateWorkspace(savedWorkspace);
      }
      setGalleryDirty(false);
      setNotice(demoMode ? 'Galería guardada en esta sesión ficticia.' : 'Galería registrada. Las fotografías todavía no son públicas.');
    } catch (requestError) {
      setError(`La galería no quedó registrada por completo. ${uiError(requestError)} Revisa el estado antes de reintentar.`);
    } finally { setBusy(undefined); }
  }

  async function submitForReview(): Promise<void> {
    if (!workspace) return;
    if (!photoAuthorized) { setError('Confirma que Balo tiene autorización para publicar las fotografías.'); return; }
    if (!workspace.images.length || workspace.images.some((image) => image.pending)) { setError('Guarda al menos una fotografía antes de solicitar la revisión.'); return; }
    if (galleryDirty) { setError('Guarda los cambios de la galería antes de solicitar la revisión.'); return; }
    if (!workspace.images.some((image) => image.isCover)) { setError('Elige una fotografía de portada.'); return; }
    setBusy('submit'); setNotice(undefined); setError(undefined);
    try {
      if (demoMode) {
        const now = new Date().toISOString();
        const next: EditableWorkspace = {
          ...workspace,
          property: { ...workspace.property, publicationStatus: 'pending_review', version: workspace.property.version + 1, updatedAt: now },
          revision: { ...workspace.revision, photoAuthorizationConfirmedBy: actor.id, photoAuthorizationConfirmedAt: now, updatedAt: now },
        };
        updateWorkspace(next);
      } else {
        updateWorkspace(editableWorkspace(await api.submitProperty(workspace.property.id, workspace.property.version, true)));
        await onRefresh();
      }
      setNotice('Revisión solicitada. La propiedad aún no está publicada.');
    } catch (requestError) { setError(`No se solicitó la revisión. ${uiError(requestError)}`); }
    finally { setBusy(undefined); }
  }

  function approveDemo(): void {
    if (!workspace || !demoMode || actor.role !== 'admin') return;
    const approvalId = Date.now();
    const next = { ...workspace, property: { ...workspace.property, publicationStatus: 'approved' as const, version: workspace.property.version + 1, updatedAt: new Date().toISOString() }, revision: { ...workspace.revision, photoApprovalId: `approval-photo-demo-${approvalId}`, publicationApprovalId: `approval-publication-demo-${approvalId}`, ...(workspace.revision.priceVisibility === 'public' ? { priceApprovalId: `approval-price-demo-${approvalId}` } : {}) } };
    updateWorkspace(next); setNotice('Publicación aprobada en la demostración. Todavía no está en Internet.'); setError(undefined);
  }

  async function publish(): Promise<void> {
    if (!workspace || !canPublishProperty(actor)) return;
    if (workspace.property.publicationStatus !== 'approved' && workspace.property.publicationStatus !== 'publish_failed') { setError('La propiedad debe tener una aprobación vigente antes de publicar.'); return; }
    if (!workspace.revision.photoApprovalId || !workspace.revision.publicationApprovalId) { setError('Orlando debe aprobar por separado las fotografías y la publicación.'); return; }
    if (workspace.revision.priceVisibility === 'public' && !workspace.revision.priceApprovalId) { setError('Orlando debe aprobar el precio antes de mostrarlo públicamente.'); return; }
    const availability = availabilityFreshness(workspace.property.lastVerifiedAt);
    if (availability.level === 'missing' || availability.level === 'expired') { setError('Confirma hoy la disponibilidad antes de publicar. Una ficha vencida se mantiene oculta.'); return; }
    setBusy('publish'); setNotice(undefined); setError(undefined);
    try {
      if (demoMode) {
        const jobId = `job-demo-${Date.now()}`;
        const next: EditableWorkspace = {
          ...workspace,
          property: { ...workspace.property, publicationStatus: 'publishing', version: workspace.property.version + 1, updatedAt: new Date().toISOString() },
          publicationJobs: [{ id: jobId, propertyId: workspace.property.id, revisionId: workspace.revision.id, requestedBy: actor.id, status: 'queued', snapshotVersion: workspace.property.version + 1, requestedAt: new Date().toISOString() }, ...workspace.publicationJobs],
        };
        updateWorkspace(next);
        setNotice('Publicación simulada en cola. No se desplegó nada en Internet.');
      } else {
        updateWorkspace(editableWorkspace(await api.publishProperty(workspace.property.id, workspace.property.version)));
        await onRefresh();
        setNotice('Publicación iniciada. Solo se marcará como publicada cuando GitHub confirme el despliegue.');
      }
    } catch (requestError) { setError(`La publicación no se inició. ${uiError(requestError)}`); }
    finally { setBusy(undefined); }
  }

  async function changeAvailability(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!workspace || !canChangePropertyAvailability(actor)) return;
    const form = new FormData(event.currentTarget);
    const availabilityStatus = String(form.get('availabilityStatus')) as PropertyAvailabilityStatus;
    const reason = String(form.get('reason')).trim();
    if (!reason) { setError('Indica el motivo del cambio de disponibilidad.'); return; }
    setBusy('availability'); setNotice(undefined); setError(undefined);
    try {
      if (demoMode) {
        updateWorkspace({ ...workspace, property: { ...workspace.property, availabilityStatus, version: workspace.property.version + 1, lastVerifiedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
      } else {
        updateWorkspace(editableWorkspace(await api.changePropertyAvailability(workspace.property.id, { expectedVersion: workspace.property.version, availabilityStatus, reason })));
        await onRefresh();
      }
      setNotice('Disponibilidad actualizada. Si estaba publicada, se solicitó reconstruir el catálogo.');
    } catch (requestError) { setError(`No se cambió la disponibilidad. ${uiError(requestError)}`); }
    finally { setBusy(undefined); }
  }

  const canEdit = creating || (workspace ? canEditProperty(actor, workspace.property) : false);
  const pendingImages = editorImages.filter((image) => image.pending).length;
  const freshness = availabilityFreshness(workspace?.property.lastVerifiedAt);

  return (
    <section className="panel properties-panel" id="propiedades">
      <div className="panel-title properties-title">
        <div><p className="kicker">PROPIEDADES</p><h2>Preparar, revisar y publicar</h2></div>
        {canCreateProperty(actor) && <button type="button" className="button-secondary" onClick={startProperty}>Nueva propiedad</button>}
      </div>
      <p className="property-intro">Cada cambio queda en borrador. Una ficha solo llega a Internet después de la aprobación de Orlando y la confirmación del despliegue.</p>

      {error && <div className="status-message error property-message" role="alert"><strong>Revisa la ficha.</strong><span>{error}</span></div>}
      {notice && <div className="status-message success property-message" role="status"><strong>Estado actualizado.</strong><span>{notice}</span></div>}

      <div className="property-layout">
        <div className="property-list" aria-label="Propiedades asignadas">
          {visibleProperties.map((property) => (
            <button type="button" key={property.id} className={`property-card ${selectedId === property.id && !creating ? 'selected' : ''}`} onClick={() => selectProperty(property.id)}>
              <span className={`property-state state-${property.publicationStatus}`}>{publicationLabels[property.publicationStatus]}</span>
              <strong>{property.label}</strong>
              <small>{availabilityLabels[property.availabilityStatus]} · versión {property.version}</small>
            </button>
          ))}
          {!visibleProperties.length && <p className="empty">No hay propiedades asignadas a este perfil.</p>}
        </div>

        <div className="property-editor" aria-busy={Boolean(busy)}>
          {(creating || workspace) ? <>
            <div className="wizard-header">
              <div><span className="property-code">{creating ? 'NUEVO BORRADOR' : workspace?.property.id}</span><h3>{creating ? 'Nueva propiedad' : workspace?.property.label}</h3></div>
              {!creating && workspace && <div className="property-version"><span>{publicationLabels[workspace.property.publicationStatus]}</span><small>Versión {workspace.property.version}</small></div>}
            </div>
            <div className="wizard-steps" role="tablist" aria-label="Pasos de la ficha">
              <button type="button" role="tab" aria-selected={step === 1} onClick={() => setStep(1)}><span>1</span> Información</button>
              <button type="button" role="tab" aria-selected={step === 2} disabled={creating} onClick={() => setStep(2)}><span>2</span> Fotografías</button>
              <button type="button" role="tab" aria-selected={step === 3} disabled={creating} onClick={() => setStep(3)}><span>3</span> Vista previa</button>
            </div>

            {step === 1 && <form className="property-form" onSubmit={saveInformation}>
              <fieldset disabled={!canEdit || Boolean(busy)}><legend>Información comercial</legend>
                <div className="form-grid">
                  <label>Nombre interno<input value={draft.label} required minLength={3} onChange={(event) => patchDraft({ label: event.target.value })} placeholder="Ej.: JM 112" /></label>
                  {actor.role === 'admin'
                    ? <label>Responsable<select value={draft.assigneeId} required onChange={(event) => patchDraft({ assigneeId: event.target.value })}><option value="">Seleccionar</option>{users.filter((user) => user.role === 'user').map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select></label>
                    : <div className="readonly-field"><span>Responsable</span><strong>{actor.name}</strong><small>Los gestores no pueden reasignar propiedades.</small></div>}
                  <label className="wide">Título público<input value={draft.title} required minLength={8} onChange={(event) => patchDraft({ title: event.target.value })} placeholder="Departamento luminoso de 112 m² en Jesús María" /></label>
                  <label>URL pública<input value={draft.slug} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" onChange={(event) => patchDraft({ slug: event.target.value })} placeholder="departamento-112m2-jesus-maria" /></label>
                  <label>Operación<select value={draft.operation} onChange={(event) => patchDraft({ operation: event.target.value as PropertyDraftInput['operation'] })}><option value="sale">Venta</option><option value="rent">Alquiler</option></select></label>
                  <label>Distrito<input value={draft.district} required onChange={(event) => patchDraft({ district: event.target.value })} /></label>
                  <label>Zona aproximada<input value={draft.zone ?? ''} onChange={(event) => patchDraft({ zone: event.target.value || undefined })} placeholder="Opcional" /></label>
                  <label>Área construida (m²)<input type="number" min="1" step="0.1" value={draft.builtAreaM2 || ''} required onChange={(event) => patchDraft({ builtAreaM2: Number(event.target.value) })} /></label>
                  <label>Área total (m²)<input type="number" min="1" step="0.1" value={draft.totalAreaM2 ?? ''} onChange={(event) => patchDraft({ totalAreaM2: event.target.value ? Number(event.target.value) : undefined })} /></label>
                  <label>Dormitorios<input type="number" min="0" max="50" value={draft.bedrooms} onChange={(event) => patchDraft({ bedrooms: Number(event.target.value) })} /></label>
                  <label>Baños<input type="number" min="0" max="50" value={draft.bathrooms} onChange={(event) => patchDraft({ bathrooms: Number(event.target.value) })} /></label>
                  <label>Cocheras<input type="number" min="0" max="50" value={draft.parking} onChange={(event) => patchDraft({ parking: Number(event.target.value) })} /></label>
                  <label>Estudios<input type="number" min="0" max="20" value={draft.studies} onChange={(event) => patchDraft({ studies: Number(event.target.value) })} /></label>
                  <label className="wide">Descripción pública<textarea value={draft.summary} required minLength={40} maxLength={1200} onChange={(event) => patchDraft({ summary: event.target.value })} placeholder="Describe con claridad qué hace especial a la propiedad." /></label>
                  <label className="wide">Características, una por línea<textarea value={features} onChange={(event) => setFeatures(event.target.value)} placeholder={'Balcón amplio\nCocina abierta\nVista a la ciudad'} /></label>
                </div>
              </fieldset>
              <fieldset className="sensitive-fields" disabled={!canEdit || Boolean(busy)}><legend>Precio y datos privados</legend>
                <p>Estos datos no se incluyen en la ficha pública salvo aprobación expresa.</p>
                <div className="form-grid">
                  <label>Precio en la web<select value={draft.priceVisibility} onChange={(event) => patchDraft({ priceVisibility: event.target.value as PropertyDraftInput['priceVisibility'] })}><option value="consult">A consultar</option><option value="public" disabled={actor.role !== 'admin'}>Mostrar precio · requiere aprobación</option></select></label>
                  <label>Precio interno<input type="number" min="1" value={draft.askingPrice?.amount ?? ''} onChange={(event) => patchDraft({ askingPrice: event.target.value ? { currency: 'PEN', amount: Number(event.target.value) } : undefined })} placeholder="S/" /></label>
                  <label className="wide">Dirección exacta · privada<input value={draft.privateDetails.exactAddress ?? ''} onChange={(event) => patchPrivateDetails({ exactAddress: event.target.value || undefined })} autoComplete="street-address" /></label>
                  <label className="wide">Fuente anterior<input type="url" value={draft.sourceUrl ?? ''} onChange={(event) => patchDraft({ sourceUrl: event.target.value || undefined })} placeholder="https://…" /></label>
                </div>
              </fieldset>
              <div className="wizard-actions"><button type="submit" className="button-primary" disabled={busy === 'save'}>{busy === 'save' ? 'Guardando…' : 'Guardar y continuar'}</button></div>
            </form>}

            {step === 2 && workspace && <div className="photo-step">
              <div className="upload-box">
                <div><strong>Añadir fotografías</strong><p>JPEG, PNG o WebP · máximo 12 MB por archivo · hasta 30 fotografías.</p><small>El navegador crea WebP y elimina metadatos EXIF antes de la carga.</small></div>
                <label className="upload-button">Elegir fotografías<input aria-label="Elegir fotografías" type="file" multiple accept={ACCEPTED_PROPERTY_IMAGE_TYPES.join(',')} disabled={Boolean(busy) || editorImages.length >= MAX_PROPERTY_IMAGES} onChange={(event) => { void addImages(event.target.files); event.target.value = ''; }} /></label>
              </div>
              {busy === 'process-images' && <p className="processing-note" role="status">Procesando fotografías en este dispositivo…</p>}
              <div className="image-editor-list">
                {editorImages.map((image, index) => <article className="image-editor-card" key={image.id}>
                  <div className="image-thumb">{image.previewUrl ? <img src={image.previewUrl} alt="" /> : <span>Vista protegida</span>}<em>{image.pending ? 'Pendiente' : 'Guardada'}</em></div>
                  <div className="image-fields">
                    <label>Descripción accesible<input value={image.alt} onChange={(event) => patchImage(image.id, { alt: event.target.value })} disabled={Boolean(busy)} /></label>
                    <label>Categoría<select value={image.category} onChange={(event) => patchImage(image.id, { category: event.target.value as PropertyImageCategory })} disabled={Boolean(busy)}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <div className="image-actions">
                      <button type="button" onClick={() => moveImage(image.id, -1)} disabled={Boolean(busy) || index === 0} aria-label={`Mover fotografía ${index + 1} antes`}>↑</button>
                      <button type="button" onClick={() => moveImage(image.id, 1)} disabled={Boolean(busy) || index === editorImages.length - 1} aria-label={`Mover fotografía ${index + 1} después`}>↓</button>
                      <button type="button" className={image.isCover ? 'active' : ''} onClick={() => setCover(image.id)} disabled={Boolean(busy)}>{image.isCover ? 'Portada' : 'Usar de portada'}</button>
                      {image.pending && <button type="button" onClick={() => removePendingImage(image.id)}>Quitar</button>}
                    </div>
                  </div>
                </article>)}
                {!editorImages.length && <p className="empty-detail">Todavía no hay fotografías. Los borradores no usan imágenes reales del repositorio.</p>}
              </div>
              <label className="photo-consent"><input type="checkbox" checked={photoAuthorized} onChange={(event) => setPhotoAuthorized(event.target.checked)} /> Confirmo que Balo tiene autorización para utilizar y publicar estas fotografías.</label>
              <div className="wizard-actions split"><button type="button" className="button-secondary" onClick={() => setStep(1)}>Volver</button><div><button type="button" className="button-secondary" disabled={(!pendingImages && !galleryDirty) || busy === 'save-images'} onClick={() => void saveGallery()}>{busy === 'save-images' ? 'Guardando…' : `Guardar galería${pendingImages ? ` (${pendingImages})` : galleryDirty ? ' · cambios' : ''}`}</button><button type="button" className="button-primary" onClick={() => setStep(3)} disabled={!editorImages.length}>Revisar ficha</button></div></div>
            </div>}

            {step === 3 && workspace && <div className="preview-step">
              <div className="public-preview">
                <div className="preview-gallery">{editorImages.find((image) => image.isCover)?.previewUrl ? <img src={editorImages.find((image) => image.isCover)?.previewUrl} alt={editorImages.find((image) => image.isCover)?.alt} /> : <div><span>FOTOGRAFÍA DE PORTADA</span><small>Se mostrará después de guardar la carga.</small></div>}</div>
                <div className="preview-copy"><span>{workspace.revision.operation === 'sale' ? 'EN VENTA' : 'EN ALQUILER'} · {workspace.revision.district}</span><h3>{workspace.revision.title}</h3><p>{workspace.revision.summary}</p><dl><div><dt>Área</dt><dd>{workspace.revision.builtAreaM2} m²</dd></div><div><dt>Dormitorios</dt><dd>{workspace.revision.bedrooms}</dd></div><div><dt>Baños</dt><dd>{workspace.revision.bathrooms}</dd></div><div><dt>Cocheras</dt><dd>{workspace.revision.parking}</dd></div>{workspace.revision.studies > 0 && <div><dt>Estudio</dt><dd>{workspace.revision.studies}</dd></div>}</dl><strong className="preview-price">{workspace.revision.priceVisibility === 'public' && workspace.revision.askingPrice ? new Intl.NumberFormat('es-PE', { style: 'currency', currency: workspace.revision.askingPrice.currency, maximumFractionDigits: 0 }).format(workspace.revision.askingPrice.amount) : 'Precio a consultar'}</strong><button type="button" className="button-primary">Consultar por WhatsApp</button><small>La dirección exacta, propietario, documentos y negociación nunca aparecen aquí.</small></div>
              </div>
              <div className="publication-readiness">
                <h3>Antes de publicar</h3>
                <ul><li className={editorImages.length && !editorImages.some((image) => image.pending) ? 'ready' : ''}>Al menos una fotografía guardada</li><li className={photoAuthorized ? 'ready' : ''}>Autorización de uso confirmada</li><li className={workspace.revision.photoApprovalId ? 'ready' : ''}>Fotografías aprobadas por Orlando</li><li className={workspace.property.publicationStatus === 'approved' || workspace.revision.publicationApprovalId ? 'ready' : ''}>Publicación aprobada por Orlando</li></ul>
                <p className={`freshness-note ${freshness.level}`}><strong>Disponibilidad:</strong> {freshness.message}</p>
                {workspace.property.publicationStatus === 'publishing' && <p className="publishing-note" role="status">GitHub está reconstruyendo la web. Esta ficha aún no se considera publicada.</p>}
                {workspace.property.publicationStatus === 'publish_failed' && <p className="failure-note" role="alert">El último despliegue falló. La versión pública anterior se mantiene sin cambios.</p>}
              </div>
              <div className="wizard-actions split"><button type="button" className="button-secondary" onClick={() => setStep(2)}>Volver a fotografías</button><div>{workspace.property.publicationStatus === 'draft' && <button type="button" className="button-primary" disabled={busy === 'submit'} onClick={() => void submitForReview()}>{busy === 'submit' ? 'Enviando…' : 'Solicitar revisión'}</button>}{demoMode && actor.role === 'admin' && workspace.property.publicationStatus === 'pending_review' && <button type="button" className="button-secondary" onClick={approveDemo}>Aprobar publicación</button>}{canPublishProperty(actor) && (workspace.property.publicationStatus === 'approved' || workspace.property.publicationStatus === 'publish_failed') && <button type="button" className="button-primary" disabled={busy === 'publish'} onClick={() => void publish()}>{busy === 'publish' ? 'Iniciando…' : workspace.property.publicationStatus === 'publish_failed' ? 'Reintentar publicación' : 'Publicar'}</button>}</div></div>
              {canChangePropertyAvailability(actor) && <form className="availability-form" onSubmit={changeAvailability}><label>Disponibilidad<select name="availabilityStatus" defaultValue={workspace.property.availabilityStatus}>{Object.entries(availabilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Motivo<input name="reason" required minLength={3} placeholder="Ej.: reserva confirmada por Orlando" /></label><button className="button-secondary" disabled={busy === 'availability'}>{busy === 'availability' ? 'Actualizando…' : 'Actualizar estado'}</button></form>}
            </div>}
          </> : <div className="empty-detail"><h3>Selecciona una propiedad</h3><p>Abre una ficha asignada o crea un nuevo borrador para comenzar.</p></div>}
          {busy === 'load' && <p className="processing-note" role="status">Abriendo la versión autorizada…</p>}
        </div>
      </div>
    </section>
  );
}

import { useMemo, useState } from 'react';
import { canAccessAssignedRecord, canApprove, transitionNeedsApproval, type Activity, type Actor, type Approval, type Lead, type Property } from '@balo/contracts';

const actors: Actor[] = [
  { id: 'orlando', name: 'Orlando Barraza', role: 'admin' },
  { id: 'ana', name: 'Ana · gestión', role: 'user' },
  { id: 'luis', name: 'Luis · gestión', role: 'user' },
];
const leads: Lead[] = [
  { id: 'lead-demo-01', ownerName: 'Propietaria demo', assigneeId: 'ana', stage: 'qualified', consentAt: '2026-08-29T09:00:00.000Z', attribution: { source: 'instagram', utmSource: 'instagram', postId: 'post-demo-18' } },
  { id: 'lead-demo-02', ownerName: 'Comprador demo', assigneeId: 'luis', stage: 'visit_scheduled', consentAt: '2026-08-29T10:30:00.000Z', attribution: { source: 'website', qrId: 'qr-demo-02' } },
];
const properties: Property[] = [
  { id: 'property-demo-01', label: 'Inmueble demo · Miraflores', assigneeId: 'ana', publicationStatus: 'draft' },
  { id: 'property-demo-02', label: 'Inmueble demo · Barranco', assigneeId: 'luis', publicationStatus: 'published' },
];
const activities: Activity[] = [
  { id: 'act-01', type: 'post_published', propertyId: 'property-demo-02', actorId: 'luis', occurredAt: '2026-08-29T08:30:00.000Z', metadata: { post_id: 'post-demo-18', channel: 'instagram' } },
  { id: 'act-02', type: 'lead_created', leadId: 'lead-demo-01', actorId: 'ana', occurredAt: '2026-08-29T09:00:00.000Z', metadata: { source: 'instagram', consent: 'recorded' } },
  { id: 'act-03', type: 'visit_scheduled', leadId: 'lead-demo-02', actorId: 'luis', occurredAt: '2026-08-29T11:00:00.000Z', metadata: { visit: 'scheduled' } },
];
const defaultApprovals: Approval[] = [{ id: 'approval-demo-01', kind: 'publication', recordId: 'property-demo-01', requestedBy: 'ana', status: 'pending', rationale: 'Revisión de materiales y canal antes de publicar.' }];

function label(type: Activity['type']) { return ({ lead_created: 'Lead consentido', post_published: 'Publicación', visit_scheduled: 'Visita', offer_received: 'Oferta', approval_requested: 'Aprobación', manual_follow_up: 'Seguimiento manual' })[type]; }

export function OpsApp() {
  const [actorId, setActorId] = useState('orlando');
  const [approvals, setApprovals] = useState(defaultApprovals);
  const actor = actors.find((candidate) => candidate.id === actorId)!;
  const visibleLeads = useMemo(() => leads.filter((lead) => canAccessAssignedRecord(actor, lead)), [actor]);
  const visibleProperties = useMemo(() => properties.filter((property) => canAccessAssignedRecord(actor, property)), [actor]);
  const publishApproval = approvals[0];
  const canPublish = !transitionNeedsApproval('publication', approvals);

  function approve() {
    if (!canApprove(actor, 'publication')) return;
    setApprovals((current) => current.map((approval) => approval.id === publishApproval.id ? { ...approval, status: 'approved', approvedBy: actor.id, approvedAt: new Date().toISOString() } : approval));
  }

  return <div className="ops-shell">
    <aside><a className="ops-brand" href="#top">BALO <span>OPERACIÓN</span></a><p className="pilot-label">PILOTO · DATOS FICTICIOS</p><nav><a href="#asignados">Asignados</a><a href="#aprobaciones">Aprobaciones</a><a href="#bitacora">Bitácora</a></nav><div className="access-note">El acceso real se activa con Cloudflare Access en la cuenta de Orlando. Esta vista ilustra el control por asignación.</div></aside>
    <main id="top"><header><div><p className="kicker">OPERACIÓN TRAZABLE</p><h1>Buenos días, {actor.name.split(' · ')[0]}.</h1><p>Solo se muestran los registros autorizados para este perfil.</p></div><label className="actor-select">Ver como<select value={actorId} onChange={(event) => setActorId(event.target.value)}>{actors.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.role})</option>)}</select></label></header>
      <section className="metrics"><article><span>Leads visibles</span><strong>{visibleLeads.length}</strong><small>con consentimiento</small></article><article><span>Inmuebles visibles</span><strong>{visibleProperties.length}</strong><small>por asignación</small></article><article><span>Decisiones</span><strong>{approvals.filter((approval) => approval.status === 'pending').length}</strong><small>pendientes de Orlando</small></article></section>
      <section id="asignados" className="panel"><div className="panel-title"><p className="kicker">ASIGNADOS</p><h2>Casos en los que puedes intervenir</h2></div><div className="record-grid"><div><h3>Leads</h3>{visibleLeads.map((lead) => <article className="record" key={lead.id}><strong>{lead.ownerName}</strong><span>{lead.stage.replace('_', ' ')}</span><small>{lead.attribution.source} · {lead.attribution.postId ?? lead.attribution.qrId ?? 'origen directo'}</small></article>)}{!visibleLeads.length && <p className="empty">No tienes leads asignados.</p>}</div><div><h3>Inmuebles</h3>{visibleProperties.map((property) => <article className="record" key={property.id}><strong>{property.label}</strong><span>{property.publicationStatus}</span><small>Responsable: {actors.find((candidate) => candidate.id === property.assigneeId)?.name}</small></article>)}{!visibleProperties.length && <p className="empty">No tienes inmuebles asignados.</p>}</div></div></section>
      <section id="aprobaciones" className="panel approval"><div><p className="kicker">CONTROL DE DECISIÓN</p><h2>Publicación de inmueble demo</h2><p>{publishApproval.rationale}</p><dl><dt>Solicita</dt><dd>{actors.find((candidate) => candidate.id === publishApproval.requestedBy)?.name}</dd><dt>Estado</dt><dd><b className={publishApproval.status}>{publishApproval.status}</b></dd></dl></div><div className="decision-box"><span>PRECIO · PUBLICACIÓN · COMISIÓN · DESCUENTO · CIERRE</span><strong>{canPublish ? 'Aprobación registrada' : 'Esperando a Orlando'}</strong>{publishApproval.status === 'pending' && (canApprove(actor, 'publication') ? <button onClick={approve}>Aprobar publicación</button> : <p>Este perfil no puede aprobar. La solicitud continúa visible y trazable.</p>)}{publishApproval.status === 'approved' && <p>Registrado por {publishApproval.approvedBy} en esta sesión de demostración.</p>}</div></section>
      <section id="bitacora" className="panel"><div className="panel-title"><p className="kicker">BITÁCORA</p><h2>Post → lead → visita → oferta</h2></div><ol className="activity-list">{activities.map((activity) => <li key={activity.id}><time>{new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit' }).format(new Date(activity.occurredAt))}</time><div><strong>{label(activity.type)}</strong><p>{Object.entries(activity.metadata).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p></div></li>)}</ol></section>
    </main>
  </div>;
}

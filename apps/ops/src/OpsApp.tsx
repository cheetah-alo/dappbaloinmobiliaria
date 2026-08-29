import { FormEvent, useEffect, useMemo, useState } from 'react';
import { canAccessAssignedRecord, canApprove, canAssign, canCreateActivity, canRequestApproval, type Activity, type ActivityType, type Actor, type Approval, type ApprovalKind, type ApprovalStatus, type Lead } from '@balo/contracts';
import { OpsApiClient, OpsApiError, type OpsDashboard } from './opsApi';

const api = new OpsApiClient();

const demoActors: Actor[] = [
  { id: 'orlando', name: 'Orlando Barraza', role: 'admin', email: 'orlando@balo.demo' },
  { id: 'ana', name: 'Ana Salazar', role: 'user', email: 'ana@balo.demo' },
  { id: 'luis', name: 'Luis Cárdenas', role: 'user', email: 'luis@balo.demo' },
];

const demoLeads: Lead[] = [
  { id: 'lead-demo-01', ownerName: 'Propietaria demo · Miraflores', assigneeId: 'ana', stage: 'qualified', consentAt: '2026-08-29T09:00:00.000Z', operation: 'sell', district: 'Miraflores', attribution: { source: 'instagram', utmSource: 'instagram', postId: 'post-demo-18' } },
  { id: 'lead-demo-02', ownerName: 'Comprador demo · Barranco', assigneeId: 'luis', stage: 'visit_scheduled', consentAt: '2026-08-29T10:30:00.000Z', operation: 'buy', district: 'Barranco', attribution: { source: 'website', qrId: 'qr-demo-02' } },
  { id: 'lead-demo-03', ownerName: 'Propietario demo · San Isidro', assigneeId: '', stage: 'new', consentAt: '2026-08-29T11:15:00.000Z', operation: 'rent', district: 'San Isidro', attribution: { source: 'whatsapp' } },
];

const demoActivities: Activity[] = [
  { id: 'act-demo-01', type: 'post_published', leadId: 'lead-demo-01', actorId: 'luis', occurredAt: '2026-08-29T08:30:00.000Z', metadata: { post_id: 'post-demo-18', canal: 'instagram' } },
  { id: 'act-demo-02', type: 'lead_created', leadId: 'lead-demo-01', actorId: 'ana', occurredAt: '2026-08-29T09:00:00.000Z', metadata: { origen: 'instagram', consentimiento: 'registrado' } },
  { id: 'act-demo-03', type: 'visit_scheduled', leadId: 'lead-demo-02', actorId: 'luis', occurredAt: '2026-08-29T11:00:00.000Z', metadata: { visita: 'pendiente de realizar' } },
  { id: 'act-demo-04', type: 'offer_received', leadId: 'lead-demo-01', actorId: 'ana', occurredAt: '2026-08-29T12:15:00.000Z', metadata: { oferta: 'solicita evaluación' } },
];

const demoApprovals: Approval[] = [
  { id: 'approval-demo-01', kind: 'publication', recordId: 'lead-demo-01', requestedBy: 'ana', status: 'pending', rationale: 'Revisar materiales y canal antes de publicar el inmueble.' },
  { id: 'approval-demo-02', kind: 'price', recordId: 'lead-demo-01', requestedBy: 'ana', status: 'pending', rationale: 'Validar rango de publicación tras la visita al inmueble.' },
];

const demoDashboard = (actor: Actor): OpsDashboard => ({
  actor,
  users: demoActors,
  leads: demoLeads,
  properties: [],
  activities: demoActivities,
  approvals: demoApprovals,
});

const emptyAuthorizedDashboard: OpsDashboard = {
  actor: { id: 'access-pending', name: 'sesión', role: 'user' },
  users: [],
  leads: [],
  properties: [],
  activities: [],
  approvals: [],
};

const approvalLabels: Record<ApprovalKind, string> = {
  price: 'Precio', publication: 'Publicación', commission: 'Comisión', discount: 'Descuento', closure: 'Cierre',
};

const stageLabels: Record<Lead['stage'], string> = {
  new: 'Nuevo', qualified: 'Calificado', visit_scheduled: 'Visita programada', offer_received: 'Oferta recibida', closed: 'Cerrado', lost: 'No continúa',
};

const activityLabels: Record<ActivityType, string> = {
  lead_created: 'Lead registrado', lead_assigned: 'Caso asignado', post_published: 'Publicación', visit_scheduled: 'Visita programada', visit_completed: 'Visita realizada', offer_received: 'Oferta recibida', approval_requested: 'Aprobación solicitada', approval_decided: 'Decisión registrada', manual_follow_up: 'Seguimiento registrado',
};

function actorName(id: string, users: Actor[]): string {
  return users.find((user) => user.id === id)?.name ?? 'Equipo Balo';
}

function activityDescription(activity: Activity): string {
  const entries = Object.entries(activity.metadata);
  return entries.length ? entries.map(([key, value]) => `${key}: ${value}`).join(' · ') : 'Sin detalle adicional.';
}

function detailForLead(lead: Lead): string {
  const source = lead.attribution.postId ?? lead.attribution.qrId ?? lead.attribution.utmSource ?? lead.attribution.source;
  return [lead.district, source].filter(Boolean).join(' · ');
}

function errorMessage(error: unknown): string {
  if (error instanceof OpsApiError && error.status === 401) return 'Tu sesión no está autorizada. Vuelve a entrar mediante Cloudflare Access.';
  if (error instanceof Error) return error.message;
  return 'No se pudo completar la acción. Inténtalo de nuevo.';
}

export function OpsApp() {
  const [demoActorId, setDemoActorId] = useState('orlando');
  const [snapshot, setSnapshot] = useState<OpsDashboard>(() => api.configured ? emptyAuthorizedDashboard : demoDashboard(demoActors[0]));
  const [selectedLeadId, setSelectedLeadId] = useState('lead-demo-01');
  const [loading, setLoading] = useState(api.configured);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});

  const demoMode = !api.configured;
  const actor = useMemo(() => demoMode ? demoActors.find((candidate) => candidate.id === demoActorId)! : snapshot.actor, [demoActorId, demoMode, snapshot.actor]);
  const visibleLeads = useMemo(() => snapshot.leads.filter((lead) => canAccessAssignedRecord(actor, lead)), [actor, snapshot.leads]);
  const selectedLead = visibleLeads.find((lead) => lead.id === selectedLeadId) ?? visibleLeads[0];
  const pendingApprovals = snapshot.approvals.filter((approval) => approval.status === 'pending');
  const visibleApprovals = actor.role === 'admin' ? pendingApprovals : pendingApprovals.filter((approval) => visibleLeads.some((lead) => lead.id === approval.recordId));
  const leadActivities = useMemo(() => snapshot.activities.filter((activity) => activity.leadId === selectedLead?.id).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)), [selectedLead?.id, snapshot.activities]);

  async function refresh(): Promise<boolean> {
    if (demoMode) {
      setSnapshot(demoDashboard(actor));
      return true;
    }
    setLoading(true);
    setError(undefined);
    try {
      setSnapshot(await api.snapshot());
      return true;
    } catch (requestError) {
      setError(errorMessage(requestError));
      return false;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (api.configured) void refresh();
  }, []);

  useEffect(() => {
    if (visibleLeads.length && !visibleLeads.some((lead) => lead.id === selectedLeadId)) setSelectedLeadId(visibleLeads[0].id);
  }, [selectedLeadId, visibleLeads]);

  function updateDemo(update: (current: OpsDashboard) => OpsDashboard, message: string): void {
    setSnapshot((current) => update(current));
    setNotice(`${message} Solo existe en esta sesión con datos ficticios.`);
  }

  async function assignLead(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedLead || !canAssign(actor)) return;
    const assigneeId = String(new FormData(event.currentTarget).get('assigneeId') ?? '');
    if (!assigneeId) return;
    setBusy('assign'); setNotice(undefined); setError(undefined);
    try {
      if (demoMode) {
        updateDemo((current) => ({ ...current, leads: current.leads.map((lead) => lead.id === selectedLead.id ? { ...lead, assigneeId } : lead) }), 'Asignación actualizada.');
      } else {
        await api.assignLead(selectedLead.id, assigneeId);
        const refreshed = await refresh();
        setNotice(refreshed ? 'Asignación registrada y datos actualizados.' : 'La API confirmó la asignación, pero no pudimos actualizar la vista. Reintenta la carga.');
      }
    } catch (requestError) {
      setError(`La asignación no se registró. ${errorMessage(requestError)}`);
    } finally { setBusy(undefined); }
  }

  async function createActivity(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedLead || !canCreateActivity(actor, selectedLead)) return;
    const form = new FormData(event.currentTarget);
    const note = String(form.get('note') ?? '').trim();
    if (!note) return;
    setBusy('activity'); setNotice(undefined); setError(undefined);
    try {
      if (demoMode) {
        updateDemo((current) => ({ ...current, activities: [{ id: `act-demo-${Date.now()}`, type: 'manual_follow_up', leadId: selectedLead.id, actorId: actor.id, occurredAt: new Date().toISOString(), metadata: { nota: note } }, ...current.activities] }), 'Seguimiento añadido.');
        event.currentTarget.reset();
      } else {
        await api.createActivity(selectedLead.id, note);
        const refreshed = await refresh();
        event.currentTarget.reset();
        setNotice(refreshed ? 'Seguimiento registrado y datos actualizados.' : 'La API confirmó el seguimiento, pero no pudimos actualizar la vista. Reintenta la carga.');
      }
    } catch (requestError) {
      setError(`El seguimiento no se registró. ${errorMessage(requestError)}`);
    } finally { setBusy(undefined); }
  }

  async function requestApproval(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedLead || !canRequestApproval(actor, selectedLead)) return;
    const form = new FormData(event.currentTarget);
    const kind = String(form.get('kind') ?? '') as ApprovalKind;
    const rationale = String(form.get('rationale') ?? '').trim();
    if (!Object.hasOwn(approvalLabels, kind) || !rationale) return;
    setBusy('request'); setNotice(undefined); setError(undefined);
    try {
      if (demoMode) {
        updateDemo((current) => ({ ...current, approvals: [{ id: `approval-demo-${Date.now()}`, kind, recordId: selectedLead.id, requestedBy: actor.id, status: 'pending', rationale }, ...current.approvals] }), 'Solicitud de aprobación creada.');
        event.currentTarget.reset();
      } else {
        await api.requestApproval({ kind, recordId: selectedLead.id, rationale });
        const refreshed = await refresh();
        event.currentTarget.reset();
        setNotice(refreshed ? 'Solicitud enviada a la bandeja de decisiones y datos actualizados.' : 'La API confirmó la solicitud, pero no pudimos actualizar la vista. Reintenta la carga.');
      }
    } catch (requestError) {
      setError(`La solicitud no se registró. ${errorMessage(requestError)}`);
    } finally { setBusy(undefined); }
  }

  async function decideApproval(approval: Approval, decision: Extract<ApprovalStatus, 'approved' | 'rejected'>): Promise<void> {
    if (!canApprove(actor, approval.kind)) return;
    const rationale = decisionReasons[approval.id]?.trim();
    if (!rationale) {
      setError('Indica el motivo de la decisión antes de continuar.');
      return;
    }
    setBusy(`decision-${approval.id}`); setNotice(undefined); setError(undefined);
    try {
      if (demoMode) {
        updateDemo((current) => ({ ...current, approvals: current.approvals.map((item) => item.id === approval.id ? { ...item, status: decision, approvedBy: actor.id, approvedAt: new Date().toISOString(), decisionReason: rationale } : item) }), `Decisión ${decision === 'approved' ? 'aprobada' : 'rechazada'}.`);
      } else {
        await api.decideApproval(approval.id, decision, rationale);
        const refreshed = await refresh();
        setNotice(refreshed ? `Decisión ${decision === 'approved' ? 'aprobada' : 'rechazada'} y datos actualizados.` : `La API confirmó la decisión ${decision === 'approved' ? 'aprobada' : 'rechazada'}, pero no pudimos actualizar la vista.`);
      }
    } catch (requestError) {
      setError(`La decisión no se registró. ${errorMessage(requestError)}`);
    } finally { setBusy(undefined); }
  }

  const leadCount = actor.role === 'admin' ? snapshot.metrics?.totalLeads ?? snapshot.leads.length : visibleLeads.length;
  const scheduledVisits = actor.role === 'admin' ? snapshot.metrics?.scheduledVisits ?? visibleLeads.filter((lead) => lead.stage === 'visit_scheduled').length : visibleLeads.filter((lead) => lead.stage === 'visit_scheduled').length;
  const decisionCount = actor.role === 'admin' ? snapshot.metrics?.pendingApprovals ?? pendingApprovals.length : visibleApprovals.length;

  return (
    <div className="ops-shell">
      <aside className="ops-sidebar">
        <a className="ops-brand" href="#inicio" aria-label="Balo Operación, inicio">BALO <span>OPERACIÓN</span></a>
        {demoMode && <p className="pilot-label">PILOTO · DATOS FICTICIOS</p>}
        <nav aria-label="Navegación del portal">
          <a href="#casos">Casos</a><a href="#bitacora">Bitácora</a><a href="#aprobaciones">Decisiones</a>
        </nav>
        <div className="access-note">
          <strong>{demoMode ? 'Demostración local' : 'Acceso protegido'}</strong>
          <p>{demoMode ? 'El selector solo ilustra perfiles. En producción, Cloudflare Access y la API autorizan la identidad y los permisos en servidor.' : 'La identidad y los permisos se autorizan en servidor tras Cloudflare Access. Esta interfaz no concede acceso por sí sola.'}</p>
        </div>
      </aside>
      <main id="inicio">
        <header className="ops-header">
          <div>
            <p className="kicker">OPERACIÓN TRAZABLE</p>
            <h1>{loading ? 'Abriendo operación…' : `Buenos días, ${actor.name.split(' ')[0]}.`}</h1>
            <p className="header-copy">{actor.role === 'admin' ? 'Ves toda la operación: asigna responsables y decide los puntos sensibles.' : 'Ves y operas solo los expedientes que tienes asignados.'}</p>
          </div>
          {demoMode ? <label className="actor-select">Perfil de demostración<select value={demoActorId} onChange={(event) => setDemoActorId(event.target.value)}>{demoActors.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.role === 'admin' ? 'Orlando / admin' : 'gestor'}</option>)}</select><small>Solo cambia datos ficticios locales.</small></label> : <div className="identity-card"><span>SESIÓN AUTORIZADA</span><strong>{actor.name}</strong><small>{actor.role === 'admin' ? 'Administrador' : 'Gestor asignado'}</small></div>}
        </header>

        {error && <div className="status-message error" role="alert"><strong>Revisa la acción.</strong><span>{error}</span>{api.configured && <button type="button" onClick={() => void refresh()} disabled={loading}>Reintentar carga</button>}</div>}
        {notice && <div className="status-message success" role="status"><strong>Actualización clara.</strong><span>{notice}</span></div>}
        {loading && <div className="status-message loading" role="status">Consultando la operación autorizada…</div>}

        <section className="metrics" aria-label="Resumen operativo">
          <article><span>Leads visibles</span><strong>{leadCount}</strong><small>{actor.role === 'admin' ? 'con consentimiento registrado' : 'solo asignados a ti'}</small></article>
          <article><span>Visitas en agenda</span><strong>{scheduledVisits}</strong><small>requieren seguimiento</small></article>
          <article><span>Decisiones pendientes</span><strong>{decisionCount}</strong><small>{actor.role === 'admin' ? 'en tu bandeja' : 'en expedientes visibles'}</small></article>
        </section>

        <section className="panel case-panel" id="casos">
          <div className="panel-title"><div><p className="kicker">CASOS</p><h2>{actor.role === 'admin' ? 'Entrada, asignación y seguimiento' : 'Tus expedientes asignados'}</h2></div><span className="panel-caption">{demoMode ? 'Demostración' : 'Datos autorizados'}</span></div>
          <div className="case-layout">
            <div className="lead-list" aria-label="Lista de casos">
              {visibleLeads.map((lead) => <button className={`lead-card ${selectedLead?.id === lead.id ? 'selected' : ''}`} type="button" key={lead.id} onClick={() => setSelectedLeadId(lead.id)}><span className={`stage stage-${lead.stage}`}>{stageLabels[lead.stage]}</span><strong>{lead.ownerName}</strong><small>{detailForLead(lead)}</small><em>{lead.assigneeId ? actorName(lead.assigneeId, snapshot.users) : 'Sin responsable'}</em></button>)}
              {!loading && !visibleLeads.length && <p className="empty">No hay expedientes asignados para este perfil.</p>}
            </div>
            {selectedLead ? <div className="case-detail">
              <div className="case-heading"><div><span className={`stage stage-${selectedLead.stage}`}>{stageLabels[selectedLead.stage]}</span><h3>{selectedLead.ownerName}</h3><p>{selectedLead.operation ? `${selectedLead.operation === 'sell' ? 'Venta' : selectedLead.operation === 'rent' ? 'Alquiler' : selectedLead.operation === 'buy' ? 'Compra' : 'Inversión'} · ` : ''}{detailForLead(selectedLead)}</p></div><span className="consent-state">Consentimiento registrado</span></div>
              {actor.role === 'admin' && <form className="inline-form" onSubmit={assignLead}><label>Responsable<select name="assigneeId" defaultValue={selectedLead.assigneeId} key={selectedLead.id}>{snapshot.users.filter((user) => user.role === 'user').map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><button className="button-secondary" disabled={busy === 'assign'}>{busy === 'assign' ? 'Asignando…' : 'Asignar caso'}</button></form>}
              {canCreateActivity(actor, selectedLead) && <form className="activity-form" onSubmit={createActivity}><label htmlFor="activity-note">Registrar seguimiento<textarea id="activity-note" name="note" required minLength={3} placeholder="Ej.: Llamada realizada; confirma disponibilidad para la visita del jueves." /></label><button className="button-primary" disabled={busy === 'activity'}>{busy === 'activity' ? 'Registrando…' : 'Añadir a la bitácora'}</button></form>}
            </div> : <div className="case-detail empty-detail"><h3>Selecciona un caso</h3><p>Cuando haya un expediente autorizado, aquí verás su contexto y las acciones permitidas para tu perfil.</p></div>}
          </div>
        </section>

        <section className="panel timeline-panel" id="bitacora">
          <div className="panel-title"><div><p className="kicker">BITÁCORA</p><h2>Post → lead → visita → oferta</h2></div><span className="panel-caption">{selectedLead ? selectedLead.ownerName : 'Sin caso seleccionado'}</span></div>
          {selectedLead ? <ol className="activity-list">{leadActivities.map((activity) => <li key={activity.id}><time>{new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(activity.occurredAt))}</time><div><strong>{activityLabels[activity.type]}</strong><p>{activityDescription(activity)}</p><small>Por {actorName(activity.actorId, snapshot.users)}</small></div></li>)}{!leadActivities.length && <li className="empty">Aún no hay actividades para este caso.</li>}</ol> : <p className="empty">Elige un caso para consultar la bitácora.</p>}
        </section>

        {selectedLead && canRequestApproval(actor, selectedLead) && <section className="panel request-panel">
          <div><p className="kicker">SOLICITUD DE DECISIÓN</p><h2>Elevar una decisión a Orlando</h2><p>Precio, publicación, comisión, descuento y cierre requieren una razón y la decisión del administrador.</p></div>
          <form onSubmit={requestApproval}><label>Tipo<select name="kind" defaultValue="price">{(Object.entries(approvalLabels) as [ApprovalKind, string][]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Contexto y recomendación<textarea name="rationale" required minLength={8} placeholder="Explica qué se necesita decidir y por qué." /></label><button className="button-primary" disabled={busy === 'request'}>{busy === 'request' ? 'Enviando…' : 'Solicitar aprobación'}</button></form>
        </section>}

        <section className="panel approvals-panel" id="aprobaciones">
          <div className="panel-title"><div><p className="kicker">BANDEJA DE DECISIONES</p><h2>{actor.role === 'admin' ? 'Decisiones que requieren a Orlando' : 'Solicitudes de tus expedientes'}</h2></div><span className="panel-caption">{visibleApprovals.length} pendiente{visibleApprovals.length === 1 ? '' : 's'}</span></div>
          <div className="approval-list">{visibleApprovals.map((approval) => <article className="approval-card" key={approval.id}><div><span className="approval-kind">{approvalLabels[approval.kind]}</span><h3>{snapshot.leads.find((lead) => lead.id === approval.recordId)?.ownerName ?? 'Expediente autorizado'}</h3><p>{approval.rationale}</p><small>Solicita: {actorName(approval.requestedBy, snapshot.users)}</small></div>{actor.role === 'admin' && canApprove(actor, approval.kind) ? <div className="approval-actions"><label>Motivo de la decisión<textarea value={decisionReasons[approval.id] ?? ''} onChange={(event) => setDecisionReasons((current) => ({ ...current, [approval.id]: event.target.value }))} placeholder="Deja el criterio de aprobación o rechazo." /></label><div><button type="button" className="button-secondary" disabled={busy === `decision-${approval.id}`} onClick={() => void decideApproval(approval, 'rejected')}>Rechazar</button><button type="button" className="button-primary" disabled={busy === `decision-${approval.id}`} onClick={() => void decideApproval(approval, 'approved')}>Aprobar</button></div></div> : <p className="no-decision">Este perfil puede consultar la solicitud, pero no puede resolverla.</p>}</article>)}{!visibleApprovals.length && <p className="empty">No hay decisiones pendientes en los casos visibles.</p>}</div>
        </section>
      </main>
    </div>
  );
}

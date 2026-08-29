import { describe, expect, it } from 'vitest';
import { canAccessAssignedRecord, canApprove, canAssign, canCreateActivity, canRequestApproval, manualFollowUp, transitionNeedsApproval, type Actor, type Approval } from '../src/index';
import { ownerEnquirySchema } from '../src/validation';

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
});

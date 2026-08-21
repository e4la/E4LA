export async function evaluatePortalActivation(db, enrollmentId, now = new Date().toISOString()) {
  const enrollment = await db.prepare(`
    SELECT e.*, pi.status AS initial_payment_status
    FROM enrollments e
    LEFT JOIN payment_installments pi ON pi.enrollment_id = e.id AND pi.installment_number = 1
    WHERE e.id = ?
  `).bind(enrollmentId).first();
  if (!enrollment || enrollment.portal_deactivated_at || enrollment.portal_activated_at) {
    return { activated: Boolean(enrollment?.portal_activated_at && !enrollment?.portal_deactivated_at), changed: false, enrollment };
  }
  const prerequisitesMet = enrollment.initial_payment_status === 'paid' && Number(enrollment.onboarding_ready) === 1;
  const scheduledDue = enrollment.activation_mode === 'scheduled'
    && enrollment.activation_scheduled_at
    && new Date(enrollment.activation_scheduled_at).getTime() <= new Date(now).getTime();
  const shouldActivate = prerequisitesMet && (enrollment.activation_mode === 'automatic' || scheduledDue);
  if (!shouldActivate) return { activated: false, changed: false, enrollment };
  await db.batch([
    db.prepare(`UPDATE enrollments SET portal_activated_at = ?, activated_at = COALESCE(activated_at, ?), updated_at = ? WHERE id = ? AND portal_activated_at IS NULL`)
      .bind(now, now, now, enrollment.id),
    db.prepare(`UPDATE projects SET client_visible = 1, status = CASE WHEN status = 'planned' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?`)
      .bind(now, enrollment.project_id),
    db.prepare(`UPDATE client_users SET access_status = 'active', updated_at = ? WHERE client_id = ?`)
      .bind(now, enrollment.client_id),
  ]);
  return { activated: true, changed: true, enrollment };
}

PRAGMA foreign_keys = ON;

-- payment_plans was created in 0001 without the immutable-evidence triggers that
-- agreement_versions and agreement_acceptances already have. A payment plan is referenced
-- by agreement_versions (offered terms) and copied into agreement_acceptances (accepted
-- terms) at acceptance time, so once created it must never be edited or removed either.

CREATE TRIGGER payment_plans_immutable_update
BEFORE UPDATE ON payment_plans
BEGIN
  SELECT RAISE(ABORT, 'payment plans are immutable');
END;

CREATE TRIGGER payment_plans_immutable_delete
BEFORE DELETE ON payment_plans
BEGIN
  SELECT RAISE(ABORT, 'payment plans are immutable');
END;

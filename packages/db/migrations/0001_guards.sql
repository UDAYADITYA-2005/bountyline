-- Custom SQL migration file, put your code below! --
-- Guards that Drizzle's schema DSL can't express (docs/DATA_MODEL.md invariants 5 and 7-adjacent).

-- decision_log is append-only: nothing updates or deletes its rows.
CREATE OR REPLACE FUNCTION bountyline_decision_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'decision_log is append-only' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER decision_log_no_update BEFORE UPDATE OR DELETE ON decision_log
  FOR EACH ROW EXECUTE FUNCTION bountyline_decision_log_append_only();
--> statement-breakpoint
-- Invariant 5: paid, rejected and expired never change status again.
CREATE OR REPLACE FUNCTION bountyline_claims_final_states() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('paid', 'rejected', 'expired') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'claim % is final (%)', OLD.id, OLD.status USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER claims_final_states BEFORE UPDATE OF status ON claims
  FOR EACH ROW EXECUTE FUNCTION bountyline_claims_final_states();
--> statement-breakpoint
-- Invariant 4: a release exists only for a claim that ended rejected after a reservation.
CREATE OR REPLACE FUNCTION bountyline_ledger_release_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.kind = 'release' THEN
    IF NOT EXISTS (SELECT 1 FROM ledger_entries WHERE claim_id = NEW.claim_id AND kind = 'reserve') THEN
      RAISE EXCEPTION 'release without a reservation for claim %', NEW.claim_id USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT amount_minor FROM ledger_entries WHERE claim_id = NEW.claim_id AND kind = 'reserve') <> NEW.amount_minor THEN
      RAISE EXCEPTION 'release must equal the reservation for claim %', NEW.claim_id USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_release_guard BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION bountyline_ledger_release_guard();

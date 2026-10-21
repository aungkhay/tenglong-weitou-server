-- Run once against the application database BEFORE deploying the new code.
-- exchange_ratio = score credited per point (score = points * exchange_ratio).
ALTER TABLE points_log
    ADD COLUMN exchange_ratio DECIMAL(24, 12) NULL DEFAULT NULL
    COMMENT 'Historical score per point used for this exchange';

ALTER TABLE score_operation_record
    ADD COLUMN exchange_ratio DECIMAL(24, 12) NULL DEFAULT NULL
    COMMENT 'Historical score per point; NULL for non-exchange or unknown records';

-- Recover effective historical rates from the actual logged amounts.
UPDATE points_log
SET exchange_ratio = ABS(score_change / points_change)
WHERE exchange_ratio IS NULL
  AND type IN ('exchange', 'cancel')
  AND points_change <> 0;

-- Old score_operation_record rows have no unique link to points_log.
-- Leave their ratio NULL rather than match an unrelated exchange by amount/time.

# Historical exchange ratios

Run `docs/migrations/20261021_exchange_ratio.sql` once on the application database before deploying this code. Both added columns are nullable `DECIMAL(24,12)`.

Single-player (including Paopao), single-group and all-group exchanges save the actual rate in `points_log.exchange_ratio` and the corresponding `score_operation_record.exchange_ratio` in the existing transaction. Reversals retain the original rate.

Both POST endpoints return a numeric `exchange_ratio` on each item in `data.list`:

- `/ht/points_exchange/get_exchange_info`
- `/ht/player_option/get_score_option_record`

For example, `exchange_ratio: 2.5` means 10 points credited 25 score. This is the applied multiplier, not the turnover-to-points setting `points_exchange_ratio`. Changes to default or personal configuration do not alter it. The existing `personal_points_redemption_ratio` response field remains current configuration for compatibility; use `exchange_ratio` to display the historical rate.

Summary rows, resets, non-exchange operations and unknown historical score-operation rates return `null`. Zero is a valid recorded value and is preserved. Historical points logs are backfilled from their recorded score and points changes. Old score-operation records remain `null` because they do not have a unique link to their points log; matching only by amount or timestamp could show another exchange's rate.

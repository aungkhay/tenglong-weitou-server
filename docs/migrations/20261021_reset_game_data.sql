-- DESTRUCTIVE: run manually against the intended application database only.
-- Back up the database and stop application workers / scheduled jobs first.
-- This clears data, preserves table definitions, and resets AUTO_INCREMENT.
-- MySQL TRUNCATE implicitly commits: this script cannot be rolled back.
-- Run with a client that stops on errors (do not use mysql --force).
-- Keep foreign-key checks enabled; resolve any FK dependencies before running.
-- Names follow the application: gameshist_record, gameshist_record_day,
-- and user.option_time (rather than gameshit_record / operation_time).

-- Preflight: verify every table and user column before destructive statements.
SELECT DATABASE() AS target_database;
SELECT 1 FROM `gameshist` LIMIT 0;
SELECT 1 FROM `gameshist_record` LIMIT 0;
SELECT 1 FROM `gameshist_record_day` LIMIT 0;
SELECT 1 FROM `game_jc_total` LIMIT 0;
SELECT 1 FROM `login_record` LIMIT 0;
SELECT 1 FROM `points_group_user` LIMIT 0;
SELECT 1 FROM `points_log` LIMIT 0;
SELECT 1 FROM `points_record` LIMIT 0;
SELECT 1 FROM `score_operation_record` LIMIT 0;
SELECT 1 FROM `bank_list` LIMIT 0;
SELECT 1 FROM `bank_card_transaction_details` LIMIT 0;
SELECT `raw_score`, `score`, `freeze_score`, `daily_points`, `total_points`,
       `owe_points`, `yxxz`, `xml_sb`, `xml_zx`, `xz_yl`, `sb_yl`, `yxtz`,
       `option_time`
FROM `user` LIMIT 0;

TRUNCATE TABLE `gameshist`;
TRUNCATE TABLE `gameshist_record`;
TRUNCATE TABLE `gameshist_record_day`;
TRUNCATE TABLE `game_jc_total`;
TRUNCATE TABLE `login_record`;
TRUNCATE TABLE `points_group_user`;
TRUNCATE TABLE `points_log`;
TRUNCATE TABLE `points_record`;
TRUNCATE TABLE `score_operation_record`;
TRUNCATE TABLE `bank_list`;
TRUNCATE TABLE `bank_card_transaction_details`;

UPDATE `user`
SET `raw_score` = 0,
    `score` = 0,
    `freeze_score` = 0,
    `daily_points` = 0,
    `total_points` = 0,
    `owe_points` = 0,
    `yxxz` = 0,
    `xml_sb` = 0,
    `xml_zx` = 0,
    `xz_yl` = 0,
    `sb_yl` = 0,
    `yxtz` = 0,
    `option_time` = NULL;

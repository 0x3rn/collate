-- Record which chapter versions each export was made from, so re-exporting the same
-- versions in the same scope and format replaces the earlier export instead of adding one.
ALTER TABLE `exports` ADD COLUMN `source_key` text;
ALTER TABLE `exports` ADD COLUMN `chapter_version` integer;
-- NULL source keys (exports made before this migration) never collide in SQLite.
CREATE UNIQUE INDEX `exports_project_source_unique` ON `exports` (`project_id`, `scope`, `format`, `source_key`);
-- Show a version on older single-chapter exports: the chapter's latest version at export time.
UPDATE `exports`
SET `chapter_version` = (
  SELECT MAX(v.`version`) FROM `chapter_versions` v
  WHERE v.`chapter_id` = `exports`.`chapter_id` AND v.`created_at` <= `exports`.`created_at`
)
WHERE `scope` = 'chapter' AND `chapter_id` IS NOT NULL AND `chapter_version` IS NULL;

-- Document structure preference on project_settings: chapters (1) vs continuous numbered sections (0).
-- Existing records default to 1 (chapters) to preserve full backward compatibility.
ALTER TABLE `project_settings` ADD COLUMN `use_chapters` integer NOT NULL DEFAULT 1;

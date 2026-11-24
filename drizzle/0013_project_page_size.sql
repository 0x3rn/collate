-- Document-wide paper size preference (A4 vs US Letter) on project_settings
ALTER TABLE `project_settings` ADD COLUMN `page_size` text NOT NULL DEFAULT 'a4';

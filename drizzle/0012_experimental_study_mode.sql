-- Experimental / empirical study mode preference on project_settings
ALTER TABLE `project_settings` ADD COLUMN `is_experimental` integer NOT NULL DEFAULT 0;
ALTER TABLE `project_settings` ADD COLUMN `experimental_data_mode` text NOT NULL DEFAULT 'user_provided';

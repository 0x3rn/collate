-- Pre-start chapter instructions, experimental notes, and CSV/Markdown attachment summaries
ALTER TABLE `chapters` ADD COLUMN `user_instructions` text;
ALTER TABLE `chapters` ADD COLUMN `user_attachment_name` text;
ALTER TABLE `chapters` ADD COLUMN `user_attachment_kind` text;
ALTER TABLE `chapters` ADD COLUMN `user_data_summary_markdown` text;

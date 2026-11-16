-- An event's extra details for its About page: prizes, topics, questions and answers, announcements (JSON).
ALTER TABLE `ContestSettings` ADD COLUMN `extras` TEXT NOT NULL DEFAULT '{}';

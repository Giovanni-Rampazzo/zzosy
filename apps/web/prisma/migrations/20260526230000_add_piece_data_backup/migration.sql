-- Anti-falhas: backup do data anterior pra recovery rapida apos save corrompido
ALTER TABLE `Piece` ADD COLUMN `dataBackup` LONGTEXT NULL;

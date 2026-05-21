-- Piece.thumbnailUrl: coluna dedicada pra preview (antes imageUrl fazia dobro
-- de export final + thumbnail; agora imageUrl fica pro export, thumbnailUrl
-- pra UI/lista/PPTX).
ALTER TABLE `Piece` ADD COLUMN `thumbnailUrl` LONGTEXT NULL;

-- Backfill: pieces existentes herdam thumbnailUrl = imageUrl pra UI nao perder
-- preview no primeiro carregamento. Proximo save no editor sobrescreve.
UPDATE `Piece` SET `thumbnailUrl` = `imageUrl` WHERE `imageUrl` IS NOT NULL;

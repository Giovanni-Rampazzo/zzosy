-- Aumenta capacidade da coluna Client.logoUrl de TEXT (64KB) pra LONGTEXT (4GB).
-- TEXT estourava com base64 de logos comuns (PNG/JPG 200KB+ inflam pra ~270KB+).
ALTER TABLE `Client` MODIFY COLUMN `logoUrl` LONGTEXT NULL;

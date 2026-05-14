-- Baseline manual: alinha o historico do Prisma com colunas que ja existiam
-- no banco mas nao tinham migration. NAO sera reexecutada (foi marcada
-- como ja aplicada via `prisma migrate resolve --applied`).

ALTER TABLE `CampaignAsset` ADD COLUMN `lastOverride` JSON NULL;

ALTER TABLE `MediaFormat` ADD COLUMN `widthValue` DOUBLE NULL;
ALTER TABLE `MediaFormat` ADD COLUMN `widthUnit` VARCHAR(8) NULL DEFAULT 'px';
ALTER TABLE `MediaFormat` ADD COLUMN `heightValue` DOUBLE NULL;
ALTER TABLE `MediaFormat` ADD COLUMN `heightUnit` VARCHAR(8) NULL DEFAULT 'px';

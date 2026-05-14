-- Adiciona campos de identidade visual do cliente
ALTER TABLE `Client` ADD COLUMN `brandFont` VARCHAR(191) NULL;
ALTER TABLE `Client` ADD COLUMN `brandColors` JSON NULL;

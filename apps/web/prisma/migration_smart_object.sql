-- Migration manual: SmartObjectFile + smartObjectId em CampaignAsset
-- Pode rodar manualmente no MySQL OU usar `npx prisma migrate dev --name add_smart_object_file`

-- 1. Cria tabela SmartObjectFile
CREATE TABLE `SmartObjectFile` (
  `id` VARCHAR(191) NOT NULL,
  `campaignId` VARCHAR(191) NOT NULL,
  `guid` VARCHAR(64) NOT NULL,
  `filePath` LONGTEXT NOT NULL,
  `mime` VARCHAR(100) NOT NULL,
  `originalName` VARCHAR(500) NOT NULL,
  `sizeBytes` INT NOT NULL,
  `width` INT NULL,
  `height` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `SmartObjectFile_campaignId_idx`(`campaignId`),
  INDEX `SmartObjectFile_guid_idx`(`guid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2. FK pra Campaign (cascade)
ALTER TABLE `SmartObjectFile`
  ADD CONSTRAINT `SmartObjectFile_campaignId_fkey`
  FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Adiciona smartObjectId em CampaignAsset
ALTER TABLE `CampaignAsset`
  ADD COLUMN `smartObjectId` VARCHAR(191) NULL;

-- 4. Index pra lookups
CREATE INDEX `CampaignAsset_smartObjectId_idx`
  ON `CampaignAsset`(`smartObjectId`);

-- 5. FK pra SmartObjectFile (set null ao deletar SO)
ALTER TABLE `CampaignAsset`
  ADD CONSTRAINT `CampaignAsset_smartObjectId_fkey`
  FOREIGN KEY (`smartObjectId`) REFERENCES `SmartObjectFile`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

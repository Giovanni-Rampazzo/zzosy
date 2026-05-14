-- AlterTable
ALTER TABLE `CampaignAsset` ADD COLUMN `smartObjectId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `SmartObjectFile` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `guid` VARCHAR(64) NOT NULL,
    `filePath` LONGTEXT NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `originalName` VARCHAR(500) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SmartObjectFile_campaignId_idx`(`campaignId`),
    INDEX `SmartObjectFile_guid_idx`(`guid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `CampaignAsset_smartObjectId_idx` ON `CampaignAsset`(`smartObjectId`);

-- AddForeignKey
ALTER TABLE `CampaignAsset` ADD CONSTRAINT `CampaignAsset_smartObjectId_fkey` FOREIGN KEY (`smartObjectId`) REFERENCES `SmartObjectFile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SmartObjectFile` ADD CONSTRAINT `SmartObjectFile_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

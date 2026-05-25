-- AlterTable
ALTER TABLE `CampaignAsset` ADD COLUMN `libraryAssetDetached` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `libraryAssetId` VARCHAR(30) NULL,
    ADD COLUMN `libraryAssetVersion` INTEGER NULL,
    ADD COLUMN `slotKey` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Client` ADD COLUMN `customFontUrl` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `MediaFormat` ADD COLUMN `segment` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Tenant` ADD COLUMN `brandFooterText` VARCHAR(191) NULL,
    ADD COLUMN `brandLogoUrl` LONGTEXT NULL,
    ADD COLUMN `brandName` VARCHAR(191) NULL,
    ADD COLUMN `brandPrimaryColor` VARCHAR(16) NULL,
    ADD COLUMN `brandSecondaryLogoUrl` LONGTEXT NULL;

-- CreateTable
CREATE TABLE `ClientLibraryAsset` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slotKey` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NULL,
    `lastOverride` JSON NULL,
    `imageUrl` LONGTEXT NULL,
    `thumbnailUrl` LONGTEXT NULL,
    `smartObjectId` VARCHAR(191) NULL,
    `tags` JSON NULL,
    `notes` TEXT NULL,
    `meta` JSON NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    INDEX `ClientLibraryAsset_clientId_type_idx`(`clientId`, `type`),
    INDEX `ClientLibraryAsset_clientId_updatedAt_idx`(`clientId`, `updatedAt`),
    INDEX `ClientLibraryAsset_slotKey_idx`(`slotKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientLibrarySmartObjectFile` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `guid` VARCHAR(64) NOT NULL,
    `filePath` LONGTEXT NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `originalName` VARCHAR(500) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ClientLibrarySmartObjectFile_clientId_idx`(`clientId`),
    INDEX `ClientLibrarySmartObjectFile_guid_idx`(`guid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `CampaignAsset_libraryAssetId_idx` ON `CampaignAsset`(`libraryAssetId`);

-- CreateIndex
CREATE INDEX `CampaignAsset_slotKey_idx` ON `CampaignAsset`(`slotKey`);

-- AddForeignKey
ALTER TABLE `CampaignAsset` ADD CONSTRAINT `CampaignAsset_libraryAssetId_fkey` FOREIGN KEY (`libraryAssetId`) REFERENCES `ClientLibraryAsset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientLibraryAsset` ADD CONSTRAINT `ClientLibraryAsset_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientLibraryAsset` ADD CONSTRAINT `ClientLibraryAsset_smartObjectId_fkey` FOREIGN KEY (`smartObjectId`) REFERENCES `ClientLibrarySmartObjectFile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientLibrarySmartObjectFile` ADD CONSTRAINT `ClientLibrarySmartObjectFile_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


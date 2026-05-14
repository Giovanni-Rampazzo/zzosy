/*
  Warnings:

  - You are about to drop the column `segment` on the `Campaign` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `Campaign` DROP COLUMN `segment`;

-- AlterTable
ALTER TABLE `Piece` ADD COLUMN `copy` LONGTEXT NULL,
    ADD COLUMN `segment` VARCHAR(255) NULL;

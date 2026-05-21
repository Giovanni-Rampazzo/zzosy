-- F6.3: Delivery.status PT (alinha com Piece.status que ja eh PT).
-- Atualiza rows existentes ANTES de mudar o default. Em DBs onde a tabela
-- esta vazia, o UPDATE simplesmente nao toca nada.
UPDATE `Delivery` SET `status` = 'PENDENTE' WHERE `status` = 'PENDING';
UPDATE `Delivery` SET `status` = 'ENVIADA'  WHERE `status` = 'SENT';

-- Default novo. Pieces criadas dali em diante ja entram em PT.
ALTER TABLE `Delivery` MODIFY COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'PENDENTE';

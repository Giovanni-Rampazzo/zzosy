-- Migra status antigos pro enum unificado.
-- Rodar uma vez no MySQL local: mysql -u root -p zzosy < prisma/migrations-data/2026-05-06-status-unify.sql
-- Ou colar no phpMyAdmin > SQL.

-- Pieces
UPDATE Piece SET status = 'STANDBY'   WHERE status = 'DRAFT';
UPDATE Piece SET status = 'CLIENTE'   WHERE status = 'REVIEW';
UPDATE Piece SET status = 'APROVADO'  WHERE status = 'APPROVED';
UPDATE Piece SET status = 'ENTREGUE'  WHERE status = 'EXPORTED';

-- Campaigns (mesmo mapeamento)
UPDATE Campaign SET status = 'STANDBY'  WHERE status = 'DRAFT';
UPDATE Campaign SET status = 'CLIENTE'  WHERE status = 'REVIEW';
UPDATE Campaign SET status = 'APROVADO' WHERE status = 'APPROVED';
UPDATE Campaign SET status = 'ENTREGUE' WHERE status = 'EXPORTED';

-- Verifica resultado
SELECT 'Pieces' AS tabela, status, COUNT(*) AS total FROM Piece GROUP BY status
UNION ALL
SELECT 'Campaigns', status, COUNT(*) FROM Campaign GROUP BY status;

-- Taxonomia compartilhada do tenant: 3 listas globais (segments, categories, filters)
-- usadas por toda entidade do ZZOSY (clientes, campanhas, peças, mídias).
-- Auto-merge: valores criados em qualquer entidade sao appended sem duplicar.
-- Estrutura JSON: { segments: string[], categories: string[], filters: string[] }
ALTER TABLE `Tenant` ADD COLUMN `taxonomy` JSON NULL;

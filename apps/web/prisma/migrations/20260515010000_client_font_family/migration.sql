-- Adiciona customFontFiles JSON pra familia completa de fonte custom.
-- Substitui o uso de customFontUrl (mantido no schema apenas como legado).
-- Estrutura do JSON:
--   [{ url, weight: number 100-900, style: "normal"|"italic", fileName }]
ALTER TABLE `Client` ADD COLUMN `customFontFiles` JSON NULL;

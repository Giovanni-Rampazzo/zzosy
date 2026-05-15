-- 4 presets tipograficos (titulo, subtitulo, body, legenda) com peso e tamanho.
-- Estrutura JSON:
--   { titulo: { fontWeight: number, fontSize: number }, subtitulo: {...}, body: {...}, legenda: {...} }
ALTER TABLE `Client` ADD COLUMN `brandTypography` JSON NULL;

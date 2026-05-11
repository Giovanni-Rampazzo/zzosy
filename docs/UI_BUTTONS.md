# Padrão de botões e navegação ZZOSY

Este é o guia oficial de UI para botões e navegação no produto. Editável.
Componente: `components/ui/Button.tsx`.

## Hierarquia visual (do mais para o menos enfático)

### primary — amarelo cheio (`#F5C400`)
**Quando usar:** botão que o usuário **provavelmente vai clicar a seguir** —
a ação que continua o fluxo natural da página.

Exemplos:
- "Importar PSD" e "Editar Matriz (KV)" na home da campanha (fluxo natural após criar a campanha)
- "Peças" na sub-nav (próximo destino após editar a matriz)
- "Salvar e sair" no editor (CTA principal do modal)
- "Aplicar" / "Confirmar" no modal de ação principal

**Quando NÃO usar:** se a página tiver 5 botões e todos forem amarelos, nada
mais é destaque. Reserve para **1 ou 2 ações** principais por área.

### secondary — branco com borda cinza escuro `#555`
**Quando usar:** botão neutro, sem urgência. Default do sistema.

Exemplos:
- "+ Adicionar asset" (ação útil, mas não é o caminho principal)
- "Cancelar" em modais
- "Voltar para Cliente" / "← Cliente" (navegação reversa)
- Botões de filtro/sort

## Cores semânticas

Todos com **fill branco + borda e texto da cor** (outline style).

### danger — vermelho `#dc2626`
Ações destrutivas: Apagar, Remover, Excluir, Deletar definitivamente.

### success — verde `#15803d`
Confirmar, Aprovar, OK final. Ex: "Aprovar peça" no fluxo de aprovação.

### warning — laranja `#d97706`
Atenção, avisos não-bloqueantes. Ex: "Status: pendente" como botão.

### info — azul `#2563eb`
Ações intermediárias / informacionais. Ex: "Duplicar", "Copiar", "Ver detalhes".

### ghost — cinza claro `#888`
Ações secundárias menos importantes. Ex: "Limpar filtros".

### link — texto amarelo, sem borda
Navegação inline em fluxo de leitura. Não usar em barras de ação.

## Regra de ouro

> Todo botão com **fill branco** DEVE ter borda visível (stroke). Nunca botão
> sem borda em cima de fundo branco — fica "perdido". Únicas exceções:
> `primary` (amarelo cheio) e `link`.

## Tamanhos

- `sm` — `px-3 py-1.5 text-xs` — botões compactos em listas, filtros, tabelas
- `md` — `px-4 py-2 text-sm` — default
- `lg` — `px-6 py-2.5 text-base` — CTAs principais e navegação primária

## Estados

- `disabled` / `loading` — opacity 50% + cursor not-allowed
- `hover` — definido por variante (geralmente sombra/cor mais escura)

## Lógica de navegação por camadas

ZZOSY tem 3 camadas de navegação:

### 1. Topnav (global)
Sempre visível. Áreas do sistema: Clientes, Campanhas, Peças, Mídias,
Aprovação, Entregas, Admin, Account.

### 2. Sub-nav contextual (por escopo)
Aparece em páginas dentro de um cliente ou campanha. Contém:
- **Linha 1 (navegação):** voltar ao escopo pai + atalhos para irmãos
  no mesmo escopo. Ex: `← Cliente` + `Peças` (dentro de uma campanha).
- **Linha 2 (ações):** botões de ação da página atual (criar, importar,
  editar). Lado a lado, mesmo tamanho, alinhados à esquerda.

Componente: `components/campaign/CampaignSubnav.tsx`.

### 3. Conteúdo da página
Filtros, sorts, tabelas, formulários. Botões aqui são `sm` ou `md`.

## Botão "Peças" da sub-nav

Por que `primary` (amarelo) mesmo sendo navegação:

Dentro de uma campanha, o fluxo natural é:
1. Criar campanha → 2. Importar PSD → 3. Editar Matriz → 4. **Ver peças**

"Peças" é o próximo destino lógico depois do trabalho na matriz. Faz sentido
ser destaque visual. Se virasse `secondary`, o usuário poderia não notar
que existe um botão dedicado de peças por campanha.

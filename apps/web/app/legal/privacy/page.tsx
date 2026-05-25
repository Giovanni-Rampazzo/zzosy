export const metadata = {
  title: "Política de Privacidade — ZZOSY",
  description: "Como a ZZOSY coleta, armazena e protege seus dados (LGPD).",
}

export default function PrivacyPage() {
  return (
    <article>
      <h1 style={h1}>Política de Privacidade</h1>
      <p style={small}>Última atualização: 25 de maio de 2026 · Conforme LGPD (Lei nº 13.709/2018)</p>

      <p>
        Esta Política descreve como a <strong>ZZOSY</strong> coleta, utiliza, armazena e protege os
        dados pessoais dos usuários da plataforma. Ao usar a ZZOSY, você concorda com as práticas
        descritas neste documento.
      </p>

      <h2 style={h2}>1. Controlador dos Dados</h2>
      <p>
        <strong>[Razão Social — preencher]</strong>, CNPJ <em>[CNPJ]</em>, sede em <em>[Endereço]</em>.
      </p>
      <p>
        Encarregado de Proteção de Dados (DPO): <em>[Nome / E-mail — preencher, ex: dpo@zzosy.com]</em>.
      </p>

      <h2 style={h2}>2. Dados que Coletamos</h2>
      <ul>
        <li><strong>Cadastro</strong>: nome, e-mail, senha (armazenada como hash bcrypt).</li>
        <li><strong>Empresa</strong>: razão social, CNPJ, dados de cobrança quando aplicável.</li>
        <li><strong>Conteúdo</strong>: arquivos enviados (PSDs, imagens, smart objects, fontes
          custom), peças geradas, campanhas, clientes cadastrados na conta.</li>
        <li><strong>Uso</strong>: logs de acesso, IP, user-agent, ações realizadas (auditoria).</li>
        <li><strong>Cookies</strong>: sessão (autenticação NextAuth JWT). Sem cookies de terceiros
          para tracking publicitário.</li>
      </ul>

      <h2 style={h2}>3. Finalidades</h2>
      <p>Usamos os dados para:</p>
      <ul>
        <li>Operar a plataforma e prestar os serviços contratados.</li>
        <li>Autenticar e proteger sua conta.</li>
        <li>Faturamento e gestão de planos.</li>
        <li>Comunicações operacionais (recuperação de senha, alertas de segurança, notas de versão).</li>
        <li>Melhoria do produto (métricas agregadas e anônimas).</li>
        <li>Cumprimento de obrigações legais e regulatórias.</li>
      </ul>

      <h2 style={h2}>4. Base Legal (LGPD Art. 7º)</h2>
      <ul>
        <li><strong>Execução de contrato</strong>: cadastro, prestação de serviço, cobrança.</li>
        <li><strong>Cumprimento de obrigação legal</strong>: notas fiscais, retenção fiscal.</li>
        <li><strong>Legítimo interesse</strong>: segurança (logs anti-fraude), melhoria do produto.</li>
        <li><strong>Consentimento</strong>: comunicações de marketing (opt-in).</li>
      </ul>

      <h2 style={h2}>5. Compartilhamento com Terceiros</h2>
      <p>
        Não vendemos dados pessoais. Compartilhamos apenas com operadores essenciais à prestação do
        serviço, sob contrato e com obrigações de confidencialidade equivalentes às nossas:
      </p>
      <ul>
        <li><strong>Hospedagem</strong>: Railway (infraestrutura cloud).</li>
        <li><strong>Banco de dados</strong>: MySQL gerenciado pela Railway.</li>
        <li><strong>E-mail transacional</strong>: Resend ou equivalente (substituir conforme escolha).</li>
        <li><strong>Pagamento</strong>: Stripe (PCI-DSS Level 1) — dados de cartão NÃO transitam por nossos servidores.</li>
        <li><strong>Monitoramento</strong>: Sentry (logs de erro), provedor de logs estruturados.</li>
      </ul>

      <h2 style={h2}>6. Armazenamento e Retenção</h2>
      <p>
        Dados são armazenados em servidores localizados em <em>[região cloud, ex: sa-east-1]</em>.
        Período de retenção:
      </p>
      <ul>
        <li><strong>Conta ativa</strong>: enquanto durar a relação contratual.</li>
        <li><strong>Após cancelamento</strong>: 30 dias para reativação; após esse prazo, dados pessoais
          são anonimizados ou excluídos, exceto registros fiscais (5 anos, exigência legal).</li>
        <li><strong>Logs de segurança</strong>: 180 dias.</li>
      </ul>

      <h2 style={h2}>7. Seus Direitos (LGPD Art. 18)</h2>
      <p>Você pode, a qualquer momento, solicitar:</p>
      <ul>
        <li>Confirmação da existência de tratamento.</li>
        <li>Acesso aos seus dados.</li>
        <li>Correção de dados incompletos ou desatualizados.</li>
        <li>Anonimização, bloqueio ou eliminação de dados desnecessários.</li>
        <li>Portabilidade dos dados.</li>
        <li>Eliminação dos dados tratados com base no consentimento.</li>
        <li>Revogação do consentimento.</li>
      </ul>
      <p>
        Para exercer qualquer um desses direitos, envie um e-mail ao DPO. Responderemos em até
        15 dias corridos.
      </p>

      <h2 style={h2}>8. Segurança</h2>
      <p>
        Adotamos medidas técnicas e administrativas para proteger seus dados:
      </p>
      <ul>
        <li>Conexões HTTPS (TLS 1.2+).</li>
        <li>Senhas armazenadas como hash bcrypt (nunca em texto puro).</li>
        <li>Multi-tenant isolation (cada conta acessa apenas seus próprios dados).</li>
        <li>Rate limiting em endpoints sensíveis (brute-force protection).</li>
        <li>Backups diários com retenção de 30 dias.</li>
        <li>Monitoramento de logs com alertas para atividade suspeita.</li>
      </ul>
      <p>
        Apesar dos esforços, nenhum sistema é 100% seguro. Em caso de incidente que possa
        acarretar risco aos direitos dos titulares, notificaremos a ANPD e os titulares afetados
        conforme exigido pela LGPD.
      </p>

      <h2 style={h2}>9. Cookies</h2>
      <p>
        Usamos um cookie de sessão (<code>next-auth.session-token</code>) para manter o login
        ativo. Não usamos cookies de terceiros para publicidade ou tracking cross-site.
      </p>

      <h2 style={h2}>10. Crianças e Adolescentes</h2>
      <p>
        A ZZOSY é destinada a uso profissional/empresarial. Não coletamos intencionalmente dados
        de menores de 18 anos. Caso identifiquemos dados de menores em nossa base, serão excluídos
        imediatamente.
      </p>

      <h2 style={h2}>11. Transferência Internacional</h2>
      <p>
        Alguns operadores (Stripe, Sentry, etc.) podem processar dados em servidores fora do
        Brasil. Garantimos que essas transferências ocorrem com base em cláusulas contratuais
        padrão ou outras salvaguardas adequadas previstas na LGPD.
      </p>

      <h2 style={h2}>12. Alterações nesta Política</h2>
      <p>
        Podemos atualizar esta Política periodicamente. Mudanças materiais serão comunicadas
        com 30 dias de antecedência por e-mail ou aviso na Plataforma.
      </p>

      <h2 style={h2}>13. Contato e Reclamações</h2>
      <p>
        Dúvidas sobre privacidade: <a href="mailto:dpo@zzosy.com" style={link}>dpo@zzosy.com</a> (preencher).
      </p>
      <p>
        Você também pode entrar em contato com a Autoridade Nacional de Proteção de Dados (ANPD)
        para registrar reclamações: <a href="https://www.gov.br/anpd/" style={link} rel="noopener noreferrer" target="_blank">www.gov.br/anpd</a>.
      </p>
    </article>
  )
}

const h1: React.CSSProperties = { fontSize: 32, fontWeight: 800, margin: "0 0 8px", letterSpacing: -0.5 }
const h2: React.CSSProperties = { fontSize: 19, fontWeight: 700, margin: "32px 0 12px", color: "#111" }
const small: React.CSSProperties = { fontSize: 12, color: "#888", marginBottom: 32 }
const link: React.CSSProperties = { color: "#B8A100", textDecoration: "underline" }

export const metadata = {
  title: "Termos de Uso — ZZOSY",
  description: "Termos e condições de uso da plataforma ZZOSY.",
}

export default function TermsPage() {
  return (
    <article>
      <h1 style={h1}>Termos de Uso</h1>
      <p style={small}>Última atualização: 25 de maio de 2026</p>

      <p>
        Estes Termos de Uso (&quot;Termos&quot;) regulam o acesso e uso da plataforma <strong>ZZOSY</strong>,
        operada por <em>[Razão Social — preencher]</em>, inscrita no CNPJ sob o nº <em>[CNPJ — preencher]</em>,
        com sede em <em>[Endereço — preencher]</em> (&quot;ZZOSY&quot;, &quot;nós&quot;).
      </p>
      <p>
        Ao criar uma conta, acessar ou utilizar a plataforma, você (&quot;Usuário&quot;) declara ter
        lido, compreendido e aceitado integralmente estes Termos e a nossa{" "}
        <a href="/legal/privacy" style={link}>Política de Privacidade</a>.
      </p>

      <h2 style={h2}>1. Definições</h2>
      <ul>
        <li><strong>Plataforma</strong>: o software ZZOSY, acessível via web (incluindo APIs).</li>
        <li><strong>Conta</strong>: registro do Usuário autorizando o uso da Plataforma.</li>
        <li><strong>Conteúdo do Usuário</strong>: arquivos, dados, imagens, PSDs, textos e outros
          materiais que o Usuário envia ou cria na Plataforma.</li>
      </ul>

      <h2 style={h2}>2. Cadastro e Conta</h2>
      <p>
        Para utilizar a Plataforma é necessária a criação de uma conta com informações verdadeiras
        e atualizadas. O Usuário é responsável pelo sigilo das credenciais e por toda atividade
        realizada em sua conta.
      </p>

      <h2 style={h2}>3. Uso Permitido</h2>
      <p>O Usuário concorda em:</p>
      <ul>
        <li>Utilizar a Plataforma exclusivamente para fins lícitos.</li>
        <li>Não enviar conteúdo de terceiros sem a devida autorização (incluindo direitos autorais
          de imagens, fontes e marcas).</li>
        <li>Não fazer engenharia reversa, descompilação ou tentar contornar mecanismos de segurança.</li>
        <li>Não usar a Plataforma para spam, fraude, distribuição de malware ou qualquer atividade
          que viole leis brasileiras ou internacionais.</li>
      </ul>

      <h2 style={h2}>4. Propriedade Intelectual</h2>
      <p>
        O software, marca, logotipos, interface e demais elementos da ZZOSY são de propriedade da
        ZZOSY e protegidos pela legislação brasileira de propriedade intelectual. O Usuário
        mantém todos os direitos sobre o Conteúdo do Usuário, concedendo à ZZOSY apenas a
        licença necessária para armazenamento, processamento e prestação dos serviços contratados.
      </p>

      <h2 style={h2}>5. Plano, Cobrança e Cancelamento</h2>
      <p>
        Os planos disponíveis, valores e ciclos de cobrança estão descritos na página de planos
        da Plataforma. O cancelamento pode ser realizado a qualquer momento pelo painel da conta,
        com efeito ao final do ciclo de faturamento atual. Valores já pagos não são reembolsáveis,
        salvo previsão legal em contrário.
      </p>

      <h2 style={h2}>6. Disponibilidade do Serviço</h2>
      <p>
        Empregamos esforços razoáveis para manter a Plataforma disponível 24/7, mas não garantimos
        disponibilidade ininterrupta. Manutenções programadas, falhas de provedores terceiros ou
        eventos de força maior podem causar indisponibilidade.
      </p>

      <h2 style={h2}>7. Limitação de Responsabilidade</h2>
      <p>
        Na máxima extensão permitida pela legislação aplicável, a ZZOSY não será responsável por
        danos indiretos, lucros cessantes, perda de dados ou interrupção de negócio decorrentes
        do uso ou impossibilidade de uso da Plataforma. A responsabilidade total da ZZOSY em
        qualquer hipótese fica limitada ao valor efetivamente pago pelo Usuário nos 12 meses
        anteriores ao evento que originou a reclamação.
      </p>

      <h2 style={h2}>8. Modificações</h2>
      <p>
        Podemos atualizar estes Termos periodicamente. Alterações materiais serão comunicadas com
        antecedência razoável por e-mail ou aviso na Plataforma. O uso continuado após a
        notificação implica aceitação das novas condições.
      </p>

      <h2 style={h2}>9. Encerramento</h2>
      <p>
        A ZZOSY pode suspender ou encerrar a conta do Usuário, com aviso prévio, em caso de
        violação destes Termos, inadimplência ou risco à segurança da Plataforma. Após o
        encerramento, o Conteúdo do Usuário pode ser excluído após 30 dias, conforme detalhado
        em nossa <a href="/legal/privacy" style={link}>Política de Privacidade</a>.
      </p>

      <h2 style={h2}>10. Lei Aplicável e Foro</h2>
      <p>
        Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro
        da comarca de <em>[Cidade/UF — preencher]</em> para dirimir quaisquer controvérsias, com
        renúncia a qualquer outro, por mais privilegiado que seja.
      </p>

      <h2 style={h2}>11. Contato</h2>
      <p>
        Dúvidas sobre estes Termos: <a href="mailto:contato@zzosy.com" style={link}>contato@zzosy.com</a> {" "}
        (substitua pelo email oficial).
      </p>
    </article>
  )
}

const h1: React.CSSProperties = { fontSize: 32, fontWeight: 800, margin: "0 0 8px", letterSpacing: -0.5 }
const h2: React.CSSProperties = { fontSize: 19, fontWeight: 700, margin: "32px 0 12px", color: "#111" }
const small: React.CSSProperties = { fontSize: 12, color: "#888", marginBottom: 32 }
const link: React.CSSProperties = { color: "#B8A100", textDecoration: "underline" }

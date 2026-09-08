# ACS Pilot · 0.2.0

**GitHub e teste no Mac:** siga [COMECE_AQUI.md](COMECE_AQUI.md).

Plataforma privada para preparar implantação de ACS pela interface web dos equipamentos administrados pelo operador. Esta versão inclui servidor persistente e agente local; os roteiros precisam de validação por firmware.

## Implementado

- Modelos e roteiros JSON por firmware, listas ordenadas de credenciais e inventário CSV.
- Cadastros por usuário em D1, criptografados com AES-256-GCM. As senhas salvas não são devolvidas pela API de cadastros.
- Pacotes de até 100 equipamentos, criptografados com chave individual exibida uma vez e validade de 12 horas.
- Agente Python para macOS/Linux: login por formulário HTML, campos TR-069, releitura e relatório autenticado com HMAC-SHA256.
- Validação de login, modelo, firmware e série antes de habilitar implantação. Nova conferência antes de gravar.
- Até cinco tentativas, pausa mínima de 30 segundos e interrupção em bloqueio ou login ambíguo.
- Pausa, retomada, encerramento e checkpoint anterior ao acesso. Operações incertas não são repetidas automaticamente.
- Histórico de relatórios importados. Estado distinto para configuração aplicada e nova comunicação observada no GenieACS.
- Simulações visuais separadas. Os 24 equipamentos e seis modelos iniciais são ilustrativos e não executam acessos reais.

## Primeiro piloto

Abra **Agente local** e baixe o ZIP. O [guia do agente](agent/README.md) contém instalação, simulador e procedimento completo. A comunicação com o agente ocorre por pacote e relatório, sem conexão contínua nesta versão.

Para um equipamento real, precisamos de fabricante, modelo, firmware exato, acesso de gerência, telas ou HTML de login/status/TR-069, política de bloqueio e parâmetros do ACS. Os perfis iniciais não são adaptadores homologados. Validar o login não valida o roteiro de gravação; acompanhe a primeira implantação em um equipamento de laboratório.

## Persistência

Frontend React/Vinext; APIs em `/api/state`, `/api/jobs` e `/api/results`. Identidade obtida do cabeçalho confiável do proxy; escritas exigem a origem configurada. Migração inicial em `drizzle/0000_uneven_namor.sql` e binding D1 em `.openai/hosting.json`.

Variáveis de produção: `VAULT_KEY` (segredo base64 de 32 bytes) e `APP_ORIGIN` (origem HTTPS exata). Não substitua a chave existente sem migrar os dados criptografados. Os valores reais ficam no ambiente de execução, fora do repositório.

Limites: cadastro de até 1 MB antes da criptografia, até 500 modelos, 100 listas e 10 mil equipamentos dentro desse tamanho. A interface exibe os 50 lotes mais recentes.

## Verificação

```bash
node --test tests/api-functional.test.mjs
python3 -m unittest discover -s agent -p test_agent.py
python3 scripts/package-agent.py
```

O teste Node usa SQLite real com uma camada equivalente à API D1 e verifica criptografia JavaScript, descriptografia/execução em Python e importação do relatório. Os testes do executor simulam a API Playwright, sem navegador.

Nesta entrega foram verificados build de produção, tipos da interface, servidor, protocolo e testes unitários do agente. O download do Chromium falhou neste ambiente; `agent/selftest_browser.py` foi incluído para execução após a instalação do navegador, mas não foi aprovado aqui. Nenhum roteador, ONU ou ACS real foi acessado.

## Limites conhecidos

- Driver inicial: formulário HTML, identidade textual após login, inputs, checkboxes, um iframe opcional na configuração e até dez cliques declarativos. HTTP Basic, CAPTCHA, controles personalizados e interfaces diferentes exigem adaptação.
- IPv4 com porta e protocolo explícitos. Sem descoberta de rede, API OLT, TR-369, configuração PPPoE/VLAN ou suporte universal a fabricantes.
- Sem cancelamento remoto: pacote baixado funciona independentemente. A expiração é aplicada pelo agente oficial e não revoga o acesso de quem possui arquivo e chave.
- A assinatura verifica integridade e posse da chave do pacote; não é atestação independente de hardware ou prova contra um operador que modifica o agente.
- Um equipamento por vez. O lock local vale para o mesmo arquivo de resultado, não para máquinas diferentes ou cópias do pacote.
- Gravação interrompida resulta em estado incerto. Sem rollback, reboot ou repetição automáticos.
- Senha ACS e token NBI em branco preservam valores salvos. Credenciais web podem ser removidas e cadastradas novamente. Removê-las não apaga cópias de pacotes já exportados.
- Confirmação GenieACS exige NBI acessível, ID exato e relógio sincronizado. O token Bearer é para um proxy compatível. Inform pode demorar além da observação de 30 segundos.
- Sem agendamento central, gestão de equipes ou rotação de chaves nesta versão.

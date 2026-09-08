# ACS Pilot — agente local 0.2.0

O agente abre a interface web dos equipamentos incluídos em um pacote da plataforma. Execute no Mac ou Linux que alcança a rede de gerência. Esta versão funciona por arquivos: pacote de execução e relatório.

## Instalação

Requer Python 3.11 ou superior. Extraia o ZIP e abra um terminal na pasta:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m playwright install chromium
```

Em Linux, se faltarem bibliotecas do sistema para Chromium, instale as dependências indicadas pelo instalador conforme seu procedimento administrativo habitual.

## Testar com o simulador

```bash
python selftest_browser.py --show-browser
```

O comando inicia um servidor apenas em `127.0.0.1`, abre Chromium e verifica login, identidade, validação sem escrita, gravação, releitura e repetição sem nova gravação. Usa somente credenciais fictícias e não acessa equipamentos ou ACS externos. O teste de navegador não pôde ser executado no ambiente de criação porque o download do Chromium falhou; o resultado válido será o obtido na sua máquina.

Para testar também as telas da plataforma, mantenha o simulador aberto em outro terminal:

```bash
python simulator.py
```

Ele cria `modelo-laboratorio.json` e escuta em `http://127.0.0.1:8765`. Na plataforma:

1. Adicione uma lista de laboratório e uma credencial fictícia: usuário `operator`, senha `correct-test-password`, limite de uma tentativa.
2. Em **Modelos e roteiros → Adicionar modelo**, importe o JSON criado e escolha essa lista de credenciais. Firmware: `1.0`.
3. Importe este CSV no inventário e selecione o equipamento:

   ```csv
   nome,ip,porta,modelo,firmware
   LAB-001,127.0.0.1,8765,LAB ROUTER,1.0
   ```

4. Em **Agente local**, gere um pacote de **Validar acesso**, baixe o arquivo e guarde a chave mostrada separadamente.
5. Execute o pacote conforme abaixo e importe o relatório. Resultado esperado: **Acesso validado**.
6. Para testar a gravação, configure na plataforma o destino fictício `http://127.0.0.1:7547/cwmp`, credenciais fictícias, TR-069 habilitado e confirmação manual. Gere e execute um pacote de **Implantar ACS**. O simulador armazena campos em memória e não envia CWMP; o resultado correto é **Aguardando ACS**.

## Executar um pacote

```bash
python acs_agent.py caminho-do-pacote.acspkg --show-browser
```

Substitua o nome pelo arquivo baixado. Cole a chave quando solicitada: ela não aparece durante a digitação nem entra no histórico de comandos. Para rodar sem janela, omita `--show-browser`.

O relatório é salvo na pasta atual como `acs-resultado-ID.json`. Importe-o na mesma conta em **Agente local → Importar relatório assinado**. Ele informa tentativas, credencial por ID, série e estado, sem campos de senha. A URL do ACS no relatório omite credenciais embutidas, consulta e fragmento.

Controles no terminal, seguidos de Enter:

- `p`: solicita pausa. Uma gravação em andamento termina antes de pausar.
- `r`: retoma.
- `q` ou Ctrl+C: pede encerramento. A operação atual termina e o relatório é salvo.

Para retomar, use o mesmo pacote, na mesma pasta, conservando o arquivo de resultado. Só os itens **Não executado** são retomados. Se utilizar `--output meu-relatorio.json`, mantenha o mesmo caminho. Itens de estado incerto não são repetidos automaticamente.

## Primeiro equipamento real

Cadastre um roteiro novo por modelo e firmware; os modelos ilustrativos não executam acessos. Modelo, firmware e série devem aparecer como texto após o login. Cada seletor precisa identificar exatamente um elemento. O driver inicial suporta inputs, checkboxes e um iframe opcional na configuração.

Primeiro valide o acesso a um único equipamento de laboratório. Importe o resultado e só então gere a implantação. Validar login não comprova que os seletores de gravação estão corretos: acompanhe a primeira implantação com o navegador visível e confira equipamento e ACS. São necessários os parâmetros do ACS e telas do firmware real para adaptar o roteiro.

O agente testa somente as combinações operacionais cadastradas pelo operador, na ordem e limite do grupo: no máximo cinco tentativas com pausa mínima de 30 segundos. Interrompe diante de bloqueio informado pela interface ou resultado de login ambíguo.

## Confirmação no ACS

Parâmetros gravados e comunicação confirmada são estados diferentes. No modo manual, a releitura termina como **Aguardando ACS**. Para GenieACS, a API NBI deve estar acessível pelo agente e o `acs_id` exato deve estar no inventário CSV. A URL NBI não é a URL CWMP.

O verificador consulta `_lastInform` para esse ID e exige um novo evento após o início da gravação. A janela é de 30 segundos; sem novo Inform ou com NBI indisponível, continua aguardando. O relógio local deve estar sincronizado. O token Bearer opcional é para um proxy compatível, não para o login do roteador. Outros ACS precisam de verificador específico.

## Limites operacionais

- Um equipamento por vez, até 100 por pacote; validade de 12 horas para iniciar novas tentativas.
- Sem cancelamento remoto de pacote baixado. Não execute cópias simultâneas em máquinas ou arquivos de resultado diferentes.
- Quem possui pacote e chave consegue descriptografá-lo. A assinatura comprova integridade e vínculo ao pacote, não atestação independente de execução.
- Sem descoberta de rede, rollback, reboot, captura de tráfego ou vídeo. Resultado incerto exige conferência antes de novo lote.
- A releitura comprova campos não secretos. Senha pode não ser legível após salvar; autenticação ACS depende da confirmação posterior.
- Suporte inicial: macOS/Linux, IPv4, formulário HTML e controles simples. Windows, HTTP Basic, CAPTCHA, controles personalizados e múltiplos frames exigem adaptação.

Testes de contrato sem Chromium:

```bash
python -m unittest test_agent.py
```

# ACS Pilot — executar no Mac

## Roadmap v2 — iniciar o M0

Para preparar o Mac para a integração com GenieACS:

```bash
cd ~/acsbot
git pull --ff-only
bash diagnostico-mac.sh
```

Envie o resultado do Terminal para conferirmos o ambiente. O diagnóstico não
instala programas nem altera equipamentos. Veja os critérios em [M0](docs/M0.md).
A integração GenieACS e a fila sequencial estão no roadmap; as instruções por
pacotes abaixo descrevem a versão atualmente disponível.

## Abrir a plataforma local

Se o repositório já está no seu Mac:

```bash
cd ~/acsbot
git pull --ff-only
bash iniciar-mac.sh
```

A plataforma abre no navegador em **http://127.0.0.1:8787**. Mantenha o Terminal aberto enquanto estiver usando. **Ctrl+C** encerra o servidor; para abrir novamente, execute `bash iniciar-mac.sh`.

O comando inicia o painel de operação. Não executa simuladores nem acessa equipamentos automaticamente.

Na primeira inicialização, ele instala as dependências do painel e prepara a interface. Requer Node.js 22.13 ou superior e npm. Se o Mac tem Homebrew e falta um Node compatível, o script instala `node@22`. Sem Homebrew, ele indica a instalação oficial do Node.js. Depois da instalação inicial, os cadastros e o painel funcionam localmente; a execução dos equipamentos depende do acesso do Mac à rede de gerência.

Se ainda não baixou o projeto:

```bash
cd ~
git clone https://github.com/lucasgarciamoreira92-rgb/acsbot.git
cd acsbot
bash iniciar-mac.sh
```

## Preparar e executar um lote real

1. Em **Credenciais de acesso**, cadastre uma lista de usuários e senhas da operação.
2. Em **Modelos e roteiros**, cadastre ou importe o roteiro exato do modelo e firmware, vinculando a lista. Os seis modelos demonstrativos não são adaptadores homologados.
3. Em **Equipamentos**, importe os endereços e selecione os equipamentos do lote.
4. Em **Servidor ACS**, configure os parâmetros de destino.
5. Em **Agente local**, escolha **Validar acesso**, gere o pacote e baixe o arquivo. Guarde a chave mostrada nessa tela.
6. Abra outro Terminal e execute:

```bash
cd ~/acsbot
bash executar-agente-mac.sh
```

Escolha o arquivo `.acspkg` na janela que abrir. Cole a chave no Terminal quando solicitada. A chave não aparece durante a digitação. O navegador acessará somente os equipamentos do pacote.

O agente precisa de Python 3.11 ou superior. O script aproveita `agent/.venv` já instalado; quando necessário, prepara o ambiente e o Chromium. Você também pode indicar o pacote diretamente:

```bash
bash executar-agente-mac.sh "$HOME/Downloads/nome-do-pacote.acspkg"
```

Substitua o nome pelo arquivo real baixado. Ao terminar, importe o relatório no painel, em **Agente local → Importar relatório assinado**. Os relatórios ficam em `~/acsbot/.acs-local/results`. No seletor de arquivos do Mac, pressione **⌘⇧G** e cole esse caminho.

Depois de uma validação bem-sucedida importada, escolha **Implantar ACS**, gere o novo pacote e execute o agente novamente. Os limites de tentativas e a conferência de identidade continuam ativos. A comunicação com o ACS é confirmada separadamente da configuração gravada.

O andamento aparece no Terminal; o painel recebe o resultado quando você importa o relatório. Esta versão continua usando pacotes e relatórios, mesmo com tudo executado no Mac.

## Cadastros e chave local

Os cadastros deste computador ficam em `.acs-local/data/acsbot.sqlite`, com os campos do cadastro criptografados. A chave está em `.acs-local/data/vault.key`; o servidor cria a chave apenas na primeira inicialização e a mantém nas seguintes.

O banco local é independente do painel online. Os cadastros feitos online não aparecem automaticamente no Mac, e os feitos no Mac não são enviados ao serviço online.

Para um backup completo, encerre o servidor com Ctrl+C e copie a pasta `.acs-local/data` inteira, incluindo banco e chave. Não exclua nem substitua a chave se já houver dados. Essa pasta, os relatórios e as saídas de compilação estão fora do Git.

A sessão local é destinada ao usuário deste Mac e o servidor escuta somente em `127.0.0.1`. Não é uma instalação para acesso compartilhado na rede. Se a porta padrão já estiver ocupada:

```bash
ACS_PORT=8788 bash iniciar-mac.sh
```

## Verificação opcional do agente

O comando `bash testar-agente-mac.sh` continua disponível para o simulador. Ele não inicia o painel. O teste com navegador foi concluído com sucesso no Mac do operador; cada roteiro de equipamento real ainda precisa ser adaptado e validado.

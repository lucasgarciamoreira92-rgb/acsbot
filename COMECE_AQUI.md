# ACS Pilot — GitHub e primeiro teste no Mac

Este pacote contém o código completo do painel, APIs, agente Python, simulador e testes. Versão funcional 0.2.0, baseada no commit `8130552` do projeto, com instruções e script para instalação no Mac.

## 1. Baixar o repositório no Mac

No Terminal:

```bash
cd ~
git clone https://github.com/lucasgarciamoreira92-rgb/acsbot.git
cd acsbot
```

Se você já clonou este repositório, entre na pasta existente e use `git pull --ff-only` para atualizar. Se houver alterações locais ou histórico divergente, revise antes de continuar.

## 2. Instalar e testar o agente

Na mesma pasta:

```bash
bash testar-agente-mac.sh
```

Requer **Python 3.11 ou superior**. O script cria `agent/.venv`, instala as dependências e o Chromium, executa os testes do agente e abre o teste com roteador simulado em `127.0.0.1`. Não precisa instalar Node.js para esse teste.

O teste de navegador ainda precisa passar na sua máquina. A validação de um equipamento real e a comunicação real com o ACS continuam pendentes.

## 3. Usar a plataforma

O painel continua online: https://acs-pilot.lucasgarciamoreira92.chatgpt.site

O agente roda no Mac com acesso à sua rede. O fluxo desta versão usa pacotes criptografados baixados pelo painel e relatórios importados depois. Consulte `agent/README.md` para cadastrar o simulador no painel ou executar um pacote real.

O código do painel está incluído para desenvolvimento. Sua implantação atual usa Cloudflare Workers, D1 e autenticação do Sites; copiar o repositório não transfere o banco ou os segredos de produção nem instala automaticamente um painel completo no Mac.

Para o primeiro equipamento real, informe fabricante, modelo, firmware e sistema ACS utilizado. Os modelos demonstrativos precisam de roteiros adaptados e validados.

## Estrutura

- `app/`, `lib/`, `db/`, `drizzle/`, `worker/`: painel, APIs e persistência.
- `agent/`: agente local, simulador, guia e testes Python.
- `tests/`: testes do servidor e interface.
- `public/downloads/`: ZIP original do agente disponível na plataforma.
- `testar-agente-mac.sh`: instalação e teste local com navegador.

O arquivo `.env.example` contém somente valores de exemplo. A chave de produção e os dados cadastrados não fazem parte deste pacote.

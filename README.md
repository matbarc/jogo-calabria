# Jogo de Investimento ao vivo · IEE Impacto, Aula 5

Funciona como um Kahoot: o professor projeta a tela dele e os alunos entram pelo celular com um código, sem login. Os eventos, os preços e as regras são os mesmos da planilha `Aula5_Jogo_Investimento.xlsx`.

- **Professor:** `https://SEU-ENDERECO/professor`, com senha
- **Alunos:** `https://SEU-ENDERECO`, com o código da sala (ou pelo QR code do telão)

## Como a aula corre

1. **Lobby.** O professor cria o jogo. O telão mostra o endereço, o código e o QR code, e cada time entra com um nome. Ao lado de cada time, o professor digita as **tampinhas do Kahoot** (1 tampinha = R$ 1 no caixa). Dá para corrigir até a Rodada 1 ser revelada.
2. **Notícia.** O telão mostra a notícia da rodada, os preços atuais e um cronômetro (padrão: 60 s). Nos celulares, os times montam a carteira com os botões −100, −10, +10 e +100 (ou digitam o valor) e tocam em **Confirmar carteira**. O telão mostra quem já confirmou. O cronômetro só avisa: quem fecha a rodada é o professor.
3. **Revelação.** O telão mostra Antes / Variação / Agora e o ranking ("quem está na frente"). O "por quê" fica escondido para o professor perguntar à turma antes, como pede o guia. Um clique mostra a explicação, e outro passa para a próxima notícia. No celular, cada time vê quanto cada ativo rendeu, o novo patrimônio e a posição no ranking.
4. **Fim.** Ranking final com patrimônio, quanto cada time começou, rendimento %, **tampinhas para o leilão** (R$ 1 = 0,2 tampinha) e o gráfico rodada a rodada. Uma aba mostra "E se fosse R$ 1.000 num ativo só?" (slide 38).

**Atalhos do professor:** seta → , espaço ou o passador de slides (Page Down) avançam a etapa. **↶ Voltar** desfaz a última passagem de fase, caso alguém tenha clicado cedo demais. Em **⚙ Ajustes** ficam o tempo da rodada, os câmbios das tampinhas (iguais às células O2 e P2 da planilha) e o "recomeçar".

**Se um celular cair:** basta reabrir o link, porque o time volta sozinho com a carteira. Se o aluno trocar de aparelho, é só entrar de novo com o **mesmo nome de time**.

## Publicar de graça no Render (cerca de 10 minutos)

1. Crie um repositório no GitHub e suba esta pasta (sem `node_modules`).
2. Em <https://render.com>, entre com o GitHub e clique em **New → Blueprint**. Escolha o repositório: o Render lê o `render.yaml` sozinho.
3. Quando ele pedir `TEACHER_PASSWORD`, escolha a senha do professor.
4. Ao fim do deploy, o endereço fica parecido com `https://jogo-investimento.onrender.com`.

> **Importante:** no plano gratuito, o servidor "dorme" depois de 15 minutos sem uso, e a primeira visita leva cerca de 1 minuto para acordá-lo. **Abra a tela do professor uns 5 minutos antes da aula.** Durante o jogo não há esse problema, porque os celulares conectados o mantêm acordado.

## Plano B: rodar no notebook

Com Node 18 ou mais novo instalado:

```bash
npm install
TEACHER_PASSWORD=minhasenha npm start
```

Abra `http://localhost:3000/professor`. Para os alunos entrarem, o notebook e os celulares precisam estar **na mesma rede Wi-Fi**. O telão mostra sozinho o endereço do notebook na rede (ex.: `192.168.0.15:3000`) e o QR code correspondente. Sem `TEACHER_PASSWORD`, a senha é `professor`.

## Para mudar o jogo

Os eventos, as variações e as explicações ficam em `game.js` (lista `ROUNDS`). O arredondamento segue a planilha: preços com 2 casas e posições em reais inteiros a cada rodada. `npm test` simula uma partida com 3 times-robô.

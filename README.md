# 🚁 TURBO HELI

Shooter de helicóptero com scroll vertical e visão de cima — inspirado nos
clássicos de fliperama dos anos 80. Voe sobre o território inimigo destruindo
tanques, barcos, prédios, trens e caças, enfrente chefes gigantes e sobreviva
o máximo de fases que conseguir.

**100% HTML5 + Canvas, em um único arquivo, sem dependências e sem assets
externos** — toda a arte e todo o áudio são gerados por código.

---

## ▶️ Como jogar

Abra o arquivo [`index.html`](index.html) em qualquer navegador moderno
(duplo clique já funciona — não precisa de servidor nem build). No menu,
use as **setas** para escolher a dificuldade (**FÁCIL** ou **NORMAL**) e
pressione **ENTER** para começar.

### Controles

| Tecla | Ação |
|---|---|
| ← ↑ → ↓ | Mover o helicóptero (no menu: trocar dificuldade) |
| Espaço | Atirar |
| B | Soltar bomba (limpa a tela / dana o chefe) |
| F | Tela cheia |
| M | Liga/desliga a música |
| Enter | Iniciar / pausar / reiniciar |

**No celular/tablet:** controles touch na tela — analógico virtual à
esquerda para voar, botões **FOGO** e **BOMBA** à direita. Toque na tela
para iniciar/reiniciar.

---

## ✨ Funcionalidades

### Jogabilidade
- Scroll vertical contínuo com cenário gerado proceduralmente.
- 6 tipos de inimigos: **tanque**, **tanque de estrada**, **canhoneira**,
  **bunker**, **caça a jato** (lança míssil vertical) e **trem blindado**.
- Inimigos com mira inteligente: torres/canhões giram apontando para o heli;
  tanques manobram e barcos seguem a curva do rio.
- **Power-ups**: tiro frontal `F`, tiro lateral `S`, bomba `B`, vida `1UP`
  e **TURBO** (cadência, ganho por abates).

### Progressão
- **Dois modos de dificuldade** selecionáveis no menu: **FÁCIL** (inimigos
  com menos vida, mais bombas e vidas) e **NORMAL**.
- **Sistema de fases** com banner, barra de progresso e aviso de **PERIGO**.
- **Dificuldade escalonada**: inimigos mais fortes/rápidos a cada fase
  (começa suave e progride).
- **Chefes variados** que ciclam por fase, com HP crescente e modo furioso
  abaixo de 50% de vida:
  - 🚁 Helicóptero de ataque (estilo Hind)
  - 🛡️ Tanque pesado
  - 🚢 Encouraçado

### Cenários (biomas)
Biomas sorteados de forma aleatória/determinística, com **transição suave**
entre eles:
- 🌲 **Floresta** — árvores em camadas
- 🏜️ **Deserto** — dunas, cactos e rochas
- ❄️ **Gelo** — placas, rachaduras e pinheiros nevados
- 🏙️ **Cidade** — quarteirões, vias e prédios (com **lago** no lugar do rio)
- 🌊 **Oceano** — travessia marítima com inimigos navais

Rios são opcionais e limitados (nascem/terminam arredondados), com água
animada, pontes de estrada e ferrovia, e bancos de areia.

### Áudio (livre de direitos)
- Efeitos sonoros e **trilha chiptune em loop** totalmente sintetizados via
  WebAudio — sem nenhuma gravação, portanto **livres de direitos autorais**.
- Mixagem com compressor e barramentos separados de SFX e música.

### Apresentação
- Identidade visual estilo **cartoon/arcade**: sombras de contato, gradientes,
  brilho aditivo nas explosões, moldura de fliperama com **scanlines + vinheta**.
- Screen shake, tracers com brilho, mísseis com rastro de chama.
- HUD com pontos, recorde (salvo em `localStorage`), vidas, fase e armas.

---

## 🗂️ Estrutura

```
.
├── index.html   # marcação da página
├── styles.css   # estilos (moldura, HUD, controles touch)
├── game.js      # toda a lógica do jogo (script clássico, sem build)
├── README.md    # este arquivo
├── todo.md      # backlog de melhorias
└── design.md    # documento de design / decisões visuais detalhadas
```

Continua sem build e sem servidor: o `game.js` é um script clássico, então
o duplo clique no `index.html` (via `file://`) segue funcionando.

Para detalhes aprofundados de arte e decisões de design, veja
[`design.md`](design.md).

---

## 🛠️ Tecnologia

- **HTML5 Canvas 2D** para renderização.
- **WebAudio API** para áudio sintetizado em tempo real.
- Geração procedural determinística (hash) para cenário estável e reproduzível.
- Resolução interna fixa (480×640) escalada por CSS, mantendo nitidez
  (`image-rendering: pixelated`).
- Sem build, sem dependências, sem servidor — basta abrir no navegador.

---

## 🎮 Dicas

- Pegue power-ups de tiro para aumentar o poder de fogo; ao ser atingido você
  perde um nível, então proteja seus upgrades.
- Guarde bombas para os chefes — elas não os matam, mas tiram bastante vida.
- Aprenda os padrões de ataque de cada chefe; o modo furioso (vida baixa) é
  o momento mais perigoso.

---

## 📄 Licença

Projeto pessoal/educacional. Código, arte e áudio são autorais e gerados por
código (sem assets de terceiros).

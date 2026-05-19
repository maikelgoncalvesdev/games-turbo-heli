# TURBO HELI — Documento de Design

Shooter de helicóptero com scroll vertical (visão de cima), feito em HTML5 + Canvas
2D, **arquivo único** (`index.html`), **sem dependências, sem assets externos** —
todo o áudio e a arte são gerados por código.

> Este documento registra a identidade visual e todos os aspectos de design/jogo
> que foram evoluídos ao longo do desenvolvimento.

---

## 1. Identidade visual ("cartoon militar")

A direção de arte busca um look **cartoon/arcade** limpo, legível e com volume:

- **Sombras de contato** sob praticamente todos os objetos (inimigos, árvores,
  chefe, helicóptero). É o elemento que mais dá a sensação "cartoon": cada
  elemento "descola" do chão com uma elipse escura translúcida e levemente
  deslocada.
- **Gradientes suaves** em cascos, fuselagens, água e solo (nada de cor chapada).
- **Silhuetas reconhecíveis**: cada inimigo é identificável de imediato pela
  forma (tanque, barco, bunker, jato, trem, chefes).
- **Paleta coesa**: verdes militares no solo, azul do rio com profundidade,
  metais frios nos veículos, acentos quentes (laranja/amarelo) em fogo e tiros,
  ciano/dourado na interface.
- **Brilho aditivo** (`globalCompositeOperation = 'lighter'`) em explosões,
  rastros, rotor e flashes — base para o **bloom WebGL** (ver §12).
- **Moldura arcade**: gabinete com bordas em gradiente, cantos arredondados,
  e **acabamento por shader WebGL** (tela plana com vinheta leve) — ver §12.

---

## 2. Cenário / terreno

| Elemento | Descrição |
|---|---|
| **Solo** | Gradiente vertical + textura de campo em tons variados, com tufos de grama determinísticos. |
| **Rio** | Curva serpenteante (senoidal), **gradiente de profundidade**, ondas/reflexos animados, faíscas de sol e **espuma animada nas margens**. |
| **Bancos de areia** | Faixa de areia contornando o rio. |
| **Florestas** | Árvores em camadas (copa sombreada + brilho + sombra projetada), distribuídas por hash determinístico. |
| **Estrada** | Asfalto com faixa central tracejada; **ponte de tábuas** ao cruzar o rio. |
| **Ferrovia** | Leito de brita, dormentes e dois trilhos de aço; **ponte de treliça** ao cruzar o rio. |

**Estabilidade do scroll (bug corrigido):** todo o cenário usa **mapeamento de
linha de mundo fixa** (`Wc * tamanho + scrollY`) em vez de `scrollY % tamanho`.
Isso eliminou o "teleporte"/reembaralhamento que acontecia a cada volta do tile.

**Regras de coerência do cenário:**
- Prédios/tanques **não nascem no rio** (nem encostando).
- Tanques e prédios **desviam do rio** se a curva os alcançar.
- **Estrada e trilho nunca se sobrepõem** (afastamento mínimo determinístico),
  mas podem ficar próximos.
- **Barcos passam POR BAIXO das pontes** (ordem de render: terreno → barcos →
  pontes → resto), enquanto tiros/tanques/heli passam por cima.

---

## 3. Helicóptero do jogador

- Fuselagem oval com nariz/cockpit envidraçado, lança de cauda afilada,
  estabilizador, **rotor de cauda** e patins de pouso.
- **Rotor principal** como disco translúcido com 2 pás girando.
- **Sopro do rotor** (rotor wash) aditivo no solo.
- **Flash de disparo** nas pontas ao atirar.
- Sombra projetada e piscar de invencibilidade após tomar dano.

---

## 4. Inimigos (todos redesenhados)

| Inimigo | Destaques visuais | Comportamento |
|---|---|---|
| **Tanque** | Esteiras com elos animados, casco com gradiente, **torre giratória independente** mirando o heli, faixa frontal. | Manobra: vira até ±45° e recua de leve para mirar; casco gira no sentido da esteira. |
| **Tanque de estrada** | Mesmo tanque, virado 90°. | Trafega lateralmente preso à faixa da estrada. |
| **Canhoneira (barco)** | Casco com proa em bico, ponte de comando, mastro, esteira de espuma, **torre de canhão** independente. | Navega no rio, **gira acompanhando a curva** do leito. |
| **Bunker/fortim** | Concreto com gradiente, telhado recuado, sacos de areia, cúpula com canhão, luz de alerta piscando. | Estrutura fixa; cúpula mira o heli. |
| **Caça a jato** | Fuselagem em gradiente, asas em delta, estabilizadores, canopy, **chama de pós-combustor**. | Cruza rápido; dispara **1 míssil vertical** num momento aleatório. |
| **Trem blindado** | Locomotiva (chaminé com fumaça) + vagões com janelas e rodas, **2 canhões giratórios**. | Percorre o trilho lateralmente; resistente. |

**Mísseis** têm arte própria: corpo metálico, **ogiva vermelha**, aletas e
rastro de chama (não são bolinhas brancas).

---

## 5. Chefes variados

Ciclam por fase, HP cresce **+45 por fase**, todos com **modo furioso** abaixo de
50% de vida e barra de vida no topo.

1. **Helicóptero de ataque** (estilo Hind/Rambo II): fuselagem gunship, canopies
   em tandem, asas com pods de foguete e mísseis, rotor de 5 pás, lança/rotor de
   cauda, **canhão de queixo** independente, turbinas brilhando, banca no strafe.
2. **Tanque pesado**: esteiras gigantes animadas, blindagem, listras de perigo,
   motor traseiro brilhando, **canhão duplo** giratório + leque de metralhadora.
3. **Encouraçado**: casco naval, superestrutura, chaminés com fumaça,
   **3 torres** giratórias + bordadas.

A **bomba não mata o chefe**, mas tira 25% da vida máxima dele.

---

## 6. Efeitos e feedback

- **Screen shake** proporcional ao evento (bomba/morte do chefe > morte > dano).
- **Explosões** em blending aditivo com partículas que pulsam e somem.
- **Tiros do jogador**: tracers com brilho (ciano quando lateral).
- **Tiros inimigos**: núcleo quente com halo (cores de projétil/míssil).
- **Power-ups**: anéis luminosos pulsantes com glow.

---

## 7. Áudio (100% sintetizado — livre de direitos)

- Mixagem real: barramentos separados de **SFX** e **música** + **compressor** +
  master (não estoura).
- Efeitos encorpados: tiro (laser curto), explosão (ruído filtrado + sub-grave +
  estrondo), **bomba** dedicada, power-up/1UP (arpejos), aviso de chefe, morte.
- **Trilha chiptune em loop** estilo arcade dos anos 80 (Lá menor, ~138 BPM):
  baixo pulsante, bumbo, hi-hat, melodia em ondas e acordes de apoio. Entra com
  fade-in suave. Tecla **M** liga/desliga.

---

## 8. Progressão

- **Fases**: cada fase dura ~2600 frames; barra de progresso no HUD; ao fim,
  banner **"PERIGO"** (vermelho piscando com glow) → chefe → banner **"FASE N"**.
- **Dificuldade escalonada** por fase: inimigos ganham +vida, +velocidade e
  tiros mais rápidos; spawn mais frequente (prédios não escalam vida).
- **Chefes variados** por fase (ciclo de 3, HP crescente).
- **Upgrades**: tiro frontal `F` (até **4**; níveis 1→3 escalam o leque,
  **nível 4 acumula mísseis frontais** com dano maior e explosão),
  lateral `S` (até **3**), bombas `B` (máx. **3** normal / **5** fácil),
  vida `1UP` (máx. **5** normal / **10** fácil), e **TURBO** (cadência, a
  cada 40 abates, até nível 2).
  Ao ser **atingido**, perde um nível na ordem `F → S → TURBO`.
- **Drop inteligente**: um power-up **não cai** se o jogador já está no
  limite daquele atributo (não desperdiça `B/F/S/1UP`).

---

## 9. Interface (HUD)

- Painéis de vidro com glow: **Pontos / Recorde / Vidas** (recorde salvo em
  `localStorage`).
- Rodapé: **BOMBAS**, **TIRO**, **LAT**, **TURBO**, **FASE N** + barra de
  progresso da fase.
- Telas de título e Game Over estilizadas (logo com glow/relevo, subtítulo,
  "pressione ENTER" piscando, fase alcançada no Game Over).

---

## 10. Controles

| Tecla | Ação |
|---|---|
| ← ↑ → ↓ | Mover |
| Espaço | Atirar |
| B | Bomba |
| F | Tela cheia |
| M | Liga/desliga música |
| Enter | Iniciar / reiniciar |

---

## 11. Decisões técnicas

- **Arquivo único** sem build, sem assets — abre direto no navegador.
- Render por camadas com ordem explícita para resolver z-index
  (barcos sob pontes).
- Geração procedural determinística (`hash`, `lineList`) para cenário estável.
- Áudio via **WebAudio** sintetizado → zero questão de direitos autorais.
- `try/catch` no game loop para um erro nunca congelar o jogo todo.
- Resolução interna fixa (480×640); o canvas 2D é renderizado offscreen
  e apresentado via WebGL (ver §12).

---

## 12. Pipeline WebGL (iluminação diferida + pós-processamento)

Sem libs (WebGL puro, mantém "arquivo único"). Tudo continua **gerado por
código, sem assets**.

**Bake de sprites:** heli, tanque (casco+torre) e árvore são desenhados
**1× em alta resolução** num canvas offscreen, gerando **albedo** + **normal
map**. O normal é derivado de um *heightmap* (relevo em cinza) via **Sobel** —
basta pintar volumes claros/escuros e a luz por pixel sai sozinha.

**G-buffer 2D:** a cada frame o jogo desenha o **albedo** no `#cv` e as
**normais** num segundo canvas `cvN` (padrão "plano" = `#8080ff`; só as
entidades HD escrevem relevo).

**Passes WebGL** (saída no `#gl`):

1. **Iluminação**: sol direcional + especular + **luzes dinâmicas**
   (flash do tiro, explosões) usando as normais → cena iluminada.
2. **Bright-pass** (por saturação) + **blur gaussiano separável** → bloom.
3. **Composição final**: cena iluminada + bloom + vinheta leve (tela plana).

Sem WebGL disponível, faz **fallback** automático para o canvas 2D (zero
quebra). A lógica de jogo não foi tocada.

> **Status:** em propagação — já usam o pipeline HD+luz: heli, tanque,
> floresta, **trem de guerra blindado**, **caça stealth (F-22)**,
> **bunker/fortim** e toda a **frota naval** (canhoneira, lancha,
> contratorpedeiro, porta-aviões + torre naval reutilizável). Faltam:
> chefes e o solo dos biomas (deserto/gelo/cidade/oceano).
>
> O **caça** dispara o míssil quando fica **alinhado/de frente para o
> heli** (antes era em momento aleatório).

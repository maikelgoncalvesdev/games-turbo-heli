# TODO — Turbo Heli

## Concluído
- [x] **Timestep fixo** no game loop (lógica a 60 Hz, independente do refresh)
- [x] **Controles touch** para mobile (analógico virtual + botões FOGO/BOMBA,
  aparecem só no toque real, somem ao usar teclado)
- [x] **Separar HTML/CSS/JS** em arquivos distintos (script clássico, sem build)
- [x] **Som dos tiros reforçado** — `SFX.shoot()` grave e encorpado
  (estalo+corpo+soco+snap); barramento SFX 0.9 → 1.1.
- [x] **Bomba sendo lançada** — sprite de bomba caindo do heli (giro +
  rastro + assobio), detona ao fim do pavio com onda de choque dupla
  (`bombFx[]`/`detonateBomb()`).

## Backlog (prioridade menor)
- [ ] Suporte a **gamepad** (API Gamepad) e remapeamento de teclas.
- [ ] **Modularização** do `game.js` (~3,9k linhas) em módulos ES,
  mantendo "abrir e jogar" sem build.
- [ ] Mais **variedade de chefes** (hoje só 3 ciclam: heli, tank, ship).
- [ ] **Conquistas / desafios diários** para rejogabilidade.
- [ ] **Placar persistente** com iniciais do jogador / múltiplos recordes.
- [ ] **Power-up de escudo** temporário.
- [ ] **Feedback visual** ao perder nível de arma por dano (mecânica punitiva
  sem aviso claro).

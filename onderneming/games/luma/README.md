# LUMA: een komeet die zingt

Een eigen one-tap game voor telefoon en computer. Je bent een komeet in een baan rond een ster. **Tik** (of spatie)
en je schiet weg langs de raaklijn. Vlieg je de ring van een andere ster in, dan vangt die je. Scheer je rakelings
langs de kern, dan is het **PERFECT** en loopt je combo op. Elke vangst speelt een noot in de toonsoort van de zone:
al spelend maak je de muziek.

- **Druk:** blijf je te lang in een baan, dan wordt hij heet en brand je op.
- **Gevaren:** recht op een ster af vliegen, de leegte in, en zwarte gaten die je vlucht krombuigen.
- **Zones:** elke 12 sterren een nieuwe zone (Aurora, Ember Reach, Glass Sea, Violet Deep, Solar Choir, The Hush),
  met eigen kleuren, toonsoort en tempo.
- **Scherven** onderweg zijn de munt voor nieuwe kometen (Dandelion, Prism, Ember, Eclipse).
- **Dagrun:** elke dag hetzelfde sterrenbeeld voor iedereen.

## Werken aan LUMA
```bash
cd onderneming/games/luma
npm ci
npm run typecheck && npm test && npm run build    # alle drie groen
npm run speeltest                                 # autopiloot speelt in Chromium, screenshots in dist/shots
```
De build is één bestand: `dist/luma.html`. Alles zit erin (code, shaders, geluid). Alleen de lettertypen komen van
Google Fonts; zonder internet valt hij terug op systeemletters.

Handig bij het testen: `dist/luma.html?autoplay&seed=iets&debug`. De autopiloot speelt dan zelf, met een vast
sterrenbeeld, en `__luma` staat in de console.

## Opbouw
| Map | Wat |
|---|---|
| `src/sim/` | De simulatie: puur en deterministisch (vaste stap van 1/120 s). Sterren, banen, vangen, hitte, zwarte gaten, scherven, score. Ook de autopiloot. Volledig getest |
| `src/render/` | three.js: nevel-shader, sterren, ringen, staart, deeltjes, bloom en nabewerking |
| `src/audio/` | Web Audio zonder geluidsbestanden: generatieve muziek per zone en de geluiden bij elke gebeurtenis |
| `src/ui/` | HTML-laag: titel, HUD, zone-titels, pauze, game over, collectie en instellingen |
| `src/platform/` | Meldt "aan het spelen" aan de CrazyGames-SDK als die op de pagina staat. Laadt zelf niets |
| `src/save.ts` | Record, scherven, skins en instellingen in `localStorage`, bestand tegen kapotte data |
| `src/contracts.ts` | De afspraken tussen de onderdelen |

## Naar CrazyGames (doe jij)
Publiceren en het account maken doe jij zelf. Wat al klaar is volgens `company/skills/productkwaliteit.md`:
- meteen spelen, uitleg in beeld bij de eerste run, besturing met tikken, muis, spatie, pijltje omhoog en W;
- geen Escape en geen Ctrl/Cmd+W; pauze met P of de knop;
- `user-select: none`, werkt op telefoon en computer, staand en liggend;
- één bestand van ruim 1 MB, alleen relatieve paden;
- eigen naam en stijl, geluid in balans en uit te zetten;
- `gameplayStart`/`gameplayStop`/`happytime` zodra hun SDK op de pagina staat.

Nog te doen voor je uploadt:
- [ ] In Safari op een iPhone spelen (geluid start pas na de eerste tik; dat hoort zo).
- [ ] De SDK-regel van CrazyGames in `src/index.html` zetten (staat in hun documentatie) en opnieuw bouwen.
- [ ] Lettertypen in het bestand zetten als ze offline moeten werken.
- [ ] Cover-afbeeldingen maken uit de screenshots in `dist/shots/`.

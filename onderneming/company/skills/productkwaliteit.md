---
name: productkwaliteit
description: Wanneer is een game, site, blog of tool goed genoeg om Kalle te vragen hem te publiceren? Het contract vooraf (acceptatiecriteria), de keuring achteraf en de regels van de platforms (CrazyGames, Google, AI Act) per soort product. Lees dit voor je een experiment plant, bouwt, keurt of verpakt.
tagline: Pas publiceren als het aantoonbaar werkt
---

# Productkwaliteit

Een experiment meet alleen iets als het product echt werkt. Kalle publiceert onder zijn eigen naam en account: wat
naar hem gaat, is af, getest en binnen de regels van het platform. Een AI die zijn eigen werk keurt, keurt te
makkelijk goed. Daarom spreken lead en maker vooraf af wat "klaar" is, en keurt iemand anders het achteraf.

## 1. Het contract (lead, vóór het bouwen)
- **3–10 acceptatiecriteria**, elk te controleren in een browser en in de woorden van een gebruiker:
  "de speler ziet binnen 5 seconden het eerste level", niet "de code is netjes". Waar het kan, beslist een
  script: een Playwright-test die slaagt of faalt, geen "ziet er goed uit".
- Plus de **platformlijst** hieronder die bij het product hoort.
- Wat er **niet** bij hoort, staat er ook in. Zo blijft het experiment klein.
- De bouwer zet de criteria in `features.json`. Criteria veranderen gaat alleen via de lead.

## 2. De keuring (criticus, vóór publicatie)
- Start het product zoals de bouwer beschreef (`./init.sh`) en loop elk criterium door met Playwright, zoals een
  gebruiker het zou doen. Maak screenshots op telefoonformaat (390×844) en laptopformaat (1366×768).
- Schrijf per criterium **gehaald** of **niet gehaald** op, met bewijs: een screenshot, of de stap die misging.
- Keur af, tenzij je het zelf zag werken. Repareer niets; schrijf op hoe je de fout kunt nadoen.
- Sluit af met één regel: **goedgekeurd**, of **terug naar de bouwer** met de lijst.
- Zuinig: één Playwright-script dat alle criteria afloopt, niet elke klik als losse stap.
- **Hooguit twee keer terug.** Na de tweede afkeuring komt er geen derde ronde: de lead maakt het product kleiner of
  stopt het, en legt dat aan Kalle voor. Anders blijven bouwer en keurder elkaar tokens kosten.

## 3. Games (CrazyGames, Poki)
Bronnen: [kwaliteit](https://docs.crazygames.com/requirements/quality/),
[techniek](https://docs.crazygames.com/requirements/technical/), [gameplay](https://docs.crazygames.com/requirements/gameplay/).
- **Meteen spelen.** De uitleg zit in het spel zelf, met beelden en weinig tekst, en is over te slaan. Knoppen zijn
  duidelijk en je hoeft niet te wachten.
- **Duidelijk doel en snel te leren.** De besturing is consequent en reageert meteen.
- **Besturing.** De besturing staat in beeld. Gebruik geen Escape (sluit volledig scherm) en geen Ctrl/Cmd+W (sluit
  het tabblad). Toetsen werken ook op AZERTY: WASD altijd samen met de pijltjes.
- **Telefoon én computer.** Muis, toetsenbord en aanraken. Op telefoon staat `user-select: none` aan.
- **Grootte.** De eerste download is hooguit 50 MB, voor de mobiele homepage hooguit 20 MB. In totaal hooguit
  250 MB en 1500 bestanden, met alleen relatieve paden.
- **Browsers.** Werkt in Chrome en Edge. Safari: controleren.
- **Eigen gezicht.** Een naam en beelden die je niet verwart met een bestaand spel. Eén stijl, zonder rommel in
  het beeld. Het geluid is in balans en je kunt het uitzetten.
- **Inhoud.** Past binnen PEGI 12 en is niet gericht op kinderen.

## 4. Blogs en content
Bronnen: [Google over spam](https://developers.google.com/search/docs/essentials/spam-policies),
[Google over AI-content](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content),
[AI Act artikel 50](https://artificialintelligenceact.eu/article/50/).
- **Schrijf voor een echte lezer met een echte vraag.** Liever 3 sterke artikelen dan 30 dunne. Veel pagina's maken
  om hoog in Google te komen heet bij Google *scaled content abuse*, ook als AI ze schreef, en dat wordt afgestraft.
- **Eigen ervaring en bewijs** (Google noemt dat E-E-A-T): zelf getest, eigen screenshots, eigen cijfers en de
  bronnen erbij. AI mag helpen, zolang het artikel de lezer echt verder helpt.
- **AI-label.** Sinds 2 augustus 2026 geldt de AI Act. Een AI-tekst die het publiek informeert over zaken van
  algemeen belang krijgt een AI-label, tenzij een mens hem nakijkt en er de verantwoordelijkheid voor neemt. Onze
  regel: Kalle leest elk artikel voor publicatie, of het krijgt een label.
- **Techniek:** één duidelijke zoekvraag per pagina, een titel van ±50–60 tekens, een meta-beschrijving van ±120–160
  tekens en één H1. `sitemap.xml` en `robots.txt` kloppen. Snel op telefoon (Core Web Vitals: LCP < 2,5 s,
  INP < 200 ms, CLS < 0,1), en `Article`-gestructureerde data.
- **Affiliate-links** zijn altijd herkenbaar. Zeg bovenaan het artikel dat ze erin staan.
- **Nooit** nepreviews, verzonnen ervaringen of testimonials.

## 5. Sites en tools (SaaS, landingspagina's)
- **Eén belofte en één knop.** De knop meet echte interesse: een aanmelding of een plek op de wachtlijst. Bestaat
  het product nog niet, zeg dat dan eerlijk ("binnenkort, schrijf je in").
- **Snel op telefoon.** Geen trackers en geen cookies zonder toestemming. Vraag je e-mailadressen, dan hoort er een
  privacyverklaring bij (via Kalle).
- **Weinig gegevens.** Vraag niet meer persoonsgegevens dan het meetpunt nodig heeft.

## 6. Voor elk product
- **TypeScript met `strict` aan, en `tsc --noEmit` groen.** Bijna alle compileerfouten in AI-code (94% in een
  studie op PLDI 2025) zijn typefouten, en deze controle is gratis en duurt seconden.
- **Geen sleutels** in de code of in de gebouwde bestanden.
- **Niets van anderen**: geen beschermde namen, logo's of assets. Maak het zelf of gebruik CC0.

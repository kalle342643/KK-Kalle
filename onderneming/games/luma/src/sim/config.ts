// Alle afstemming van het spel op één plek. Eenheden: wereldeenheden en seconden.

export const SIM = {
  /** Vaste stap van de simulatie. */
  dt: 1 / 120,

  /** Snelheid van de komeet: begin, groei per gevangen ster, maximum. */
  speedStart: 7,
  speedPerCapture: 0.09,
  speedMax: 13,

  /** Breedte van het speelveld: verder dan dit naar opzij is de leegte in. */
  fieldHalfWidth: 15,
  /** Sterren worden geplaatst binnen deze breedte. */
  laneHalfWidth: 8,

  /** Afstand die je hooguit vliegt zonder gevangen te worden. */
  maxFlightDistance: 26,

  /** Hoe ver vooruit de wereld klaarligt, en wat achter je wordt opgeruimd. */
  generateAhead: 70,
  pruneBehind: 45,

  /** Kortste baan: zoveel keer de kern, plus een marge. */
  minOrbitFactor: 1.4,
  minOrbitMargin: 0.15,
  /** Binnen deze afstand boven de kortste baan telt de vangst als PERFECT. */
  perfectWindow: 0.6,

  /** Na het vangen zakt de baan in zoveel seconden naar zijn straal. */
  settleTime: 0.35,
  /** Pas na zoveel seconden in een baan mag je loslaten (tegen dubbeltikken). */
  minOrbitTime: 0.08,

  /** Hoe lang je in een baan kunt blijven voor hij opbrandt: begin en minimum. */
  heatLifeStart: 5.2,
  heatLifeMin: 2.8,
  heatLifePerCapture: 0.045,
  giantHeatBonus: 1.8,

  /** Zwarte gaten: zwaartekracht tijdens de vlucht. */
  gravity: 34,
  /** Een near miss: binnen deze marge langs de horizon. */
  nearMissMargin: 0.7,

  /** Vangstraal van een scherf. */
  shardRadius: 0.75,
} as const;

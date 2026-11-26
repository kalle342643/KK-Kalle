// Aansluiting op een gameplatform. Laadt zelf niets: staat de SDK van CrazyGames op de pagina
// (dat regelt Kalle zelf bij het uploaden), dan meldt het spel daar wanneer er gespeeld wordt.

interface CrazyGamesSdk {
  game?: {
    gameplayStart?: () => void;
    gameplayStop?: () => void;
    happytime?: () => void;
    loadingStart?: () => void;
    loadingStop?: () => void;
  };
  init?: () => Promise<void>;
}

interface PlatformWindow {
  CrazyGames?: { SDK?: CrazyGamesSdk };
}

export interface Platform {
  ready(): Promise<void>;
  gameplayStart(): void;
  gameplayStop(): void;
  /** Een feestmoment, zoals een nieuw record. */
  happy(): void;
}

function safe(fn: (() => void) | undefined): void {
  try {
    fn?.();
  } catch {
    // Een platformfout mag het spel nooit stoppen.
  }
}

export function createPlatform(): Platform {
  const sdk = (globalThis as PlatformWindow).CrazyGames?.SDK;
  let playing = false;
  return {
    async ready() {
      if (!sdk?.init) return;
      try {
        await sdk.init();
        safe(sdk.game?.loadingStop?.bind(sdk.game));
      } catch {
        // Zonder SDK draait het spel gewoon.
      }
    },
    gameplayStart() {
      if (playing) return;
      playing = true;
      safe(sdk?.game?.gameplayStart?.bind(sdk.game));
    },
    gameplayStop() {
      if (!playing) return;
      playing = false;
      safe(sdk?.game?.gameplayStop?.bind(sdk.game));
    },
    happy() {
      safe(sdk?.game?.happytime?.bind(sdk.game));
    },
  };
}

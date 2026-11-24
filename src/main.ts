/// <reference types="vite/client" />
import './styles/main.css';
import { GameEngine } from './game/gameLoop';
import type { GameCallbacks } from './game/contracts';
import type { ScreenState } from './types';
import { HudView } from './ui/hud';
import { ScreenManager } from './ui/screens';

function parseQuerySeed(): number | undefined {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('seed');
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isHudVisibleScreen(screen: ScreenState): boolean {
  return screen === 'playing' || screen === 'levelup' || screen === 'paused';
}

function registerOfflineServiceWorker(onReady: () => void): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return;
  }

  if (navigator.serviceWorker.controller) {
    onReady();
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    onReady();
  });

  const doRegister = (): void => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((registration) => {
        if (registration.active || navigator.serviceWorker.controller) {
          onReady();
        }
        const trackInstalling = (worker: ServiceWorker | null): void => {
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated') {
              onReady();
            }
          });
        };
        trackInstalling(registration.installing);
        registration.addEventListener('updatefound', () => {
          trackInstalling(registration.installing);
        });
      })
      .catch(() => {
        // Service worker registration failed or unsupported in current context.
      });
  };

  if (document.readyState === 'complete') {
    doRegister();
  } else {
    window.addEventListener('load', doRegister, { once: true });
  }
}

function bootstrap(): void {
  const canvas = document.getElementById('game-canvas');
  const hudLayer = document.getElementById('hud-layer');
  const overlayLayer = document.getElementById('overlay-layer');

  if (
    !(canvas instanceof HTMLCanvasElement) ||
    !(hudLayer instanceof HTMLElement) ||
    !(overlayLayer instanceof HTMLElement)
  ) {
    throw new Error('Escapement root DOM elements are missing.');
  }

  const fixedSeed = parseQuerySeed();
  let hudView: HudView | null = null;
  let screenManager: ScreenManager | null = null;

  const callbacks: GameCallbacks = {
    onScreenChange(screen) {
      hudView?.setVisible(isHudVisibleScreen(screen));
      screenManager?.setScreen(screen);
    },
    onHudUpdate(snapshot) {
      hudView?.update(snapshot);
    },
    onDraftReady(choices, title, subtitle, canReroll, rerollsLeft) {
      screenManager?.setDraft(choices, title, subtitle, canReroll, rerollsLeft);
    },
    onRunOver(summary) {
      screenManager?.setRunSummary(summary);
    },
    onSaveChanged(save) {
      screenManager?.setSave(save);
    },
  };

  const engine = new GameEngine(canvas, callbacks);

  hudView = new HudView(hudLayer, () => {
    if (engine.getScreen() === 'playing') {
      engine.pause();
    }
  });

  screenManager = new ScreenManager(overlayLayer, engine.getSave(), {
    onPlay() {
      engine.startRun(fixedSeed);
    },
    onResume() {
      engine.resume();
    },
    onQuitToTitle() {
      engine.quitToTitle();
    },
    onSelectDraft(index) {
      engine.selectDraftChoice(index);
    },
    onRerollDraft() {
      engine.rerollDraft();
    },
    onBuyMeta(id) {
      engine.buyMetaUpgrade(id);
    },
    onUpdateSettings(partial) {
      engine.updateSettings(partial);
    },
    onResetProgress() {
      engine.resetProgress();
    },
  });

  const initialScreen = engine.getScreen();
  hudView.setVisible(isHudVisibleScreen(initialScreen));
  screenManager.setScreen(initialScreen);

  registerOfflineServiceWorker(() => {
    screenManager?.setOfflineReady(true);
  });
}

bootstrap();

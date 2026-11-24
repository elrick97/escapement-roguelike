import { META_UPGRADES, getMetaUpgradeCost } from '../data/meta';
import { EVOLUTION_IDS, UPGRADES } from '../data/upgrades';
import type {
  DraftChoice,
  MetaUpgradeId,
  RunSummary,
  SaveData,
  ScreenState,
  SettingsData,
} from '../types';

export interface ScreenCallbacks {
  onPlay: () => void;
  onResume: () => void;
  onQuitToTitle: () => void;
  onSelectDraft: (index: number) => void;
  onRerollDraft: () => void;
  onBuyMeta: (id: MetaUpgradeId) => void;
  onUpdateSettings: (partial: Partial<SettingsData>) => void;
  onResetProgress: () => void;
  onUiClick?: () => void;
}

interface DraftState {
  choices: DraftChoice[];
  title: string;
  subtitle: string;
  canReroll: boolean;
  rerollsLeft: number;
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const mins = Math.floor(total / 60);
  const rem = total % 60;
  return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
}

const EMBLEM_SVG = `
<svg class="title-emblem" viewBox="0 0 120 120" aria-hidden="true">
  <defs>
    <radialGradient id="rubyGrad" cx="38%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#ff8fb1" />
      <stop offset="45%" stop-color="#ff2e63" />
      <stop offset="100%" stop-color="#8c092d" />
    </radialGradient>
    <linearGradient id="brassGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffe58f" />
      <stop offset="55%" stop-color="#f5c542" />
      <stop offset="100%" stop-color="#a87512" />
    </linearGradient>
  </defs>
  <circle cx="60" cy="60" r="54" fill="#0b1020" stroke="rgba(245,197,66,0.35)" stroke-width="1.5" />
  <g stroke="url(#brassGrad)" stroke-width="6" stroke-linecap="round">
    <line x1="60" y1="9" x2="60" y2="17" />
    <line x1="60" y1="103" x2="60" y2="111" />
    <line x1="9" y1="60" x2="17" y2="60" />
    <line x1="103" y1="60" x2="111" y2="60" />
    <line x1="24" y1="24" x2="30" y2="30" />
    <line x1="90" y1="90" x2="96" y2="96" />
    <line x1="96" y1="24" x2="90" y2="30" />
    <line x1="30" y1="90" x2="24" y2="96" />
  </g>
  <circle cx="60" cy="60" r="39" fill="none" stroke="url(#brassGrad)" stroke-width="8" />
  <circle cx="60" cy="60" r="27" fill="none" stroke="#4cc9f0" stroke-width="5.5" />
  <g stroke="url(#brassGrad)" stroke-width="4.5" stroke-linecap="round">
    <line x1="41" y1="41" x2="79" y2="79" />
    <line x1="79" y1="41" x2="41" y2="79" />
  </g>
  <circle cx="60" cy="60" r="15" fill="#131c33" stroke="url(#brassGrad)" stroke-width="3.5" />
  <circle cx="60" cy="60" r="11.5" fill="url(#rubyGrad)" />
  <circle cx="56" cy="56" r="2.6" fill="rgba(255,255,255,0.8)" />
</svg>
`;

/**
 * Manages all non-HUD overlay screens: Title, Draft, Pause, Workshop, Codex, and Game Over.
 */
export class ScreenManager {
  private readonly container: HTMLElement;
  private readonly callbacks: ScreenCallbacks;

  private screen: ScreenState = 'title';
  private returnScreen: 'title' | 'gameover' = 'title';
  private save: SaveData;
  private draft: DraftState | null = null;
  private summary: RunSummary | null = null;
  private offlineReady = false;
  private resetArmed = false;
  private resetTimer: number | null = null;

  constructor(container: HTMLElement, initialSave: SaveData, callbacks: ScreenCallbacks) {
    this.container = container;
    this.save = initialSave;
    this.callbacks = callbacks;

    this.container.addEventListener('click', this.handleClick);
    this.render();
  }

  public setScreen(screen: ScreenState): void {
    this.screen = screen;
    if (screen === 'title' || screen === 'gameover') {
      this.returnScreen = screen;
    }
    this.disarmReset();
    this.render();
  }

  public setSave(save: SaveData): void {
    this.save = save;
    if (
      this.screen === 'title' ||
      this.screen === 'paused' ||
      this.screen === 'workshop' ||
      this.screen === 'codex'
    ) {
      this.render();
    }
  }

  public setDraft(
    choices: DraftChoice[],
    title: string,
    subtitle: string,
    canReroll: boolean,
    rerollsLeft: number
  ): void {
    this.draft = { choices, title, subtitle, canReroll, rerollsLeft };
    if (this.screen === 'levelup') {
      this.render();
    }
  }

  public setRunSummary(summary: RunSummary): void {
    this.summary = summary;
    if (this.screen === 'gameover') {
      this.render();
    }
  }

  public setOfflineReady(ready: boolean): void {
    if (this.offlineReady === ready) return;
    this.offlineReady = ready;
    if (this.screen === 'title') {
      this.render();
    }
  }

  private disarmReset(): void {
    this.resetArmed = false;
    if (this.resetTimer !== null) {
      window.clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }

  private readonly handleClick = (e: MouseEvent): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const btn = target.closest('button');
    if (!btn || btn.disabled) return;

    const choiceAttr = btn.getAttribute('data-choice');
    if (choiceAttr !== null) {
      const idx = Number.parseInt(choiceAttr, 10);
      if (Number.isFinite(idx)) {
        this.callbacks.onUiClick?.();
        this.callbacks.onSelectDraft(idx);
      }
      return;
    }

    const buyId = btn.getAttribute('data-buy') as MetaUpgradeId | null;
    if (buyId) {
      this.callbacks.onUiClick?.();
      this.callbacks.onBuyMeta(buyId);
      return;
    }

    const settingKey = btn.getAttribute('data-setting') as keyof SettingsData | null;
    if (settingKey) {
      this.callbacks.onUiClick?.();
      const current = this.save.settings[settingKey];
      this.callbacks.onUpdateSettings({ [settingKey]: !current });
      return;
    }

    const action = btn.getAttribute('data-action');
    if (!action) return;

    this.callbacks.onUiClick?.();

    switch (action) {
      case 'play':
        this.callbacks.onPlay();
        break;
      case 'resume':
        this.callbacks.onResume();
        break;
      case 'quit':
        this.callbacks.onQuitToTitle();
        break;
      case 'reroll':
        this.callbacks.onRerollDraft();
        break;
      case 'workshop':
        if (this.screen === 'title' || this.screen === 'gameover') {
          this.returnScreen = this.screen;
        }
        this.screen = 'workshop';
        this.disarmReset();
        this.render();
        break;
      case 'codex':
        if (this.screen === 'title' || this.screen === 'gameover') {
          this.returnScreen = this.screen;
        }
        this.screen = 'codex';
        this.disarmReset();
        this.render();
        break;
      case 'back':
        this.screen = this.returnScreen;
        this.disarmReset();
        this.render();
        break;
      case 'title':
        this.returnScreen = 'title';
        this.screen = 'title';
        this.disarmReset();
        this.render();
        break;
      case 'reset-save':
        if (!this.resetArmed) {
          this.resetArmed = true;
          this.render();
          this.resetTimer = window.setTimeout(() => {
            this.resetArmed = false;
            this.resetTimer = null;
            if (this.screen === 'workshop') {
              this.render();
            }
          }, 4000);
        } else {
          this.disarmReset();
          this.callbacks.onResetProgress();
        }
        break;
      default:
        break;
    }
  };

  private renderSettingsGrid(): string {
    const s = this.save.settings;
    const items: Array<{ key: keyof SettingsData; label: string; value: boolean }> = [
      { key: 'soundEnabled', label: 'Sound FX', value: s.soundEnabled },
      { key: 'musicEnabled', label: 'Clock Music', value: s.musicEnabled },
      { key: 'shakeEnabled', label: 'Screen Shake', value: s.shakeEnabled },
      { key: 'hapticsEnabled', label: 'Haptics', value: s.hapticsEnabled },
    ];
    return `
      <div class="settings-grid">
        ${items
          .map(
            (item) => `
          <button type="button" class="toggle-btn ${item.value ? 'on' : ''}" data-setting="${item.key}">
            <span>${item.label}</span>
            <span class="toggle-state">${item.value ? 'ON' : 'OFF'}</span>
          </button>`
          )
          .join('')}
      </div>
    `;
  }

  private renderTitle(): string {
    const discoveredCount = this.save.discoveredEvolutions.length;
    const offlineLabel = this.offlineReady ? 'OFFLINE READY' : 'LOCAL STORAGE READY';

    return `
      <div class="screen-shell">
        <div class="panel-card title-hero">
          ${EMBLEM_SVG}
          <h1 class="title-heading">ESCAPEMENT</h1>
          <p class="title-subtitle">Strike Back Against the Freeze</p>
          <div class="offline-pill ${this.offlineReady ? 'ready' : ''}">
            <span class="offline-dot"></span>
            <span>${offlineLabel}</span>
          </div>
        </div>

        <div class="stats-strip">
          <div class="stat-box">
            <div class="stat-label">Best Wave</div>
            <div class="stat-value blued">${this.save.bestWave || 0}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Best Score</div>
            <div class="stat-value">${(this.save.bestScore || 0).toLocaleString()}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Gilt</div>
            <div class="stat-value brass">⚙ ${(this.save.gilt || 0).toLocaleString()}</div>
          </div>
        </div>

        <button type="button" class="btn btn-primary" data-action="play">PLAY</button>

        <div class="btn-row-2">
          <button type="button" class="btn btn-secondary" data-action="workshop">
            <span>WORKSHOP</span>
            <span class="btn-pill">⚙ ${this.save.gilt}</span>
          </button>
          <button type="button" class="btn btn-secondary" data-action="codex">
            <span>CODEX</span>
            <span class="btn-pill">${discoveredCount}/${EVOLUTION_IDS.length}</span>
          </button>
        </div>

        <div class="panel-card">
          ${this.renderSettingsGrid()}
          <p class="control-hint" style="margin-top: 10px;">
            Drag anywhere with one thumb to glide · Release to engage <strong>Anchor Tempo</strong> (+Fire Rate)
          </p>
        </div>
      </div>
    `;
  }

  private renderDraft(): string {
    if (!this.draft) {
      return '';
    }
    const { choices, title, subtitle, canReroll, rerollsLeft } = this.draft;
    const cardsHtml = choices
      .map((choice, idx) => {
        const rarityClass = `rarity-${choice.rarity}`;
        const evoClass = choice.isEvolution ? 'is-evolution' : '';
        const levelText = choice.isEvolution
          ? 'GRAND COMPLICATION'
          : choice.currentLevel === 0
            ? 'NEW · LV 1'
            : `LV ${choice.currentLevel} → LV ${choice.nextLevel}`;

        return `
          <button type="button" class="draft-card ${rarityClass} ${evoClass}" data-choice="${idx}">
            <div class="draft-card-top">
              <div class="draft-card-identity">
                <span class="draft-icon" style="color: ${escapeHtml(choice.color)}; border-color: ${escapeHtml(choice.color)}55;">
                  ${escapeHtml(choice.icon)}
                </span>
                <div class="draft-name-block">
                  <div class="draft-name">${escapeHtml(choice.name)}</div>
                  <div class="draft-badges">
                    <span class="badge" style="color: ${escapeHtml(choice.color)};">${escapeHtml(choice.rarityLabel)}</span>
                    <span class="badge ${choice.isEvolution ? 'badge-evolution' : 'badge-level'}">${levelText}</span>
                  </div>
                </div>
              </div>
              <span class="key-pill">${idx + 1}</span>
            </div>
            <p class="draft-desc">${escapeHtml(choice.description)}</p>
            ${choice.synergyHint ? `<div class="draft-synergy">✦ ${escapeHtml(choice.synergyHint)}</div>` : ''}
          </button>
        `;
      })
      .join('');

    const rerollBtn = canReroll
      ? `
        <button type="button" class="btn btn-secondary" data-action="reroll" ${rerollsLeft <= 0 ? 'disabled' : ''}>
          <span>REROLL COMPLICATIONS</span>
          <span class="btn-pill">${rerollsLeft} LEFT</span>
        </button>
      `
      : '';

    return `
      <div class="screen-shell">
        <div class="panel-card">
          <div class="draft-header">
            <h2 class="draft-title">${escapeHtml(title)}</h2>
            <p class="draft-subtitle">${escapeHtml(subtitle)}</p>
          </div>
        </div>
        <div class="draft-cards">${cardsHtml}</div>
        ${rerollBtn}
      </div>
    `;
  }

  private renderPaused(): string {
    return `
      <div class="screen-shell">
        <div class="panel-card" style="display:flex; flex-direction:column; gap:12px;">
          <div class="draft-header">
            <h2 class="draft-title">PAUSED</h2>
            <p class="draft-subtitle">Escapement locked · Press Esc or P to resume</p>
          </div>
          <button type="button" class="btn btn-primary" data-action="resume">RESUME</button>
          ${this.renderSettingsGrid()}
          <button type="button" class="btn btn-danger-ghost" data-action="quit">QUIT TO TITLE</button>
        </div>
      </div>
    `;
  }

  private renderWorkshop(): string {
    const cards = META_UPGRADES.map((def) => {
      const rank = this.save.metaRanks[def.id] ?? 0;
      const maxed = rank >= def.maxRank;
      const cost = getMetaUpgradeCost(def, rank);
      const affordable = !maxed && this.save.gilt >= cost;

      let pips = '';
      for (let i = 0; i < def.maxRank; i++) {
        pips += `<span class="rank-pip ${i < rank ? 'filled' : ''}"></span>`;
      }

      return `
        <div class="meta-card ${affordable ? 'affordable' : ''}">
          <div class="meta-info">
            <div class="meta-name-row">
              <span class="meta-icon">${escapeHtml(def.icon)}</span>
              <span class="meta-name">${escapeHtml(def.name)}</span>
            </div>
            <p class="meta-desc">${escapeHtml(def.description)}</p>
            <div class="meta-effect">${escapeHtml(def.effectPerRank)} (${rank}/${def.maxRank})</div>
            <div class="rank-pips">${pips}</div>
          </div>
          <button
            type="button"
            class="btn btn-buy ${affordable ? 'affordable' : ''}"
            data-buy="${def.id}"
            ${affordable ? '' : 'disabled'}
          >
            ${maxed ? 'MAXED' : `⚙ ${cost}`}
          </button>
        </div>
      `;
    }).join('');

    return `
      <div class="screen-shell">
        <div class="panel-card" style="display:flex; flex-direction:column; gap:12px;">
          <div class="subscreen-header">
            <button type="button" class="btn btn-ghost" data-action="back">BACK</button>
            <h2 class="subscreen-title">WORKSHOP</h2>
            <span class="balance-pill">⚙ ${this.save.gilt}</span>
          </div>
          <div class="card-list">${cards}</div>
          <button type="button" class="btn btn-danger-ghost" data-action="reset-save">
            ${this.resetArmed ? 'TAP AGAIN TO CONFIRM RESET' : 'RESET LOCAL PROGRESS'}
          </button>
        </div>
      </div>
    `;
  }

  private renderCodex(): string {
    const discoveredSet = new Set(this.save.discoveredEvolutions);
    const cards = EVOLUTION_IDS.map((evoId) => {
      const evo = UPGRADES[evoId];
      const discovered = discoveredSet.has(evoId);
      const req = evo.requires;
      const weaponDef = req ? UPGRADES[req[0]] : null;
      const passiveDef = req ? UPGRADES[req[1]] : null;

      return `
        <div class="codex-card ${discovered ? 'discovered' : ''}">
          <div class="codex-top">
            <div class="codex-title-wrap">
              <span class="codex-icon" style="color:${escapeHtml(evo.color)};">${escapeHtml(evo.icon)}</span>
              <span class="codex-name" style="color:${discovered ? '#fff2b2' : 'var(--text-main)'};">
                ${escapeHtml(evo.name)}
              </span>
            </div>
            <span class="codex-status">${discovered ? 'FORGED' : 'UNDISCOVERED'}</span>
          </div>
          <p class="meta-desc">${escapeHtml(evo.shortDesc)}</p>
          ${
            weaponDef && passiveDef
              ? `
            <div class="codex-recipe">
              <span class="recipe-chip">${escapeHtml(weaponDef.icon)} ${escapeHtml(weaponDef.name)} Lv 3+</span>
              <span>+</span>
              <span class="recipe-chip">${escapeHtml(passiveDef.icon)} ${escapeHtml(passiveDef.name)} Lv 1+</span>
            </div>
          `
              : ''
          }
        </div>
      `;
    }).join('');

    return `
      <div class="screen-shell">
        <div class="panel-card" style="display:flex; flex-direction:column; gap:12px;">
          <div class="subscreen-header">
            <button type="button" class="btn btn-ghost" data-action="back">BACK</button>
            <h2 class="subscreen-title">CODEX</h2>
            <span class="balance-pill">${discoveredSet.size}/${EVOLUTION_IDS.length} FORGED</span>
          </div>
          <p class="control-hint">
            Pair a Weapon at <strong>Lv 3+</strong> with its matching Passive Complication to unlock a Mythic <strong>Grand Complication</strong>.
          </p>
          <div class="card-list">${cards}</div>
        </div>
      </div>
    `;
  }

  private renderGameOver(): string {
    const s = this.summary;
    if (!s) return this.renderTitle();

    const badges: string[] = [];
    if (s.isNewBestWave) badges.push('NEW BEST WAVE');
    if (s.isNewBestScore) badges.push('NEW BEST SCORE');

    const evoChips = s.evolutionsUnlocked
      .map((id) => {
        const def = UPGRADES[id];
        return `<span class="evo-chip">${escapeHtml(def.icon)} ${escapeHtml(def.name)}</span>`;
      })
      .join('');

    return `
      <div class="screen-shell">
        <div class="panel-card" style="display:flex; flex-direction:column; gap:12px;">
          <div class="gameover-header">
            <h2 class="gameover-title">ESCAPEMENT HALTED</h2>
            <p class="gameover-wave">Cycle ${s.cycle + 1} · Wave ${s.wave} Reached</p>
            ${
              badges.length > 0
                ? `<div class="best-badges">${badges.map((b) => `<span class="best-badge">★ ${b}</span>`).join('')}</div>`
                : ''
            }
          </div>

          <div class="summary-grid">
            <div class="stat-box">
              <div class="stat-label">Score</div>
              <div class="stat-value">${s.score.toLocaleString()}</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Mechanisms Shattered</div>
              <div class="stat-value blued">${s.kills.toLocaleString()}</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Level Reached</div>
              <div class="stat-value">LV ${s.levelReached}</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Duration</div>
              <div class="stat-value">${formatDuration(s.durationSec)}</div>
            </div>
            <div class="stat-box summary-gilt-banner">
              <div class="stat-label">Gilt Harvested</div>
              <div class="stat-value brass">+${s.giltEarned.toLocaleString()} ⚙</div>
            </div>
          </div>

          ${
            s.evolutionsUnlocked.length > 0
              ? `
            <div>
              <div class="stat-label" style="text-align:center; margin-bottom:6px;">Grand Complications Forged</div>
              <div class="evo-chips">${evoChips}</div>
            </div>
          `
              : ''
          }

          <button type="button" class="btn btn-primary" data-action="play">PLAY AGAIN</button>
          <div class="btn-row-2">
            <button type="button" class="btn btn-secondary" data-action="workshop">
              <span>WORKSHOP</span>
              <span class="btn-pill">⚙ ${this.save.gilt}</span>
            </button>
            <button type="button" class="btn btn-ghost" data-action="title">TITLE</button>
          </div>
        </div>
      </div>
    `;
  }

  private render(): void {
    if (this.screen === 'playing') {
      this.container.classList.add('hidden');
      this.container.innerHTML = '';
      return;
    }

    this.container.classList.remove('hidden');

    switch (this.screen) {
      case 'title':
        this.container.innerHTML = this.renderTitle();
        break;
      case 'levelup':
        this.container.innerHTML = this.renderDraft();
        break;
      case 'paused':
        this.container.innerHTML = this.renderPaused();
        break;
      case 'workshop':
        this.container.innerHTML = this.renderWorkshop();
        break;
      case 'codex':
        this.container.innerHTML = this.renderCodex();
        break;
      case 'gameover':
        this.container.innerHTML = this.renderGameOver();
        break;
    }
  }
}

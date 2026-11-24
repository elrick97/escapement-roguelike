import { MAX_WEAPON_SLOTS, type HudSnapshot } from '../types';

interface WeaponSlotEls {
  root: HTMLDivElement;
  icon: HTMLSpanElement;
  pips: HTMLSpanElement[];
  sig: string;
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * High-frequency in-game HUD renderer.
 * Pre-builds all nodes and mutates DOM properties only when values change.
 */
export class HudView {
  private readonly container: HTMLElement;
  private readonly onPause: () => void;

  private readonly levelBadge: HTMLSpanElement;
  private readonly xpFill: HTMLDivElement;
  private readonly hpValue: HTMLSpanElement;
  private readonly wardTag: HTMLSpanElement;
  private readonly hpFill: HTMLDivElement;
  private readonly wardFill: HTMLDivElement;

  private readonly waveCode: HTMLSpanElement;
  private readonly waveTimer: HTMLSpanElement;
  private readonly waveTitleEl: HTMLDivElement;
  private readonly modifierTag: HTMLSpanElement;

  private readonly scoreVal: HTMLSpanElement;
  private readonly giltVal: HTMLSpanElement;
  private readonly pauseBtn: HTMLButtonElement;

  private readonly bossWrap: HTMLDivElement;
  private readonly bossNameEl: HTMLSpanElement;
  private readonly bossTitleEl: HTMLSpanElement;
  private readonly bossHpText: HTMLSpanElement;
  private readonly bossFill: HTMLDivElement;

  private readonly bannerWrap: HTMLDivElement;
  private readonly bannerTitle: HTMLDivElement;
  private readonly bannerSub: HTMLDivElement;

  private readonly weaponSlots: WeaponSlotEls[] = [];
  private readonly anchorPill: HTMLDivElement;

  // Cached comparison state
  private prevVisible = false;
  private prevLevel = -1;
  private prevXpPct = '';
  private prevHpText = '';
  private prevWardText = '';
  private prevHpPct = '';
  private prevWardPct = '';
  private prevWaveCode = '';
  private prevTimerText = '';
  private prevWaveTitle = '';
  private prevModifier: string | null = '__init__';
  private prevScore = -1;
  private prevGilt = -1;
  private prevAnchor = false;
  private prevBossVisible = false;
  private prevBossName = '';
  private prevBossTitle = '';
  private prevBossHpText = '';
  private prevBossPct = '';
  private prevBannerVisible = false;
  private prevBannerText = '';
  private prevBannerSub = '';
  private prevBannerColor = '';

  constructor(container: HTMLElement, onPause: () => void) {
    this.container = container;
    this.onPause = onPause;
    this.container.textContent = '';

    // Top stack (XP bar + Top Row + Boss Bar)
    const topStack = document.createElement('div');
    topStack.className = 'hud-top-stack';

    const xpRow = document.createElement('div');
    xpRow.className = 'hud-xp-row';

    this.levelBadge = document.createElement('span');
    this.levelBadge.className = 'hud-level-badge';
    this.levelBadge.textContent = 'LV 1';

    const xpTrack = document.createElement('div');
    xpTrack.className = 'hud-xp-track';
    this.xpFill = document.createElement('div');
    this.xpFill.className = 'hud-xp-fill';
    xpTrack.appendChild(this.xpFill);

    xpRow.append(this.levelBadge, xpTrack);

    // Top row
    const topRow = document.createElement('div');
    topRow.className = 'hud-top-row';

    // HP / Ward Pill
    const hpPill = document.createElement('div');
    hpPill.className = 'hud-pill hud-hp-pill';
    const hpHeader = document.createElement('div');
    hpHeader.className = 'hud-hp-header';
    const hpLabel = document.createElement('span');
    hpLabel.className = 'hud-hp-label';
    hpLabel.textContent = 'CORE';

    const hpNums = document.createElement('span');
    this.hpValue = document.createElement('span');
    this.hpValue.className = 'hud-hp-value';
    this.hpValue.textContent = '100/100';
    this.wardTag = document.createElement('span');
    this.wardTag.className = 'hud-ward-tag hidden';
    hpNums.append(this.hpValue, this.wardTag);
    hpHeader.append(hpLabel, hpNums);

    const hpTrack = document.createElement('div');
    hpTrack.className = 'hud-hp-track';
    this.hpFill = document.createElement('div');
    this.hpFill.className = 'hud-hp-fill';
    this.wardFill = document.createElement('div');
    this.wardFill.className = 'hud-ward-fill';
    hpTrack.append(this.hpFill, this.wardFill);
    hpPill.append(hpHeader, hpTrack);

    // Wave / Cycle Pill
    const wavePill = document.createElement('div');
    wavePill.className = 'hud-pill hud-wave-pill';
    const waveMain = document.createElement('div');
    waveMain.className = 'hud-wave-main';
    this.waveCode = document.createElement('span');
    this.waveCode.className = 'hud-wave-code';
    this.waveCode.textContent = 'C1 · W1';
    this.waveTimer = document.createElement('span');
    this.waveTimer.className = 'hud-wave-timer';
    this.waveTimer.textContent = '0:24';
    waveMain.append(this.waveCode, this.waveTimer);

    this.waveTitleEl = document.createElement('div');
    this.waveTitleEl.className = 'hud-wave-sub';
    this.modifierTag = document.createElement('span');
    this.modifierTag.className = 'hud-modifier-tag hidden';
    wavePill.append(waveMain, this.waveTitleEl, this.modifierTag);

    // Right group: Score/Gilt + Pause
    const rightGroup = document.createElement('div');
    rightGroup.className = 'hud-right-group';

    const scorePill = document.createElement('div');
    scorePill.className = 'hud-pill hud-score-pill';
    this.scoreVal = document.createElement('span');
    this.scoreVal.className = 'hud-score-val';
    this.scoreVal.textContent = '0';
    this.giltVal = document.createElement('span');
    this.giltVal.className = 'hud-gilt-val';
    this.giltVal.textContent = '⚙ 0';
    scorePill.append(this.scoreVal, this.giltVal);

    this.pauseBtn = document.createElement('button');
    this.pauseBtn.type = 'button';
    this.pauseBtn.className = 'hud-pause-btn';
    this.pauseBtn.setAttribute('aria-label', 'Pause game');
    this.pauseBtn.textContent = '❚❚';
    this.pauseBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onPause();
    });

    rightGroup.append(scorePill, this.pauseBtn);
    topRow.append(hpPill, wavePill, rightGroup);

    // Boss bar
    this.bossWrap = document.createElement('div');
    this.bossWrap.className = 'hud-boss-wrap hidden';
    const bossHeader = document.createElement('div');
    bossHeader.className = 'hud-boss-header';
    const bossTitles = document.createElement('div');
    bossTitles.className = 'hud-boss-titles';
    this.bossNameEl = document.createElement('span');
    this.bossNameEl.className = 'hud-boss-name';
    this.bossTitleEl = document.createElement('span');
    this.bossTitleEl.className = 'hud-boss-subtitle';
    bossTitles.append(this.bossNameEl, this.bossTitleEl);
    this.bossHpText = document.createElement('span');
    this.bossHpText.className = 'hud-boss-hp-text';
    bossHeader.append(bossTitles, this.bossHpText);

    const bossTrack = document.createElement('div');
    bossTrack.className = 'hud-boss-track';
    this.bossFill = document.createElement('div');
    this.bossFill.className = 'hud-boss-fill';
    bossTrack.appendChild(this.bossFill);
    this.bossWrap.append(bossHeader, bossTrack);

    topStack.append(xpRow, topRow, this.bossWrap);

    // Center transient banner
    this.bannerWrap = document.createElement('div');
    this.bannerWrap.className = 'hud-banner hidden';
    this.bannerTitle = document.createElement('div');
    this.bannerTitle.className = 'hud-banner-title';
    this.bannerSub = document.createElement('div');
    this.bannerSub.className = 'hud-banner-sub';
    this.bannerWrap.append(this.bannerTitle, this.bannerSub);

    // Bottom bar
    const bottomBar = document.createElement('div');
    bottomBar.className = 'hud-bottom-bar';

    const weaponsStrip = document.createElement('div');
    weaponsStrip.className = 'hud-weapons-strip';

    for (let i = 0; i < MAX_WEAPON_SLOTS; i++) {
      const slot = document.createElement('div');
      slot.className = 'hud-weapon-slot empty';
      const icon = document.createElement('span');
      icon.className = 'hud-weapon-icon';
      icon.textContent = '·';

      const pipsWrap = document.createElement('div');
      pipsWrap.className = 'hud-weapon-pips';
      const pips: HTMLSpanElement[] = [];
      for (let p = 0; p < 5; p++) {
        const pip = document.createElement('span');
        pip.className = 'hud-weapon-pip';
        pips.push(pip);
        pipsWrap.appendChild(pip);
      }

      slot.append(icon, pipsWrap);
      weaponsStrip.appendChild(slot);
      this.weaponSlots.push({ root: slot, icon, pips, sig: '' });
    }

    this.anchorPill = document.createElement('div');
    this.anchorPill.className = 'hud-anchor-pill';
    this.anchorPill.textContent = 'ANCHOR';

    bottomBar.append(weaponsStrip, this.anchorPill);

    this.container.append(topStack, this.bannerWrap, bottomBar);
  }

  public setVisible(visible: boolean): void {
    if (this.prevVisible === visible) return;
    this.prevVisible = visible;
    this.container.classList.toggle('hidden', !visible);
  }

  public update(hud: HudSnapshot): void {
    // Level & XP
    if (hud.level !== this.prevLevel) {
      this.prevLevel = hud.level;
      this.levelBadge.textContent = `LV ${hud.level}`;
    }

    const xpRatio = hud.xpToNext > 0 ? Math.min(1, Math.max(0, hud.xp / hud.xpToNext)) : 0;
    const xpPct = `${(xpRatio * 100).toFixed(1)}%`;
    if (xpPct !== this.prevXpPct) {
      this.prevXpPct = xpPct;
      this.xpFill.style.width = xpPct;
    }

    // HP & Ward
    const hpVal = Math.max(0, Math.ceil(hud.hp));
    const maxHpVal = Math.max(1, Math.ceil(hud.maxHp));
    const hpText = `${hpVal}/${maxHpVal}`;
    if (hpText !== this.prevHpText) {
      this.prevHpText = hpText;
      this.hpValue.textContent = hpText;
    }

    const hpPct = `${Math.min(100, Math.max(0, (hud.hp / maxHpVal) * 100)).toFixed(1)}%`;
    if (hpPct !== this.prevHpPct) {
      this.prevHpPct = hpPct;
      this.hpFill.style.width = hpPct;
    }

    const wardVal = Math.max(0, Math.ceil(hud.ward));
    const wardText = hud.maxWard > 0 && wardVal > 0 ? `+${wardVal}` : '';
    if (wardText !== this.prevWardText) {
      this.prevWardText = wardText;
      this.wardTag.textContent = wardText;
      this.wardTag.classList.toggle('hidden', wardText === '');
    }

    const wardRatio =
      hud.maxWard > 0 ? Math.min(1, Math.max(0, hud.ward / Math.max(1, hud.maxWard))) : 0;
    const wardPct = `${(wardRatio * 100).toFixed(1)}%`;
    if (wardPct !== this.prevWardPct) {
      this.prevWardPct = wardPct;
      this.wardFill.style.width = wardPct;
    }

    // Wave & Cycle (1-based display)
    const waveCode = `C${hud.cycle + 1} · W${hud.wave}`;
    if (waveCode !== this.prevWaveCode) {
      this.prevWaveCode = waveCode;
      this.waveCode.textContent = waveCode;
    }

    const timerText = formatClock(hud.waveTimeLeft);
    if (timerText !== this.prevTimerText) {
      this.prevTimerText = timerText;
      this.waveTimer.textContent = timerText;
    }

    if (hud.waveTitle !== this.prevWaveTitle) {
      this.prevWaveTitle = hud.waveTitle;
      this.waveTitleEl.textContent = hud.waveTitle;
    }

    if (hud.waveModifierName !== this.prevModifier) {
      this.prevModifier = hud.waveModifierName;
      if (hud.waveModifierName) {
        this.modifierTag.textContent = hud.waveModifierName;
        this.modifierTag.classList.remove('hidden');
      } else {
        this.modifierTag.textContent = '';
        this.modifierTag.classList.add('hidden');
      }
    }

    // Score & Gilt
    const scoreInt = Math.floor(hud.score);
    if (scoreInt !== this.prevScore) {
      this.prevScore = scoreInt;
      this.scoreVal.textContent = scoreInt.toLocaleString();
    }

    const giltInt = Math.floor(hud.giltRun);
    if (giltInt !== this.prevGilt) {
      this.prevGilt = giltInt;
      this.giltVal.textContent = `⚙ ${giltInt}`;
    }

    // Boss HP Bar
    const bossVisible = hud.bossName !== null && hud.bossMaxHp > 0;
    if (bossVisible !== this.prevBossVisible) {
      this.prevBossVisible = bossVisible;
      this.bossWrap.classList.toggle('hidden', !bossVisible);
      this.bossWrap.classList.toggle('visible', bossVisible);
    }

    if (bossVisible) {
      const bName = hud.bossName ?? '';
      if (bName !== this.prevBossName) {
        this.prevBossName = bName;
        this.bossNameEl.textContent = bName;
      }

      const bTitle = hud.bossTitle ?? '';
      if (bTitle !== this.prevBossTitle) {
        this.prevBossTitle = bTitle;
        this.bossTitleEl.textContent = bTitle;
      }

      const bHp = Math.max(0, Math.ceil(hud.bossHp));
      const bMax = Math.max(1, Math.ceil(hud.bossMaxHp));
      const bHpText = `${bHp}/${bMax}`;
      if (bHpText !== this.prevBossHpText) {
        this.prevBossHpText = bHpText;
        this.bossHpText.textContent = bHpText;
      }

      const bPct = `${Math.min(100, Math.max(0, (hud.bossHp / bMax) * 100)).toFixed(1)}%`;
      if (bPct !== this.prevBossPct) {
        this.prevBossPct = bPct;
        this.bossFill.style.width = bPct;
      }
    }

    // Center Banner
    const bannerVisible = hud.bannerText !== null && hud.bannerText !== '';
    if (bannerVisible !== this.prevBannerVisible) {
      this.prevBannerVisible = bannerVisible;
      this.bannerWrap.classList.toggle('hidden', !bannerVisible);
      this.bannerWrap.classList.toggle('visible', bannerVisible);
    }

    if (bannerVisible) {
      const bText = hud.bannerText ?? '';
      if (bText !== this.prevBannerText) {
        this.prevBannerText = bText;
        this.bannerTitle.textContent = bText;
      }
      const bSub = hud.bannerSubtext ?? '';
      if (bSub !== this.prevBannerSub) {
        this.prevBannerSub = bSub;
        this.bannerSub.textContent = bSub;
        this.bannerSub.classList.toggle('hidden', bSub === '');
      }
      if (hud.bannerColor !== this.prevBannerColor) {
        this.prevBannerColor = hud.bannerColor;
        this.bannerTitle.style.color = hud.bannerColor || '#FFD166';
        this.bannerWrap.style.borderColor = hud.bannerColor || 'rgba(245, 197, 66, 0.45)';
      }
    }

    // Bottom Weapons Strip
    for (let i = 0; i < this.weaponSlots.length; i++) {
      const slot = this.weaponSlots[i];
      const w = i < hud.weapons.length ? hud.weapons[i] : undefined;
      const sig = w ? `${w.id}|${w.icon}|${w.level}|${w.evolved ? 1 : 0}|${w.color}` : 'empty';
      if (sig === slot.sig) continue;
      slot.sig = sig;

      if (!w) {
        slot.root.className = 'hud-weapon-slot empty';
        slot.root.style.borderColor = '';
        slot.icon.textContent = '·';
        slot.icon.style.color = '';
        for (let p = 0; p < slot.pips.length; p++) {
          slot.pips[p].className = 'hud-weapon-pip';
        }
      } else {
        slot.root.className = w.evolved ? 'hud-weapon-slot evolved' : 'hud-weapon-slot';
        slot.root.style.borderColor = w.evolved ? '#FFD166' : w.color;
        slot.icon.textContent = w.icon;
        slot.icon.style.color = w.color;
        const activePips = w.evolved ? 5 : Math.min(5, Math.max(1, w.level));
        for (let p = 0; p < slot.pips.length; p++) {
          slot.pips[p].className = p < activePips ? 'hud-weapon-pip on' : 'hud-weapon-pip';
        }
      }
    }

    // Anchor Tempo Pill
    if (hud.anchorActive !== this.prevAnchor) {
      this.prevAnchor = hud.anchorActive;
      this.anchorPill.classList.toggle('active', hud.anchorActive);
    }
  }
}

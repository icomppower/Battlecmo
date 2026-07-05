import {
  AIRFRAMES,
  STORES,
  configStats,
  referencePackage,
  validateConfig,
  type AircraftConfig,
  type AirframeDef,
} from '../src/oob/assembly';

/**
 * Mission Builder — drag-and-drop OOB/loadout assembly over the pure
 * assembly module. Drag airframes from the hangar into the package, drag
 * stores from the armory onto a jet's wing; every card shows the computed
 * tradeoffs (stations, RCS, burn, endurance) live. Committing hands the
 * configs to main.ts, which rebuilds the scenario with the package swapped
 * in via withBluePackage.
 */

const ID_PREFIX: Record<AirframeDef['role'], string> = {
  STRIKE: 'blue-striker-',
  SEAD: 'blue-sead-',
  EW: 'blue-ea-',
};
const CALLSIGN: Record<AirframeDef['role'], string> = {
  STRIKE: 'Hammer',
  SEAD: 'Viper',
  EW: 'Static',
};

type DragPayload = { kind: 'airframe' | 'store'; id: string };

export function initBuilder(onCommit: (configs: AircraftConfig[]) => void): void {
  const overlay = document.getElementById('builderoverlay')!;
  const hangar = document.getElementById('hangar')!;
  const armory = document.getElementById('armory')!;
  const pkgList = document.getElementById('pkglist')!;
  const pkgDrop = document.getElementById('pkgdrop')!;
  const commitBtn = document.getElementById('buildercommit') as HTMLButtonElement;
  const openBtn = document.getElementById('builderopen')!;

  let configs: AircraftConfig[] = referencePackage();

  const esc = (s: string): string =>
    s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  // ---- static columns: hangar and armory --------------------------------

  hangar.insertAdjacentHTML(
    'beforeend',
    Object.values(AIRFRAMES)
      .map(
        (af) =>
          `<div class="card" draggable="true" data-drag='${JSON.stringify({ kind: 'airframe', id: af.id })}'>` +
          `<div>${esc(af.name)}</div>` +
          `<div class="sub">${af.hardpoints} hardpoints · clean RCS ${af.cleanRcs} m² · ${af.internalFuelKg} kg fuel</div>` +
          `</div>`,
      )
      .join(''),
  );

  armory.insertAdjacentHTML(
    'beforeend',
    Object.values(STORES)
      .map((st) => {
        const effect =
          st.kind === 'WEAPON'
            ? `${st.rounds} rd`
            : st.kind === 'JAMMER_POD'
              ? `jammer ${Math.round(st.jammer!.range / 1000)} km`
              : `+${st.fuelKg} kg fuel`;
        return (
          `<div class="card" draggable="true" data-drag='${JSON.stringify({ kind: 'store', id: st.id })}'>` +
          `<div>${esc(st.name)}</div>` +
          `<div class="sub">${st.stations} stn · +${st.rcsAdd} m² RCS · +${st.burnAdd} kg/s · ${effect}</div>` +
          `</div>`
        );
      })
      .join(''),
  );

  document.addEventListener('dragstart', (e) => {
    const card = (e.target as HTMLElement).closest?.('[data-drag]');
    if (!card || !e.dataTransfer) return;
    e.dataTransfer.setData('text/plain', (card as HTMLElement).dataset.drag!);
    e.dataTransfer.effectAllowed = 'copy';
  });

  const payloadOf = (e: DragEvent): DragPayload | null => {
    try {
      return JSON.parse(e.dataTransfer?.getData('text/plain') ?? '') as DragPayload;
    } catch {
      return null;
    }
  };

  // ---- package column -----------------------------------------------------

  function nextIdentity(role: AirframeDef['role']): { id: string; callsign: string } {
    for (let n = 1; ; n++) {
      const id = `${ID_PREFIX[role]}${n}`;
      if (!configs.some((c) => c.id === id)) return { id, callsign: `${CALLSIGN[role]} ${n}` };
    }
  }

  function fmtEndurance(ticks: number): string {
    return `${Math.floor(ticks / 60)} min`;
  }

  function renderPackage(): void {
    const cards = configs.map((cfg, i) => {
      const af = AIRFRAMES[cfg.airframeId]!;
      const errors = validateConfig(cfg);
      const chips = cfg.stores
        .map(
          (sid, si) =>
            `<span class="chip">${esc(STORES[sid]?.name ?? sid)}` +
            `<button data-unstore="${i}:${si}" title="remove">✕</button></span>`,
        )
        .join('');
      let stats = '';
      if (errors.length === 0) {
        const st = configStats(cfg);
        const wpns = st.weapons.map((w) => `${w.weaponId} ×${w.count}`).join(', ') || 'unarmed';
        stats =
          `<div class="sub">${st.stationsUsed}/${st.hardpoints} stations · RCS ${st.rcs} m² · ` +
          `${st.burnKgPerTick} kg/s · endurance ≈${fmtEndurance(st.enduranceTicks)}</div>` +
          `<div class="sub">${esc(wpns)}${st.jammer ? ' · jamming pod' : ''}</div>`;
      }
      return (
        `<div class="acft${errors.length ? ' invalid' : ''}" data-acft="${i}">` +
        `<div class="row"><span>${esc(cfg.callsign)} <span class="sub">${esc(af.name)}</span></span>` +
        `<button data-unacft="${i}" title="remove from package">✕</button></div>` +
        stats +
        errors.map((err) => `<div class="errline">⚠ ${esc(err)}</div>`).join('') +
        `<div>${chips || '<span class="sub">clean wing — drag stores here</span>'}</div>` +
        `</div>`
      );
    });
    pkgList.innerHTML = cards.join('');
    const invalid = configs.some((c) => validateConfig(c).length > 0);
    commitBtn.disabled = configs.length === 0 || invalid;
    commitBtn.textContent = configs.length === 0 ? 'COMMIT (empty package)' : invalid ? 'COMMIT (fix loadouts)' : 'COMMIT PACKAGE';
  }

  // Drop airframes anywhere on the package column.
  for (const el of [pkgDrop, pkgList]) {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      pkgDrop.classList.add('dragover');
    });
    el.addEventListener('dragleave', () => pkgDrop.classList.remove('dragover'));
    el.addEventListener('drop', (e) => {
      pkgDrop.classList.remove('dragover');
      const p = payloadOf(e);
      if (!p) return;
      if (p.kind === 'airframe') {
        e.preventDefault();
        const af = AIRFRAMES[p.id];
        if (!af) return;
        configs.push({ ...nextIdentity(af.role), airframeId: af.id, stores: [] });
        renderPackage();
      }
      // store drops are handled per-aircraft below (bubbling target check)
    });
  }

  // Drop stores onto a specific aircraft card.
  pkgList.addEventListener('dragover', (e) => {
    const acft = (e.target as HTMLElement).closest?.('[data-acft]');
    for (const el of pkgList.querySelectorAll('.acft.dragover')) el.classList.remove('dragover');
    if (acft) {
      e.preventDefault();
      acft.classList.add('dragover');
    }
  });
  pkgList.addEventListener('drop', (e) => {
    for (const el of pkgList.querySelectorAll('.acft.dragover')) el.classList.remove('dragover');
    const acft = (e.target as HTMLElement).closest?.<HTMLElement>('[data-acft]');
    const p = payloadOf(e);
    if (!acft || !p || p.kind !== 'store' || !STORES[p.id]) return;
    e.preventDefault();
    e.stopPropagation();
    configs[Number(acft.dataset.acft)]!.stores.push(p.id);
    renderPackage();
  });

  // Remove buttons (aircraft / store chips).
  pkgList.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const unacft = target.closest<HTMLElement>('[data-unacft]');
    if (unacft) {
      configs.splice(Number(unacft.dataset.unacft), 1);
      renderPackage();
      return;
    }
    const unstore = target.closest<HTMLElement>('[data-unstore]');
    if (unstore) {
      const [ci, si] = unstore.dataset.unstore!.split(':').map(Number);
      configs[ci!]!.stores.splice(si!, 1);
      renderPackage();
    }
  });

  // ---- open / standard / commit / close ----------------------------------

  openBtn.addEventListener('click', () => {
    overlay.classList.add('open');
    renderPackage();
  });
  document.getElementById('builderclose')!.addEventListener('click', () => {
    overlay.classList.remove('open');
  });
  document.getElementById('builderstd')!.addEventListener('click', () => {
    configs = referencePackage();
    renderPackage();
  });
  commitBtn.addEventListener('click', () => {
    onCommit(configs.map((c) => ({ ...c, stores: [...c.stores] })));
    openBtn.classList.add('on');
    overlay.classList.remove('open');
  });

  renderPackage();
}

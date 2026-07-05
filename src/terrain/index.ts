import { registerTerrain } from '../core/terrain';
import { ROMSDAL } from './romsdal';

/**
 * Terrain registry bootstrap — importing this module makes every baked
 * heightfield resolvable by id. Scenario builders that set `terrainId`
 * import it for the side effect, so any consumer of the scenario (tests,
 * UI, headless tools) gets the terrain with it.
 */
registerTerrain(ROMSDAL);

export { ROMSDAL };

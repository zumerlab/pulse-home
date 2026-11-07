// The little of Home Assistant's `hass` object a card needs, typed here so the
// card does not depend on the frontend's own types.
import type { Connection, HassEntities, HassEntity, HassServiceTarget } from 'home-assistant-js-websocket';

export type HomeAssistant = {
  states: HassEntities;
  connected: boolean;
  connection: Connection;
  config: { version: string; unit_system: { temperature: string }; language?: string };
  // The user's language and locale, and the frontend's own words for a state.
  language?: string;
  locale?: { language: string; number_format?: string; time_format?: string };
  formatEntityState?(stateObj: HassEntity, state?: string): string;
  // The registries the frontend already holds (display entries: name, area,
  // device, hidden, category); a new object whenever one changes.
  areas?: Record<string, { area_id: string; name: string; floor_id?: string | null; icon?: string | null }>;
  devices?: Record<string, { id: string; name?: string | null; name_by_user?: string | null; area_id?: string | null }>;
  entities?: Record<string, { entity_id: string; name?: string; area_id?: string; device_id?: string; platform?: string; hidden?: boolean; entity_category?: 'config' | 'diagnostic' }>;
  floors?: Record<string, { floor_id: string; name: string; level?: number | null }>;
  callService(domain: string, service: string, data?: Record<string, unknown>, target?: HassServiceTarget): Promise<unknown>;
  callWS?<T>(message: Record<string, unknown>): Promise<T>;
  hassUrl(path?: string): string;
};

export type CardConfig = { type: string };

// A form the dashboard editor renders for the card: the subset of HA's
// `LovelaceConfigForm` / `HaFormSchema` the card uses.
export type FormSchema =
  | { name: string; required?: boolean; default?: unknown; selector: Selector }
  | { name: string; type: 'grid'; schema: FormSchema[] };
export type Selector =
  | { select: { multiple?: boolean; mode?: 'list' | 'dropdown' | 'box'; options: { value: string; label: string }[] } }
  | { boolean: Record<string, never> }
  | { number: { min?: number; max?: number; step?: number; mode?: 'box' | 'slider' } }
  | { area: { multiple?: boolean } };
export type ConfigForm = {
  schema: FormSchema[];
  assertConfig?(config: CardConfig): void;
  computeLabel?(schema: FormSchema): string | undefined;
  computeHelper?(schema: FormSchema): string | undefined;
};

export type LovelaceCard = HTMLElement & {
  hass?: HomeAssistant;
  setConfig(config: CardConfig): void;
  getCardSize?(): number | Promise<number>;
  getGridOptions?(): { columns?: number | 'full'; rows?: number | 'auto'; min_columns?: number; min_rows?: number };
};

declare global {
  interface Window {
    customCards?: { type: string; name: string; description: string; preview?: boolean; documentationURL?: string }[];
    customStrategies?: { type: string; strategyType: 'dashboard' | 'view' | 'section'; name: string; description: string; documentationURL?: string }[];
  }
}

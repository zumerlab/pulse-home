// Entities that behave like Home Assistant's without a Home Assistant: a port
// of the frontend's fake entities (home-assistant/frontend,
// src/fake_data/entities/*, Apache License 2.0; see ./NOTICE.md), the same code
// that answers service calls on demo.home-assistant.io. Each class turns a
// service call into a state change, with the transitions (locking…, opening…)
// the real integrations go through. Pulse adds the `update` entity.

import type { HassEntity } from 'home-assistant-js-websocket';

export type Attributes = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
// The essentials of a HassEntity, as the frontend's demo configs write them.
export type EntityInput = {
  entity_id: string; state: string; attributes: Attributes;
  area_id?: string; device_id?: string; platform?: string; last_changed?: string;
};
export type Floor = { floor_id: string; name: string; level: number };
export type Area = {
  area_id: string; name: string; floor_id?: string; icon?: string;
  temperature_entity_id?: string; humidity_entity_id?: string;
};
// Where an entity writes its new state.
export type StateSink = { updateState(state: HassEntity): void };

const now = () => new Date().toISOString();
const randomTime = () => new Date(Date.now() - Math.random() * 80 * 60 * 1000).toISOString();
const supports = (attributes: Attributes, feature: number) => ((attributes.supported_features as number) & feature) !== 0;

// Feature flags of each domain, as Home Assistant numbers them.
const Climate = { TARGET_TEMPERATURE: 1, TARGET_TEMPERATURE_RANGE: 2, TARGET_HUMIDITY: 4, FAN_MODE: 8, PRESET_MODE: 16, SWING_MODE: 32, AUX_HEAT: 64, SWING_HORIZONTAL_MODE: 512 };
const Cover = { SET_POSITION: 4, SET_TILT_POSITION: 128 };
const Fan = { SET_SPEED: 1, OSCILLATE: 2, DIRECTION: 4, PRESET_MODE: 8 };
const Vacuum = { FAN_SPEED: 32, STATUS: 128 };
const Valve = { SET_POSITION: 4 };
const WaterHeater = { TARGET_TEMPERATURE: 1, OPERATION_MODE: 2, AWAY_MODE: 4 };
const Humidifier = { MODES: 1 };
const Light = { EFFECT: 4 };
const Update = { INSTALL: 1, PROGRESS: 4 };


export class MockEntity {
  readonly entityId: string;
  readonly domain: string;
  readonly areaId?: string;
  state: string;
  attributes: Attributes;
  lastChanged: string;
  lastUpdated: string;
  sink?: StateSink;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(input: EntityInput) {
    this.entityId = input.entity_id;
    this.domain = input.entity_id.split('.', 1)[0];
    this.state = input.state;
    this.areaId = input.area_id;
    this.lastChanged = input.last_changed ?? randomTime();
    this.lastUpdated = this.lastChanged;
    this.attributes = input.attributes ?? {};
  }

  // Services the real integration would answer. Unknown ones are ignored.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async handleService(_domain: string, _service: string, _data: Attributes): Promise<void> {}

  protected transition(transitioning: string, final: string, duration: number, onComplete?: () => void) {
    this.clearTransition();
    this.update({ state: transitioning });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.update({ state: final });
      onComplete?.();
    }, duration);
  }

  protected clearTransition() {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
  }

  dispose() { this.clearTransition(); }

  update(changes: { state?: string; attributes?: Attributes }) {
    this.lastUpdated = now();
    if (changes.state !== undefined && changes.state !== this.state) {
      this.state = changes.state;
      this.lastChanged = this.lastUpdated;
    }
    if (changes.attributes) this.attributes = { ...this.attributes, ...changes.attributes };
    this.sink?.updateState(this.toState());
  }

  protected baseAttributes(): Attributes {
    const out: Attributes = {};
    for (const key of ['friendly_name', 'icon', 'entity_picture', 'assumed_state', 'device_class', 'state_class', 'unit_of_measurement', 'supported_features']) {
      if (key in this.attributes) out[key] = this.attributes[key];
    }
    return out;
  }
  protected capabilityAttributes(): Attributes { return {}; }
  protected stateAttributes(): Attributes { return {}; }

  toState(): HassEntity {
    return {
      entity_id: this.entityId,
      state: this.state,
      attributes: { ...this.baseAttributes(), ...this.capabilityAttributes(), ...this.stateAttributes() },
      last_changed: this.lastChanged,
      last_updated: this.lastUpdated,
      context: { id: this.entityId, user_id: null, parent_id: null },
    };
  }
}

// Sensors and everything without a service: the state is written as given.
class MockPassiveEntity extends MockEntity {
  protected stateAttributes() { return this.attributes; }
}

// scene: activating it stamps the moment, as Home Assistant does (what it sets is not simulated).
class MockSceneEntity extends MockEntity {
  async handleService(domain: string, service: string) {
    if (domain === 'scene' && service === 'turn_on') this.update({ state: new Date().toISOString() });
  }
  protected stateAttributes() { return this.attributes; }
}

// switch, input_boolean, siren.
class MockToggleEntity extends MockEntity {
  async handleService(domain: string, service: string, data: Attributes) {
    if (!['homeassistant', this.domain].includes(domain)) return;
    if (service === 'turn_on') this.update({ state: 'on' });
    else if (service === 'turn_off') this.update({ state: 'off' });
    else if (service === 'toggle') await this.handleService(domain, this.state === 'on' ? 'turn_off' : 'turn_on', data);
  }
  protected stateAttributes() { return this.attributes; }
}

class MockLightEntity extends MockEntity {
  async handleService(domain: string, service: string, data: Attributes) {
    if (!['homeassistant', this.domain].includes(domain)) return;
    if (service === 'turn_on') {
      const attrs = { ...this.attributes };
      if (data.brightness) attrs.brightness = data.brightness;
      else if (data.brightness_pct) attrs.brightness = Math.round((255 * data.brightness_pct) / 100);
      else if (!attrs.brightness) attrs.brightness = 255;
      if (data.color_temp_kelvin) { attrs.color_temp_kelvin = data.color_temp_kelvin; attrs.color_mode = 'color_temp'; }
      for (const key of ['hs_color', 'rgb_color', 'xy_color', 'rgbw_color', 'rgbww_color']) {
        if (data[key]) {
          attrs[key] = data[key];
          const modes: string[] = attrs.supported_color_modes ?? [];
          attrs.color_mode = modes.find((m) => ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'].includes(m)) ?? 'unknown';
        }
      }
      if (data.effect) attrs.effect = data.effect;
      if (!attrs.color_mode) attrs.color_mode = (attrs.supported_color_modes ?? ['unknown'])[0];
      this.update({ state: 'on', attributes: attrs });
    } else if (service === 'turn_off') this.update({ state: 'off' });
    else if (service === 'toggle') await this.handleService(domain, this.state === 'on' ? 'turn_off' : 'turn_on', data);
  }
  protected capabilityAttributes() {
    const a = this.attributes, modes: string[] = a.supported_color_modes ?? [];
    const out: Attributes = { supported_color_modes: modes };
    if (modes.includes('color_temp')) { out.min_color_temp_kelvin = a.min_color_temp_kelvin; out.max_color_temp_kelvin = a.max_color_temp_kelvin; }
    if (supports(a, Light.EFFECT)) out.effect_list = a.effect_list;
    return out;
  }
  protected stateAttributes() {
    const a = this.attributes, on = this.state === 'on', mode = on ? a.color_mode ?? null : null;
    const temp = mode === 'color_temp';
    const out: Attributes = {
      color_mode: mode, brightness: on ? a.brightness ?? null : null,
      color_temp_kelvin: temp ? a.color_temp_kelvin ?? null : null, color_temp: temp ? a.color_temp ?? null : null,
      hs_color: on ? a.hs_color ?? null : null, rgb_color: on ? a.rgb_color ?? null : null, xy_color: on ? a.xy_color ?? null : null,
    };
    if (a.rgbw_color !== undefined) out.rgbw_color = on ? a.rgbw_color : null;
    if (a.rgbww_color !== undefined) out.rgbww_color = on ? a.rgbww_color : null;
    if (supports(a, Light.EFFECT)) out.effect = on ? a.effect ?? null : null;
    return out;
  }
}

const HVAC_MODE_TO_ACTION: Record<string, string> = { cool: 'cooling', dry: 'drying', fan_only: 'fan', heat: 'heating' };

class MockClimateEntity extends MockEntity {
  async handleService(domain: string, service: string, data: Attributes) {
    if (!['homeassistant', this.domain].includes(domain)) return;
    const modes: string[] = this.attributes.hvac_modes ?? [];
    switch (service) {
      case 'turn_on': this.update({ state: modes.find((m) => m !== 'off') ?? 'heat' }); break;
      case 'turn_off': this.update({ state: 'off' }); break;
      case 'toggle': await this.handleService(domain, this.state === 'off' ? 'turn_on' : 'turn_off', data); break;
      case 'set_hvac_mode': this.update({ state: data.hvac_mode }); break;
      case 'set_temperature': {
        const attrs: Attributes = {};
        for (const k of ['temperature', 'target_temp_high', 'target_temp_low']) if (data[k] !== undefined) attrs[k] = data[k];
        this.update({ state: data.hvac_mode, attributes: attrs });
        break;
      }
      case 'set_humidity': this.update({ attributes: { humidity: data.humidity } }); break;
      case 'set_fan_mode': this.update({ attributes: { fan_mode: data.fan_mode } }); break;
      case 'set_preset_mode': this.update({ attributes: { preset_mode: data.preset_mode } }); break;
      case 'set_swing_mode': this.update({ attributes: { swing_mode: data.swing_mode } }); break;
      case 'set_swing_horizontal_mode': this.update({ attributes: { swing_horizontal_mode: data.swing_horizontal_mode } }); break;
      case 'set_aux_heat': this.update({ attributes: { aux_heat: data.aux_heat } }); break;
    }
  }
  protected capabilityAttributes() {
    const a = this.attributes;
    const out: Attributes = { hvac_modes: a.hvac_modes, min_temp: a.min_temp, max_temp: a.max_temp };
    if (a.target_temp_step !== undefined) out.target_temp_step = a.target_temp_step;
    if (supports(a, Climate.FAN_MODE)) out.fan_modes = a.fan_modes;
    if (supports(a, Climate.PRESET_MODE)) out.preset_modes = a.preset_modes;
    if (supports(a, Climate.SWING_MODE)) out.swing_modes = a.swing_modes;
    if (supports(a, Climate.SWING_HORIZONTAL_MODE)) out.swing_horizontal_modes = a.swing_horizontal_modes;
    if (supports(a, Climate.TARGET_HUMIDITY)) {
      out.min_humidity = a.min_humidity; out.max_humidity = a.max_humidity;
      if (a.target_humidity_step !== undefined) out.target_humidity_step = a.target_humidity_step;
    }
    return out;
  }
  protected stateAttributes() {
    const a = this.attributes, off = this.state === 'off';
    const unlessOff = (k: string) => off ? null : a[k] ?? null;
    const out: Attributes = { current_temperature: a.current_temperature ?? null, hvac_action: off ? 'off' : this.hvacAction() };
    if (supports(a, Climate.TARGET_TEMPERATURE)) out.temperature = unlessOff('temperature');
    if (supports(a, Climate.TARGET_TEMPERATURE_RANGE)) { out.target_temp_high = unlessOff('target_temp_high'); out.target_temp_low = unlessOff('target_temp_low'); }
    if (supports(a, Climate.TARGET_HUMIDITY)) { out.humidity = unlessOff('humidity'); out.current_humidity = a.current_humidity ?? null; }
    if (supports(a, Climate.FAN_MODE)) out.fan_mode = unlessOff('fan_mode');
    if (supports(a, Climate.PRESET_MODE)) out.preset_mode = unlessOff('preset_mode');
    if (supports(a, Climate.SWING_MODE)) out.swing_mode = unlessOff('swing_mode');
    if (supports(a, Climate.SWING_HORIZONTAL_MODE)) out.swing_horizontal_mode = unlessOff('swing_horizontal_mode');
    if (supports(a, Climate.AUX_HEAT)) out.aux_heat = unlessOff('aux_heat');
    return out;
  }
  private hvacAction() {
    const a = this.attributes, cur = a.current_temperature;
    const direct = HVAC_MODE_TO_ACTION[this.state];
    if (direct) {
      if (this.state === 'heat' && cur != null && a.temperature != null) return a.temperature > cur ? 'heating' : 'idle';
      if (this.state === 'cool' && cur != null && a.temperature != null) return a.temperature < cur ? 'cooling' : 'idle';
      return direct;
    }
    if (supports(a, Climate.TARGET_TEMPERATURE_RANGE) && cur != null) {
      if (a.target_temp_low != null && a.target_temp_low > cur) return 'heating';
      if (a.target_temp_high != null && a.target_temp_high < cur) return 'cooling';
    }
    return 'idle';
  }
}

const COVER_STEP_MS = 400, COVER_STEP = 10;

class MockCoverEntity extends MockEntity {
  private mover?: ReturnType<typeof setInterval>;
  async handleService(domain: string, service: string, data: Attributes) {
    if (domain !== this.domain) return;
    switch (service) {
      case 'open_cover': this.moveTo(100); break;
      case 'close_cover': this.moveTo(0); break;
      case 'toggle': this.moveTo(['open', 'opening'].includes(this.state) ? 0 : 100); break;
      case 'stop_cover': this.stop(); break;
      case 'set_cover_position': this.moveTo(data.position); break;
      case 'open_cover_tilt': this.update({ attributes: { current_tilt_position: 100 } }); break;
      case 'close_cover_tilt': this.update({ attributes: { current_tilt_position: 0 } }); break;
      case 'set_cover_tilt_position': this.update({ attributes: { current_tilt_position: data.tilt_position } }); break;
      case 'toggle_cover_tilt': this.update({ attributes: { current_tilt_position: (this.attributes.current_tilt_position ?? 0) > 0 ? 0 : 100 } }); break;
    }
  }
  private moveTo(target: number) {
    this.stop();
    if (!supports(this.attributes, Cover.SET_POSITION)) { this.update({ state: target > 0 ? 'open' : 'closed' }); return; }
    const from = this.attributes.current_position ?? 0;
    if (from === target) return;
    const dir = target > from ? 1 : -1;
    this.update({ state: dir > 0 ? 'opening' : 'closing' });
    this.mover = setInterval(() => {
      const next = (this.attributes.current_position ?? 0) + COVER_STEP * dir;
      if (dir > 0 ? next >= target : next <= target) {
        clearInterval(this.mover); this.mover = undefined;
        this.update({ state: target > 0 ? 'open' : 'closed', attributes: { current_position: target } });
      } else this.update({ attributes: { current_position: next } });
    }, COVER_STEP_MS);
  }
  private stop() {
    if (this.mover) { clearInterval(this.mover); this.mover = undefined; }
    if (['opening', 'closing'].includes(this.state)) this.update({ state: (this.attributes.current_position ?? 0) > 0 ? 'open' : 'closed' });
  }
  dispose() { if (this.mover) clearInterval(this.mover); super.dispose(); }
  protected stateAttributes() {
    const a = this.attributes, out: Attributes = {};
    if (supports(a, Cover.SET_POSITION)) out.current_position = a.current_position ?? null;
    if (supports(a, Cover.SET_TILT_POSITION)) out.current_tilt_position = a.current_tilt_position ?? null;
    return out;
  }
}

class MockLockEntity extends MockEntity {
  async handleService(domain: string, service: string) {
    if (domain !== this.domain) return;
    this.clearTransition();
    if (service === 'lock') this.transition('locking', 'locked', 1000);
    else if (service === 'unlock') this.transition('unlocking', 'unlocked', 1000);
    else if (service === 'open') this.transition('opening', 'open', 1000, () => this.transition('locking', 'unlocked', 1000));
  }
  protected capabilityAttributes() { return this.attributes.code_format !== undefined ? { code_format: this.attributes.code_format } : {}; }
  protected stateAttributes() { return { changed_by: this.attributes.changed_by ?? null }; }
}

const MEDIA_STATE_KEYS = [
  'media_content_type', 'media_title', 'media_artist', 'media_album_name', 'media_series_title', 'media_duration',
  'media_position', 'media_position_updated_at', 'app_name', 'volume_level', 'is_volume_muted', 'sound_mode', 'source', 'group_members',
];

class MockMediaPlayerEntity extends MockEntity {
  async handleService(domain: string, service: string, data: Attributes) {
    if (domain !== this.domain) return;
    switch (service) {
      case 'media_play_pause': this.update({ state: this.state === 'playing' ? 'paused' : 'playing' }); break;
      case 'media_play': this.update({ state: 'playing' }); break;
      case 'media_pause': this.update({ state: 'paused' }); break;
      case 'media_stop': this.update({ state: 'idle' }); break;
      case 'turn_on': this.update({ state: 'on' }); break;
      case 'turn_off': this.update({ state: 'off' }); break;
      case 'volume_set': this.update({ attributes: { volume_level: data.volume_level } }); break;
      case 'volume_mute': this.update({ attributes: { is_volume_muted: data.is_volume_muted } }); break;
      case 'select_source': this.update({ attributes: { source: data.source } }); break;
    }
  }
  protected capabilityAttributes() {
    const a = this.attributes, out: Attributes = {};
    if (a.source_list !== undefined) out.source_list = a.source_list;
    if (a.sound_mode_list !== undefined) out.sound_mode_list = a.sound_mode_list;
    return out;
  }
  protected stateAttributes() {
    const a = this.attributes, off = this.state === 'off', out: Attributes = {};
    for (const key of MEDIA_STATE_KEYS) if (a[key] !== undefined) out[key] = off ? null : a[key];
    return out;
  }
}

const ARM: Record<string, string> = {
  alarm_arm_home: 'armed_home', alarm_arm_away: 'armed_away', alarm_arm_night: 'armed_night',
  alarm_arm_vacation: 'armed_vacation', alarm_arm_custom_bypass: 'armed_custom_bypass',
};

// The demo's code, when a panel has a `code_format`: the same as the manual
// alarm of Home Assistant's own demo integration.
export const DEMO_CODE = '1234';

class MockAlarmEntity extends MockEntity {
  async handleService(domain: string, service: string, data: Attributes) {
    if (domain !== this.domain) return;
    // A panel with a code refuses the wrong one the way Home Assistant does: the service fails.
    const asks = !!this.attributes.code_format && (service === 'alarm_disarm' || (service in ARM && this.attributes.code_arm_required !== false));
    if (asks && data.code !== DEMO_CODE) throw new Error('Invalid alarm code provided');
    this.clearTransition();
    if (service in ARM) this.transition('arming', ARM[service], 1000);
    else if (service === 'alarm_disarm') this.update({ state: 'disarmed' });
    else if (service === 'alarm_trigger') this.transition('pending', 'triggered', 1000);
  }
  protected capabilityAttributes() {
    const a = this.attributes, out: Attributes = {};
    if (a.code_format !== undefined) out.code_format = a.code_format;
    if (a.code_arm_required !== undefined) out.code_arm_required = a.code_arm_required;
    return out;
  }
  protected stateAttributes() { return { changed_by: this.attributes.changed_by ?? null }; }
}

class MockFanEntity extends MockEntity {
  async handleService(domain: string, service: string, data: Attributes) {
    if (!['homeassistant', this.domain].includes(domain)) return;
    switch (service) {
      case 'turn_on': {
        const attrs: Attributes = {};
        if (data.percentage !== undefined) attrs.percentage = data.percentage;
        if (data.preset_mode !== undefined) attrs.preset_mode = data.preset_mode;
        this.update({ state: 'on', attributes: attrs });
        break;
      }
      case 'turn_off': this.update({ state: 'off' }); break;
      case 'toggle': await this.handleService(domain, this.state === 'on' ? 'turn_off' : 'turn_on', data); break;
      case 'set_percentage': this.update({ state: data.percentage > 0 ? 'on' : 'off', attributes: { percentage: data.percentage } }); break;
      case 'set_preset_mode': this.update({ state: 'on', attributes: { preset_mode: data.preset_mode } }); break;
      case 'set_direction': this.update({ attributes: { direction: data.direction } }); break;
      case 'oscillate': this.update({ attributes: { oscillating: data.oscillating } }); break;
    }
  }
  protected capabilityAttributes() {
    const a = this.attributes, out: Attributes = {};
    if (supports(a, Fan.SET_SPEED) && a.percentage_step !== undefined) out.percentage_step = a.percentage_step;
    if (supports(a, Fan.PRESET_MODE)) out.preset_modes = a.preset_modes;
    return out;
  }
  protected stateAttributes() {
    const a = this.attributes, off = this.state === 'off', out: Attributes = {};
    if (supports(a, Fan.SET_SPEED)) out.percentage = off ? null : a.percentage ?? null;
    if (supports(a, Fan.OSCILLATE)) out.oscillating = off ? null : a.oscillating ?? null;
    if (supports(a, Fan.DIRECTION)) out.direction = off ? null : a.direction ?? null;
    if (supports(a, Fan.PRESET_MODE)) out.preset_mode = off ? null : a.preset_mode ?? null;
    return out;
  }
}

class MockVacuumEntity extends MockEntity {
  async handleService(domain: string, service: string, data: Attributes) {
    if (domain !== this.domain) return;
    this.clearTransition();
    switch (service) {
      case 'start': case 'clean_spot': this.update({ state: 'cleaning' }); break;
      case 'pause': this.update({ state: 'paused' }); break;
      case 'stop': this.update({ state: 'idle' }); break;
      case 'return_to_base': this.transition('returning', 'docked', 3000); break;
      case 'set_fan_speed': this.update({ attributes: { fan_speed: data.fan_speed } }); break;
    }
  }
  protected capabilityAttributes() { return supports(this.attributes, Vacuum.FAN_SPEED) ? { fan_speed_list: this.attributes.fan_speed_list } : {}; }
  protected stateAttributes() {
    const a = this.attributes, out: Attributes = {};
    if (supports(a, Vacuum.FAN_SPEED)) out.fan_speed = a.fan_speed ?? null;
    if (supports(a, Vacuum.STATUS)) out.status = a.status ?? null;
    return out;
  }
}

class MockValveEntity extends MockEntity {
  async handleService(domain: string, service: string, data: Attributes) {
    if (domain !== this.domain) return;
    switch (service) {
      case 'open_valve': this.update({ state: 'open', attributes: { current_position: 100 } }); break;
      case 'close_valve': this.update({ state: 'closed', attributes: { current_position: 0 } }); break;
      case 'toggle': await this.handleService(domain, this.state === 'open' ? 'close_valve' : 'open_valve', data); break;
      case 'set_valve_position': this.update({ state: data.position > 0 ? 'open' : 'closed', attributes: { current_position: data.position } }); break;
    }
  }
  protected stateAttributes() { return supports(this.attributes, Valve.SET_POSITION) ? { current_position: this.attributes.current_position ?? null } : {}; }
}

class MockWaterHeaterEntity extends MockEntity {
  async handleService(domain: string, service: string, data: Attributes) {
    if (!['homeassistant', this.domain].includes(domain)) return;
    const list: string[] = this.attributes.operation_list ?? [];
    switch (service) {
      case 'turn_on': this.update({ state: list.find((m) => m !== 'off') ?? 'eco' }); break;
      case 'turn_off': this.update({ state: 'off' }); break;
      case 'toggle': await this.handleService(domain, this.state === 'off' ? 'turn_on' : 'turn_off', data); break;
      case 'set_operation_mode': this.update({ state: data.operation_mode }); break;
      case 'set_temperature': this.update({ state: data.operation_mode, attributes: data.temperature !== undefined ? { temperature: data.temperature } : {} }); break;
      case 'set_away_mode': this.update({ attributes: { away_mode: data.away_mode } }); break;
    }
  }
  protected capabilityAttributes() {
    const a = this.attributes, out: Attributes = { min_temp: a.min_temp, max_temp: a.max_temp };
    if (a.target_temp_step !== undefined) out.target_temp_step = a.target_temp_step;
    if (supports(a, WaterHeater.OPERATION_MODE)) out.operation_list = a.operation_list;
    return out;
  }
  protected stateAttributes() {
    const a = this.attributes, off = this.state === 'off', out: Attributes = { current_temperature: a.current_temperature ?? null };
    if (supports(a, WaterHeater.TARGET_TEMPERATURE)) out.temperature = off ? null : a.temperature ?? null;
    if (supports(a, WaterHeater.OPERATION_MODE)) out.operation_mode = a.operation_mode ?? null;
    if (supports(a, WaterHeater.AWAY_MODE)) out.away_mode = off ? null : a.away_mode ?? null;
    return out;
  }
}

class MockHumidifierEntity extends MockEntity {
  async handleService(domain: string, service: string, data: Attributes) {
    if (!['homeassistant', this.domain].includes(domain)) return;
    switch (service) {
      case 'turn_on': this.update({ state: 'on' }); break;
      case 'turn_off': this.update({ state: 'off' }); break;
      case 'toggle': await this.handleService(domain, this.state === 'on' ? 'turn_off' : 'turn_on', data); break;
      case 'set_humidity': this.update({ attributes: { humidity: data.humidity } }); break;
      case 'set_mode': this.update({ attributes: { mode: data.mode } }); break;
    }
  }
  protected capabilityAttributes() {
    const a = this.attributes, out: Attributes = {};
    for (const k of ['min_humidity', 'max_humidity', 'target_humidity_step']) if (a[k] !== undefined) out[k] = a[k];
    if (supports(a, Humidifier.MODES)) out.available_modes = a.available_modes;
    return out;
  }
  protected stateAttributes() {
    const a = this.attributes, off = this.state === 'off';
    const out: Attributes = { current_humidity: a.current_humidity ?? null, humidity: off ? null : a.humidity ?? null, action: off ? 'off' : this.action() };
    if (supports(a, Humidifier.MODES)) out.mode = off ? null : a.mode ?? null;
    return out;
  }
  private action() {
    const a = this.attributes;
    if (a.current_humidity != null && a.humidity != null) {
      if (a.device_class === 'dehumidifier') return a.current_humidity > a.humidity ? 'drying' : 'idle';
      return a.current_humidity < a.humidity ? 'humidifying' : 'idle';
    }
    return ['drying', 'humidifying'].includes(a.action) ? a.action : 'idle';
  }
}

// Pulse's addition: an update that installs over a few seconds, with progress.
class MockUpdateEntity extends MockEntity {
  private ticker?: ReturnType<typeof setInterval>;
  async handleService(domain: string, service: string) {
    if (domain !== this.domain) return;
    if (service === 'skip') this.update({ state: 'off', attributes: { skipped_version: this.attributes.latest_version } });
    if (service !== 'install' || this.state !== 'on' || !supports(this.attributes, Update.INSTALL)) return;
    const progress = supports(this.attributes, Update.PROGRESS);
    this.update({ attributes: { in_progress: true, update_percentage: progress ? 0 : null } });
    let pct = 0;
    this.ticker = setInterval(() => {
      pct += 20;
      if (pct < 100) { if (progress) this.update({ attributes: { update_percentage: pct } }); return; }
      clearInterval(this.ticker); this.ticker = undefined;
      this.update({ state: 'off', attributes: { in_progress: false, update_percentage: null, installed_version: this.attributes.latest_version } });
    }, 600);
  }
  dispose() { if (this.ticker) clearInterval(this.ticker); super.dispose(); }
  protected stateAttributes() { return this.attributes; }
}

const TYPES: Record<string, new (input: EntityInput) => MockEntity> = {
  alarm_control_panel: MockAlarmEntity,
  climate: MockClimateEntity,
  cover: MockCoverEntity,
  fan: MockFanEntity,
  humidifier: MockHumidifierEntity,
  input_boolean: MockToggleEntity,
  light: MockLightEntity,
  lock: MockLockEntity,
  media_player: MockMediaPlayerEntity,
  scene: MockSceneEntity,
  siren: MockToggleEntity,
  switch: MockToggleEntity,
  update: MockUpdateEntity,
  vacuum: MockVacuumEntity,
  valve: MockValveEntity,
  water_heater: MockWaterHeaterEntity,
};

export const getEntity = (input: EntityInput): MockEntity => {
  const domain = input.entity_id.split('.', 1)[0];
  return new (TYPES[domain] ?? MockPassiveEntity)(input);
};

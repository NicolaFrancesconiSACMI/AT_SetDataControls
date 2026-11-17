/*
 * StringVisData
 *
 * Read-only text readout: Text on the left, the shown string in a tinted box on the right, no editing.
 *
 * - Mode picks what is shown:
 *     - String: the String attribute (a STRING symbol). Limits: list of { value, sign (= | !=), color,
 *       customColor, flashing }; the first one whose condition holds colours the string (and can make it blink).
 *       Compared case-insensitive and trimmed.
 *     - StateToString: the Value attribute (a number, BOOL as 1 / 0) translated into a text, like a read-only
 *       combobox. States: list of { value, sign (= != > < >= <=), text, color, customColor, flashing }; the first
 *       one whose condition holds shows its text (the number itself when the text is empty) in its colour.
 *       No match: the number in the theme colour.
 *   The list order is the priority: put the most severe entry on top.
 *   An entry may contain symbol expressions (a bound value, a localized text): the control watches each list
 *   with an ObjectResolver while attached.
 * - Layout: same as StringSetData. StringWidth sets the value box, Text takes TextWidth (aligned by TextAlignment);
 *   the box is centred vertically and placed by ValueAlignment in the remaining width.
 * - Colours are picked by name, as in NumericVisData: Default (no change, theme value colour), Red, Blue, Green,
 *   Orange (per-theme shades, Themes/<Theme>/Style.css) or Custom (customColor).
 */
module TcHmi {
    export module Controls {
        export module SetDataFramework {

            type LimitSign = '=' | '!=';
            type StateSign = '=' | '!=' | '>' | '<' | '>=' | '<=';

            interface LimitValue {
                value: string;
                sign: LimitSign;
                color: string | null; // null = Default: the string keeps the theme colour
                flashing: boolean;
            }

            interface StateValue {
                value: number;
                sign: StateSign;
                text: string;
                color: string | null; // null = Default: the text keeps the theme colour
                flashing: boolean;
            }

            // Named colours -> per-theme variables (Themes/<Theme>/Style.css).
            const NAMED_COLORS: { [name: string]: string } = {
                Red: 'var(--sdf-svd-red)',
                Blue: 'var(--sdf-svd-blue)',
                Green: 'var(--sdf-svd-green)',
                Orange: 'var(--sdf-svd-orange)'
            };

            // Colour name (+ custom SolidColor) -> CSS colour; null = Default (no change).
            // Custom without a usable colour counts as Default.
            function colorOf(name: any, custom: any): string | null {
                if (name === 'Custom') {
                    return custom && TcHmi.isSolidColor(custom) ? custom.color : null;
                }
                return typeof name === 'string' && NAMED_COLORS.hasOwnProperty(name) ? NAMED_COLORS[name] : null;
            }

            // Width between text and value box; same as --sdf-svd-gap (Style.css).
            const BOX_GAP = 4;

            // HorizontalAlignment -> flex justify-content.
            function flexAlign(alignment: string | undefined) {
                return alignment === 'Center' ? 'center' : alignment === 'Right' ? 'flex-end' : 'flex-start';
            }

            /* ---------- flashing ---------- */

            const FLASH_PERIOD = 800; // ms, one on + off cycle; same in LedVisData and NumericVisData

            // One blink clock for the page, shared with LedVisData and NumericVisData (same global, any file may
            // start it): it toggles 'sdf-flash-off' on <html>, so every flashing control is in phase, also after
            // hide / show. Stops by itself when nothing flashes any more.
            function startFlashClock() {
                const w = window as any;
                if (w.__sdfFlashClock) {
                    return;
                }
                const html = document.documentElement;
                w.__sdfFlashClock = setInterval(() => {
                    if (!document.querySelector('.sdf-led-flashing, .sdf-nvd-limit-flashing, .sdf-svd-limit-flashing')) {
                        clearInterval(w.__sdfFlashClock);
                        w.__sdfFlashClock = null;
                        html.classList.remove('sdf-flash-off');
                        return;
                    }
                    html.classList.toggle('sdf-flash-off');
                }, FLASH_PERIOD / 2);
            }

            /* ---------- Limits (String mode) ---------- */

            function trimmed(value: any) {
                return value === null || value === undefined ? '' : String(value).trim();
            }

            // Case-insensitive, trimmed.
            function matchesLimit(value: string, limit: LimitValue) {
                const equal = value.toLowerCase() === limit.value.toLowerCase();
                return limit.sign === '!=' ? !equal : equal;
            }

            // Entries without a value are skipped; an empty string is a valid value (matches an empty String).
            // A Default entry still counts (first match wins).
            function toLimitValues(value: any): LimitValue[] {
                const res: LimitValue[] = [];
                if (!Array.isArray(value)) {
                    return res;
                }
                for (const entry of value) {
                    if (!entry || typeof entry !== 'object' || entry.value === null || entry.value === undefined) {
                        continue;
                    }
                    res.push({
                        value: trimmed(entry.value),
                        sign: entry.sign === '!=' ? '!=' : '=',
                        color: colorOf(entry.color, entry.customColor),
                        flashing: !!entry.flashing
                    });
                }
                return res;
            }

            /* ---------- States (StateToString mode) ---------- */

            // BOOL as 1 / 0, so a BOOL symbol works with states 1 and 0.
            function toValue(value: any): number | null {
                if (typeof value === 'boolean') {
                    return value ? 1 : 0;
                }
                return TcHmi.ValueConverter.toNumber(value);
            }

            function compare(value: number, sign: StateSign, limit: number) {
                switch (sign) {
                    case '=': return value === limit;
                    case '!=': return value !== limit;
                    case '>': return value > limit;
                    case '<': return value < limit;
                    case '>=': return value >= limit;
                    case '<=': return value <= limit;
                }
            }

            // Entries without a usable number or sign are skipped. A Default entry still counts (first match wins).
            function toStateValues(value: any): StateValue[] {
                const res: StateValue[] = [];
                if (!Array.isArray(value)) {
                    return res;
                }
                for (const entry of value) {
                    if (!entry || typeof entry !== 'object') {
                        continue;
                    }
                    const number = entry.value === null || entry.value === '' ? NaN : Number(entry.value);
                    const sign = entry.sign === undefined || entry.sign === null ? '=' : entry.sign;
                    if (!isFinite(number) || ['=', '!=', '>', '<', '>=', '<='].indexOf(sign) < 0) {
                        continue;
                    }
                    res.push({
                        value: number,
                        sign: sign,
                        text: entry.text === null || entry.text === undefined ? '' : String(entry.text),
                        color: colorOf(entry.color, entry.customColor),
                        flashing: !!entry.flashing
                    });
                }
                return res;
            }

            // Strip float noise (0.1 + 0.2 -> 0.3), as NumericVisData without Decimals.
            function formatNumber(value: number) {
                return String(Number(value.toPrecision(15)));
            }

            /* ---------- control ---------- */

            export class StringVisData extends TcHmi.Controls.System.TcHmiControl {

                /*
                Attribute philosophy
                --------------------
                - Local variables are not set while definition in class, so they have the value 'undefined'.
                - On compile the Framework sets the value from HTML or from theme (possibly 'null') via normal setters.
                - The "changed detection" in the setter will result in processing the value only once while compile.
                - Attention: If we have a Server Binding on an Attribute the setter will be called once with null to initialize and later with the correct value.
                */

                constructor(element: JQuery, pcElement: JQuery, attrs: TcHmi.Controls.ControlAttributeList) {
                    super(element, pcElement, attrs);
                }

                protected __elementTemplateRoot!: JQuery;
                protected __elementText!: HTMLElement;
                protected __elementSlot!: HTMLElement;
                protected __elementValueBox!: HTMLElement;
                protected __elementValue!: HTMLElement;

                protected __mode: string | undefined;
                protected __string: string | undefined;
                protected __value: number | null | undefined;
                protected __hide: boolean | undefined;
                protected __text: string | undefined;
                protected __stringWidth: number | null | undefined;
                protected __stringWidthUnit: string | undefined;
                protected __textWidth: number | null | undefined;
                protected __textWidthUnit: string | undefined;
                protected __textAlignment: string | undefined;
                protected __valueAlignment: string | undefined;
                protected __limits: any[] | undefined;
                protected __limitValues: LimitValue[] = [];
                protected __limitsResolver: TcHmi.Symbol.ObjectResolver<any[]> | null = null;
                protected __destroyLimitsWatch: TcHmi.DestroyFunction | null = null;
                protected __states: any[] | undefined;
                protected __stateValues: StateValue[] = [];
                protected __statesResolver: TcHmi.Symbol.ObjectResolver<any[]> | null = null;
                protected __destroyStatesWatch: TcHmi.DestroyFunction | null = null;
                protected __attached = false;

                public __previnit() {
                    this.__elementTemplateRoot = this.__element.find('.TcHmi_Controls_SetDataFramework_StringVisData-Template');
                    if (this.__elementTemplateRoot.length === 0) {
                        throw new Error('Invalid Template.html');
                    }
                    const root = this.__elementTemplateRoot[0];
                    this.__elementText = root.querySelector('.sdf-svd-text') as HTMLElement;
                    this.__elementSlot = root.querySelector('.sdf-svd-slot') as HTMLElement;
                    this.__elementValueBox = root.querySelector('.sdf-svd-valuebox') as HTMLElement;
                    this.__elementValue = root.querySelector('.sdf-svd-value') as HTMLElement;
                    super.__previnit();
                }

                public __init() {
                    super.__init();
                }

                public __attach() {
                    super.__attach();
                    this.__attached = true;
                    this.__watchLimits();
                    this.__watchStates();
                }

                public __detach() {
                    super.__detach();
                    this.__attached = false;
                    this.__unwatchLimits();
                    this.__unwatchStates();
                }

                public destroy() {
                    if (this.__keepAlive) {
                        return;
                    }
                    this.__unwatchLimits();
                    this.__unwatchStates();
                    super.destroy();
                }

                /* ---------- Mode ---------- */

                public setMode(valueNew: string | null) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('Mode');
                    }
                    if (convertedValue === this.__mode) {
                        return;
                    }
                    this.__mode = convertedValue === 'StateToString' ? 'StateToString' : 'String';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'Mode' });
                    this.__processShown();
                }

                public getMode() {
                    return this.__mode;
                }

                /* ---------- String ---------- */

                public setString(valueNew: string | null) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('String');
                    }
                    if (convertedValue === this.__string) {
                        return;
                    }
                    this.__string = convertedValue || '';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'String' });
                    this.__processShown();
                }

                public getString() {
                    return this.__string;
                }

                /* ---------- Value ---------- */

                public setValue(valueNew: number | null) {
                    let convertedValue = toValue(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('Value');
                    }
                    if (convertedValue === this.__value) {
                        return;
                    }
                    this.__value = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'Value' });
                    this.__processShown();
                }

                public getValue() {
                    return this.__value;
                }

                /* ---------- Limits ---------- */

                public setLimits(valueNew: any[] | null) {
                    const convertedValue = Array.isArray(valueNew) ? valueNew : [];
                    this.__limits = convertedValue;
                    // Until the watch delivers, symbol expressions are compared as written.
                    this.__limitValues = toLimitValues(convertedValue);
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'Limits' });
                    this.__processShown();
                    if (this.__attached) {
                        this.__watchLimits();
                    }
                }

                public getLimits() {
                    return this.__limits;
                }

                // allowSymbolExpressionsInObject only lets the editor accept %s%...%/s% inside the list:
                // the control resolves them itself and re-evaluates on every change.
                protected __watchLimits() {
                    this.__unwatchLimits();
                    const limits = this.__limits || [];
                    if (!limits.length) {
                        return;
                    }
                    const resolver = this.__limitsResolver = new TcHmi.Symbol.ObjectResolver(limits, this);
                    this.__destroyLimitsWatch = resolver.watch(data => {
                        if (resolver !== this.__limitsResolver) {
                            return;
                        }
                        if (data.error !== TcHmi.Errors.NONE) {
                            TcHmi.Log.errorEx('[StringVisData] ' + this.__id + ': Limits could not be resolved: ' +
                                (data.details && data.details.reason ? data.details.reason : data.error));
                            return;
                        }
                        this.__limitValues = toLimitValues(data.value);
                        this.__processShown();
                    });
                }

                protected __unwatchLimits() {
                    if (this.__destroyLimitsWatch) {
                        this.__destroyLimitsWatch();
                        this.__destroyLimitsWatch = null;
                    }
                    if (this.__limitsResolver) {
                        this.__limitsResolver.destroy();
                        this.__limitsResolver = null;
                    }
                }

                /* ---------- States ---------- */

                public setStates(valueNew: any[] | null) {
                    const convertedValue = Array.isArray(valueNew) ? valueNew : [];
                    this.__states = convertedValue;
                    // Until the watch delivers, entries with a symbol expression as value are skipped (NaN).
                    this.__stateValues = toStateValues(convertedValue);
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'States' });
                    this.__processShown();
                    if (this.__attached) {
                        this.__watchStates();
                    }
                }

                public getStates() {
                    return this.__states;
                }

                // Same as __watchLimits; texts may be localized (%l%...%/l%).
                protected __watchStates() {
                    this.__unwatchStates();
                    const states = this.__states || [];
                    if (!states.length) {
                        return;
                    }
                    const resolver = this.__statesResolver = new TcHmi.Symbol.ObjectResolver(states, this);
                    this.__destroyStatesWatch = resolver.watch(data => {
                        if (resolver !== this.__statesResolver) {
                            return;
                        }
                        if (data.error !== TcHmi.Errors.NONE) {
                            TcHmi.Log.errorEx('[StringVisData] ' + this.__id + ': States could not be resolved: ' +
                                (data.details && data.details.reason ? data.details.reason : data.error));
                            return;
                        }
                        this.__stateValues = toStateValues(data.value);
                        this.__processShown();
                    });
                }

                protected __unwatchStates() {
                    if (this.__destroyStatesWatch) {
                        this.__destroyStatesWatch();
                        this.__destroyStatesWatch = null;
                    }
                    if (this.__statesResolver) {
                        this.__statesResolver.destroy();
                        this.__statesResolver = null;
                    }
                }

                /* ---------- shown text + colour ---------- */

                // String mode: String, coloured by the first matching limit.
                // StateToString mode: the first matching state's text (or the number), in its colour;
                // no match: the number. Nothing to show (no value, empty string): '-'.
                // A Default entry (no colour) leaves the colour as it is, flashing included.
                protected __processShown() {
                    let shown = '';
                    let color: string | null = null;
                    let flashing = false;
                    if (this.__mode === 'StateToString') {
                        const value = this.__value;
                        if (value !== null && value !== undefined && isFinite(value)) {
                            shown = formatNumber(value);
                            for (const state of this.__stateValues) {
                                if (compare(value, state.sign, state.value)) {
                                    shown = state.text || shown;
                                    color = state.color;
                                    flashing = state.flashing;
                                    break;
                                }
                            }
                        }
                    } else {
                        shown = this.__string || '';
                        const key = shown.trim();
                        for (const limit of this.__limitValues) {
                            if (matchesLimit(key, limit)) {
                                color = limit.color;
                                flashing = limit.flashing;
                                break;
                            }
                        }
                    }
                    this.__elementValue.textContent = shown === '' ? '-' : shown; // '-' = no value, as in the other controls
                    const root = this.__elementTemplateRoot[0];
                    if (color !== null) {
                        root.style.setProperty('--sdf-svd-limit-color', color);
                    } else {
                        root.style.removeProperty('--sdf-svd-limit-color');
                    }
                    root.classList.toggle('sdf-svd-limit-active', color !== null);
                    flashing = color !== null && flashing;
                    root.classList.toggle('sdf-svd-limit-flashing', flashing);
                    if (flashing) {
                        startFlashClock();
                    }
                }

                /* ---------- Hide ---------- */

                public setHide(valueNew: boolean | null) {
                    let convertedValue = TcHmi.ValueConverter.toBoolean(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('Hide');
                    }
                    if (convertedValue === this.__hide) {
                        return;
                    }
                    this.__hide = !!convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'Hide' });
                    // Collapsed: a class on the control element (Style.css), so the Visibility attribute stays untouched.
                    this.__element.toggleClass('sdf-svd-hidden', !!this.__hide);
                }

                public getHide() {
                    return this.__hide;
                }

                /* ---------- Text ---------- */

                public setText(valueNew: string | null) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('Text');
                    }
                    if (convertedValue === this.__text) {
                        return;
                    }
                    this.__text = convertedValue || '';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'Text' });
                    this.__elementText.textContent = this.__text;
                }

                public getText() {
                    return this.__text;
                }

                /* ---------- StringWidth / StringWidthUnit ---------- */

                public setStringWidth(valueNew: number | null) {
                    let convertedValue = TcHmi.ValueConverter.toNumber(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('StringWidth');
                    }
                    if (convertedValue === this.__stringWidth) {
                        return;
                    }
                    this.__stringWidth = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'StringWidth' });
                    this.__processWidths();
                }

                public getStringWidth() {
                    return this.__stringWidth;
                }

                public setStringWidthUnit(valueNew: string | null) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('StringWidthUnit');
                    }
                    if (convertedValue === this.__stringWidthUnit) {
                        return;
                    }
                    this.__stringWidthUnit = convertedValue || 'px';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'StringWidthUnit' });
                    this.__processWidths();
                }

                public getStringWidthUnit() {
                    return this.__stringWidthUnit;
                }

                /* ---------- TextWidth / TextWidthUnit ---------- */

                public setTextWidth(valueNew: number | null) {
                    let convertedValue = TcHmi.ValueConverter.toNumber(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('TextWidth');
                    }
                    if (convertedValue === this.__textWidth) {
                        return;
                    }
                    this.__textWidth = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'TextWidth' });
                    this.__processWidths();
                }

                public getTextWidth() {
                    return this.__textWidth;
                }

                public setTextWidthUnit(valueNew: string | null) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('TextWidthUnit');
                    }
                    if (convertedValue === this.__textWidthUnit) {
                        return;
                    }
                    this.__textWidthUnit = convertedValue || 'px';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'TextWidthUnit' });
                    this.__processWidths();
                }

                public getTextWidthUnit() {
                    return this.__textWidthUnit;
                }

                // --sdf-svd-box-width = StringWidth (px, or % of the control width), read by the text width in %:
                // 100% = control width - box - gap, as in StringSetData.
                // The box itself sits in the slot, whose 100% is not the control width: with StringWidth in %
                // the box width is rewritten in slot terms (S = slot, W = control, p = StringWidth / 100):
                //   TextWidth T px: S = W - g - T                     -> box = p * (S + g + T)
                //   TextWidth f %:  S = W - g - f * (W - p * W - g)   -> box = p * (S + g * (1 - f)) / (1 - f + f * p)
                protected __processWidths() {
                    const root = this.__elementTemplateRoot[0];
                    const box = this.__elementValueBox.style;
                    const sw = this.__stringWidth;
                    const tw = this.__textWidth;
                    const hasText = tw !== null && tw !== undefined && isFinite(tw);
                    const textPercent = this.__textWidthUnit === '%';

                    if (sw === null || sw === undefined || !isFinite(sw) || sw < 0) {
                        root.style.removeProperty('--sdf-svd-box-width'); // CSS default: 180 px
                        box.width = box.flexBasis = '';
                    } else if (this.__stringWidthUnit === '%') {
                        const p = sw / 100;
                        root.style.setProperty('--sdf-svd-box-width', sw + '%');
                        let width = (p * 100) + '%'; // no TextWidth: share of the slot
                        if (hasText && !textPercent) {
                            width = 'calc((100% + ' + (BOX_GAP + tw!) + 'px) * ' + p + ')';
                        } else if (hasText) {
                            const f = tw! / 100;
                            const d = 1 - f + f * p;
                            if (d > 0) {
                                width = 'calc((100% + ' + BOX_GAP * (1 - f) + 'px) * ' + p / d + ')';
                            }
                        }
                        box.width = box.flexBasis = width;
                    } else {
                        root.style.setProperty('--sdf-svd-box-width', sw + 'px');
                        box.width = box.flexBasis = sw + 'px';
                    }

                    if (!hasText) {
                        this.__elementText.style.width = '';
                    } else if (textPercent) {
                        this.__elementText.style.width =
                            'calc((100% - var(--sdf-svd-box-width) - var(--sdf-svd-gap)) * ' + tw! / 100 + ')';
                    } else {
                        this.__elementText.style.width = tw + 'px';
                    }
                }

                /* ---------- TextAlignment ---------- */

                public setTextAlignment(valueNew: string | null) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('TextAlignment');
                    }
                    if (convertedValue === this.__textAlignment) {
                        return;
                    }
                    this.__textAlignment = convertedValue || 'Left';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'TextAlignment' });
                    this.__elementText.style.justifyContent = flexAlign(this.__textAlignment);
                    this.__elementText.style.textAlign = this.__textAlignment.toLowerCase();
                }

                public getTextAlignment() {
                    return this.__textAlignment;
                }

                /* ---------- ValueAlignment ---------- */

                public setValueAlignment(valueNew: string | null) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('ValueAlignment');
                    }
                    if (convertedValue === this.__valueAlignment) {
                        return;
                    }
                    this.__valueAlignment = convertedValue || 'Right';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'ValueAlignment' });
                    this.__elementSlot.style.justifyContent = flexAlign(this.__valueAlignment);
                }

                public getValueAlignment() {
                    return this.__valueAlignment;
                }
            }
        }
    }
}

TcHmi.Controls.registerEx('StringVisData', 'TcHmi.Controls.SetDataFramework', TcHmi.Controls.SetDataFramework.StringVisData);

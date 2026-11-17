/*
 * LedVisData
 *
 * Read-only round LED ("glass bulb", same look as the ButtonSetData ON bulb): Text on the left, LED on the right.
 *
 * - Value is bound to a BOOL or numeric symbol; TRUE/FALSE count as 1/0.
 * - Colours are picked by name: Grey, Red, Orange, Green or Custom (then customColor / DefaultCustomColor is used).
 *   Grey is the theme grey and always unlit (no glow, no blinking): "off".
 * - States: list of { value, sign, color, customColor, flashing }. The first entry whose condition holds
 *   (Value <sign> value) lights the LED in its colour; flashing makes it blink lit <-> unlit.
 *   The list order is the priority: put the most severe state on top.
 *   A state value may be bound to a symbol: the control watches it with an ObjectResolver while attached.
 * - No match (or no Value): the LED is unlit, in DefaultColor.
 * - Layout: Text takes TextWidth (aligned by TextAlignment); the LED (LedSize) is centred vertically and
 *   placed by LedAlignment in the remaining width. Around the bulb a margin holds the glow, so the light
 *   never leaves the control; LedSize + 2 x glow is the control's min width / height (no squeezed bulb).
 * - The bulb shades are worked out here from one colour, as in ButtonSetData (no color-mix() in CSS).
 */
var TcHmi;
(function (TcHmi) {
    let Controls;
    (function (Controls) {
        let SetDataFramework;
        (function (SetDataFramework) {
            const DEFAULT_SIZE = 30; // px, also in Style.css and Description.json
            const GLOW_RATIO = 0.3; // glow reach / bulb diameter; 30 px bulb -> 9 px glow, 48 px LED box
            const FLASH_PERIOD = 800; // ms, one on + off cycle; same in NumericVisData and StringVisData
            // One blink clock for the page, shared with NumericVisData and StringVisData (same global, any file may start it):
            // it toggles 'sdf-flash-off' on <html>, so every flashing control is in phase, also after hide / show.
            // Stops by itself when nothing flashes any more.
            function startFlashClock() {
                const w = window;
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
            // Fixed colours of the names; Grey (theme, unlit) and Custom (picked colour) are resolved in colorOf.
            const NAMED_COLORS = {
                Red: '#dc0000',
                Orange: '#f59e0b',
                Green: '#16a34a'
            };
            // Colour name (+ custom SolidColor) -> CSS colour; null = theme grey.
            // Custom without a usable colour falls back to grey.
            function colorOf(name, custom) {
                if (name === 'Custom') {
                    return custom && TcHmi.isSolidColor(custom) ? custom.color : null;
                }
                return typeof name === 'string' && NAMED_COLORS.hasOwnProperty(name) ? NAMED_COLORS[name] : null;
            }
            // HorizontalAlignment -> flex justify-content.
            function flexAlign(alignment) {
                return alignment === 'Center' ? 'center' : alignment === 'Right' ? 'flex-end' : 'flex-start';
            }
            /* ---------- states ---------- */
            function compare(value, sign, limit) {
                switch (sign) {
                    case '=': return value === limit;
                    case '>': return value > limit;
                    case '<': return value < limit;
                    case '>=': return value >= limit;
                    case '<=': return value <= limit;
                }
            }
            // BOOL symbols arrive as true/false.
            function toValue(value) {
                if (typeof value === 'boolean') {
                    return value ? 1 : 0;
                }
                return TcHmi.ValueConverter.toNumber(value);
            }
            // Entries without a usable value or sign are skipped; a missing sign means '='.
            function toStateValues(value) {
                const res = [];
                if (!Array.isArray(value)) {
                    return res;
                }
                for (const entry of value) {
                    if (!entry || typeof entry !== 'object') {
                        continue;
                    }
                    const limit = entry.value === null || entry.value === '' ? NaN : Number(toValue(entry.value));
                    const sign = entry.sign === undefined || entry.sign === null || entry.sign === '' ? '=' : entry.sign;
                    if (!isFinite(limit) || ['=', '>', '<', '>=', '<='].indexOf(sign) < 0) {
                        continue;
                    }
                    res.push({ value: limit, sign: sign, color: colorOf(entry.color, entry.customColor), flashing: !!entry.flashing });
                }
                return res;
            }
            let colorContext = null;
            // Any CSS colour (#hex, rgb(), hsl(), keyword) to RGB through a canvas; null if it is not a colour.
            // Transparent / alpha 0 is not a usable LED either. Same as ButtonSetData.
            function parseColor(css) {
                if (!colorContext) {
                    colorContext = document.createElement('canvas').getContext('2d');
                    if (!colorContext) {
                        return null;
                    }
                }
                const ctx = colorContext;
                // Two different starting values: an invalid colour leaves fillStyle unchanged in both cases.
                ctx.fillStyle = '#000000';
                ctx.fillStyle = css;
                const first = String(ctx.fillStyle);
                ctx.fillStyle = '#ffffff';
                ctx.fillStyle = css;
                const value = String(ctx.fillStyle);
                if (first !== value) {
                    return null;
                }
                let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
                if (m) {
                    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
                }
                m = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/i.exec(value);
                if (m && (m[4] === undefined || parseFloat(m[4]) > 0)) {
                    return [+m[1], +m[2], +m[3]];
                }
                return null;
            }
            // amount 0 = c, 1 = target
            function mix(c, target, amount) {
                return 'rgb(' + c.map(v => Math.round(v + (target - v) * amount)).join(', ') + ')';
            }
            function alpha(c, a) {
                return 'rgba(' + c.join(', ') + ', ' + a + ')';
            }
            // Lit: pale core, the colour itself in the middle, a darker rim and the glow around.
            function litShades(c) {
                return {
                    '--sdf-led-l-core': mix(c, 255, 0.82),
                    '--sdf-led-l-mid': mix(c, 255, 0.3),
                    '--sdf-led-l-base': mix(c, 255, 0),
                    '--sdf-led-l-rim': mix(c, 0, 0.22),
                    '--sdf-led-l-edge': mix(c, 0, 0.25),
                    '--sdf-led-l-glow': alpha(c, 0.6),
                    '--sdf-led-l-glow-strong': alpha(c, 0.8)
                };
            }
            // Unlit: same bulb, no glow, a duller core.
            function unlitShades(c) {
                return {
                    '--sdf-led-u-core': mix(c, 255, 0.45),
                    '--sdf-led-u-base': mix(c, 255, 0),
                    '--sdf-led-u-rim': mix(c, 0, 0.28),
                    '--sdf-led-u-edge': mix(c, 0, 0.35)
                };
            }
            function applyShades(el, shades, names) {
                for (const name of names) {
                    if (shades) {
                        el.style.setProperty(name, shades[name]);
                    }
                    else {
                        el.style.removeProperty(name);
                    }
                }
            }
            const LIT_NAMES = ['--sdf-led-l-core', '--sdf-led-l-mid', '--sdf-led-l-base', '--sdf-led-l-rim', '--sdf-led-l-edge', '--sdf-led-l-glow', '--sdf-led-l-glow-strong'];
            const UNLIT_NAMES = ['--sdf-led-u-core', '--sdf-led-u-base', '--sdf-led-u-rim', '--sdf-led-u-edge'];
            /* ---------- control ---------- */
            class LedVisData extends TcHmi.Controls.System.TcHmiControl {
                /*
                Attribute philosophy
                --------------------
                - Local variables are not set while definition in class, so they have the value 'undefined'.
                - On compile the Framework sets the value from HTML or from theme (possibly 'null') via normal setters.
                - The "changed detection" in the setter will result in processing the value only once while compile.
                - Attention: If we have a Server Binding on an Attribute the setter will be called once with null to initialize and later with the correct value.
                */
                constructor(element, pcElement, attrs) {
                    super(element, pcElement, attrs);
                    this.__stateValues = [];
                    this.__statesResolver = null;
                    this.__destroyStatesWatch = null;
                    this.__attached = false;
                }
                __previnit() {
                    this.__elementTemplateRoot = this.__element.find('.TcHmi_Controls_SetDataFramework_LedVisData-Template');
                    if (this.__elementTemplateRoot.length === 0) {
                        throw new Error('Invalid Template.html');
                    }
                    const root = this.__elementTemplateRoot[0];
                    this.__elementText = root.querySelector('.sdf-led-text');
                    this.__elementSlot = root.querySelector('.sdf-led-slot');
                    this.__elementLamp = root.querySelector('.sdf-led-lamp');
                    super.__previnit();
                }
                __init() {
                    super.__init();
                }
                __attach() {
                    super.__attach();
                    this.__attached = true;
                    this.__watchStates();
                }
                __detach() {
                    super.__detach();
                    this.__attached = false;
                    this.__unwatchStates();
                }
                destroy() {
                    if (this.__keepAlive) {
                        return;
                    }
                    this.__unwatchStates();
                    super.destroy();
                }
                /* ---------- Value ---------- */
                // Typed Number; a bound BOOL symbol still arrives as true/false (toValue).
                setValue(valueNew) {
                    let convertedValue = toValue(valueNew);
                    if (convertedValue === null) {
                        convertedValue = toValue(this.getAttributeDefaultValueInternal('Value'));
                    }
                    if (convertedValue === this.__value) {
                        return;
                    }
                    this.__value = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'Value' });
                    this.__processStates();
                }
                getValue() {
                    return this.__value;
                }
                /* ---------- States ---------- */
                setStates(valueNew) {
                    const convertedValue = Array.isArray(valueNew) ? valueNew : [];
                    this.__states = convertedValue;
                    // Until the watch delivers, entries with a symbol expression are skipped (NaN value).
                    this.__stateValues = toStateValues(convertedValue);
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'States' });
                    this.__processStates();
                    if (this.__attached) {
                        this.__watchStates();
                    }
                }
                getStates() {
                    return this.__states;
                }
                // allowSymbolExpressionsInObject only lets the editor accept %s%...%/s% inside the list:
                // the control resolves them itself and re-evaluates on every change.
                __watchStates() {
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
                            TcHmi.Log.errorEx('[LedVisData] ' + this.__id + ': States could not be resolved: ' +
                                (data.details && data.details.reason ? data.details.reason : data.error));
                            return;
                        }
                        this.__stateValues = toStateValues(data.value);
                        this.__processStates();
                    });
                }
                __unwatchStates() {
                    if (this.__destroyStatesWatch) {
                        this.__destroyStatesWatch();
                        this.__destroyStatesWatch = null;
                    }
                    if (this.__statesResolver) {
                        this.__statesResolver.destroy();
                        this.__statesResolver = null;
                    }
                }
                // First matching state wins and lights the LED (a Grey state shows the unlit theme grey);
                // none: unlit in DefaultColor.
                __processStates() {
                    const value = this.__value;
                    let active = null;
                    if (value !== null && value !== undefined && isFinite(value)) {
                        for (const state of this.__stateValues) {
                            if (compare(value, state.sign, state.value)) {
                                active = state;
                                break;
                            }
                        }
                    }
                    const root = this.__elementTemplateRoot[0];
                    const lit = active && active.color !== null ? parseColor(active.color) : null;
                    applyShades(root, lit ? litShades(lit) : null, LIT_NAMES);
                    root.classList.toggle('sdf-led-lit', !!lit);
                    const flashing = !!lit && !!active && active.flashing;
                    root.classList.toggle('sdf-led-flashing', flashing);
                    if (flashing) {
                        startFlashClock();
                    }
                    // Unlit shades: DefaultColor without a match, grey for a Grey state; no inline shades = theme grey.
                    const unlitColor = active ? null : colorOf(this.__defaultColor, this.__defaultCustomColor);
                    const unlit = unlitColor !== null ? parseColor(unlitColor) : null;
                    applyShades(root, unlit ? unlitShades(unlit) : null, UNLIT_NAMES);
                }
                /* ---------- DefaultColor / DefaultCustomColor ---------- */
                setDefaultColor(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('DefaultColor');
                    }
                    if (convertedValue === this.__defaultColor) {
                        return;
                    }
                    this.__defaultColor = convertedValue || 'Grey';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'DefaultColor' });
                    this.__processStates();
                }
                getDefaultColor() {
                    return this.__defaultColor;
                }
                // Used only with DefaultColor = Custom.
                setDefaultCustomColor(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toObject(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('DefaultCustomColor');
                    }
                    if (this.__defaultCustomColor !== undefined &&
                        JSON.stringify(convertedValue) === JSON.stringify(this.__defaultCustomColor)) {
                        return;
                    }
                    this.__defaultCustomColor = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'DefaultCustomColor' });
                    this.__processStates();
                }
                getDefaultCustomColor() {
                    return this.__defaultCustomColor;
                }
                /* ---------- Hide ---------- */
                setHide(valueNew) {
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
                    this.__element.toggleClass('sdf-led-hidden', !!this.__hide);
                }
                getHide() {
                    return this.__hide;
                }
                /* ---------- Text ---------- */
                setText(valueNew) {
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
                getText() {
                    return this.__text;
                }
                /* ---------- TextWidth / TextWidthUnit ---------- */
                setTextWidth(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toNumber(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('TextWidth');
                    }
                    if (convertedValue === this.__textWidth) {
                        return;
                    }
                    this.__textWidth = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'TextWidth' });
                    this.__processTextWidth();
                }
                getTextWidth() {
                    return this.__textWidth;
                }
                setTextWidthUnit(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('TextWidthUnit');
                    }
                    if (convertedValue === this.__textWidthUnit) {
                        return;
                    }
                    this.__textWidthUnit = convertedValue || '%';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'TextWidthUnit' });
                    this.__processTextWidth();
                }
                getTextWidthUnit() {
                    return this.__textWidthUnit;
                }
                // In %: a share of the width the LED leaves free, so 100% fills it exactly.
                __processTextWidth() {
                    const width = this.__textWidth;
                    if (width === null || width === undefined || !isFinite(width)) {
                        this.__elementText.style.width = '';
                    }
                    else if (this.__textWidthUnit === '%') {
                        this.__elementText.style.width =
                            'calc((100% - var(--sdf-led-box) - var(--sdf-led-gap)) * ' + width / 100 + ')';
                    }
                    else {
                        this.__elementText.style.width = width + 'px';
                    }
                }
                /* ---------- TextAlignment ---------- */
                setTextAlignment(valueNew) {
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
                getTextAlignment() {
                    return this.__textAlignment;
                }
                /* ---------- LedSize ---------- */
                setLedSize(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toNumber(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('LedSize');
                    }
                    if (convertedValue === this.__ledSize) {
                        return;
                    }
                    this.__ledSize = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'LedSize' });
                    // Diameter of the bulb. The glow gets its own margin around it, so the LED box
                    // (bulb + 2 x glow: TextWidth in %, control min width / height) holds all the light.
                    const style = this.__elementTemplateRoot[0].style;
                    style.setProperty('--sdf-led-size', this.__ledPx() + 'px');
                    style.setProperty('--sdf-led-halo', this.__glowPx() + 'px');
                    style.setProperty('--sdf-led-box', this.__ledBoxPx() + 'px');
                    this.__processLedMinSize();
                }
                getLedSize() {
                    return this.__ledSize;
                }
                __ledPx() {
                    const size = this.__ledSize;
                    return size === null || size === undefined || !isFinite(size) ? DEFAULT_SIZE : Math.max(4, size);
                }
                // Reach of the glow past the bulb edge (= its blur radius in Style.css).
                __glowPx() {
                    return Math.max(2, Math.round(this.__ledPx() * GLOW_RATIO));
                }
                __ledBoxPx() {
                    return this.__ledPx() + 2 * this.__glowPx();
                }
                /* ---------- MinWidth / MinHeight: never below LedSize ---------- */
                // The base class rewrites (or clears) the inline min-width / min-height from the MinWidth / MinHeight
                // attributes: re-apply the LED floor after it, so the control itself cannot get smaller than the LED.
                __processMinWidth() {
                    super.__processMinWidth();
                    this.__processLedMinSize();
                }
                __processMinHeight() {
                    super.__processMinHeight();
                    this.__processLedMinSize();
                }
                __processLedMinSize() {
                    const el = this.__element[0];
                    const led = this.__ledBoxPx() + 'px';
                    const minWidth = this.getMinWidth();
                    const minHeight = this.getMinHeight();
                    const minWidthUnit = this.getMinWidthUnit();
                    const minHeightUnit = this.getMinHeightUnit();
                    // A MinWidth / MinHeight set in the designer still applies when it is larger.
                    el.style.minWidth = minWidth !== null && minWidth !== undefined && minWidthUnit !== undefined
                        ? 'max(' + minWidth + minWidthUnit + ', ' + led + ')' : led;
                    el.style.minHeight = minHeight !== null && minHeight !== undefined && minHeightUnit !== undefined
                        ? 'max(' + minHeight + minHeightUnit + ', ' + led + ')' : led;
                }
                /* ---------- LedAlignment ---------- */
                setLedAlignment(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('LedAlignment');
                    }
                    if (convertedValue === this.__ledAlignment) {
                        return;
                    }
                    this.__ledAlignment = convertedValue || 'Right';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'LedAlignment' });
                    this.__elementSlot.style.justifyContent = flexAlign(this.__ledAlignment);
                }
                getLedAlignment() {
                    return this.__ledAlignment;
                }
            }
            SetDataFramework.LedVisData = LedVisData;
        })(SetDataFramework = Controls.SetDataFramework || (Controls.SetDataFramework = {}));
    })(Controls = TcHmi.Controls || (TcHmi.Controls = {}));
})(TcHmi || (TcHmi = {}));
TcHmi.Controls.registerEx('LedVisData', 'TcHmi.Controls.SetDataFramework', TcHmi.Controls.SetDataFramework.LedVisData);
//# sourceMappingURL=LedVisData.js.map
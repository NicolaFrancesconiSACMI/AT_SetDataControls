/*
 * NumericVisData
 *
 * Read-only counterpart of NumericSetData: Text on the left, value + Unit on the right, no editing.
 *
 * - Value is bound to any numeric symbol and only shown.
 * - Layout: same as NumericSetData. Text takes TextWidth (aligned by TextAlignment); the value box has the
 *   same size, centred vertically and placed by ValueAlignment in the remaining width.
 * - Limits: list of { limit, sign, color, customColor, flashing }. The first entry whose condition holds
 *   (value <sign> limit) colours the value text; flashing makes it blink.
 *   The list order is the priority: put the most severe limit on top.
 *   A limit may be bound to a symbol: the control watches it with an ObjectResolver while attached.
 * - Colours are picked by name, as in LedVisData: Default (no change, theme value colour), Red, Blue, Green,
 *   Orange (per-theme shades, Themes/<Theme>/Style.css) or Custom (customColor).
 */
var TcHmi;
(function (TcHmi) {
    let Controls;
    (function (Controls) {
        let SetDataFramework;
        (function (SetDataFramework) {
            // Named colours -> per-theme variables (Themes/<Theme>/Style.css).
            const NAMED_COLORS = {
                Red: 'var(--sdf-nvd-red)',
                Blue: 'var(--sdf-nvd-blue)',
                Green: 'var(--sdf-nvd-green)',
                Orange: 'var(--sdf-nvd-orange)'
            };
            // Colour name (+ custom SolidColor) -> CSS colour; null = Default (no change).
            // Custom without a usable colour counts as Default. A SolidColor object (lists made before the
            // colour names) is taken as Custom.
            function colorOf(name, custom) {
                if (name && typeof name === 'object') {
                    return TcHmi.isSolidColor(name) ? name.color : null;
                }
                if (name === 'Custom') {
                    return custom && TcHmi.isSolidColor(custom) ? custom.color : null;
                }
                return typeof name === 'string' && NAMED_COLORS.hasOwnProperty(name) ? NAMED_COLORS[name] : null;
            }
            /* ---------- values ---------- */
            function toDecimals(value) {
                if (value === null || value === undefined || !isFinite(value)) {
                    return null;
                }
                return Math.max(0, Math.min(10, Math.round(value)));
            }
            function round(value, decimals) {
                // Without Decimals still strip float noise (0.1 + 0.2 -> 0.3).
                return decimals === null ? Number(value.toPrecision(15)) : Number(value.toFixed(decimals));
            }
            function format(value, decimals) {
                return decimals === null ? String(round(value, null)) : value.toFixed(decimals);
            }
            // HorizontalAlignment -> flex justify-content.
            function flexAlign(alignment) {
                return alignment === 'Center' ? 'center' : alignment === 'Right' ? 'flex-end' : 'flex-start';
            }
            /* ---------- limits ---------- */
            const FLASH_PERIOD = 800; // ms, one on + off cycle; same in LedVisData and StringVisData
            // One blink clock for the page, shared with LedVisData and StringVisData (same global, any file may start it):
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
            function compare(value, sign, limit) {
                switch (sign) {
                    case '>': return value > limit;
                    case '<': return value < limit;
                    case '>=': return value >= limit;
                    case '<=': return value <= limit;
                }
            }
            // Entries without a usable limit or sign are skipped. A Default entry still counts (first match wins),
            // e.g. a "normal range" on top that keeps the theme colour.
            function toLimitValues(value) {
                const res = [];
                if (!Array.isArray(value)) {
                    return res;
                }
                for (const entry of value) {
                    if (!entry || typeof entry !== 'object') {
                        continue;
                    }
                    const limit = entry.limit === null || entry.limit === '' ? NaN : Number(entry.limit);
                    const sign = entry.sign;
                    if (!isFinite(limit) || ['>', '<', '>=', '<='].indexOf(sign) < 0) {
                        continue;
                    }
                    res.push({ limit: limit, sign: sign, color: colorOf(entry.color, entry.customColor), flashing: !!entry.flashing });
                }
                return res;
            }
            /* ---------- control ---------- */
            class NumericVisData extends TcHmi.Controls.System.TcHmiControl {
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
                    this.__limitValues = [];
                    this.__limitsResolver = null;
                    this.__destroyLimitsWatch = null;
                    this.__attached = false;
                }
                __previnit() {
                    this.__elementTemplateRoot = this.__element.find('.TcHmi_Controls_SetDataFramework_NumericVisData-Template');
                    if (this.__elementTemplateRoot.length === 0) {
                        throw new Error('Invalid Template.html');
                    }
                    const root = this.__elementTemplateRoot[0];
                    this.__elementText = root.querySelector('.sdf-nvd-text');
                    this.__elementSlot = root.querySelector('.sdf-nvd-slot');
                    this.__elementValue = root.querySelector('.sdf-nvd-value');
                    super.__previnit();
                }
                __init() {
                    super.__init();
                }
                __attach() {
                    super.__attach();
                    this.__attached = true;
                    this.__watchLimits();
                }
                __detach() {
                    super.__detach();
                    this.__attached = false;
                    this.__unwatchLimits();
                }
                destroy() {
                    if (this.__keepAlive) {
                        return;
                    }
                    this.__unwatchLimits();
                    super.destroy();
                }
                /* ---------- Value ---------- */
                setValue(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toNumber(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('Value');
                    }
                    if (convertedValue === this.__value) {
                        return;
                    }
                    this.__value = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'Value' });
                    this.__processValue();
                }
                getValue() {
                    return this.__value;
                }
                // "12.50 mm/s", "-" without a value.
                __processValue() {
                    const value = this.__value;
                    const unit = this.__unit ? ' ' + this.__unit : '';
                    if (value === null || value === undefined || !isFinite(value)) {
                        this.__elementValue.textContent = '-';
                    }
                    else {
                        const decimals = toDecimals(this.__decimals);
                        this.__elementValue.textContent = format(round(value, decimals), decimals) + unit;
                    }
                    this.__processLimits();
                }
                /* ---------- Decimals ---------- */
                setDecimals(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toNumber(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('Decimals');
                    }
                    if (convertedValue === this.__decimals) {
                        return;
                    }
                    this.__decimals = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'Decimals' });
                    this.__processValue();
                }
                getDecimals() {
                    return this.__decimals;
                }
                /* ---------- Limits ---------- */
                setLimits(valueNew) {
                    const convertedValue = Array.isArray(valueNew) ? valueNew : [];
                    this.__limits = convertedValue;
                    // Until the watch delivers, entries with a symbol expression are skipped (NaN limit).
                    this.__limitValues = toLimitValues(convertedValue);
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'Limits' });
                    this.__processLimits();
                    if (this.__attached) {
                        this.__watchLimits();
                    }
                }
                getLimits() {
                    return this.__limits;
                }
                // allowSymbolExpressionsInObject only lets the editor accept %s%...%/s% inside the list:
                // the control resolves them itself and re-evaluates on every change.
                __watchLimits() {
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
                            TcHmi.Log.errorEx('[NumericVisData] ' + this.__id + ': Limits could not be resolved: ' +
                                (data.details && data.details.reason ? data.details.reason : data.error));
                            return;
                        }
                        this.__limitValues = toLimitValues(data.value);
                        this.__processLimits();
                    });
                }
                __unwatchLimits() {
                    if (this.__destroyLimitsWatch) {
                        this.__destroyLimitsWatch();
                        this.__destroyLimitsWatch = null;
                    }
                    if (this.__limitsResolver) {
                        this.__limitsResolver.destroy();
                        this.__limitsResolver = null;
                    }
                }
                // First matching limit wins; compared with the raw value, not the rounded text.
                // A Default limit (no colour) leaves the value as it is, flashing included.
                __processLimits() {
                    const value = this.__value;
                    let active = null;
                    if (value !== null && value !== undefined && isFinite(value)) {
                        for (const limit of this.__limitValues) {
                            if (compare(value, limit.sign, limit.limit)) {
                                active = limit;
                                break;
                            }
                        }
                    }
                    const color = active ? active.color : null;
                    const root = this.__elementTemplateRoot[0];
                    if (color !== null) {
                        root.style.setProperty('--sdf-nvd-limit-color', color);
                    }
                    else {
                        root.style.removeProperty('--sdf-nvd-limit-color');
                    }
                    root.classList.toggle('sdf-nvd-limit-active', color !== null);
                    const flashing = color !== null && !!active && active.flashing;
                    root.classList.toggle('sdf-nvd-limit-flashing', flashing);
                    if (flashing) {
                        startFlashClock();
                    }
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
                    this.__element.toggleClass('sdf-nvd-hidden', !!this.__hide);
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
                /* ---------- Unit ---------- */
                setUnit(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('Unit');
                    }
                    if (convertedValue === this.__unit) {
                        return;
                    }
                    this.__unit = (convertedValue || '').trim();
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'Unit' });
                    this.__processValue();
                }
                getUnit() {
                    return this.__unit;
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
                    this.__textWidthUnit = convertedValue || 'px';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'TextWidthUnit' });
                    this.__processTextWidth();
                }
                getTextWidthUnit() {
                    return this.__textWidthUnit;
                }
                // In %: a share of the width the value box leaves free, so 100% fills it exactly.
                __processTextWidth() {
                    const width = this.__textWidth;
                    if (width === null || width === undefined || !isFinite(width)) {
                        this.__elementText.style.width = '';
                    }
                    else if (this.__textWidthUnit === '%') {
                        this.__elementText.style.width =
                            'calc((100% - var(--sdf-nvd-box-width) - var(--sdf-nvd-gap)) * ' + width / 100 + ')';
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
                /* ---------- ValueAlignment ---------- */
                setValueAlignment(valueNew) {
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
                getValueAlignment() {
                    return this.__valueAlignment;
                }
            }
            SetDataFramework.NumericVisData = NumericVisData;
        })(SetDataFramework = Controls.SetDataFramework || (Controls.SetDataFramework = {}));
    })(Controls = TcHmi.Controls || (TcHmi.Controls = {}));
})(TcHmi || (TcHmi = {}));
TcHmi.Controls.registerEx('NumericVisData', 'TcHmi.Controls.SetDataFramework', TcHmi.Controls.SetDataFramework.NumericVisData);
//# sourceMappingURL=NumericVisData.js.map
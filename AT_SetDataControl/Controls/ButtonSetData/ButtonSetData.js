/*
 * ButtonSetData
 *
 * A button in the SetDataFramework look: a light filled keycap with a darker lip at the bottom, no blue
 * (editable values are white, outlined and underlined in blue). Optional Text on the left.
 *
 * - ButtonType Standard (monostable): writes Variable TRUE on press and FALSE on release. FALSE is also
 *   written when the finger slides off, on pointercancel, when Lock / Hide turn TRUE while held and on
 *   detach / destroy: the BOOL never stays TRUE. NeedConfirm is ignored.
 *   Unbound Variable: only the events.
 * - ButtonType Toggle (bistable): each click writes the inverted Variable; ON = lit glass bulb (also when locked), following
 *   the value read back. Bound and not read yet: presses are ignored.
 *   Variable TRUE: the button stays pushed in (latched), lit or not.
 *   ToggleGroup: when a member changes from OFF to ON, by a press or from outside (PLC, another control),
 *   the other members of the group on the page are switched OFF.
 *   NeedConfirm: None / SwitchOn / SwitchOff / All. A matching click opens a confirm dialog
 *   (dimmed background) instead of writing; ✕ / Esc cancels, ✓ / Enter writes.
 * - Lit (glass bulb): ShowBackground when set or bound, else Variable. E.g. a Standard "Start" lit by
 *   "motor running", or a Toggle lit by its feedback instead of its command.
 * - Variable bound to a symbol is written directly (the binding would write a second time); unbound,
 *   Variable itself is set. A failed write blinks the button. Inside a user control a %pp% binding is
 *   followed to the real symbol.
 * - Blocked (no events, no writes): Hide, disabled, no "operate" right (user lock badge), Lock (lock badge;
 *   with a LockDescription a tap shows it in a bubble).
 * - Layout: Text takes TextWidth (0 % = no text); the button keeps the size of SizeStyle (Default 120 x 45,
 *   Small 50 x 50, Custom CustomWidth x CustomHeight), centred vertically and placed by ButtonAlignment
 *   in the remaining width. SizeStyle also sets MinWidth / MinHeight, so the control is never smaller.
 * - Events: .onButtonPressed / .onButtonReleased (always in pairs) / .onButtonClick (released over the
 *   button) / .onValueWritten. The base .onPressed does not know Lock: use these.
 * - AuditTrail: after a write to a symbol, adds an entry via TcHmi.Functions.SUtils.CallServerFunction
 *   ('SacmiTcHmiAuditTrailExt.AddEntry'), if that function is loaded. Toggle: 1 / 0. Standard: 1 per press.
 */
var TcHmi;
(function (TcHmi) {
    let Controls;
    (function (Controls) {
        let SetDataFramework;
        (function (SetDataFramework) {
            // HorizontalAlignment -> flex justify-content.
            function flexAlign(alignment) {
                return alignment === 'Center' ? 'center' : alignment === 'Right' ? 'flex-end' : 'flex-start';
            }
            /* ---------- symbols (same as BooleanSetData) ---------- */
            // Path tokens back to "::A::B" ("[0]" array tokens are appended as is).
            function pathOf(tokens) {
                let res = '';
                for (const token of tokens) {
                    res += token.charAt(0) === '[' ? token : '::' + token;
                }
                return res;
            }
            function nearestUserControlHost(control) {
                for (let c = control; c; c = c.getParent()) {
                    if (c.getType() === 'TcHmi.Controls.System.TcHmiUserControlHost') {
                        return c;
                    }
                }
                return null;
            }
            // A %pp% symbol has the type of the user control parameter, not of the symbol bound to it.
            // Follow the parameter bindings to the real symbol, also through nested user controls.
            // Returns null when the parameter is not bound to a symbol.
            function resolveTarget(expression, control) {
                let from = control;
                for (let depth = 0; depth < 10; depth++) {
                    const expr = new TcHmi.SymbolExpression(expression);
                    if (expr.getType() !== TcHmi.SymbolType.PartialParam) {
                        return expression;
                    }
                    let tokens = [expr.getNameEx() || ''].concat(expr.getPathTokensEx() || []);
                    let host = TcHmi.Controls.get(tokens[0]) || null;
                    if (host && host.getType() === 'TcHmi.Controls.System.TcHmiUserControlHost') {
                        tokens = tokens.slice(1);
                    }
                    else {
                        host = nearestUserControlHost(from);
                    }
                    const bound = host && tokens.length ? TcHmi.Binding.resolveEx(tokens[0], host) : null;
                    if (!bound) {
                        return null;
                    }
                    const tag = bound.getTag();
                    expression = '%' + tag + '%' + bound.getFullName() + pathOf(tokens.slice(1)) + '%/' + tag + '%';
                    from = host ? host.getParent() : null;
                }
                return null;
            }
            const SIZES = {
                Default: { width: 120, height: 45, fontSize: 16, iconSize: 20, radius: 8, iconTop: false },
                Small: { width: 50, height: 50, fontSize: 11, iconSize: 20, radius: 8, iconTop: true }
            };
            const TEXT_GAP = 4; // px between Text and the button, also in Style.css (--sdf-btn-gap)
            let colorContext = null;
            // Any CSS colour (#hex, rgb(), hsl(), keyword) to RGB through a canvas; null if it is not a colour.
            // Transparent / alpha 0 is not a usable bulb either.
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
            // The picked colour is the rim; the core is almost white, the glow is the colour itself, the text a dark shade.
            function glassOf(c) {
                return {
                    '--sdf-btn-glass-core': mix(c, 255, 0.92),
                    '--sdf-btn-glass-mid': mix(c, 255, 0.55),
                    '--sdf-btn-glass-rim': mix(c, 255, 0),
                    '--sdf-btn-glass-line': mix(c, 0, 0.15),
                    '--sdf-btn-glass-glow': 'rgba(' + c.join(', ') + ', 0.55)',
                    '--sdf-btn-glass-text': mix(c, 0, 0.65)
                };
            }
            const GLASS_VARIABLES = ['--sdf-btn-glass-core', '--sdf-btn-glass-mid', '--sdf-btn-glass-rim',
                '--sdf-btn-glass-line', '--sdf-btn-glass-glow', '--sdf-btn-glass-text'];
            /* ---------- ButtonBackgroundColor: the keycap from one colour ---------- */
            // Body = the picked colour; hover, pressed, outline and lip are shades of it.
            // Text and lock badge dark on a light colour, white on a dark one.
            function keyOf(c) {
                const light = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > 150;
                return {
                    '--sdf-btn-background': mix(c, 0, 0),
                    '--sdf-btn-background-hover': mix(c, light ? 0 : 255, 0.07),
                    '--sdf-btn-background-pressed': mix(c, 0, 0.12),
                    '--sdf-btn-border': mix(c, 0, 0.18),
                    '--sdf-btn-edge': mix(c, 0, 0.3),
                    '--sdf-btn-text-color': light ? '#1f2933' : '#ffffff',
                    '--sdf-btn-lock-color': light ? 'rgba(31, 41, 51, 0.65)' : 'rgba(255, 255, 255, 0.8)'
                };
            }
            const KEY_VARIABLES = ['--sdf-btn-background', '--sdf-btn-background-hover', '--sdf-btn-background-pressed',
                '--sdf-btn-border', '--sdf-btn-edge', '--sdf-btn-text-color', '--sdf-btn-lock-color'];
            /* ---------- confirm dialog (same as BooleanSetData, own prefix) ---------- */
            // One dialog per page, built on first use and shown centred in the TopMostLayer.
            // The background is dimmed: a confirmation is pending.
            class Confirm {
                static __q(selector) {
                    return Confirm.__el.querySelector(selector);
                }
                static __build() {
                    const el = document.createElement('div');
                    el.className = 'sdf-btncf';
                    el.innerHTML =
                        '<div class="sdf-btncf-title"><span class="sdf-btncf-title-text"></span>' +
                            '<button type="button" class="sdf-btncf-close" data-key="Escape" aria-label="Close">✕</button></div>' +
                            '<div class="sdf-btncf-body"><span class="sdf-btncf-pill sdf-btncf-from"></span>' +
                            '<span class="sdf-btncf-arrow">→</span><span class="sdf-btncf-pill sdf-btncf-to"></span></div>' +
                            '<div class="sdf-btncf-buttons">' +
                            '<button type="button" class="sdf-btncf-button sdf-btncf-cancel" data-key="Escape"></button>' +
                            '<button type="button" class="sdf-btncf-button sdf-btncf-accent" data-key="Enter"></button></div>';
                    el.addEventListener('pointerdown', e => {
                        e.preventDefault(); // no focus, no text selection
                        const button = e.target.closest('[data-key]');
                        if (button) {
                            button.classList.add('down');
                        }
                    });
                    const up = () => el.querySelectorAll('.down').forEach(k => k.classList.remove('down'));
                    el.addEventListener('pointerup', up);
                    el.addEventListener('pointercancel', up);
                    el.addEventListener('pointerleave', up);
                    // click, not pointerdown: a finger slid off the button does not confirm
                    el.addEventListener('click', e => {
                        const button = e.target.closest('[data-key]');
                        if (button) {
                            Confirm.__onKey(button.getAttribute('data-key'));
                        }
                    });
                    return el;
                }
                static __onKey(key) {
                    const owner = Confirm.__owner;
                    if (!owner) {
                        return;
                    }
                    const value = Confirm.__value;
                    Confirm.close();
                    if (key === 'Enter') {
                        owner.__write(value);
                    }
                }
                static isOpenFor(owner) {
                    return Confirm.__owner === owner;
                }
                static open(owner, value, text, onText, offText, confirmLabel, cancelLabel) {
                    if (!Confirm.__userWatch) {
                        // Another user logged in (or auto-logout): nothing opened by the previous user stays open.
                        Confirm.__userWatch = true;
                        TcHmi.EventProvider.register('onUserChanged', () => Confirm.close());
                    }
                    if (Confirm.__owner) {
                        Confirm.close();
                    }
                    if (!Confirm.__el) {
                        Confirm.__el = Confirm.__build();
                    }
                    Confirm.__owner = owner;
                    Confirm.__value = value;
                    const from = Confirm.__q('.sdf-btncf-from');
                    const to = Confirm.__q('.sdf-btncf-to');
                    Confirm.__q('.sdf-btncf-title-text').textContent = text;
                    from.textContent = value ? offText : onText;
                    from.classList.toggle('sdf-btncf-on', !value);
                    to.textContent = value ? onText : offText;
                    to.classList.toggle('sdf-btncf-on', value);
                    Confirm.__q('.sdf-btncf-cancel').textContent = cancelLabel;
                    Confirm.__q('.sdf-btncf-accent').textContent = confirmLabel;
                    // The pills in the button's OnBackgroundColor / ButtonBackgroundColor, if set (else the theme colours)
                    const source = owner.__glassStyle();
                    for (const name of [...GLASS_VARIABLES, ...KEY_VARIABLES]) {
                        const value = source.getPropertyValue(name);
                        if (value) {
                            Confirm.__el.style.setProperty(name, value);
                        }
                        else {
                            Confirm.__el.style.removeProperty(name);
                        }
                    }
                    // Modal: touching the dimmed background does nothing.
                    TcHmi.TopMostLayer.add(owner, Confirm.__el, {
                        centerHorizontal: true,
                        centerVertical: true,
                        dimBackground: true,
                        modal: true,
                        closeOnBackground: false,
                        removeCb: () => {
                            // Removed by anyone else than close()
                            if (Confirm.__owner === owner) {
                                Confirm.__owner = null;
                                document.removeEventListener('keydown', Confirm.__onKeyDown, true);
                            }
                        }
                    });
                    document.addEventListener('keydown', Confirm.__onKeyDown, true);
                }
                static close() {
                    const owner = Confirm.__owner;
                    Confirm.__owner = null;
                    document.removeEventListener('keydown', Confirm.__onKeyDown, true);
                    if (owner && Confirm.__el) {
                        TcHmi.TopMostLayer.remove(owner, Confirm.__el);
                    }
                }
            }
            Confirm.__el = null;
            Confirm.__owner = null;
            Confirm.__value = false;
            Confirm.__userWatch = false;
            Confirm.__onKeyDown = (e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault();
                    Confirm.__onKey(e.key);
                }
            };
            /* ---------- lock hint (same as BooleanSetData) ---------- */
            // One bubble per page with the Lock Description, next to the button, in the TopMostLayer.
            // Modal with closeOnBackground: any tap closes it, also a second tap on the same button.
            class Hint {
                static isOpenFor(owner) {
                    return Hint.__owner === owner;
                }
                static open(owner, anchor, text) {
                    if (Hint.__owner) {
                        Hint.close();
                    }
                    if (!Hint.__el) {
                        Hint.__el = document.createElement('div');
                        Hint.__el.className = 'sdf-btn-tip';
                        // Absolute from the start: measured as a static block on the first open it is wider
                        // than it ends up, and the layer it sits in is not the full screen.
                        Hint.__el.style.position = 'absolute';
                        Hint.__el.addEventListener('pointerdown', () => Hint.close());
                    }
                    const el = Hint.__el;
                    const token = ++Hint.__token;
                    el.textContent = text;
                    Hint.__owner = owner;
                    TcHmi.TopMostLayer.add(owner, el, {
                        dimBackground: false,
                        modal: true,
                        closeOnBackground: true,
                        resizeCb: () => Hint.close(),
                        removeCb: () => {
                            // Removed by a tap beside it.
                            if (token === Hint.__token) {
                                Hint.__reset();
                            }
                        }
                    });
                    Hint.__place(anchor);
                    Hint.__timer = window.setTimeout(() => Hint.close(), 6000);
                }
                static close() {
                    const owner = Hint.__owner;
                    Hint.__reset();
                    if (owner && Hint.__el) {
                        TcHmi.TopMostLayer.remove(owner, Hint.__el);
                    }
                }
                static __reset() {
                    Hint.__token++;
                    Hint.__owner = null;
                    if (Hint.__timer !== null) {
                        window.clearTimeout(Hint.__timer);
                        Hint.__timer = null;
                    }
                }
                // Centred above the button, below it when there is no room above; kept inside the layer.
                // The arrow keeps pointing at the button centre when the bubble is pushed aside.
                static __place(anchor) {
                    const el = Hint.__el;
                    const parent = el.parentElement;
                    if (!parent) {
                        return;
                    }
                    // Reset first, so the offset of the layer is measured and not the old position.
                    el.style.left = '0px';
                    el.style.top = '0px';
                    // Worked out in screen pixels against the visible screen (the parent is the bubble's own
                    // container, not the full screen), then converted to the layer: it may be scaled.
                    const rect = el.getBoundingClientRect();
                    const scale = rect.width / (el.offsetWidth || 1) || 1;
                    const box = anchor.getBoundingClientRect();
                    const screenWidth = window.visualViewport ? window.visualViewport.width : window.innerWidth;
                    const gap = 10 * scale;
                    const centre = box.left + box.width / 2;
                    const left = Math.max(4, Math.min(screenWidth - rect.width - 4, centre - rect.width / 2));
                    const above = box.top - gap - rect.height >= 0;
                    const top = above ? box.top - gap - rect.height : box.bottom + gap;
                    el.classList.toggle('sdf-btn-tip-below', !above);
                    el.style.left = Math.round((left - rect.left) / scale) + 'px';
                    el.style.top = Math.round((top - rect.top) / scale) + 'px';
                    el.style.setProperty('--sdf-tip-arrow-x', Math.round((centre - left) / scale) + 'px');
                }
            }
            Hint.__el = null;
            Hint.__owner = null;
            Hint.__token = 0;
            Hint.__timer = null;
            /* ---------- toggle groups ---------- */
            // Toggle buttons with the same ToggleGroup on the page: after one of them changed from OFF to ON,
            // every other member that is ON is switched OFF (also a locked one: the group rule is not an
            // operator input). None ON is allowed. Only attached buttons take part.
            class ToggleGroups {
                static add(button) {
                    if (ToggleGroups.__members.indexOf(button) < 0) {
                        ToggleGroups.__members.push(button);
                    }
                }
                static remove(button) {
                    const i = ToggleGroups.__members.indexOf(button);
                    if (i >= 0) {
                        ToggleGroups.__members.splice(i, 1);
                    }
                }
                static switchOffOthers(button) {
                    const group = button.getToggleGroup();
                    if (!group) {
                        return;
                    }
                    for (const other of ToggleGroups.__members.slice()) {
                        if (other !== button && other.getToggleGroup() === group &&
                            other.getButtonType() === 'Toggle' && other.getVariable() === true) {
                            other.__write(false);
                        }
                    }
                }
            }
            ToggleGroups.__members = [];
            /* ---------- localized default texts (same in every SetDataFramework control) ---------- */
            // A "%l%Key%/l%" value (the Description.json defaults) is looked up in the project localization and
            // follows a language change; the key itself is shown when the project has no text for it.
            // Any other value (a literal, or a binding the framework has already resolved) is shown as is.
            // Watched from set() until stop(); __attach starts it again after a __detach.
            class LocalizedText {
                constructor(__onChange) {
                    this.__onChange = __onChange;
                    this.text = '';
                    this.__key = null;
                    this.__destroy = null;
                }
                set(value) {
                    this.stop();
                    const match = /^%l%(.+)%\/l%$/.exec(value);
                    this.__key = match ? match[1] : null;
                    this.text = this.__key === null ? value : this.__key; // the key until the text is read
                    this.start();
                }
                start() {
                    if (this.__key === null || this.__destroy) {
                        return;
                    }
                    this.__destroy = new TcHmi.Locale.ApplicationLocalization().watchText(this.__key, data => {
                        if (data.error !== TcHmi.Errors.NONE || typeof data.text !== 'string' || data.text === this.text) {
                            return;
                        }
                        this.text = data.text;
                        this.__onChange();
                    });
                }
                stop() {
                    if (this.__destroy) {
                        this.__destroy();
                        this.__destroy = null;
                    }
                }
            }
            /* ---------- control ---------- */
            class ButtonSetData extends TcHmi.Controls.System.TcHmiControl {
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
                    this.__busy = false; // Toggle: write running
                    this.__pointerId = null; // pointer holding the button, null = not pressed
                    this.__held = false; // Standard: TRUE written, FALSE still to write
                    this.__onPointerDown = (e) => this.__down(e);
                    // On the document, set while pressed: a click only when released over the button.
                    // The only pointerup listener: a capture listener on the document runs before one on the button.
                    this.__onPointerUp = (e) => {
                        if (e.pointerId === this.__pointerId) {
                            this.__release(this.__elementKey.contains(e.target));
                        }
                    };
                    // Slid off or cancelled by the browser: no click.
                    this.__onPointerAbort = (e) => {
                        if (e.pointerId === this.__pointerId) {
                            this.__release(false);
                        }
                    };
                    this.__onErrorEnd = () => this.__elementKey.classList.remove('sdf-btn-error');
                }
                __previnit() {
                    this.__elementTemplateRoot = this.__element.find('.TcHmi_Controls_SetDataFramework_ButtonSetData-Template');
                    if (this.__elementTemplateRoot.length === 0) {
                        throw new Error('Invalid Template.html');
                    }
                    const root = this.__elementTemplateRoot[0];
                    this.__elementText = root.querySelector('.sdf-btn-text');
                    this.__elementSlot = root.querySelector('.sdf-btn-slot');
                    this.__elementKey = root.querySelector('.sdf-btn-key');
                    this.__elementIcon = root.querySelector('.sdf-btn-icon');
                    this.__elementLabel = root.querySelector('.sdf-btn-label');
                    this.__localizedOnText = new LocalizedText(() => { });
                    this.__localizedOffText = new LocalizedText(() => { });
                    this.__localizedConfirmLabel = new LocalizedText(() => { });
                    this.__localizedCancelLabel = new LocalizedText(() => { });
                    super.__previnit();
                }
                __init() {
                    super.__init();
                    // Again after all setters: MinWidth / MinHeight from the HTML may have been set after SizeStyle.
                    this.__processMinSize();
                }
                __attach() {
                    super.__attach();
                    const key = this.__elementKey;
                    key.addEventListener('pointerdown', this.__onPointerDown);
                    key.addEventListener('pointerleave', this.__onPointerAbort);
                    key.addEventListener('pointercancel', this.__onPointerAbort);
                    key.addEventListener('animationend', this.__onErrorEnd);
                    ToggleGroups.add(this);
                    this.__localizedTexts().forEach(t => t.start());
                }
                __detach() {
                    super.__detach();
                    const key = this.__elementKey;
                    key.removeEventListener('pointerdown', this.__onPointerDown);
                    key.removeEventListener('pointerleave', this.__onPointerAbort);
                    key.removeEventListener('pointercancel', this.__onPointerAbort);
                    key.removeEventListener('animationend', this.__onErrorEnd);
                    ToggleGroups.remove(this);
                    this.__localizedTexts().forEach(t => t.stop());
                    this.__release(false);
                    this.__closePopups();
                }
                destroy() {
                    if (this.__keepAlive) {
                        return;
                    }
                    this.__localizedTexts().forEach(t => t.stop());
                    this.__release(false);
                    this.__closePopups();
                    super.destroy();
                }
                __localizedTexts() {
                    return [this.__localizedOnText, this.__localizedOffText, this.__localizedConfirmLabel, this.__localizedCancelLabel];
                }
                __closePopups() {
                    if (Confirm.isOpenFor(this)) {
                        Confirm.close();
                    }
                    if (Hint.isOpenFor(this)) {
                        Hint.close();
                    }
                }
                /** The real symbol bound to Variable, null if Variable is not bound to a symbol. */
                __target() {
                    const expression = TcHmi.Binding.resolve('Variable', this);
                    if (!expression) {
                        return null;
                    }
                    try {
                        return resolveTarget(expression, this);
                    }
                    catch (e) {
                        return null; // unparsable expression
                    }
                }
                __isToggle() {
                    return this.__buttonType === 'Toggle';
                }
                /* ---------- press / release ---------- */
                __down(e) {
                    if (e.pointerType === 'mouse' && e.button !== 0) {
                        return;
                    }
                    if (this.__pointerId !== null) {
                        return; // already held by another finger
                    }
                    // No "operate" right (user lock): silent, also when locked with a description.
                    if (this.__hide || !this.getIsEnabled() || TcHmi.Access.checkAccess(this, 'operate') === false) {
                        return;
                    }
                    if (this.__lock) {
                        if (this.__lockDescription) {
                            Hint.open(this, this.__elementKey, this.__lockDescription);
                        }
                        return;
                    }
                    if (this.__isToggle()) {
                        const known = this.__variable === true || this.__variable === false;
                        if (this.__busy || (!known && this.__target())) {
                            return; // write running, or bound and value not read yet
                        }
                    }
                    // Touch captures the pointer implicitly: without releasing it a finger slid off
                    // would never leave the button.
                    const key = this.__elementKey;
                    if (key.hasPointerCapture(e.pointerId)) {
                        key.releasePointerCapture(e.pointerId);
                    }
                    this.__pointerId = e.pointerId;
                    key.classList.add('sdf-btn-down');
                    document.addEventListener('pointerup', this.__onPointerUp, true);
                    document.addEventListener('pointercancel', this.__onPointerAbort, true);
                    TcHmi.EventProvider.raise(this.__id + '.onButtonPressed');
                    if (!this.__isToggle()) {
                        this.__held = true;
                        this.__write(true);
                    }
                }
                // Ends a press. Standard writes FALSE in every case; click = released over the button.
                __release(click) {
                    if (this.__pointerId === null) {
                        return;
                    }
                    this.__pointerId = null;
                    this.__elementKey.classList.remove('sdf-btn-down');
                    document.removeEventListener('pointerup', this.__onPointerUp, true);
                    document.removeEventListener('pointercancel', this.__onPointerAbort, true);
                    if (this.__held) {
                        this.__held = false;
                        this.__write(false);
                    }
                    TcHmi.EventProvider.raise(this.__id + '.onButtonReleased');
                    if (!click) {
                        return;
                    }
                    TcHmi.EventProvider.raise(this.__id + '.onButtonClick');
                    if (this.__isToggle()) {
                        this.__toggle();
                    }
                }
                __toggle() {
                    const value = !this.__variable;
                    const need = this.__needConfirm || 'None';
                    if (need === 'All' || (need === 'SwitchOn' && value) || (need === 'SwitchOff' && !value)) {
                        Confirm.open(this, value, this.__text || this.__buttonText || '', this.__localizedOnText.text, this.__localizedOffText.text, this.__localizedConfirmLabel.text, this.__localizedCancelLabel.text);
                        return;
                    }
                    this.__write(value);
                }
                /** @internal Called by the confirm dialog (Toggle) and by press / release (Standard). */
                __write(value) {
                    this.__elementKey.classList.remove('sdf-btn-error');
                    const toggle = this.__isToggle();
                    const target = this.__target();
                    if (!target) {
                        const before = this.__variable;
                        this.setVariable(value); // switches the group off on a change from FALSE
                        this.__raiseValueWritten(value);
                        if (toggle && value && before !== false) {
                            ToggleGroups.switchOffOthers(this);
                        }
                        return;
                    }
                    // Standard: TRUE and FALSE go out in order; only a toggle waits for its write.
                    if (toggle) {
                        this.__busy = true;
                    }
                    const oldValue = this.__variable; // the binding updates it only after the write
                    TcHmi.Symbol.writeEx(target, value, data => {
                        if (toggle) {
                            this.__busy = false;
                        }
                        if (data.error === TcHmi.Errors.NONE) {
                            // Standard: one entry per press, not for the FALSE of the release
                            if (toggle || value) {
                                this.__addAuditEntry(target, value, oldValue);
                            }
                            // The group is switched off by setVariable, when the value comes back through the binding.
                            this.__raiseValueWritten(value);
                        }
                        else {
                            TcHmi.Log.errorEx('[ButtonSetData] Writing ' + target + ' failed: ' +
                                (data.details && data.details.reason ? data.details.reason : data.error));
                            this.__blink();
                        }
                    });
                }
                // Restarts the animation if it is already blinking; removed on animationend.
                __blink() {
                    const el = this.__elementKey;
                    el.classList.remove('sdf-btn-error');
                    void el.offsetWidth; // reflow, so a repeated error blinks from the start
                    el.classList.add('sdf-btn-error');
                }
                __raiseValueWritten(value) {
                    TcHmi.EventProvider.raise(this.__id + '.onValueWritten', value);
                }
                // Toggle: ControlId "Pump (PLC1.MAIN.bPump: FALSE -> TRUE)", Data 1 / 0.
                // Standard: ControlId "Reset (PLC1.MAIN.bReset: pressed)", Data 1.
                // TRUE / FALSE and not OnText / OffText: the trail must not depend on the language.
                // SUtils is looked up on every write: it may load after this control (dependency order is not fixed).
                __addAuditEntry(target, value, oldValue) {
                    if (!this.__auditTrail) {
                        return;
                    }
                    const sutils = TcHmi.Functions.SUtils;
                    if (!sutils || typeof sutils.CallServerFunction !== 'function') {
                        TcHmi.Log.warnEx('[ButtonSetData] ' + this.__id + ': AuditTrail is on but TcHmi.Functions.SUtils.CallServerFunction is not available.');
                        return;
                    }
                    try {
                        const symbol = new TcHmi.SymbolExpression(target).getFullName() || target;
                        let change;
                        if (this.__isToggle()) {
                            const oldText = oldValue === true ? 'TRUE' : oldValue === false ? 'FALSE' : '-';
                            change = oldText + ' -> ' + (value ? 'TRUE' : 'FALSE');
                        }
                        else {
                            change = 'pressed';
                        }
                        const text = ' (' + symbol + ': ' + change + ')';
                        const name = this.__text || this.__buttonText;
                        const trail = {
                            ControlId: name ? name + text : text,
                            Type: 'ButtonSetData',
                            Username: TcHmi.Server.getCurrentUser() || 'no user',
                            // Must be a number: the extension stores it in a FLOAT column and GetEntries
                            // reads it with GetDouble, so a text row is saved but never shown.
                            Data: value ? 1 : 0,
                        };
                        sutils.CallServerFunction('SacmiTcHmiAuditTrailExt.AddEntry', trail, null, null);
                    }
                    catch (e) {
                        TcHmi.Log.errorEx('[ButtonSetData] ' + this.__id + ': AuditTrail failed: ' + e);
                    }
                }
                /* ---------- ButtonType ---------- */
                setButtonType(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('ButtonType');
                    }
                    if (convertedValue === this.__buttonType) {
                        return;
                    }
                    this.__release(false); // a held Standard must write its FALSE first
                    this.__buttonType = convertedValue === 'Toggle' ? 'Toggle' : 'Standard';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'ButtonType' });
                    this.__processLit();
                }
                getButtonType() {
                    return this.__buttonType;
                }
                /* ---------- Variable ---------- */
                setVariable(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toBoolean(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('Variable');
                    }
                    if (convertedValue === this.__variable) {
                        return;
                    }
                    const oldValue = this.__variable;
                    this.__variable = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'Variable' });
                    this.__processVariable();
                    // Switched ON by anyone (a press, the PLC, another control): the other group members go OFF.
                    // Only a change from FALSE: the first read when the page opens (from unknown) writes nothing.
                    if (oldValue === false && convertedValue === true && this.__isToggle()) {
                        ToggleGroups.switchOffOthers(this);
                    }
                }
                getVariable() {
                    return this.__variable;
                }
                __processVariable() {
                    this.__processLit();
                    // A pending confirm was asked for the old value
                    if (Confirm.isOpenFor(this)) {
                        Confirm.close();
                    }
                }
                /* ---------- OnBackgroundColor ---------- */
                setOnBackgroundColor(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toObject(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('OnBackgroundColor');
                    }
                    if (this.__onBackgroundColor !== undefined &&
                        JSON.stringify(convertedValue) === JSON.stringify(this.__onBackgroundColor)) {
                        return;
                    }
                    this.__onBackgroundColor = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'OnBackgroundColor' });
                    this.__processOnBackgroundColor();
                }
                getOnBackgroundColor() {
                    return this.__onBackgroundColor;
                }
                // Inline variables on the template root win over the theme; none set = the theme's cyan.
                // The confirm dialog (outside the control) copies them when it opens.
                __processOnBackgroundColor() {
                    const style = this.__elementTemplateRoot[0].style;
                    const value = this.__onBackgroundColor;
                    const rgb = value && TcHmi.isSolidColor(value) ? parseColor(value.color) : null;
                    if (value && !rgb) {
                        TcHmi.Log.warnEx('[ButtonSetData] ' + this.__id + ': OnBackgroundColor is not a usable colour, the theme colour is used.');
                    }
                    if (!rgb) {
                        GLASS_VARIABLES.forEach(name => style.removeProperty(name));
                        return;
                    }
                    const glass = glassOf(rgb);
                    GLASS_VARIABLES.forEach(name => style.setProperty(name, glass[name]));
                }
                /* ---------- ButtonBackgroundColor ---------- */
                setButtonBackgroundColor(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toObject(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('ButtonBackgroundColor');
                    }
                    if (this.__buttonBackgroundColor !== undefined &&
                        JSON.stringify(convertedValue) === JSON.stringify(this.__buttonBackgroundColor)) {
                        return;
                    }
                    this.__buttonBackgroundColor = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'ButtonBackgroundColor' });
                    this.__processButtonBackgroundColor();
                }
                getButtonBackgroundColor() {
                    return this.__buttonBackgroundColor;
                }
                // Same as OnBackgroundColor: inline variables win over the theme; none set = the theme keycap.
                __processButtonBackgroundColor() {
                    const style = this.__elementTemplateRoot[0].style;
                    const value = this.__buttonBackgroundColor;
                    const rgb = value && TcHmi.isSolidColor(value) ? parseColor(value.color) : null;
                    if (value && !rgb) {
                        TcHmi.Log.warnEx('[ButtonSetData] ' + this.__id + ': ButtonBackgroundColor is not a usable colour, the theme colour is used.');
                    }
                    if (!rgb) {
                        KEY_VARIABLES.forEach(name => style.removeProperty(name));
                        return;
                    }
                    const key = keyOf(rgb);
                    KEY_VARIABLES.forEach(name => style.setProperty(name, key[name]));
                }
                /** @internal The OnBackgroundColor / ButtonBackgroundColor variables, for the confirm dialog. */
                __glassStyle() {
                    return this.__elementTemplateRoot[0].style;
                }
                /* ---------- ShowBackground ---------- */
                setShowBackground(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toBoolean(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('ShowBackground');
                    }
                    if (convertedValue === this.__showBackground) {
                        return;
                    }
                    this.__showBackground = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'ShowBackground' });
                    this.__processLit();
                }
                getShowBackground() {
                    return this.__showBackground;
                }
                // Lit (glass bulb) = ShowBackground when it is set or bound (bound and not read yet: off),
                // else the value of Variable. Both button types.
                __processLit() {
                    let lit;
                    if (this.__showBackground === true || this.__showBackground === false) {
                        lit = this.__showBackground;
                    }
                    else if (TcHmi.Binding.resolve('ShowBackground', this)) {
                        lit = false;
                    }
                    else {
                        lit = this.__variable === true;
                    }
                    this.__elementTemplateRoot.toggleClass('sdf-btn-on', lit);
                    // A toggle that is TRUE stays pushed in, like a latching push button.
                    this.__elementTemplateRoot.toggleClass('sdf-btn-latched', this.__isToggle() && this.__variable === true);
                }
                /* ---------- ButtonText ---------- */
                setButtonText(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('ButtonText');
                    }
                    if (convertedValue === this.__buttonText) {
                        return;
                    }
                    this.__buttonText = convertedValue || '';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'ButtonText' });
                    this.__elementLabel.textContent = this.__buttonText;
                    this.__elementTemplateRoot.toggleClass('sdf-btn-no-label', !this.__buttonText);
                }
                getButtonText() {
                    return this.__buttonText;
                }
                /* ---------- Icon ---------- */
                setIcon(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('Icon');
                    }
                    if (convertedValue === this.__icon) {
                        return;
                    }
                    this.__icon = convertedValue || null;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'Icon' });
                    this.__processIcon();
                }
                getIcon() {
                    return this.__icon;
                }
                // The image as it is, in its own colours, also when locked.
                __processIcon() {
                    const url = this.__icon ? 'url("' + this.__icon.replace(/"/g, '\\"') + '")' : '';
                    this.__elementIcon.style.backgroundImage = url;
                    this.__elementTemplateRoot.toggleClass('sdf-btn-has-icon', !!this.__icon);
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
                /* ---------- Lock ---------- */
                setLock(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toBoolean(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('Lock');
                    }
                    if (convertedValue === this.__lock) {
                        return;
                    }
                    this.__lock = !!convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'Lock' });
                    this.__processLock();
                }
                getLock() {
                    return this.__lock;
                }
                // A lock with a description: blue "lock + i" badge, a tap shows the description.
                __processLock() {
                    const hint = !!this.__lock && !!this.__lockDescription;
                    this.__elementTemplateRoot.toggleClass('sdf-btn-locked', !!this.__lock);
                    this.__elementTemplateRoot.toggleClass('sdf-btn-has-hint', hint);
                    if (this.__lock) {
                        this.__release(false); // locked while held
                        if (Confirm.isOpenFor(this)) {
                            Confirm.close();
                        }
                    }
                    if (Hint.isOpenFor(this)) {
                        Hint.close(); // gone, or a new text (e.g. language switch): shown on the next tap
                    }
                }
                /* ---------- LockDescription ---------- */
                setLockDescription(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('LockDescription');
                    }
                    if (convertedValue === this.__lockDescription) {
                        return;
                    }
                    this.__lockDescription = (convertedValue || '').trim();
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'LockDescription' });
                    this.__processLock();
                }
                getLockDescription() {
                    return this.__lockDescription;
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
                    this.__processHide();
                }
                getHide() {
                    return this.__hide;
                }
                // Collapsed: a class on the control element (Style.css), so the Visibility attribute stays untouched.
                __processHide() {
                    this.__element.toggleClass('sdf-btn-hidden', !!this.__hide);
                    if (this.__hide) {
                        this.__release(false);
                        this.__closePopups();
                    }
                }
                /* ---------- NeedConfirm (Toggle only) ---------- */
                // Read on the next click: nothing to process.
                setNeedConfirm(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('NeedConfirm');
                    }
                    if (convertedValue === this.__needConfirm) {
                        return;
                    }
                    this.__needConfirm = convertedValue || 'None';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'NeedConfirm' });
                }
                getNeedConfirm() {
                    return this.__needConfirm;
                }
                /* ---------- ToggleGroup ---------- */
                // Read when a member is switched ON: nothing to process.
                setToggleGroup(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('ToggleGroup');
                    }
                    const group = (convertedValue || '').trim();
                    if (group === this.__toggleGroup) {
                        return;
                    }
                    this.__toggleGroup = group;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'ToggleGroup' });
                }
                getToggleGroup() {
                    return this.__toggleGroup;
                }
                /* ---------- AuditTrail ---------- */
                setAuditTrail(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toBoolean(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('AuditTrail');
                    }
                    if (convertedValue === this.__auditTrail) {
                        return;
                    }
                    this.__auditTrail = !!convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'AuditTrail' });
                }
                getAuditTrail() {
                    return this.__auditTrail;
                }
                /* ---------- SizeStyle and the Custom values ---------- */
                setSizeStyle(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('SizeStyle');
                    }
                    if (convertedValue === this.__sizeStyle) {
                        return;
                    }
                    this.__sizeStyle = convertedValue || 'Default';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'SizeStyle' });
                    this.__processSize();
                }
                getSizeStyle() {
                    return this.__sizeStyle;
                }
                setCustomWidth(valueNew) {
                    this.__setCustom('CustomWidth', '__customWidth', valueNew);
                }
                getCustomWidth() {
                    return this.__customWidth;
                }
                setCustomHeight(valueNew) {
                    this.__setCustom('CustomHeight', '__customHeight', valueNew);
                }
                getCustomHeight() {
                    return this.__customHeight;
                }
                setCustomFontSize(valueNew) {
                    this.__setCustom('CustomFontSize', '__customFontSize', valueNew);
                }
                getCustomFontSize() {
                    return this.__customFontSize;
                }
                setIconSize(valueNew) {
                    this.__setCustom('IconSize', '__iconSize', valueNew);
                }
                getIconSize() {
                    return this.__iconSize;
                }
                setCustomCornerRadius(valueNew) {
                    this.__setCustom('CustomCornerRadius', '__customCornerRadius', valueNew);
                }
                getCustomCornerRadius() {
                    return this.__customCornerRadius;
                }
                setIconPosition(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('IconPosition');
                    }
                    if (convertedValue === this.__iconPosition) {
                        return;
                    }
                    this.__iconPosition = convertedValue || 'Auto';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'IconPosition' });
                    this.__processSize();
                }
                getIconPosition() {
                    return this.__iconPosition;
                }
                // The Custom numbers share one setter body: px, never negative.
                __setCustom(name, field, valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toNumber(valueNew);
                    if (convertedValue === null || !isFinite(convertedValue)) {
                        convertedValue = this.getAttributeDefaultValueInternal(name);
                    }
                    const value = Math.max(0, convertedValue || 0);
                    if (value === this[field]) {
                        return;
                    }
                    this[field] = value;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: name });
                    this.__processSize();
                }
                __size() {
                    const preset = SIZES[this.__sizeStyle || 'Default'];
                    if (preset) {
                        // IconSize applies to every SizeStyle (icon-only buttons)
                        return { ...preset, iconSize: this.__iconSize ?? preset.iconSize, iconTop: this.__iconLayout() === 'Top' };
                    }
                    return {
                        width: this.__customWidth || 0,
                        height: this.__customHeight || 0,
                        fontSize: this.__customFontSize || 0,
                        iconSize: this.__iconSize || 0,
                        radius: this.__customCornerRadius || 0,
                        iconTop: this.__iconLayout() === 'Top'
                    };
                }
                // IconPosition for every SizeStyle; Auto = the preset (Small: Top, else Left).
                __iconLayout() {
                    const position = this.__iconPosition || 'Auto';
                    if (position !== 'Auto') {
                        return position;
                    }
                    return this.__sizeStyle === 'Small' ? 'Top' : 'Left';
                }
                // Sizes as variables on the template root (Style.css); TextWidth in % depends on the width.
                __processSize() {
                    const size = this.__size();
                    const root = this.__elementTemplateRoot[0];
                    root.style.setProperty('--sdf-btn-width', size.width + 'px');
                    root.style.setProperty('--sdf-btn-height', size.height + 'px');
                    root.style.setProperty('--sdf-btn-font-size', size.fontSize + 'px');
                    root.style.setProperty('--sdf-btn-icon-size', size.iconSize + 'px');
                    root.style.setProperty('--sdf-btn-radius', size.radius + 'px');
                    this.__elementTemplateRoot.toggleClass('sdf-btn-icon-top', size.iconTop);
                    const layout = this.__iconLayout();
                    this.__elementTemplateRoot.toggleClass('sdf-btn-icon-edge', layout === 'LeftEdge' || layout === 'RightEdge');
                    this.__elementTemplateRoot.toggleClass('sdf-btn-icon-right', layout === 'RightEdge');
                    this.__elementTemplateRoot.toggleClass('sdf-btn-small', this.__sizeStyle === 'Small');
                    this.__processMinSize();
                }
                // The control is never smaller than the button (+ the Text when its width is in px).
                __processMinSize() {
                    if (this.__sizeStyle === undefined) {
                        return; // not compiled yet: __init calls it again
                    }
                    const size = this.__size();
                    const textWidth = this.__textWidth;
                    const text = this.__textWidthUnit === 'px' && textWidth && textWidth > 0 ? textWidth + TEXT_GAP : 0;
                    if (this.getMinWidth() !== size.width + text || this.getMinWidthUnit() !== 'px') {
                        this.setMinWidth(size.width + text);
                        this.setMinWidthUnit('px');
                    }
                    if (this.getMinHeight() !== size.height || this.getMinHeightUnit() !== 'px') {
                        this.setMinHeight(size.height);
                        this.setMinHeightUnit('px');
                    }
                }
                /* ---------- ButtonAlignment ---------- */
                setButtonAlignment(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('ButtonAlignment');
                    }
                    if (convertedValue === this.__buttonAlignment) {
                        return;
                    }
                    this.__buttonAlignment = convertedValue || 'Center';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'ButtonAlignment' });
                    this.__elementSlot.style.justifyContent = flexAlign(this.__buttonAlignment);
                }
                getButtonAlignment() {
                    return this.__buttonAlignment;
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
                // 0 (the default): no text and no gap, the button has the whole width.
                // In %: a share of the width the button leaves free, so 100% fills it exactly.
                __processTextWidth() {
                    const width = this.__textWidth;
                    const shown = width !== null && width !== undefined && isFinite(width) && width > 0;
                    this.__elementTemplateRoot.toggleClass('sdf-btn-no-text', !shown);
                    if (!shown) {
                        this.__elementText.style.width = '';
                    }
                    else if (this.__textWidthUnit === '%') {
                        this.__elementText.style.width =
                            'calc((100% - var(--sdf-btn-width) - var(--sdf-btn-gap)) * ' + width / 100 + ')';
                    }
                    else {
                        this.__elementText.style.width = width + 'px';
                    }
                    this.__processMinSize();
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
                /* ---------- OnText / OffText: confirm dialog pills (bind %l%...%/l% to localize) ---------- */
                // Shown the next time the dialog opens: nothing to process.
                setOnText(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('OnText');
                    }
                    const text = convertedValue || '';
                    if (text === this.__onText) {
                        return;
                    }
                    this.__onText = text;
                    this.__localizedOnText.set(text);
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'OnText' });
                }
                getOnText() {
                    return this.__onText;
                }
                setOffText(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('OffText');
                    }
                    const text = convertedValue || '';
                    if (text === this.__offText) {
                        return;
                    }
                    this.__offText = text;
                    this.__localizedOffText.set(text);
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'OffText' });
                }
                getOffText() {
                    return this.__offText;
                }
                /* ---------- confirm dialog labels (bind %l%...%/l% to localize) ---------- */
                // Shown the next time the dialog opens: nothing to process.
                setConfirmLabel(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('ConfirmLabel');
                    }
                    const label = convertedValue || '';
                    if (label === this.__confirmLabel) {
                        return;
                    }
                    this.__confirmLabel = label;
                    this.__localizedConfirmLabel.set(label);
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'ConfirmLabel' });
                }
                getConfirmLabel() {
                    return this.__confirmLabel;
                }
                setCancelLabel(valueNew) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('CancelLabel');
                    }
                    const label = convertedValue || '';
                    if (label === this.__cancelLabel) {
                        return;
                    }
                    this.__cancelLabel = label;
                    this.__localizedCancelLabel.set(label);
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'CancelLabel' });
                }
                getCancelLabel() {
                    return this.__cancelLabel;
                }
            }
            SetDataFramework.ButtonSetData = ButtonSetData;
        })(SetDataFramework = Controls.SetDataFramework || (Controls.SetDataFramework = {}));
    })(Controls = TcHmi.Controls || (TcHmi.Controls = {}));
})(TcHmi || (TcHmi = {}));
TcHmi.Controls.registerEx('ButtonSetData', 'TcHmi.Controls.SetDataFramework', TcHmi.Controls.SetDataFramework.ButtonSetData);
//# sourceMappingURL=ButtonSetData.js.map
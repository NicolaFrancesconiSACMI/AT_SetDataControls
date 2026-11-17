/*
 * BooleanSetData
 *
 * Shows a BOOL symbol as a switch (Text on the left, the switch on the right) and toggles it on press.
 * Pill switch, OFF = light grey, ON = blue; same lock states as NumericSetData.
 *
 * - Variable is bound to a BOOL symbol, e.g. %s%PLC1.MAIN.bPump%/s% (TwoWay).
 * - Press: writes the inverted value unless Hide, Lock, disabled or no "operate" right.
 *   Locked: shows LockDescription in a bubble, if set. No "operate" right: user lock in the knob, nothing opens.
 * - Layout: Text takes TextWidth (aligned by TextAlignment); the switch is 120 x 34 px,
 *   centred vertically and placed by ToggleAlignment in the remaining width.
 * - AuditTrail: after a write to a symbol, adds an entry via TcHmi.Functions.SUtils.CallServerFunction
 *   ('SacmiTcHmiAuditTrailExt.AddEntry'), if that function is loaded. Data is 1 / 0.
 *   Bound to a symbol it is written directly (to see a failed write) and setVariable is not called, else
 *   the TwoWay binding would write a second time: the switch moves when the value comes back through the
 *   binding. Unbound, Variable itself is set. A failed write blinks the switch.
 * - Unknown value (bound, not read yet): no knob, "-", presses are ignored.
 * - NeedConfirm: None / SwitchOn / SwitchOff / All. A matching press opens a confirm dialog
 *   (dimmed background) instead of writing; ✕ / Esc cancels, ✓ / Enter writes.
 * - Inside a user control a %pp% binding is followed to the real symbol.
 */
module TcHmi {
    export module Controls {
        export module SetDataFramework {

            // HorizontalAlignment -> flex justify-content.
            function flexAlign(alignment: string | undefined) {
                return alignment === 'Center' ? 'center' : alignment === 'Right' ? 'flex-end' : 'flex-start';
            }

            /* ---------- symbols (same as NumericSetData) ---------- */

            // Path tokens back to "::A::B" ("[0]" array tokens are appended as is).
            function pathOf(tokens: string[]) {
                let res = '';
                for (const token of tokens) {
                    res += token.charAt(0) === '[' ? token : '::' + token;
                }
                return res;
            }

            function nearestUserControlHost(control: TcHmi.Controls.System.baseTcHmiControl | null) {
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
            function resolveTarget(expression: string, control: TcHmi.Controls.System.baseTcHmiControl): string | null {
                let from: TcHmi.Controls.System.baseTcHmiControl | null = control;
                for (let depth = 0; depth < 10; depth++) {
                    const expr = new TcHmi.SymbolExpression(expression);
                    if (expr.getType() !== TcHmi.SymbolType.PartialParam) {
                        return expression;
                    }
                    let tokens = [expr.getNameEx() || ''].concat(expr.getPathTokensEx() || []);
                    let host = TcHmi.Controls.get(tokens[0]) || null;
                    if (host && host.getType() === 'TcHmi.Controls.System.TcHmiUserControlHost') {
                        tokens = tokens.slice(1);
                    } else {
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

            /* ---------- confirm dialog ---------- */

            // One dialog per page, built on first use and shown centred in the TopMostLayer.
            // The background is dimmed: a confirmation is pending.
            class Confirm {
                private static __el: HTMLElement | null = null;
                private static __owner: BooleanSetData | null = null;
                private static __value = false;
                private static __userWatch = false;

                private static __q<E extends HTMLElement = HTMLElement>(selector: string) {
                    return Confirm.__el!.querySelector(selector) as E;
                }

                private static __build() {
                    const el = document.createElement('div');
                    el.className = 'sdf-bcf';
                    el.innerHTML =
                        '<div class="sdf-bcf-title"><span class="sdf-bcf-title-text"></span>' +
                        '<button type="button" class="sdf-bcf-close" data-key="Escape" aria-label="Close">✕</button></div>' +
                        '<div class="sdf-bcf-body"><span class="sdf-bcf-pill sdf-bcf-from"></span>' +
                        '<span class="sdf-bcf-arrow">→</span><span class="sdf-bcf-pill sdf-bcf-to"></span></div>' +
                        '<div class="sdf-bcf-buttons">' +
                        '<button type="button" class="sdf-bcf-button sdf-bcf-cancel" data-key="Escape"></button>' +
                        '<button type="button" class="sdf-bcf-button sdf-bcf-accent" data-key="Enter"></button></div>';

                    el.addEventListener('pointerdown', e => {
                        e.preventDefault(); // no focus, no text selection
                        const button = (e.target as HTMLElement).closest('[data-key]') as HTMLElement | null;
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
                        const button = (e.target as HTMLElement).closest('[data-key]') as HTMLElement | null;
                        if (button) {
                            Confirm.__onKey(button.getAttribute('data-key')!);
                        }
                    });
                    return el;
                }

                private static __onKeyDown = (e: KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === 'Escape') {
                        e.preventDefault();
                        Confirm.__onKey(e.key);
                    }
                };

                private static __onKey(key: string) {
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

                public static isOpenFor(owner: BooleanSetData) {
                    return Confirm.__owner === owner;
                }

                public static open(owner: BooleanSetData, value: boolean, text: string, onText: string, offText: string,
                    confirmLabel: string, cancelLabel: string) {
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

                    const from = Confirm.__q('.sdf-bcf-from');
                    const to = Confirm.__q('.sdf-bcf-to');
                    Confirm.__q('.sdf-bcf-title-text').textContent = text;
                    from.textContent = value ? offText : onText;
                    from.classList.toggle('sdf-bcf-on', !value);
                    to.textContent = value ? onText : offText;
                    to.classList.toggle('sdf-bcf-on', value);
                    Confirm.__q('.sdf-bcf-cancel').textContent = cancelLabel;
                    Confirm.__q('.sdf-bcf-accent').textContent = confirmLabel;

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

                public static close() {
                    const owner = Confirm.__owner;
                    Confirm.__owner = null;
                    document.removeEventListener('keydown', Confirm.__onKeyDown, true);
                    if (owner && Confirm.__el) {
                        TcHmi.TopMostLayer.remove(owner, Confirm.__el);
                    }
                }
            }

            /* ---------- lock hint (same as NumericSetData) ---------- */

            // One bubble per page with the Lock Description, next to the switch, in the TopMostLayer.
            // Modal with closeOnBackground: any tap closes it, also a second tap on the same switch.
            class Hint {
                private static __el: HTMLElement | null = null;
                private static __owner: BooleanSetData | null = null;
                private static __token = 0;
                private static __timer: number | null = null;

                public static isOpenFor(owner: BooleanSetData) {
                    return Hint.__owner === owner;
                }

                public static open(owner: BooleanSetData, anchor: HTMLElement, text: string) {
                    if (Hint.__owner) {
                        Hint.close();
                    }
                    if (!Hint.__el) {
                        Hint.__el = document.createElement('div');
                        Hint.__el.className = 'sdf-bsd-tip';
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

                public static close() {
                    const owner = Hint.__owner;
                    Hint.__reset();
                    if (owner && Hint.__el) {
                        TcHmi.TopMostLayer.remove(owner, Hint.__el);
                    }
                }

                private static __reset() {
                    Hint.__token++;
                    Hint.__owner = null;
                    if (Hint.__timer !== null) {
                        window.clearTimeout(Hint.__timer);
                        Hint.__timer = null;
                    }
                }

                // Centred above the switch, below it when there is no room above; kept inside the layer.
                // The arrow keeps pointing at the switch centre when the bubble is pushed aside.
                private static __place(anchor: HTMLElement) {
                    const el = Hint.__el!;
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
                    el.classList.toggle('sdf-bsd-tip-below', !above);
                    el.style.left = Math.round((left - rect.left) / scale) + 'px';
                    el.style.top = Math.round((top - rect.top) / scale) + 'px';
                    el.style.setProperty('--sdf-tip-arrow-x', Math.round((centre - left) / scale) + 'px');
                }
            }

            /* ---------- localized default texts (same in every SetDataFramework control) ---------- */

            // A "%l%Key%/l%" value (the Description.json defaults) is looked up in the project localization and
            // follows a language change; the key itself is shown when the project has no text for it.
            // Any other value (a literal, or a binding the framework has already resolved) is shown as is.
            // Watched from set() until stop(); __attach starts it again after a __detach.
            class LocalizedText {
                public text = '';
                private __key: string | null = null;
                private __destroy: TcHmi.DestroyFunction | null = null;

                constructor(private readonly __onChange: () => void) { }

                public set(value: string) {
                    this.stop();
                    const match = /^%l%(.+)%\/l%$/.exec(value);
                    this.__key = match ? match[1] : null;
                    this.text = this.__key === null ? value : this.__key; // the key until the text is read
                    this.start();
                }

                public start() {
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

                public stop() {
                    if (this.__destroy) {
                        this.__destroy();
                        this.__destroy = null;
                    }
                }
            }

            /* ---------- control ---------- */

            export class BooleanSetData extends TcHmi.Controls.System.TcHmiControl {

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
                protected __elementSwitch!: HTMLElement;
                protected __elementLabel!: HTMLElement;

                protected __variable: boolean | null | undefined;
                protected __lock: boolean | undefined;
                protected __lockDescription: string | undefined;
                protected __hide: boolean | undefined;
                protected __textWidth: number | null | undefined;
                protected __textWidthUnit: string | undefined;
                protected __textAlignment: string | undefined;
                protected __toggleAlignment: string | undefined;
                protected __auditTrail: boolean | undefined;
                protected __text: string | undefined;
                protected __onText: string | undefined;
                protected __offText: string | undefined;
                protected __needConfirm: BooleanSetData.NeedConfirm | undefined;
                protected __confirmLabel: string | undefined;
                protected __cancelLabel: string | undefined;
                // Shown texts of OnText / OffText / ConfirmLabel / CancelLabel; created in __previnit, before the setters.
                protected __localizedOnText!: LocalizedText;
                protected __localizedOffText!: LocalizedText;
                protected __localizedConfirmLabel!: LocalizedText;
                protected __localizedCancelLabel!: LocalizedText;

                protected __busy = false; // write running

                protected __onPressed = () => this.__press();
                protected __onErrorEnd = () => this.__elementSwitch.classList.remove('sdf-bsd-error');

                public __previnit() {
                    this.__elementTemplateRoot = this.__element.find('.TcHmi_Controls_SetDataFramework_BooleanSetData-Template');
                    if (this.__elementTemplateRoot.length === 0) {
                        throw new Error('Invalid Template.html');
                    }
                    const root = this.__elementTemplateRoot[0];
                    this.__elementText = root.querySelector('.sdf-bsd-text') as HTMLElement;
                    this.__elementSlot = root.querySelector('.sdf-bsd-slot') as HTMLElement;
                    this.__elementSwitch = root.querySelector('.sdf-bsd-switch') as HTMLElement;
                    this.__elementLabel = root.querySelector('.sdf-bsd-label') as HTMLElement;
                    this.__localizedOnText = new LocalizedText(() => this.__processLabel());
                    this.__localizedOffText = new LocalizedText(() => this.__processLabel());
                    // Read when the dialog opens: nothing to process.
                    this.__localizedConfirmLabel = new LocalizedText(() => { });
                    this.__localizedCancelLabel = new LocalizedText(() => { });
                    super.__previnit();
                }

                public __init() {
                    super.__init();
                }

                public __attach() {
                    super.__attach();
                    this.__elementSwitch.addEventListener('click', this.__onPressed);
                    this.__elementSwitch.addEventListener('animationend', this.__onErrorEnd);
                    this.__localizedTexts().forEach(t => t.start());
                }

                public __detach() {
                    super.__detach();
                    this.__elementSwitch.removeEventListener('click', this.__onPressed);
                    this.__elementSwitch.removeEventListener('animationend', this.__onErrorEnd);
                    this.__localizedTexts().forEach(t => t.stop());
                    this.__closePopups();
                }

                public destroy() {
                    if (this.__keepAlive) {
                        return;
                    }
                    this.__localizedTexts().forEach(t => t.stop());
                    this.__closePopups();
                    super.destroy();
                }

                protected __localizedTexts() {
                    return [this.__localizedOnText, this.__localizedOffText, this.__localizedConfirmLabel, this.__localizedCancelLabel];
                }

                protected __closePopups() {
                    if (Confirm.isOpenFor(this)) {
                        Confirm.close();
                    }
                    if (Hint.isOpenFor(this)) {
                        Hint.close();
                    }
                }

                /** The real symbol bound to Variable, null if Variable is not bound to a symbol. */
                protected __target(): string | null {
                    const expression = TcHmi.Binding.resolve('Variable', this);
                    if (!expression) {
                        return null;
                    }
                    try {
                        return resolveTarget(expression, this);
                    } catch (e) {
                        return null; // unparsable expression
                    }
                }

                protected __press() {
                    // No "operate" right (user lock): silent, also when locked with a description.
                    if (this.__hide || this.__busy || !this.getIsEnabled() || TcHmi.Access.checkAccess(this, 'operate') === false) {
                        return;
                    }
                    if (this.__lock) {
                        if (this.__lockDescription) {
                            Hint.open(this, this.__elementSwitch, this.__lockDescription);
                        }
                        return;
                    }
                    const known = this.__variable === true || this.__variable === false;
                    if (!known && this.__target()) {
                        return; // bound, value not read yet
                    }
                    const value = !this.__variable;
                    const need = this.__needConfirm || 'None';
                    if (need === 'All' || (need === 'SwitchOn' && value) || (need === 'SwitchOff' && !value)) {
                        Confirm.open(this, value, this.__text || '', this.__localizedOnText.text, this.__localizedOffText.text,
                            this.__localizedConfirmLabel.text, this.__localizedCancelLabel.text);
                        return;
                    }
                    this.__write(value);
                }

                /** @internal Called by the confirm dialog. */
                public __write(value: boolean) {
                    this.__elementSwitch.classList.remove('sdf-bsd-error');
                    const target = this.__target();
                    if (!target) {
                        this.setVariable(value);
                        this.__raiseValueWritten(value);
                        return;
                    }
                    this.__busy = true;
                    const oldValue = this.__variable; // the binding updates it only after the write
                    TcHmi.Symbol.writeEx(target, value, data => {
                        this.__busy = false;
                        if (data.error === TcHmi.Errors.NONE) {
                            this.__addAuditEntry(target, value, oldValue);
                            this.__raiseValueWritten(value);
                        } else {
                            TcHmi.Log.errorEx('[BooleanSetData] Writing ' + target + ' failed: ' +
                                (data.details && data.details.reason ? data.details.reason : data.error));
                            this.__blink();
                        }
                    });
                }

                // Restarts the animation if it is already blinking; removed on animationend.
                protected __blink() {
                    const el = this.__elementSwitch;
                    el.classList.remove('sdf-bsd-error');
                    void el.offsetWidth; // reflow, so a repeated error blinks from the start
                    el.classList.add('sdf-bsd-error');
                }

                protected __raiseValueWritten(value: boolean) {
                    TcHmi.EventProvider.raise(this.__id + '.onValueWritten', value);
                }

                // ControlId "Pump (PLC1.MAIN.bPump: FALSE -> TRUE)", Data 1 / 0.
                // TRUE / FALSE and not OnText / OffText: the trail must not depend on the language.
                // SUtils is looked up on every write: it may load after this control (dependency order is not fixed).
                protected __addAuditEntry(target: string, value: boolean, oldValue: boolean | null | undefined) {
                    if (!this.__auditTrail) {
                        return;
                    }
                    const sutils = (TcHmi.Functions as any).SUtils;
                    if (!sutils || typeof sutils.CallServerFunction !== 'function') {
                        TcHmi.Log.warnEx('[BooleanSetData] ' + this.__id + ': AuditTrail is on but TcHmi.Functions.SUtils.CallServerFunction is not available.');
                        return;
                    }
                    try {
                        const symbol = new TcHmi.SymbolExpression(target).getFullName() || target;
                        const oldText = oldValue === true ? 'TRUE' : oldValue === false ? 'FALSE' : '-';
                        const text = ' (' + symbol + ': ' + oldText + ' -> ' + (value ? 'TRUE' : 'FALSE') + ')';
                        const trail = {
                            ControlId: this.__text ? this.__text + text : text,
                            Type: 'BooleanSetData',
                            Username: TcHmi.Server.getCurrentUser() || 'no user',
                            // Must be a number: the extension stores it in a FLOAT column and GetEntries
                            // reads it with GetDouble, so a text row is saved but never shown.
                            Data: value ? 1 : 0,
                        };
                        sutils.CallServerFunction('SacmiTcHmiAuditTrailExt.AddEntry', trail, null, null);
                    } catch (e) {
                        TcHmi.Log.errorEx('[BooleanSetData] ' + this.__id + ': AuditTrail failed: ' + e);
                    }
                }

                /* ---------- Variable ---------- */

                public setVariable(valueNew: boolean | null) {
                    let convertedValue = TcHmi.ValueConverter.toBoolean(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('Variable');
                    }
                    if (convertedValue === this.__variable) {
                        return;
                    }
                    this.__variable = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'Variable' });
                    this.__processVariable();
                }

                public getVariable() {
                    return this.__variable;
                }

                // No value: neither on nor off, "-" and no knob.
                protected __processVariable() {
                    const value = this.__variable;
                    this.__elementTemplateRoot.toggleClass('sdf-bsd-on', value === true);
                    this.__elementTemplateRoot.toggleClass('sdf-bsd-off', value === false);
                    this.__processLabel();
                    // A pending confirm was asked for the old value
                    if (Confirm.isOpenFor(this)) {
                        Confirm.close();
                    }
                }

                protected __processLabel() {
                    const value = this.__variable;
                    this.__elementLabel.textContent =
                        value === true ? this.__localizedOnText.text : value === false ? this.__localizedOffText.text : '-';
                }

                /* ---------- Lock ---------- */

                public setLock(valueNew: boolean | null) {
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

                public getLock() {
                    return this.__lock;
                }

                // A lock with a description: lock with an "i" in the knob, the switch shows the description when tapped.
                protected __processLock() {
                    const hint = !!this.__lock && !!this.__lockDescription;
                    this.__elementTemplateRoot.toggleClass('sdf-bsd-locked', !!this.__lock);
                    this.__elementTemplateRoot.toggleClass('sdf-bsd-has-hint', hint);
                    if (this.__lock && Confirm.isOpenFor(this)) {
                        Confirm.close();
                    }
                    if (Hint.isOpenFor(this)) {
                        Hint.close(); // gone, or a new text (e.g. language switch): shown on the next tap
                    }
                }

                /* ---------- LockDescription ---------- */

                public setLockDescription(valueNew: string | null) {
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

                public getLockDescription() {
                    return this.__lockDescription;
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
                    this.__processHide();
                }

                public getHide() {
                    return this.__hide;
                }

                // Collapsed: a class on the control element (Style.css), so the Visibility attribute stays untouched.
                protected __processHide() {
                    this.__element.toggleClass('sdf-bsd-hidden', !!this.__hide);
                    if (this.__hide) {
                        this.__closePopups();
                    }
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
                    this.__processTextWidth();
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
                    this.__processTextWidth();
                }

                public getTextWidthUnit() {
                    return this.__textWidthUnit;
                }

                // In %: a share of the width the switch leaves free, so 100% fills it exactly.
                protected __processTextWidth() {
                    const width = this.__textWidth;
                    if (width === null || width === undefined || !isFinite(width)) {
                        this.__elementText.style.width = '';
                    } else if (this.__textWidthUnit === '%') {
                        this.__elementText.style.width =
                            'calc((100% - var(--sdf-bsd-box-width) - var(--sdf-bsd-gap)) * ' + width / 100 + ')';
                    } else {
                        this.__elementText.style.width = width + 'px';
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

                /* ---------- ToggleAlignment ---------- */

                public setToggleAlignment(valueNew: string | null) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('ToggleAlignment');
                    }
                    if (convertedValue === this.__toggleAlignment) {
                        return;
                    }
                    this.__toggleAlignment = convertedValue || 'Right';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'ToggleAlignment' });
                    this.__elementSlot.style.justifyContent = flexAlign(this.__toggleAlignment);
                }

                public getToggleAlignment() {
                    return this.__toggleAlignment;
                }

                /* ---------- AuditTrail ---------- */

                public setAuditTrail(valueNew: boolean | null) {
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

                public getAuditTrail() {
                    return this.__auditTrail;
                }

                /* ---------- OnText / OffText (bind %l%...%/l% to localize) ---------- */

                public setOnText(valueNew: string | null) {
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
                    this.__processLabel();
                }

                public getOnText() {
                    return this.__onText;
                }

                public setOffText(valueNew: string | null) {
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
                    this.__processLabel();
                }

                public getOffText() {
                    return this.__offText;
                }

                /* ---------- NeedConfirm ---------- */

                // Read on the next press: nothing to process.
                public setNeedConfirm(valueNew: BooleanSetData.NeedConfirm | null) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew) as BooleanSetData.NeedConfirm | null;
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('NeedConfirm');
                    }
                    if (convertedValue === this.__needConfirm) {
                        return;
                    }
                    this.__needConfirm = convertedValue || 'None';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'NeedConfirm' });
                }

                public getNeedConfirm() {
                    return this.__needConfirm;
                }

                /* ---------- confirm dialog labels (bind %l%...%/l% to localize) ---------- */

                // Shown the next time the dialog opens: nothing to process.
                public setConfirmLabel(valueNew: string | null) {
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

                public getConfirmLabel() {
                    return this.__confirmLabel;
                }

                public setCancelLabel(valueNew: string | null) {
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

                public getCancelLabel() {
                    return this.__cancelLabel;
                }
            }

            export module BooleanSetData {
                /** Which presses open the confirm dialog (Schema/Types.Schema.json). */
                export type NeedConfirm = 'None' | 'SwitchOn' | 'SwitchOff' | 'All';
            }
        }
    }
}

TcHmi.Controls.registerEx('BooleanSetData', 'TcHmi.Controls.SetDataFramework', TcHmi.Controls.SetDataFramework.BooleanSetData);

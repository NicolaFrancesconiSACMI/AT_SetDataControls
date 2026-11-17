/*
 * ComboboxSetData
 *
 * Text on the left and a drop down list in a value box on the right: the TcHmiCombobox data model
 * (SrcData id / text / value / category, EnumDataSymbol, SelectedIndex / SelectedId / SelectedValue / SelectedText,
 * ComboboxText) with the look and lock states of NumericSetData; by default the box is identical to it.
 *
 * - Layout: TextWidth / TextAlignment for the text, SetDataAlignment for the box, ComboboxWidth for its width
 *   (default 180 px like NumericSetData), ValueAlignment for the selected text inside it.
 * - Press: opens the list under the box (above it when there is no room) unless Hide, disabled or no "operate" right.
 *   Locked with a Lock Description: a tap shows it in a bubble. No "operate" right: user lock icon, silent.
 * - A pick is written to the first of: EnumDataSymbol, the symbol bound to SelectedValue (the entry value),
 *   to SelectedId (the id), to SelectedIndex (the index). Bound attributes are not set here, so the TwoWay
 *   binding does not write a second time: the new value comes back through the binding. Unbound, the
 *   attributes themselves are set.
 * - AuditTrail: after a successful write. Data is the entry value if it is a number, else the id / index written.
 * - Inside a user control a %pp% binding is followed to the real symbol.
 */
module TcHmi {
    export module Controls {
        export module SetDataFramework {

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

            /* ---------- layout ---------- */

            // HorizontalAlignment -> flex justify-content.
            function flexAlign(alignment: string | undefined) {
                return alignment === 'Center' ? 'center' : alignment === 'Right' ? 'flex-end' : 'flex-start';
            }

            // Same as --sdf-csd-gap in Style.css: needed as a number for ComboboxWidth in %.
            const BOX_GAP = 4;

            /* ---------- entries ---------- */

            interface ListItem {
                id: number;
                text: string;
                value: any;
                category: string | null;
                hide: boolean; // not in the drop down list (still shown in the box when it is the selected one)
                hideSymbol: string | null; // hide bound to a symbol (e.g. a PLC BOOL): watched in __watchTexts
            }

            // TRUE, 'true' or a number other than 0 (a symbol may deliver any of them).
            function asBool(value: any) {
                return value === true || value === 'true' || (typeof value === 'number' && value !== 0);
            }

            // SrcData like TcHmiCombobox: entries { id, text, value, category, hide }, a plain list of texts / numbers,
            // or an object { text: value }. A missing id is the index.
            function toItems(src: any): ListItem[] {
                const items: ListItem[] = [];
                if (Array.isArray(src)) {
                    src.forEach((e: any, i: number) => {
                        if (e !== null && typeof e === 'object') {
                            const hideSymbol = typeof e.hide === 'string' && TcHmi.Symbol.isSymbolExpression(e.hide) ? e.hide : null;
                            items.push({
                                id: typeof e.id === 'number' ? e.id : i,
                                text: e.text === null || e.text === undefined ? '' : String(e.text),
                                value: e.value === undefined ? null : e.value,
                                category: typeof e.category === 'string' && e.category ? e.category : null,
                                // Bound: hidden until the symbol delivers its value (no entry pickable by mistake).
                                hide: hideSymbol ? true : asBool(e.hide),
                                hideSymbol: hideSymbol
                            });
                        } else if (e !== null && e !== undefined) {
                            items.push({ id: i, text: String(e), value: e, category: null, hide: false, hideSymbol: null });
                        }
                    });
                } else if (src && typeof src === 'object') {
                    Object.keys(src).forEach((key, i) =>
                        items.push({ id: i, text: key, value: src[key], category: null, hide: false, hideSymbol: null }));
                }
                return items;
            }

            // Enumeration schema of the server: enum = the values, options = { label, value } for the texts.
            function enumItems(schema: any): ListItem[] | null {
                if (!schema || !Array.isArray(schema.enum)) {
                    return null;
                }
                const options: any[] = Array.isArray(schema.options) ? schema.options : [];
                return schema.enum.map((value: any, i: number) => {
                    const option = options.filter(o => o && o.value === value)[0];
                    return { id: i, text: option ? String(option.label) : String(value), value: value, category: null, hide: false, hideSymbol: null };
                });
            }

            // "2" and 2 are the same entry (a symbol may deliver either).
            function sameValue(a: any, b: any) {
                if (a === b) {
                    return true;
                }
                if (a === null || a === undefined || b === null || b === undefined) {
                    return false;
                }
                return typeof a !== 'object' && typeof b !== 'object' && String(a) === String(b);
            }

            // A number or a numeric text: what the audit trail can store.
            function asNumber(value: any): number | null {
                if (typeof value === 'number') {
                    return isFinite(value) ? value : null;
                }
                if (typeof value === 'string' && value.trim() !== '') {
                    const n = Number(value);
                    return isFinite(n) ? n : null;
                }
                return null;
            }

            function escapeHtml(text: string) {
                return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            }

            /* ---------- drop down list ---------- */

            // One list per page, under the value box, in the TopMostLayer.
            // Modal with closeOnBackground: a tap beside it closes it (canceled), also a second tap on the box.
            class Dropdown {
                private static __el: HTMLElement | null = null;
                private static __owner: ComboboxSetData | null = null;
                private static __token = 0;
                private static __anchor: HTMLElement | null = null;
                private static __maxHeight = 280;
                private static __userWatch = false;

                private static __onKeyDown = (e: KeyboardEvent) => {
                    if (e.key === 'Escape' && Dropdown.__owner) {
                        e.preventDefault();
                        const owner = Dropdown.__owner;
                        Dropdown.close();
                        owner.__raiseCanceled();
                    }
                };

                public static isOpenFor(owner: ComboboxSetData) {
                    return Dropdown.__owner === owner;
                }

                public static open(owner: ComboboxSetData, anchor: HTMLElement, items: ListItem[], selected: number, maxHeight: number) {
                    if (!Dropdown.__userWatch) {
                        // Another user logged in (or auto-logout): nothing opened by the previous user stays open.
                        Dropdown.__userWatch = true;
                        TcHmi.EventProvider.register('onUserChanged', () => {
                            const owner = Dropdown.__owner;
                            if (owner) {
                                Dropdown.close();
                                owner.__raiseCanceled();
                            }
                        });
                    }
                    if (Dropdown.__owner) {
                        Dropdown.close();
                    }
                    if (!Dropdown.__el) {
                        Dropdown.__el = Dropdown.__build();
                    }
                    const el = Dropdown.__el;
                    const token = ++Dropdown.__token;
                    Dropdown.__owner = owner;
                    Dropdown.__render(items, selected);
                    Dropdown.__anchor = anchor;
                    Dropdown.__maxHeight = maxHeight;

                    TcHmi.TopMostLayer.add(owner, el, {
                        dimBackground: false,
                        modal: true,
                        closeOnBackground: true,
                        resizeCb: () => Dropdown.close(),
                        removeCb: () => {
                            // Removed by a tap beside it: canceled.
                            if (token === Dropdown.__token) {
                                Dropdown.__reset();
                                owner.__raiseCanceled();
                            }
                        }
                    });
                    Dropdown.__place(anchor, maxHeight);
                    const row = el.querySelector('.sdf-cdd-selected') as HTMLElement | null;
                    if (row) {
                        el.scrollTop = Math.max(0, row.offsetTop - (el.clientHeight - row.offsetHeight) / 2);
                    }
                    document.addEventListener('keydown', Dropdown.__onKeyDown, true);
                }

                public static close() {
                    const owner = Dropdown.__owner;
                    Dropdown.__reset();
                    if (owner && Dropdown.__el) {
                        TcHmi.TopMostLayer.remove(owner, Dropdown.__el);
                    }
                }

                // Texts changed while open (translation arrived, language switch): same list, new texts.
                public static redraw(items: ListItem[], selected: number) {
                    const el = Dropdown.__el;
                    if (!el || !Dropdown.__owner || !Dropdown.__anchor) {
                        return;
                    }
                    const scroll = el.scrollTop;
                    Dropdown.__render(items, selected);
                    el.style.maxHeight = '';
                    Dropdown.__place(Dropdown.__anchor, Dropdown.__maxHeight);
                    el.scrollTop = scroll;
                }

                private static __reset() {
                    const owner = Dropdown.__owner;
                    Dropdown.__token++;
                    Dropdown.__owner = null;
                    document.removeEventListener('keydown', Dropdown.__onKeyDown, true);
                    if (owner) {
                        owner.__setOpen(false);
                    }
                }

                private static __build() {
                    const el = document.createElement('div');
                    el.className = 'sdf-cdd';
                    // Absolute from the start: the layer it sits in is not the full screen (see Hint).
                    el.style.position = 'absolute';
                    // click, not pointerdown: a finger dragging the list scrolls it instead of picking.
                    el.addEventListener('click', e => {
                        const row = (e.target as HTMLElement).closest('[data-index]') as HTMLElement | null;
                        const owner = Dropdown.__owner;
                        if (!row || !owner) {
                            return;
                        }
                        const index = Number(row.getAttribute('data-index'));
                        Dropdown.close();
                        owner.__choose(index);
                    });
                    el.addEventListener('pointerdown', e => {
                        const row = (e.target as HTMLElement).closest('[data-index]');
                        if (row) {
                            row.classList.add('down');
                        }
                    });
                    const up = () => el.querySelectorAll('.down').forEach(r => r.classList.remove('down'));
                    el.addEventListener('pointerup', up);
                    el.addEventListener('pointercancel', up);
                    el.addEventListener('pointerleave', up);
                    return el;
                }

                // Entries grouped by category: each category once, in order of first appearance, with all its entries
                // under it (indented), even when they are not next to each other in SrcData; entries without a
                // category last. Only the display order changes: data-index stays the SrcData index.
                // Hidden entries are left out (a category whose entries are all hidden has no label).
                private static __render(items: ListItem[], selected: number) {
                    const check = '<svg class="sdf-cdd-check" viewBox="0 0 24 24" aria-hidden="true">' +
                        '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>';
                    const row = (item: ListItem, i: number, grouped: boolean) =>
                        '<div class="sdf-cdd-item' + (grouped ? ' sdf-cdd-grouped' : '') + (i === selected ? ' sdf-cdd-selected' : '') +
                        '" data-index="' + i + '"><span class="sdf-cdd-item-text">' + escapeHtml(item.text) + '</span>' + check + '</div>';

                    const groups: { category: string; indexes: number[] }[] = [];
                    const loose: number[] = [];
                    items.forEach((item, i) => {
                        if (item.hide) {
                            return;
                        }
                        if (!item.category) {
                            loose.push(i);
                            return;
                        }
                        let group = groups.find(g => g.category === item.category);
                        if (!group) {
                            group = { category: item.category, indexes: [] };
                            groups.push(group);
                        }
                        group.indexes.push(i);
                    });

                    let html = '';
                    groups.forEach(group => {
                        html += '<div class="sdf-cdd-category">' + escapeHtml(group.category) + '</div>';
                        group.indexes.forEach(i => html += row(items[i], i, true));
                    });
                    if (groups.length && loose.length) {
                        html += '<div class="sdf-cdd-separator"></div>';
                    }
                    loose.forEach(i => html += row(items[i], i, false));
                    Dropdown.__el!.innerHTML = html || '<div class="sdf-cdd-empty">-</div>';
                }

                // Under the box, above it when there is no room below, else on the side with more room (scrolling).
                // As wide as the box, wider for long entries (max 360 px). Kept inside the visible screen.
                private static __place(anchor: HTMLElement, maxHeight: number) {
                    const el = Dropdown.__el!;
                    if (!el.parentElement) {
                        return;
                    }
                    el.style.left = '0px';
                    el.style.top = '0px';
                    el.style.maxHeight = maxHeight + 'px';
                    // Screen pixels -> layer pixels: the layer may be scaled.
                    const scale = (el.getBoundingClientRect().width / (el.offsetWidth || 1)) || 1;
                    const box = anchor.getBoundingClientRect();
                    const boxWidth = box.width / scale;
                    el.style.minWidth = boxWidth + 'px';
                    el.style.maxWidth = Math.max(boxWidth, 360) + 'px';

                    const rect = el.getBoundingClientRect();
                    const view = window.visualViewport;
                    const screenWidth = view ? view.width : window.innerWidth;
                    const screenHeight = view ? view.height : window.innerHeight;
                    const gap = 4 * scale;
                    const roomBelow = screenHeight - box.bottom - gap - 4;
                    const roomAbove = box.top - gap - 4;
                    const below = rect.height <= roomBelow || roomBelow >= roomAbove;
                    const height = Math.min(rect.height, below ? roomBelow : roomAbove);
                    if (height < rect.height) {
                        el.style.maxHeight = Math.max(40, height / scale) + 'px';
                    }
                    const finalHeight = el.getBoundingClientRect().height;
                    const left = Math.max(4, Math.min(screenWidth - rect.width - 4, box.left));
                    const top = below ? box.bottom + gap : box.top - gap - finalHeight;
                    el.style.left = Math.round((left - rect.left) / scale) + 'px';
                    el.style.top = Math.round((top - rect.top) / scale) + 'px';
                }
            }

            /* ---------- lock hint (same as NumericSetData) ---------- */

            // One bubble per page with the Lock Description, next to the value box, in the TopMostLayer.
            // Modal with closeOnBackground: any tap closes it, also a second tap on the same box.
            class Hint {
                private static __el: HTMLElement | null = null;
                private static __owner: ComboboxSetData | null = null;
                private static __token = 0;
                private static __timer: number | null = null;

                public static isOpenFor(owner: ComboboxSetData) {
                    return Hint.__owner === owner;
                }

                public static open(owner: ComboboxSetData, anchor: HTMLElement, text: string) {
                    if (Hint.__owner) {
                        Hint.close();
                    }
                    if (!Hint.__el) {
                        Hint.__el = document.createElement('div');
                        Hint.__el.className = 'sdf-csd-tip';
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

                // Centred above the box, below it when there is no room above; kept inside the layer.
                // The arrow keeps pointing at the box centre when the bubble is pushed aside.
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
                    el.classList.toggle('sdf-csd-tip-below', !above);
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

            type SelectBy = 'index' | 'id' | 'value';

            export class ComboboxSetData extends TcHmi.Controls.System.TcHmiControl {

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

                protected __srcData: any;
                protected __enumDataSymbol: TcHmi.Symbol | null | undefined;
                protected __comboboxText: string | undefined;
                /** Shown text of ComboboxText; created in __previnit, before the setters. */
                protected __localizedComboboxText!: LocalizedText;
                protected __maxListHeight: number | null | undefined;
                protected __lock: boolean | undefined;
                protected __lockDescription: string | undefined;
                protected __hide: boolean | undefined;
                protected __text: string | undefined;
                protected __comboboxWidth: number | null | undefined;
                protected __comboboxWidthUnit: string | undefined;
                protected __textWidth: number | null | undefined;
                protected __textWidthUnit: string | undefined;
                protected __textAlignment: string | undefined;
                protected __setDataAlignment: string | undefined;
                protected __valueAlignment: string | undefined;
                protected __auditTrail: boolean | undefined;

                /** Entries from SrcData, or from EnumDataSymbol when it is set. */
                protected __items: ListItem[] = [];
                protected __enumItems: ListItem[] | null = null;
                protected __enumValue: any = undefined;
                protected __destroyEnumWatch: TcHmi.DestroyFunction | null = null;
                /** The attribute that last chose the entry (SelectedIndex / SelectedId / SelectedValue) and its value. */
                protected __selectBy: SelectBy | null = null;
                protected __selectKey: any = null;
                /** Selected entry index, -1 for none, and the entry itself (to report a change of entry at the same index). */
                protected __selected = -1;
                protected __selectedItem: ListItem | null = null;
                protected __selectedText: string | null = null;
                /** Watches of the symbol expressions (%l%...%/l%) inside SrcData texts. */
                protected __textWatches: TcHmi.DestroyFunction[] = [];
                protected __redrawPending = false;
                protected __busy = false;

                protected __onPressed = () => this.__press();
                protected __onAnimationEnd = () => this.__elementValueBox.classList.remove('sdf-csd-error');

                public __previnit() {
                    this.__elementTemplateRoot = this.__element.find('.TcHmi_Controls_SetDataFramework_ComboboxSetData-Template');
                    if (this.__elementTemplateRoot.length === 0) {
                        throw new Error('Invalid Template.html');
                    }
                    const root = this.__elementTemplateRoot[0];
                    this.__elementText = root.querySelector('.sdf-csd-text') as HTMLElement;
                    this.__elementSlot = root.querySelector('.sdf-csd-slot') as HTMLElement;
                    this.__elementValueBox = root.querySelector('.sdf-csd-valuebox') as HTMLElement;
                    this.__elementValue = root.querySelector('.sdf-csd-value') as HTMLElement;
                    this.__localizedComboboxText = new LocalizedText(() => this.__render());
                    super.__previnit();
                }

                public __init() {
                    super.__init();
                    this.__render();
                }

                public __attach() {
                    super.__attach();
                    this.__elementValueBox.addEventListener('click', this.__onPressed);
                    this.__elementValueBox.addEventListener('animationend', this.__onAnimationEnd);
                    this.__watchEnum();
                    this.__localizedComboboxText.start();
                    if (!this.__textWatches.length) {
                        this.__processItems(); // texts unwatched by a previous __detach
                    }
                }

                public __detach() {
                    super.__detach();
                    this.__elementValueBox.removeEventListener('click', this.__onPressed);
                    this.__elementValueBox.removeEventListener('animationend', this.__onAnimationEnd);
                    this.__unwatchEnum();
                    this.__unwatchTexts();
                    this.__localizedComboboxText.stop();
                    this.__closePopups();
                }

                public destroy() {
                    if (this.__keepAlive) {
                        return;
                    }
                    this.__closePopups();
                    this.__unwatchEnum();
                    this.__unwatchTexts();
                    this.__localizedComboboxText.stop();
                    if (this.__enumDataSymbol) {
                        this.__enumDataSymbol.destroy();
                        this.__enumDataSymbol = null;
                    }
                    super.destroy();
                }

                protected __closePopups() {
                    if (Dropdown.isOpenFor(this)) {
                        Dropdown.close();
                    }
                    if (Hint.isOpenFor(this)) {
                        Hint.close();
                    }
                }

                /** The real symbol bound to an attribute, null if it is not bound to a symbol. */
                protected __targetOf(propertyName: string): string | null {
                    const expression = TcHmi.Binding.resolve(propertyName, this);
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
                            Hint.open(this, this.__elementValueBox, this.__lockDescription);
                        }
                        return;
                    }
                    if (Dropdown.isOpenFor(this)) {
                        Dropdown.close();
                        this.__raiseCanceled();
                        return;
                    }
                    this.__elementValueBox.classList.remove('sdf-csd-error');
                    const height = this.__maxListHeight;
                    Dropdown.open(this, this.__elementValueBox, this.__items, this.__selected,
                        height !== null && height !== undefined && isFinite(height) && height > 0 ? height : 280);
                    this.__setOpen(true);
                }

                /** @internal Called by the drop down. */
                public __setOpen(open: boolean) {
                    this.__elementTemplateRoot.toggleClass('sdf-csd-open', open);
                }

                /** @internal Called by the drop down. */
                public __raiseCanceled() {
                    TcHmi.EventProvider.raise(this.__id + '.onUserInteractionCanceled');
                }

                /** @internal Called by the drop down with the picked entry. */
                public __choose(index: number) {
                    const item = this.__items[index];
                    if (!item || item.hide || this.__lock || this.__busy) {
                        return;
                    }
                    if (index === this.__selected) {
                        TcHmi.EventProvider.raise(this.__id + '.onUserInteractionFinished');
                        return;
                    }
                    const old = this.__selected >= 0 ? this.__items[this.__selected] : null;

                    // Where the pick goes, and what is written there.
                    let target: string | null = null;
                    let written: any = null;
                    let enumSymbol: TcHmi.Symbol | null = null;
                    if (this.__enumDataSymbol) {
                        enumSymbol = this.__enumDataSymbol;
                        target = enumSymbol.getExpression().toString();
                        written = item.value;
                    } else if ((target = this.__targetOf('SelectedValue')) !== null) {
                        written = item.value;
                    } else if ((target = this.__targetOf('SelectedId')) !== null) {
                        written = item.id;
                    } else if ((target = this.__targetOf('SelectedIndex')) !== null) {
                        written = index;
                    }

                    if (target === null) {
                        // Unbound: the attributes themselves change.
                        this.__select('index', index);
                        this.__raiseWritten(item);
                        return;
                    }

                    this.__busy = true;
                    const done = (data: TcHmi.IResultObject) => {
                        this.__busy = false;
                        if (data.error === TcHmi.Errors.NONE) {
                            this.__addAuditEntry(target!, index, item, old, written);
                            this.__raiseWritten(item);
                        } else {
                            TcHmi.Log.errorEx('[ComboboxSetData] ' + this.__id + ': writing ' + target + ' failed: ' +
                                (data.details && data.details.reason ? data.details.reason : data.error));
                            this.__blink();
                        }
                    };
                    if (enumSymbol) {
                        enumSymbol.write(written, done);
                    } else {
                        TcHmi.Symbol.writeEx(target, written, done);
                    }
                }

                protected __raiseWritten(item: ListItem) {
                    TcHmi.EventProvider.raise(this.__id + '.onValueWritten', item.value);
                    TcHmi.EventProvider.raise(this.__id + '.onUserInteractionFinished');
                }

                // Restarts the animation if it is already blinking.
                protected __blink() {
                    const box = this.__elementValueBox;
                    box.classList.remove('sdf-csd-error');
                    void box.offsetWidth; // reflow
                    box.classList.add('sdf-csd-error');
                }

                // ControlId "Mode (PLC1.MAIN.nMode: Manual -> Auto)". Data must be a number: the extension stores it
                // in a FLOAT column, a text row is saved but never shown. Entry value if numeric, else the number written
                // (id / index), else the index.
                // SUtils is looked up on every write: it may load after this control (dependency order is not fixed).
                protected __addAuditEntry(target: string, index: number, item: ListItem, old: ListItem | null, written: any) {
                    if (!this.__auditTrail) {
                        return;
                    }
                    const sutils = (TcHmi.Functions as any).SUtils;
                    if (!sutils || typeof sutils.CallServerFunction !== 'function') {
                        TcHmi.Log.warnEx('[ComboboxSetData] ' + this.__id + ': AuditTrail is on but TcHmi.Functions.SUtils.CallServerFunction is not available.');
                        return;
                    }
                    try {
                        const symbol = new TcHmi.SymbolExpression(target).getFullName() || target;
                        const text = ' (' + symbol + ': ' + (old ? old.text : '-') + ' -> ' + item.text + ')';
                        let data = asNumber(item.value);
                        if (data === null) {
                            data = asNumber(written);
                        }
                        const trail = {
                            ControlId: this.__text ? this.__text + text : text,
                            Type: 'ComboboxSetData',
                            Username: TcHmi.Server.getCurrentUser() || 'no user',
                            Data: data === null ? index : data
                        };
                        sutils.CallServerFunction('SacmiTcHmiAuditTrailExt.AddEntry', trail, null, null);
                    } catch (e) {
                        TcHmi.Log.errorEx('[ComboboxSetData] ' + this.__id + ': AuditTrail failed: ' + e);
                    }
                }

                /* ---------- selection ---------- */

                // A setter with null only clears the selection it made itself: a bound attribute is first set to
                // null on init and must not clear what another attribute selected.
                protected __select(by: SelectBy, key: any) {
                    if (key === null || key === undefined) {
                        if (this.__selectBy !== by) {
                            return;
                        }
                        this.__selectBy = null;
                        this.__selectKey = null;
                    } else {
                        this.__selectBy = by;
                        this.__selectKey = key;
                    }
                    this.__render();
                }

                protected __resolveSelected(): number {
                    const items = this.__items;
                    if (this.__enumDataSymbol) {
                        if (this.__enumValue === undefined || this.__enumValue === null) {
                            return -1;
                        }
                        for (let i = 0; i < items.length; i++) {
                            if (sameValue(items[i].value, this.__enumValue)) {
                                return i;
                            }
                        }
                        return -1;
                    }
                    const key = this.__selectKey;
                    switch (this.__selectBy) {
                        case 'index':
                            return typeof key === 'number' && key >= 0 && key < items.length && Math.floor(key) === key ? key : -1;
                        case 'id':
                            for (let i = 0; i < items.length; i++) {
                                if (sameValue(items[i].id, key)) {
                                    return i;
                                }
                            }
                            return -1;
                        case 'value':
                            for (let i = 0; i < items.length; i++) {
                                if (sameValue(items[i].value, key)) {
                                    return i;
                                }
                            }
                            return -1;
                    }
                    return -1;
                }

                // Shows the selected text (or ComboboxText greyed). On a change: SelectedText and the selection
                // attributes that are not bound report the change (a bound one would write it back to its symbol),
                // and .onSelectionChanged fires.
                protected __render() {
                    if (!this.__elementValue) {
                        return;
                    }
                    const selected = this.__resolveSelected();
                    const item = selected >= 0 ? this.__items[selected] : null;
                    this.__elementValue.textContent = item ? item.text : this.__localizedComboboxText.text;
                    this.__elementTemplateRoot.toggleClass('sdf-csd-placeholder', !item);
                    // Only the text changed (e.g. translated): SelectedText reports it, the selection is the same.
                    const text = item ? item.text : null;
                    if (text !== this.__selectedText) {
                        this.__selectedText = text;
                        TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'SelectedText' });
                    }
                    const prev = this.__selectedItem;
                    const same = item === prev || (!!item && !!prev && item.id === prev.id && sameValue(item.value, prev.value));
                    this.__selected = selected;
                    this.__selectedItem = item;
                    if (same) {
                        return;
                    }
                    for (const name of ['SelectedIndex', 'SelectedId', 'SelectedValue']) {
                        if (!TcHmi.Binding.resolve(name, this)) {
                            TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: name });
                        }
                    }
                    TcHmi.EventProvider.raise(this.__id + '.onSelectionChanged');
                }

                protected __processItems() {
                    this.__items = this.__enumItems || toItems(this.__srcData);
                    this.__watchTexts();
                    if (Dropdown.isOpenFor(this)) {
                        Dropdown.close(); // the list changed under the operator's finger
                    }
                    this.__render(); // reports a change also when the same index is another entry now
                }

                // The framework resolves %l%...%/l% only in top-level attributes, not inside SrcData:
                // each text / category that is a symbol expression is watched here, so it is translated and
                // follows a language change (any other symbol, e.g. a PLC string, works the same way).
                // Shown empty until the first value arrives. Same for a hide bound to a symbol: the entry leaves /
                // joins the list (also while it is open) when the symbol changes.
                // Removed in __detach / destroy, rebuilt in __attach.
                protected __watchTexts() {
                    this.__unwatchTexts();
                    this.__items.forEach(item => {
                        if (item.hideSymbol) {
                            const symbol = new TcHmi.Symbol(item.hideSymbol);
                            const destroyWatch = symbol.watch(data => {
                                if (data.error !== TcHmi.Errors.NONE) {
                                    return;
                                }
                                const hide = asBool(data.value);
                                if (hide !== item.hide) {
                                    item.hide = hide;
                                    this.__textsChanged();
                                }
                            });
                            this.__textWatches.push(() => {
                                destroyWatch();
                                symbol.destroy();
                            });
                        }
                        for (const field of ['text', 'category'] as ('text' | 'category')[]) {
                            const raw = item[field];
                            if (!raw || !TcHmi.Symbol.isSymbolExpression(raw)) {
                                continue;
                            }
                            item[field] = '';
                            const symbol = new TcHmi.Symbol(raw);
                            const destroyWatch = symbol.watch(data => {
                                if (data.error !== TcHmi.Errors.NONE) {
                                    return;
                                }
                                item[field] = data.value === null || data.value === undefined ? '' : String(data.value);
                                this.__textsChanged();
                            });
                            this.__textWatches.push(() => {
                                destroyWatch();
                                symbol.destroy();
                            });
                        }
                    });
                }

                protected __unwatchTexts() {
                    this.__textWatches.forEach(destroy => destroy());
                    this.__textWatches = [];
                }

                // A translated text arrived (also on every language change). Several arrive at once on a switch:
                // the open list is redrawn once, in the next frame.
                protected __textsChanged() {
                    this.__render();
                    if (this.__redrawPending || !Dropdown.isOpenFor(this)) {
                        return;
                    }
                    this.__redrawPending = true;
                    window.requestAnimationFrame(() => {
                        this.__redrawPending = false;
                        if (Dropdown.isOpenFor(this)) {
                            Dropdown.redraw(this.__items, this.__selected);
                        }
                    });
                }

                /* ---------- SrcData ---------- */

                public setSrcData(valueNew: any) {
                    let convertedValue = valueNew;
                    if (typeof convertedValue === 'string') {
                        try {
                            convertedValue = JSON.parse(convertedValue);
                        } catch (e) {
                            convertedValue = null;
                        }
                    }
                    if (convertedValue === null || convertedValue === undefined) {
                        convertedValue = this.getAttributeDefaultValueInternal('SrcData');
                    }
                    if (convertedValue === this.__srcData) {
                        return;
                    }
                    this.__srcData = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'SrcData' });
                    this.__processItems();
                }

                public getSrcData() {
                    return this.__srcData;
                }

                /* ---------- EnumDataSymbol ---------- */

                public setEnumDataSymbol(valueNew: TcHmi.Symbol | null) {
                    let symbol: TcHmi.Symbol | null = valueNew instanceof TcHmi.Symbol ? valueNew : null;
                    if (valueNew === null) {
                        const expression = this.getAttributeDefaultValueInternal('EnumDataSymbol');
                        if (expression) {
                            symbol = new TcHmi.Symbol(expression);
                        }
                    }
                    if (symbol === this.__enumDataSymbol) {
                        return;
                    }
                    this.__unwatchEnum();
                    if (this.__enumDataSymbol) {
                        this.__enumDataSymbol.destroy();
                    }
                    this.__enumDataSymbol = symbol;
                    this.__enumItems = null;
                    this.__enumValue = undefined;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'EnumDataSymbol' });
                    this.__processItems();
                    if (!symbol) {
                        return;
                    }
                    const current = symbol;
                    current.resolveSchema(data => {
                        if (current !== this.__enumDataSymbol) {
                            return; // replaced meanwhile
                        }
                        const items = data.error === TcHmi.Errors.NONE ? enumItems(data.schema) : null;
                        if (!items) {
                            TcHmi.Log.errorEx('[ComboboxSetData] ' + this.__id + ': EnumDataSymbol ' +
                                current.getExpression().toString() + ' is not an enumeration.');
                            return;
                        }
                        this.__enumItems = items;
                        this.__processItems();
                    });
                    if (this.__isAttached) {
                        this.__watchEnum();
                    }
                }

                public getEnumDataSymbol() {
                    return this.__enumDataSymbol;
                }

                protected __watchEnum() {
                    const symbol = this.__enumDataSymbol;
                    if (!symbol || this.__destroyEnumWatch) {
                        return;
                    }
                    this.__destroyEnumWatch = symbol.watch(data => {
                        if (data.error !== TcHmi.Errors.NONE || symbol !== this.__enumDataSymbol) {
                            return;
                        }
                        this.__enumValue = data.value;
                        this.__render();
                    });
                }

                protected __unwatchEnum() {
                    if (this.__destroyEnumWatch) {
                        this.__destroyEnumWatch();
                        this.__destroyEnumWatch = null;
                    }
                }

                /* ---------- SelectedIndex / SelectedId / SelectedValue / SelectedText ---------- */

                public setSelectedIndex(valueNew: number | null) {
                    const convertedValue = TcHmi.ValueConverter.toNumber(valueNew);
                    this.__select('index', convertedValue);
                }

                public getSelectedIndex() {
                    return this.__selected >= 0 ? this.__selected : null;
                }

                public setSelectedId(valueNew: number | null) {
                    const convertedValue = TcHmi.ValueConverter.toNumber(valueNew);
                    this.__select('id', convertedValue);
                }

                public getSelectedId() {
                    return this.__selected >= 0 ? this.__items[this.__selected].id : null;
                }

                public setSelectedValue(valueNew: any) {
                    this.__select('value', valueNew === undefined ? null : valueNew);
                }

                public getSelectedValue() {
                    return this.__selected >= 0 ? this.__items[this.__selected].value : null;
                }

                public getSelectedText() {
                    return this.__selected >= 0 ? this.__items[this.__selected].text : null;
                }

                /* ---------- ComboboxText / MaxListHeight ---------- */

                public setComboboxText(valueNew: string | null) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('ComboboxText');
                    }
                    if (convertedValue === this.__comboboxText) {
                        return;
                    }
                    this.__comboboxText = convertedValue || '';
                    this.__localizedComboboxText.set(this.__comboboxText);
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'ComboboxText' });
                    this.__render();
                }

                public getComboboxText() {
                    return this.__comboboxText;
                }

                // Used the next time the list opens: nothing to process.
                public setMaxListHeight(valueNew: number | null) {
                    let convertedValue = TcHmi.ValueConverter.toNumber(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('MaxListHeight');
                    }
                    if (convertedValue === this.__maxListHeight) {
                        return;
                    }
                    this.__maxListHeight = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'MaxListHeight' });
                }

                public getMaxListHeight() {
                    return this.__maxListHeight;
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

                protected __processLock() {
                    const hint = !!this.__lock && !!this.__lockDescription;
                    this.__elementTemplateRoot.toggleClass('sdf-csd-locked', !!this.__lock);
                    this.__elementTemplateRoot.toggleClass('sdf-csd-has-hint', hint);
                    if (this.__lock && Dropdown.isOpenFor(this)) {
                        Dropdown.close();
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
                    // Collapsed: a class on the control element (Style.css), so the Visibility attribute stays untouched.
                    this.__element.toggleClass('sdf-csd-hidden', this.__hide);
                    if (this.__hide) {
                        this.__closePopups();
                    }
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

                /* ---------- ComboboxWidth / TextWidth ---------- */

                public setComboboxWidth(valueNew: number | null) {
                    let convertedValue = TcHmi.ValueConverter.toNumber(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('ComboboxWidth');
                    }
                    if (convertedValue === this.__comboboxWidth) {
                        return;
                    }
                    this.__comboboxWidth = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'ComboboxWidth' });
                    this.__processWidths();
                }

                public getComboboxWidth() {
                    return this.__comboboxWidth;
                }

                public setComboboxWidthUnit(valueNew: string | null) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('ComboboxWidthUnit');
                    }
                    if (convertedValue === this.__comboboxWidthUnit) {
                        return;
                    }
                    this.__comboboxWidthUnit = convertedValue || 'px';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'ComboboxWidthUnit' });
                    this.__processWidths();
                }

                public getComboboxWidthUnit() {
                    return this.__comboboxWidthUnit;
                }

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

                // Same as StringSetData: --sdf-csd-box-width = ComboboxWidth (px, or % of the control width), read by
                // the text width in %: 100% = control width - box - gap, as in NumericSetData.
                // The box itself sits in the slot, whose 100% is not the control width: with ComboboxWidth in %
                // the box width is rewritten in slot terms (S = slot, W = control, p = ComboboxWidth / 100):
                //   TextWidth T px: S = W - g - T                     -> box = p * (S + g + T)
                //   TextWidth f %:  S = W - g - f * (W - p * W - g)   -> box = p * (S + g * (1 - f)) / (1 - f + f * p)
                protected __processWidths() {
                    const root = this.__elementTemplateRoot[0];
                    const box = this.__elementValueBox.style;
                    const cw = this.__comboboxWidth;
                    const tw = this.__textWidth;
                    const hasText = tw !== null && tw !== undefined && isFinite(tw);
                    const textPercent = this.__textWidthUnit === '%';

                    if (cw === null || cw === undefined || !isFinite(cw) || cw < 0) {
                        root.style.removeProperty('--sdf-csd-box-width'); // CSS default: 180 px
                        box.width = box.flexBasis = '';
                    } else if (this.__comboboxWidthUnit === '%') {
                        const p = cw / 100;
                        root.style.setProperty('--sdf-csd-box-width', cw + '%');
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
                        root.style.setProperty('--sdf-csd-box-width', cw + 'px');
                        box.width = box.flexBasis = cw + 'px';
                    }

                    if (!hasText) {
                        this.__elementText.style.width = '';
                    } else if (textPercent) {
                        this.__elementText.style.width =
                            'calc((100% - var(--sdf-csd-box-width) - var(--sdf-csd-gap)) * ' + tw! / 100 + ')';
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

                /* ---------- SetDataAlignment ---------- */

                public setSetDataAlignment(valueNew: string | null) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('SetDataAlignment');
                    }
                    if (convertedValue === this.__setDataAlignment) {
                        return;
                    }
                    this.__setDataAlignment = convertedValue || 'Right';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'SetDataAlignment' });
                    this.__elementSlot.style.justifyContent = flexAlign(this.__setDataAlignment);
                }

                public getSetDataAlignment() {
                    return this.__setDataAlignment;
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
                    this.__valueAlignment = convertedValue || 'Center';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'ValueAlignment' });
                    this.__elementValue.style.textAlign = this.__valueAlignment.toLowerCase();
                }

                public getValueAlignment() {
                    return this.__valueAlignment;
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
            }
        }
    }
}

TcHmi.Controls.registerEx('ComboboxSetData', 'TcHmi.Controls.SetDataFramework', TcHmi.Controls.SetDataFramework.ComboboxSetData);

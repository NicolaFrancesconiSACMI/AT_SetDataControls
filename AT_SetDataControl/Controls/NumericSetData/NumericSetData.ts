/*
 * NumericSetData
 *
 * Shows a numeric symbol (Text on the left, value + Unit in a value box on the right, its edit / lock icon at the
 * right end of the box) and edits it with a built-in keypad.
 *
 * - Value is bound to a plain numeric symbol, e.g. %s%PLC1.MAIN.stSpeed::HmiValue%/s%.
 * - Limits: the siblings of that symbol in its parent struct are read on every press
 *   (PLC1.MAIN.stSpeed::MinValue / ::MaxValue). A missing sibling falls back to the range of the
 *   data type (INT -32768..32767, ...); LREAL has none.
 *   Use "::" in the binding: then only the struct has to be mapped. With dot notation
 *   (PLC1.MAIN.stSpeed.HmiValue) the siblings must be mapped themselves.
 * - An integer data type forces 0 decimals, whatever Decimals says.
 * - Press: opens the keypad unless Hide, Lock, disabled or no "operate" right.
 *   Locked: shows LockDescription in a bubble, if set. No "operate" right: user lock icon, nothing opens.
 * - The keypad writes the bound symbol directly (not through the binding) and closes on success;
 *   out of range nothing is written and the value and the exceeded limit blink.
 * - Inside a user control a %pp% binding is followed to the real symbol.
 * - Layout: Text takes TextWidth (aligned by TextAlignment); the value box is always 180 x 40 px,
 *   centred vertically and placed by SetDataAlignment in the remaining width.
 * - AuditTrail: after a write, adds an entry via TcHmi.Functions.SUtils.CallServerFunction
 *   ('SacmiTcHmiAuditTrailExt.AddEntry'), if that function is loaded.
 */
module TcHmi {
    export module Controls {
        export module SetDataFramework {

            interface ValueType {
                integer: boolean | null;
                minimum: number | null;
                maximum: number | null;
            }

            const NUMBER_RE = /^-?(\d+\.?\d*|\.\d+)$/;

            /* ---------- values ---------- */

            // "", "." and "-" are 0; null means "not a number".
            function parse(text: string): number | null {
                text = text.trim();
                if (text === '' || text === '.' || text === '-') {
                    return 0;
                }
                return NUMBER_RE.test(text) ? parseFloat(text) : null;
            }

            function toDecimals(value: number | null | undefined): number | null {
                if (value === null || value === undefined || !isFinite(value)) {
                    return null;
                }
                return Math.max(0, Math.min(10, Math.round(value)));
            }

            function round(value: number, decimals: number | null) {
                // Without Decimals still strip float noise (0.1 + 0.2 -> 0.3).
                return decimals === null ? Number(value.toPrecision(15)) : Number(value.toFixed(decimals));
            }

            // A value that is an exact float32 (a REAL) -> the shortest decimal that is the same REAL
            // (0.10000000149 -> 0.1, 12345678 stays); anything else -> round(value, null).
            function float32Text(value: number) {
                if (Math.fround(value) === value) {
                    for (let p = 1; p <= 9; p++) {
                        const short = Number(value.toPrecision(p));
                        if (Math.fround(short) === value) {
                            return short;
                        }
                    }
                }
                return round(value, null);
            }

            function format(value: number, decimals: number | null) {
                return decimals === null ? String(round(value, null)) : value.toFixed(decimals);
            }

            // Limits such as REAL's 3.4e38 would not fit the keypad with toFixed.
            function formatLimit(value: number | null, decimals: number | null) {
                if (value === null) {
                    return '—';
                }
                return Math.abs(value) >= 1e12 ? value.toExponential(3) : format(value, decimals);
            }

            // HorizontalAlignment -> flex justify-content.
            function flexAlign(alignment: string | undefined) {
                return alignment === 'Center' ? 'center' : alignment === 'Right' ? 'flex-end' : 'flex-start';
            }

            /* ---------- symbols ---------- */

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
            // Follow the parameter bindings to the real symbol, also through nested user controls:
            //   %pp%Value%/pp%                    (inside the user control)
            //   %pp%NumericSetData_2::Value%/pp%  (host id written out)
            //     ->  %s%PLC1.MAIN.stSpeed::HmiValue%/s%
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

            // Sibling in the same parent: %s%A.B::HmiValue%/s% -> %s%A.B::MinValue%/s%,
            // %s%A.B.HmiValue%/s% -> %s%A.B.MinValue%/s%. Null when there is no parent (top level, array item).
            function siblingOf(target: string, name: string): string | null {
                const expr = new TcHmi.SymbolExpression(target);
                const tag = expr.getTag();
                const full = expr.getFullName();
                if (!tag || !full || full.charAt(full.length - 1) === ']') {
                    return null;
                }
                const sep = full.lastIndexOf('::') >= 0 ? '::' : '.';
                const at = full.lastIndexOf(sep);
                if (at <= 0) {
                    return null;
                }
                return '%' + tag + '%' + full.substring(0, at) + sep + name + '%/' + tag + '%';
            }

            /* ---------- data type ---------- */

            // Both must hold (allOf, $ref next to own keywords).
            function intersect(a: ValueType, b: ValueType): ValueType {
                return {
                    integer: a.integer === true || b.integer === true ? true
                        : a.integer === false || b.integer === false ? false : null,
                    minimum: a.minimum === null ? b.minimum : b.minimum === null ? a.minimum : Math.max(a.minimum, b.minimum),
                    maximum: a.maximum === null ? b.maximum : b.maximum === null ? a.maximum : Math.min(a.maximum, b.maximum)
                };
            }

            // Either may hold (anyOf, oneOf): a bound is kept only if every branch has one.
            function union(a: ValueType, b: ValueType): ValueType {
                return {
                    integer: a.integer === true && b.integer === true ? true
                        : a.integer === false || b.integer === false ? false : null,
                    minimum: a.minimum === null || b.minimum === null ? null : Math.min(a.minimum, b.minimum),
                    maximum: a.maximum === null || b.maximum === null ? null : Math.max(a.maximum, b.maximum)
                };
            }

            // A non-numeric enum such as SpecialNumberValues ("NaN", "Infinity"), also behind $refs.
            function isEnumOnly(s: any): boolean {
                for (let depth = 0; s && typeof s === 'object' && depth < 10; depth++) {
                    if (Array.isArray(s.enum) && s.type !== 'number' && s.type !== 'integer') {
                        return true;
                    }
                    if (typeof s.$ref !== 'string' || Object.keys(s).length > 1) {
                        return false;
                    }
                    s = TcHmi.Type.getSchema(s.$ref);
                }
                return false;
            }

            // Flattens a schema to { integer, minimum, maximum }; null fields are unknown.
            // REAL hides its range in anyOf[SpecialNumberValues, allOf[Number, {minimum, maximum}]]:
            // the "NaN" / "Infinity" enum branches are no numbers and are skipped.
            function describeSchema(s: any, depth = 0): ValueType {
                let info: ValueType = { integer: null, minimum: null, maximum: null };
                if (!s || typeof s !== 'object' || depth > 10) {
                    return info;
                }
                if (s.type === 'integer') {
                    info.integer = true;
                } else if (s.type === 'number') {
                    info.integer = false;
                }
                if (typeof s.minimum === 'number') {
                    info.minimum = s.minimum;
                }
                if (typeof s.maximum === 'number') {
                    info.maximum = s.maximum;
                }
                if (typeof s.$ref === 'string') {
                    info = intersect(info, describeSchema(TcHmi.Type.getSchema(s.$ref), depth + 1));
                }
                if (Array.isArray(s.allOf)) {
                    for (const part of s.allOf) {
                        info = intersect(info, describeSchema(part, depth + 1));
                    }
                }
                for (const key of ['anyOf', 'oneOf']) {
                    if (!Array.isArray(s[key])) {
                        continue;
                    }
                    let any: ValueType | null = null;
                    for (const part of s[key]) {
                        if (isEnumOnly(part)) {
                            continue;
                        }
                        const branch = describeSchema(part, depth + 1);
                        any = any ? union(any, branch) : branch;
                    }
                    if (any) {
                        info = intersect(info, any);
                    }
                }
                return info;
            }

            // The server is asked once per symbol, not on every press or value change.
            const typeCache: { [target: string]: ValueType | null } = {};
            const typePending: { [target: string]: ((type: ValueType | null) => void)[] } = {};

            // callback(valueType | null). Synchronous when the type is already known.
            function valueTypeOf(target: string, callback: (type: ValueType | null) => void) {
                if (target in typeCache) {
                    callback(typeCache[target]);
                    return;
                }
                if (typePending[target]) {
                    typePending[target].push(callback);
                    return;
                }
                typePending[target] = [callback];
                TcHmi.Symbol.resolveSchema(target, data => {
                    const waiting = typePending[target] || [];
                    delete typePending[target];
                    let type: ValueType | null = null;
                    if (data.error === TcHmi.Errors.NONE && data.schema) {
                        type = typeCache[target] = describeSchema(data.schema);
                        TcHmi.Log.debugEx('[NumericSetData] ' + target, type);
                    } else {
                        TcHmi.Log.warnEx('[NumericSetData] Could not resolve the type of ' + target +
                            ': no type check, Decimals as given.');
                    }
                    waiting.forEach(cb => cb(type));
                });
            }

            // Sibling value, or null if the sibling does not exist or is no number.
            function readLimit(expression: string | null, callback: (value: number | null) => void) {
                if (!expression) {
                    callback(null);
                    return;
                }
                TcHmi.Symbol.readEx2<any>(expression, data => {
                    const value = data.error === TcHmi.Errors.NONE ? Number(data.value) : NaN;
                    callback(data.value !== null && data.value !== '' && isFinite(value) ? value : null);
                });
            }

            /* ---------- keypad ---------- */

            interface KeypadSession {
                owner: NumericSetData;
                target: string;
                decimals: number | null;   // effective: forced to 0 once the type says integer
                unit: string;
                current: number | null;    // value read at open, unrounded
                minSibling: number | null;
                maxSibling: number | null;
                valueType: ValueType | null;
                pending: number;           // reads still running: Enter waits for them
                busy: boolean;             // write running
            }

            // One keypad per page, built on first use and shown in the TopMostLayer.
            // On-screen keys act on the <input> exactly like a physical keyboard does.
            class Keypad {
                private static __el: HTMLElement | null = null;
                private static __session: KeypadSession | null = null;
                private static __token = 0;
                private static __repeat: number | null = null;
                private static __userWatch = false;

                private static __q<E extends HTMLElement = HTMLElement>(selector: string) {
                    return Keypad.__el!.querySelector(selector) as E;
                }

                private static get __input() {
                    return Keypad.__q<HTMLInputElement>('.sdf-kb-input');
                }

                private static __build() {
                    const el = document.createElement('div');
                    el.className = 'sdf-kb';
                    el.innerHTML =
                        '<div class="sdf-kb-title"><span class="sdf-kb-title-text"></span>' +
                        '<button type="button" class="sdf-kb-close" data-key="Escape" aria-label="Close">✕</button></div>' +
                        '<div class="sdf-kb-value"><input class="sdf-kb-input" type="text" inputmode="none" autocomplete="off" spellcheck="false">' +
                        '<span class="sdf-kb-unit"></span></div>' +
                        '<div class="sdf-kb-limits">' +
                        '<div class="sdf-kb-limit" data-limit="min"><span class="sdf-kb-label"></span><span class="sdf-kb-number"></span></div>' +
                        '<div class="sdf-kb-limit" data-limit="current"><span class="sdf-kb-label"></span><span class="sdf-kb-number"></span></div>' +
                        '<div class="sdf-kb-limit" data-limit="max"><span class="sdf-kb-label"></span><span class="sdf-kb-number"></span></div>' +
                        '</div>' +
                        '<div class="sdf-kb-keys">' +
                        ['7', '8', '9', 'Backspace', '4', '5', '6', 'MinusOne', '1', '2', '3', 'PlusOne', 'ToggleSign', '0', '.', 'Enter']
                            .map(key => '<button type="button" class="sdf-kb-key' + (key === 'Enter' ? ' sdf-kb-key-accent' : '') +
                                '" data-key="' + key + '">' + Keypad.__labelOf(key) + '</button>').join('') +
                        '</div>';

                    const input = el.querySelector('.sdf-kb-input') as HTMLInputElement;
                    input.addEventListener('keydown', e => Keypad.__onKey(e.key, e));
                    input.addEventListener('input', () => Keypad.__clearError());

                    // pointerdown + preventDefault: the input keeps its focus and caret.
                    el.addEventListener('pointerdown', e => {
                        const key = (e.target as HTMLElement).closest('[data-key]') as HTMLElement | null;
                        if (e.target !== input) {
                            e.preventDefault();
                        }
                        if (!key) {
                            return;
                        }
                        const name = key.getAttribute('data-key')!;
                        key.classList.add('down');
                        if (name === 'Escape') {
                            return; // ✕ closes on release (click): the rest of the tap cannot reach what is behind
                        }
                        Keypad.__onKey(name, null);
                        if (name === 'PlusOne' || name === 'MinusOne' || name === 'Backspace') {
                            Keypad.__startRepeat(name);
                        }
                    });
                    const up = () => {
                        Keypad.__stopRepeat();
                        el.querySelectorAll('.down').forEach(k => k.classList.remove('down'));
                    };
                    el.addEventListener('pointerup', up);
                    el.addEventListener('pointercancel', up);
                    el.addEventListener('pointerleave', up);
                    // click, not pointerdown: a finger slid off ✕ does not close
                    el.addEventListener('click', e => {
                        if ((e.target as HTMLElement).closest('[data-key="Escape"]')) {
                            Keypad.close();
                        }
                    });
                    Keypad.__wireDrag(el);
                    // Fast repeated taps are a double click for the browser: no text selection outside the input.
                    el.addEventListener('dblclick', e => {
                        if (e.target !== input) {
                            e.preventDefault();
                        }
                    });
                    return el;
                }

                private static __labelOf(key: string) {
                    switch (key) {
                        case 'Backspace': return '⌫';
                        case 'MinusOne': return '−1';
                        case 'PlusOne': return '+1';
                        case 'ToggleSign': return '±';
                        case 'Enter': return '↵';
                        default: return key;
                    }
                }

                private static __startRepeat(key: string) {
                    Keypad.__stopRepeat();
                    const started = Date.now();
                    Keypad.__repeat = window.setInterval(() => {
                        if (Date.now() - started > 400) {
                            Keypad.__onKey(key, null);
                        }
                    }, 80);
                }

                private static __stopRepeat() {
                    if (Keypad.__repeat !== null) {
                        window.clearInterval(Keypad.__repeat);
                        Keypad.__repeat = null;
                    }
                }

                public static isOpenFor(owner: NumericSetData) {
                    return Keypad.__session !== null && Keypad.__session.owner === owner;
                }

                public static open(owner: NumericSetData, target: string, text: string, unit: string,
                    decimals: number | null, labels: { min: string; max: string; current: string }) {
                    if (!Keypad.__userWatch) {
                        // Another user logged in (or auto-logout): nothing opened by the previous user stays open.
                        Keypad.__userWatch = true;
                        TcHmi.EventProvider.register('onUserChanged', () => Keypad.close());
                    }
                    if (Keypad.__session) {
                        Keypad.close();
                    }
                    if (!Keypad.__el) {
                        Keypad.__el = Keypad.__build();
                    }
                    const token = ++Keypad.__token;
                    const st: KeypadSession = Keypad.__session = {
                        owner: owner,
                        target: target,
                        decimals: toDecimals(decimals),
                        unit: unit,
                        current: null,
                        minSibling: null,
                        maxSibling: null,
                        valueType: null,
                        pending: 3,
                        busy: false
                    };
                    const alive = () => token === Keypad.__token;
                    const done = () => {
                        if (alive()) {
                            st.pending--;
                            Keypad.__render();
                        }
                    };

                    Keypad.__q('.sdf-kb-title-text').textContent = text;
                    Keypad.__q('.sdf-kb-unit').textContent = unit;
                    Keypad.__q('[data-limit="min"] .sdf-kb-label').textContent = labels.min;
                    Keypad.__q('[data-limit="max"] .sdf-kb-label').textContent = labels.max;
                    Keypad.__q('[data-limit="current"] .sdf-kb-label').textContent = labels.current;
                    Keypad.__input.value = '';
                    Keypad.__clearError();
                    Keypad.__render();

                    // Transparent, but modal: touching the background does nothing (no close, nothing behind).
                    TcHmi.TopMostLayer.add(owner, Keypad.__el, {
                        dimBackground: false,
                        modal: true,
                        closeOnBackground: false,
                        resizeCb: () => Keypad.__moveTo(Keypad.__el!.offsetLeft, Keypad.__el!.offsetTop),
                        removeCb: () => {
                            // Removed by anyone else than close(): drop pending reads / writes.
                            if (alive()) {
                                Keypad.__token++;
                                Keypad.__session = null;
                                Keypad.__stopRepeat();
                            }
                        }
                    });
                    Keypad.__center(); // every open starts centred, wherever it was dragged to
                    Keypad.__input.focus();

                    valueTypeOf(target, type => {
                        if (!alive()) {
                            return;
                        }
                        st.valueType = type;
                        if (type && type.integer && st.decimals !== 0) {
                            Keypad.__forceNoDecimals(st);
                        }
                        done();
                    });
                    readLimit(siblingOf(target, 'MinValue'), value => {
                        st.minSibling = value;
                        done();
                    });
                    readLimit(siblingOf(target, 'MaxValue'), value => {
                        st.maxSibling = value;
                        done();
                    });
                    TcHmi.Symbol.readEx2<any>(target, data => {
                        if (!alive()) {
                            return;
                        }
                        const value = data.error === TcHmi.Errors.NONE ? Number(data.value) : NaN;
                        if (!isFinite(value)) {
                            TcHmi.Log.errorEx('[NumericSetData] Could not read a number from ' + target + '.');
                            return;
                        }
                        st.current = value;
                        Keypad.__setText(round(value, st.decimals));
                        Keypad.__input.select(); // first key replaces the value; tap to place the caret instead
                        Keypad.__render();
                    });
                }

                private static __center() {
                    const el = Keypad.__el!;
                    const parent = el.parentElement;
                    if (parent) {
                        Keypad.__moveTo((parent.clientWidth - el.offsetWidth) / 2, (parent.clientHeight - el.offsetHeight) / 2);
                    }
                }

                // Kept inside the layer, also when the screen shrinks (resizeCb).
                private static __moveTo(left: number, top: number) {
                    const el = Keypad.__el!;
                    const parent = el.parentElement;
                    const maxLeft = parent ? parent.clientWidth - el.offsetWidth : Infinity;
                    const maxTop = parent ? parent.clientHeight - el.offsetHeight : Infinity;
                    el.style.position = 'absolute';
                    el.style.left = Math.round(Math.max(0, Math.min(maxLeft, left))) + 'px';
                    el.style.top = Math.round(Math.max(0, Math.min(maxTop, top))) + 'px';
                }

                // Dragged by its title bar (not by the close button).
                private static __wireDrag(el: HTMLElement) {
                    const handle = el.querySelector('.sdf-kb-title') as HTMLElement;
                    let start: { x: number; y: number; left: number; top: number; scale: number } | null = null;

                    handle.addEventListener('pointerdown', e => {
                        if ((e.target as HTMLElement).closest('[data-key]')) {
                            return;
                        }
                        // The layer may be scaled to the screen: convert screen pixels to layer pixels.
                        const scale = el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1;
                        start = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop, scale: scale };
                        handle.setPointerCapture(e.pointerId);
                    });
                    handle.addEventListener('pointermove', e => {
                        if (start && handle.hasPointerCapture(e.pointerId)) {
                            Keypad.__moveTo(start.left + (e.clientX - start.x) / start.scale, start.top + (e.clientY - start.y) / start.scale);
                        }
                    });
                    const end = (e: PointerEvent) => {
                        if (!start) {
                            return;
                        }
                        start = null;
                        if (handle.hasPointerCapture(e.pointerId)) {
                            handle.releasePointerCapture(e.pointerId);
                        }
                        Keypad.__input.focus(); // keep the physical keyboard working after a drag
                    };
                    handle.addEventListener('pointerup', end);
                    handle.addEventListener('pointercancel', end);
                }

                public static close() {
                    const el = Keypad.__el;
                    const st = Keypad.__session;
                    Keypad.__token++;
                    Keypad.__session = null;
                    Keypad.__stopRepeat();
                    if (el && st) {
                        Keypad.__input.blur();
                        TcHmi.TopMostLayer.remove(st.owner, el);
                    }
                }

                // Sibling first, else the range of the data type, else none.
                // The sibling is checked as shown: rounded to Decimals, so MIN 0.100 accepts 0.100 although a
                // REAL 0.1 arrives as 0.10000000149. Without Decimals: see float32Text.
                private static __limit(st: KeypadSession, which: 'min' | 'max') {
                    const sibling = which === 'min' ? st.minSibling : st.maxSibling;
                    if (sibling !== null) {
                        return st.decimals !== null ? round(sibling, st.decimals) : float32Text(sibling);
                    }
                    return st.valueType ? (which === 'min' ? st.valueType.minimum : st.valueType.maximum) : null;
                }

                private static __render() {
                    const st = Keypad.__session;
                    if (!st) {
                        return;
                    }
                    Keypad.__q('[data-limit="min"] .sdf-kb-number').textContent = formatLimit(Keypad.__limit(st, 'min'), st.decimals);
                    Keypad.__q('[data-limit="max"] .sdf-kb-number').textContent = formatLimit(Keypad.__limit(st, 'max'), st.decimals);
                    Keypad.__q('[data-limit="current"] .sdf-kb-number').textContent =
                        st.current === null ? '' : format(round(st.current, st.decimals), st.decimals);
                    Keypad.__q('[data-key="."]').classList.toggle('sdf-kb-key-disabled', st.decimals === 0);
                }

                // Integer target: no decimals. The type may arrive after the current value is already shown:
                // reformat what is on screen, unless the operator is typing.
                private static __forceNoDecimals(st: KeypadSession) {
                    const shown = st.current === null ? null : format(round(st.current, st.decimals), st.decimals);
                    st.decimals = 0;
                    if (st.current !== null && Keypad.__input.value === shown) {
                        Keypad.__setText(round(st.current, 0));
                        Keypad.__input.select();
                    }
                }

                private static __setText(value: number | null) {
                    const st = Keypad.__session;
                    const input = Keypad.__input;
                    input.value = value === null || !st ? '' : format(value, st.decimals);
                    input.setSelectionRange(input.value.length, input.value.length);
                }

                private static __insert(text: string) {
                    const input = Keypad.__input;
                    input.setRangeText(text, input.selectionStart || 0, input.selectionEnd || 0, 'end');
                    Keypad.__clearError();
                }

                private static __backspace() {
                    const input = Keypad.__input;
                    let start = input.selectionStart || 0;
                    const end = input.selectionEnd || 0;
                    if (start === end) {
                        start = Math.max(0, start - 1);
                    }
                    input.setRangeText('', start, end, 'end');
                    Keypad.__clearError();
                }

                // ± works wherever the caret is: adds or removes the leading "-" and keeps the caret on its digit.
                private static __toggleSign() {
                    const input = Keypad.__input;
                    const negative = input.value.charAt(0) === '-';
                    const caret = Math.max(0, (input.selectionStart || 0) + (negative ? -1 : 1));
                    input.value = negative ? input.value.slice(1) : '-' + input.value;
                    input.setSelectionRange(caret, caret);
                    Keypad.__clearError();
                }

                private static __step(delta: number) {
                    const st = Keypad.__session!;
                    const value = parse(Keypad.__input.value);
                    Keypad.__clearError();
                    if (value === null) {
                        Keypad.__blink(['value']);
                        return;
                    }
                    Keypad.__setText(round(value + delta, st.decimals)); // limits are checked on Enter only
                }

                // e: the physical key event, null for an on-screen key.
                private static __onKey(key: string, e: KeyboardEvent | null) {
                    const st = Keypad.__session;
                    if (!st || (e && (e.ctrlKey || e.metaKey || e.altKey))) {
                        return; // copy / paste / select all
                    }
                    const handled = () => {
                        if (e) {
                            e.preventDefault();
                        }
                    };
                    switch (key) {
                        case 'Enter': handled(); Keypad.__confirm(); return;
                        case 'Escape': handled(); Keypad.close(); return;
                        case 'PlusOne':
                        case '+': handled(); Keypad.__step(1); return;
                        case 'MinusOne': handled(); Keypad.__step(-1); return;
                        case 'ToggleSign': handled(); Keypad.__toggleSign(); return;
                        case 'Backspace':
                            if (!e) {
                                Keypad.__backspace();
                            }
                            return;
                        case ',': // numpad decimal key on a German layout
                        case '.':
                            handled();
                            if (st.decimals !== 0) {
                                Keypad.__insert('.');
                            }
                            return;
                    }
                    if (key.length === 1 && /[0-9\-]/.test(key)) {
                        if (!e) {
                            Keypad.__insert(key);
                        }
                        return;
                    }
                    if (key.length === 1) {
                        handled(); // letters and other symbols are never typed
                    }
                }

                // 'min' | 'max' | null
                private static __limitHit(st: KeypadSession, value: number) {
                    const max = Keypad.__limit(st, 'max');
                    const min = Keypad.__limit(st, 'min');
                    if (max !== null && value > max) {
                        return 'max';
                    }
                    if (min !== null && value < min) {
                        return 'min';
                    }
                    return null;
                }

                // Type check before writing: true if the value fits the data type of the target.
                private static __typeAccepts(st: KeypadSession, value: number) {
                    const t = st.valueType;
                    if (!t) {
                        return true; // unknown: let the server decide
                    }
                    if (t.integer && Math.round(value) !== value) {
                        return false;
                    }
                    return (t.minimum === null || value >= t.minimum) && (t.maximum === null || value <= t.maximum);
                }

                private static __confirm() {
                    const st = Keypad.__session;
                    if (!st || st.busy || st.pending > 0) {
                        return; // limits not known yet, or already writing
                    }
                    let value = parse(Keypad.__input.value);
                    Keypad.__clearError();
                    if (value === null) {
                        Keypad.__blink(['value']);
                        return;
                    }
                    value = round(value, st.decimals);
                    Keypad.__setText(value); // what is checked and written is what the operator sees

                    const hit = Keypad.__limitHit(st, value);
                    if (hit) {
                        Keypad.__blink(['value', hit]);
                        st.owner.__raiseLimitExceeded(value, hit);
                        return;
                    }
                    if (!Keypad.__typeAccepts(st, value)) {
                        TcHmi.Log.warnEx('[NumericSetData] ' + value + ' does not fit the data type of ' + st.target + '.');
                        Keypad.__blink(['value']);
                        return;
                    }

                    st.busy = true;
                    const token = Keypad.__token;
                    const written = value;
                    TcHmi.Symbol.writeEx(st.target, written, data => {
                        st.busy = false;
                        if (token !== Keypad.__token) {
                            return; // closed or reopened meanwhile
                        }
                        if (data.error === TcHmi.Errors.NONE) {
                            Keypad.close();
                            st.owner.__raiseValueWritten(written, st.target, st.current, st.decimals);
                        } else {
                            TcHmi.Log.errorEx('[NumericSetData] Writing ' + st.target + ' failed: ' +
                                (data.details && data.details.reason ? data.details.reason : data.error));
                            Keypad.__blink(['value']);
                        }
                    });
                }

                private static __clearError() {
                    if (Keypad.__el) {
                        Keypad.__el.querySelectorAll('.sdf-kb-error').forEach(el => el.classList.remove('sdf-kb-error'));
                    }
                }

                // Restarts the animation if it is already blinking.
                private static __blink(targets: ('value' | 'min' | 'max')[]) {
                    Keypad.__clearError();
                    for (const target of targets) {
                        const el = Keypad.__q(target === 'value' ? '.sdf-kb-value' : '[data-limit="' + target + '"]');
                        void el.offsetWidth; // reflow, so a repeated error blinks from the start
                        el.classList.add('sdf-kb-error');
                    }
                }
            }

            /* ---------- lock hint ---------- */

            // One bubble per page with the Lock Description, next to the value box, in the TopMostLayer.
            // Modal with closeOnBackground: any tap closes it, also a second tap on the same box.
            class Hint {
                private static __el: HTMLElement | null = null;
                private static __owner: NumericSetData | null = null;
                private static __token = 0;
                private static __timer: number | null = null;

                public static isOpenFor(owner: NumericSetData) {
                    return Hint.__owner === owner;
                }

                public static open(owner: NumericSetData, anchor: HTMLElement, text: string) {
                    if (Hint.__owner) {
                        Hint.close();
                    }
                    if (!Hint.__el) {
                        Hint.__el = document.createElement('div');
                        Hint.__el.className = 'sdf-tip';
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
                    el.classList.toggle('sdf-tip-below', !above);
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

            export class NumericSetData extends TcHmi.Controls.System.TcHmiControl {

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

                protected __value: number | null | undefined;
                protected __decimals: number | null | undefined;
                protected __lock: boolean | undefined;
                protected __lockDescription: string | undefined;
                protected __hide: boolean | undefined;
                protected __text: string | undefined;
                protected __unit: string | undefined;
                protected __minLabel: string | undefined;
                protected __maxLabel: string | undefined;
                protected __currentLabel: string | undefined;
                // Shown texts of MinLabel / MaxLabel / CurrentLabel; created in __previnit, before the setters.
                protected __localizedMinLabel!: LocalizedText;
                protected __localizedMaxLabel!: LocalizedText;
                protected __localizedCurrentLabel!: LocalizedText;
                protected __textWidth: number | null | undefined;
                protected __textWidthUnit: string | undefined;
                protected __textAlignment: string | undefined;
                protected __setDataAlignment: string | undefined;
                protected __auditTrail: boolean | undefined;

                /** Data type of the bound symbol, null while unknown. */
                protected __valueType: ValueType | null = null;
                protected __onPressed = () => this.__press();

                public __previnit() {
                    this.__elementTemplateRoot = this.__element.find('.TcHmi_Controls_SetDataFramework_NumericSetData-Template');
                    if (this.__elementTemplateRoot.length === 0) {
                        throw new Error('Invalid Template.html');
                    }
                    const root = this.__elementTemplateRoot[0];
                    this.__elementText = root.querySelector('.sdf-nsd-text') as HTMLElement;
                    this.__elementSlot = root.querySelector('.sdf-nsd-slot') as HTMLElement;
                    this.__elementValueBox = root.querySelector('.sdf-nsd-valuebox') as HTMLElement;
                    this.__elementValue = root.querySelector('.sdf-nsd-value') as HTMLElement;
                    // Read when the keypad opens: nothing to process.
                    this.__localizedMinLabel = new LocalizedText(() => { });
                    this.__localizedMaxLabel = new LocalizedText(() => { });
                    this.__localizedCurrentLabel = new LocalizedText(() => { });
                    super.__previnit();
                }

                public __init() {
                    super.__init();
                }

                public __attach() {
                    super.__attach();
                    this.__elementValueBox.addEventListener('click', this.__onPressed);
                    this.__localizedTexts().forEach(t => t.start());
                    // The parent chain (needed to follow a %pp% binding) exists only now.
                    const target = this.__target();
                    if (target) {
                        valueTypeOf(target, type => {
                            this.__valueType = type;
                            this.__processValue();
                        });
                    }
                }

                public __detach() {
                    super.__detach();
                    this.__elementValueBox.removeEventListener('click', this.__onPressed);
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
                    return [this.__localizedMinLabel, this.__localizedMaxLabel, this.__localizedCurrentLabel];
                }

                protected __closePopups() {
                    if (Keypad.isOpenFor(this)) {
                        Keypad.close();
                    }
                    if (Hint.isOpenFor(this)) {
                        Hint.close();
                    }
                }

                /** The real symbol bound to Value, null if Value is not bound to a symbol. */
                protected __target(): string | null {
                    const expression = TcHmi.Binding.resolve('Value', this);
                    if (!expression) {
                        return null;
                    }
                    try {
                        return resolveTarget(expression, this);
                    } catch (e) {
                        return null; // unparsable expression
                    }
                }

                protected __effectiveDecimals() {
                    return this.__valueType && this.__valueType.integer ? 0 : toDecimals(this.__decimals);
                }

                protected __press() {
                    // No "operate" right (user lock): silent, also when locked with a description.
                    if (this.__hide || !this.getIsEnabled() || TcHmi.Access.checkAccess(this, 'operate') === false) {
                        return;
                    }
                    if (this.__lock) {
                        if (this.__lockDescription) {
                            Hint.open(this, this.__elementValueBox, this.__lockDescription);
                        }
                        return;
                    }
                    const target = this.__target();
                    if (!target) {
                        TcHmi.Log.warnEx('[NumericSetData] ' + this.__id + ': Value is not bound to a symbol, nothing to write.');
                        return;
                    }
                    Keypad.open(this, target, this.__text || '', this.__unit || '', this.__effectiveDecimals(), {
                        min: this.__localizedMinLabel.text,
                        max: this.__localizedMaxLabel.text,
                        current: this.__localizedCurrentLabel.text
                    });
                }

                /** @internal Called by the keypad. */
                public __raiseValueWritten(value: number, target: string, oldValue: number | null, decimals: number | null) {
                    this.__addAuditEntry(target, value, oldValue, decimals);
                    TcHmi.EventProvider.raise(this.__id + '.onValueWritten', value);
                }

                // ControlId "Speed (PLC1.MAIN.stSpeed::HmiValue: 12.50 -> 13.00)", Data the new value (13.5).
                // SUtils is looked up on every write: it may load after this control (dependency order is not fixed).
                protected __addAuditEntry(target: string, value: number, oldValue: number | null, decimals: number | null) {
                    if (!this.__auditTrail) {
                        return;
                    }
                    const sutils = (TcHmi.Functions as any).SUtils;
                    if (!sutils || typeof sutils.CallServerFunction !== 'function') {
                        TcHmi.Log.warnEx('[NumericSetData] ' + this.__id + ': AuditTrail is on but TcHmi.Functions.SUtils.CallServerFunction is not available.');
                        return;
                    }
                    try {
                        const symbol = new TcHmi.SymbolExpression(target).getFullName() || target;
                        const oldText = oldValue === null ? '-' : format(oldValue, decimals);
                        const newText = value === null ? '-' : format(value, decimals);
                        const text = ' (' + symbol + ': ' + oldText + ' -> '  + newText + ')';
                        const trail = {
                            ControlId: this.__text ? this.__text + text : text,
                            Type: 'NumericSetData',
                            Username: TcHmi.Server.getCurrentUser() || 'no user',
                            // Must stay a number: the extension stores it in a FLOAT column and GetEntries
                            // reads it with GetDouble, so a text row is saved but never shown. old -> new is in ControlId.
                            Data: round(value, decimals),
                        };
                        sutils.CallServerFunction('SacmiTcHmiAuditTrailExt.AddEntry', trail, null, null);
                    } catch (e) {
                        TcHmi.Log.errorEx('[NumericSetData] ' + this.__id + ': AuditTrail failed: ' + e);
                    }
                }

                /** @internal Called by the keypad. */
                public __raiseLimitExceeded(value: number, limit: 'min' | 'max') {
                    TcHmi.EventProvider.raise(this.__id + '.onLimitExceeded', { value: value, limit: limit });
                }

                /* ---------- Value ---------- */

                public setValue(valueNew: number | null) {
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

                public getValue() {
                    return this.__value;
                }

                // "12.50 mm/s", "-" without a value.
                protected __processValue() {
                    const value = this.__value;
                    const unit = this.__unit ? ' ' + this.__unit : '';
                    if (value === null || value === undefined || !isFinite(value)) {
                        this.__elementValue.textContent = '-';
                        return;
                    }
                    const decimals = this.__effectiveDecimals();
                    this.__elementValue.textContent = format(round(value, decimals), decimals) + unit;
                }

                /* ---------- Decimals ---------- */

                public setDecimals(valueNew: number | null) {
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

                public getDecimals() {
                    return this.__decimals;
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

                // A lock with a description: blue lock, the box shows the description when tapped.
                protected __processLock() {
                    const hint = !!this.__lock && !!this.__lockDescription;
                    this.__elementTemplateRoot.toggleClass('sdf-nsd-locked', !!this.__lock);
                    this.__elementTemplateRoot.toggleClass('sdf-nsd-has-hint', hint);
                    if (this.__lock && Keypad.isOpenFor(this)) {
                        Keypad.close();
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
                    this.__element.toggleClass('sdf-nsd-hidden', !!this.__hide);
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

                /* ---------- Unit ---------- */

                public setUnit(valueNew: string | null) {
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

                public getUnit() {
                    return this.__unit;
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

                // In %: a share of the width the value box leaves free, so 100% fills it exactly.
                protected __processTextWidth() {
                    const width = this.__textWidth;
                    if (width === null || width === undefined || !isFinite(width)) {
                        this.__elementText.style.width = '';
                    } else if (this.__textWidthUnit === '%') {
                        this.__elementText.style.width =
                            'calc((100% - var(--sdf-nsd-box-width) - var(--sdf-nsd-gap)) * ' + width / 100 + ')';
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

                /* ---------- keypad labels (bind %l%...%/l% to localize) ---------- */

                public setMinLabel(valueNew: string | null) {
                    this.__minLabel = this.__label(valueNew, 'MinLabel', this.__minLabel, this.__localizedMinLabel);
                }

                public getMinLabel() {
                    return this.__minLabel;
                }

                public setMaxLabel(valueNew: string | null) {
                    this.__maxLabel = this.__label(valueNew, 'MaxLabel', this.__maxLabel, this.__localizedMaxLabel);
                }

                public getMaxLabel() {
                    return this.__maxLabel;
                }

                public setCurrentLabel(valueNew: string | null) {
                    this.__currentLabel = this.__label(valueNew, 'CurrentLabel', this.__currentLabel, this.__localizedCurrentLabel);
                }

                public getCurrentLabel() {
                    return this.__currentLabel;
                }

                // Shown the next time the keypad opens: nothing to process.
                protected __label(valueNew: string | null, propertyName: string, old: string | undefined, localized: LocalizedText) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal(propertyName);
                    }
                    const label = convertedValue || '';
                    if (label !== old) {
                        localized.set(label);
                        TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: propertyName });
                    }
                    return label;
                }
            }
        }
    }
}

TcHmi.Controls.registerEx('NumericSetData', 'TcHmi.Controls.SetDataFramework', TcHmi.Controls.SetDataFramework.NumericSetData);

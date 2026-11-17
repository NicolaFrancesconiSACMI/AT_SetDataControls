/*
 * StringSetData
 *
 * Shows a string symbol (Text on the left, the string in a value box) and edits it with a built-in
 * alphanumeric keyboard. Same look and lock states as NumericSetData; by default it is identical to it.
 *
 * - String is bound to a string symbol, e.g. %s%PLC1.MAIN.sRecipe%/s% (TwoWay).
 * - Maximum length: the maxLength of the data type (STRING(20) -> 20). Unknown: no limit, the server decides.
 * - Layout: TextWidth / TextAlignment for the text, SetDataAlignment for the box, StringWidth for its width
 *   (default 180 px like NumericSetData, wider for long strings), StringAlignment for the string inside it.
 * - Press: opens the keyboard unless Hide, Lock, disabled or no "operate" right.
 *   Locked with a Lock Description: a tap shows it in a bubble. No "operate" right: user lock icon, silent.
 * - No AuditTrail yet: the audit extension stores numbers only.
 * - ✓ / Enter: bound to a symbol the keyboard writes it directly (to see a failed write) and does not
 *   call setString, else the TwoWay binding would write a second time; the value comes back through
 *   the binding. Unbound, String itself is set. ✕ / Esc closes without writing.
 * - RejectSpecialCharacters: only A-Z a-z 0-9 _ - . and space can be entered; other keys are greyed,
 *   typing / pasting them is refused, and ✓ refuses a value that still contains one. Nothing is trimmed.
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

            // Same as --sdf-ssd-gap in Style.css: needed as a number for StringWidth in %.
            const BOX_GAP = 4;

            /* ---------- characters ---------- */

            // RejectSpecialCharacters: safe in file names, recipe names, CSV, XML and SQL.
            const UNSAFE_CHAR = /[^A-Za-z0-9_\-. ]/;

            function isSafe(text: string) {
                return !UNSAFE_CHAR.test(text);
            }

            /* ---------- data type ---------- */

            // maxLength of a string schema, also behind $ref / allOf; anyOf / oneOf only if every branch has one.
            function maxLengthOf(s: any, depth = 0): number | null {
                if (!s || typeof s !== 'object' || depth > 10) {
                    return null;
                }
                const all: (number | null)[] = [typeof s.maxLength === 'number' ? s.maxLength : null];
                if (typeof s.$ref === 'string') {
                    all.push(maxLengthOf(TcHmi.Type.getSchema(s.$ref), depth + 1));
                }
                if (Array.isArray(s.allOf)) {
                    for (const part of s.allOf) {
                        all.push(maxLengthOf(part, depth + 1));
                    }
                }
                for (const key of ['anyOf', 'oneOf']) {
                    if (Array.isArray(s[key]) && s[key].length) {
                        const branches = s[key].map((part: any) => maxLengthOf(part, depth + 1));
                        all.push(branches.indexOf(null) >= 0 ? null : Math.max.apply(null, branches));
                    }
                }
                const known = all.filter((n): n is number => n !== null);
                return known.length ? Math.min.apply(null, known) : null;
            }

            // The server is asked once per symbol, not on every press.
            const lengthCache: { [target: string]: number | null } = {};
            const lengthPending: { [target: string]: ((max: number | null) => void)[] } = {};

            // callback(maxLength | null). Synchronous when already known.
            function maxLengthOfTarget(target: string, callback: (max: number | null) => void) {
                if (target in lengthCache) {
                    callback(lengthCache[target]);
                    return;
                }
                if (lengthPending[target]) {
                    lengthPending[target].push(callback);
                    return;
                }
                lengthPending[target] = [callback];
                TcHmi.Symbol.resolveSchema(target, data => {
                    const waiting = lengthPending[target] || [];
                    delete lengthPending[target];
                    let max: number | null = null;
                    if (data.error === TcHmi.Errors.NONE && data.schema) {
                        max = lengthCache[target] = maxLengthOf(data.schema);
                        TcHmi.Log.debugEx('[StringSetData] ' + target + ' maxLength', max);
                    } else {
                        TcHmi.Log.warnEx('[StringSetData] Could not resolve the type of ' + target + ': no length check.');
                    }
                    waiting.forEach(cb => cb(max));
                });
            }

            /* ---------- keyboard ---------- */

            interface KeyboardSession {
                owner: StringSetData;
                target: string | null;     // null: String is not bound, the attribute itself is set
                maxLength: number | null;
                reject: boolean;           // RejectSpecialCharacters
                edited: boolean;          // a late read of the current value must not overwrite typing
                busy: boolean;             // write running
            }

            // Letter slots: [letter, symbol on the ?123 page]. Rows 2..4 of the keyboard.
            const ROW_Q: [string, string][] = [['q', '!'], ['w', '@'], ['e', '#'], ['r', '$'], ['t', '%'],
                ['y', '&'], ['u', '*'], ['i', '('], ['o', ')'], ['p', '=']];
            const ROW_A: [string, string][] = [['a', '/'], ['s', '\\'], ['d', ':'], ['f', ';'], ['g', '"'],
                ['h', '\''], ['j', '+'], ['k', '?'], ['l', '<']];
            const ROW_Z: [string, string][] = [['z', '>'], ['x', '['], ['c', ']'], ['v', '{'], ['b', '}'],
                ['n', '~'], ['m', '|']];

            // One keyboard per page, built on first use and shown in the TopMostLayer.
            // On-screen keys act on the <input>; a physical keyboard types into it natively.
            class Keyboard {
                private static __el: HTMLElement | null = null;
                private static __session: KeyboardSession | null = null;
                private static __token = 0;
                private static __repeat: number | null = null;
                private static __shift: 'off' | 'once' | 'lock' = 'off';
                private static __shiftAt = 0;
                private static __symbols = false;
                private static __userWatch = false;

                private static __q<E extends HTMLElement = HTMLElement>(selector: string) {
                    return Keyboard.__el!.querySelector(selector) as E;
                }

                private static get __input() {
                    return Keyboard.__q<HTMLInputElement>('.sdf-akb-input');
                }

                private static __build() {
                    const el = document.createElement('div');
                    el.className = 'sdf-akb';
                    const key = (name: string, label: string, cls = '') =>
                        '<button type="button" class="sdf-akb-key' + (cls ? ' ' + cls : '') + '" data-key="' + name + '">' + label + '</button>';
                    const chr = (c: string) => key('Char', Keyboard.__escape(c));
                    const slot = (s: [string, string]) =>
                        '<button type="button" class="sdf-akb-key" data-key="Char" data-letter="' + s[0] +
                        '" data-symbol="' + Keyboard.__escape(s[1]) + '">' + s[0] + '</button>';

                    el.innerHTML =
                        '<div class="sdf-akb-title"><span class="sdf-akb-title-text"></span>' +
                        '<button type="button" class="sdf-akb-close" data-key="Escape" aria-label="Close">✕</button></div>' +
                        '<div class="sdf-akb-value"><input class="sdf-akb-input" type="text" inputmode="none" autocomplete="off" spellcheck="false">' +
                        '<span class="sdf-akb-count"></span></div>' +
                        '<div class="sdf-akb-current"><span class="sdf-akb-label"></span><span class="sdf-akb-current-text"></span></div>' +
                        '<div class="sdf-akb-keys">' +
                        '1234567890'.split('').map(chr).join('') + key('Backspace', '⌫', 'sdf-akb-func') +
                        key('Enter', '✓', 'sdf-akb-key-accent') +
                        ROW_Q.map(slot).join('') +
                        ROW_A.map(slot).join('') + chr('-') +
                        key('Shift', '⇧', 'sdf-akb-func') + ROW_Z.map(slot).join('') + chr(',') + chr('.') + chr('_') +
                        key('Page', '?123', 'sdf-akb-func') + key('Left', '◀', 'sdf-akb-func') + key('Space', '␣') +
                        key('Right', '▶', 'sdf-akb-func') + key('Clear', 'Clear', 'sdf-akb-func') +
                        '</div>';

                    const input = el.querySelector('.sdf-akb-input') as HTMLInputElement;
                    input.addEventListener('keydown', e => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            Keyboard.__confirm();
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            Keyboard.close();
                        }
                    });
                    // Typing, paste and drop: refused as a whole if it contains a blocked character.
                    input.addEventListener('beforeinput', e => {
                        const st = Keyboard.__session;
                        if (st && st.reject && e.data && !isSafe(e.data)) {
                            e.preventDefault();
                            Keyboard.__blink('.sdf-akb-value');
                        }
                    });
                    input.addEventListener('input', () => Keyboard.__changed());

                    // pointerdown + preventDefault: the input keeps its focus and caret.
                    el.addEventListener('pointerdown', e => {
                        const button = (e.target as HTMLElement).closest('[data-key]') as HTMLElement | null;
                        if (e.target !== input) {
                            e.preventDefault();
                        }
                        if (!button) {
                            return;
                        }
                        const name = button.getAttribute('data-key')!;
                        button.classList.add('down');
                        if (name === 'Escape') {
                            return; // ✕ closes on release (click): the rest of the tap cannot reach what is behind
                        }
                        Keyboard.__onKey(name, button);
                        if (name === 'Backspace' || name === 'Left' || name === 'Right') {
                            Keyboard.__startRepeat(name, button);
                        }
                    });
                    const up = () => {
                        Keyboard.__stopRepeat();
                        el.querySelectorAll('.down').forEach(k => k.classList.remove('down'));
                    };
                    el.addEventListener('pointerup', up);
                    el.addEventListener('pointercancel', up);
                    el.addEventListener('pointerleave', up);
                    // click, not pointerdown: a finger slid off ✕ does not close
                    el.addEventListener('click', e => {
                        if ((e.target as HTMLElement).closest('[data-key="Escape"]')) {
                            Keyboard.close();
                        }
                    });
                    Keyboard.__wireDrag(el);
                    // Fast repeated taps are a double click for the browser: no text selection outside the input.
                    el.addEventListener('dblclick', e => {
                        if (e.target !== input) {
                            e.preventDefault();
                        }
                    });
                    return el;
                }

                private static __escape(text: string) {
                    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                }

                private static __startRepeat(key: string, button: HTMLElement) {
                    Keyboard.__stopRepeat();
                    const started = Date.now();
                    Keyboard.__repeat = window.setInterval(() => {
                        if (Date.now() - started > 400) {
                            Keyboard.__onKey(key, button);
                        }
                    }, 80);
                }

                private static __stopRepeat() {
                    if (Keyboard.__repeat !== null) {
                        window.clearInterval(Keyboard.__repeat);
                        Keyboard.__repeat = null;
                    }
                }

                public static isOpenFor(owner: StringSetData) {
                    return Keyboard.__session !== null && Keyboard.__session.owner === owner;
                }

                // target null: String is not bound, current is the attribute value.
                public static open(owner: StringSetData, target: string | null, current: string | null, text: string,
                    currentLabel: string, reject: boolean) {
                    if (!Keyboard.__userWatch) {
                        // Another user logged in (or auto-logout): nothing opened by the previous user stays open.
                        Keyboard.__userWatch = true;
                        TcHmi.EventProvider.register('onUserChanged', () => Keyboard.close());
                    }
                    if (Keyboard.__session) {
                        Keyboard.close();
                    }
                    if (!Keyboard.__el) {
                        Keyboard.__el = Keyboard.__build();
                    }
                    const token = ++Keyboard.__token;
                    const st: KeyboardSession = Keyboard.__session = {
                        owner: owner,
                        target: target,
                        maxLength: null,
                        reject: reject,
                        edited: false,
                        busy: false
                    };
                    const alive = () => token === Keyboard.__token;

                    Keyboard.__shift = 'off';
                    Keyboard.__symbols = false;
                    Keyboard.__q('.sdf-akb-title-text').textContent = text;
                    Keyboard.__q('.sdf-akb-label').textContent = currentLabel;
                    Keyboard.__input.removeAttribute('maxlength');
                    Keyboard.__clearError();
                    Keyboard.__showCurrent(current);
                    Keyboard.__renderKeys();

                    // Transparent, but modal: touching the background does nothing (no close, nothing behind).
                    TcHmi.TopMostLayer.add(owner, Keyboard.__el, {
                        dimBackground: false,
                        modal: true,
                        closeOnBackground: false,
                        resizeCb: () => Keyboard.__moveTo(Keyboard.__el!.offsetLeft, Keyboard.__el!.offsetTop),
                        removeCb: () => {
                            // Removed by anyone else than close(): drop pending reads / writes.
                            if (alive()) {
                                Keyboard.__token++;
                                Keyboard.__session = null;
                                Keyboard.__stopRepeat();
                            }
                        }
                    });
                    Keyboard.__center(); // every open starts centred, wherever it was dragged to
                    Keyboard.__input.focus();
                    Keyboard.__input.select(); // first key replaces the value; tap to place the caret instead

                    if (!target) {
                        return;
                    }
                    maxLengthOfTarget(target, max => {
                        if (!alive()) {
                            return;
                        }
                        st.maxLength = max;
                        if (max !== null) {
                            Keyboard.__input.maxLength = max;
                        }
                        Keyboard.__renderCount();
                    });
                    TcHmi.Symbol.readEx2<any>(target, data => {
                        if (!alive()) {
                            return;
                        }
                        if (data.error !== TcHmi.Errors.NONE) {
                            TcHmi.Log.errorEx('[StringSetData] Could not read ' + target + '.');
                            return;
                        }
                        const value = data.value === null || data.value === undefined ? '' : String(data.value);
                        Keyboard.__q('.sdf-akb-current-text').textContent = value;
                        if (!st.edited) {
                            Keyboard.__input.value = value;
                            Keyboard.__input.select();
                            Keyboard.__renderCount();
                        }
                    });
                }

                private static __showCurrent(current: string | null) {
                    const value = current === null ? '' : current;
                    Keyboard.__q('.sdf-akb-current-text').textContent = value;
                    Keyboard.__input.value = value;
                    Keyboard.__renderCount();
                }

                private static __center() {
                    const el = Keyboard.__el!;
                    const parent = el.parentElement;
                    if (parent) {
                        Keyboard.__moveTo((parent.clientWidth - el.offsetWidth) / 2, (parent.clientHeight - el.offsetHeight) / 2);
                    }
                }

                // Kept inside the layer, also when the screen shrinks (resizeCb).
                private static __moveTo(left: number, top: number) {
                    const el = Keyboard.__el!;
                    const parent = el.parentElement;
                    const maxLeft = parent ? parent.clientWidth - el.offsetWidth : Infinity;
                    const maxTop = parent ? parent.clientHeight - el.offsetHeight : Infinity;
                    el.style.position = 'absolute';
                    el.style.left = Math.round(Math.max(0, Math.min(maxLeft, left))) + 'px';
                    el.style.top = Math.round(Math.max(0, Math.min(maxTop, top))) + 'px';
                }

                // Dragged by its title bar (not by the close button).
                private static __wireDrag(el: HTMLElement) {
                    const handle = el.querySelector('.sdf-akb-title') as HTMLElement;
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
                            Keyboard.__moveTo(start.left + (e.clientX - start.x) / start.scale, start.top + (e.clientY - start.y) / start.scale);
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
                        Keyboard.__input.focus(); // keep the physical keyboard working after a drag
                    };
                    handle.addEventListener('pointerup', end);
                    handle.addEventListener('pointercancel', end);
                }

                public static close() {
                    const el = Keyboard.__el;
                    const st = Keyboard.__session;
                    Keyboard.__token++;
                    Keyboard.__session = null;
                    Keyboard.__stopRepeat();
                    if (el && st) {
                        Keyboard.__input.blur();
                        TcHmi.TopMostLayer.remove(st.owner, el);
                    }
                }

                /* ---------- keys ---------- */

                /** Called by the control when RejectSpecialCharacters changes while the keyboard is open. */
                public static setReject(owner: StringSetData, reject: boolean) {
                    if (Keyboard.isOpenFor(owner)) {
                        Keyboard.__session!.reject = reject;
                        Keyboard.__renderKeys();
                    }
                }

                // Labels of the letter slots for the current page and shift state; blocked characters greyed.
                private static __renderKeys() {
                    const el = Keyboard.__el!;
                    const upper = Keyboard.__shift !== 'off';
                    const reject = !!Keyboard.__session && Keyboard.__session.reject;
                    el.querySelectorAll('[data-letter]').forEach(k => {
                        const letter = k.getAttribute('data-letter')!;
                        k.textContent = Keyboard.__symbols ? k.getAttribute('data-symbol')! : upper ? letter.toUpperCase() : letter;
                    });
                    el.querySelectorAll('[data-key="Char"]').forEach(k => {
                        k.classList.toggle('sdf-akb-key-disabled', reject && !isSafe(k.textContent || ''));
                    });
                    Keyboard.__q('[data-key="Page"]').textContent = Keyboard.__symbols ? 'ABC' : '?123';
                    el.classList.toggle('sdf-akb-shift-once', Keyboard.__shift === 'once');
                    el.classList.toggle('sdf-akb-shift-lock', Keyboard.__shift === 'lock');
                }

                private static __renderCount() {
                    const st = Keyboard.__session;
                    const length = Keyboard.__input.value.length;
                    Keyboard.__q('.sdf-akb-count').textContent = st && st.maxLength !== null ? length + '/' + st.maxLength : String(length);
                }

                // After every edit, on-screen or physical.
                private static __changed() {
                    if (Keyboard.__session) {
                        Keyboard.__session.edited = true;
                    }
                    Keyboard.__clearError();
                    Keyboard.__renderCount();
                }

                // ⇧: one tap = next letter capital, a second tap within 400 ms = caps lock, a tap on lock = off.
                private static __toggleShift() {
                    const now = Date.now();
                    if (Keyboard.__shift === 'off') {
                        Keyboard.__shift = 'once';
                    } else if (Keyboard.__shift === 'once') {
                        Keyboard.__shift = now - Keyboard.__shiftAt < 400 ? 'lock' : 'off';
                    } else {
                        Keyboard.__shift = 'off';
                    }
                    Keyboard.__shiftAt = now;
                    Keyboard.__renderKeys();
                }

                // setRangeText ignores maxlength: checked here.
                private static __insert(text: string) {
                    const st = Keyboard.__session!;
                    const input = Keyboard.__input;
                    const start = input.selectionStart || 0;
                    const end = input.selectionEnd || 0;
                    if (st.reject && !isSafe(text)) {
                        Keyboard.__blink('.sdf-akb-value'); // the key is greyed: should not happen
                        return;
                    }
                    if (st.maxLength !== null && input.value.length - (end - start) + text.length > st.maxLength) {
                        Keyboard.__blink('.sdf-akb-count');
                        return;
                    }
                    input.setRangeText(text, start, end, 'end');
                    Keyboard.__changed();
                }

                private static __backspace() {
                    const input = Keyboard.__input;
                    let start = input.selectionStart || 0;
                    const end = input.selectionEnd || 0;
                    if (start === end) {
                        start = Math.max(0, start - 1);
                    }
                    input.setRangeText('', start, end, 'end');
                    Keyboard.__changed();
                }

                // A selection collapses to its side first, like a physical arrow key.
                private static __moveCaret(delta: number) {
                    const input = Keyboard.__input;
                    const start = input.selectionStart || 0;
                    const end = input.selectionEnd || 0;
                    const caret = start !== end ? (delta < 0 ? start : end) : Math.max(0, Math.min(input.value.length, start + delta));
                    input.setSelectionRange(caret, caret);
                }

                private static __onKey(key: string, button: HTMLElement) {
                    if (!Keyboard.__session) {
                        return;
                    }
                    switch (key) {
                        case 'Enter': Keyboard.__confirm(); return;
                        case 'Escape': Keyboard.close(); return;
                        case 'Backspace': Keyboard.__backspace(); return;
                        case 'Left': Keyboard.__moveCaret(-1); return;
                        case 'Right': Keyboard.__moveCaret(1); return;
                        case 'Space': Keyboard.__insert(' '); return;
                        case 'Shift': Keyboard.__toggleShift(); return;
                        case 'Page':
                            Keyboard.__symbols = !Keyboard.__symbols;
                            Keyboard.__renderKeys();
                            return;
                        case 'Clear':
                            Keyboard.__input.value = '';
                            Keyboard.__changed();
                            return;
                        case 'Char':
                            Keyboard.__insert(button.textContent || '');
                            if (Keyboard.__shift === 'once' && button.hasAttribute('data-letter') && !Keyboard.__symbols) {
                                Keyboard.__shift = 'off';
                                Keyboard.__renderKeys();
                            }
                            return;
                    }
                }

                private static __confirm() {
                    const st = Keyboard.__session;
                    if (!st || st.busy) {
                        return;
                    }
                    const value = Keyboard.__input.value;
                    Keyboard.__clearError();
                    if (st.reject && !isSafe(value)) {
                        Keyboard.__blink('.sdf-akb-value'); // e.g. an old value with "/": the operator fixes it
                        return;
                    }
                    if (st.maxLength !== null && value.length > st.maxLength) {
                        Keyboard.__blink('.sdf-akb-count');
                        return;
                    }
                    if (!st.target) {
                        Keyboard.close();
                        st.owner.setString(value);
                        st.owner.__raiseValueWritten(value);
                        return;
                    }

                    st.busy = true;
                    const token = Keyboard.__token;
                    TcHmi.Symbol.writeEx(st.target, value, data => {
                        st.busy = false;
                        if (token !== Keyboard.__token) {
                            return; // closed or reopened meanwhile
                        }
                        if (data.error === TcHmi.Errors.NONE) {
                            Keyboard.close();
                            st.owner.__raiseValueWritten(value);
                        } else {
                            TcHmi.Log.errorEx('[StringSetData] Writing ' + st.target + ' failed: ' +
                                (data.details && data.details.reason ? data.details.reason : data.error));
                            Keyboard.__blink('.sdf-akb-value');
                        }
                    });
                }

                private static __clearError() {
                    if (Keyboard.__el) {
                        Keyboard.__el.querySelectorAll('.sdf-akb-error').forEach(el => el.classList.remove('sdf-akb-error'));
                    }
                }

                // Restarts the animation if it is already blinking.
                private static __blink(selector: string) {
                    Keyboard.__clearError();
                    const el = Keyboard.__q(selector);
                    void el.offsetWidth; // reflow, so a repeated error blinks from the start
                    el.classList.add('sdf-akb-error');
                }
            }

            /* ---------- lock hint (same as NumericSetData) ---------- */

            // One bubble per page with the Lock Description, next to the value box, in the TopMostLayer.
            // Modal with closeOnBackground: any tap closes it, also a second tap on the same box.
            class Hint {
                private static __el: HTMLElement | null = null;
                private static __owner: StringSetData | null = null;
                private static __token = 0;
                private static __timer: number | null = null;

                public static isOpenFor(owner: StringSetData) {
                    return Hint.__owner === owner;
                }

                public static open(owner: StringSetData, anchor: HTMLElement, text: string) {
                    if (Hint.__owner) {
                        Hint.close();
                    }
                    if (!Hint.__el) {
                        Hint.__el = document.createElement('div');
                        Hint.__el.className = 'sdf-ssd-tip';
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
                    el.classList.toggle('sdf-ssd-tip-below', !above);
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

            export class StringSetData extends TcHmi.Controls.System.TcHmiControl {

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

                protected __string: string | null | undefined;
                protected __lock: boolean | undefined;
                protected __lockDescription: string | undefined;
                protected __hide: boolean | undefined;
                protected __text: string | undefined;
                protected __currentLabel: string | undefined;
                /** Shown text of CurrentLabel; created in __previnit, before the setters. */
                protected __localizedCurrentLabel!: LocalizedText;
                protected __rejectSpecialCharacters: boolean | undefined;
                protected __stringWidth: number | null | undefined;
                protected __stringWidthUnit: string | undefined;
                protected __textWidth: number | null | undefined;
                protected __textWidthUnit: string | undefined;
                protected __textAlignment: string | undefined;
                protected __setDataAlignment: string | undefined;
                protected __stringAlignment: string | undefined;

                protected __onPressed = () => this.__press();

                public __previnit() {
                    this.__elementTemplateRoot = this.__element.find('.TcHmi_Controls_SetDataFramework_StringSetData-Template');
                    if (this.__elementTemplateRoot.length === 0) {
                        throw new Error('Invalid Template.html');
                    }
                    const root = this.__elementTemplateRoot[0];
                    this.__elementText = root.querySelector('.sdf-ssd-text') as HTMLElement;
                    this.__elementSlot = root.querySelector('.sdf-ssd-slot') as HTMLElement;
                    this.__elementValueBox = root.querySelector('.sdf-ssd-valuebox') as HTMLElement;
                    this.__elementValue = root.querySelector('.sdf-ssd-value') as HTMLElement;
                    // Read when the keyboard opens: nothing to process.
                    this.__localizedCurrentLabel = new LocalizedText(() => { });
                    super.__previnit();
                }

                public __init() {
                    super.__init();
                }

                public __attach() {
                    super.__attach();
                    this.__elementValueBox.addEventListener('click', this.__onPressed);
                    this.__localizedCurrentLabel.start();
                }

                public __detach() {
                    super.__detach();
                    this.__elementValueBox.removeEventListener('click', this.__onPressed);
                    this.__localizedCurrentLabel.stop();
                    this.__closePopups();
                }

                public destroy() {
                    if (this.__keepAlive) {
                        return;
                    }
                    this.__localizedCurrentLabel.stop();
                    this.__closePopups();
                    super.destroy();
                }

                protected __closePopups() {
                    if (Keyboard.isOpenFor(this)) {
                        Keyboard.close();
                    }
                    if (Hint.isOpenFor(this)) {
                        Hint.close();
                    }
                }

                /** The real symbol bound to String, null if String is not bound to a symbol. */
                protected __target(): string | null {
                    const expression = TcHmi.Binding.resolve('String', this);
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
                    const current = this.__string === undefined ? null : this.__string;
                    Keyboard.open(this, target, current, this.__text || '', this.__localizedCurrentLabel.text, !!this.__rejectSpecialCharacters);
                }

                /** @internal Called by the keyboard. */
                public __raiseValueWritten(value: string) {
                    TcHmi.EventProvider.raise(this.__id + '.onValueWritten', value);
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
                    this.__string = convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'String' });
                    this.__processString();
                }

                public getString() {
                    return this.__string;
                }

                // "-" without a value or with an empty string, as in the other controls.
                protected __processString() {
                    const value = this.__string;
                    this.__elementValue.textContent = value === null || value === undefined || value === '' ? '-' : value;
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
                    this.__elementTemplateRoot.toggleClass('sdf-ssd-locked', !!this.__lock);
                    this.__elementTemplateRoot.toggleClass('sdf-ssd-has-hint', hint);
                    if (this.__lock && Keyboard.isOpenFor(this)) {
                        Keyboard.close();
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
                    this.__element.toggleClass('sdf-ssd-hidden', !!this.__hide);
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

                /* ---------- RejectSpecialCharacters ---------- */

                public setRejectSpecialCharacters(valueNew: boolean | null) {
                    let convertedValue = TcHmi.ValueConverter.toBoolean(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('RejectSpecialCharacters');
                    }
                    if (convertedValue === this.__rejectSpecialCharacters) {
                        return;
                    }
                    this.__rejectSpecialCharacters = !!convertedValue;
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'RejectSpecialCharacters' });
                    Keyboard.setReject(this, this.__rejectSpecialCharacters);
                }

                public getRejectSpecialCharacters() {
                    return this.__rejectSpecialCharacters;
                }

                /* ---------- StringWidth / TextWidth ---------- */

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

                // --sdf-ssd-box-width = StringWidth (px, or % of the control width), read by the text width in %:
                // 100% = control width - box - gap, as in NumericSetData.
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
                        root.style.removeProperty('--sdf-ssd-box-width'); // CSS default: 180 px
                        box.width = box.flexBasis = '';
                    } else if (this.__stringWidthUnit === '%') {
                        const p = sw / 100;
                        root.style.setProperty('--sdf-ssd-box-width', sw + '%');
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
                        root.style.setProperty('--sdf-ssd-box-width', sw + 'px');
                        box.width = box.flexBasis = sw + 'px';
                    }

                    if (!hasText) {
                        this.__elementText.style.width = '';
                    } else if (textPercent) {
                        this.__elementText.style.width =
                            'calc((100% - var(--sdf-ssd-box-width) - var(--sdf-ssd-gap)) * ' + tw! / 100 + ')';
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

                /* ---------- StringAlignment ---------- */

                public setStringAlignment(valueNew: string | null) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('StringAlignment');
                    }
                    if (convertedValue === this.__stringAlignment) {
                        return;
                    }
                    this.__stringAlignment = convertedValue || 'Center';
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'StringAlignment' });
                    this.__elementValue.style.textAlign = this.__stringAlignment.toLowerCase();
                }

                public getStringAlignment() {
                    return this.__stringAlignment;
                }

                // AuditTrail: not yet, SacmiTcHmiAuditTrailExt stores numbers only. Add it with the extension update.

                /* ---------- keyboard label (bind %l%...%/l% to localize) ---------- */

                // Shown the next time the keyboard opens: nothing to process.
                public setCurrentLabel(valueNew: string | null) {
                    let convertedValue = TcHmi.ValueConverter.toString(valueNew);
                    if (convertedValue === null) {
                        convertedValue = this.getAttributeDefaultValueInternal('CurrentLabel');
                    }
                    const label = convertedValue || '';
                    if (label === this.__currentLabel) {
                        return;
                    }
                    this.__currentLabel = label;
                    this.__localizedCurrentLabel.set(label);
                    TcHmi.EventProvider.raise(this.__id + '.onPropertyChanged', { propertyName: 'CurrentLabel' });
                }

                public getCurrentLabel() {
                    return this.__currentLabel;
                }
            }
        }
    }
}

TcHmi.Controls.registerEx('StringSetData', 'TcHmi.Controls.SetDataFramework', TcHmi.Controls.SetDataFramework.StringSetData);

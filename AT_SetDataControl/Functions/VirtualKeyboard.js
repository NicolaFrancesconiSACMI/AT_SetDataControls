/*
 * Shared implementation of the free-typing keyboards of the package (no registration here):
 * OpenNumKeyboard.ts, OpenStringKeyboard.ts and CloseKeyboard.ts call it.
 *
 * The keyboard types into whatever text field has focus (any control, also from other packages) and
 * follows the focus while open: tap another field and typing goes there. It has no value box, no
 * limits and no Enter: the field commits as usual when it loses focus; ✕ closes and blurs the field.
 * Decimals / AllowNegative / RejectSpecialCharacters act on the on-screen keys only: a physical
 * keyboard types into the field natively.
 *
 * Every keyboard .function.json lists this file, and the engineering includes it once per function:
 * it is built on the first run only, later runs reuse it (no second set of document listeners).
 */
var TcHmi;
(function (TcHmi) {
    let Functions;
    (function (Functions) {
        let SetDataFramework;
        (function (SetDataFramework) {
            SetDataFramework.VirtualKeyboard = SetDataFramework.VirtualKeyboard || createVirtualKeyboard();
            function createVirtualKeyboard() {
                /* ---------- target field ---------- */
                const TEXT_TYPES = ['text', 'search', 'password', 'tel', 'number', 'email', 'url'];
                function isField(el) {
                    if (el instanceof HTMLTextAreaElement) {
                        return !el.readOnly && !el.disabled;
                    }
                    return el instanceof HTMLInputElement && TEXT_TYPES.indexOf(el.type) >= 0 && !el.readOnly && !el.disabled;
                }
                // Last text field that had focus, outside the keyboard. Tracked from load, so a field focused
                // before the first open is known too.
                let lastField = null;
                // Fallback edits (see insert) do not make the browser fire "change" on blur: fired here.
                let dirty = null;
                document.addEventListener('focusin', e => {
                    if (isField(e.target) && !(Keyboard.el && Keyboard.el.contains(e.target))) {
                        lastField = e.target;
                    }
                }, true);
                document.addEventListener('focusout', e => {
                    if (dirty && e.target === dirty) {
                        const field = dirty;
                        dirty = null;
                        field.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, true);
                // Selection of a field, null where the type has none (number, email).
                function selectionOf(field) {
                    try {
                        if (field.selectionStart === null || field.selectionEnd === null) {
                            return null;
                        }
                        return { start: field.selectionStart, end: field.selectionEnd };
                    }
                    catch (e) {
                        return null;
                    }
                }
                // Replaces the selection (end of text without one). execCommand is a real user edit:
                // input events, maxlength, undo and "change" on blur all work as with a physical key.
                function replaceSelection(field, text) {
                    if (document.activeElement === field && document.execCommand('insertText', false, text)) {
                        return;
                    }
                    const sel = selectionOf(field);
                    if (sel) {
                        const room = field.maxLength >= 0 ? field.maxLength - (field.value.length - (sel.end - sel.start)) : Infinity;
                        if (text.length > room) {
                            return;
                        }
                        field.setRangeText(text, sel.start, sel.end, 'end');
                    }
                    else {
                        field.value = field.value + text;
                    }
                    dirty = field;
                    field.dispatchEvent(new Event('input', { bubbles: true }));
                }
                function deleteBack(field) {
                    if (document.activeElement === field && document.execCommand('delete')) {
                        return;
                    }
                    const sel = selectionOf(field);
                    if (sel) {
                        const start = sel.start === sel.end ? Math.max(0, sel.start - 1) : sel.start;
                        field.setRangeText('', start, sel.end, 'end');
                    }
                    else {
                        field.value = field.value.slice(0, -1);
                    }
                    dirty = field;
                    field.dispatchEvent(new Event('input', { bubbles: true }));
                }
                function setWhole(field, text) {
                    if (selectionOf(field)) {
                        field.setSelectionRange(0, field.value.length);
                    }
                    else if (field instanceof HTMLInputElement) {
                        field.select();
                    }
                    if (text === '') {
                        deleteBack(field);
                    }
                    else {
                        replaceSelection(field, text);
                    }
                }
                /* ---------- characters ---------- */
                // RejectSpecialCharacters: same rule as StringSetData.
                const UNSAFE_CHAR = /[^A-Za-z0-9_\-. ]/;
                // Letter slots: [letter, symbol on the ?123 page]. Same as StringSetData.
                const ROW_Q = [['q', '!'], ['w', '@'], ['e', '#'], ['r', '$'], ['t', '%'],
                    ['y', '&'], ['u', '*'], ['i', '('], ['o', ')'], ['p', '=']];
                const ROW_A = [['a', '/'], ['s', '\\'], ['d', ':'], ['f', ';'], ['g', '"'],
                    ['h', '\''], ['j', '+'], ['k', '?'], ['l', '<']];
                const ROW_Z = [['z', '>'], ['x', '['], ['c', ']'], ['v', '{'], ['b', '}'],
                    ['n', '~'], ['m', '|']];
                function escapeHtml(text) {
                    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                }
                /* ---------- keyboard ---------- */
                // One element per kind, built on first use and reused; only one is open at a time.
                // Non-modal in the TopMostLayer: the operator can still tap other fields.
                class Keyboard {
                    static open(kind, title) {
                        Keyboard.__watch();
                        Keyboard.close(false);
                        injectStyle();
                        const el = Keyboard.el = Keyboard.__built[kind] || (Keyboard.__built[kind] = Keyboard.__build(kind));
                        Keyboard.__kind = kind;
                        const token = ++Keyboard.__token;
                        el.querySelector('.sdf-vkb-title-text').textContent = title;
                        Keyboard.__applyTheme();
                        Keyboard.__clearError();
                        Keyboard.__render();
                        TcHmi.TopMostLayer.addEx(el, {
                            dimBackground: false,
                            modal: false,
                            closeOnBackground: false,
                            resizeCb: () => Keyboard.__moveTo(el.offsetLeft, el.offsetTop),
                            removeCb: () => {
                                // Removed by anyone else than close().
                                if (token === Keyboard.__token) {
                                    Keyboard.__reset();
                                }
                            }
                        });
                        Keyboard.__center(); // every open starts centred, wherever it was dragged to
                        return true;
                    }
                    // blur: ✕ / CloseKeyboard commit the field like a tap elsewhere would.
                    static close(blur) {
                        const el = Keyboard.el;
                        Keyboard.__reset();
                        if (!el) {
                            return;
                        }
                        TcHmi.TopMostLayer.removeEx(el);
                        if (blur && lastField && document.activeElement === lastField) {
                            lastField.blur();
                        }
                    }
                    static setNum(decimals, allowNegative) {
                        Keyboard.__decimals = typeof decimals === 'number' && isFinite(decimals) && decimals >= 0 ? Math.floor(decimals) : null;
                        Keyboard.__allowNegative = allowNegative !== false;
                    }
                    static setStr(reject) {
                        Keyboard.__reject = reject === true;
                        Keyboard.__shift = 'off';
                        Keyboard.__symbols = false;
                    }
                    static __reset() {
                        Keyboard.__token++;
                        Keyboard.__stopRepeat();
                        Keyboard.el = null;
                        Keyboard.__kind = null;
                    }
                    static __watch() {
                        if (Keyboard.__watching) {
                            return;
                        }
                        Keyboard.__watching = true;
                        // Another user logged in (or auto-logout): nothing opened by the previous user stays open.
                        TcHmi.EventProvider.register('onUserChanged', () => Keyboard.close(false));
                        TcHmi.EventProvider.register('onThemeDataChanged', () => Keyboard.__applyTheme());
                    }
                    static __applyTheme() {
                        const theme = TcHmi.Theme.get() || '';
                        Object.keys(Keyboard.__built).forEach(kind => Keyboard.__built[kind].classList.toggle('sdf-vkb-dark', /dark/i.test(theme)));
                    }
                    /* ---------- build ---------- */
                    static __build(kind) {
                        const el = document.createElement('div');
                        el.className = 'sdf-vkb sdf-vkb-' + kind;
                        const key = (name, label, cls = '') => '<button type="button" class="sdf-vkb-key' + (cls ? ' ' + cls : '') + '" data-key="' + name + '">' + label + '</button>';
                        const chr = (c) => key('Char', escapeHtml(c));
                        const slot = (s) => '<button type="button" class="sdf-vkb-key" data-key="Char" data-letter="' + s[0] +
                            '" data-symbol="' + escapeHtml(s[1]) + '">' + s[0] + '</button>';
                        const keys = kind === 'num'
                            ? '789'.split('').map(chr).join('') + key('Backspace', '⌫') +
                                '456'.split('').map(chr).join('') + key('Left', '◀') +
                                '123'.split('').map(chr).join('') + key('Right', '▶') +
                                key('ToggleSign', '±') + chr('0') + chr('.') + key('Clear', 'C')
                            : '1234567890'.split('').map(chr).join('') + key('Backspace', '⌫', 'sdf-vkb-func') +
                                ROW_Q.map(slot).join('') +
                                ROW_A.map(slot).join('') + chr('-') + key('Clear', 'Clear', 'sdf-vkb-func') +
                                key('Shift', '⇧', 'sdf-vkb-func') + ROW_Z.map(slot).join('') + chr(',') + chr('.') + chr('_') +
                                key('Page', '?123', 'sdf-vkb-func') + key('Left', '◀', 'sdf-vkb-func') + key('Space', '␣') +
                                key('Right', '▶', 'sdf-vkb-func');
                        el.innerHTML =
                            '<div class="sdf-vkb-title"><span class="sdf-vkb-title-text"></span>' +
                                '<button type="button" class="sdf-vkb-close" data-key="Escape" aria-label="Close">✕</button></div>' +
                                '<div class="sdf-vkb-keys">' + keys + '</div>';
                        // pointerdown + preventDefault: the field keeps its focus and caret.
                        el.addEventListener('pointerdown', e => {
                            e.preventDefault();
                            const button = e.target.closest('[data-key]');
                            if (!button) {
                                return;
                            }
                            const name = button.getAttribute('data-key');
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
                            if (e.target.closest('[data-key="Escape"]')) {
                                Keyboard.close(true);
                            }
                        });
                        // Fast repeated taps are a double click for the browser: no text selection.
                        el.addEventListener('dblclick', e => e.preventDefault());
                        Keyboard.__wireDrag(el);
                        return el;
                    }
                    static __startRepeat(key, button) {
                        Keyboard.__stopRepeat();
                        const started = Date.now();
                        Keyboard.__repeat = window.setInterval(() => {
                            if (Date.now() - started > 400) {
                                Keyboard.__onKey(key, button);
                            }
                        }, 80);
                    }
                    static __stopRepeat() {
                        if (Keyboard.__repeat !== null) {
                            window.clearInterval(Keyboard.__repeat);
                            Keyboard.__repeat = null;
                        }
                    }
                    /* ---------- position ---------- */
                    static __center() {
                        const el = Keyboard.el;
                        const parent = el.parentElement;
                        if (parent) {
                            Keyboard.__moveTo((parent.clientWidth - el.offsetWidth) / 2, (parent.clientHeight - el.offsetHeight) / 2);
                        }
                    }
                    // Kept inside the layer, also when the screen shrinks (resizeCb).
                    static __moveTo(left, top) {
                        const el = Keyboard.el;
                        if (!el) {
                            return;
                        }
                        const parent = el.parentElement;
                        const maxLeft = parent ? parent.clientWidth - el.offsetWidth : Infinity;
                        const maxTop = parent ? parent.clientHeight - el.offsetHeight : Infinity;
                        el.style.position = 'absolute';
                        el.style.left = Math.round(Math.max(0, Math.min(maxLeft, left))) + 'px';
                        el.style.top = Math.round(Math.max(0, Math.min(maxTop, top))) + 'px';
                    }
                    // Dragged by its title bar (not by the close button).
                    static __wireDrag(el) {
                        const handle = el.querySelector('.sdf-vkb-title');
                        let start = null;
                        handle.addEventListener('pointerdown', e => {
                            if (e.target.closest('[data-key]')) {
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
                        const end = (e) => {
                            if (!start) {
                                return;
                            }
                            start = null;
                            if (handle.hasPointerCapture(e.pointerId)) {
                                handle.releasePointerCapture(e.pointerId);
                            }
                        };
                        handle.addEventListener('pointerup', end);
                        handle.addEventListener('pointercancel', end);
                    }
                    /* ---------- keys ---------- */
                    // Greyed keys: '.' / '±' (num), blocked characters (str); letter labels for page and shift.
                    static __render() {
                        const el = Keyboard.el;
                        if (Keyboard.__kind === 'num') {
                            el.querySelectorAll('[data-key="Char"]').forEach(k => {
                                k.classList.toggle('sdf-vkb-key-disabled', k.textContent === '.' && Keyboard.__decimals === 0);
                            });
                            el.querySelector('[data-key="ToggleSign"]').classList.toggle('sdf-vkb-key-disabled', !Keyboard.__allowNegative);
                            return;
                        }
                        const upper = Keyboard.__shift !== 'off';
                        el.querySelectorAll('[data-letter]').forEach(k => {
                            const letter = k.getAttribute('data-letter');
                            k.textContent = Keyboard.__symbols ? k.getAttribute('data-symbol') : upper ? letter.toUpperCase() : letter;
                        });
                        el.querySelectorAll('[data-key="Char"]').forEach(k => {
                            k.classList.toggle('sdf-vkb-key-disabled', Keyboard.__reject && UNSAFE_CHAR.test(k.textContent || ''));
                        });
                        el.querySelector('[data-key="Page"]').textContent = Keyboard.__symbols ? 'ABC' : '?123';
                        el.classList.toggle('sdf-vkb-shift-once', Keyboard.__shift === 'once');
                        el.classList.toggle('sdf-vkb-shift-lock', Keyboard.__shift === 'lock');
                    }
                    // The field to type into, focused again if a tap elsewhere took the focus away.
                    static __field() {
                        const field = lastField;
                        if (!field || !field.isConnected || !isField(field)) {
                            Keyboard.__blink(); // nothing to type into
                            return null;
                        }
                        if (document.activeElement !== field) {
                            field.focus();
                        }
                        return field;
                    }
                    static __onKey(key, button) {
                        if (!Keyboard.el) {
                            return;
                        }
                        // Keys that only change the keyboard itself.
                        if (key === 'Shift') {
                            Keyboard.__toggleShift();
                            return;
                        }
                        if (key === 'Page') {
                            Keyboard.__symbols = !Keyboard.__symbols;
                            Keyboard.__render();
                            return;
                        }
                        const field = Keyboard.__field();
                        if (!field) {
                            return;
                        }
                        Keyboard.__clearError();
                        switch (key) {
                            case 'Backspace':
                                deleteBack(field);
                                return;
                            case 'Left':
                                Keyboard.__moveCaret(field, -1);
                                return;
                            case 'Right':
                                Keyboard.__moveCaret(field, 1);
                                return;
                            case 'Clear':
                                setWhole(field, '');
                                return;
                            case 'Space':
                                Keyboard.__type(field, ' ');
                                return;
                            case 'ToggleSign':
                                Keyboard.__toggleSign(field);
                                return;
                            case 'Char':
                                Keyboard.__type(field, button.textContent || '');
                                if (Keyboard.__shift === 'once' && button.hasAttribute('data-letter') && !Keyboard.__symbols) {
                                    Keyboard.__shift = 'off';
                                    Keyboard.__render();
                                }
                                return;
                        }
                    }
                    static __type(field, text) {
                        if (Keyboard.__kind === 'str' && Keyboard.__reject && UNSAFE_CHAR.test(text)) {
                            Keyboard.__blink(); // the key is greyed: should not happen
                            return;
                        }
                        if (Keyboard.__kind === 'num' && !Keyboard.__numAllowed(field, text)) {
                            Keyboard.__blink();
                            return;
                        }
                        replaceSelection(field, text);
                    }
                    // '.' only once and not with Decimals 0; no digit beyond Decimals after the '.'.
                    static __numAllowed(field, text) {
                        const value = field.value;
                        const sel = selectionOf(field) || { start: value.length, end: value.length };
                        const result = value.slice(0, sel.start) + text + value.slice(sel.end);
                        if (text === '.') {
                            return Keyboard.__decimals !== 0 && result.split('.').length <= 2;
                        }
                        const dot = result.indexOf('.');
                        if (Keyboard.__decimals !== null && dot >= 0 && sel.start > dot) {
                            return result.length - dot - 1 <= Keyboard.__decimals;
                        }
                        return true;
                    }
                    // ± works wherever the caret is: adds or removes the leading "-" and keeps the caret on its digit.
                    static __toggleSign(field) {
                        if (!Keyboard.__allowNegative) {
                            return;
                        }
                        const value = field.value;
                        const negative = value.charAt(0) === '-';
                        const sel = selectionOf(field);
                        setWhole(field, negative ? value.slice(1) : '-' + value);
                        if (sel && selectionOf(field)) {
                            const caret = Math.max(0, Math.min(field.value.length, sel.start + (negative ? -1 : 1)));
                            field.setSelectionRange(caret, caret);
                        }
                    }
                    // A selection collapses to its side first, like a physical arrow key.
                    static __moveCaret(field, delta) {
                        const sel = selectionOf(field);
                        if (!sel) {
                            return; // number / email fields have no caret API
                        }
                        const caret = sel.start !== sel.end
                            ? (delta < 0 ? sel.start : sel.end)
                            : Math.max(0, Math.min(field.value.length, sel.start + delta));
                        field.setSelectionRange(caret, caret);
                    }
                    // ⇧: one tap = next letter capital, a second tap within 400 ms = caps lock, a tap on lock = off.
                    static __toggleShift() {
                        const now = Date.now();
                        if (Keyboard.__shift === 'off') {
                            Keyboard.__shift = 'once';
                        }
                        else if (Keyboard.__shift === 'once') {
                            Keyboard.__shift = now - Keyboard.__shiftAt < 400 ? 'lock' : 'off';
                        }
                        else {
                            Keyboard.__shift = 'off';
                        }
                        Keyboard.__shiftAt = now;
                        Keyboard.__render();
                    }
                    static __clearError() {
                        if (Keyboard.el) {
                            Keyboard.el.querySelectorAll('.sdf-vkb-error').forEach(e => e.classList.remove('sdf-vkb-error'));
                        }
                    }
                    // Title bar blinks: no field to type into, or the key is refused. Restarts if already blinking.
                    static __blink() {
                        Keyboard.__clearError();
                        const title = Keyboard.el && Keyboard.el.querySelector('.sdf-vkb-title-text');
                        if (title) {
                            void title.offsetWidth; // reflow, so a repeated error blinks from the start
                            title.classList.add('sdf-vkb-error');
                            window.setTimeout(() => title.classList.remove('sdf-vkb-error'), 1600);
                        }
                    }
                }
                Keyboard.el = null; // the open one
                Keyboard.__built = {};
                Keyboard.__kind = null;
                Keyboard.__token = 0;
                Keyboard.__repeat = null;
                Keyboard.__watching = false;
                // num
                Keyboard.__decimals = null;
                Keyboard.__allowNegative = true;
                // str
                Keyboard.__reject = false;
                Keyboard.__shift = 'off';
                Keyboard.__shiftAt = 0;
                Keyboard.__symbols = false;
                /* ---------- style ---------- */
                // Functions get no themed CSS from the framework: injected once. Same design as the
                // keypad / keyboard of NumericSetData and StringSetData (Style.css + Themes/*), own prefix.
                function injectStyle() {
                    if (document.getElementById('sdf-vkb-style')) {
                        return;
                    }
                    const style = document.createElement('style');
                    style.id = 'sdf-vkb-style';
                    style.textContent = STYLE;
                    document.head.appendChild(style);
                }
                const STYLE = `
.sdf-vkb {
        --sdf-vkb-panel: #f4f6f8; --sdf-vkb-surface: #ffffff; --sdf-vkb-surface-down: #e3e8ed; --sdf-vkb-func: #e9edf1;
        --sdf-vkb-line: #d5dbe1; --sdf-vkb-text: #1f2933; --sdf-vkb-text-2: #6b7785;
        --sdf-vkb-accent: #1f6fb2; --sdf-vkb-error: #dc0000;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        background-color: var(--sdf-vkb-panel);
        color: var(--sdf-vkb-text);
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 12px 32px rgba(16, 24, 40, 0.28), 0 2px 6px rgba(16, 24, 40, 0.12);
        font-family: inherit;
        user-select: none;
        -webkit-user-select: none;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
}
.sdf-vkb.sdf-vkb-dark {
        --sdf-vkb-panel: #1e2328; --sdf-vkb-surface: #2b3238; --sdf-vkb-surface-down: #3a434c; --sdf-vkb-func: #353d44;
        --sdf-vkb-line: #424b54; --sdf-vkb-text: #e6e9ed; --sdf-vkb-text-2: #9aa5b1;
        --sdf-vkb-accent: #3a8fd6; --sdf-vkb-error: #ff4d4d;
}
.sdf-vkb-num { width: 400px; height: 330px; }
.sdf-vkb-str { width: 920px; height: 410px; }
.sdf-vkb button {
        font: inherit;
        color: inherit;
        border: none;
        margin: 0;
        padding: 0;
        cursor: pointer;
}
.sdf-vkb-title {
        flex: 0 0 52px;
        display: flex;
        align-items: center;
        padding: 0 6px 0 40px;
        position: relative;
        background-color: var(--sdf-vkb-surface);
        box-shadow: inset 0 -1px 0 var(--sdf-vkb-line);
        cursor: move;
        touch-action: none;
}
.sdf-vkb-title::before {
        content: "\\2807\\2807";
        position: absolute;
        left: 14px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 18px;
        letter-spacing: -6px;
        color: var(--sdf-vkb-text-2);
        pointer-events: none;
}
.sdf-vkb-title-text {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 18px;
        font-weight: bold;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
}
.sdf-vkb-close {
        flex: 0 0 40px;
        height: 40px;
        border-radius: 10px;
        font-size: 20px !important;
        background: transparent;
}
.sdf-vkb-close.down { background-color: var(--sdf-vkb-surface-down); }
.sdf-vkb-keys {
        flex: 1 1 auto;
        display: grid;
        gap: 6px;
        padding: 12px;
}
.sdf-vkb-num .sdf-vkb-keys { grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(4, 1fr); }
.sdf-vkb-str .sdf-vkb-keys { grid-template-columns: repeat(12, 1fr); grid-template-rows: repeat(5, 1fr); }
.sdf-vkb-key {
        border-radius: 10px;
        background-color: var(--sdf-vkb-surface) !important;
        box-shadow: inset 0 0 0 1px var(--sdf-vkb-line), 0 1px 2px rgba(16, 24, 40, 0.08);
}
.sdf-vkb-num .sdf-vkb-key { font-size: 26px !important; }
.sdf-vkb-str .sdf-vkb-key { font-size: 22px !important; }
.sdf-vkb-str .sdf-vkb-key.sdf-vkb-func {
        font-size: 18px !important;
        background-color: var(--sdf-vkb-func) !important;
}
.sdf-vkb-key.down {
        background-color: var(--sdf-vkb-surface-down) !important;
        box-shadow: inset 0 0 0 1px var(--sdf-vkb-line);
}
/* string: ⌫ two columns by two rows top right, where the controls' ✓ is */
.sdf-vkb-str [data-key="Backspace"] { grid-column: 11 / span 2; grid-row: 1 / span 2; }
.sdf-vkb-str [data-key="Clear"]     { grid-column: 11 / span 2; }
.sdf-vkb-str [data-key="Shift"]     { grid-column: 1 / span 2; }
.sdf-vkb-str [data-key="Page"]      { grid-column: 1 / span 2; }
.sdf-vkb-str [data-key="Space"]     { grid-column: 4 / span 8; }
.sdf-vkb-shift-once [data-key="Shift"] {
        box-shadow: inset 0 0 0 2px var(--sdf-vkb-accent);
        color: var(--sdf-vkb-accent);
}
.sdf-vkb-shift-lock [data-key="Shift"] {
        background-color: var(--sdf-vkb-accent) !important;
        color: #ffffff;
}
.sdf-vkb-key.sdf-vkb-key-disabled {
        opacity: 0.35;
        pointer-events: none;
}
@keyframes sdf-vkb-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.2; }
}
.sdf-vkb-error {
        color: var(--sdf-vkb-error) !important;
        animation: sdf-vkb-blink 0.8s steps(1, end) infinite;
}
`;
                return {
                    openNum: (title, decimals, allowNegative) => {
                        Keyboard.setNum(decimals, allowNegative);
                        return Keyboard.open('num', title);
                    },
                    openStr: (title, rejectSpecialCharacters) => {
                        Keyboard.setStr(rejectSpecialCharacters);
                        return Keyboard.open('str', title);
                    },
                    close: () => {
                        const wasOpen = Keyboard.el !== null;
                        Keyboard.close(true);
                        return wasOpen;
                    }
                };
            }
        })(SetDataFramework = Functions.SetDataFramework || (Functions.SetDataFramework = {}));
    })(Functions = TcHmi.Functions || (TcHmi.Functions = {}));
})(TcHmi || (TcHmi = {}));
//# sourceMappingURL=VirtualKeyboard.js.map
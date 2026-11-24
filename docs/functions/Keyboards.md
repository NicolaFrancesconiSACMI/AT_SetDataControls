# Keyboard functions

[← Back to README](../../README.md)

These functions open the package's keypad and keyboard **without one of our controls**. Use them when a field from another package (for example a Beckhoff `TcHmiTextbox`) should get the same look as the SetData controls.

| Function | What it does | Returns |
|---|---|---|
| `OpenNumKeyboard(Title, Decimals, AllowNegative)` | Opens the numeric keypad | `true` if opened |
| `OpenStringKeyboard(Title, RejectSpecialCharacters)` | Opens the alphanumeric keyboard | `true` if opened |
| `CloseKeyboard()` | Closes the open keyboard and commits the field | `true` if a keyboard was open |

In the Actions editor they are under the **AT_SetData** category. In JavaScript they are `TcHmi.Functions.SetDataFramework.OpenNumKeyboard(...)` and so on.

## How it differs from the controls' keyboards

- **It types into the field that has focus.** It has no value box of its own, no MIN/MAX/CURRENT row and no ✓ / ↵ key.
- **It follows the focus.** While it is open, tap another text field and typing goes there.
- **The field commits as usual:** when it loses focus, or when the keyboard closes with ✕ or `CloseKeyboard()`.
- If no text field is focused, the title blinks and the key does nothing.
- It is **not modal**. The rest of the page stays usable.
- It can be dragged by its title bar and opens centred.
- It follows the `Base` / `Base-Dark` theme. Any theme whose name contains *Dark* gets the dark colours.
- It closes by itself when the user changes (login or auto-logout).
- Only one keyboard is open at a time. Opening one closes the other.

## OpenNumKeyboard

```
 7  8  9  ⌫
 4  5  6  ◀
 1  2  3  ▶
 ±  0  .  C
```

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `Title` | String | empty | Text in the title bar. |
| `Decimals` | Number | empty | Empty = free. `0` = **.** greyed. `N` = no more than N digits after the **.** |
| `AllowNegative` | Boolean | `true` | `false` = **±** greyed. |

- ◀ ▶ move the caret.
- **C** clears the field.
- **±** adds or removes the leading `-`.

## OpenStringKeyboard

It has the same keys as the StringSetData keyboard: digits, QWERTY, `- , . _`, ⇧ Shift (tap once for one capital, double-tap for caps lock), the **?123** page, ◀ ▶, Space, Clear and ⌫. ⌫ is large and sits top right, where the ✓ key is on the controls.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `Title` | String | empty | Text in the title bar. |
| `RejectSpecialCharacters` | Boolean | `false` | `true` = only `A-Z a-z 0-9 _ - .` and space. The other keys are greyed. This is the same rule as StringSetData. |

## Typical use

On the textbox's `.onFocusIn` event, add the action **OpenStringKeyboard** (or **OpenNumKeyboard**) with a title. Optionally add **CloseKeyboard** on another event, for example when the view is left.

> ⚠️ `Decimals`, `AllowNegative` and `RejectSpecialCharacters` apply to the **on-screen keys only**. A physical keyboard types into the field normally. The field and its binding still do their own checks.

> 💡 Fields of type `number` or `email` have no caret in the browser. On these fields, ◀ ▶ do nothing and keys always add to the end.

# <img src="../../AT_SetDataControl/Controls/PasswordSetData/Icons/16x16.png" width="20"> PasswordSetData

[← Back to README](../../README.md)

PasswordSetData is the password version of [StringSetData](StringSetData.md). The value box shows one dot per character, and the operator types a new password on a masked on-screen keyboard that always opens empty. The maximum length is taken from the PLC data type (`STRING(n)`).

```
 Password                                ┌──────────────────┐
                                         │    ●●●●●●●●   ✎ │
                                         └──────────────────┘
```

## What the operator sees and does

- The value box shows **one dot per character**, or `-` when the password is empty or there is no value.
- **Tapping the box opens the keyboard.** It is the StringSetData keyboard, except:
  - the input field is **masked** and starts **empty**: the current password is never shown, and there is no *CURRENT* row
  - the character counter (`n/max`) still shows how many characters were typed
  - there is no way to reveal what was typed
- With **`NeedRepeat = TRUE`** there are two fields, *New* and *Repeat*:
  - **Enter** in *New* moves to *Repeat*; tapping a field also selects it
  - **✓** writes only when both fields match; otherwise both blink and *Repeat* is cleared
- With `NeedRepeat = TRUE` and **`MinLength` / `MinSpecialCharacters`** > 0, the rules sit inside the *New* box,
  before the counter, as symbol pills (no text to translate):

  ```
   NEW_PASSWORD     ●●●●       [↔ ≥5 ✗] [#@ ≥2 ✓]   4/20
   REPEAT_PASSWORD                                 0/20
  ```

  - **↔ ≥n** = at least n characters, **#@ ≥n** = at least n special characters
  - each rule is **red ✗** until the *New* field meets it and turns **green ✓** as you type
  - a special character is anything that is not a letter or a digit (space included)
  - **Enter** in *New* and **✓** are refused while a rule is red: the red rules blink
- A physical keyboard also works: **Enter** confirms, **Esc** cancels.
- **✓ / Enter** writes the password, closes the keyboard and fires `.onValueWritten`.

## Typical binding

```iecst
VAR
    sPassword : STRING(20);
END_VAR
```

`Password` = `%s%PLC1.MAIN.sPassword%/s%`

### Login (unbound)

Leave `Password` unbound and read it directly, like `TcHmiPasswordInput::Text`:

1. Pass `%ctrl%MyPasswordSetData::Password%/ctrl%` to the login function, for example on the login button, or on `.onValueWritten` to log in with ✓.
2. Afterwards, write `""` to `%ctrl%MyPasswordSetData::Password%/ctrl%` (WriteToSymbol), so the password does not stay in memory.

## Security

What the control does:

- **Copy, cut, drag and the context menu are refused** on the control and on the keyboard, including Ctrl+C / Ctrl+X. Nothing in the control can be selected.
- The keyboard fields are browser password fields (`type="password"`, no autofill, no suggestions, no browser reveal button).
- **The keyboard never reads the current password.** It asks the PLC only for the data type (for the maximum length).
- The typed text is **wiped** whenever the keyboard closes (✕, ✓, Esc, Lock, Hide, user change, page change).
- `.onValueWritten` has **no payload**, and log messages never contain the value.
- **Paste is allowed** (as in the Beckhoff PasswordInput), so a password can come from a password manager.

What the control **cannot** protect:

- **`Password` is readable**, like `TcHmiPasswordInput::Text`: any binding, function or script can read `%ctrl%Id::Password%/ctrl%`. Only the display is masked.
- When `Password` is bound to a PLC symbol, the TcHmi server sends the **plain password to the browser** to show the dots. Anyone with the browser developer tools (or access to the server's symbol browser) can see it there.
- To protect it, also:
  - use HTTPS / WSS for the HMI
  - restrict read access to the symbol in the TcHmi server for groups that should not see it
  - or use a PLC pattern where the HMI only *writes* the new password to a symbol that the PLC consumes and then clears or hashes

## Attributes

### PasswordSetData

| Attribute | Type | Default | Description |
|---|---|---|---|
| **Password** | String (OneWay) | `null` | Password. Shown as dots. If it is unbound, the control sets its own attribute. Readable as `%ctrl%Id::Password%/ctrl%`. |
| Lock | Boolean | `false` | TRUE: read-only, lock icon. See [Lock](../../README.md#lock). |
| Lock Description | String | `""` | Reason shown in a bubble when the locked control is tapped. |
| Hide | Boolean | `false` | TRUE: collapsed and not editable. |
| Text | String | `null` | Description on the left. Also used as the keyboard title. |
| NeedRepeat | Boolean | `false` | TRUE: the new password is typed twice and written only when both match. Also enables the two rules below. |
| MinLength | Number | `0` | NeedRepeat only: minimum number of characters. `0` = no rule. |
| MinSpecialCharacters | Number | `0` | NeedRepeat only: minimum number of special characters (not a letter or digit). `0` = no rule. |

### PasswordSetData Layout

| Attribute | Type | Default | Description |
|---|---|---|---|
| StringWidth | MeasurementValue | `180` | Width of the value box. |
| StringWidthUnit | MeasurementUnit | `"px"` | `px` or `%` (a share of the control width). |
| TextWidth | MeasurementValue | `100` | Width of the left text. In %: a share of (control width − box). |
| TextWidthUnit | MeasurementUnit | `"%"` | `px` or `%`. |
| TextAlignment | HorizontalAlignment | `"Left"` | Alignment of the text. |
| SetDataAlignment | HorizontalAlignment | `"Right"` | Position of the value box in the remaining width. |
| StringAlignment | HorizontalAlignment | `"Center"` | Alignment of the dots inside the box. |

### Keyboard

| Attribute | Type | Default | Description |
|---|---|---|---|
| NewLabel | String | `"%l%NEW_PASSWORD%/l%"` | With NeedRepeat: label of the first field. |
| RepeatLabel | String | `"%l%REPEAT_PASSWORD%/l%"` | With NeedRepeat: label of the second field. |
| MinLengthLabel | String | `"%l%PASSWORD_MIN_LENGTH%/l%"` | Tooltip of the MinLength rule pill (the pill itself shows only symbols). `{0}` is replaced by the number, e.g. `Min. {0} characters`; without `{0}` the number is appended. |
| MinSpecialCharactersLabel | String | `"%l%PASSWORD_MIN_SPECIAL%/l%"` | Tooltip of the MinSpecialCharacters rule pill, e.g. `Min. {0} special characters`. |

## Events

| Event | When | Argument |
|---|---|---|
| `.onValueWritten` | A new password was written. | none |

## Notes

- **PasswordSetData has no Audit Trail**, on purpose: a password change must not end up in a log.
- If the max length of the symbol cannot be determined, there is no limit on the client side.
- See also: [Writing to the PLC](../../README.md#writing-to-the-plc), [User access rights](../../README.md#user-access-rights).

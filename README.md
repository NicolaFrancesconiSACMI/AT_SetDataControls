<p align="center">
  <img src="AT_SetDataControl/Images/logo.png" alt="AT_SetDataControls" width="96">
</p>

<h1 align="center">AT_SetDataControls</h1>

<p align="center">
Ready-made TwinCAT HMI controls for editing and displaying PLC data.<br>
They all share one look, lock handling, user access rights and an optional Audit Trail.
</p>

---

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Controls at a glance](#controls-at-a-glance)
- [Quick start](#quick-start)
- [Common concepts](#common-concepts)
- [Version & license](#version--license)

---

## Requirements

| | |
|---|---|
| TwinCAT HMI | **1.12** (framework `Beckhoff.TwinCAT.HMI.Framework` ≥ 12.760.59 and < 13) |
| Themes | `Base` and `Base-Dark` are both supported |
| Optional – Audit Trail | `TcHmi.Functions.SUtils` function package + `SacmiTcHmiAuditTrailExt` server extension (only needed if you set `AuditTrail = TRUE`) |

## Installation

The package is distributed through the company NuGet feed.

1. **Add the feed (one time only)**
   Visual Studio → *Tools → Options → NuGet Package Manager → Package Sources* → **+**
   - Name: `SACMI HMI` (any name works)
   - Source: `<YOUR_FEED_URL>`
2. **Install the package in your HMI project**
   Right-click the HMI project → *Manage NuGet Packages…* → choose the feed above → search for **`AT_SetDataControls`** → *Install*.
3. **Use the controls**
   Open any `.view` / `.content`. The controls are in the **Toolbox** under the **AT_SetDataControls** group. Drag one onto the page and bind its main attribute (see the table below).

To update, open *Manage NuGet Packages → Updates*.

## Controls at a glance

### Set controls – the operator edits a value

| Control | What it is for | Bind this |
|---|---|---|
| [NumericSetData](docs/controls/NumericSetData.md) | Shows a number and edits it with a built-in keypad. Min/max limits are taken from the PLC. | `Value` → numeric symbol |
| [StringSetData](docs/controls/StringSetData.md) | Shows a string and edits it with a built-in on-screen keyboard. | `String` → STRING symbol |
| [PasswordSetData](docs/controls/PasswordSetData.md) | StringSetData for passwords: shows dots, masked keyboard that opens empty, copy refused, optional repeat field. | `Password` → STRING symbol |
| [BooleanSetData](docs/controls/BooleanSetData.md) | ON/OFF pill switch, with an optional confirmation dialog. | `Variable` → BOOL symbol |
| [ButtonSetData](docs/controls/ButtonSetData.md) | Push button. *Standard* is TRUE while pressed; *Toggle* switches a BOOL. It lights up from feedback, can ask for confirmation and supports button groups. | `Variable` → BOOL symbol |
| [ComboboxSetData](docs/controls/ComboboxSetData.md) | Drop-down list built from a list you define or from a PLC enumeration. | `SelectedValue` or `EnumDataSymbol` |

### Vis controls – read-only display

| Control | What it is for | Bind this |
|---|---|---|
| [NumericVisData](docs/controls/NumericVisData.md) | Shows a number with its unit. It changes colour or blinks when limits are crossed. | `Value` |
| [StringVisData](docs/controls/StringVisData.md) | Shows a string, or turns a number/state into a text with a colour. | `String` or `Value` |
| [LedVisData](docs/controls/LedVisData.md) | Round status LED for a BOOL or numeric value, with colour and blinking per state. | `Value` |

### Functions

| Function | What it is for |
|---|---|
| [OpenNumKeyboard / OpenStringKeyboard / CloseKeyboard](docs/functions/Keyboards.md) | Opens the package's keypad or keyboard for **any** focused text field, for example a TcHmiTextbox. It types straight into the field and has no Confirm key. |

The Set and Vis controls have the same height and the same value-box geometry. Placed in a column, they line up as one form.

## Quick start

**PLC**

```iecst
TYPE ST_HmiReal :
STRUCT
    HmiValue : REAL;
    MinValue : REAL;
    MaxValue : REAL;
END_STRUCT
END_TYPE

PROGRAM MAIN
VAR
    stSpeed : ST_HmiReal := (HmiValue := 50, MinValue := 0, MaxValue := 120);
    bPump   : BOOL;
END_VAR
```

**HMI**

1. Drag a **NumericSetData** onto the page and set:
   - `Value` = `%s%PLC1.MAIN.stSpeed::HmiValue%/s%`
   - `Text` = `Speed`
   - `Unit` = `mm/s`
   - `Decimals` = `1`
2. Drag a **BooleanSetData** onto the page and set:
   - `Variable` = `%s%PLC1.MAIN.bPump%/s%`
   - `Text` = `Pump`
3. Start the HMI. To edit the speed, tap the value box, type the new value on the keypad and press **↵**. The keypad shows `MinValue`/`MaxValue` and refuses any value outside that range.

> 💡 Bind with `::` (`stSpeed::HmiValue`). Then only the struct has to be mapped on the server, and NumericSetData finds the `MinValue` / `MaxValue` siblings by itself.

## Common concepts

All controls in the package behave the same way for the points below. The per-control pages link back here.

### Layout

Each control is one row: a **text on the left** (`Text`) and a **value box / switch / button / LED on the right**.

- `TextWidth` + `TextWidthUnit` set the width of the text.
  - In `px`, the value is an absolute width.
  - In `%`, it is a share of *(control width − value box)*. So **100 %** means the text takes everything except the value box.
- `TextAlignment` aligns the text inside its area.
- `SetDataAlignment` / `ValueAlignment` / `ToggleAlignment` / … place the value box in the width that is left.
- Default control size: **400 × 50 px**.

### Lock

- `Lock = TRUE` makes the control read-only and shows a 🔒 lock icon.
- Set `Lock Description` (for example `%l%LockReasonDoorOpen%/l%`) to show an **ⓘ** badge. When the operator taps the locked control, a bubble shows the reason for 6 s.
- **When `Lock` is bound to a symbol, the control stays locked until the first value arrives.** It never starts unlocked by accident.

### Hide

`Hide = TRUE` collapses the control, so it takes no space and cannot be operated. It does **not** change the standard `Visibility` attribute, so you can use both independently.

### User access rights

If the logged-in user has no **`operate`** right on the control (TwinCAT HMI access configuration), a *user-lock* icon is shown and taps are ignored. This applies even when `Lock` is FALSE.

### Writing to the PLC

- The Set controls write the symbol directly. The display updates when the value comes back from the PLC.
- If a write fails, the value **blinks red** and the error goes to the browser console.
- Bindings through user-control parameters (`%pp%…%/pp%`) are followed back to the real PLC symbol, so limits and data types work inside user controls too.

### Popups (keypad, keyboard, confirm dialog, drop-down)

- Only one popup is open per page.
- The keypad and keyboard can be dragged by their title bar. **Esc** cancels and **Enter** confirms.
- A popup closes by itself when:
  - the user changes (login or auto-logout)
  - the control becomes locked or hidden
  - for confirm dialogs, the value changes underneath it

### Audit Trail

The Audit Trail is supported by **NumericSetData, BooleanSetData, ButtonSetData and ComboboxSetData**.

- With `AuditTrail = TRUE`, every successful write to a PLC symbol is logged. The entry contains the user, the `Text` and the symbol, the old and new value, and the control type.
- It needs the `TcHmi.Functions.SUtils` package and the `SacmiTcHmiAuditTrailExt` server extension. If they are missing, only a warning is logged.
- Give the control a meaningful `Text`, because that is the name you will see in the log.

### Localization

The default labels use localization keys. Add these keys to your project's localization files, or the key name itself is shown:

| Key | Used by |
|---|---|
| `MIN`, `MAX`, `CURRENT` | NumericSetData keypad, StringSetData keyboard (`CURRENT`) |
| `NEW_PASSWORD`, `REPEAT_PASSWORD` | PasswordSetData keyboard with `NeedRepeat` |
| `PASSWORD_MIN_LENGTH`, `PASSWORD_MIN_SPECIAL` | PasswordSetData password rules (tooltip of the rule pills); `{0}` = the number, e.g. `Min. {0} characters` |
| `ON`, `OFF` | BooleanSetData, ButtonSetData confirm dialog |
| `CONFIRM`, `CANCEL` | Confirm dialogs |
| `Select` | ComboboxSetData placeholder |

Any text attribute can be localized with `%l%MyKey%/l%`.

### Colour lists (Vis controls)

`Limits` / `States` are lists in which **the first matching row wins**, so put the most severe condition at the top.

- `Default` (or `Grey` for the LED) also counts as a match: it stops the search and keeps the normal colour. A "normal range" row at the top is a valid way to use this.
- `Flashing` needs a colour other than Default/Grey. All blinking controls on a page blink in sync.
- A row value can be bound to a PLC symbol.

### Themes

Every control has a `Base` (light) and `Base-Dark` style and follows the active HMI theme automatically.
Blue marks *editable* data, red is reserved for *errors*, and grey for *locked*.

## Version & license

- **Version:** 1.0.0 – first release.
- **Owner:** SACMI.
- **License:** see [LICENSE.txt](AT_SetDataControl/LICENSE.txt).

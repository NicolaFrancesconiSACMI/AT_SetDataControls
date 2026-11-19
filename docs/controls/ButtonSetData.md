# <img src="../../AT_SetDataControl/Controls/ButtonSetData/Icons/16x16.png" width="20"> ButtonSetData

[← Back to README](../../README.md)

ButtonSetData is a keycap-style push button that writes a BOOL.

- **Standard** mode writes TRUE while the button is held and FALSE when it is released.
- **Toggle** mode inverts the BOOL on each click, optionally after a confirmation.

The button can light up like a glass bulb, for example from a feedback signal, and toggle buttons can form a mutually exclusive group.

```
                    ┌────────────────┐
                    │  ▶  START      │      ← OFF: grey keycap
                    └────────────────┘
                    ╔════════════════╗
                    ║  ▶  START      ║      ← lit: glowing (cyan by default)
                    ╚════════════════╝
```

## What the operator sees and does

### Standard (momentary)

- **Press** writes TRUE, **release** writes FALSE.
- FALSE is also written if:
  - the finger slides off the button
  - the touch is cancelled
  - the button becomes locked or hidden while it is held
  - the page is closed

  So the BOOL never stays TRUE by mistake.

### Toggle

- Each click writes the inverted value. The click counts when the finger is released over the button.
- A toggle that is TRUE stays pushed in.
- The button is inactive until the first value has been read.
- **NeedConfirm**: a dialog opens over a dimmed page.
  - It shows the `Text` (or `ButtonText`) as title and the change, for example **OFF → ON**.
  - **Confirm** (or Enter) writes the value. **Cancel** (or Esc) closes without writing.
- **ToggleGroup**: Toggle buttons on the same page with the same group name are mutually exclusive.
  - When one of them goes TRUE, all the others are written FALSE. This also happens when the change comes from the PLC.
  - Having none of them TRUE is allowed.

### Lighting

- **`ShowBackground` set or bound**: it alone decides whether the button is lit. A typical use is binding a feedback signal such as `bMotorRunning`, while `Variable` is the command.
- **`ShowBackground` not used**: the button is lit while `Variable` is TRUE.
- `OnBackgroundColor` sets the colour of the bulb. Empty means the theme cyan.
- `ButtonBackgroundColor` sets the colour of the unlit keycap (for special buttons). Empty means the theme colour.

## Typical binding

| Use | Variable | ShowBackground |
|---|---|---|
| Jog / start pulse | `%s%PLC1.MAIN.bStartCmd%/s%` (Standard) | `%s%PLC1.MAIN.bMotorRunning%/s%` |
| Enable switch | `%s%PLC1.MAIN.bEnable%/s%` (Toggle) | — |
| Mode selector (3 buttons) | `bModeAuto` / `bModeManual` / `bModeSetup` (Toggle, same `ToggleGroup = "Mode"`) | — |

## Attributes

### ButtonSetData

| Attribute | Type | Default | Description |
|---|---|---|---|
| ButtonType | ButtonType | `"Standard"` | `Standard` = TRUE while held. `Toggle` = each click inverts. |
| **Variable** | Boolean (TwoWay) | `null` | The BOOL to write. If it is unbound, the control sets its own attribute (events still fire). |
| ShowBackground | Boolean | `null` | Lights the button. When set or bound, it alone decides (for example from feedback). |
| OnBackgroundColor | SolidColor | `null` | Colour of the lit bulb. Empty means the theme cyan. |
| ButtonBackgroundColor | SolidColor | `null` | Colour of the unlit keycap. Hover, pressed, outline and lip are shades of it; text and lock badge turn white on dark colours. Empty means the theme colour. |
| ButtonText | String | `null` | Label in the button, up to 2 lines. |
| Icon | Path | `null` | Optional SVG/PNG icon, shown in its own colours. |
| Text | String | `null` | Description on the left (needs `TextWidth` > 0). Also used as the confirm title and the audit name. |
| Lock | Boolean | `false` | TRUE: cannot be pressed, lock badge. See [Lock](../../README.md#lock). |
| LockDescription | String | `""` | Reason shown in a bubble when the locked button is tapped. |
| Hide | Boolean | `false` | TRUE: collapsed and cannot be operated. |
| NeedConfirm | NeedConfirm | `"None"` | Toggle only: which clicks ask for confirmation. |
| AuditTrail | Boolean | `false` | Logs every write. See [Audit Trail](../../README.md#audit-trail). |
| ToggleGroup | String | `""` | Toggle only: buttons on the page with the same name are mutually exclusive. |

### ButtonSetData Layout

| Attribute | Type | Default | Description |
|---|---|---|---|
| SizeStyle | SizeStyle | `"Default"` | `Default` 120×45 (icon left), `Small` 50×50 (icon on top), `Custom`. |
| IconPosition | IconPosition | `"Auto"` | Icon position, every SizeStyle. `Auto` = `Top` with Small, else `Left`. `LeftEdge` / `RightEdge` pin the icon to the button edge, the label is centred in the rest. |
| IconSize | Number | `20` | Icon size in px. Applies to every SizeStyle (`Default`, `Small`, `Custom`), useful for icon-only buttons. |
| ButtonAlignment | HorizontalAlignment | `"Center"` | Position of the button in the width left of the text. |
| TextWidth | MeasurementValue | `0` | Width of the left text. **0 means no text.** |
| TextWidthUnit | MeasurementUnit | `"%"` | `px` or `%`. |
| TextAlignment | HorizontalAlignment | `"Left"` | Alignment of the text. |
| CustomWidth | Number | `120` | Button width in px (`SizeStyle = Custom`). |
| CustomHeight | Number | `45` | Button height in px (Custom). |
| CustomFontSize | Number | `16` | Label font size in px (Custom). |
| CustomCornerRadius | Number | `8` | Corner radius in px (Custom). |

### Confirm (Toggle only)

| Attribute | Type | Default | Description |
|---|---|---|---|
| OnText | String | `"%l%ON%/l%"` | Name of the TRUE state in the dialog. |
| OffText | String | `"%l%OFF%/l%"` | Name of the FALSE state. |
| ConfirmLabel | String | `"%l%CONFIRM%/l%"` | Button that writes the value. |
| CancelLabel | String | `"%l%CANCEL%/l%"` | Button that closes without writing. |

### Enum values

| Type | Values |
|---|---|
| ButtonType | `Standard`, `Toggle` |
| SizeStyle | `Default` (120×45, font 16), `Small` (50×50, font 11), `Custom` |
| IconPosition | `Auto`, `Left`, `Top`, `LeftEdge`, `RightEdge` |
| NeedConfirm | `None`, `SwitchOn` (FALSE→TRUE), `SwitchOff` (TRUE→FALSE), `All` |

## Events

| Event | When |
|---|---|
| `.onButtonPressed` | The button was pressed. Not fired when the button is locked, hidden, disabled or the user has no access. |
| `.onButtonReleased` | The press ended (released, slid off, cancelled, or locked while held). Always follows `.onButtonPressed`. |
| `.onButtonClick` | Released over the button. This is the default event in the designer. |
| `.onValueWritten` | A value was written to `Variable`, after the confirmation for Toggle. The argument is the written value. |

> Use these events rather than the standard `.onPressed`, which does not know about `Lock`.

## Notes

- **`SizeStyle` overwrites `MinWidth` / `MinHeight`** of the control so that the button always fits. Values you type there by hand are replaced.
- `TextWidth` is `0` by default, so `Text` is not visible until you set a width.
- `NeedConfirm` and `ToggleGroup` are ignored in Standard mode.
- Audit Trail: Toggle logs 1 / 0, and Standard logs one entry per press. Nothing is logged when `Variable` is unbound.

# <img src="../../AT_SetDataControl/Controls/BooleanSetData/Icons/16x16.png" width="20"> BooleanSetData

[← Back to README](../../README.md)

BooleanSetData shows a BOOL PLC value as an ON/OFF pill switch. Each tap inverts the value. It can ask for confirmation first.

```
 Pump                                         ┌─────────────┐
                                              │  ON     (●) │
                                              └─────────────┘
```

## What the operator sees and does

- A 120 × 34 px switch:
  - **OFF**: grey track, with `OffText` shown
  - **ON**: blue track, with `OnText` shown
- **Tap**: writes the inverted value.
- While no value has been read yet, the switch shows `-` and ignores taps.
- **Confirmation** (`NeedConfirm`): a dialog opens over a dimmed page.
  - It shows the control `Text` and the change, for example **OFF → ON**.
  - **Confirm** (or Enter) writes the value. **Cancel**, ✕ or Esc closes the dialog without writing.
  - The dialog closes by itself if the value changes in the PLC while it is open.
- The switch moves when the PLC confirms the new value. If the write fails, the switch blinks red.

## Typical binding

`Variable` = `%s%PLC1.MAIN.bPump%/s%`

## Attributes

### BooleanSetData

| Attribute | Type | Default | Description |
|---|---|---|---|
| **Variable** | Boolean (TwoWay) | `null` | BOOL to show and toggle. If it is unbound, the control sets its own attribute. |
| Lock | Boolean | `false` | TRUE: read-only, lock icon in the knob. See [Lock](../../README.md#lock). |
| Lock Description | String | `""` | Reason shown in a bubble when the locked switch is tapped. |
| Hide | Boolean | `false` | TRUE: collapsed and cannot be operated. |
| Text | String | `null` | Description on the left. Also used as the confirm dialog title. |
| OnText | String | `"%l%ON%/l%"` | Text in the switch when TRUE. |
| OffText | String | `"%l%OFF%/l%"` | Text in the switch when FALSE. |
| NeedConfirm | NeedConfirm | `"None"` | Which taps ask for confirmation first (see below). |
| AuditTrail | Boolean | `false` | Logs every write as 1 / 0. See [Audit Trail](../../README.md#audit-trail). |

### BooleanSetData Layout

| Attribute | Type | Default | Description |
|---|---|---|---|
| TextWidth | MeasurementValue | `100` | Width of the left text. In %: a share of (control width − switch). |
| TextWidthUnit | MeasurementUnit | `"%"` | `px` or `%`. |
| TextAlignment | HorizontalAlignment | `"Left"` | Alignment of the text. |
| ToggleAlignment | HorizontalAlignment | `"Right"` | Position of the switch in the remaining width. |

### Confirm

| Attribute | Type | Default | Description |
|---|---|---|---|
| ConfirmLabel | String | `"%l%CONFIRM%/l%"` | Button that writes the value. |
| CancelLabel | String | `"%l%CANCEL%/l%"` | Button that closes without writing. |

### NeedConfirm values

| Value | Asks for confirmation when… |
|---|---|
| `None` | never |
| `SwitchOn` | switching FALSE → TRUE |
| `SwitchOff` | switching TRUE → FALSE |
| `All` | always |

## Events

| Event | When | Argument |
|---|---|---|
| `.onValueWritten` | A new value was written, after the confirmation if one was asked for. | The new boolean |

## Notes

- The Audit Trail logs `TRUE`/`FALSE` (1 / 0) and never OnText/OffText, so the log is the same in every language.
- The switch size is fixed at 120 × 34 px.
- See also: [Writing to the PLC](../../README.md#writing-to-the-plc), [Localization](../../README.md#localization).

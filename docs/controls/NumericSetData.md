# <img src="../../AT_SetDataControl/Controls/NumericSetData/Icons/16x16.png" width="20"> NumericSetData

[← Back to README](../../README.md)

NumericSetData shows a numeric PLC value, and the operator edits it with a built-in keypad. The **min/max limits come from the PLC**: they are read from the `MinValue` / `MaxValue` siblings of the bound symbol. If those siblings are missing, the range of the data type is used.

```
 Speed                                   ┌──────────────────┐
                                         │   50.0 mm/s   ✎ │
                                         └──────────────────┘
```

## What the operator sees and does

- The value box (180 × 40 px) shows `value + unit` with `Decimals` digits. It shows `-` when there is no value.
- **Tapping the box opens the keypad.** The keypad has:
  - a title (`Text`) and ✕
  - the input field with the unit
  - a **MIN / CURRENT / MAX** row
  - the keys `0-9`, `.`, `±`, `⌫`, `−1`, `+1` and `↵`
- The current value is pre-selected, so the first key typed replaces it.
- `⌫`, `+1` and `−1` repeat while held.
- A physical keyboard also works:
  - digits, `-`, `.` and `,` (`,` is turned into `.`)
  - **Enter** confirms, **Esc** closes
- **↵ (Enter):**
  - **Outside min/max:** nothing is written. The value and the limit that was exceeded blink, and `.onLimitExceeded` fires.
  - **Not valid for the data type** (for example a fraction on an INT): nothing is written and the value blinks.
  - **Valid:** the value is written, the keypad closes, and `.onValueWritten` fires.
- If the symbol is an integer type, the control always uses 0 decimals, whatever `Decimals` is set to.

## Typical binding

```iecst
TYPE ST_HmiReal :
STRUCT
    HmiValue : REAL;
    MinValue : REAL;   // lower limit shown and enforced by the keypad
    MaxValue : REAL;   // upper limit
END_STRUCT
END_TYPE
```

`Value` = `%s%PLC1.MAIN.stSpeed::HmiValue%/s%`

> Use `::` (not `.`) between the struct and `HmiValue`. Then only the struct needs to be mapped, and the control finds `::MinValue` and `::MaxValue` by itself. With dot notation, you have to map the siblings as well.
> Top-level symbols and array elements have no siblings. For those, the data-type range is used.

## Attributes

### NumericSetData

| Attribute | Type | Default | Description |
|---|---|---|---|
| **Value** | Number (TwoWay) | `null` | Numeric symbol to show and edit. **Must be bound**, otherwise the keypad does not open. |
| Decimals | INT | `3` | Decimals shown and accepted (0..10). Forced to 0 for integer types. |
| Lock | Boolean | `false` | TRUE: read-only, lock icon. See [Lock](../../README.md#lock). |
| Lock Description | String | `""` | Reason shown in a bubble when the locked control is tapped. |
| Hide | Boolean | `false` | TRUE: collapsed and not editable. |
| Text | String | `null` | Description on the left. Also used as the keypad title. |
| Unit | String | `null` | Unit shown after the value and in the keypad. |
| AuditTrail | Boolean | `false` | Logs every written value. See [Audit Trail](../../README.md#audit-trail). |

### NumericSetData Layout

| Attribute | Type | Default | Description |
|---|---|---|---|
| TextWidth | MeasurementValue | `100` | Width of the left text. In %: a share of (control width − value box). |
| TextWidthUnit | MeasurementUnit | `"%"` | `px` or `%`. |
| TextAlignment | HorizontalAlignment | `"Left"` | Alignment of the text. |
| SetDataAlignment | HorizontalAlignment | `"Right"` | Position of the value box in the remaining width. |

### Keypad

| Attribute | Type | Default | Description |
|---|---|---|---|
| MinLabel | String | `"%l%MIN%/l%"` | Label of the minimum. |
| MaxLabel | String | `"%l%MAX%/l%"` | Label of the maximum. |
| CurrentLabel | String | `"%l%CURRENT%/l%"` | Label of the value before editing. |

## Events

| Event | When | Argument |
|---|---|---|
| `.onValueWritten` | A new value was written to the PLC. | The new number |
| `.onLimitExceeded` | The operator confirmed a value outside MinValue/MaxValue. Nothing was written. | `{ value, limit: "min" \| "max" }` |

## Notes

- The limits are read again each time the keypad opens, so changes made in the PLC are picked up straight away.
- Limits ≥ 1e12 are shown in exponential notation. A missing limit is shown as `—`. `LREAL` without siblings has no limit.
- The value box size is fixed at 180 × 40 px.
- See also: [Writing to the PLC](../../README.md#writing-to-the-plc), [User access rights](../../README.md#user-access-rights), [Localization](../../README.md#localization).

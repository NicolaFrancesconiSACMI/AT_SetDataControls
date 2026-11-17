# <img src="../../AT_SetDataControl/Controls/StringSetData/Icons/16x16.png" width="20"> StringSetData

[← Back to README](../../README.md)

StringSetData shows a string PLC value, and the operator edits it with a built-in alphanumeric on-screen keyboard. The maximum length is taken from the PLC data type (`STRING(n)`).

```
 Recipe name                             ┌──────────────────┐
                                         │   RECIPE_01   ✎ │
                                         └──────────────────┘
```

## What the operator sees and does

- The value box shows the string. It shows `-` when the string is empty or there is no value.
- **Tapping the box opens the keyboard.** It has:
  - a title (`Text`) and ✕
  - the input field with a **character counter** (`n/max`)
  - a *CURRENT* row with the old value
  - digits and QWERTY letters, plus `- , . _`
  - **⇧ Shift**: tap once for one capital letter, double-tap for caps lock
  - a **?123** symbols page
  - ◀ ▶ to move the caret
  - **Space**, **Clear** and **⌫**
- The current value is pre-selected, so the first key typed replaces it.
- A physical keyboard also works: **Enter** confirms, **Esc** cancels.
- Input longer than the `STRING(n)` length is refused, and the counter blinks.
- **✓ / Enter** writes the string, closes the keyboard and fires `.onValueWritten`.

## Typical binding

```iecst
VAR
    sRecipe : STRING(20);
END_VAR
```

`String` = `%s%PLC1.MAIN.sRecipe%/s%`

## Attributes

### StringSetData

| Attribute | Type | Default | Description |
|---|---|---|---|
| **String** | String (TwoWay) | `null` | String to show and edit. If it is unbound, the control sets its own attribute. |
| Lock | Boolean | `false` | TRUE: read-only, lock icon. See [Lock](../../README.md#lock). |
| Lock Description | String | `""` | Reason shown in a bubble when the locked control is tapped. |
| Hide | Boolean | `false` | TRUE: collapsed and not editable. |
| Text | String | `null` | Description on the left. Also used as the keyboard title. |
| RejectSpecialCharacters | Boolean | `false` | TRUE: only `A-Z a-z 0-9 _ - .` and space are allowed (safe for file and recipe names). Other keys are greyed out. |

### StringSetData Layout

| Attribute | Type | Default | Description |
|---|---|---|---|
| StringWidth | MeasurementValue | `180` | Width of the value box. Make it wider for long strings. |
| StringWidthUnit | MeasurementUnit | `"px"` | `px` or `%` (a share of the control width). |
| TextWidth | MeasurementValue | `100` | Width of the left text. In %: a share of (control width − box). |
| TextWidthUnit | MeasurementUnit | `"%"` | `px` or `%`. |
| TextAlignment | HorizontalAlignment | `"Left"` | Alignment of the text. |
| SetDataAlignment | HorizontalAlignment | `"Right"` | Position of the value box in the remaining width. |
| StringAlignment | HorizontalAlignment | `"Center"` | Alignment of the string inside the box. `Left` reads better for long strings. |

### Keyboard

| Attribute | Type | Default | Description |
|---|---|---|---|
| CurrentLabel | String | `"%l%CURRENT%/l%"` | Label of the value before editing. |

## Events

| Event | When | Argument |
|---|---|---|
| `.onValueWritten` | A new string was written. | The new string |

## Notes

- **StringSetData has no Audit Trail.** The Audit Trail only stores numbers.
- With `RejectSpecialCharacters = TRUE`, if the existing value already contains a blocked character, ✓ is refused until the operator removes it.
- If the max length of the symbol cannot be determined, there is no limit on the client side.
- See also: [Writing to the PLC](../../README.md#writing-to-the-plc), [User access rights](../../README.md#user-access-rights).

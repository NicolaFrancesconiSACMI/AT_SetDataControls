# <img src="../../AT_SetDataControl/Controls/ComboboxSetData/Icons/16x16.png" width="20"> ComboboxSetData

[← Back to README](../../README.md)

ComboboxSetData shows a text on the left and a drop-down list on the right, with the same look and lock states as NumericSetData. The operator picks an entry, and the control writes it to the bound symbol. Optionally, the pick is added to the Audit Trail.

```
 Production mode                         ┌──────────────────┐
                                         │   Automatic   ▾ │
                                         └──────────────────┘
                                         │ ✓ Automatic      │
                                         │   Manual         │
                                         │   Setup          │
```

## What the operator sees and does

- **Tap the box**: the list opens below it, or above it if there is no room below. It scrolls when it is longer than `MaxListHeight`.
- **Tap an entry**: the entry is written. Dragging the list scrolls it; it does not pick an entry.
- **Tap outside, tap the box again, or press Esc**: the list closes without writing anything.
- The selected entry has a ✓.
- Entries with a `category` are grouped under a heading. Entries without a category come last.
- When nothing matches the current value, the greyed `ComboboxText` placeholder is shown.

## Where the entries come from

The control uses the **first** source that is set.

1. **`EnumDataSymbol`**: a PLC enumeration. Its members become the entries, and a pick is written to that same symbol. This is the fastest way to set the control up.
2. **`SrcData`**: a list you define, in one of these formats:

```json
[
  { "id": 0, "text": "%l%Automatic%/l%", "value": 1, "category": "Production" },
  { "id": 1, "text": "%l%Manual%/l%",    "value": 2, "category": "Production" },
  { "id": 2, "text": "Setup",            "value": 3, "hide": "%s%PLC1.MAIN.bNoSetup%/s%" }
]
```

```json
["Low", "Medium", "High"]
```

```json
{ "Low": 10, "Medium": 20, "High": 30 }
```

- `text`, `category` and `hide` can be symbols (`%s%…%/s%`) or localized keys (`%l%…%/l%`). They update live.
- A missing `id` defaults to the position in the list.

## Where the pick is written

Only the **first bound** target is written:

| Priority | Target | Written value |
|---|---|---|
| 1 | `EnumDataSymbol` | the entry `value` |
| 2 | `SelectedValue` | the entry `value` |
| 3 | `SelectedId` | the entry `id` |
| 4 | `SelectedIndex` | the position in `SrcData` (0-based) |

**Bind only one of them.** In most cases that is `SelectedValue` (for example an INT) or `EnumDataSymbol`. The bound symbol also selects the matching entry when the PLC changes it. `"2"` and `2` count as the same value.

## Typical binding

```iecst
TYPE E_Mode : (Automatic := 1, Manual := 2, Setup := 3) INT; END_TYPE
VAR  eMode : E_Mode; END_VAR
```

`EnumDataSymbol` = `%s%PLC1.MAIN.eMode%/s%`. No `SrcData` is needed.

## Attributes

### ComboboxSetData

| Attribute | Type | Default | Description |
|---|---|---|---|
| SrcData | ListItemList | `null` | Entries (`id`, `text`, `value`, `category`, `hide`). A plain list of texts also works. |
| EnumDataSymbol | Symbol | `null` | PLC enumeration. It lists the members, selects the current one and writes the pick. Overrides `SrcData`. |
| SelectedIndex | UDINT (TwoWay) | `null` | Selected entry, 0-based. If bound, a pick writes the index. |
| SelectedId | UDINT (TwoWay) | `null` | ID of the selected entry. If bound, a pick writes the id. |
| SelectedValue | Any (TwoWay) | `null` | Value of the selected entry. If bound, a pick writes the value. |
| SelectedText | String (read-only) | `null` | Text of the selected entry. Cannot be bound; read it only. |
| ComboboxText | String | `"%l%Select%/l%"` | Placeholder shown when nothing is selected. |
| Lock | Boolean | `false` | TRUE: read-only, lock icon. See [Lock](../../README.md#lock). |
| Lock Description | String | `""` | Reason shown in a bubble when the locked box is tapped. |
| Hide | Boolean | `false` | TRUE: collapsed and not editable. |
| Text | String | `null` | Description on the left. Also used in the audit entry. |
| AuditTrail | Boolean | `false` | Logs every selection written. See [Audit Trail](../../README.md#audit-trail). |

### ComboboxSetData Layout

| Attribute | Type | Default | Description |
|---|---|---|---|
| ComboboxWidth | MeasurementValue | `180` | Width of the value box. |
| ComboboxWidthUnit | MeasurementUnit | `"px"` | `px` or `%`. |
| MaxListHeight | MeasurementValue | `280` | Maximum height of the drop-down in px. Longer lists scroll. |
| TextWidth | MeasurementValue | `100` | Width of the left text. In %: a share of (control width − box). |
| TextWidthUnit | MeasurementUnit | `"%"` | `px` or `%`. |
| TextAlignment | HorizontalAlignment | `"Left"` | Alignment of the text. |
| SetDataAlignment | HorizontalAlignment | `"Right"` | Position of the box in the remaining width. |
| ValueAlignment | HorizontalAlignment | `"Center"` | Alignment of the selected text inside the box. |

### ListItem (one row of SrcData)

| Field | Type | Default | Description |
|---|---|---|---|
| id | number | `null` | Unique numeric ID. Defaults to the position in the list. |
| text | string | `null` | **Required.** Text shown. |
| value | any | `null` | Value written. A numeric value is also used as the Audit Trail data. |
| category | string | `null` | Optional group heading. |
| hide | boolean | `false` | TRUE: not shown in the list. Can be bound to a symbol. |

## Events

| Event | When |
|---|---|
| `.onSelectionChanged` | The selection changed, either by the operator or from the PLC. This is the default event. |
| `.onValueWritten` | The operator's pick was written. The argument is the entry value. |
| `.onUserInteractionFinished` | The operator picked an entry, even the same one again. |
| `.onUserInteractionCanceled` | The list closed without a pick. |

## Notes

- `EnumDataSymbol` must point to a real PLC **enumeration**. Otherwise an error is logged and the list stays empty.
- `SelectedIndex` is the position in `SrcData`. Hidden entries and category grouping do not change it.
- Picking the entry that is already selected writes nothing.
- An empty list shows `-`.

# <img src="../../AT_SetDataControl/Controls/NumericVisData/Icons/16x16.png" width="20"> NumericVisData

[← Back to README](../../README.md)

NumericVisData shows a numeric value (read-only) and looks the same as [NumericSetData](NumericSetData.md). **Limits** change the colour of the value, or make it blink, when the value crosses them.

```
 Temperature                             ┌──────────────────┐
                                         │    85.2 °C       │   ← red + blinking above 80
                                         └──────────────────┘
```

## What it shows

- A value box (180 × 40 px) with `value + unit`, shown with `Decimals` digits. It shows `-` when there is no value.
- The first matching **Limit** colours the value text. With `Flashing`, the text blinks.
- Limits are compared with the **raw** value, not the rounded text.

## Typical binding

- `Value` = `%s%PLC1.MAIN.stTemp::HmiValue%/s%`
- `Unit` = `°C`
- `Decimals` = `1`

`Limits`, with the most severe row first:

| Limit | Sign | Color | Flashing |
|---|---|---|---|
| 80 | `>` | Red | ✓ |
| 60 | `>` | Orange | |
| 5 | `<` | Blue | |

A limit can be bound to a symbol, for example `%s%PLC1.MAIN.stTemp::MaxValue%/s%`.

## Attributes

### NumericVisData

| Attribute | Type | Default | Description |
|---|---|---|---|
| **Value** | Number | `null` | Numeric value to show. |
| Decimals | INT | `3` | Decimals shown (0..10). |
| Unit | String | `null` | Unit shown after the value. |
| Limits | LimitList | `[]` | Limit rows (see below). The first match colours the value. |
| Text | String | `null` | Description on the left. |
| Hide | Boolean | `false` | TRUE: collapsed (takes no space). |

### NumericVisData Layout

| Attribute | Type | Default | Description |
|---|---|---|---|
| TextWidth | MeasurementValue | `100` | Width of the left text. In %: a share of (control width − value box). |
| TextWidthUnit | MeasurementUnit | `"%"` | `px` or `%`. |
| TextAlignment | HorizontalAlignment | `"Left"` | Alignment of the text. |
| ValueAlignment | HorizontalAlignment | `"Right"` | Position of the value box in the remaining width. |

### Limit row

| Field | Type | Default (new row) | Description |
|---|---|---|---|
| limit | number | `0` | Threshold. Can be bound to a symbol. |
| sign | `>` `<` `>=` `<=` | `>` | Active while *value sign limit* is true. There is no `=`. |
| color | `Default` `Red` `Blue` `Green` `Orange` `Custom` | `Red` | `Default` keeps the theme colour and stops the search. |
| customColor | SolidColor | `null` | Used only with `color = Custom`. |
| flashing | boolean | `false` | The value blinks while this limit is active. |

## Events

There are no custom events.

## Notes

- **The first match wins.** Put the most severe row at the top. See [Colour lists](../../README.md#colour-lists-vis-controls).
- Use a numeric symbol. A BOOL is not converted to 1/0 here; use [LedVisData](LedVisData.md) or [StringVisData](StringVisData.md) for BOOLs.
- The value box is fixed at 180 × 40 px, the same as NumericSetData, so the two line up in a column.

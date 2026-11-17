# <img src="../../AT_SetDataControl/Controls/LedVisData/Icons/16x16.png" width="20"> LedVisData

[← Back to README](../../README.md)

LedVisData is a round status LED (read-only) for a BOOL or numeric value. The first matching **State** lights the LED in its colour, and can make it blink. When no state matches, the LED is unlit in `DefaultColor`. It looks the same as the lit bulb of [ButtonSetData](ButtonSetData.md).

```
 Pump running                                    ( ● )   ← green, glowing
```

## What it shows

- **Lit**: a glass bulb with a coloured rim and a glow, in the colour of the matching state.
- **Unlit**: no state matches, or there is no value. The bulb shows `DefaultColor` without the glow.
- **Flashing**: the bulb alternates between lit and unlit.
- A state with colour **Grey** keeps the LED unlit, for example as an explicit "off" state.

## Typical binding

### Simple BOOL lamp

- `Value` = `%s%PLC1.MAIN.bPumpOn%/s%`
- `States`: a single row with Value `1`, Sign `=`, Color `Green`. These are the defaults of a new row.

### Numeric status

- `Value` = `%s%PLC1.MAIN.nStatus%/s%`
- `States`, with the most severe row first:

| Value | Sign | Color | Flashing |
|---|---|---|---|
| 3 | `=` | Red | ✓ |
| 2 | `=` | Orange | |
| 1 | `=` | Green | |

To show a text next to the LED, set `Text` **and** a `TextWidth` above 0. The default `TextWidth` is 0, which hides the text.

## Attributes

### LedVisData

| Attribute | Type | Default | Description |
|---|---|---|---|
| **Value** | Number | `null` | BOOL or numeric value. TRUE/FALSE count as 1/0. |
| States | StateList | `[]` | State rows (see below). The first match lights the LED. |
| DefaultColor | ColorName | `"Grey"` | Colour of the unlit LED. `Grey` is the theme grey; `Custom` uses DefaultCustomColor. |
| DefaultCustomColor | SolidColor | `null` | Used only with `DefaultColor = Custom`. |
| Text | String | `null` | Description on the left. Shown only when `TextWidth` > 0. |
| Hide | Boolean | `false` | TRUE: collapsed (takes no space). |

### LedVisData Layout

| Attribute | Type | Default | Description |
|---|---|---|---|
| LedSize | Number | `30` | Diameter of the LED in px. The glow adds about 30 % on each side, so the control is at least 48 px for size 30. |
| LedAlignment | HorizontalAlignment | `"Right"` | Position of the LED in the width left of the text. |
| TextWidth | MeasurementValue | `0` | Width of the left text. **0 means no text.** |
| TextWidthUnit | MeasurementUnit | `"%"` | `px` or `%`. |
| TextAlignment | HorizontalAlignment | `"Left"` | Alignment of the text. |

### State row

| Field | Type | Default (new row) | Description |
|---|---|---|---|
| value | number | `1` | Value to compare (BOOL: TRUE = 1, FALSE = 0). Can be bound to a symbol. |
| sign | `=` `>` `<` `>=` `<=` | `=` | There is no `!=`. |
| color | `Grey` `Red` `Orange` `Green` `Custom` | `Green` | `Grey` = unlit, no glow, no blinking. |
| customColor | SolidColor | `null` | Used only with `color = Custom`. The rim and glow colours are calculated from it. |
| flashing | boolean | `false` | Blinks between lit and unlit. |

## Events

There are no custom events.

## Notes

- The LED colours (Red, Orange, Green) are fixed and do not change with the theme. There is no Blue.
- An invalid or transparent custom colour falls back to unlit grey.
- **The first match wins.** See [Colour lists](../../README.md#colour-lists-vis-controls).

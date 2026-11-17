# <img src="../../AT_SetDataControl/Controls/StringVisData/Icons/16x16.png" width="20"> StringVisData

[← Back to README](../../README.md)

StringVisData shows a text (read-only). It has two modes:

- **String**: shows a PLC STRING. **Limits** colour it, or make it blink, when it matches a text.
- **StateToString**: turns a number into a text using **States**, each with its own colour. This is ideal for machine states, step numbers and error codes.

```
 Machine state                           ┌──────────────────┐
                                         │     RUNNING      │   ← green
                                         └──────────────────┘
```

## What it shows

### Mode = String

- Shows `String`.
- `Limits` compare the string **trimmed and case-insensitive**, using `=` or `!=`.

### Mode = StateToString

- `Value` is a number. A BOOL is converted to 1/0.
- The first matching **State** shows its `text` in its colour. If `text` is empty, the number itself is shown.
- If no state matches, the number is shown in the normal colour.

### Both modes

- No value or an empty result shows `-`.
- Text that is too long is cut with `…`. Make `StringWidth` wider for long texts.

## Typical binding

### StateToString

`Mode` = `StateToString`, `Value` = `%s%PLC1.MAIN.nMachineState%/s%`

`States`:

| Value | Sign | Text | Color | Flashing |
|---|---|---|---|---|
| 0 | `=` | `%l%Stopped%/l%` | Default | |
| 1 | `=` | `%l%Running%/l%` | Green | |
| 2 | `=` | `%l%Alarm%/l%` | Red | ✓ |
| 100 | `>=` | `%l%Setup%/l%` | Orange | |

### String

`Mode` = `String`, `String` = `%s%PLC1.MAIN.sStatus%/s%`

`Limits`:

| Value | Sign | Color | Flashing |
|---|---|---|---|
| `ERROR` | `=` | Red | ✓ |
| `` (empty) | `=` | Orange | |

## Attributes

### StringVisData

| Attribute | Type | Default | Description |
|---|---|---|---|
| Mode | Mode | `"String"` | `String` or `StateToString`. |
| **String** | String | `null` | String to show (Mode = String). |
| Limits | LimitList | `[]` | Mode = String: limit rows (see below). The first match colours the string. |
| Text | String | `null` | Description on the left. |
| Hide | Boolean | `false` | TRUE: collapsed (takes no space). |
| **Value** | Number | `null` | Mode = StateToString: the number to translate. A BOOL is converted to 1/0. |
| States | StateList | `[]` | Mode = StateToString: state rows (see below). The first match shows its text and colour. |

### StringVisData Layout

| Attribute | Type | Default | Description |
|---|---|---|---|
| StringWidth | MeasurementValue | `180` | Width of the value box. |
| StringWidthUnit | MeasurementUnit | `"px"` | `px` or `%`. |
| TextWidth | MeasurementValue | `100` | Width of the left text. In %: a share of (control width − box). |
| TextWidthUnit | MeasurementUnit | `"%"` | `px` or `%`. |
| TextAlignment | HorizontalAlignment | `"Left"` | Alignment of the text. |
| ValueAlignment | HorizontalAlignment | `"Right"` | Position of the value box in the remaining width. |

### Limit row (Mode = String)

| Field | Type | Default (new row) | Description |
|---|---|---|---|
| value | string | `""` | Text to compare (trimmed, case-insensitive). Can be bound to a symbol. |
| sign | `=` `!=` | `=` | |
| color | `Default` `Red` `Blue` `Green` `Orange` `Custom` | `Red` | |
| customColor | SolidColor | `null` | Used only with `color = Custom`. |
| flashing | boolean | `false` | Blinks while matched. |

### State row (Mode = StateToString)

| Field | Type | Default (new row) | Description |
|---|---|---|---|
| value | number | `0` | Number to compare with `Value`. Can be bound to a symbol. |
| sign | `=` `!=` `>` `<` `>=` `<=` | `=` | |
| text | string | `""` | Text to show. Can be localized (`%l%…%/l%`). Empty shows the number. |
| color | `Default` `Red` `Blue` `Green` `Orange` `Custom` | `Default` | |
| customColor | SolidColor | `null` | Used only with `color = Custom`. |
| flashing | boolean | `false` | Needs a colour other than Default. |

## Events

There are no custom events.

## Notes

- `Limits` are used only in Mode = String, and `States` only in Mode = StateToString. The other list is ignored.
- **The first match wins.** See [Colour lists](../../README.md#colour-lists-vis-controls).
- The default width (180 px) matches StringSetData, so the two line up in a column.

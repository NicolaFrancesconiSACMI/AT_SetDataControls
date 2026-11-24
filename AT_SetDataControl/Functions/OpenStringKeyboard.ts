/*
 * OpenStringKeyboard - opens the package's alphanumeric keyboard for the focused text field (see VirtualKeyboard.ts).
 *
 *   title                    title bar text
 *   rejectSpecialCharacters  true = only A-Z a-z 0-9 _ - . and space (same rule as StringSetData)
 *
 * Returns true if opened.
 */
module TcHmi {
    export module Functions {
        export module SetDataFramework {
            export function OpenStringKeyboard(title: string | null, rejectSpecialCharacters: boolean | null): boolean {
                return VirtualKeyboard.openStr(title || '', rejectSpecialCharacters === true);
            }
        }
    }
}
TcHmi.Functions.registerFunctionEx('OpenStringKeyboard', 'TcHmi.Functions.SetDataFramework', TcHmi.Functions.SetDataFramework.OpenStringKeyboard);

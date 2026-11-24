/*
 * OpenNumKeyboard - opens the package's numeric keypad for the focused text field (see VirtualKeyboard.ts).
 *
 *   title          title bar text
 *   decimals       null = free; 0 = no '.'; N = at most N digits after '.'
 *   allowNegative  false = '±' greyed
 *
 * Returns true if opened.
 */
module TcHmi {
    export module Functions {
        export module SetDataFramework {
            export function OpenNumKeyboard(title: string | null, decimals: number | null, allowNegative: boolean | null): boolean {
                return VirtualKeyboard.openNum(title || '', decimals, allowNegative !== false);
            }
        }
    }
}
TcHmi.Functions.registerFunctionEx('OpenNumKeyboard', 'TcHmi.Functions.SetDataFramework', TcHmi.Functions.SetDataFramework.OpenNumKeyboard);

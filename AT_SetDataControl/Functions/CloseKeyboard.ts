/*
 * CloseKeyboard - closes the keyboard opened by OpenNumKeyboard / OpenStringKeyboard and blurs its field,
 * so the field commits (see VirtualKeyboard.ts).
 *
 * Returns true if a keyboard was open.
 */
module TcHmi {
    export module Functions {
        export module SetDataFramework {
            export function CloseKeyboard(): boolean {
                return VirtualKeyboard.close();
            }
        }
    }
}
TcHmi.Functions.registerFunctionEx('CloseKeyboard', 'TcHmi.Functions.SetDataFramework', TcHmi.Functions.SetDataFramework.CloseKeyboard);

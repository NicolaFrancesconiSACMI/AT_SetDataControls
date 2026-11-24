/*
 * OpenStringKeyboard - opens the package's alphanumeric keyboard for the focused text field (see VirtualKeyboard.ts).
 *
 *   title                    title bar text
 *   rejectSpecialCharacters  true = only A-Z a-z 0-9 _ - . and space (same rule as StringSetData)
 *
 * Returns true if opened.
 */
var TcHmi;
(function (TcHmi) {
    let Functions;
    (function (Functions) {
        let SetDataFramework;
        (function (SetDataFramework) {
            function OpenStringKeyboard(title, rejectSpecialCharacters) {
                return SetDataFramework.VirtualKeyboard.openStr(title || '', rejectSpecialCharacters === true);
            }
            SetDataFramework.OpenStringKeyboard = OpenStringKeyboard;
        })(SetDataFramework = Functions.SetDataFramework || (Functions.SetDataFramework = {}));
    })(Functions = TcHmi.Functions || (TcHmi.Functions = {}));
})(TcHmi || (TcHmi = {}));
TcHmi.Functions.registerFunctionEx('OpenStringKeyboard', 'TcHmi.Functions.SetDataFramework', TcHmi.Functions.SetDataFramework.OpenStringKeyboard);
//# sourceMappingURL=OpenStringKeyboard.js.map
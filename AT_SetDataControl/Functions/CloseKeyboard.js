/*
 * CloseKeyboard - closes the keyboard opened by OpenNumKeyboard / OpenStringKeyboard and blurs its field,
 * so the field commits (see VirtualKeyboard.ts).
 *
 * Returns true if a keyboard was open.
 */
var TcHmi;
(function (TcHmi) {
    let Functions;
    (function (Functions) {
        let SetDataFramework;
        (function (SetDataFramework) {
            function CloseKeyboard() {
                return SetDataFramework.VirtualKeyboard.close();
            }
            SetDataFramework.CloseKeyboard = CloseKeyboard;
        })(SetDataFramework = Functions.SetDataFramework || (Functions.SetDataFramework = {}));
    })(Functions = TcHmi.Functions || (TcHmi.Functions = {}));
})(TcHmi || (TcHmi = {}));
TcHmi.Functions.registerFunctionEx('CloseKeyboard', 'TcHmi.Functions.SetDataFramework', TcHmi.Functions.SetDataFramework.CloseKeyboard);
//# sourceMappingURL=CloseKeyboard.js.map
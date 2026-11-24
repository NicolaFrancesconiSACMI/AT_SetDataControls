/*
 * OpenNumKeyboard - opens the package's numeric keypad for the focused text field (see VirtualKeyboard.ts).
 *
 *   title          title bar text
 *   decimals       null = free; 0 = no '.'; N = at most N digits after '.'
 *   allowNegative  false = '±' greyed
 *
 * Returns true if opened.
 */
var TcHmi;
(function (TcHmi) {
    let Functions;
    (function (Functions) {
        let SetDataFramework;
        (function (SetDataFramework) {
            function OpenNumKeyboard(title, decimals, allowNegative) {
                return SetDataFramework.VirtualKeyboard.openNum(title || '', decimals, allowNegative !== false);
            }
            SetDataFramework.OpenNumKeyboard = OpenNumKeyboard;
        })(SetDataFramework = Functions.SetDataFramework || (Functions.SetDataFramework = {}));
    })(Functions = TcHmi.Functions || (TcHmi.Functions = {}));
})(TcHmi || (TcHmi = {}));
TcHmi.Functions.registerFunctionEx('OpenNumKeyboard', 'TcHmi.Functions.SetDataFramework', TcHmi.Functions.SetDataFramework.OpenNumKeyboard);
//# sourceMappingURL=OpenNumKeyboard.js.map